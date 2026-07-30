/**
 * Funções compartilhadas por todas as páginas: montar o card de um
 * anúncio, preencher uma grade de cards, popular a caixa de filtro
 * de categoria, buscar com tolerância a erro de digitação e registrar
 * o Service Worker (PWA).
 */

// Mensagem do passo de código (2FA / recuperar / trocar senha). Se o backend
// mandou por email de verdade (email_enviado), instrui a checar o email; senão
// (modo demo, sem SMTP configurado) mostra o código na própria tela.
function textoAvisoCodigo(resposta) {
  if (resposta && resposta.email_enviado) {
    return "Enviamos um código de verificação para o seu email. Confira a caixa de entrada (e o spam).";
  }
  if (resposta && resposta.codigo_simulado) {
    return `Código de verificação (modo demo, sem email configurado): ${resposta.codigo_simulado}`;
  }
  // Sem código e sem email: recuperação de senha de um email que não existe.
  // Resposta genérica de propósito, pra não revelar se a conta existe.
  return "Se existir uma conta com esse email, enviamos um código de verificação.";
}

// Avatares novos vêm como caminho relativo (/static/uploads/avatars/...),
// servido pelo backend (porta diferente do frontend) — precisa prefixar
// com API_URL. Fotos antigas em base64 (data:...) ou de fora (Google)
// continuam absolutas, passam direto.
function resolverUrlFoto(foto) {
  if (!foto) return foto;
  if (foto.startsWith("data:") || foto.startsWith("http")) return foto;
  return `${API_URL}${foto}`;
}

const ICONE_POR_CATEGORIA = {
  "Livros": "📚",
  "Eletrônicos": "💻",
  "Calculadoras": "🧮",
  "Material de Estudo": "📓",
  "Móveis": "🪑",
  "Vestimentas": "👕",
  "Outros": "🎁",
};

// "Publicado há 3 dias" / "Publicado hoje" — data relativa enquanto é
// recente (é o que importa num marketplace), e data cheia depois de um mês.
function formatarPublicado(iso) {
  if (!iso) return "";
  const data = new Date(iso);
  if (isNaN(data)) return "";

  const dias = Math.floor((Date.now() - data.getTime()) / 86400000);
  if (dias <= 0) return "Publicado hoje";
  if (dias === 1) return "Publicado ontem";
  if (dias < 30) return `Publicado há ${dias} dias`;
  return `Publicado em ${data.toLocaleDateString("pt-BR")}`;
}

// Transforma "Material de Estudo" em "material-de-estudo" pra bater com as
// classes CSS de cor por categoria (.badge--material-de-estudo etc).
function slugCategoria(categoria) {
  return categoria
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, "-");
}

