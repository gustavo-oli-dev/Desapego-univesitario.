/**
 * Página de detalhes de um anúncio (?id=<id>). Só acessível logado —
 * quem clica num anúncio sem estar logado é mandado pro login primeiro.
 */

exigirLogin();

const ICONE_WHATSAPP =
  '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.45 1.32 4.95L2.05 22l5.25-1.38a9.9 9.9 0 0 0 4.74 1.21h.01c5.46 0 9.91-4.45 9.91-9.91 0-2.65-1.03-5.14-2.9-7.01A9.82 9.82 0 0 0 12.04 2zm5.8 14.02c-.24.68-1.4 1.3-1.93 1.35-.5.05-1.03.24-3.44-.72-2.9-1.15-4.76-4.14-4.9-4.33-.14-.19-1.17-1.56-1.17-2.98s.74-2.11 1-2.4c.26-.29.57-.36.76-.36.19 0 .38 0 .55.01.18.01.42-.07.65.5.24.58.81 2.01.88 2.15.07.14.12.31.02.5-.1.19-.15.31-.29.48-.15.17-.31.38-.44.51-.15.15-.3.31-.13.6.17.29.75 1.24 1.62 2 1.11.99 2.05 1.3 2.34 1.44.29.15.46.13.63-.08.17-.2.72-.84.91-1.13.19-.29.38-.24.63-.14.26.1 1.65.78 1.94.92.29.14.48.22.55.34.07.13.07.72-.17 1.41z"/></svg>';

