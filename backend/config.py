"""
Configuração central: carrega o arquivo backend/.env para as variáveis de
ambiente (sem depender de biblioteca externa) e resolve a chave secreta usada
para assinar os tokens JWT.

Por que existir: a SECRET_KEY não pode mais ficar fixa no código — quem visse
o repositório conseguiria forjar um token de qualquer usuário. Agora ela vem
de uma variável de ambiente (produção) ou de uma chave aleatória gerada uma
única vez e guardada localmente, fora do Git (desenvolvimento).
"""

import os
import secrets
from pathlib import Path

_DIR = Path(__file__).parent


def carregar_env():
    """Lê backend/.env (KEY=VALOR por linha) para as variáveis de ambiente. Não
    sobrescreve o que já existe no ambiente (variável de verdade tem prioridade)."""
    caminho = _DIR / ".env"
    if not caminho.exists():
        return
    for linha in caminho.read_text().splitlines():
        linha = linha.strip()
        if not linha or linha.startswith("#") or "=" not in linha:
            continue
        chave, valor = linha.split("=", 1)
        os.environ.setdefault(chave.strip(), valor.strip().strip('"').strip("'"))


def obter_secret_key() -> str:
    """Chave que assina os tokens JWT. Ordem de preferência:
    1) variável de ambiente SECRET_KEY (o jeito certo em produção — no .env);
    2) uma chave aleatória gerada uma vez e guardada em backend/.secret_key
       (fica fora do Git). Persistir num arquivo evita deslogar todo mundo a
       cada reinício, e nunca expõe a chave no código-fonte."""
    chave = os.environ.get("SECRET_KEY")
    if chave:
        return chave

    caminho = _DIR / ".secret_key"
    if caminho.exists():
        return caminho.read_text().strip()

    chave = secrets.token_hex(32)
    caminho.write_text(chave)
    return chave


carregar_env()
