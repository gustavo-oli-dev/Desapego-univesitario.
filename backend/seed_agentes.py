"""
Popula o banco com 20 "agentes" (estudantes fictícios) e anúncios realistas,
com fotos reais. Idempotente: agentes e anúncios já criados são pulados, então
pode rodar quantas vezes quiser.

    venv/bin/python seed_agentes.py

As fotos vêm de seed_fotos/ (versionadas no repositório, nomeadas pelo título
do anúncio) — nada é baixado da internet. Isso importa no deploy: o disco do
Render free é efêmero, então o seed roda a cada boot da instância, e depender
de rede ali deixaria a subida lenta e sujeita a falha de API de terceiro.
"""
import sqlite3, os, json, random, shutil, unicodedata
from datetime import datetime, timezone, timedelta
from pathlib import Path

import database

random.seed(42)
# Caminhos presos ao arquivo, não ao diretório de onde se roda o script: é o
# mesmo critério do database.py, e evita o seed gravar num banco diferente do
# que a API usa quando o processo sobe de outra pasta.
BASE = Path(__file__).parent
DB = BASE / "desapego.db"
DIR = BASE / "static" / "uploads" / "anuncios"
DIR_FOTOS_SEED = BASE / "seed_fotos"
DIR.mkdir(parents=True, exist_ok=True)
SENHA_PADRAO = "senha123"   # todos os agentes usam a mesma senha (facilita testar)


def hash_senha(senha: str) -> str:
    import hashlib
    salt = os.urandom(16)
    h = hashlib.pbkdf2_hmac("sha256", senha.encode(), salt, 100_000)
    return f"{salt.hex()}${h.hex()}"


def slug(txt: str) -> str:
    t = unicodedata.normalize("NFKD", txt).encode("ascii", "ignore").decode()
    return "".join(ch if ch.isalnum() else "-" for ch in t.lower()).strip("-")


def foto_do_anuncio(titulo: str, nome_arquivo: str):
    """Copia a foto versionada em seed_fotos/ para a pasta de uploads e devolve
    o caminho que vai no banco. As fotos são nomeadas pelo título do anúncio
    (slug), então cada item recebe exatamente a imagem que combina com ele.
    Devolve None se não houver foto — nesse caso o card cai no ícone da
    categoria, que já é o comportamento padrão do frontend."""
    origem = DIR_FOTOS_SEED / f"{slug(titulo)}.jpg"
    if not origem.exists():
        return None
    shutil.copy2(origem, DIR / nome_arquivo)
    return f"/static/uploads/anuncios/{nome_arquivo}"


# --- 20 agentes (nome, curso, turno) ---------------------------------------
AGENTES = [
    ("Marina Albuquerque", "Ciência da Computação", "Noite"),
    ("Rafael Nogueira", "Engenharia Civil", "Manhã"),
    ("Beatriz Fontenele", "Medicina", "Integral"),
    ("Lucas Bezerra", "Análise e Desenvolvimento de Sistemas", "Noite"),
    ("Camila Rocha", "Direito", "Manhã"),
    ("Thiago Menezes", "Engenharia de Produção", "Tarde"),
    ("Larissa Pontes", "Arquitetura e Urbanismo", "Integral"),
    ("Gabriel Studart", "Administração", "Noite"),
    ("Ana Luiza Vasconcelos", "Psicologia", "Tarde"),
    ("Pedro Henrique Lima", "Engenharia Mecânica", "Manhã"),
    ("Isabela Cavalcante", "Nutrição", "Manhã"),
    ("Vinícius Tavares", "Ciências Contábeis", "Noite"),
    ("Letícia Moreira", "Enfermagem", "Integral"),
    ("Matheus Oliveira", "Engenharia Elétrica", "Tarde"),
    ("Júlia Sampaio", "Odontologia", "Integral"),
    ("Daniel Carvalho", "Ciência da Computação", "Manhã"),
    ("Fernanda Girão", "Fisioterapia", "Tarde"),
    ("Bruno Aguiar", "Engenharia de Software", "Noite"),
    ("Sofia Machado", "Publicidade e Propaganda", "Manhã"),
    ("Enzo Ribeiro", "Sistemas de Informação", "Noite"),
]

