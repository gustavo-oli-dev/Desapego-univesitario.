/**
 * Página Catálogo: lista os anúncios públicos, com busca por texto e
 * filtro por categoria — busca e ordenação são resolvidas pela API
 * (?q=&ordem=), não baixando o catálogo inteiro pra filtrar no cliente.
 * Quando a categoria é "Livros", mostra subfiltros extras (Curso/Matéria/
 * Autor — cada anúncio pode ter mais de um valor nesses campos), cujas
 * opções também vêm de uma rota própria (GET /anuncios/filtros).
 */

const CAMPOS_SUBFILTRO = ["curso", "materia", "autor"];
// Curso é lista própria e Autor é busca com sugestões; só Matéria segue <select>.
const CAMPOS_SELECT = ["materia"];

const selectCategoria = document.getElementById("select-categoria");
const selectTipo = document.getElementById("select-tipo");
const selectOrdenar = document.getElementById("select-ordenar");
const inputBusca = document.getElementById("input-busca");
const subfiltrosContainer = document.getElementById("subfiltros-livro");
const cursoDropdown = document.getElementById("curso-dropdown");
const cursoBotao = document.getElementById("curso-botao");
const cursoPainel = document.getElementById("curso-painel");
const autorBusca = document.getElementById("autor-busca");
const autorInput = document.getElementById("autor-input");
const autorPainel = document.getElementById("autor-painel");

let subfiltrosAtuais = { curso: "todas", materia: "todas", autor: "todas" };

function preencherSubfiltro(campo, valores) {
  const select = document.getElementById(`select-${campo}`);
  const atual = subfiltrosAtuais[campo];

  select.innerHTML = ["todas", ...valores]
    .map((v) => `<option value="${v}">${v === "todas" ? "Todos" : v}</option>`)
    .join("");

  select.value = valores.includes(atual) ? atual : "todas";
  subfiltrosAtuais[campo] = select.value;
}

// O <details> cuida de abrir/fechar sozinho; aqui só precisamos fechar
// depois que o usuário escolhe uma opção.
function escolherCurso(valor) {
  subfiltrosAtuais.curso = valor;
  cursoBotao.textContent = valor === "todas" ? "Todos" : valor;
  cursoPainel.querySelectorAll("li").forEach((li) => {
    li.setAttribute("aria-selected", String(li.dataset.valor === valor));
  });
  cursoDropdown.open = false;
  carregarCatalogo();
}

// Monta a lista de cursos. textContent (não innerHTML) porque os nomes vêm
// da API — assim nada é interpretado como HTML.
function preencherCursos() {
  const cursos = [...api.cursos].sort((a, b) => a.localeCompare(b, "pt-BR"));
  cursoPainel.innerHTML = "";

  ["todas", ...cursos].forEach((valor) => {
    const item = document.createElement("li");
    item.className = "lista-opcoes__item";
    item.role = "option";
    item.dataset.valor = valor;
    item.textContent = valor === "todas" ? "Todos" : valor;
    item.setAttribute("aria-selected", String(subfiltrosAtuais.curso === valor));
    item.addEventListener("click", () => escolherCurso(valor));
    cursoPainel.appendChild(item);
  });

  cursoBotao.textContent = subfiltrosAtuais.curso === "todas" ? "Todos" : subfiltrosAtuais.curso;
}