function criarCardElemento(anuncio, { permitirRemover = false, onRemover, permitirEditar = false } = {}) {
  const tpl = document.getElementById("tpl-card-item");
  const node = tpl.content.cloneNode(true);
  const slug = slugCategoria(anuncio.categoria);

  const categoriaEl = node.querySelector('[data-role="categoria"]');
  categoriaEl.textContent = anuncio.categoria;
  categoriaEl.classList.add(`badge--${slug}`);

  node.querySelector('[data-role="titulo"]').textContent = anuncio.titulo;
  node.querySelector('[data-role="descricao"]').textContent = anuncio.descricao;
  node.querySelector('[data-role="publicado"]').textContent = formatarPublicado(anuncio.criado_em);

  const precoEl = node.querySelector('[data-role="preco"]');
  if (anuncio.tipo === "doacao") {
    precoEl.textContent = "Doação";
  } else {
    const temOferta = anuncio.preco_original && anuncio.preco_original > anuncio.preco;
    if (temOferta) {
      // Números formatados via toFixed, sem texto livre do usuário — seguro usar innerHTML aqui.
      precoEl.innerHTML = `
        R$ ${Number(anuncio.preco).toFixed(2)}
        <span class="preco-original">R$ ${Number(anuncio.preco_original).toFixed(2)}</span>
        <span class="badge-oferta">Oferta</span>
      `;
    } else {
      precoEl.textContent = `R$ ${Number(anuncio.preco).toFixed(2)}`;
    }
    precoEl.classList.add("preco--venda");
  }

  const img = node.querySelector('[data-role="img"]');
  img.classList.add(`img--${slug}`);
  if (anuncio.imagem) {
    img.style.backgroundImage = `url("${resolverUrlFoto(anuncio.imagem)}")`;
  } else {
    img.textContent = ICONE_POR_CATEGORIA[anuncio.categoria] || "📦";
  }

  // Capturado agora (enquanto o card ainda está no fragment) e guardado
  // pra usar tanto no clique quanto no remover — depois que o fragment é
  // anexado ao DOM de verdade ele esvazia, então buscar de novo lá dentro
  // do listener (avaliado só no clique) devolveria null.
  const card = node.querySelector(".card-item");

  const btnRemover = node.querySelector('[data-role="btn-remover"]');
  if (permitirRemover) {
    btnRemover.hidden = false;
    // Passa o próprio elemento do card — quem chama pode tirar ele do DOM
    // direto (remoção otimista), sem precisar recarregar a lista inteira.
    btnRemover.addEventListener("click", () => onRemover(anuncio.id, card));
  }

  const linkEditar = node.querySelector('[data-role="link-editar"]');
  if (permitirEditar) {
    linkEditar.hidden = false;
    linkEditar.href = `anunciar.html?editar=${anuncio.id}`;
  }

  // Oferta (baixar o preço): só pra quem já pode editar (é dono do
  // anúncio), item à venda, e publicado há mais de 24h sem ser retirado.
  const linkOferta = node.querySelector('[data-role="link-oferta"]');
  const HORAS_24_EM_MS = 24 * 60 * 60 * 1000;
  const publicadoHaMaisDe24h = Date.now() - new Date(anuncio.criado_em).getTime() >= HORAS_24_EM_MS;
  if (permitirEditar && anuncio.tipo === "venda" && publicadoHaMaisDe24h && !anuncio.vendido) {
    linkOferta.hidden = false;
    linkOferta.href = `anunciar.html?editar=${anuncio.id}&oferta=1`;
  }

  // Clicar no card abre o anúncio — mas exige login primeiro. Cliques nos
  // botões de editar/remover/oferta não devem "vazar" pra essa navegação.
  card.addEventListener("click", (event) => {
    if (event.target.closest('[data-role="btn-remover"], [data-role="link-editar"], [data-role="link-oferta"]')) return;

    if (!obterToken()) {
      window.location.href = "login.html";
      return;
    }
    window.location.href = `anuncio.html?id=${anuncio.id}`;
  });

  return node;
}

// opts.anexar: true acrescenta ao que já tem na grid (pro botão "Carregar
// mais"), em vez de limpar e substituir — usado junto com paginação por
// offset, pra não perder o que já foi carregado nem re-baixar do zero.
function renderGrid(container, anuncios, emptyEl, opts = {}) {
  const anexar = opts.anexar;
  if (!anexar) container.innerHTML = "";

  const vazio = anuncios.length === 0;
  if (!anexar && emptyEl) emptyEl.hidden = !vazio;
  if (vazio) return;

  const frag = document.createDocumentFragment();
  anuncios.forEach((anuncio) => frag.appendChild(criarCardElemento(anuncio, opts)));
  container.appendChild(frag);
}

function renderFiltroBox(select, categorias, onChange) {
  select.innerHTML = ["todas", ...categorias]
    .map((cat) => `<option value="${cat}">${cat === "todas" ? "Todas" : cat}</option>`)
    .join("");
  select.addEventListener("change", () => onChange(select.value));
}