# --- catálogo de itens por categoria (título, descrição, keyword da foto) ---
# tipo: "venda" ou "doacao"; para Livros vai autor/materia junto.
ITENS = {
    "Livros": [
        ("Cálculo Volume 1 — James Stewart", "7ª edição, usado mas bem conservado, sem rabiscos. Perfeito pra Cálculo I e II.", "venda", 90.0, "book", "James Stewart", "Cálculo I"),
        ("Código Limpo — Robert C. Martin", "Clássico de boas práticas de programação. Capa dura, como novo.", "venda", 60.0, "book", "Robert C. Martin", "Programação"),
        ("Algoritmos — Cormen (CLRS)", "O 'livro grande' de algoritmos. Um pouco pesado mas indispensável.", "venda", 120.0, "textbook", "Thomas H. Cormen", "Estrutura de Dados"),
        ("Anatomia Humana Básica", "Livro de anatomia com ilustrações coloridas. Ideal pra área da saúde.", "venda", 85.0, "book", "Fernanda Reges", "Anatomia"),
        ("Direito Constitucional Esquematizado", "Edição atualizada. Uso na faculdade de Direito, passando adiante.", "doacao", 0.0, "book", "Fernanda Reges", "Direito"),
    ],
    "Eletrônicos": [
        ("Notebook Dell Inspiron 15", "i5, 8GB RAM, SSD 256GB. Bateria segura umas 4h. Ótimo pra estudar e programar.", "venda", 1450.0, "laptop", None, None),
        ("Fone Bluetooth JBL", "Som ótimo, uso pouco. Acompanha o cabo e a caixinha.", "venda", 120.0, "headphones", None, None),
        ("Monitor LG 24 polegadas", "Full HD, sem defeito de pixel. Melhora demais pra quem programa.", "venda", 480.0, "monitor", None, None),
        ("Mouse sem fio Logitech", "Silencioso, pilha dura meses. Passando pra frente.", "venda", 55.0, "computer-mouse", None, None),
    ],
    "Calculadoras": [
        ("Calculadora HP 12C", "A financeira clássica. Funcionando 100%, ideal pra Contábeis/Administração.", "venda", 180.0, "calculator", None, None),
        ("Calculadora Científica Casio fx-82", "Usei em Cálculo e Física, sem arranhões. Todas as funções ok.", "venda", 45.0, "calculator", None, None),
    ],
    "Material de Estudo": [
        ("Kit de cadernos universitários", "3 cadernos 10 matérias, pouco usados (sobrou do semestre).", "doacao", 0.0, "stationery", None, None),
        ("Jogo de canetas e marcadores", "Marca-texto de várias cores + canetas. Ótimo pra resumo.", "venda", 25.0, "stationery", None, None),
    ],
    "Móveis": [
        ("Mesa dobrável para notebook", "Prática pra estudar na cama ou no sofá. Regula altura.", "venda", 70.0, "desk", None, None),
        ("Cadeira de escritório", "Confortável, com regulagem. Sinais leves de uso.", "venda", 160.0, "office-chair", None, None),
        ("Estante de livros pequena", "3 prateleiras, MDF branco. Desmonta fácil pra transporte.", "venda", 90.0, "bookshelf", None, None),
    ],
    "Vestimentas": [
        ("Jaleco branco tamanho M", "Usado só 1 semestre. Lavado e sem manchas. Área da saúde.", "venda", 40.0, "labcoat", None, None),
        ("Tênis esportivo nº 40", "Confortável pra ir e voltar da facul. Bem conservado.", "venda", 80.0, "sneakers", None, None),
    ],
    "Outros": [
        ("Mochila para notebook", "Compartimento acolchoado, resistente a chuva. Muito espaço.", "venda", 75.0, "backpack", None, None),
        ("Garrafa térmica", "Mantém gelado o dia todo. Ótima pra levar pra facul.", "doacao", 0.0, "water-bottle", None, None),
    ],
}


