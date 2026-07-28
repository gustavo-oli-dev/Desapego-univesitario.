"""
Autenticação: hash de senha (PBKDF2, só biblioteca padrão do Python — sem
dependência extra), token JWT pra manter o usuário logado entre requisições,
e verificação do login com Google.

A chave secreta que assina os tokens vem do config (variável de ambiente ou
chave aleatória local), nunca fixa no código — ver backend/config.py.
"""

import hashlib
import hmac
import os
import secrets
import time
from typing import Optional

import jwt
from fastapi import Header, HTTPException
from google.auth.transport import requests as google_requests
from google.oauth2 import id_token as google_id_token

import config

SECRET_KEY = config.obter_secret_key()
ALGORITMO = "HS256"
VALIDADE_TOKEN_SEGUNDOS = 60 * 60 * 24 * 7  # 7 dias
VALIDADE_TOKEN_PENDENTE_SEGUNDOS = 60 * 10  # 10 minutos pra confirmar o código

GOOGLE_CLIENT_ID = "405533925967-69q034a54g2t1chbfjvbkghb5bbfu5vj.apps.googleusercontent.com"


def gerar_hash_senha(senha: str) -> str:
    salt = os.urandom(16)
    hash_bytes = hashlib.pbkdf2_hmac("sha256", senha.encode(), salt, 100_000)
    return f"{salt.hex()}${hash_bytes.hex()}"


def verificar_senha(senha: str, hash_salvo: Optional[str]) -> bool:
    if not hash_salvo:
        return False  # conta criada via Google, não tem senha cadastrada
    salt_hex, hash_hex = hash_salvo.split("$")
    salt = bytes.fromhex(salt_hex)
    hash_calculado = hashlib.pbkdf2_hmac("sha256", senha.encode(), salt, 100_000)
    return hmac.compare_digest(hash_calculado.hex(), hash_hex)


def verificar_token_google(token: str) -> dict:
    """Valida o token (JWT) que o botão do Google devolve pro frontend e
    confirma que foi emitido pro NOSSO Client ID. Levanta HTTPException se
    o token for inválido, expirado ou de outro app."""
    try:
        return google_id_token.verify_oauth2_token(
            token, google_requests.Request(), GOOGLE_CLIENT_ID
        )
    except ValueError:
        raise HTTPException(status_code=401, detail="Token do Google inválido")


def gerar_token(usuario_id: int) -> str:
    payload = {
        "sub": str(usuario_id),
        # "tipo" separa o token de sessão de verdade do token de 2FA pendente
        # (que também é um JWT válido). obter_usuario_atual só aceita "sessao",
        # senão o token do passo intermediário do login já daria acesso total.
        "tipo": "sessao",
        "exp": int(time.time()) + VALIDADE_TOKEN_SEGUNDOS,
    }
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITMO)


def gerar_codigo_verificacao() -> str:
    return f"{secrets.randbelow(1_000_000):06d}"


def gerar_token_pendente_2fa(usuario_id: int) -> str:
    """Token de curta duração emitido logo após email+senha corretos, antes
    do código de verificação ser confirmado. Não serve pra acessar rotas
    protegidas — só pra provar, no passo seguinte, que o email/senha já
    foram validados."""
    payload = {
        "sub": str(usuario_id),
        "tipo": "2fa_pendente",
        "exp": int(time.time()) + VALIDADE_TOKEN_PENDENTE_SEGUNDOS,
    }
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITMO)


def validar_token_pendente_2fa(token: str) -> int:
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITMO])
    except jwt.PyJWTError:
        raise HTTPException(status_code=401, detail="Sessão de verificação expirada, faça login novamente")

    if payload.get("tipo") != "2fa_pendente":
        raise HTTPException(status_code=401, detail="Token inválido para essa etapa")

    return int(payload["sub"])


def obter_usuario_atual(authorization: Optional[str] = Header(None)) -> int:
    """Dependency do FastAPI: lê o header Authorization: Bearer <token>,
    valida o JWT e devolve o id do usuário logado. Usado nas rotas que só
    fazem sentido pra quem está autenticado (criar/editar/remover anúncio)."""
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Faça login para continuar")

    token = authorization.removeprefix("Bearer ")
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITMO])
    except jwt.PyJWTError:
        raise HTTPException(status_code=401, detail="Sessão inválida ou expirada, faça login novamente")

    # Só token de sessão vale aqui. O token de 2FA pendente (tipo="2fa_pendente"),
    # emitido logo após email+senha e ANTES do código, é um JWT válido — mas não
    # pode servir de sessão, senão o 2FA não bloquearia nada.
    if payload.get("tipo") != "sessao":
        raise HTTPException(status_code=401, detail="Sessão inválida ou expirada, faça login novamente")

    usuario_id = int(payload["sub"])

    # Checa a cada requisição (não só no login) pra um banimento derrubar
    # sessões já ativas na hora, sem precisar o token expirar sozinho.
    import database
    conn = database.conectar()
    linha = conn.execute("SELECT banido FROM usuarios WHERE id = ?", (usuario_id,)).fetchone()
    conn.close()
    if linha and linha["banido"]:
        raise HTTPException(status_code=403, detail="Sua conta foi banida da plataforma")

    return usuario_id


def obter_usuario_atual_opcional(authorization: Optional[str] = Header(None)) -> Optional[int]:
    """Igual obter_usuario_atual, mas devolve None em vez de dar 401 quando
    não há sessão — usado no catálogo público, que qualquer um pode ver,
    mas que filtra usuários bloqueados quando dá pra saber quem está
    olhando."""
    if not authorization or not authorization.startswith("Bearer "):
        return None
    try:
        return obter_usuario_atual(authorization)
    except HTTPException:
        return None
