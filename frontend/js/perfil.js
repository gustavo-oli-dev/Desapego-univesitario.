/**
 * Página Meu perfil: editar nome/telefone, e trocar senha em 2 passos
 * (pedido + código de confirmação, o mesmo esquema do 2FA do login).
 */

exigirLogin();

document.getElementById("btn-sair-perfil-mobile").addEventListener("click", sair);

// fotoAtual é o caminho que o servidor conhece (pra restaurar no Cancelar).
// arquivoFotoSelecionado só existe quando a pessoa escolhe um arquivo novo
// nesta sessão de edição — é o que de fato vai no upload.
let fotoAtual = "";
let arquivoFotoSelecionado = null;

function renderAvatarPerfil(foto, nome) {
  // preencherAvatar (site.js) cuida do caso da foto não carregar, caindo na
  // inicial em vez de deixar o ícone de imagem quebrada.
  preencherAvatar(document.getElementById("perfil-foto-avatar"), foto, nome);
}

function preencherSelect(select, opcoes, valorAtual) {
  select.innerHTML = '<option value="">Selecionar...</option>' +
    opcoes.map((o) => `<option value="${o}">${o}</option>`).join("");
  select.value = valorAtual || "";
}

// --- Campo de Curso (mesmo componente do filtro do catálogo) ---------------
// Lista longa (44 cursos), então é <details> com altura limitada e scroll em
// vez de <select> — a lista aberta de um select nativo não aceita altura.
const cursoDropdown = document.getElementById("curso-dropdown");
const cursoBotao = document.getElementById("curso-botao");
const cursoPainel = document.getElementById("curso-painel");
const cursoValor = document.getElementById("f-curso");

function definirCurso(valor) {
  cursoValor.value = valor || "";
  cursoBotao.textContent = valor || "Selecionar...";
  cursoPainel.querySelectorAll("li").forEach((li) => {
    li.setAttribute("aria-selected", String(li.dataset.valor === (valor || "")));
  });
}

function preencherCursos(valorAtual) {
  const cursos = [...api.cursos].sort((a, b) => a.localeCompare(b, "pt-BR"));
  cursoPainel.innerHTML = "";

  // "" = nenhum curso escolhido (equivale ao "Selecionar..." do select antigo)
  ["", ...cursos].forEach((valor) => {
    const item = document.createElement("li");
    item.className = "lista-opcoes__item";
    item.dataset.valor = valor;
    item.textContent = valor || "Selecionar...";
    item.addEventListener("click", () => {
      definirCurso(valor);
      cursoDropdown.open = false;
    });
    cursoPainel.appendChild(item);
  });

  definirCurso(valorAtual);
}

// Fora do modo de edição o campo não pode abrir (equivalente ao disabled).
function definirCursoEditavel(editavel) {
  cursoDropdown.classList.toggle("lista-opcoes--bloqueada", !editavel);
  if (!editavel) cursoDropdown.open = false;
}

async function carregarPerfil() {
  const form = document.getElementById("form-perfil");
  try {
    await api.carregarOpcoes();
    const perfil = await api.obterPerfil();
    form.nome.value = perfil.nome;
    form.telefone.value = perfil.telefone || "";
    document.getElementById("f-email").value = perfil.email;
    preencherCursos(perfil.curso);
    definirCursoEditavel(false);
    preencherSelect(form.turno, api.turnos, perfil.turno);
    fotoAtual = perfil.foto || "";
    renderAvatarPerfil(fotoAtual, perfil.nome);

    // Conta criada via Google não tem senha própria — não faz sentido
    // oferecer "trocar senha" pra ela.
    if (!perfil.tem_senha) {
      document.getElementById("secao-trocar-senha").hidden = true;
    }
  } catch (err) {
    exigirLogin();
  }
}

