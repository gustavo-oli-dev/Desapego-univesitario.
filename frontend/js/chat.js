/**
 * Página Chat: lista as conversas do usuário e o painel de mensagens da
 * conversa selecionada. Mensagens novas chegam por polling (busca a cada
 * poucos segundos) — sem WebSocket, de propósito, pra manter simples.
 *
 * Também cuida do pedido de "confirmar venda" (uma pessoa solicita, a
 * outra aceita — isso fecha a conversa e soma na credibilidade de quem
 * vendeu) e da denúncia da conversa.
 */

exigirLogin();

const INTERVALO_POLLING_MS = 4000;

let conversaAtual = null;
let intervaloMensagens = null;
let intervaloLista = null;
let arquivoImagemChat = null;

function termoConfirmacao() {
  return conversaAtual && conversaAtual.anuncio_tipo === "doacao" ? "doação" : "venda";
}

function renderAvatarChat(elemento, foto, nome) {
  preencherAvatar(elemento, foto, nome);
}

function renderListaConversas(conversas) {
  const lista = document.getElementById("chat-lista");
  lista.innerHTML = "";

  if (conversas.length === 0) {
    lista.innerHTML = '<p class="empty-state">Você ainda não tem conversas.</p>';
    return;
  }

  conversas.forEach((conversa) => {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "chat-lista__item";
    if (conversaAtual && conversa.id === conversaAtual.id) item.classList.add("chat-lista__item--ativo");

    const avatar = document.createElement("div");
    avatar.className = "perfil-foto__avatar chat-lista__avatar";
    renderAvatarChat(avatar, conversa.outro_usuario.foto, conversa.outro_usuario.nome);

    const info = document.createElement("div");
    info.className = "chat-lista__info";
    const nome = document.createElement("div");
    nome.className = "chat-lista__nome";
    nome.textContent = conversa.outro_usuario.nome;
    const preview = document.createElement("div");
    preview.className = "chat-lista__preview";
    preview.textContent = conversa.ultima_mensagem
      ? (conversa.ultima_mensagem.texto || "📷 Foto")
      : conversa.anuncio_titulo;
    info.append(nome, preview);

    item.append(avatar, info);
    item.addEventListener("click", () => abrirConversa(conversa));
    lista.appendChild(item);
  });
}

async function carregarListaConversas() {
  const conversas = await api.listarConversas();
  renderListaConversas(conversas);
  return conversas;
}

function renderMensagens(mensagens) {
  const container = document.getElementById("chat-mensagens");
  const estavaNoFim = container.scrollHeight - container.scrollTop - container.clientHeight < 40;

  container.innerHTML = "";
  mensagens.forEach((msg) => {
    const bolha = document.createElement("div");
    bolha.className = `chat-bolha ${msg.minha ? "chat-bolha--minha" : "chat-bolha--outro"}`;
    if (msg.imagem) {
      const img = document.createElement("img");
      img.className = "chat-bolha__imagem";
      img.src = resolverUrlFoto(msg.imagem);
      img.alt = "";
      bolha.appendChild(img);
    }
    if (msg.texto) {
      const texto = document.createElement("span");
      texto.textContent = msg.texto;
      bolha.appendChild(texto);
    }
    container.appendChild(bolha);
  });

  if (estavaNoFim) container.scrollTop = container.scrollHeight;
}

async function atualizarMensagens() {
  if (!conversaAtual) return;
  const mensagens = await api.listarMensagens(conversaAtual.id);
  renderMensagens(mensagens);
}

async function atualizarConfirmacao() {
  if (!conversaAtual) return;

  const banner = document.getElementById("chat-confirmacao");
  const texto = document.getElementById("chat-confirmacao-texto");
  const acoes = document.getElementById("chat-confirmacao-acoes");
  const botaoConfirmar = document.getElementById("btn-confirmar-venda");

  const termo = termoConfirmacao();
  const pedido = await api.obterConfirmacaoVenda(conversaAtual.id);

  if (pedido && pedido.status === "aceita") {
    banner.hidden = false;
    acoes.hidden = true;
    botaoConfirmar.hidden = true;
    texto.textContent = `✅ ${termo === "doação" ? "Doação" : "Venda"} confirmada!`;
    return;
  }

  if (!pedido || pedido.status !== "pendente") {
    banner.hidden = true;
    acoes.hidden = true;
    // Só quem vende pode pedir a confirmação — quem compra nem vê o botão.
    botaoConfirmar.hidden = !conversaAtual.sou_vendedor;
    return;
  }

  botaoConfirmar.hidden = true;
  banner.hidden = false;

  if (pedido.minha_solicitacao) {
    texto.textContent = `Você pediu pra confirmar a ${termo}. Aguardando a outra pessoa aceitar...`;
    acoes.hidden = true;
  } else {
    texto.textContent = `Deseja aceitar a confirmação da ${termo}?`;
    acoes.hidden = false;
  }
}

