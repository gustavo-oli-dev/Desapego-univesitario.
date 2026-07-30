"""
API do Desapego Universitário. Endpoints REST em JSON para cadastro/login
e para criar, listar, filtrar, editar e remover anúncios — o frontend usa
fetch() pra tudo isso, sem localStorage.
"""

import io
import json
import os
import sqlite3
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import List, Optional

import requests
from fastapi import Depends, FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from PIL import Image, ImageOps

import database
import email_service
import limitador
from auth import (
    gerar_codigo_verificacao,
    gerar_hash_senha,
    gerar_token,
    gerar_token_pendente_2fa,
    obter_usuario_atual,
    obter_usuario_atual_opcional,
    validar_token_pendente_2fa,
    verificar_senha,
    verificar_token_google,
)
from schemas import (
    AUTORES,
    CATEGORIAS,
    CURSOS,
    TURNOS,
    MATERIAS,
    MOTIVOS_DENUNCIA,
    Confirmar2FA,
    DenunciaCreate,
    ImportarLivros,
    LoginGoogle,
    OfertaPreco,
    RecuperarSenhaConfirmar,
    RecuperarSenhaPedido,
    ResponderConfirmacaoVenda,
    TrocarSenhaConfirmar,
    TrocarSenhaPedido,
    UsuarioCadastro,
    UsuarioLogin,
    VerificarEmail,
)

VALIDADE_CODIGO = timedelta(minutes=10)

# Avatar, foto de chat e fotos de anúncio vão pro disco (não mais base64
# no banco) — só o caminho relativo fica gravado. Tamanho e extensão são
# checados na hora do upload pra não deixar um arquivo gigante ou
# disfarçado de imagem parar no servidor.
DIR_ESTATICO = Path(__file__).parent / "static"
DIR_AVATARS = DIR_ESTATICO / "uploads" / "avatars"
DIR_CHAT = DIR_ESTATICO / "uploads" / "chat"
DIR_ANUNCIOS = DIR_ESTATICO / "uploads" / "anuncios"
DIR_AVATARS.mkdir(parents=True, exist_ok=True)
DIR_CHAT.mkdir(parents=True, exist_ok=True)
DIR_ANUNCIOS.mkdir(parents=True, exist_ok=True)
EXTENSOES_IMAGEM_PERMITIDAS = {".jpg", ".jpeg", ".png", ".webp", ".gif"}
# 10MB é o limite do UPLOAD (antes de comprimir): celular moderno em qualidade
# máxima passa dos 5MB com facilidade, e o que fica salvo é bem menor de todo
# jeito, porque tudo é recomprimido logo abaixo.
TAMANHO_MAXIMO_IMAGEM = 10 * 1024 * 1024
MEGAPIXELS_MAXIMOS = 30
# O que de fato protege a memória não é o peso do arquivo, é a resolução: o
# Pillow descomprime pra bitmap, e cada megapixel custa ~3MB de RAM. Um JPEG
# de 2MB pode ter 100MP e estourar a instância — daí o teto em megapixels.
TAMANHO_MAXIMO_IMAGEM_MB = TAMANHO_MAXIMO_IMAGEM // (1024 * 1024)
LADO_MAXIMO_IMAGEM = 1280   # maior lado depois de redimensionar (px)
QUALIDADE_JPEG = 82         # 0–100; 82 é ótimo equilíbrio nitidez/peso


def comprimir_imagem(conteudo: bytes) -> bytes:
    """Redimensiona e recomprime a imagem pra ela não pesar no site: corrige a
    rotação de fotos de celular (EXIF), reduz o maior lado pra LADO_MAXIMO_IMAGEM
    e reencoda como JPEG. Uma foto de 3–4MB do celular cai pra ~150–300KB.
    PNG/transparência viram fundo branco (marketplace não precisa de alfa)."""
    im = Image.open(io.BytesIO(conteudo))

    # Checa a resolução ANTES de decodificar: Image.open() só lê o cabeçalho,
    # então aqui ainda não gastamos memória. É o passo que impede uma imagem
    # pequena em bytes mas enorme em pixels de derrubar a instância.
    megapixels = (im.width * im.height) / 1_000_000
    if megapixels > MEGAPIXELS_MAXIMOS:
        raise HTTPException(
            status_code=422,
            detail=f"Imagem com resolução muito alta ({megapixels:.0f}MP)."
                   f" O máximo é {MEGAPIXELS_MAXIMOS}MP.",
        )

    im = ImageOps.exif_transpose(im)   # foto de celular deitada volta ao normal
    if im.mode in ("RGBA", "LA", "P"):
        fundo = Image.new("RGB", im.size, (255, 255, 255))
        im = im.convert("RGBA")
        fundo.paste(im, mask=im.split()[-1])
        im = fundo
    else:
        im = im.convert("RGB")
    im.thumbnail((LADO_MAXIMO_IMAGEM, LADO_MAXIMO_IMAGEM))  # mantém proporção
    buffer = io.BytesIO()
    im.save(buffer, format="JPEG", quality=QUALIDADE_JPEG, optimize=True)
    return buffer.getvalue()


async def salvar_imagem_upload(arquivo: UploadFile, diretorio: Path, url_base: str) -> str:
    """Valida (extensão + tamanho), COMPRIME e salva um upload em disco com um
    nome gerado (nunca o nome original — evita path traversal e sobrescrita de
    arquivo de outra pessoa). Sempre grava como .jpg comprimido. Devolve o
    caminho relativo pra gravar no banco. Usado por avatar, foto de chat e
    fotos de anúncio."""
    extensao = Path(arquivo.filename or "").suffix.lower()
    if extensao not in EXTENSOES_IMAGEM_PERMITIDAS:
        raise HTTPException(status_code=422, detail="Formato de imagem não suportado")

    conteudo = await arquivo.read()
    if len(conteudo) > TAMANHO_MAXIMO_IMAGEM:
        tamanho_mb = len(conteudo) / (1024 * 1024)
        raise HTTPException(
            status_code=422,
            detail=f"Imagem muito grande ({tamanho_mb:.1f}MB)."
                   f" O máximo é {TAMANHO_MAXIMO_IMAGEM_MB}MB.",
        )

    try:
        conteudo = comprimir_imagem(conteudo)
    except Exception:
        # Extensão de imagem mas conteúdo que o Pillow não abre = arquivo inválido.
        raise HTTPException(status_code=422, detail="Não foi possível processar a imagem")

    nome_arquivo = f"{uuid.uuid4().hex}.jpg"   # tudo vira JPEG comprimido
    (diretorio / nome_arquivo).write_bytes(conteudo)
    return f"{url_base}/{nome_arquivo}"

database.init_db()

app = FastAPI(title="Desapego Universitário API")

