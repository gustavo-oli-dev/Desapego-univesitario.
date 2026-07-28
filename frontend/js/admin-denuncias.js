/**
 * Painel de moderação: lista as denúncias em duas abas — Ativas (pendentes
 * de averiguação) e Solucionadas (já resolvidas, mostrando qual providência
 * foi tomada). Só quem tem is_admin=1 consegue carregar; o backend recusa os
 * demais com 403 e a página só reage a esse retorno.
 */

exigirLogin();

let abaAtual = "ativa";

// Texto amigável pra cada forma de resolução gravada no banco.
const TEXTO_RESOLUCAO = {
  descartada: "Descartada — sem irregularidade",
  anuncio_removido: "Anúncio removido",
  usuario_banido: "Usuário banido",
};

function criarLink(texto, href) {
  const link = document.createElement("a");
  link.className = "btn btn--ghost btn--sm";
  link.href = href;
  link.textContent = texto;
  return link;
}

function criarBotao(texto, classe) {
  const botao = document.createElement("button");
  botao.type = "button";
  botao.className = `btn ${classe} btn--sm`;
  botao.textContent = texto;
  return botao;
}

function montarItem(d) {
  // O dono só é "válido" quando o backend conseguiu casar com um usuário
  // real — anúncios dos dados de exemplo têm user_id 'seed', sem perfil.
  const donoValido = Boolean(d.anuncio_dono_nome);

  const item = document.createElement("div");
  item.className = "denuncia-item";

  const info = document.createElement("div");
  info.className = "denuncia-item__info";

  // O motivo é o que o admin precisa ler primeiro — vem em destaque.
  const motivo = document.createElement("strong");
  motivo.className = "denuncia-item__motivo";
  motivo.textContent = d.motivo;

  const anuncio = document.createElement("span");
  anuncio.className = "denuncia-item__anuncio";
  anuncio.textContent = d.anuncio_existe
    ? d.anuncio_titulo
    : "Anúncio removido da plataforma";

  const meta = document.createElement("span");
  meta.className = "denuncia-item__meta";
  const dono = d.anuncio_dono_nome || "autor desconhecido";
  const quem = d.denunciante_nome || "alguém";
  const data = new Date(d.criado_em).toLocaleDateString("pt-BR");
  meta.textContent = `Anunciado por ${dono} — denunciado por ${quem} em ${data}`;

  info.append(motivo, anuncio, meta);

  // Nas solucionadas, mostra qual foi a providência tomada.
  if (d.status === "solucionada") {
    const resolucao = document.createElement("span");
    resolucao.className = "denuncia-item__resolucao";
    resolucao.textContent = TEXTO_RESOLUCAO[d.resolucao] || "Solucionada";
    info.appendChild(resolucao);
  }

  item.appendChild(info);

  // Coluna da direita: junta os links de averiguação e as providências.
  const lado = document.createElement("div");
  lado.className = "denuncia-item__lado";

  // --- Links de averiguação: existem nas duas abas -------------------------
  const links = document.createElement("div");
  links.className = "denuncia-item__acoes";

  if (d.anuncio_existe) {
    links.appendChild(criarLink("Visitar anúncio", `anuncio.html?id=${d.anuncio_id}`));
  }
  if (donoValido) {
    links.appendChild(criarLink("Visitar perfil", `perfil-publico.html?id=${d.anuncio_dono_id}`));
  }
  lado.appendChild(links);
  item.appendChild(lado);

  // --- Providências: só na aba de ativas -----------------------------------
  if (d.status !== "ativa") return item;

  const acoes = document.createElement("div");
  acoes.className = "denuncia-item__acoes";

  const btnDescartar = criarBotao("Descartar denúncia", "btn--ghost");
  btnDescartar.addEventListener("click", async () => {
    if (!confirm("Descartar esta denúncia? Ela vai para 'Solucionadas' sem punição.")) return;
    btnDescartar.disabled = true;
    try {
      await api.adminDescartarDenuncia(d.id);
      carregar();
    } catch {
      btnDescartar.disabled = false;
      alert("Não foi possível descartar a denúncia.");
    }
  });
  acoes.appendChild(btnDescartar);

  if (d.anuncio_existe) {
    const btnRemover = criarBotao("Remover anúncio", "btn--danger");
    btnRemover.addEventListener("click", async () => {
      if (!confirm(`Remover o anúncio "${d.anuncio_titulo}"? Essa ação não pode ser desfeita.`)) return;
      btnRemover.disabled = true;
      try {
        await api.adminRemoverAnuncio(d.anuncio_id);
        carregar();
      } catch {
        btnRemover.disabled = false;
        alert("Não foi possível remover o anúncio.");
      }
    });
    acoes.appendChild(btnRemover);
  }

  // Sem dono real não há quem banir (era o que gerava o botão "Banir null").
  if (donoValido && !d.anuncio_dono_banido) {
    const btnBanir = criarBotao(`Banir ${d.anuncio_dono_nome}`, "btn--danger-solido");
    btnBanir.addEventListener("click", async () => {
      if (!confirm(`Banir ${d.anuncio_dono_nome} da plataforma? A pessoa não vai mais conseguir entrar.`)) return;
      btnBanir.disabled = true;
      try {
        await api.adminBanirUsuario(d.anuncio_dono_id);
        carregar();
      } catch {
        btnBanir.disabled = false;
        alert("Não foi possível banir o usuário.");
      }
    });
    acoes.appendChild(btnBanir);
  }

  lado.appendChild(acoes);
  return item;
}

function renderDenuncias(denuncias) {
  const lista = document.getElementById("lista-denuncias");
  const empty = document.getElementById("denuncias-empty");

  lista.innerHTML = "";
  empty.hidden = denuncias.length > 0;
  empty.textContent = abaAtual === "ativa"
    ? "Nenhuma denúncia pendente de averiguação."
    : "Nenhuma denúncia solucionada ainda.";

  denuncias.forEach((d) => lista.appendChild(montarItem(d)));
}

async function carregar() {
  try {
    renderDenuncias(await api.listarTodasDenuncias(abaAtual));
  } catch {
    document.getElementById("denuncias-bloqueado").hidden = false;
    document.getElementById("lista-denuncias").hidden = true;
  }
}

function configurarAbas() {
  document.querySelectorAll(".abas-anuncios__botao").forEach((botao) => {
    botao.addEventListener("click", () => {
      abaAtual = botao.dataset.aba;
      document.querySelectorAll(".abas-anuncios__botao").forEach((b) => {
        b.classList.toggle("is-ativa", b.dataset.aba === abaAtual);
      });
      carregar();
    });
  });
}

configurarAbas();
carregar();