// Conta quantas edições (trocar/inserir/remover uma letra) são necessárias
// para transformar uma palavra na outra — é o que permite "lirvo" encontrar
// "livro" mesmo com a troca de letras.
function distanciaEdicao(a, b) {
  const custos = Array.from({ length: b.length + 1 }, (_, j) => j);

  for (let i = 1; i <= a.length; i++) {
    let diagonal = custos[0];
    custos[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const anterior = custos[j];
      custos[j] = a[i - 1] === b[j - 1]
        ? diagonal
        : 1 + Math.min(diagonal, custos[j], custos[j - 1]);
      diagonal = anterior;
    }
  }

  return custos[b.length];
}

function textoCombina(consulta, texto) {
  const q = consulta.trim().toLowerCase();
  if (!q) return true;

  const alvo = (texto || "").toLowerCase();
  if (alvo.includes(q)) return true;

  const tolerancia = q.length <= 4 ? 1 : 2;
  return alvo.split(/\s+/).some((palavra) => distanciaEdicao(q, palavra) <= tolerancia);
}

// Formata telefone brasileiro enquanto digita: (00) 0000-0000 (fixo, 10
// dígitos) ou (00) 00000-0000 (celular, 11 dígitos).
function formatarTelefone(valor) {
  const digitos = valor.replace(/\D/g, "").slice(0, 11);
  const ddd = digitos.slice(0, 2);
  const resto = digitos.slice(2);

  if (digitos.length === 0) return "";
  if (digitos.length <= 2) return `(${ddd}`;

  const tamanhoPrimeiraParte = digitos.length > 10 ? 5 : 4;
  const primeiraParte = resto.slice(0, tamanhoPrimeiraParte);
  const segundaParte = resto.slice(tamanhoPrimeiraParte);

  return segundaParte ? `(${ddd}) ${primeiraParte}-${segundaParte}` : `(${ddd}) ${primeiraParte}`;
}

// --- Tamanho de imagem -----------------------------------------------------
// O backend recusa acima de 10MB (ver TAMANHO_MAXIMO_IMAGEM em main.py). Sem
// checar aqui também, o navegador sobe o arquivo inteiro só pra receber um
// erro — no celular isso é espera e dado gasto à toa. Esta função NÃO
// substitui a validação do servidor, que é a que vale de verdade; é só pra
// avisar cedo e com uma mensagem que diz o tamanho real do arquivo.
const LIMITE_IMAGEM_MB = 10;

function separarImagensPorTamanho(arquivos) {
  const limite = LIMITE_IMAGEM_MB * 1024 * 1024;
  const aceitas = [];
  const grandes = [];
  [...arquivos].forEach((a) => (a.size > limite ? grandes : aceitas).push(a));
  return { aceitas, grandes };
}

// Monta a mensagem citando o tamanho do arquivo, que é a informação que
// ajuda a pessoa a entender o que fazer.
function mensagemImagemGrande(grandes) {
  if (!grandes.length) return "";
  if (grandes.length === 1) {
    const mb = (grandes[0].size / (1024 * 1024)).toFixed(1);
    return `A foto tem ${mb}MB e o limite é ${LIMITE_IMAGEM_MB}MB. Escolha uma imagem menor.`;
  }
  return `${grandes.length} fotos passam de ${LIMITE_IMAGEM_MB}MB e foram ignoradas.`;
}

// Liga a formatação automática a um <input> de telefone.
function configurarCampoTelefone(input) {
  if (!input) return;
  input.addEventListener("input", () => {
    input.value = formatarTelefone(input.value);
  });
}

function registrarServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  window.addEventListener("load", () => {
    // updateViaCache: "none" força o navegador a sempre buscar o próprio
    // service-worker.js na rede — sem isso o Chrome guarda esse arquivo em
    // cache por até 24h, então bumpar CACHE_NAME dentro dele não adianta:
    // o navegador continua rodando a versão antiga do próprio SW até esse
    // prazo passar (era a causa raiz de mudanças "não pegarem" no celular).
    navigator.serviceWorker.register("service-worker.js", { updateViaCache: "none" })
      .then((registro) => registro.update())
      .catch((err) => {
        console.error("Falha ao registrar o Service Worker:", err);
      });
  });
}