function renderDetalhe(anuncio) {
  const container = document.getElementById("detalhe-anuncio");
  container.innerHTML = "";
  const slug = slugCategoria(anuncio.categoria);

  const imagens = (anuncio.imagens && anuncio.imagens.length > 0
    ? anuncio.imagens
    : (anuncio.imagem ? [anuncio.imagem] : [])
  ).map(resolverUrlFoto);

  const galeria = document.createElement("div");
  galeria.className = "detalhe__galeria";

  const imgPrincipal = document.createElement("div");
  imgPrincipal.className = `detalhe__img img--${slug}`;
  if (imagens.length > 0) {
    imgPrincipal.style.backgroundImage = `url("${imagens[0]}")`;
  } else {
    imgPrincipal.textContent = ICONE_POR_CATEGORIA[anuncio.categoria] || "📦";
  }
  galeria.appendChild(imgPrincipal);

  if (imagens.length > 1) {
    const miniaturas = document.createElement("div");
    miniaturas.className = "detalhe__miniaturas";
    imagens.forEach((src, indice) => {
      const mini = document.createElement("button");
      mini.type = "button";
      mini.className = "detalhe__miniatura";
      if (indice === 0) mini.classList.add("detalhe__miniatura--ativa");
      mini.style.backgroundImage = `url("${src}")`;
      mini.addEventListener("click", () => {
        imgPrincipal.style.backgroundImage = `url("${src}")`;
        miniaturas.querySelectorAll(".detalhe__miniatura").forEach((m) => m.classList.remove("detalhe__miniatura--ativa"));
        mini.classList.add("detalhe__miniatura--ativa");
      });
      miniaturas.appendChild(mini);
    });
    galeria.appendChild(miniaturas);
  }

  const info = document.createElement("div");
  info.className = "detalhe__info";

  const badgeCategoria = document.createElement("span");
  badgeCategoria.className = `badge badge--${slug}`;
  badgeCategoria.textContent = anuncio.categoria;

  const titulo = document.createElement("h1");
  titulo.textContent = anuncio.titulo;

  const descricao = document.createElement("p");
  descricao.textContent = anuncio.descricao;

  info.append(badgeCategoria, titulo, descricao);

  const tags = [
    ...(anuncio.curso || []).map((v) => `Curso: ${v}`),
    ...(anuncio.materia || []).map((v) => `Matéria: ${v}`),
    ...(anuncio.autor || []).map((v) => `Autor: ${v}`),
  ];
  if (tags.length > 0) {
    const tagsEl = document.createElement("div");
    tagsEl.className = "detalhe__tags";
    tags.forEach((texto) => {
      const tag = document.createElement("span");
      tag.className = "badge";
      tag.textContent = texto;
      tagsEl.appendChild(tag);
    });
    info.appendChild(tagsEl);
  }

  const preco = document.createElement("strong");
  preco.className = "detalhe__preco";
  if (anuncio.tipo === "doacao") {
    preco.textContent = "Doação";
  } else {
    const temOferta = anuncio.preco_original && anuncio.preco_original > anuncio.preco;
    if (temOferta) {
      preco.appendChild(document.createTextNode(`R$ ${Number(anuncio.preco).toFixed(2)}`));

      const original = document.createElement("span");
      original.className = "preco-original";
      original.textContent = `R$ ${Number(anuncio.preco_original).toFixed(2)}`;
      preco.appendChild(original);

      const selo = document.createElement("span");
      selo.className = "badge-oferta";
      selo.textContent = "Oferta";
      preco.appendChild(selo);
    } else {
      preco.textContent = `R$ ${Number(anuncio.preco).toFixed(2)}`;
    }
    preco.classList.add("preco--venda");
  }
  info.appendChild(preco);

  const dataEl = document.createElement("p");
  dataEl.className = "detalhe__data";
  dataEl.textContent = `Publicado em ${new Date(anuncio.criado_em).toLocaleDateString("pt-BR")}`;
  info.appendChild(dataEl);

  const souDono = String(anuncio.user_id) === String(obterIdUsuarioAtual());

  if (souDono) {
    const aviso = document.createElement("p");
    aviso.className = "form-feedback";
    aviso.textContent = "Esse anúncio é seu — veja em \"Meus anúncios\" pra editar ou marcar oferta.";
    info.appendChild(aviso);
  } else {
    if (anuncio.telefone_publico && anuncio.telefone_vendedor) {
      const digitos = anuncio.telefone_vendedor.replace(/\D/g, "");
      const mensagem = `Olá! Vi seu anúncio "${anuncio.titulo}" no Desapego Universitário e queria saber mais.`;

      const botaoWpp = document.createElement("a");
      botaoWpp.className = "btn btn--whatsapp";
      botaoWpp.href = `https://wa.me/55${digitos}?text=${encodeURIComponent(mensagem)}`;
      botaoWpp.target = "_blank";
      botaoWpp.rel = "noopener noreferrer";
      botaoWpp.innerHTML = `${ICONE_WHATSAPP} Chamar no WhatsApp`;
      info.appendChild(botaoWpp);
    }

    const botaoChat = document.createElement("button");
    botaoChat.type = "button";
    botaoChat.className = "btn btn--primary";
    botaoChat.id = "btn-chat";
    botaoChat.textContent = "💬 Conversar sobre esse item";
    info.appendChild(botaoChat);

    const feedbackChat = document.createElement("p");
    feedbackChat.className = "form-feedback";
    feedbackChat.id = "feedback-chat";
    info.appendChild(feedbackChat);

    botaoChat.addEventListener("click", async () => {
      botaoChat.disabled = true;
      try {
        const conversa = await api.iniciarConversa(anuncio.id);
        window.location.href = `chat.html?id=${conversa.id}`;
      } catch (err) {
        feedbackChat.textContent = "Não foi possível iniciar a conversa.";
        feedbackChat.classList.add("is-error");
        botaoChat.disabled = false;
      }
    });
  }

  container.append(galeria, info);
}

