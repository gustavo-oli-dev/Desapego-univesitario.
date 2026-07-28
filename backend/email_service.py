"""
Envio dos códigos de verificação por email (2FA de login, recuperar senha,
trocar senha). Lê as credenciais SMTP do arquivo .env (na pasta backend/).

Se NÃO houver credencial configurada, enviar_codigo_email() devolve False e o
backend cai no "modo demo": mostra o código na própria tela (como era antes).
Assim o app funciona sem configurar nada, e passa a mandar email de verdade
assim que você preencher o .env — sem mexer no resto do código.

Como configurar (Gmail):
  1. Ative a verificação em 2 etapas na sua conta Google.
  2. Gere uma "Senha de app" em https://myaccount.google.com/apppasswords
  3. Crie backend/.env com:
       EMAIL_REMETENTE=seuemail@gmail.com
       EMAIL_SENHA_APP=a-senha-de-app-de-16-letras
"""
import os
import smtplib
import ssl
from email.message import EmailMessage

import config  # carrega o backend/.env para as variáveis de ambiente no import

REMETENTE = os.environ.get("EMAIL_REMETENTE", "")
SENHA_APP = os.environ.get("EMAIL_SENHA_APP", "")
SMTP_HOST = os.environ.get("EMAIL_SMTP_HOST", "smtp.gmail.com")
SMTP_PORTA = int(os.environ.get("EMAIL_SMTP_PORTA", "587"))
NOME_APP = "Desapego Universitário"

_ASSUNTOS = {
    "login_2fa": "Seu código de acesso",
    "recuperar_senha": "Recuperação de senha",
    "trocar_senha": "Confirmação de troca de senha",
}


def email_configurado() -> bool:
    """True se há remetente + senha de app no .env — só então enviamos de verdade."""
    return bool(REMETENTE and SENHA_APP)


def enviar_codigo_email(destinatario: str, nome: str, codigo: str, proposito: str) -> bool:
    """Envia o código por email. Devolve True se mandou, False se não há
    credencial ou o envio falhou (o backend então mostra o código na tela)."""
    if not email_configurado():
        return False

    assunto = _ASSUNTOS.get(proposito, "Seu código de verificação")
    corpo = (
        f"Olá, {nome or 'estudante'}!\n\n"
        f"Seu código de verificação do {NOME_APP} é:\n\n"
        f"    {codigo}\n\n"
        f"Ele expira em 10 minutos. Se não foi você que solicitou, ignore este email.\n\n"
        f"— Equipe {NOME_APP}"
    )
    msg = EmailMessage()
    msg["Subject"] = f"{codigo} é o seu código — {assunto}"
    msg["From"] = f"{NOME_APP} <{REMETENTE}>"
    msg["To"] = destinatario
    msg.set_content(corpo)

    try:
        contexto = ssl.create_default_context()
        if SMTP_PORTA == 465:
            with smtplib.SMTP_SSL(SMTP_HOST, SMTP_PORTA, context=contexto, timeout=15) as s:
                s.login(REMETENTE, SENHA_APP)
                s.send_message(msg)
        else:
            with smtplib.SMTP(SMTP_HOST, SMTP_PORTA, timeout=15) as s:
                s.starttls(context=contexto)
                s.login(REMETENTE, SENHA_APP)
                s.send_message(msg)
        return True
    except Exception as e:
        print(f"[email] falha ao enviar para {destinatario}: {e}")
        return False