// Mostra avatar (inicial do nome) + nome + Sair quando logado, ou um botão
// Entrar quando não. Fica no topo do topbar/sidebar, no lugar onde antes
// ficava a marca — a marca completa agora só aparece no hero da home.
// Só existe o elemento #perfil-topo nas páginas que têm o menu completo
// (login/cadastro têm um cabeçalho mais simples, sem essa área).
function renderPerfilTopo() {
  const area = document.getElementById("perfil-topo");
  if (!area) return;

  const usuario = obterUsuario();
  if (!usuario) {
    area.innerHTML = '<a href="login.html" class="btn btn--ghost">Entrar</a>';
    return;
  }

  const primeiroNome = usuario.nome.split(" ")[0];
  const avatar = usuario.foto
    ? `<img src="${resolverUrlFoto(usuario.foto)}" alt="" />`
    : primeiroNome[0].toUpperCase();
  area.innerHTML = `
    <span class="perfil-topo__avatar">${avatar}</span>
    <span class="perfil-topo__nome">${primeiroNome}</span>
    <button type="button" class="perfil-topo__sair" id="btn-sair">Sair</button>
  `;
  document.getElementById("btn-sair").addEventListener("click", (event) => {
    event.stopPropagation();
    sair();
  });
  area.addEventListener("click", (event) => {
    if (event.target.closest("#btn-sair")) return;
    window.location.href = "perfil.html";
  });
}

// Link "Denúncias" só aparece pra quem é admin — vem escondido por padrão
// no HTML (pode haver mais de um: sidebar do desktop + atalho extra no
// Perfil mobile), só revelamos depois de confirmar com a API (nunca confia
// em nada guardado no navegador pra decidir isso).
async function revelarLinkAdmin() {
  const links = document.querySelectorAll(".admin-link-denuncias");
  if (!links.length || !obterToken()) return;
  try {
    const perfil = await api.obterPerfil();
    if (perfil.is_admin) links.forEach((link) => { link.hidden = false; });
  } catch {
    // sem sessão válida, mantém escondido
  }
}

// Sidebar retrátil (só existe nas páginas com menu completo, a partir de
// 768px). O estado (aberta/fechada) fica salvo pra continuar igual ao
// navegar entre páginas, já que aqui não é uma SPA.
function configurarSidebarRetratil() {
  const botao = document.getElementById("toggle-sidebar");
  if (!botao) return;

  const COLAPSADA_KEY = "desapego:sidebarColapsada";

  function aplicar(colapsada) {
    document.body.classList.toggle("sidebar-colapsada", colapsada);
    botao.setAttribute("aria-label", colapsada ? "Expandir menu" : "Recolher menu");
  }

  aplicar(localStorage.getItem(COLAPSADA_KEY) === "true");

  botao.addEventListener("click", () => {
    const colapsada = !document.body.classList.contains("sidebar-colapsada");
    localStorage.setItem(COLAPSADA_KEY, colapsada);
    aplicar(colapsada);
  });

  // Clicar numa opção do menu já leva pra outra página (aqui não é SPA) —
  // fecha a sidebar antes de sair, então ela já chega recolhida na página
  // seguinte, sem tampar o conteúdo sem necessidade.
  document.querySelectorAll(".topbar--app .topbar__nav a").forEach((link) => {
    link.addEventListener("click", () => {
      localStorage.setItem(COLAPSADA_KEY, "true");
    });
  });
}

// Modo noturno: troca o fundo ice-gray por preto. Estado salvo no
// localStorage pra continuar igual ao navegar entre páginas (aqui não é SPA).
const ICONE_LUA = '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M12.1 2C6.6 2.4 2.5 7.1 3 12.6c.5 5.1 4.9 9 10 9 3.6 0 6.8-1.9 8.6-4.8-4.9 1-9.6-2.7-9.9-7.7-.2-3 1-5.7 3-7.5-.9-.2-1.8-.4-2.6-.6z"/></svg>';
const ICONE_SOL = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>';

