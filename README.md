# Desapego Universitário

Marketplace de economia circular para o campus universitário: uma plataforma onde
estudantes anunciam itens (livros, calculadoras, eletrônicos, jalecos, móveis) para
**doação ou venda** a outros estudantes — facilitando o acesso a materiais para quem
está ingressando na universidade.

Projeto desenvolvido para o desafio técnico do processo seletivo de estágio Full-Stack
do **Laboratório Vortex (UNIFOR)**.

## Como rodar o projeto localmente

### Pré-requisitos
- Python 3.9+
- Nenhuma dependência de Node/build — o frontend é HTML/CSS/JS puro.

### Backend (API)

```bash
cd backend
python3 -m venv venv
source venv/bin/activate        # Windows: venv\Scripts\activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8001
```

A API sobe em `http://localhost:8001`. O banco SQLite (`desapego.db`) e as pastas de
upload são criados automaticamente na primeira execução.

**Opcional — popular com dados de exemplo** (20 usuários fictícios com anúncios e fotos):
```bash
python seed_agentes.py
```
As fotos vêm de `backend/seed_fotos/` (versionadas, nomeadas pelo título do anúncio), não
da internet — o script roda offline em menos de um segundo e pode ser executado quantas
vezes quiser, pois pula o que já existe.

**Opcional — email real** (2FA de login e recuperação de senha por email de verdade, em
vez do código aparecer na tela): copie `backend/.env.example` para `backend/.env` e
preencha com uma [Senha de app do Gmail](https://myaccount.google.com/apppasswords).
Sem isso, o app funciona normalmente em "modo demo".

### Frontend (PWA)

```bash
cd frontend
python3 -m http.server 8000
```

Duas páginas de entrada:

- `http://localhost:8000/landing.html` — **landing page pública**, que apresenta o
  projeto e seus objetivos (é a página de divulgação, não o sistema).
- `http://localhost:8000/index.html` — **o app**: catálogo, anúncios, chat e perfil.

O frontend detecta sozinho o endereço da API (porta 8000 → API em 8001 no mesmo host),
inclusive ao abrir pelo celular na mesma rede Wi-Fi.

## Tecnologias utilizadas

**Backend:** Python, FastAPI, SQLite (sem ORM, SQL parametrizado), Pydantic (validação),
PyJWT (autenticação por token), PBKDF2-HMAC-SHA256 (hash de senha), Pillow (compressão de
imagem no upload), smtplib (envio real de email).

**Frontend:** HTML5, CSS3 e JavaScript puro (sem framework, sem build step) — PWA com
`manifest.json` e Service Worker (cache e instalação na tela inicial), mobile-first e
responsivo.

## Diário de Bordo da IA

Este projeto foi construído com apoio intenso de ferramentas de IA generativa ao longo
dos 15 dias de desafio, usadas como parceiras de arquitetura, debug e revisão — não como
geradoras de código não supervisionado.

### Ferramentas utilizadas
- **Claude Code** (modelos da família Claude) — principalmente Sonnet 5, majoritarimante para a
  criação do protótipo do projeto. Opus 4.8, foi usado para tarefas mais complexas, como chat,
  auditoria e ideias de upgrades nos serviços. Foi a ferramenta principal de desenvolvimento,
  usada dentro do VS Code para escrever, revisar e depurar o código do backend e do
  frontend ao longo de todo o projeto. Falble, foi usado na ultima auditoria na questão de
  cibersegurança.
  
- **Google Gemini (Pro):** usado para uma leitura inicial detalhada do PDF do edital (pra
  não deixar nenhum requisito passar despercebido) e, mais adiante, como "auxiliador"
  para analisar o que já tinha sido feito a cada etapa e sugerir pontos de melhoria e
  possíveis causas de bugs. Usado recorrentemente para uma segunda opinião em um bug específico de CSS
  (ver Reflexão Crítica) e análise do que ja tinha sido feito e como poderia melhorar

- **Nano Banana:** Usado na criação do Hero e no suporte nas questões de paletas de cores no frontend

### Estratégia de Engenharia de Prompts

O primeiro prompt do projeto não foi escrito por mim direto — pedi pro Gemini montar um
prompt de contexto pra passar pro Claude Code, com instrução explícita de guardar os
fundamentos do projeto:

> "Me dê um prompt para meu agente IA, apresentando todo o contexto, dando ênfase para
> ele armazenar na memória todas as partes desse prompt de contexto, para que os
> fundamentos do projeto não se percam."

Diretriz de design passada ao Claude Code no início do frontend, pra fugir de telas
poluídas:

> "Diretriz de Design: Minimal UI e UX Experience. O design deve ser limpo, focado em
> tipografia legível, espaços em branco (whitespace), navegação intuitiva e livre de
> distrações, garantindo que o usuário consiga anunciar ou buscar um item com o menor
> número de cliques possível."

Para reduzir entregas quebradas e retrabalho, fixei uma regra permanente de verificação
antes de qualquer entrega:

> "GRAVE ISSO NA MEMÓRIA, ANTES DE ME ENTREGAR UM POSSÍVEL RESULTADO, VERIFIQUE A
> SINTAXE DO CÓDIGO E ERROS DE LÓGICA."

Detalhamento de como eu queria de um filtro espécifico do catálogo — em bom português, pedi busca
tolerante a erro de digitação (`lirvo` deveria ser entendida como `livro`) e, dentro da
categoria Livros, subfiltros específicos por curso, matéria e autor. O prompt original,
como foi escrito, é bem mais corrido do que essa explicação — mas foi exatamente esse
"pensar em voz alta" que ajudou a IA a não deixar nenhum desses filtros de fora:

> "O filtro deve ser usável, tb deve ter uma barra de procura baseado nas letras mais
> compativeis, ex: lirvo, e sub entendido que é um livro, o filtro deve ser usado para
> procurar coisas especificas, inclusive, livros que e uma coisa mais especifico,
> quando selecionado deve ter mais de um filtro, ex; livro de modelagem, um filtro de
> curso? um filtro de materia? um filtro de autor?? essas coisas devem ser levadas em
> consideracao."

A maioria dos bugs encontrados foram no CSS, que foram rapidamente resolvidos através de uma 
auditoria do Claude com o modelo Opus 4.8.

Prompt de separação por tenant: Verifique o banco de dados, se está funcionando de maneira ao 
qual foi pedida e em seguida GRAVE ISSO EM SUA MEMÓRIA: Os dados de cada usuários devem ser separados 
tenant id, NÃO DEVEM COLIDIR DADOS, OU QUALQUER DADOS SE TRANSFOMAREM EM UM UNICO, por isso é necessário, a criação
de ids ao registar usuários

Fiz o cadastro no Google auth, para o login com o google

também implentamos, o direcionamneto ao WhatsApp por meio de escolha do "vendendor"

Já na reta final, pedi uma auditoria completa de segurança ao Claude com o modelo Fable 5, deixando explícito que era só
diagnóstico (sem mexer em nada até eu revisar o relatório):

> "VAMOS LÁ, VC VAI AGIR COMO UM ESPECIALISTA EM CIBERSEGURANÇA, VÁ EXPLORAR PONTOS
> FRACOS QUE POSSAM SER INVADIDOS, FALHAS DE AUDITORIAS, COISAS BOBAS QUE PODEM SER
> INVADIDAS, A SEGURANÇA DO SITE EM PRIMEIRO LUGAR, MAS VC NÃO VAI MODIFICAR NADA, SÓ VAI
> ME DAR O RELATÓRIO."

Esse prompt encontrou duas falhas críticas reais (chave secreta do JWT fixa no código e
um token de 2FA "pendente" que na prática dava acesso completo sem o código de
verificação nunca ser confirmado). No mesmo dia, autorizei a correção num pedido separado
e explícito:

> "quero que concerte tudo que achou, me referindo para o opus 4.8"

### Reflexão crítica

O exemplo mais concreto de erro gerado pela IA e corrigido por curadoria minha foi no
script que popula o banco com anúncios de exemplo (`backend/seed_agentes.py`). A primeira
versão baixava uma foto por categoria numa API de imagens aleatórias (`loremflickr`), com
um **fallback para `picsum.photos` quando a busca por palavra-chave falhava** — e
`picsum` devolve uma foto **totalmente aleatória**, sem relação nenhuma com o termo
pedido. O resultado só ficou visível depois de rodar: o anúncio do livro "Cálculo Volume
1" estava exibindo a foto de um grafite numa parede.

Indentificamos o problema comparando visualmente cada imagem contra o título do anúncio
(gerei um mosaico com todas as fotos lado a lado pra conferir de uma vez). Troquei a fonte
por uma busca por termo de verdade (Openverse, com Wikimedia Commons como reforço pros
casos mais específicos) e refiz a verificação em rodadas — a primeira passada acertou 12
de 17 fotos; identifiquei as 6 que ainda estavam erradas (ex.: fone de ouvido virou foto
de uma pessoa fantasiada; caderno virou uma cena de rua) e repeti a busca com termos mais
específicos até as 17 baterem com o item anunciado. Esse foi um caso claro de o resultado
da IA parecer certo "no código" (o script rodava sem erro, baixava e salvava uma imagem)
mas estar semanticamente errado — só a verificação visual, item por item, pegou isso.


### Aplicação no ar

- **Site (landing + app):** [desapego-univesitario.netlify.app](https://desapego-univesitario.netlify.app)
  - a raiz mostra a landing de apresentação; o app fica em
    [`/index.html`](https://desapego-univesitario.netlify.app/index.html)
- **API:** [desapego-universitario-api-gustavo.onrender.com](https://desapego-universitario-api-gustavo.onrender.com)
  - exemplos: [`/opcoes`](https://desapego-universitario-api-gustavo.onrender.com/opcoes) ·
    [`/anuncios`](https://desapego-universitario-api-gustavo.onrender.com/anuncios)

> A API está no plano free do Render, que suspende a instância após ~15 min sem acesso.
> A primeira requisição depois disso pode levar até ~30 s (cold start); as seguintes
> respondem em menos de 1 s.
>
> O login usa verificação em 2 etapas. Como o envio de email não está configurado em
> produção, o código de 6 dígitos aparece na própria tela — dá para testar o fluxo
> completo sem precisar de caixa de entrada.
