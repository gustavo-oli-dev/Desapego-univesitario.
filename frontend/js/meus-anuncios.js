/**
 * Página Meus Anúncios: lista os itens publicados pelo usuário logado,
 * separados em abas Ativos/Vendidos (cada aba busca da API já filtrada,
 * com paginação por offset e um botão "Carregar mais"), e permite editar
 * ou remover cada um.
 */

exigirLogin();

const ITENS_POR_PAGINA = 20;

let abaAtual = "ativos";
let offsetAtual = 0;

async function removerAnuncioOtimista(id, cardElemento) {
  await api.removerAnuncio(id);
  // Remoção otimista: tira o card do DOM direto, sem rebaixar a lista
  // inteira do servidor de novo.
  cardElemento.remove();
}

async function carregarPagina({ anexar }) {
  const grid = document.getElementById("grid-meus");
  const empty = document.getElementById("meus-empty");
  const btnCarregarMais = document.getElementById("btn-carregar-mais");

  const anuncios = await api.listarMeusAnuncios({
    vendido: abaAtual === "vendidos",
    limit: ITENS_POR_PAGINA,
    offset: offsetAtual,
  });

  renderGrid(grid, anuncios, empty, {
    anexar,
    permitirEditar: true,
    permitirRemover: true,
    onRemover: removerAnuncioOtimista,
  });

  // Só mais uma página pra carregar se essa veio cheia (senão já era a
  // última) — heurística simples, sem precisar de um count() à parte.
  btnCarregarMais.hidden = anuncios.length < ITENS_POR_PAGINA;
}

function mostrarAba(aba) {
  abaAtual = aba;
  offsetAtual = 0;

  document.querySelectorAll(".abas-anuncios__botao").forEach((b) => {
    b.classList.toggle("is-ativa", b.dataset.aba === aba);
  });

  const emptyTexto = document.getElementById("meus-empty-texto");
  const emptyCta = document.getElementById("meus-empty-cta");
  if (aba === "vendidos") {
    emptyTexto.textContent = "Nenhum anúncio vendido ainda.";
    emptyCta.hidden = true;
  } else {
    emptyTexto.textContent = "Você ainda não anunciou nada.";
    emptyCta.hidden = false;
  }

  carregarPagina({ anexar: false });
}

function configurarAbas() {
  document.querySelectorAll(".abas-anuncios__botao").forEach((botao) => {
    botao.addEventListener("click", () => mostrarAba(botao.dataset.aba));
  });
}

function configurarCarregarMais() {
  document.getElementById("btn-carregar-mais").addEventListener("click", () => {
    offsetAtual += ITENS_POR_PAGINA;
    carregarPagina({ anexar: true });
  });
}

configurarAbas();
configurarCarregarMais();
mostrarAba("ativos");