function configurarFotoPerfil() {
  const input = document.getElementById("f-foto");
  const feedback = document.getElementById("form-feedback-perfil");

  input.addEventListener("change", () => {
    const arquivo = input.files[0];
    if (!arquivo) return;

    // Avisa aqui em vez de deixar o upload subir e voltar com erro.
    const { grandes } = separarImagensPorTamanho([arquivo]);
    if (grandes.length) {
      feedback.textContent = mensagemImagemGrande(grandes);
      feedback.className = "form-feedback is-error";
      input.value = "";
      return;
    }

    arquivoFotoSelecionado = arquivo;

    // FileReader aqui é só pra pré-visualização local — o que de fato
    // sobe pro servidor é o arquivo original, direto no FormData.
    const leitor = new FileReader();
    leitor.onload = () => {
      renderAvatarPerfil(leitor.result, document.getElementById("f-nome").value);
    };
    leitor.readAsDataURL(arquivo);
  });
}

function configurarFormularioPerfil() {
  const form = document.getElementById("form-perfil");
  const feedback = document.getElementById("form-feedback-perfil");
  const btnEditar = document.getElementById("btn-editar-perfil");
  const acoesSalvar = document.getElementById("acoes-salvar-perfil");
  const btnSalvar = document.getElementById("btn-salvar-perfil");
  const btnCancelar = document.getElementById("btn-cancelar-perfil");
  const btnLabel = btnSalvar.querySelector(".btn__label");
  const btnSpinner = btnSalvar.querySelector(".btn__spinner");
  const labelTrocarFoto = document.getElementById("label-trocar-foto");

  configurarCampoTelefone(document.getElementById("f-telefone"));

  let valoresOriginais = { nome: "", telefone: "", curso: "", turno: "" };

  function ativarEdicao() {
    valoresOriginais = {
      nome: form.nome.value,
      telefone: form.telefone.value,
      curso: form.curso.value,
      turno: form.turno.value,
    };
    form.nome.disabled = false;
    form.telefone.disabled = false;
    definirCursoEditavel(true);
    form.turno.disabled = false;
    form.nome.focus();
    btnEditar.hidden = true;
    acoesSalvar.hidden = false;
    labelTrocarFoto.hidden = false;
  }

  function voltarParaVisualizacao() {
    form.nome.disabled = true;
    form.telefone.disabled = true;
    definirCursoEditavel(false);
    form.turno.disabled = true;
    btnEditar.hidden = false;
    acoesSalvar.hidden = true;
    labelTrocarFoto.hidden = true;
  }

  btnEditar.addEventListener("click", ativarEdicao);

  btnCancelar.addEventListener("click", () => {
    form.nome.value = valoresOriginais.nome;
    form.telefone.value = valoresOriginais.telefone;
    definirCurso(valoresOriginais.curso);
    form.turno.value = valoresOriginais.turno;
    arquivoFotoSelecionado = null;
    document.getElementById("f-foto").value = "";
    renderAvatarPerfil(fotoAtual, form.nome.value);
    feedback.textContent = "";
    feedback.className = "form-feedback";
    voltarParaVisualizacao();
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    feedback.textContent = "";
    feedback.className = "form-feedback";

    btnSalvar.disabled = true;
    btnLabel.hidden = true;
    btnSpinner.hidden = false;

    try {
      const perfil = await api.atualizarPerfil({
        nome: form.nome.value.trim(),
        telefone: form.telefone.value,
        curso: form.curso.value || null,
        turno: form.turno.value || null,
        arquivoFoto: arquivoFotoSelecionado,
      });
      fotoAtual = perfil.foto || "";
      arquivoFotoSelecionado = null;
      const usuario = obterUsuario();
      salvarSessao(obterToken(), { ...usuario, nome: perfil.nome, foto: perfil.foto });
      renderPerfilTopo();
      voltarParaVisualizacao();
      feedback.textContent = "Dados atualizados.";
      feedback.classList.add("is-success");
    } catch (err) {
      feedback.textContent = "Não foi possível salvar. Tente novamente.";
      feedback.classList.add("is-error");
    } finally {
      btnSalvar.disabled = false;
      btnLabel.hidden = false;
      btnSpinner.hidden = true;
    }
  });
}