function configurarMenuOpcoes(anuncio) {
  const botaoMenu = document.getElementById("btn-menu-opcoes");
  const lista = document.getElementById("lista-menu-opcoes");
  const linkPerfil = document.getElementById("link-visitar-perfil");
  const btnDenunciar = document.getElementById("btn-abrir-denuncia");

  linkPerfil.href = `perfil-publico.html?id=${anuncio.user_id}`;

  function fecharMenu() {
    lista.hidden = true;
    botaoMenu.setAttribute("aria-expanded", "false");
  }

  botaoMenu.addEventListener("click", (event) => {
    event.stopPropagation();
    const abrindo = lista.hidden;
    lista.hidden = !abrindo;
    botaoMenu.setAttribute("aria-expanded", String(abrindo));
  });

  document.addEventListener("click", (event) => {
    if (!lista.hidden && !event.target.closest(".menu-opcoes")) fecharMenu();
  });

  btnDenunciar.addEventListener("click", () => {
    fecharMenu();
    document.getElementById("modal-denuncia").hidden = false;
  });
}

function configurarDenuncia(anuncioId, donoId, donoNome) {
  const modal = document.getElementById("modal-denuncia");
  const form = document.getElementById("form-denuncia");
  const feedback = document.getElementById("form-feedback-denuncia");
  const btn = form.querySelector('button[type="submit"]');
  const btnLabel = btn.querySelector(".btn__label");
  const btnSpinner = btn.querySelector(".btn__spinner");
  const posDenuncia = document.getElementById("pos-denuncia-bloqueio");
  const posDenunciaTexto = document.getElementById("pos-denuncia-bloqueio-texto");
  const btnSimBloquear = document.getElementById("btn-sim-bloquear");
  const btnNaoBloquear = document.getElementById("btn-nao-bloquear");

  const selectMotivo = document.getElementById("f-motivo-denuncia");
  selectMotivo.innerHTML = api.motivosDenuncia.map((m) => `<option value="${m}">${m}</option>`).join("");

  function fecharModal() {
    modal.hidden = true;
    form.hidden = false;
    posDenuncia.hidden = true;
    btnSimBloquear.hidden = false;
    btnNaoBloquear.textContent = "Não, obrigado";
    feedback.textContent = "";
    feedback.className = "form-feedback";
  }

  document.getElementById("btn-cancelar-denuncia").addEventListener("click", fecharModal);
  btnNaoBloquear.addEventListener("click", fecharModal);

  btnSimBloquear.addEventListener("click", async () => {
    btnSimBloquear.disabled = true;
    try {
      await api.bloquearUsuario(donoId);
      posDenunciaTexto.textContent = `Pronto — os anúncios de ${donoNome} não vão mais aparecer pra você.`;
      btnSimBloquear.hidden = true;
      btnNaoBloquear.textContent = "Fechar";
    } catch (err) {
      posDenunciaTexto.textContent = "Não foi possível bloquear agora. Tente de novo mais tarde.";
    } finally {
      btnSimBloquear.disabled = false;
    }
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    feedback.textContent = "";
    feedback.className = "form-feedback";

    btn.disabled = true;
    btnLabel.hidden = true;
    btnSpinner.hidden = false;

    try {
      await api.denunciarAnuncio(anuncioId, form.motivo.value);
      form.hidden = true;
      posDenunciaTexto.textContent = `Deseja também bloquear ${donoNome}? Os anúncios dessa pessoa não vão mais aparecer pra você.`;
      posDenuncia.hidden = false;
    } catch (err) {
      feedback.textContent = "Não foi possível enviar a denúncia agora. Tente novamente.";
      feedback.classList.add("is-error");
    } finally {
      btn.disabled = false;
      btnLabel.hidden = false;
      btnSpinner.hidden = true;
    }
  });
}

async function init() {
  const id = new URLSearchParams(window.location.search).get("id");
  if (!id) {
    window.location.href = "catalogo.html";
    return;
  }

  try {
    await api.carregarOpcoes();
    const anuncio = await api.buscarAnuncio(id);
    renderDetalhe(anuncio);
    configurarMenuOpcoes(anuncio);
    const dono = await api.obterPerfilPublico(anuncio.user_id).catch(() => null);
    configurarDenuncia(id, anuncio.user_id, dono ? dono.nome : "esse usuário");
  } catch (err) {
    window.location.href = "catalogo.html";
  }
}

init();
