/**
 * Página inicial: mostra uma prévia de itens anunciados escolhidos ao
 * acaso a cada visita (sem filtro — o catálogo completo e filtrável vive
 * em catalogo.html). A escolha aleatória é feita no banco (ORDER BY
 * RANDOM() + LIMIT), não baixando o catálogo inteiro só pra sortear 4.
 */

async function carregarPreview() {
  const grid = document.getElementById("grid-preview");
  const empty = document.getElementById("preview-empty");
  const anuncios = await api.listarAnuncios({ categoria: "todas", aleatorio: true, limit: 6 });
  renderGrid(grid, anuncios, empty);
  // Layout 2 grandes (esquerda) + 4 menores (direita, 2x2) + 4 na linha de
  // baixo. Precisa de pelo menos 6 pra o bloco de cima fechar; a partir daí
  // os que sobrarem (até 10) preenchem a linha de baixo.
  grid.classList.toggle("grid-destaque", anuncios.length >= 6);
}

carregarPreview();