function configurarTrocaSenha() {
  const formPedido = document.getElementById("form-trocar-senha");
  const feedbackPedido = document.getElementById("form-feedback-senha");
  const formConfirmar = document.getElementById("form-confirmar-senha");
  const feedbackConfirmar = document.getElementById("form-feedback-confirmar-senha");

  formPedido.addEventListener("submit", async (event) => {
    event.preventDefault();
    feedbackPedido.textContent = "";
    feedbackPedido.className = "form-feedback";

    const btn = formPedido.querySelector('button[type="submit"]');
    const btnLabel = btn.querySelector(".btn__label");
    const btnSpinner = btn.querySelector(".btn__spinner");
    btn.disabled = true;
    btnLabel.hidden = true;
    btnSpinner.hidden = false;

    try {
      const resposta = await api.solicitarTrocaSenha({
        senhaAtual: formPedido.senhaAtual.value,
        senhaNova: formPedido.senhaNova.value,
      });
      document.getElementById("aviso-codigo-senha").textContent = textoAvisoCodigo(resposta);
      formConfirmar.hidden = false;
    } catch (err) {
      feedbackPedido.textContent = "Senha atual incorreta.";
      feedbackPedido.classList.add("is-error");
    } finally {
      btn.disabled = false;
      btnLabel.hidden = false;
      btnSpinner.hidden = true;
    }
  });

  formConfirmar.addEventListener("submit", async (event) => {
    event.preventDefault();
    feedbackConfirmar.textContent = "";
    feedbackConfirmar.className = "form-feedback";

    const btn = formConfirmar.querySelector('button[type="submit"]');
    const btnLabel = btn.querySelector(".btn__label");
    const btnSpinner = btn.querySelector(".btn__spinner");
    btn.disabled = true;
    btnLabel.hidden = true;
    btnSpinner.hidden = false;

    try {
      await api.confirmarTrocaSenha(formConfirmar.codigo.value.trim());
      feedbackConfirmar.textContent = "Senha alterada com sucesso.";
      feedbackConfirmar.classList.add("is-success");
      formPedido.reset();
      formConfirmar.reset();
      formConfirmar.hidden = true;
    } catch (err) {
      feedbackConfirmar.textContent = "Código incorreto ou expirado.";
      feedbackConfirmar.classList.add("is-error");
    } finally {
      btn.disabled = false;
      btnLabel.hidden = false;
      btnSpinner.hidden = true;
    }
  });
}

// Mesmo padrão do perfil público: cada aba busca da API já filtrada
// (?usuario=&vendido=), em vez de baixar tudo e filtrar no cliente.
function configurarAbasHistorico() {
  const lista = document.getElementById("lista-historico");
  const empty = document.getElementById("historico-empty");
  const botoes = document.querySelectorAll(".abas-anuncios__botao");
  const meuId = obterIdUsuarioAtual();

  async function mostrarAba(aba) {
    botoes.forEach((b) => b.classList.toggle("is-ativa", b.dataset.aba === aba));
    const anuncios = await api.listarAnuncios({ usuario: meuId, vendido: aba === "vendidos" });
    // Vendido é estado final — editar não faz sentido pra transação já
    // concluída, então só libera na aba Ativos (mesma regra de meus-anuncios.js).
    renderGrid(lista, anuncios, empty, { permitirEditar: aba === "ativos" });
  }

  botoes.forEach((botao) => {
    botao.addEventListener("click", () => mostrarAba(botao.dataset.aba));
  });

  mostrarAba("ativos");
}

carregarPerfil();
configurarAbasHistorico();
configurarFotoPerfil();
configurarFormularioPerfil();
configurarTrocaSenha();
