"""
Acesso ao banco SQLite. Sem ORM de propósito: são só conexões e SQL puro,
mais fácil de acompanhar linha a linha do que uma camada de abstração.
"""

import json
import sqlite3
from datetime import datetime, timedelta, timezone
from pathlib import Path

DB_PATH = Path(__file__).parent / "desapego.db"


def conectar():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    conn = conectar()
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS usuarios (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            nome TEXT NOT NULL,
            email TEXT NOT NULL UNIQUE,
            senha_hash TEXT,
            telefone TEXT,
            foto TEXT,
            vendas_confirmadas INTEGER NOT NULL DEFAULT 0,
            criado_em TEXT NOT NULL
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS anuncios (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            titulo TEXT NOT NULL,
            descricao TEXT NOT NULL,
            categoria TEXT NOT NULL,
            tipo TEXT NOT NULL,
            preco REAL,
            preco_original REAL,
            imagem TEXT,
            curso TEXT,
            materia TEXT,
            autor TEXT,
            telefone_publico INTEGER NOT NULL DEFAULT 0,
            user_id TEXT NOT NULL,
            criado_em TEXT NOT NULL
        )
        """
    )
    # Fotos de anúncio normalizadas numa tabela própria (uma linha por
    # foto) em vez de um array serializado em JSON dentro de "anuncios" —
    # "imagem" na tabela anuncios continua existindo só como atalho de
    # performance pra listagens (capa), que nunca precisam da galeria
    # inteira, só do card.
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS anuncio_imagens (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            anuncio_id INTEGER NOT NULL,
            caminho_imagem TEXT NOT NULL,
            criado_em TEXT NOT NULL
        )
        """
    )
    # Códigos de verificação (2FA no login, confirmação de troca de senha).
    # "payload" guarda dado extra específico do propósito (ex: hash da nova
    # senha, pra só ser aplicado depois que o código for confirmado).
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS codigos_verificacao (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            usuario_id INTEGER NOT NULL,
            codigo TEXT NOT NULL,
            proposito TEXT NOT NULL,
            payload TEXT,
            criado_em TEXT NOT NULL,
            usado INTEGER NOT NULL DEFAULT 0
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS denuncias (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            anuncio_id INTEGER NOT NULL,
            usuario_id INTEGER NOT NULL,
            motivo TEXT NOT NULL,
            criado_em TEXT NOT NULL
        )
        """
    )
    # Catálogo de referência de livros, importado de uma API externa (Google
    # Books). NÃO são anúncios: servem só pra alimentar as listas de escolha
    # (hoje o filtro de Autor). Quem cria anúncio continua sendo o usuário, e
    # o anúncio guarda o NOME do autor, não o id daqui.
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS autores (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            nome TEXT NOT NULL UNIQUE,
            id_externo TEXT,
            criado_em TEXT NOT NULL
        )
        """
    )
    # Uma linha por par (autor, livro): um livro com 3 autores gera 3 linhas.
    # id_externo NÃO é único de propósito — ele identifica o VOLUME na API, e
    # o mesmo volume se repete uma vez por autor. Quem impede duplicata é o
    # UNIQUE(autor_id, titulo).
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS livros (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            autor_id INTEGER NOT NULL,
            titulo TEXT NOT NULL,
            ano_publicacao INTEGER,
            isbn TEXT,
            id_externo TEXT,
            criado_em TEXT NOT NULL,
            FOREIGN KEY (autor_id) REFERENCES autores(id) ON DELETE CASCADE,
            UNIQUE (autor_id, titulo)
        )
        """
    )
    # Busca por autor é o acesso mais comum (montar o filtro), então vale o índice.
    conn.execute("CREATE INDEX IF NOT EXISTS idx_livros_autor ON livros(autor_id)")

    # Bloqueio é por pessoa (não é banimento global) — quem bloqueia só
    # deixa de ver os anúncios de quem foi bloqueado, pro resto da
    # plataforma nada muda.
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS bloqueios (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            bloqueador_id INTEGER NOT NULL,
            bloqueado_id INTEGER NOT NULL,
            criado_em TEXT NOT NULL,
            UNIQUE(bloqueador_id, bloqueado_id)
        )
        """
    )
    # Uma conversa liga um anúncio a quem se interessou por ele — o dono
    # do anúncio é sempre o "vendedor". Só existe uma conversa por par
    # (anúncio, comprador), pra não duplicar quando a pessoa manda de novo.
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS conversas (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            anuncio_id INTEGER NOT NULL,
            comprador_id INTEGER NOT NULL,
            vendedor_id INTEGER NOT NULL,
            criado_em TEXT NOT NULL,
            UNIQUE(anuncio_id, comprador_id)
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS mensagens (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            conversa_id INTEGER NOT NULL,
            remetente_id INTEGER NOT NULL,
            texto TEXT,
            imagem TEXT,
            criado_em TEXT NOT NULL
        )
        """
    )
    # Pedido de confirmação de venda dentro de uma conversa: uma pessoa
    # solicita, a outra aceita ou recusa. Quando aceita, o vendedor ganha
    # +1 em "vendas confirmadas" — é a credibilidade que aparece no perfil
    # público dele.
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS confirmacoes_venda (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            conversa_id INTEGER NOT NULL,
            solicitante_id INTEGER NOT NULL,
            status TEXT NOT NULL DEFAULT 'pendente',
            criado_em TEXT NOT NULL,
            respondido_em TEXT
        )
        """
    )
    conn.commit()

    # Migração pra quem já tinha o banco criado antes da coluna telefone
    # existir — SQLite não tem "ADD COLUMN IF NOT EXISTS", então tenta e
    # ignora o erro se a coluna já existir.
    try:
        conn.execute("ALTER TABLE usuarios ADD COLUMN telefone TEXT")
        conn.commit()
    except sqlite3.OperationalError:
        pass
    try:
        conn.execute("ALTER TABLE usuarios ADD COLUMN foto TEXT")
        conn.commit()
    except sqlite3.OperationalError:
        pass
    try:
        conn.execute("ALTER TABLE anuncios ADD COLUMN preco_original REAL")
        conn.commit()
    except sqlite3.OperationalError:
        pass
    try:
        conn.execute("ALTER TABLE anuncios ADD COLUMN telefone_publico INTEGER NOT NULL DEFAULT 0")
        conn.commit()
    except sqlite3.OperationalError:
        pass
    try:
        conn.execute("ALTER TABLE usuarios ADD COLUMN vendas_confirmadas INTEGER NOT NULL DEFAULT 0")
        conn.commit()
    except sqlite3.OperationalError:
        pass
    # "fechada" existiu enquanto aceitar a confirmação de venda encerrava a
    # conversa — deixou de fazer sentido quando isso mudou (aceitar hoje só
    # credita a venda e marca o anúncio como vendido, o chat continua
    # aberto). SQLite 3.35+ suporta DROP COLUMN direto.
    try:
        conn.execute("ALTER TABLE conversas DROP COLUMN fechada")
        conn.commit()
    except sqlite3.OperationalError:
        pass
    try:
        conn.execute("ALTER TABLE mensagens ADD COLUMN imagem TEXT")
        conn.commit()
    except sqlite3.OperationalError:
        pass
    # Denúncia agora tem ciclo de vida: nasce "ativa" e vira "solucionada"
    # quando o admin descarta, remove o anúncio ou bane o dono. As antigas
    # entram como ativas (DEFAULT), que é o comportamento anterior.
    try:
        conn.execute("ALTER TABLE denuncias ADD COLUMN status TEXT NOT NULL DEFAULT 'ativa'")
        conn.commit()
    except sqlite3.OperationalError:
        pass
    try:
        conn.execute("ALTER TABLE denuncias ADD COLUMN resolvido_em TEXT")
        conn.commit()
    except sqlite3.OperationalError:
        pass
    # Guarda COMO foi resolvida: 'descartada', 'anuncio_removido' ou
    # 'usuario_banido' — o admin precisa ver qual providência foi tomada.
    try:
        conn.execute("ALTER TABLE denuncias ADD COLUMN resolucao TEXT")
        conn.commit()
    except sqlite3.OperationalError:
        pass
    # Quem já tinha o banco com o array antigo em "anuncios.imagens" (JSON)
    # tem os dados migrados pra anuncio_imagens antes da coluna ser
    # derrubada — senão perde foto de anúncio já publicado. Só roda se a
    # coluna antiga ainda existir (banco novo nunca chega a ter ela).
    colunas_anuncios = [c[1] for c in conn.execute("PRAGMA table_info(anuncios)").fetchall()]
    if "imagens" in colunas_anuncios:
        for linha in conn.execute("SELECT id, imagens FROM anuncios WHERE imagens IS NOT NULL"):
            for caminho in json.loads(linha["imagens"] or "[]"):
                conn.execute(
                    "INSERT INTO anuncio_imagens (anuncio_id, caminho_imagem, criado_em) VALUES (?, ?, ?)",
                    (linha["id"], caminho, datetime.now(timezone.utc).isoformat()),
                )
        conn.commit()
        try:
            conn.execute("ALTER TABLE anuncios DROP COLUMN imagens")
            conn.commit()
        except sqlite3.OperationalError:
            pass
    try:
        conn.execute("ALTER TABLE anuncios ADD COLUMN vendido INTEGER NOT NULL DEFAULT 0")
        conn.commit()
    except sqlite3.OperationalError:
        pass
    try:
        conn.execute("ALTER TABLE usuarios ADD COLUMN curso TEXT")
        conn.commit()
    except sqlite3.OperationalError:
        pass
    try:
        conn.execute("ALTER TABLE usuarios ADD COLUMN turno TEXT")
        conn.commit()
    except sqlite3.OperationalError:
        pass
    try:
        conn.execute("ALTER TABLE usuarios ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0")
        conn.commit()
    except sqlite3.OperationalError:
        pass
    try:
        conn.execute("ALTER TABLE usuarios ADD COLUMN banido INTEGER NOT NULL DEFAULT 0")
        conn.commit()
    except sqlite3.OperationalError:
        pass

    # A primeira versão de "livros" tinha UNIQUE em id_externo. Como esse id é
    # do VOLUME e um volume pode ter vários autores, o 2º autor era descartado
    # em silêncio. SQLite não remove constraint: recria a tabela e copia.
    linha = conn.execute(
        "SELECT sql FROM sqlite_master WHERE type='table' AND name='livros'"
    ).fetchone()
    if linha and "id_externo TEXT UNIQUE" in linha[0]:
        conn.executescript(
            """
            ALTER TABLE livros RENAME TO livros_antiga;
            CREATE TABLE livros (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                autor_id INTEGER NOT NULL,
                titulo TEXT NOT NULL,
                ano_publicacao INTEGER,
                isbn TEXT,
                id_externo TEXT,
                criado_em TEXT NOT NULL,
                FOREIGN KEY (autor_id) REFERENCES autores(id) ON DELETE CASCADE,
                UNIQUE (autor_id, titulo)
            );
            INSERT INTO livros (id, autor_id, titulo, ano_publicacao, isbn, id_externo, criado_em)
                SELECT id, autor_id, titulo, ano_publicacao, isbn, id_externo, criado_em
                FROM livros_antiga;
            DROP TABLE livros_antiga;
            CREATE INDEX IF NOT EXISTS idx_livros_autor ON livros(autor_id);
            """
        )
        conn.commit()

    total = conn.execute("SELECT COUNT(*) FROM anuncios").fetchone()[0]
    if total == 0:
        _seed(conn)

    _semear_autores_iniciais(conn)

    conn.close()