def main():
    # Garante as tabelas: no deploy o seed roda ANTES da API subir, então o
    # banco pode nem existir ainda. init_db é idempotente (CREATE IF NOT EXISTS).
    database.init_db()

    conn = sqlite3.connect(DB)
    conn.row_factory = sqlite3.Row
    agora = datetime.now(timezone.utc)

    # 1) cria os agentes (pula os que já existem pelo email)
    ids_agentes = {}
    for i, (nome, curso, turno) in enumerate(AGENTES):
        primeiro = slug(nome.split()[0])
        ultimo = slug(nome.split()[-1])
        email = f"{primeiro}.{ultimo}@edu.unifor.br"
        existente = conn.execute("SELECT id FROM usuarios WHERE email=?", (email,)).fetchone()
        if existente:
            ids_agentes[i] = existente["id"]
            continue
        criado = (agora - timedelta(days=random.randint(20, 120))).isoformat()
        cur = conn.execute(
            """INSERT INTO usuarios (nome,email,senha_hash,criado_em,telefone,foto,
               vendas_confirmadas,curso,turno,is_admin,banido)
               VALUES (?,?,?,?,?,?,?,?,?,0,0)""",
            (nome, email, hash_senha(SENHA_PADRAO), criado,
             f"(85) 9{random.randint(1000,9999)}-{random.randint(1000,9999)}",
             None, random.randint(0, 8), curso, turno),
        )
        ids_agentes[i] = cur.lastrowid
    conn.commit()
    print(f"agentes prontos: {len(ids_agentes)}")

    # 2) monta a lista de anúncios: distribui itens entre os agentes
    todos_itens = []
    for categoria, itens in ITENS.items():
        for it in itens:
            todos_itens.append((categoria, it))
    random.shuffle(todos_itens)

    agentes_ids = list(ids_agentes.values())
    n_criados = 0
    for idx, (categoria, it) in enumerate(todos_itens):
        titulo, descricao, tipo, preco, keyword = it[0], it[1], it[2], it[3], it[4]
        autor = it[5] if len(it) > 5 else None
        materia = it[6] if len(it) > 6 else None
        dono = agentes_ids[idx % len(agentes_ids)]

        # já existe um anúncio com esse título? (idempotência)
        if conn.execute("SELECT 1 FROM anuncios WHERE titulo=?", (titulo,)).fetchone():
            continue

        caminho = foto_do_anuncio(titulo, f"agente-{slug(titulo)[:40]}-{idx}.jpg")
        print(f"  [{idx+1}/{len(todos_itens)}] {titulo[:38]:<38} {'com foto' if caminho else 'sem foto'}")

        curso_json = json.dumps([conn.execute("SELECT curso FROM usuarios WHERE id=?", (dono,)).fetchone()["curso"]]) if categoria == "Livros" else "[]"
        materia_json = json.dumps([materia]) if materia else "[]"
        autor_json = json.dumps([autor]) if autor else "[]"
        criado = (agora - timedelta(days=random.randint(0, 25), hours=random.randint(0, 23))).isoformat()

        cur = conn.execute(
            """INSERT INTO anuncios (titulo,descricao,categoria,tipo,preco,imagem,curso,
               materia,autor,user_id,criado_em,preco_original,telefone_publico,vendido)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,0)""",
            (titulo, descricao, categoria, tipo, preco, caminho or "", curso_json,
             materia_json, autor_json, str(dono), criado, None,
             random.choice([0, 1])),
        )
        anuncio_id = cur.lastrowid
        if caminho:
            conn.execute(
                "INSERT INTO anuncio_imagens (anuncio_id,caminho_imagem,criado_em) VALUES (?,?,?)",
                (anuncio_id, caminho, criado),
            )
        n_criados += 1
    conn.commit()
    print(f"\nanúncios criados: {n_criados}")
    print("total usuários:", conn.execute("SELECT COUNT(*) FROM usuarios").fetchone()[0])
    print("total anúncios:", conn.execute("SELECT COUNT(*) FROM anuncios").fetchone()[0])
    print("com foto:", conn.execute("SELECT COUNT(*) FROM anuncios WHERE imagem!=''").fetchone()[0])
    conn.close()


if __name__ == "__main__":
    main()