// Posiciona o painel fixo da conversa (mobile): topo logo abaixo do cabeçalho,
// base logo acima da barra inferior. Quando o teclado abre, a barra some atrás
// dele — então a base passa a ser a ALTURA DO TECLADO (medida pela
// VisualViewport API), colando o campo de digitar bem em cima do teclado, sem
// aquele vão cinza que aparecia.
function ajustarAlturaChat() {
  const topbar = document.querySelector(".topbar");
  const nav = document.querySelector(".bottom-nav");
  const topo = topbar ? topbar.offsetHeight : 0;
  const navBase = nav ? nav.offsetHeight : 0;

  const vv = window.visualViewport;
  const alturaLayout = window.innerHeight;
  const alturaVisivel = vv ? vv.height : alturaLayout;
  const offsetTopo = vv ? vv.offsetTop : 0;
  // O quanto o teclado "comeu" da tela (0 = teclado fechado).
  const teclado = Math.max(0, alturaLayout - alturaVisivel - offsetTopo);
  const tecladoAberto = teclado > 120;

  document.documentElement.style.setProperty("--chat-topo", `${topo}px`);
  document.documentElement.style.setProperty("--chat-base", `${tecladoAberto ? teclado : navBase}px`);
}

function abrirConversa(conversa) {
  conversaAtual = conversa;

  // No mobile a lista e a conversa não cabem juntas: abrir uma conversa
  // troca a tela (lista some, conversa ocupa tudo) — igual WhatsApp/OLX.
  // No desktop as duas colunas convivem e essas classes não mudam nada.
  document.querySelector(".chat-layout").classList.add("conversa-aberta");
  document.body.classList.add("chat-em-conversa");
  ajustarAlturaChat();

  document.getElementById("chat-vazio").hidden = true;
  document.getElementById("chat-ativo").hidden = false;
  document.getElementById("chat-nome-outro").textContent = conversa.outro_usuario.nome;
  document.getElementById("chat-anuncio-titulo").textContent = conversa.anuncio_titulo;
  document.getElementById("chat-link-perfil").href = `perfil-publico.html?id=${conversa.outro_usuario.id}`;
  renderAvatarChat(document.getElementById("chat-avatar-outro"), conversa.outro_usuario.foto, conversa.outro_usuario.nome);

  carregarListaConversas();
  atualizarMensagens();
  atualizarConfirmacao();

  clearInterval(intervaloMensagens);
  intervaloMensagens = setInterval(() => {
    atualizarMensagens();
    atualizarConfirmacao();
  }, INTERVALO_POLLING_MS);
}

// "Voltar" (mobile): fecha a conversa e mostra a lista de novo. Para o
// polling de mensagens (não faz sentido buscar mensagens de uma conversa
// que nem está aberta) — a lista continua se atualizando sozinha.
function configurarVoltarLista() {
  const botao = document.getElementById("chat-voltar-lista");
  if (!botao) return;
  botao.addEventListener("click", () => {
    document.querySelector(".chat-layout").classList.remove("conversa-aberta");
    document.body.classList.remove("chat-em-conversa");
    document.getElementById("chat-ativo").hidden = true;
    document.getElementById("chat-vazio").hidden = false;
    conversaAtual = null;
    clearInterval(intervaloMensagens);
    carregarListaConversas();
  });
}

function configurarEnvioMensagem() {
  const form = document.getElementById("form-chat-mensagem");
  const inputImagem = document.getElementById("f-imagem-chat");

  inputImagem.addEventListener("change", () => {
    const arquivo = inputImagem.files[0];
    if (!arquivo) return;

    // Aqui a foto é enviada na hora, sem botão de confirmar — então avisar
    // antes do upload evita a espera inteira pra depois falhar.
    const { grandes } = separarImagensPorTamanho([arquivo]);
    if (grandes.length) {
      alert(mensagemImagemGrande(grandes));
      inputImagem.value = "";
      return;
    }

    // Guarda o arquivo original (vai direto no FormData, sem passar por
    // base64) e já submete — foto não espera clicar em "Enviar".
    arquivoImagemChat = arquivo;
    form.requestSubmit();
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const input = document.getElementById("f-mensagem");
    const texto = input.value.trim();
    if ((!texto && !arquivoImagemChat) || !conversaAtual) return;

    input.value = "";
    const arquivoImagem = arquivoImagemChat;
    arquivoImagemChat = null;
    inputImagem.value = "";

    await api.enviarMensagem(conversaAtual.id, { texto: texto || null, arquivoImagem });
    atualizarMensagens();
  });
}

