"""
Limitador de tentativas simples, em memória (sem Redis nem dependência
externa). Serve para frear força bruta nas rotas sensíveis: adivinhar senha no
login e adivinhar o código de 6 dígitos do 2FA / recuperação de senha.

Guarda, por chave (ex.: "login:IP"), os horários das tentativas recentes e
bloqueia quando passa do teto dentro da janela. É proposital ser em memória:
zera quando o servidor reinicia e é suficiente para um app deste porte. Para
vários processos/servidores seria preciso algo compartilhado (ex.: Redis).
"""

import time
from collections import defaultdict

from fastapi import HTTPException, Request

_tentativas: dict[str, list[float]] = defaultdict(list)


def ip_do_cliente(request: Request) -> str:
    return request.client.host if request.client else "desconhecido"


def limitar(chave: str, maximo: int, janela_segundos: int):
    """Registra uma tentativa para `chave`. Se já houve `maximo` tentativas
    dentro dos últimos `janela_segundos`, levanta 429 (Too Many Requests)."""
    agora = time.time()
    recentes = [t for t in _tentativas[chave] if agora - t < janela_segundos]
    if len(recentes) >= maximo:
        raise HTTPException(
            status_code=429,
            detail="Muitas tentativas. Espere alguns minutos e tente de novo.",
        )
    recentes.append(agora)
    _tentativas[chave] = recentes
