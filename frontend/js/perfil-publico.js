/**
 * Página de perfil público: mostra nome + foto de outro usuário e os
 * anúncios publicados por ele. Não exige login (qualquer um pode ver).
 */

function renderAvatarPublico(foto, nome) {
  preencherAvatar(document.getElementById("pp-avatar"), foto, nome);
}

// Cada clique numa aba busca da API já filtrado (?usuario=&vendido=) em
// vez de baixar tudo de uma vez e filtrar no cliente.
function configurarAbas(donoId) {
  const grid = document.getElementById("grid-perfil-publico");
  const empty = document.getElementById("perfil-publico-empty");
  const botoes = document.querySelectorAll(".abas-anuncios__botao");

  async function mostrarAba(aba) {
    botoes.forEach((b) => b.classList.toggle("is-ativa", b.dataset.aba === aba));
    const anuncios = await api.listarAnuncios({ usuario: donoId, vendido: aba === "vendidos" });
    renderGrid(grid, anuncios, empty);
  }

  botoes.forEach((botao) => {
    botao.addEventListener("click", () => mostrarAba(botao.dataset.aba));
  });

  mostrarAba("ativos");
}

async function init() {
  const id = new URLSearchParams(window.location.search).get("id");
  if (!id) {
    window.location.href = "catalogo.html";
    return;
  }

  try {
    const perfil = await api.obterPerfilPublico(id);

    document.getElementById("pp-nome").textContent = perfil.nome;
    renderAvatarPublico(perfil.foto, perfil.nome);

    const cursoEl = document.getElementById("pp-curso");
    if (perfil.curso || perfil.turno) {
      cursoEl.textContent = [perfil.curso, perfil.turno].filter(Boolean).join(" · ");
      cursoEl.hidden = false;
    }

    configurarAbas(id);
  } catch (err) {
    window.location.href = "catalogo.html";
  }
}

init();