function configurarConfirmacaoVenda() {
  document.getElementById("btn-confirmar-venda").addEventListener("click", async () => {
    if (!conversaAtual) return;
    await api.solicitarConfirmacaoVenda(conversaAtual.id);
    atualizarConfirmacao();
  });

  document.getElementById("btn-aceitar-venda").addEventListener("click", async () => {
    if (!conversaAtual) return;
    await api.responderConfirmacaoVenda(conversaAtual.id, true);
    atualizarConfirmacao();
  });

  document.getElementById("btn-recusar-venda").addEventListener("click", async () => {
    if (!conversaAtual) return;
    await api.responderConfirmacaoVenda(conversaAtual.id, false);
    atualizarConfirmacao();
  });
}

function configurarMenuChat() {
  const botao = document.getElementById("btn-menu-chat");
  const lista = document.getElementById("lista-menu-chat");

  botao.addEventListener("click", (event) => {
    event.stopPropagation();
    const abrindo = lista.hidden;
    lista.hidden = !abrindo;
    botao.setAttribute("aria-expanded", String(abrindo));
  });

  document.addEventListener("click", (event) => {
    if (!lista.hidden && !event.target.closest(".menu-opcoes")) lista.hidden = true;
  });

  document.getElementById("btn-abrir-denuncia-chat").addEventListener("click", () => {
    lista.hidden = true;
    document.getElementById("modal-denuncia-chat").hidden = false;
  });
}

function configurarDenunciaChat() {
  const modal = document.getElementById("modal-denuncia-chat");
  const form = document.getElementById("form-denuncia-chat");
  const feedback = document.getElementById("form-feedback-denuncia-chat");
  const btn = form.querySelector('button[type="submit"]');
  const btnLabel = btn.querySelector(".btn__label");
  const btnSpinner = btn.querySelector(".btn__spinner");
  const posDenuncia = document.getElementById("pos-denuncia-bloqueio-chat");
  const posDenunciaTexto = document.getElementById("pos-denuncia-bloqueio-chat-texto");
  const btnSimBloquear = document.getElementById("btn-sim-bloquear-chat");
  const btnNaoBloquear = document.getElementById("btn-nao-bloquear-chat");

  const selectMotivo = document.getElementById("f-motivo-denuncia-chat");
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

  document.getElementById("btn-cancelar-denuncia-chat").addEventListener("click", fecharModal);
  btnNaoBloquear.addEventListener("click", fecharModal);

  btnSimBloquear.addEventListener("click", async () => {
    if (!conversaAtual) return;
    btnSimBloquear.disabled = true;
    try {
      await api.bloquearUsuario(conversaAtual.outro_usuario.id);
      posDenunciaTexto.textContent = `Pronto — os anúncios de ${conversaAtual.outro_usuario.nome} não vão mais aparecer pra você.`;
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
    if (!conversaAtual) return;
    feedback.textContent = "";
    feedback.className = "form-feedback";

    btn.disabled = true;
    btnLabel.hidden = true;
    btnSpinner.hidden = false;

    try {
      await api.denunciarAnuncio(conversaAtual.anuncio_id, form.motivo.value);
      form.hidden = true;
      posDenunciaTexto.textContent = `Deseja também bloquear ${conversaAtual.outro_usuario.nome}? Os anúncios dessa pessoa não vão mais aparecer pra você.`;
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
  await api.carregarOpcoes();

  configurarEnvioMensagem();
  configurarConfirmacaoVenda();
  configurarMenuChat();
  configurarDenunciaChat();
  configurarVoltarLista();
  // Recalcula o painel ao girar a tela e, principalmente, quando o teclado
  // abre/fecha (a VisualViewport dispara 'resize'/'scroll' nesses casos).
  window.addEventListener("resize", ajustarAlturaChat);
  if (window.visualViewport) {
    window.visualViewport.addEventListener("resize", ajustarAlturaChat);
    window.visualViewport.addEventListener("scroll", ajustarAlturaChat);
  }

  const conversas = await carregarListaConversas();
  intervaloLista = setInterval(carregarListaConversas, INTERVALO_POLLING_MS);

  const idParam = new URLSearchParams(window.location.search).get("id");
  if (idParam) {
    const conversa = conversas.find((c) => c.id === Number(idParam));
    if (conversa) abrirConversa(conversa);
  }
}

init();
