"""
Modelos de dados da API (Pydantic) e as listas fixas usadas nos anúncios
de Livros. Essas listas são o "admin" do catálogo: o usuário só escolhe
dentro delas, não cria valores novos.
"""

from typing import Optional
from pydantic import BaseModel, EmailStr, Field, field_validator, model_validator

CATEGORIAS = [
    "Livros",
    "Eletrônicos",
    "Calculadoras",
    "Material de Estudo",
    "Móveis",
    "Vestimentas",
    "Outros",
]

# Cursos de graduação da UNIFOR — é a lista que alimenta todos os filtros e
# formulários que pedem curso (vem pro frontend via GET /opcoes).
CURSOS = [
    "Administração",
    "Análise e Desenvolvimento de Sistemas",
    "Arquitetura e Urbanismo",
    "Biomedicina",
    "Ciência da Computação",
    "Ciências Contábeis",
    "Ciências Econômicas",
    "Cinema e Audiovisual",
    "Comércio Exterior",
    "Design",
    "Design de Moda",
    "Direito",
    "Educação Física",
    "Energias Renováveis",
    "Enfermagem",
    "Engenharia Civil",
    "Engenharia de Computação",
    "Engenharia de Produção",
    "Engenharia Elétrica",
    "Engenharia Mecânica",
    "Estética e Cosmética",
    "Farmácia",
    "Finanças",
    "Fisioterapia",
    "Fonoaudiologia",
    "Gestão Comercial",
    "Gestão da Tecnologia da Informação",
    "Gestão de Recursos Humanos",
    "Gestão Financeira",
    "Inteligência Artificial",
    "Inteligência de Negócios",
    "Jornalismo",
    "Logística",
    "Marketing",
    "Marketing Digital",
    "Medicina",
    "Medicina Veterinária",
    "Negócios",
    "Nutrição",
    "Odontologia",
    "Psicologia",
    "Publicidade e Propaganda",
    "Segurança Cibernética",
    "Terapia Ocupacional",
]

MATERIAS = [
    "Cálculo I",
    "Cálculo II",
    "Álgebra Linear",
    "Algoritmos",
    "Física I",
    "Física II",
    "Química Geral",
    "Estatística",
    "Banco de Dados",
    "Redes de Computadores",
]

AUTORES = [
    "James Stewart",
    "Fernanda Reges",
    "Robert C. Martin",
    "Thomas H. Cormen",
    "Donald Knuth",
]

TURNOS = ["Manhã", "Tarde", "Noite", "Integral"]

# Motivos fixos de denúncia — os mesmos tipos de violação listados nos
# Termos de Uso (frontend/termos.html), pra manter tudo consistente.
MOTIVOS_DENUNCIA = [
    "Discurso de ódio ou racismo",
    "Conteúdo pornográfico",
    "Item ilegal ou perigoso",
    "Golpe ou fraude",
    "Assédio ou bullying",
    "Spam",
    "Outro",
]


class UsuarioCadastro(BaseModel):
    nome: str = Field(min_length=1, max_length=80)
    email: EmailStr
    senha: str = Field(min_length=8, max_length=72)
    # Telefone é opcional no cadastro — só o nome, email e senha são
    # obrigatórios pra criar a conta.
    telefone: Optional[str] = Field(default=None, max_length=20)


class VerificarEmail(BaseModel):
    """Checagem de disponibilidade de email — usada no passo 1 do cadastro,
    pra avisar de email inválido ou já cadastrado antes de pedir o nome."""
    email: EmailStr


class UsuarioLogin(BaseModel):
    email: EmailStr
    senha: str


class LoginGoogle(BaseModel):
    token: str = Field(min_length=1)
    telefone: Optional[str] = None


class Confirmar2FA(BaseModel):
    token_pendente: str = Field(min_length=1)
    codigo: str = Field(min_length=1, max_length=6)


class TrocarSenhaPedido(BaseModel):
    senha_atual: str
    senha_nova: str = Field(min_length=8, max_length=72)


class TrocarSenhaConfirmar(BaseModel):
    codigo: str = Field(min_length=1, max_length=6)


class OfertaPreco(BaseModel):
    preco_novo: float = Field(gt=0)


class DenunciaCreate(BaseModel):
    motivo: str

    @field_validator("motivo")
    @classmethod
    def motivo_valido(cls, v):
        if v not in MOTIVOS_DENUNCIA:
            raise ValueError(f"motivo deve ser um de: {', '.join(MOTIVOS_DENUNCIA)}")
        return v


class RecuperarSenhaPedido(BaseModel):
    email: EmailStr


class RecuperarSenhaConfirmar(BaseModel):
    email: EmailStr
    codigo: str = Field(min_length=1, max_length=6)
    senha_nova: str = Field(min_length=8, max_length=72)


class ResponderConfirmacaoVenda(BaseModel):
    aceitar: bool


class ImportarLivros(BaseModel):
    """Entrada da importação de livros a partir da API externa."""

    termo: str = Field(min_length=2, max_length=120)
    # Teto baixo de propósito: a rota é síncrona e a API externa limita
    # requisições — importar de 40 em 40 é suficiente e não trava o servidor.
    limite: int = Field(default=10, ge=1, le=40)

    @field_validator("termo")
    @classmethod
    def termo_nao_vazio(cls, v):
        v = v.strip()
        if not v:
            raise ValueError("termo não pode ser só espaços")
        return v