function configurarModoNoturno() {
  const botao = document.getElementById("toggle-tema");
  if (!botao) return;

  const TEMA_KEY = "desapego:modoNoturno";

  function aplicar(ativo) {
    document.body.classList.toggle("modo-noturno", ativo);
    botao.innerHTML = ativo ? ICONE_SOL : ICONE_LUA;
    botao.setAttribute("aria-label", ativo ? "Desativar modo noturno" : "Ativar modo noturno");
  }

  aplicar(localStorage.getItem(TEMA_KEY) === "true");

  botao.addEventListener("click", () => {
    const ativo = !document.body.classList.contains("modo-noturno");
    localStorage.setItem(TEMA_KEY, ativo);
    aplicar(ativo);
  });
}

// --- Cabeçalho mobile + barra de navegação inferior em TODAS as páginas
// de app --------------------------------------------------------------------
// Sem menu hambúrguer/drawer: no mobile a navegação inteira mora numa barra
// fixa embaixo (Chat/Catálogo/Início/Anunciar/Perfil), sempre visível. O
// cabeçalho só injeta a marca (logo) — o resto (Entrar/avatar, tema, termos)
// já existe no HTML de cada página e continua exatamente onde está.
function configurarHeaderMobile() {
  const inner = document.querySelector(".topbar--app .topbar__inner");
  if (!inner) return; // páginas de header simples (login/cadastro/termos) não têm bottom-nav

  document.body.classList.add("com-bottomnav");

  // Marca (logo + "Desapego Universitário") no topo, à esquerda.
  if (!inner.querySelector(".topbar__brand")) {
    const marca = document.createElement("a");
    marca.href = "index.html";
    marca.className = "topbar__brand";
    marca.setAttribute("aria-label", "Início");
    marca.innerHTML = '<img src="img/mascote-badge.png" alt="" /> <span>Desapego Universitário</span>';
    inner.insertBefore(marca, inner.firstChild);
  }

  criarBottomNav();
}

// --- Botão "Voltar" (mobile) ------------------------------------------------
// Páginas que NÃO são um dos 5 destinos da barra inferior são "sub-telas"
// (Termos, Denúncias, perfil público, login, criar conta, recuperar senha...):
// no mobile elas não têm entrada própria na barra, então ganham um "Voltar" no
// topo pra não deixar a pessoa presa. Ficam de fora só os 5 destinos da barra
// (que já são a navegação) e o anúncio, que tem o "Voltar ao catálogo" próprio.
const PAGINAS_SEM_VOLTAR = [
  "", "index.html", "landing.html", "catalogo.html", "anunciar.html", "chat.html", "perfil.html",
  "anuncio.html",
];

function configurarBotaoVoltar() {
  const main = document.querySelector("main");
  if (!main || document.querySelector(".btn-voltar-mobile")) return;

  const pagina = window.location.pathname.split("/").pop() || "index.html";
  if (PAGINAS_SEM_VOLTAR.includes(pagina)) return;

  const botao = document.createElement("button");
  botao.type = "button";
  botao.className = "btn-voltar-mobile";
  botao.setAttribute("aria-label", "Voltar");
  botao.innerHTML = '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>';
  botao.addEventListener("click", () => {
    // Veio de outra página do próprio site → volta pra ela; senão (link
    // direto/aba nova) cai no destino seguro.
    if (window.history.length > 1 && document.referrer.includes(window.location.host)) {
      window.history.back();
    } else {
      window.location.href = "index.html";
    }
  });

  main.insertBefore(botao, main.firstChild);
}

// --- Barra de navegação inferior (mobile) -----------------------------------
// 5 destinos fixos, na ordem: Catálogo | Anunciar | Início | Chat | Perfil.
const ICONE_CHAT = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>';
const ICONE_CATALOGO = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>';
const ICONE_INICIO = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11.5 12 4l9 7.5"/><path d="M5 10v10h14V10"/></svg>';
const ICONE_ANUNCIAR = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg>';
const ICONE_PERFIL = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 4-6 8-6s8 2 8 6"/></svg>';