# Origens liberadas no CORS. Em desenvolvimento: localhost + IPs da rede local
# (pra abrir pelo celular no mesmo Wi-Fi). Em produção: as URLs do frontend
# publicado (Netlify/Vercel/GitHub Pages) entram pela variável de ambiente
# FRONTEND_ORIGINS (separadas por vírgula), sem precisar mexer no código.
origens_permitidas = ["http://localhost:8000", "http://127.0.0.1:8000"]
origens_permitidas += [
    o.strip() for o in os.environ.get("FRONTEND_ORIGINS", "").split(",") if o.strip()
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origens_permitidas,
    allow_origin_regex=r"http://(192\.168\.\d{1,3}\.\d{1,3}|10\.\d{1,3}\.\d{1,3}\.\d{1,3}):8000",
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.middleware("http")
async def cabecalhos_seguranca(request: Request, call_next):
    """Cabeçalhos de segurança em toda resposta (API e arquivos em /static):
    - nosniff: navegador não "adivinha" o tipo do conteúdo (evita tratar um
      upload como HTML/JS);
    - X-Frame-Options DENY: ninguém embute o site num iframe (anti-clickjacking);
    - Referrer-Policy: não vaza a URL de origem pra outros sites."""
    resposta = await call_next(request)
    resposta.headers["X-Content-Type-Options"] = "nosniff"
    resposta.headers["X-Frame-Options"] = "DENY"
    resposta.headers["Referrer-Policy"] = "no-referrer"
    return resposta


app.mount("/static", StaticFiles(directory=str(DIR_ESTATICO)), name="static")


def linha_para_anuncio(row):
    return {
        "id": row["id"],
        "titulo": row["titulo"],
        "descricao": row["descricao"],
        "categoria": row["categoria"],
        "tipo": row["tipo"],
        "preco": row["preco"],
        "preco_original": row["preco_original"],
        "imagem": row["imagem"],
        # A galeria completa não vem aqui de propósito — isso é usado nas
        # listagens (catálogo, meus anúncios, home...), que só mostram a
        # capa mesmo. Buscar as fotos de cada anúncio da lista custaria uma
        # query a mais por linha (N+1). Quem precisa da galeria inteira usa
        # GET /anuncios/{id}, que popula isso à parte.
        "imagens": [],
        "curso": json.loads(row["curso"] or "[]"),
        "materia": json.loads(row["materia"] or "[]"),
        "autor": json.loads(row["autor"] or "[]"),
        "telefone_publico": bool(row["telefone_publico"]),
        "vendido": bool(row["vendido"]),
        "user_id": row["user_id"],
        "criado_em": row["criado_em"],
    }


def buscar_imagens_anuncio(conn, anuncio_id: int) -> list[str]:
    linhas = conn.execute(
        "SELECT caminho_imagem FROM anuncio_imagens WHERE anuncio_id = ? ORDER BY id", (anuncio_id,)
    ).fetchall()
    return [l["caminho_imagem"] for l in linhas]


def buscar_anuncio_ou_404(conn, anuncio_id: int):
    linha = conn.execute("SELECT * FROM anuncios WHERE id = ?", (anuncio_id,)).fetchone()
    if not linha:
        raise HTTPException(status_code=404, detail="Anúncio não encontrado")
    return linha


def exigir_admin(usuario_id: int = Depends(obter_usuario_atual)) -> int:
    conn = database.conectar()
    usuario = conn.execute("SELECT is_admin FROM usuarios WHERE id = ?", (usuario_id,)).fetchone()
    conn.close()
    if not usuario or not usuario["is_admin"]:
        raise HTTPException(status_code=403, detail="Só administradores podem acessar isso")
    return usuario_id


def exigir_dono(anuncio_row, usuario_id: int):
    if anuncio_row["user_id"] != str(usuario_id):
        raise HTTPException(status_code=403, detail="Você só pode alterar os seus próprios anúncios")


# Gera o código, guarda no banco e TENTA enviar por email (email_service).
# Devolve (codigo, enviado_por_email):
#   - Se o .env tem credencial SMTP e o envio deu certo → enviado=True e o
#     código NÃO deve ser exposto na resposta (vai só pro email).
#   - Sem credencial (ou falha no envio) → enviado=False e o backend devolve o
#     código na resposta pra mostrar na tela (modo demo). Assim o app funciona
#     configurado OU não, sem quebrar o fluxo.
def criar_codigo(conn, usuario_id: int, proposito: str, payload: Optional[dict] = None):
    codigo = gerar_codigo_verificacao()
    conn.execute(
        "INSERT INTO codigos_verificacao (usuario_id, codigo, proposito, payload, criado_em) VALUES (?, ?, ?, ?, ?)",
        (usuario_id, codigo, proposito, json.dumps(payload) if payload else None,
         datetime.now(timezone.utc).isoformat()),
    )
    conn.commit()

    usuario = conn.execute(
        "SELECT email, nome FROM usuarios WHERE id = ?", (usuario_id,)
    ).fetchone()
    enviado = False
    if usuario:
        enviado = email_service.enviar_codigo_email(
            usuario["email"], usuario["nome"], codigo, proposito
        )
    return codigo, enviado


def validar_codigo(conn, usuario_id: int, proposito: str, codigo: str) -> Optional[dict]:
    linha = conn.execute(
        """
        SELECT * FROM codigos_verificacao
        WHERE usuario_id = ? AND proposito = ? AND usado = 0
        ORDER BY id DESC LIMIT 1
        """,
        (usuario_id, proposito),
    ).fetchone()

    if not linha or linha["codigo"] != codigo:
        raise HTTPException(status_code=401, detail="Código inválido")

    criado_em = datetime.fromisoformat(linha["criado_em"])
    if datetime.now(timezone.utc) - criado_em > VALIDADE_CODIGO:
        raise HTTPException(status_code=401, detail="Código expirado, solicite um novo")

    conn.execute("UPDATE codigos_verificacao SET usado = 1 WHERE id = ?", (linha["id"],))
    conn.commit()
    return json.loads(linha["payload"]) if linha["payload"] else None


# ---------------------------------------------------------------------
# Autenticação
# ---------------------------------------------------------------------
@app.post("/auth/verificar-email")
def verificar_email(dados: VerificarEmail):
    """Diz se um email já está cadastrado. O formato inválido já é barrado pelo
    EmailStr (vira 422). Serve pro passo 1 do cadastro avisar cedo, sem esperar
    a pessoa preencher o nome. Não revela nada sensível — só disponível ou não."""
    conn = database.conectar()
    email = dados.email.strip().lower()
    existe = conn.execute("SELECT id FROM usuarios WHERE email = ?", (email,)).fetchone()
    conn.close()
    return {"disponivel": existe is None}


@app.post("/auth/cadastro", status_code=201)
def cadastrar_usuario(dados: UsuarioCadastro):
    conn = database.conectar()
    email = dados.email.strip().lower()

    existe = conn.execute("SELECT id FROM usuarios WHERE email = ?", (email,)).fetchone()
    if existe:
        conn.close()
        raise HTTPException(status_code=409, detail="Já existe uma conta com esse email")

    senha_hash = gerar_hash_senha(dados.senha)
    criado_em = datetime.now(timezone.utc).isoformat()
    cursor = conn.execute(
        "INSERT INTO usuarios (nome, email, senha_hash, telefone, criado_em) VALUES (?, ?, ?, ?, ?)",
        (dados.nome, email, senha_hash, dados.telefone, criado_em),
    )
    conn.commit()
    usuario_id = cursor.lastrowid
    conn.close()

    return {"token": gerar_token(usuario_id), "nome": dados.nome, "email": email}


@app.post("/auth/login")
def login(dados: UsuarioLogin, request: Request):
    # Freia força bruta de senha: no máximo 10 tentativas de login por IP a
    # cada 5 minutos (o brute-force clássico precisa de milhares).
    limitador.limitar(f"login:{limitador.ip_do_cliente(request)}", maximo=10, janela_segundos=300)

    conn = database.conectar()
    try:
        usuario = conn.execute(
            "SELECT * FROM usuarios WHERE email = ?", (dados.email.strip().lower(),)
        ).fetchone()

        if not usuario or not verificar_senha(dados.senha, usuario["senha_hash"]):
            raise HTTPException(status_code=401, detail="Email ou senha incorretos")

        if usuario["banido"]:
            raise HTTPException(status_code=403, detail="Sua conta foi banida da plataforma")

        codigo, enviado = criar_codigo(conn, usuario["id"], "login_2fa")
    finally:
        conn.close()

    return {
        "precisa_2fa": True,
        "token_pendente": gerar_token_pendente_2fa(usuario["id"]),
        # Só devolve o código pra tela quando NÃO foi por email (modo demo).
        "codigo_simulado": None if enviado else codigo,
        "email_enviado": enviado,
    }


@app.post("/auth/2fa/confirmar")
def confirmar_2fa(dados: Confirmar2FA, request: Request):
    # O código é só 6 dígitos (1 milhão de combinações). Sem limite, dava pra
    # varrer tudo dentro dos 10 min de validade; 10 tentativas por IP a cada
    # 10 min tornam o brute-force inviável.
    limitador.limitar(f"2fa:{limitador.ip_do_cliente(request)}", maximo=10, janela_segundos=600)

    usuario_id = validar_token_pendente_2fa(dados.token_pendente)

    conn = database.conectar()
    try:
        validar_codigo(conn, usuario_id, "login_2fa", dados.codigo)
        usuario = conn.execute("SELECT * FROM usuarios WHERE id = ?", (usuario_id,)).fetchone()
    finally:
        conn.close()

    return {"token": gerar_token(usuario_id), "nome": usuario["nome"], "email": usuario["email"]}


@app.post("/auth/recuperar-senha/solicitar")
def solicitar_recuperacao_senha(dados: RecuperarSenhaPedido, request: Request):
    limitador.limitar(
        f"rec-senha-sol:{limitador.ip_do_cliente(request)}", maximo=5, janela_segundos=900
    )

    conn = database.conectar()
    try:
        usuario = conn.execute(
            "SELECT * FROM usuarios WHERE email = ?", (dados.email.strip().lower(),)
        ).fetchone()

        # Não revela se o email existe ou não: responde SEMPRE do mesmo jeito.
        # Antes, um 404 pra email inexistente deixava qualquer um descobrir
        # quais emails têm conta (enumeração de usuários). Quando o email
        # existe, geramos/enviamos o código; quando não, respondemos igual,
        # sem código.
        if usuario:
            codigo, enviado = criar_codigo(conn, usuario["id"], "recuperar_senha")
        else:
            codigo, enviado = None, email_service.email_configurado()
    finally:
        conn.close()

    return {"codigo_simulado": None if enviado else codigo, "email_enviado": enviado}


@app.post("/auth/recuperar-senha/confirmar")
def confirmar_recuperacao_senha(dados: RecuperarSenhaConfirmar, request: Request):
    limitador.limitar(
        f"rec-senha-conf:{limitador.ip_do_cliente(request)}", maximo=10, janela_segundos=600
    )

    conn = database.conectar()
    try:
        usuario = conn.execute(
            "SELECT * FROM usuarios WHERE email = ?", (dados.email.strip().lower(),)
        ).fetchone()
        # Email inexistente responde igual a código errado ("Código inválido"),
        # pra não revelar quais emails têm conta (mesma razão do /solicitar).
        if not usuario:
            raise HTTPException(status_code=401, detail="Código inválido")

        validar_codigo(conn, usuario["id"], "recuperar_senha", dados.codigo)

        senha_hash_nova = gerar_hash_senha(dados.senha_nova)
        conn.execute("UPDATE usuarios SET senha_hash = ? WHERE id = ?", (senha_hash_nova, usuario["id"]))
        conn.commit()
    finally:
        conn.close()

    return {"ok": True}


@app.post("/auth/google")
def login_google(dados: LoginGoogle):
    info = verificar_token_google(dados.token)
    email = info["email"].strip().lower()
    nome_google = info.get("name", email.split("@")[0])

    conn = database.conectar()
    try:
        usuario = conn.execute("SELECT * FROM usuarios WHERE email = ?", (email,)).fetchone()

        if usuario:
            usuario_id = usuario["id"]
            nome = usuario["nome"]
        else:
            criado_em = datetime.now(timezone.utc).isoformat()
            cursor = conn.execute(
                "INSERT INTO usuarios (nome, email, senha_hash, telefone, criado_em) VALUES (?, ?, ?, ?, ?)",
                (nome_google, email, None, dados.telefone, criado_em),
            )
            conn.commit()
            usuario_id = cursor.lastrowid
            nome = nome_google
    finally:
        conn.close()

    return {"token": gerar_token(usuario_id), "nome": nome, "email": email}


# ---------------------------------------------------------------------
# Perfil (dados da própria conta)
# ---------------------------------------------------------------------
@app.get("/usuarios/me")
def obter_perfil(usuario_id: int = Depends(obter_usuario_atual)):
    conn = database.conectar()
    usuario = conn.execute("SELECT * FROM usuarios WHERE id = ?", (usuario_id,)).fetchone()
    conn.close()

    return {
        "nome": usuario["nome"],
        "email": usuario["email"],
        "telefone": usuario["telefone"],
        "foto": usuario["foto"],
        "curso": usuario["curso"],
        "turno": usuario["turno"],
        "is_admin": bool(usuario["is_admin"]),
        # Conta criada via Google não tem senha própria (senha_hash é NULL) —
        # o frontend usa isso pra esconder a opção de trocar senha.
        "tem_senha": usuario["senha_hash"] is not None,
    }


@app.get("/usuarios/{usuario_id}/publico")
def obter_perfil_publico(usuario_id: int):
    conn = database.conectar()
    usuario = conn.execute("SELECT * FROM usuarios WHERE id = ?", (usuario_id,)).fetchone()
    conn.close()

    if not usuario:
        raise HTTPException(status_code=404, detail="Usuário não encontrado")

    # Só nome, foto e a contagem de vendas confirmadas — email, telefone e
    # senha_hash nunca saem daqui. Qualquer pessoa (mesmo sem estar logada)
    # pode ver o perfil público de quem anuncia, então esse endpoint não
    # exige token.
    return {
        "id": usuario["id"],
        "nome": usuario["nome"],
        "foto": usuario["foto"],
        "curso": usuario["curso"],
        "turno": usuario["turno"],
        "vendas_confirmadas": usuario["vendas_confirmadas"],
    }


@app.post("/usuarios/{usuario_alvo_id}/bloquear", status_code=201)
def bloquear_usuario(usuario_alvo_id: int, usuario_id: int = Depends(obter_usuario_atual)):
    if usuario_alvo_id == usuario_id:
        raise HTTPException(status_code=400, detail="Você não pode bloquear você mesmo")

    conn = database.conectar()
    try:
        alvo = conn.execute("SELECT id FROM usuarios WHERE id = ?", (usuario_alvo_id,)).fetchone()
        if not alvo:
            raise HTTPException(status_code=404, detail="Usuário não encontrado")

        conn.execute(
            "INSERT OR IGNORE INTO bloqueios (bloqueador_id, bloqueado_id, criado_em) VALUES (?, ?, ?)",
            (usuario_id, usuario_alvo_id, datetime.now(timezone.utc).isoformat()),
        )
        conn.commit()
    finally:
        conn.close()
    return {"ok": True}


@app.put("/usuarios/me")
async def atualizar_perfil(
    nome: str = Form(..., min_length=1, max_length=80),
    telefone: Optional[str] = Form(None),
    curso: Optional[str] = Form(None),
    turno: Optional[str] = Form(None),
    foto: Optional[UploadFile] = File(None),
    usuario_id: int = Depends(obter_usuario_atual),
):
    nome = nome.strip()
    if curso and curso not in CURSOS:
        raise HTTPException(status_code=422, detail=f"curso deve ser um de: {', '.join(CURSOS)}")
    if turno and turno not in TURNOS:
        raise HTTPException(status_code=422, detail=f"turno deve ser um de: {', '.join(TURNOS)}")

    foto_caminho = None
    if foto is not None:
        foto_caminho = await salvar_imagem_upload(foto, DIR_AVATARS, "/static/uploads/avatars")

    conn = database.conectar()
    if foto_caminho:
        conn.execute(
            "UPDATE usuarios SET nome = ?, telefone = ?, foto = ?, curso = ?, turno = ? WHERE id = ?",
            (nome, telefone, foto_caminho, curso, turno, usuario_id),
        )
    else:
        conn.execute(
            "UPDATE usuarios SET nome = ?, telefone = ?, curso = ?, turno = ? WHERE id = ?",
            (nome, telefone, curso, turno, usuario_id),
        )
    conn.commit()
    usuario = conn.execute("SELECT * FROM usuarios WHERE id = ?", (usuario_id,)).fetchone()
    conn.close()

    return {
        "nome": usuario["nome"],
        "telefone": usuario["telefone"],
        "foto": usuario["foto"],
        "curso": usuario["curso"],
        "turno": usuario["turno"],
    }


@app.post("/usuarios/me/trocar-senha/solicitar")
def solicitar_troca_senha(dados: TrocarSenhaPedido, usuario_id: int = Depends(obter_usuario_atual)):
    # Limita por usuário: impede varrer a senha atual por tentativa e erro.
    limitador.limitar(f"troca-senha-sol:{usuario_id}", maximo=10, janela_segundos=600)

    conn = database.conectar()
    try:
        usuario = conn.execute("SELECT * FROM usuarios WHERE id = ?", (usuario_id,)).fetchone()
        if not verificar_senha(dados.senha_atual, usuario["senha_hash"]):
            raise HTTPException(status_code=401, detail="Senha atual incorreta")

        senha_hash_nova = gerar_hash_senha(dados.senha_nova)
        codigo, enviado = criar_codigo(conn, usuario_id, "trocar_senha", {"senha_hash_nova": senha_hash_nova})
    finally:
        conn.close()

    return {"codigo_simulado": None if enviado else codigo, "email_enviado": enviado}


@app.post("/usuarios/me/trocar-senha/confirmar")
def confirmar_troca_senha(dados: TrocarSenhaConfirmar, usuario_id: int = Depends(obter_usuario_atual)):
    limitador.limitar(f"troca-senha-conf:{usuario_id}", maximo=10, janela_segundos=600)

    conn = database.conectar()
    try:
        payload = validar_codigo(conn, usuario_id, "trocar_senha", dados.codigo)
        conn.execute(
            "UPDATE usuarios SET senha_hash = ? WHERE id = ?",
            (payload["senha_hash_nova"], usuario_id),
        )
        conn.commit()
    finally:
        conn.close()

    return {"ok": True}


# ---------------------------------------------------------------------
# Opções fixas (categorias / cursos / matérias / autores)
# ---------------------------------------------------------------------
@app.get("/opcoes")
def listar_opcoes():
    # Autores saem da TABELA (e não mais da lista fixa): assim o que for
    # importado da API externa aparece no filtro sem precisar mexer no
    # código. A lista fixa foi semeada na tabela em database.init_db, então
    # os autores dos anúncios antigos continuam disponíveis.
    conn = database.conectar()
    try:
        autores = [l["nome"] for l in conn.execute("SELECT nome FROM autores ORDER BY nome")]
    finally:
        conn.close()

    return {
        "categorias": CATEGORIAS,
        "cursos": CURSOS,
        "turnos": TURNOS,
        "materias": MATERIAS,
        # se a tabela estiver vazia por algum motivo, cai na lista fixa
        "autores": autores or AUTORES,
        "motivos_denuncia": MOTIVOS_DENUNCIA,
    }


# ---------------------------------------------------------------------
# Anúncios
# ---------------------------------------------------------------------
@app.get("/anuncios")
def listar_anuncios(
    categoria: Optional[str] = None,
    usuario: Optional[int] = None,
    vendido: Optional[bool] = None,
    q: Optional[str] = None,
    ordem: Optional[str] = None,
    aleatorio: bool = False,
    limit: Optional[int] = None,
    offset: int = 0,
    usuario_id: Optional[int] = Depends(obter_usuario_atual_opcional),
):
    conn = database.conectar()

    query = "SELECT * FROM anuncios WHERE 1=1"
    params = []
    if categoria and categoria != "todas":
        query += " AND categoria = ?"
        params.append(categoria)
    if usuario:
        query += " AND user_id = ?"
        params.append(str(usuario))

    # Busca simples por substring (sem tolerância a erro de digitação —
    # decisão deliberada: fazer isso no banco linha a linha mataria a
    # performance no lugar de resolver ela). "autor" é um array JSON
    # serializado como texto, então LIKE já casa direto com o nome dentro
    # do JSON, sem precisar de tratamento especial.
    if q:
        query += " AND (titulo LIKE ? OR descricao LIKE ? OR autor LIKE ?)"
        termo = f"%{q}%"
        params.extend([termo, termo, termo])

    # Quando vem explícito (abas Ativos/Vendidos de um perfil) o filtro é
    # exatamente esse. Sem ele, no catálogo geral os já vendidos somem por
    # padrão — quem visita um perfil específico com ?usuario=&vendido= tem
    # que pedir os dois grupos separadamente.
    if vendido is not None:
        query += " AND vendido = ?"
        params.append(int(vendido))
    elif not usuario:
        query += " AND vendido = 0"

    # Quem foi bloqueado por quem está olhando some do catálogo geral
    # (quando não filtrando por um perfil específico e dá pra saber quem
    # está olhando, ou seja, tem sessão válida).
    if not usuario and usuario_id:
        bloqueados = conn.execute(
            "SELECT bloqueado_id FROM bloqueios WHERE bloqueador_id = ?", (usuario_id,)
        ).fetchall()
        if bloqueados:
            placeholders = ",".join("?" * len(bloqueados))
            query += f" AND user_id NOT IN ({placeholders})"
            params.extend(str(b["bloqueado_id"]) for b in bloqueados)

    # Ordenação decidida no banco — evita baixar o catálogo inteiro só pra
    # ordenar no cliente. "ordem" (vindo do select do catálogo) tem
    # prioridade; sem ele, cai no comportamento de sempre (aleatório pra
    # prévia da home, ou mais recente primeiro).
    if ordem == "menor-preco":
        query += " ORDER BY preco ASC"
    elif ordem == "maior-preco":
        query += " ORDER BY preco DESC"
    elif aleatorio:
        query += " ORDER BY RANDOM()"
    else:
        query += " ORDER BY criado_em DESC"

    if limit:
        query += " LIMIT ? OFFSET ?"
        params.extend([min(limit, 50), max(offset, 0)])

    linhas = conn.execute(query, params).fetchall()
    conn.close()
    return [linha_para_anuncio(l) for l in linhas]


@app.get("/anuncios/meus")
def listar_meus_anuncios(
    vendido: Optional[bool] = None,
    limit: int = 20,
    offset: int = 0,
    usuario_id: int = Depends(obter_usuario_atual),
):
    conn = database.conectar()
    query = "SELECT * FROM anuncios WHERE user_id = ?"
    params = [str(usuario_id)]

    if vendido is not None:
        query += " AND vendido = ?"
        params.append(int(vendido))

    query += " ORDER BY criado_em DESC LIMIT ? OFFSET ?"
    params.extend([min(limit, 50), max(offset, 0)])

    linhas = conn.execute(query, params).fetchall()
    conn.close()
    return [linha_para_anuncio(l) for l in linhas]


@app.get("/anuncios/{anuncio_id}")
def buscar_anuncio(anuncio_id: int):
    conn = database.conectar()
    try:
        linha = buscar_anuncio_ou_404(conn, anuncio_id)
        anuncio = linha_para_anuncio(linha)
        anuncio["imagens"] = buscar_imagens_anuncio(conn, anuncio_id)

        # Só inclui o telefone do vendedor se ele deixou público NESSE
        # anúncio — sem isso, ninguém de fora consegue ver o telefone de
        # ninguém (mesma lógica de nunca vazar dado privado sem opt-in).
        if anuncio["telefone_publico"]:
            vendedor = conn.execute(
                "SELECT telefone FROM usuarios WHERE id = ?", (linha["user_id"],)
            ).fetchone()
            anuncio["telefone_vendedor"] = vendedor["telefone"] if vendedor else None

        return anuncio
    finally:
        conn.close()


MAX_FOTOS_ANUNCIO = 5


@app.post("/anuncios", status_code=201)
async def criar_anuncio(
    titulo: str = Form(..., min_length=1, max_length=60),
    descricao: str = Form(..., min_length=1, max_length=300),
    categoria: str = Form(...),
    tipo: str = Form(...),
    preco: Optional[float] = Form(None),
    curso: List[str] = Form([]),
    materia: List[str] = Form([]),
    autor: List[str] = Form([]),
    telefone_publico: bool = Form(False),
    fotos: List[UploadFile] = File([]),
    usuario_id: int = Depends(obter_usuario_atual),
):
    titulo = titulo.strip()
    descricao = descricao.strip()
    if categoria not in CATEGORIAS:
        raise HTTPException(status_code=422, detail=f"categoria deve ser uma de: {', '.join(CATEGORIAS)}")
    if tipo not in ("doacao", "venda"):
        raise HTTPException(status_code=422, detail='tipo deve ser "doacao" ou "venda"')
    if tipo == "venda" and (not preco or preco <= 0):
        raise HTTPException(
            status_code=422, detail="preco é obrigatório e deve ser maior que zero quando tipo é venda"
        )
    if len(fotos) > MAX_FOTOS_ANUNCIO:
        raise HTTPException(status_code=422, detail=f"no máximo {MAX_FOTOS_ANUNCIO} fotos por anúncio")

    # Tetos nas tags de livro (curso/matéria/autor): vêm de listas fixas no
    # site, mas a API aceitava qualquer coisa em qualquer quantidade — sem
    # limite dava pra enviar milhares de valores gigantes e inflar o banco.
    for rotulo, lista in (("curso", curso), ("materia", materia), ("autor", autor)):
        if len(lista) > 20 or any(len(v) > 80 for v in lista):
            raise HTTPException(status_code=422, detail=f"{rotulo}: valores demais ou muito longos")

    conn = database.conectar()
    criado_em = datetime.now(timezone.utc).isoformat()

    cursor = conn.execute(
        """
        INSERT INTO anuncios
            (titulo, descricao, categoria, tipo, preco, imagem, curso, materia, autor, telefone_publico, user_id, criado_em)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            titulo, descricao, categoria, tipo, preco if tipo == "venda" else None, "",
            json.dumps(curso), json.dumps(materia), json.dumps(autor),
            int(telefone_publico), str(usuario_id), criado_em,
        ),
    )
    anuncio_id = cursor.lastrowid
    conn.commit()

    # O id do anúncio só existe depois do INSERT acima — por isso as fotos
    # são salvas e vinculadas em anuncio_imagens só agora, não no mesmo
    # INSERT (diferente de quando era um array dentro da própria linha).
    imagem_capa = ""
    for foto in fotos:
        caminho = await salvar_imagem_upload(foto, DIR_ANUNCIOS, "/static/uploads/anuncios")
        conn.execute(
            "INSERT INTO anuncio_imagens (anuncio_id, caminho_imagem, criado_em) VALUES (?, ?, ?)",
            (anuncio_id, caminho, datetime.now(timezone.utc).isoformat()),
        )
        if not imagem_capa:
            imagem_capa = caminho
    if imagem_capa:
        conn.execute("UPDATE anuncios SET imagem = ? WHERE id = ?", (imagem_capa, anuncio_id))
    conn.commit()

    linha = conn.execute("SELECT * FROM anuncios WHERE id = ?", (anuncio_id,)).fetchone()
    anuncio = linha_para_anuncio(linha)
    anuncio["imagens"] = buscar_imagens_anuncio(conn, anuncio_id)
    conn.close()
    return anuncio


@app.put("/anuncios/{anuncio_id}")
async def editar_anuncio(
    anuncio_id: int,
    titulo: str = Form(..., min_length=1, max_length=60),
    descricao: str = Form(..., min_length=1, max_length=300),
    imagens_removidas: List[str] = Form([]),
    fotos: List[UploadFile] = File([]),
    usuario_id: int = Depends(obter_usuario_atual),
):
    titulo = titulo.strip()
    descricao = descricao.strip()

    conn = database.conectar()
    try:
        anuncio = buscar_anuncio_ou_404(conn, anuncio_id)
        exigir_dono(anuncio, usuario_id)

        # Só título, descrição e fotos são editáveis depois de publicado —
        # categoria, tipo, preço, telefone público e as tags de livro ficam
        # travados no valor original (preço só muda via oferta).
        conn.execute(
            "UPDATE anuncios SET titulo = ?, descricao = ? WHERE id = ?",
            (titulo, descricao, anuncio_id),
        )

        # Identifica a foto removida pelo caminho (não por id) — o
        # frontend já tem o caminho de cada foto existente (é o que
        # mostra na prévia), não precisa expor id nenhum pra isso. Só
        # remove foto que é de fato desse anúncio — confere o anuncio_id,
        # pra ninguém apagar foto de anúncio alheio só adivinhando o
        # caminho.
        for caminho in imagens_removidas:
            linha_imagem = conn.execute(
                "SELECT id FROM anuncio_imagens WHERE caminho_imagem = ? AND anuncio_id = ?",
                (caminho, anuncio_id),
            ).fetchone()
            if not linha_imagem:
                continue
            caminho_absoluto = DIR_ESTATICO / caminho.removeprefix("/static/")
            caminho_absoluto.unlink(missing_ok=True)
            conn.execute("DELETE FROM anuncio_imagens WHERE id = ?", (linha_imagem["id"],))

        restantes = len(buscar_imagens_anuncio(conn, anuncio_id))
        if restantes + len(fotos) > MAX_FOTOS_ANUNCIO:
            raise HTTPException(status_code=422, detail=f"no máximo {MAX_FOTOS_ANUNCIO} fotos por anúncio")

        for foto in fotos:
            caminho = await salvar_imagem_upload(foto, DIR_ANUNCIOS, "/static/uploads/anuncios")
            conn.execute(
                "INSERT INTO anuncio_imagens (anuncio_id, caminho_imagem, criado_em) VALUES (?, ?, ?)",
                (anuncio_id, caminho, datetime.now(timezone.utc).isoformat()),
            )

        # A capa pode ter sido removida — recalcula pra próxima foto que
        # sobrou (ou vazio, se não sobrou nenhuma).
        imagens_atuais = buscar_imagens_anuncio(conn, anuncio_id)
        conn.execute(
            "UPDATE anuncios SET imagem = ? WHERE id = ?",
            (imagens_atuais[0] if imagens_atuais else "", anuncio_id),
        )
        conn.commit()

        linha = conn.execute("SELECT * FROM anuncios WHERE id = ?", (anuncio_id,)).fetchone()
        resultado = linha_para_anuncio(linha)
        resultado["imagens"] = imagens_atuais
        return resultado
    finally:
        conn.close()


@app.put("/anuncios/{anuncio_id}/oferta")
def enviar_oferta(anuncio_id: int, dados: OfertaPreco, usuario_id: int = Depends(obter_usuario_atual)):
    conn = database.conectar()
    try:
        anuncio = buscar_anuncio_ou_404(conn, anuncio_id)
        exigir_dono(anuncio, usuario_id)

        if anuncio["tipo"] != "venda":
            raise HTTPException(status_code=400, detail="Só dá pra baixar o preço de itens à venda")

        if dados.preco_novo >= anuncio["preco"]:
            raise HTTPException(status_code=400, detail="A oferta precisa ser menor que o preço atual")

        criado_em = datetime.fromisoformat(anuncio["criado_em"])
        if datetime.now(timezone.utc) - criado_em < timedelta(hours=24):
            raise HTTPException(
                status_code=400,
                detail="A oferta só fica disponível 24h depois de o anúncio ser publicado",
            )

        # Guarda o preço de antes da primeira oferta, pra mostrar riscado
        # no card ("de R$ X por R$ Y") — só grava uma vez.
        preco_original = anuncio["preco_original"] if anuncio["preco_original"] is not None else anuncio["preco"]

        conn.execute(
            "UPDATE anuncios SET preco = ?, preco_original = ? WHERE id = ?",
            (dados.preco_novo, preco_original, anuncio_id),
        )
        conn.commit()

        linha = conn.execute("SELECT * FROM anuncios WHERE id = ?", (anuncio_id,)).fetchone()
        return linha_para_anuncio(linha)
    finally:
        conn.close()


@app.post("/anuncios/{anuncio_id}/denunciar", status_code=201)
def denunciar_anuncio(anuncio_id: int, dados: DenunciaCreate, usuario_id: int = Depends(obter_usuario_atual)):
    conn = database.conectar()
    try:
        buscar_anuncio_ou_404(conn, anuncio_id)

        conn.execute(
            "INSERT INTO denuncias (anuncio_id, usuario_id, motivo, criado_em) VALUES (?, ?, ?, ?)",
            (anuncio_id, usuario_id, dados.motivo, datetime.now(timezone.utc).isoformat()),
        )
        conn.commit()
    finally:
        conn.close()

    return {"ok": True}


# Painel de moderação — só quem tem is_admin=1 no banco enxerga isso. Não
# tem fluxo de "virar admin" pela própria API de propósito: é setado
# direto no banco, por segurança (ninguém vira admin sozinho).
@app.get("/admin/denuncias")
def listar_todas_denuncias(
    status: str = "ativa", usuario_id: int = Depends(exigir_admin)
):
    if status not in ("ativa", "solucionada"):
        raise HTTPException(status_code=422, detail="status deve ser 'ativa' ou 'solucionada'")

    conn = database.conectar()
    try:
        # LEFT JOIN (e não JOIN) de propósito: se o anúncio foi apagado ou o
        # dono não é um usuário real (dados de exemplo), a denúncia PRECISA
        # continuar aparecendo — com JOIN interno ela sumia silenciosamente,
        # justo no caso em que o admin mais precisa vê-la.
        linhas = conn.execute(
            """
            SELECT
                denuncias.id, denuncias.motivo, denuncias.criado_em,
                denuncias.status, denuncias.resolucao, denuncias.resolvido_em,
                denuncias.anuncio_id AS anuncio_id,
                anuncios.titulo AS anuncio_titulo,
                anuncios.user_id AS anuncio_dono_id,
                donos.nome AS anuncio_dono_nome,
                donos.banido AS anuncio_dono_banido,
                usuarios.id AS denunciante_id, usuarios.nome AS denunciante_nome
            FROM denuncias
            LEFT JOIN anuncios ON anuncios.id = denuncias.anuncio_id
            LEFT JOIN usuarios ON usuarios.id = denuncias.usuario_id
            LEFT JOIN usuarios AS donos ON donos.id = anuncios.user_id
            WHERE denuncias.status = ?
            ORDER BY denuncias.id DESC
            """,
            (status,),
        ).fetchall()

        return [
            {
                "id": l["id"],
                "motivo": l["motivo"],
                "criado_em": l["criado_em"],
                "status": l["status"],
                "resolucao": l["resolucao"],
                "resolvido_em": l["resolvido_em"],
                "anuncio_id": l["anuncio_id"],
                # anúncio apagado: sem título, mas a denúncia continua listada
                "anuncio_titulo": l["anuncio_titulo"],
                "anuncio_existe": l["anuncio_titulo"] is not None,
                "anuncio_dono_id": l["anuncio_dono_id"],
                "anuncio_dono_nome": l["anuncio_dono_nome"],
                "anuncio_dono_banido": bool(l["anuncio_dono_banido"]),
                "denunciante_id": l["denunciante_id"],
                "denunciante_nome": l["denunciante_nome"],
            }
            for l in linhas
        ]
    finally:
        conn.close()


def marcar_denuncias_resolvidas(conn, *, anuncio_id=None, dono_id=None, resolucao: str):
    """Fecha as denúncias ativas afetadas por uma providência do admin.
    Chamada ao remover um anúncio (as dele) ou banir alguém (as dos anúncios
    dessa pessoa) — assim elas saem de "ativas" e registram o que foi feito."""
    agora = datetime.now(timezone.utc).isoformat()
    if anuncio_id is not None:
        conn.execute(
            "UPDATE denuncias SET status='solucionada', resolucao=?, resolvido_em=?"
            " WHERE anuncio_id = ? AND status='ativa'",
            (resolucao, agora, anuncio_id),
        )
    if dono_id is not None:
        conn.execute(
            "UPDATE denuncias SET status='solucionada', resolucao=?, resolvido_em=?"
            " WHERE status='ativa' AND anuncio_id IN"
            " (SELECT id FROM anuncios WHERE user_id = ?)",
            (resolucao, agora, str(dono_id)),
        )


# ---------------------------------------------------------------------
# Importação de livros da API do Google Books
#
# Alimenta o catálogo de referência (tabelas autores/livros) que abastece o
# filtro de Autor. NÃO cria anúncios — anúncio continua sendo coisa de
# usuário; aqui só entram nomes e obras pra escolher na hora de anunciar.
# ---------------------------------------------------------------------
GOOGLE_BOOKS_URL = "https://www.googleapis.com/books/v1/volumes"


def extrair_livros(payload: dict) -> List[dict]:
    """Converte a resposta crua do Google Books numa lista simples.

    Separada da requisição de propósito: sem rede envolvida, dá pra testar o
    parsing com um payload salvo. Ignora volume sem título ou sem autor —
    esses não servem pro filtro, que é justamente por autor.
    """
    livros = []
    for item in payload.get("items", []):
        info = item.get("volumeInfo", {}) or {}
        titulo = (info.get("title") or "").strip()
        autores = info.get("authors") or []
        if not titulo or not autores:
            continue

        # publishedDate vem como "1999", "1999-05" ou "1999-05-20"; só o ano
        # interessa, e às vezes vem texto inesperado — daí o isdigit().
        ano_bruto = (info.get("publishedDate") or "")[:4]
        ano = int(ano_bruto) if ano_bruto.isdigit() else None

        # Prefere ISBN-13; cai pro 10 se for o único disponível.
        identificadores = {
            i.get("type"): i.get("identifier")
            for i in info.get("industryIdentifiers", []) or []
        }
        isbn = identificadores.get("ISBN_13") or identificadores.get("ISBN_10")

        for nome_autor in autores:
            nome_autor = (nome_autor or "").strip()
            if not nome_autor:
                continue
            livros.append({
                "autor": nome_autor,
                "titulo": titulo,
                "ano_publicacao": ano,
                "isbn": isbn,
                # id do volume: é o identificador estável do Google Books.
                # (O Google não expõe id próprio de autor — por isso
                # autores.id_externo fica nulo com essa fonte.)
                "id_externo": item.get("id"),
            })
    return livros


def buscar_livros_google(termo: str, limite: int) -> List[dict]:
    """Consulta a API externa e devolve os livros já normalizados.

    Rota síncrona de propósito: o FastAPI executa funções `def` num
    threadpool, então a espera da rede não trava o event loop.
    """
    try:
        resposta = requests.get(
            GOOGLE_BOOKS_URL,
            params={"q": termo, "maxResults": limite},
            timeout=15,
        )
    except requests.RequestException as erro:
        raise HTTPException(status_code=502, detail=f"Falha ao acessar a API de livros: {erro}")

    if resposta.status_code == 429:
        raise HTTPException(
            status_code=429,
            detail="A API de livros recusou por excesso de requisições. Tente de novo em instantes.",
        )
    if resposta.status_code != 200:
        raise HTTPException(
            status_code=502,
            detail=f"A API de livros respondeu {resposta.status_code}.",
        )

    try:
        return extrair_livros(resposta.json())
    except ValueError:
        raise HTTPException(status_code=502, detail="A API de livros devolveu um corpo inválido.")


def salvar_livros(conn, livros: List[dict]) -> dict:
    """Grava autores e livros sem duplicar. Devolve o resumo do que entrou."""
    agora = datetime.now(timezone.utc).isoformat()
    autores_novos = livros_novos = 0

    for livro in livros:
        # INSERT OR IGNORE + UNIQUE(nome): reimportar o mesmo autor não cria
        # linha nova. rowcount diz se realmente inseriu.
        cur = conn.execute(
            "INSERT OR IGNORE INTO autores (nome, id_externo, criado_em) VALUES (?, NULL, ?)",
            (livro["autor"], agora),
        )
        autores_novos += cur.rowcount

        autor_id = conn.execute(
            "SELECT id FROM autores WHERE nome = ?", (livro["autor"],)
        ).fetchone()["id"]

        # UNIQUE(autor_id, titulo) e UNIQUE(id_externo) barram a duplicata.
        cur = conn.execute(
            """
            INSERT OR IGNORE INTO livros
                (autor_id, titulo, ano_publicacao, isbn, id_externo, criado_em)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (autor_id, livro["titulo"], livro["ano_publicacao"],
             livro["isbn"], livro["id_externo"], agora),
        )
        livros_novos += cur.rowcount

    conn.commit()
    return {"autores_novos": autores_novos, "livros_novos": livros_novos}


@app.post("/admin/importar-livros")
def admin_importar_livros(dados: ImportarLivros, usuario_id: int = Depends(exigir_admin)):
    livros = buscar_livros_google(dados.termo, dados.limite)

    conn = database.conectar()
    try:
        resumo = salvar_livros(conn, livros)
    except sqlite3.Error as erro:
        conn.rollback()
        # Detalhe do banco fica só no log do servidor — a resposta é genérica,
        # pra não expor nome de tabela/coluna nem a mensagem interna do SQLite.
        print(f"[importar-livros] erro de banco: {erro}")
        raise HTTPException(status_code=500, detail="Erro ao gravar os livros no banco")
    finally:
        conn.close()

    return {
        "termo": dados.termo,
        "encontrados": len(livros),
        **resumo,
    }


@app.post("/admin/denuncias/{denuncia_id}/descartar")
def admin_descartar_denuncia(denuncia_id: int, usuario_id: int = Depends(exigir_admin)):
    """Averiguou e não era caso de punição: fecha a denúncia sem mexer no
    anúncio nem no usuário."""
    conn = database.conectar()
    try:
        denuncia = conn.execute("SELECT * FROM denuncias WHERE id = ?", (denuncia_id,)).fetchone()
        if not denuncia:
            raise HTTPException(status_code=404, detail="Denúncia não encontrada")

        conn.execute(
            "UPDATE denuncias SET status='solucionada', resolucao='descartada', resolvido_em=?"
            " WHERE id = ?",
            (datetime.now(timezone.utc).isoformat(), denuncia_id),
        )
        conn.commit()
        return {"ok": True, "status": "solucionada", "resolucao": "descartada"}
    finally:
        conn.close()


@app.delete("/admin/anuncios/{anuncio_id}", status_code=204)
def admin_remover_anuncio(anuncio_id: int, usuario_id: int = Depends(exigir_admin)):
    conn = database.conectar()
    try:
        buscar_anuncio_ou_404(conn, anuncio_id)
        # Fecha as denúncias ANTES do DELETE: depois de apagar o anúncio a
        # subconsulta por dono não acharia mais nada.
        marcar_denuncias_resolvidas(conn, anuncio_id=anuncio_id, resolucao="anuncio_removido")
        conn.execute("DELETE FROM anuncios WHERE id = ?", (anuncio_id,))
        conn.commit()
    finally:
        conn.close()


@app.post("/admin/usuarios/{usuario_alvo_id}/banir")
def admin_banir_usuario(usuario_alvo_id: int, usuario_id: int = Depends(exigir_admin)):
    conn = database.conectar()
    try:
        alvo = conn.execute("SELECT id FROM usuarios WHERE id = ?", (usuario_alvo_id,)).fetchone()
        if not alvo:
            raise HTTPException(status_code=404, detail="Usuário não encontrado")
        conn.execute("UPDATE usuarios SET banido = 1 WHERE id = ?", (usuario_alvo_id,))
        # Banir resolve todas as denúncias abertas contra os anúncios dessa
        # pessoa — não faz sentido continuarem pendentes de averiguação.
        marcar_denuncias_resolvidas(conn, dono_id=usuario_alvo_id, resolucao="usuario_banido")
        conn.commit()
    finally:
        conn.close()
    return {"ok": True}


# ---------------------------------------------------------------------
# Chat (conversas entre quem anuncia e quem se interessou)
# ---------------------------------------------------------------------
def linha_para_conversa(row, id_outro, nome_outro, foto_outro, ultima_mensagem, usuario_id):
    return {
        "id": row["id"],
        "anuncio_id": row["anuncio_id"],
        "anuncio_titulo": row["anuncio_titulo"],
        "anuncio_tipo": row["anuncio_tipo"],
        "sou_vendedor": row["vendedor_id"] == usuario_id,
        "outro_usuario": {"id": id_outro, "nome": nome_outro, "foto": foto_outro},
        "ultima_mensagem": ultima_mensagem,
    }


def exigir_participante(conversa_row, usuario_id: int):
    if usuario_id not in (conversa_row["comprador_id"], conversa_row["vendedor_id"]):
        raise HTTPException(status_code=403, detail="Você não faz parte dessa conversa")


@app.post("/anuncios/{anuncio_id}/chat", status_code=201)
def iniciar_conversa(anuncio_id: int, usuario_id: int = Depends(obter_usuario_atual)):
    conn = database.conectar()
    try:
        anuncio = buscar_anuncio_ou_404(conn, anuncio_id)
        vendedor_id = int(anuncio["user_id"])

        if vendedor_id == usuario_id:
            raise HTTPException(status_code=400, detail="Você não pode iniciar uma conversa com você mesmo")

        existente = conn.execute(
            "SELECT * FROM conversas WHERE anuncio_id = ? AND comprador_id = ?",
            (anuncio_id, usuario_id),
        ).fetchone()
        if existente:
            return {"id": existente["id"]}

        cursor = conn.execute(
            "INSERT INTO conversas (anuncio_id, comprador_id, vendedor_id, criado_em) VALUES (?, ?, ?, ?)",
            (anuncio_id, usuario_id, vendedor_id, datetime.now(timezone.utc).isoformat()),
        )
        conn.commit()
        return {"id": cursor.lastrowid}
    finally:
        conn.close()


# Contador do sininho de notificação. O "desde" é a data da última vez que a
# pessoa abriu o chat, guardada no próprio navegador — assim dá pra saber o que
# é novo sem precisar de coluna de "lido" no banco. Uma requisição só resolve
# os dois avisos (mensagem nova e venda aceita).
@app.get("/notificacoes")
def contar_notificacoes(desde: Optional[str] = None, usuario_id: int = Depends(obter_usuario_atual)):
    # Sem "desde" a pessoa nunca abriu o chat neste navegador: aí tudo que
    # ainda não foi lido conta (string vazia é menor que qualquer data ISO).
    desde = desde or ""

    conn = database.conectar()
    try:
        # Mensagens que a OUTRA pessoa mandou depois da última visita.
        mensagens = conn.execute(
            """
            SELECT COUNT(*) FROM mensagens
            JOIN conversas ON conversas.id = mensagens.conversa_id
            WHERE (conversas.comprador_id = ? OR conversas.vendedor_id = ?)
              AND mensagens.remetente_id != ?
              AND mensagens.criado_em > ?
            """,
            (usuario_id, usuario_id, usuario_id, desde),
        ).fetchone()[0]

        # Pedidos de confirmação de venda que o outro ACEITOU depois disso —
        # quem pediu é quem precisa ser avisado.
        vendas = conn.execute(
            """
            SELECT COUNT(*) FROM confirmacoes_venda
            JOIN conversas ON conversas.id = confirmacoes_venda.conversa_id
            WHERE confirmacoes_venda.solicitante_id = ?
              AND confirmacoes_venda.status = 'aceita'
              AND confirmacoes_venda.respondido_em > ?
            """,
            (usuario_id, desde),
        ).fetchone()[0]

        return {"mensagens": mensagens, "vendas_aceitas": vendas, "total": mensagens + vendas}
    finally:
        conn.close()


@app.get("/conversas")
def listar_conversas(usuario_id: int = Depends(obter_usuario_atual)):
    conn = database.conectar()
    try:
        linhas = conn.execute(
            """
            SELECT conversas.*, anuncios.titulo AS anuncio_titulo, anuncios.tipo AS anuncio_tipo,
                   (SELECT MAX(criado_em) FROM mensagens
                     WHERE mensagens.conversa_id = conversas.id) AS ultima_atividade
            FROM conversas
            JOIN anuncios ON anuncios.id = conversas.anuncio_id
            WHERE conversas.comprador_id = ? OR conversas.vendedor_id = ?
            -- Mais recentes primeiro: quem tem mensagem usa a data dela;
            -- conversa ainda sem mensagem cai pra data de criação.
            ORDER BY COALESCE(ultima_atividade, conversas.criado_em) DESC
            """,
            (usuario_id, usuario_id),
        ).fetchall()

        resultado = []
        for linha in linhas:
            outro_id = linha["vendedor_id"] if linha["comprador_id"] == usuario_id else linha["comprador_id"]
            outro = conn.execute("SELECT nome, foto FROM usuarios WHERE id = ?", (outro_id,)).fetchone()

            ultima = conn.execute(
                "SELECT texto, criado_em FROM mensagens WHERE conversa_id = ? ORDER BY id DESC LIMIT 1",
                (linha["id"],),
            ).fetchone()
            ultima_mensagem = {"texto": ultima["texto"], "criado_em": ultima["criado_em"]} if ultima else None

            resultado.append(
                linha_para_conversa(linha, outro_id, outro["nome"], outro["foto"], ultima_mensagem, usuario_id)
            )

        return resultado
    finally:
        conn.close()


@app.get("/conversas/{conversa_id}/mensagens")
def listar_mensagens(conversa_id: int, usuario_id: int = Depends(obter_usuario_atual)):
    conn = database.conectar()
    try:
        conversa = conn.execute("SELECT * FROM conversas WHERE id = ?", (conversa_id,)).fetchone()
        if not conversa:
            raise HTTPException(status_code=404, detail="Conversa não encontrada")
        exigir_participante(conversa, usuario_id)

        linhas = conn.execute(
            "SELECT * FROM mensagens WHERE conversa_id = ? ORDER BY id ASC", (conversa_id,)
        ).fetchall()
        return [
            {
                "id": l["id"],
                "remetente_id": l["remetente_id"],
                "texto": l["texto"],
                "imagem": l["imagem"],
                "criado_em": l["criado_em"],
                "minha": l["remetente_id"] == usuario_id,
            }
            for l in linhas
        ]
    finally:
        conn.close()


@app.post("/conversas/{conversa_id}/mensagens", status_code=201)
async def enviar_mensagem(
    conversa_id: int,
    # max_length no backend também (não só o maxlength do HTML, que a API
    # pulava): sem isso dava pra mandar uma mensagem de vários MB e inflar o banco.
    texto: Optional[str] = Form(None, max_length=1000),
    imagem: Optional[UploadFile] = File(None),
    usuario_id: int = Depends(obter_usuario_atual),
):
    if not texto and not imagem:
        raise HTTPException(status_code=422, detail="a mensagem precisa ter texto ou imagem")

    conn = database.conectar()
    try:
        conversa = conn.execute("SELECT * FROM conversas WHERE id = ?", (conversa_id,)).fetchone()
        if not conversa:
            raise HTTPException(status_code=404, detail="Conversa não encontrada")
        exigir_participante(conversa, usuario_id)

        imagem_caminho = None
        if imagem is not None:
            imagem_caminho = await salvar_imagem_upload(imagem, DIR_CHAT, "/static/uploads/chat")

        conn.execute(
            "INSERT INTO mensagens (conversa_id, remetente_id, texto, imagem, criado_em) VALUES (?, ?, ?, ?, ?)",
            (conversa_id, usuario_id, texto, imagem_caminho, datetime.now(timezone.utc).isoformat()),
        )
        conn.commit()
        return {"ok": True}
    finally:
        conn.close()


@app.get("/conversas/{conversa_id}/confirmar-venda")
def obter_confirmacao_venda(conversa_id: int, usuario_id: int = Depends(obter_usuario_atual)):
    conn = database.conectar()
    try:
        conversa = conn.execute("SELECT * FROM conversas WHERE id = ?", (conversa_id,)).fetchone()
        if not conversa:
            raise HTTPException(status_code=404, detail="Conversa não encontrada")
        exigir_participante(conversa, usuario_id)

        linha = conn.execute(
            "SELECT * FROM confirmacoes_venda WHERE conversa_id = ? ORDER BY id DESC LIMIT 1", (conversa_id,)
        ).fetchone()
        if not linha:
            return None

        return {
            "id": linha["id"],
            "solicitante_id": linha["solicitante_id"],
            "status": linha["status"],
            "minha_solicitacao": linha["solicitante_id"] == usuario_id,
        }
    finally:
        conn.close()


@app.post("/conversas/{conversa_id}/confirmar-venda/solicitar", status_code=201)
def solicitar_confirmacao_venda(conversa_id: int, usuario_id: int = Depends(obter_usuario_atual)):
    conn = database.conectar()
    try:
        conversa = conn.execute("SELECT * FROM conversas WHERE id = ?", (conversa_id,)).fetchone()
        if not conversa:
            raise HTTPException(status_code=404, detail="Conversa não encontrada")
        exigir_participante(conversa, usuario_id)

        # Só quem está vendendo (o dono do anúncio) pode pedir a confirmação
        # — quem compra só responde (aceita/recusa) quando o vendedor pede.
        if conversa["vendedor_id"] != usuario_id:
            raise HTTPException(status_code=403, detail="Só quem está vendendo pode pedir a confirmação")

        pendente = conn.execute(
            "SELECT id FROM confirmacoes_venda WHERE conversa_id = ? AND status = 'pendente'", (conversa_id,)
        ).fetchone()
        if pendente:
            raise HTTPException(status_code=400, detail="Já existe um pedido de confirmação pendente")

        conn.execute(
            "INSERT INTO confirmacoes_venda (conversa_id, solicitante_id, status, criado_em) VALUES (?, ?, 'pendente', ?)",
            (conversa_id, usuario_id, datetime.now(timezone.utc).isoformat()),
        )
        conn.commit()
        return {"ok": True}
    finally:
        conn.close()


@app.post("/conversas/{conversa_id}/confirmar-venda/responder")
def responder_confirmacao_venda(
    conversa_id: int, dados: ResponderConfirmacaoVenda, usuario_id: int = Depends(obter_usuario_atual)
):
    conn = database.conectar()
    try:
        conversa = conn.execute("SELECT * FROM conversas WHERE id = ?", (conversa_id,)).fetchone()
        if not conversa:
            raise HTTPException(status_code=404, detail="Conversa não encontrada")
        exigir_participante(conversa, usuario_id)

        pedido = conn.execute(
            "SELECT * FROM confirmacoes_venda WHERE conversa_id = ? AND status = 'pendente' ORDER BY id DESC LIMIT 1",
            (conversa_id,),
        ).fetchone()
        if not pedido:
            raise HTTPException(status_code=404, detail="Não há pedido de confirmação pendente")

        # Só quem RECEBEU o pedido pode responder — quem solicitou não
        # pode aceitar o próprio pedido.
        if pedido["solicitante_id"] == usuario_id:
            raise HTTPException(status_code=403, detail="Você não pode responder o próprio pedido")

        novo_status = "aceita" if dados.aceitar else "recusada"
        conn.execute(
            "UPDATE confirmacoes_venda SET status = ?, respondido_em = ? WHERE id = ?",
            (novo_status, datetime.now(timezone.utc).isoformat(), pedido["id"]),
        )

        if dados.aceitar:
            conn.execute(
                "UPDATE usuarios SET vendas_confirmadas = vendas_confirmadas + 1 WHERE id = ?",
                (conversa["vendedor_id"],),
            )
            conn.execute("UPDATE anuncios SET vendido = 1 WHERE id = ?", (conversa["anuncio_id"],))

        conn.commit()
        return {"ok": True, "status": novo_status}
    finally:
        conn.close()


@app.delete("/anuncios/{anuncio_id}", status_code=204)
def remover_anuncio(anuncio_id: int, usuario_id: int = Depends(obter_usuario_atual)):
    conn = database.conectar()
    try:
        anuncio = buscar_anuncio_ou_404(conn, anuncio_id)
        exigir_dono(anuncio, usuario_id)

        conn.execute("DELETE FROM anuncios WHERE id = ?", (anuncio_id,))
        conn.commit()
    finally:
        conn.close()
