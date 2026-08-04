/**
 * Página Catálogo: lista os anúncios públicos, com busca por texto e
 * filtro por categoria — busca e ordenação são resolvidas pela API
 * (?q=&ordem=), não baixando o catálogo inteiro pra filtrar no cliente.
 * Quando a categoria é "Livros", mostra o subfiltro extra de Curso (um
 * livro pode valer pra mais de um curso).
 */

const selectCategoria = document.getElementById("select-categoria");
const selectTipo = document.getElementById("select-tipo");
const selectOrdenar = document.getElementById("select-ordenar");
const inputBusca = document.getElementById("input-busca");
const subfiltrosContainer = document.getElementById("subfiltros-livro");
const cursoDropdown = document.getElementById("curso-dropdown");
const cursoBotao = document.getElementById("curso-botao");
const cursoPainel = document.getElementById("curso-painel");

let subfiltrosAtuais = { curso: "todas" };

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

async function carregarCatalogo() {
  const categoria = selectCategoria.value;
  const grid = document.getElementById("grid-catalogo");
  const empty = document.getElementById("catalogo-empty");

  let anuncios = await api.listarAnuncios({
    categoria,
    q: inputBusca.value,
    ordem: selectOrdenar.value,
  });

  // Curso e Tipo continuam filtrados no cliente — o resultado que chega
  // aqui já veio pequeno (categoria + busca + ordem resolvidos no banco),
  // então filtrar mais um pouco em cima disso não pesa nada.
  subfiltrosContainer.hidden = categoria !== "Livros";
  if (categoria === "Livros" && subfiltrosAtuais.curso !== "todas") {
    anuncios = anuncios.filter((a) => (a.curso || []).includes(subfiltrosAtuais.curso));
  }

  if (selectTipo.value !== "todos") {
    anuncios = anuncios.filter((a) => a.tipo === selectTipo.value);
  }

  renderGrid(grid, anuncios, empty);
}

function configurarSubfiltros() {
  // Rede de segurança: se a lista ainda não estiver montada quando abrir,
  // monta na hora (o <details> já abre sozinho, sem depender disso).
  cursoDropdown.addEventListener("toggle", () => {
    if (cursoDropdown.open && !cursoPainel.children.length) preencherCursos();
  });

  // Fecha ao clicar fora ou apertar Esc.
  document.addEventListener("click", (event) => {
    if (!cursoDropdown.contains(event.target)) cursoDropdown.open = false;
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") cursoDropdown.open = false;
  });
}

// A Home manda pro catálogo já com um filtro na URL (busca, categoria ou
// tipo), vindo da barra de busca e dos chips. Aplica esses valores nos
// controles antes do primeiro carregamento.
// Devolve se algo que afeta a busca no servidor (categoria ou texto) mudou
// — é o que decide se precisa buscar nos anúncios de novo.
function aplicarFiltrosDaURL() {
  const params = new URLSearchParams(window.location.search);
  let precisaRebuscar = false;

  const q = params.get("q");
  if (q) {
    inputBusca.value = q;
    precisaRebuscar = true;
  }

  const categoria = params.get("categoria");
  if (categoria && api.categorias.includes(categoria)) {
    selectCategoria.value = categoria;
    precisaRebuscar = true;
  }

  const tipo = params.get("tipo");
  if (tipo && ["doacao", "venda"].includes(tipo)) {
    selectTipo.value = tipo;
  }

  return precisaRebuscar;
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
  configurarSubfiltros();
  configurarBotaoFiltros();
  inputBusca.addEventListener("input", carregarCatalogo);
  selectTipo.addEventListener("change", carregarCatalogo);
  selectOrdenar.addEventListener("change", carregarCatalogo);

  // Dispara os anúncios e as opções de filtro em paralelo, em vez de esperar
  // um terminar pra só então começar o outro — isso dobrava o tempo até
  // aparecer algo em tela. Antes das opções chegarem, o select de categoria
  // ainda está vazio, então essa primeira busca já sai sem filtro de
  // categoria (mesmo resultado de "todas" — não desperdiça nada).
  const opcoesPromise = api.carregarOpcoes();
  carregarCatalogo();

  await opcoesPromise;
  // A lista de cursos é fixa (não depende dos anúncios), então já monta aqui
  // — assim o dropdown nunca abre vazio.
  preencherCursos();
  renderFiltroBox(selectCategoria, api.categorias, () => {
    subfiltrosAtuais = { curso: "todas" };
    preencherCursos();
    carregarCatalogo();
  });

  // Filtro vindo da Home (ex.: ?categoria=Livros) só dá pra validar depois
  // que api.categorias existe — se mudou algo que afeta a busca, busca de
  // novo (a primeira busca, sem filtro, já apareceu na tela nesse meio-tempo).
  if (aplicarFiltrosDaURL()) carregarCatalogo();
}

init();