function criarBottomNav() {
  if (document.querySelector(".bottom-nav")) return; // idempotente

  const logado = Boolean(obterUsuario());
  // requerLogin: destinos que exigem sessão. Deslogado, o item aponta direto
  // pro login — em vez de abrir a página e ela redirecionar pro login (o que
  // criava um "loop" ao apertar Voltar: login → página → login → ...).
  const itens = [
    { pagina: "catalogo.html", label: "Catálogo", icone: ICONE_CATALOGO },
    { pagina: "anunciar.html", label: "Anunciar", icone: ICONE_ANUNCIAR, requerLogin: true },
    { pagina: "index.html", label: "Início", icone: ICONE_INICIO },
    { pagina: "chat.html", label: "Chat", icone: ICONE_CHAT, classeExtra: "chat-notif-alvo", requerLogin: true },
    { pagina: "perfil.html", label: "Perfil", labelDeslogado: "Entrar", icone: ICONE_PERFIL, requerLogin: true },
  ];

  const nav = document.createElement("nav");
  nav.className = "bottom-nav";
  nav.setAttribute("aria-label", "Navegação principal");

  const paginaAtual = window.location.pathname.split("/").pop() || "index.html";

  itens.forEach((item) => {
    const precisaLogin = item.requerLogin && !logado;
    const destino = precisaLogin ? "login.html" : item.pagina;
    const rotulo = precisaLogin && item.labelDeslogado ? item.labelDeslogado : item.label;

    const link = document.createElement("a");
    link.href = destino;
    link.className = "bottom-nav__item" + (item.classeExtra ? ` ${item.classeExtra}` : "");
    // Destaque pela página REAL do item (não o destino de login), pra a aba
    // certa acender quando a pessoa está logada nela.
    if (item.pagina === paginaAtual) {
      link.classList.add("bottom-nav__item--ativo");
      link.setAttribute("aria-current", "page");
    }
    link.innerHTML = `<span class="bottom-nav__icone">${item.icone}</span><span>${rotulo}</span>`;
    nav.appendChild(link);
  });

  document.body.appendChild(nav);
  esconderBottomNavAoRolar(nav);
}

// Some ao rolar pra baixo (mais espaço pra ler o conteúdo), volta ao rolar
// pra cima — padrão comum em app mobile (OLX, Instagram etc). Ignora
// variações pequenas (< 8px) pra não "tremer" com o bounce do iOS/Android.
function esconderBottomNavAoRolar(nav) {
  let ultimoY = window.scrollY;
  let ticking = false;

  function avaliar() {
    const atual = window.scrollY;
    const diferenca = atual - ultimoY;

    // No fim da página, mantém a barra à mostra: senão o espaço que o conteúdo
    // reserva pra ela (padding-bottom do main) fica vazio, parecendo "sobra".
    const noFim = window.innerHeight + atual >= document.documentElement.scrollHeight - 4;

    if (noFim) {
      nav.classList.remove("bottom-nav--escondida");
      ultimoY = atual;
    } else if (Math.abs(diferenca) > 8) {
      const rolandoPraBaixo = diferenca > 0 && atual > nav.offsetHeight;
      nav.classList.toggle("bottom-nav--escondida", rolandoPraBaixo);
      ultimoY = atual;
    }
    ticking = false;
  }

  window.addEventListener("scroll", () => {
    if (!ticking) {
      window.requestAnimationFrame(avaliar);
      ticking = true;
    }
  }, { passive: true });
}

// --- Olho de mostrar/esconder senha -----------------------------------------
// Feito em JS pra valer em toda tela que tenha campo de senha (login, cadastro,
// recuperar senha e perfil) sem precisar repetir markup em cada HTML.
const OLHO_ABERTO = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`;
const OLHO_FECHADO = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>`;