def _semear_autores_iniciais(conn):
    """Leva a lista fixa de autores pra dentro da tabela. Sem isso, ao trocar
    o filtro pra ler do banco, os autores dos anúncios que já existem
    sumiriam das opções até alguém importar da API."""
    from schemas import AUTORES  # import local: evita ciclo entre os módulos

    agora = datetime.now(timezone.utc).isoformat()
    for nome in AUTORES:
        conn.execute(
            "INSERT OR IGNORE INTO autores (nome, id_externo, criado_em) VALUES (?, NULL, ?)",
            (nome, agora),
        )
    conn.commit()


def _seed(conn):
    agora = datetime.now(timezone.utc)

    exemplos = [
        dict(
            titulo="Cálculo Vol. 1 (Stewart)",
            descricao="Usado, com algumas anotações a lápis. Ótimo para quem está começando.",
            categoria="Livros", tipo="doacao", preco=None, imagem="",
            curso=["Engenharia"], materia=["Cálculo I"], autor=["James Stewart"],
        ),
        dict(
            titulo="Introdução à Programação",
            descricao="Livro-texto usado no primeiro semestre, poucas marcações.",
            categoria="Livros", tipo="venda", preco=60, imagem="",
            curso=["Ciência da Computação", "Engenharia de Software"],
            materia=["Algoritmos"], autor=["Fernanda Reges"],
        ),
        dict(
            titulo="Calculadora HP 12C",
            descricao="Funcionando perfeitamente, pouco uso.",
            categoria="Calculadoras", tipo="venda", preco=120, imagem="",
            curso=[], materia=[], autor=[],
        ),
        dict(
            titulo="Jaleco branco tamanho M",
            descricao="Usei só um semestre, sem manchas.",
            categoria="Outros", tipo="doacao", preco=None, imagem="",
            curso=[], materia=[], autor=[],
        ),
        dict(
            titulo="Mesa dobrável para notebook",
            descricao="Ideal para estudar na cama ou no quarto pequeno.",
            categoria="Móveis", tipo="venda", preco=45, imagem="",
            curso=[], materia=[], autor=[],
        ),
    ]

    for i, item in enumerate(exemplos):
        criado_em = (agora - timedelta(hours=i)).isoformat()
        conn.execute(
            """
            INSERT INTO anuncios
                (titulo, descricao, categoria, tipo, preco, imagem, curso, materia, autor, user_id, criado_em)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                item["titulo"], item["descricao"], item["categoria"], item["tipo"],
                item["preco"], item["imagem"],
                json.dumps(item["curso"]), json.dumps(item["materia"]), json.dumps(item["autor"]),
                "seed", criado_em,
            ),
        )
    conn.commit()