// --- Autor: busca com sugestões (estilo Amazon) ---------------------------
// Tira acentos pra "jose" achar "José" — quem digita rápido não põe acento.
function semAcento(texto) {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

function escolherAutor(valor) {
  subfiltrosAtuais.autor = valor || "todas";
  autorInput.value = valor || "";
  autorPainel.hidden = true;
  carregarCatalogo();
}

// Mostra os autores que combinam com o que foi digitado. Sem texto, some —
// as sugestões só aparecem enquanto a pessoa está buscando.
function mostrarSugestoesAutor() {
  const termo = semAcento(autorInput.value.trim());
  const achados = termo
    ? api.autores.filter((a) => semAcento(a).includes(termo))
    : [];

  autorPainel.innerHTML = "";
  achados.forEach((autor) => {
    const item = document.createElement("li");
    item.className = "lista-opcoes__item";
    item.textContent = autor;
    item.addEventListener("mousedown", (event) => {
      // mousedown (não click) pra escolher antes do blur do input fechar tudo
      event.preventDefault();
      escolherAutor(autor);
    });
    autorPainel.appendChild(item);
  });

  autorPainel.hidden = achados.length === 0;
}

async function carregarSubfiltrosLivro() {
  const opcoes = await api.listarFiltrosAnuncios("Livros");

  // Matéria continua vindo do que existe nos anúncios.
  preencherSubfiltro("materia", opcoes.materia);

  // Curso (lista) e Autor (busca) usam as listas completas, não só o que já
  // aparece em algum anúncio.
  preencherCursos();
  // Só limpa a UI do autor (quem chamou já zerou subfiltrosAtuais); chamar
  // escolherAutor aqui dispararia um carregamento extra do catálogo.
  autorInput.value = "";
  autorPainel.hidden = true;
}

async function carregarCatalogo() {
  const categoria = selectCategoria.value;
  const grid = document.getElementById("grid-catalogo");
  const empty = document.getElementById("catalogo-empty");

  let anuncios = await api.listarAnuncios({
    categoria,
    q: inputBusca.value,
    ordem: selectOrdenar.value,
  });

  // Curso/Matéria/Autor e Tipo continuam filtrados no cliente — o
  // resultado que chega aqui já veio pequeno (categoria + busca + ordem
  // resolvidos no banco), então filtrar mais um pouco em cima disso não
  // pesa nada.
  subfiltrosContainer.hidden = categoria !== "Livros";
  if (categoria === "Livros") {
    anuncios = anuncios.filter((a) =>
      CAMPOS_SUBFILTRO.every(
        (campo) => subfiltrosAtuais[campo] === "todas" || (a[campo] || []).includes(subfiltrosAtuais[campo])
      )
    );
  }

  if (selectTipo.value !== "todos") {
    anuncios = anuncios.filter((a) => a.tipo === selectTipo.value);
  }

  renderGrid(grid, anuncios, empty);
}

function configurarSubfiltros() {
  CAMPOS_SELECT.forEach((campo) => {
    document.getElementById(`select-${campo}`).addEventListener("change", (event) => {
      subfiltrosAtuais[campo] = event.target.value;
      carregarCatalogo();
    });
  });

  // Rede de segurança: se a lista ainda não estiver montada quando abrir,
  // monta na hora (o <details> já abre sozinho, sem depender disso).
  cursoDropdown.addEventListener("toggle", () => {
    if (cursoDropdown.open && !cursoPainel.children.length) preencherCursos();
  });

  // Autor: digitar mostra sugestões; apagar tudo volta pra "Todos".
  autorInput.addEventListener("input", () => {
    mostrarSugestoesAutor();
    if (!autorInput.value.trim() && subfiltrosAtuais.autor !== "todas") {
      escolherAutor("");
    }
  });
  autorInput.addEventListener("focus", mostrarSugestoesAutor);

  // Fecha ao clicar fora ou apertar Esc.
  document.addEventListener("click", (event) => {
    if (!cursoDropdown.contains(event.target)) cursoDropdown.open = false;
    if (!autorBusca.contains(event.target)) autorPainel.hidden = true;
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      cursoDropdown.open = false;
      autorPainel.hidden = true;
    }
  });
}

// A Home manda pro catálogo já com um filtro na URL (busca, categoria ou
// tipo), vindo da barra de busca e dos chips. Aplica esses valores nos
// controles antes do primeiro carregamento.
function aplicarFiltrosDaURL() {
  const params = new URLSearchParams(window.location.search);

  const q = params.get("q");
  if (q) inputBusca.value = q;

  const categoria = params.get("categoria");
  if (categoria && api.categorias.includes(categoria)) {
    selectCategoria.value = categoria;
  }

  const tipo = params.get("tipo");
  if (tipo && ["doacao", "venda"].includes(tipo)) {
    selectTipo.value = tipo;
  }
}

// Botão de filtros (mobile): abre/fecha o painel de filtros, que fica
// escondido por padrão na tela pequena. No desktop o botão nem aparece.
function configurarBotaoFiltros() {
  const botao = document.getElementById("btn-filtros");
  const painel = document.getElementById("catalogo-filtros");
  if (!botao || !painel) return;
  botao.addEventListener("click", () => {
    const aberto = painel.classList.toggle("aberto");
    botao.classList.toggle("ativo", aberto);
    botao.setAttribute("aria-expanded", String(aberto));
  });
}

async function init() {
  await api.carregarOpcoes();
  // A lista de cursos é fixa (não depende dos anúncios), então já monta aqui
  // — assim o dropdown nunca abre vazio.
  preencherCursos();
  renderFiltroBox(selectCategoria, api.categorias, async () => {
    subfiltrosAtuais = { curso: "todas", materia: "todas", autor: "todas" };
    if (selectCategoria.value === "Livros") await carregarSubfiltrosLivro();
    carregarCatalogo();
  });
  configurarSubfiltros();
  configurarBotaoFiltros();
  inputBusca.addEventListener("input", carregarCatalogo);
  selectTipo.addEventListener("change", carregarCatalogo);
  selectOrdenar.addEventListener("change", carregarCatalogo);

  // Depois de montar os controles, aplica o que veio da Home.
  aplicarFiltrosDaURL();

  if (selectCategoria.value === "Livros") await carregarSubfiltrosLivro();
  carregarCatalogo();
}

init();