function configurarMostrarSenha() {
  document.querySelectorAll('input[type="password"]').forEach((input) => {
    const caixa = document.createElement("div");
    caixa.className = "campo-senha";
    input.parentNode.insertBefore(caixa, input);
    caixa.appendChild(input);

    const botao = document.createElement("button");
    botao.type = "button"; // sem isto ele enviaria o formulário
    botao.className = "campo-senha__olho";
    botao.innerHTML = OLHO_ABERTO;
    botao.setAttribute("aria-label", "Mostrar senha");

    botao.addEventListener("click", () => {
      const mostrando = input.type === "text";
      input.type = mostrando ? "password" : "text";
      botao.innerHTML = mostrando ? OLHO_ABERTO : OLHO_FECHADO;
      botao.setAttribute("aria-label", mostrando ? "Mostrar senha" : "Esconder senha");
      input.focus();
    });

    caixa.appendChild(botao);
  });
}

// --- Notificações do chat ---------------------------------------------------
// Marca no navegador quando a pessoa abriu o chat; o backend usa essa data pra
// contar o que chegou depois (mensagem nova ou venda aceita). Sem coluna de
// "lido" no banco — a contagem é sempre "desde a última visita".
const ULTIMA_VISITA_CHAT = "desapego_ultima_visita_chat";
const INTERVALO_NOTIFICACAO_MS = 20000;

function marcarChatComoVisto() {
  localStorage.setItem(ULTIMA_VISITA_CHAT, new Date().toISOString());
}

// Pode haver dois ".chat-notif-alvo" na mesma página: o botão flutuante
// (desktop, que também é ".chat-atalho" — não usar essa classe aqui, ela
// carrega o CSS do círculo flutuante e "vazava" pro item da barra inferior)
// e o item "Chat" da barra inferior (mobile) — CSS decide qual aparece,
// aqui só pintamos os dois. No item da barra inferior o selo entra dentro
// do ".bottom-nav__icone" (só o ícone), não no item inteiro (que também tem
// o texto "Chat" embaixo).
function pintarBadge(total) {
  const atalhos = document.querySelectorAll(".chat-notif-alvo");
  if (!atalhos.length) return;

  atalhos.forEach((atalho) => {
    const naBarraInferior = atalho.classList.contains("bottom-nav__item");
    const alvo = naBarraInferior ? atalho.querySelector(".bottom-nav__icone") : atalho;
    const classeBadge = naBarraInferior ? "bottom-nav__badge" : "chat-atalho__badge";

    let badge = alvo.querySelector(`.${classeBadge}`);
    if (!total) {
      if (badge) badge.remove();
      return;
    }
    if (!badge) {
      badge = document.createElement("span");
      badge.className = classeBadge;
      alvo.appendChild(badge);
    }
    badge.textContent = total > 9 ? "9+" : String(total);
    atalho.setAttribute("aria-label", `Chat — ${total} novidade(s)`);
  });
}

async function atualizarNotificacoes() {
  if (!obterToken() || !document.querySelector(".chat-notif-alvo")) return;
  try {
    const dados = await api.contarNotificacoes(localStorage.getItem(ULTIMA_VISITA_CHAT));
    pintarBadge(dados.total);
  } catch {
    // Falha de rede não pode quebrar a página — só não mostra o aviso.
  }
}

function configurarNotificacoes() {
  // Estar no chat já significa que a pessoa viu; zera e não fica avisando.
  if (window.location.pathname.endsWith("chat.html")) {
    marcarChatComoVisto();
    return;
  }
  // Sem registro de visita, manda vazio de propósito: o backend conta tudo
  // que ainda não foi lido (senão a bolinha nunca apareceria pra quem já
  // tinha mensagens antigas esperando).
  atualizarNotificacoes();
  setInterval(atualizarNotificacoes, INTERVALO_NOTIFICACAO_MS);
}

registrarServiceWorker();
configurarHeaderMobile();   // injeta a marca + a barra de navegação inferior
configurarBotaoVoltar();    // "Voltar" nas sub-telas (Termos, Denúncias, etc.)
renderPerfilTopo();
configurarSidebarRetratil();
configurarModoNoturno();
revelarLinkAdmin();
configurarNotificacoes();
configurarMostrarSenha();
