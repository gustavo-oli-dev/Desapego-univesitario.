/**
 * Página Anunciar: preenche a categoria, alterna o campo de preço
 * conforme doação/venda, controla o campo extra de Livros (o multi-seleção
 * de Curso) e publica o anúncio via api.criarAnuncio.
 *
 * Também serve pra EDITAR: se a URL tiver ?editar=<id>, a página carrega
 * os dados desse anúncio, preenche o formulário e troca o envio pra
 * api.editarAnuncio em vez de api.criarAnuncio.
 */

exigirLogin();

function preencherSelectCategorias() {
  const select = document.getElementById("f-categoria");
  select.innerHTML = api.categorias.map((c) => `<option value="${c}">${c}</option>`).join("");
}

function sincronizarVisibilidadeCamposLivro() {
  const select = document.getElementById("f-categoria");
  const camposLivro = document.getElementById("campos-livro");
  camposLivro.hidden = select.value !== "Livros";
}

// Mesmo componente <details> do filtro de Curso (catalogo.js), adaptado pra
// multi-seleção: cada clique marca/desmarca um item, sem fechar o painel —
// dá pra marcar vários cursos seguidos. O botão mostra os valores marcados
// (com "..." se não couber), igual ao filtro mostra o valor escolhido.
function configurarCampoMultiEscolha(campo, valoresPermitidos) {
  const wrapper = document.querySelector(`.campo-multiescolha[data-campo="${campo}"]`);
  const dropdown = wrapper.querySelector(".lista-opcoes");
  const botaoTexto = wrapper.querySelector(".lista-opcoes__botao-texto");
  const busca = wrapper.querySelector(".lista-opcoes__busca");
  const lista = wrapper.querySelector(".lista-opcoes__lista");
  const selecionados = new Set();

  function atualizarBotao() {
    const texto = [...selecionados].join(", ");
    botaoTexto.textContent = texto || "Selecionar...";
    // title dá o texto completo no hover, já que o botão trunca com "..."
    dropdown.querySelector(".lista-opcoes__botao").title = texto;
  }

  function criarItem(valor) {
    const item = document.createElement("li");
    item.className = "lista-opcoes__item";
    item.setAttribute("role", "option");
    item.textContent = valor;
    item.setAttribute("aria-selected", String(selecionados.has(valor)));
    item.addEventListener("click", () => {
      if (selecionados.has(valor)) selecionados.delete(valor);
      else selecionados.add(valor);
      item.setAttribute("aria-selected", String(selecionados.has(valor)));
      atualizarBotao();
    });
    return item;
  }

  function renderLista() {
    const termo = busca.value.trim();
    const filtrados = termo
      ? valoresPermitidos.filter((valor) => textoCombina(termo, valor))
      : valoresPermitidos;

    lista.innerHTML = "";
    if (filtrados.length === 0) {
      lista.innerHTML = '<li class="lista-opcoes__vazio">Nenhum resultado.</li>';
      return;
    }
    filtrados.forEach((valor) => lista.appendChild(criarItem(valor)));
  }

  busca.addEventListener("input", renderLista);

  // Abrir sempre começa do zero: limpa a busca e foca, pra digitar na hora.
  dropdown.addEventListener("toggle", () => {
    if (dropdown.open) {
      busca.value = "";
      renderLista();
      busca.focus();
    }
  });

  // Diferente do filtro (single-select), aqui marcar um item NÃO fecha o
  // painel — só clicar fora ou apertar Esc fecha, pra dar pra marcar vários
  // cursos seguidos sem reabrir toda vez.
  document.addEventListener("click", (event) => {
    if (!dropdown.contains(event.target)) dropdown.open = false;
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") dropdown.open = false;
  });

  renderLista();
  atualizarBotao();

  return {
    getSelecionados: () => [...selecionados],
    setSelecionados: (valores) => {
      selecionados.clear();
      valores.forEach((v) => selecionados.add(v));
      atualizarBotao();
      renderLista();
    },
    reset: () => {
      selecionados.clear();
      atualizarBotao();
      renderLista();
    },
  };
}

function configurarCamposLivro() {
  const camposMultiLivro = {
    curso: configurarCampoMultiEscolha("curso", api.cursos),
  };

  document.getElementById("f-categoria").addEventListener("change", sincronizarVisibilidadeCamposLivro);
  sincronizarVisibilidadeCamposLivro();

  return camposMultiLivro;
}

// Trava o campo de Curso (edição de anúncio já publicado, ou modo oferta —
// nos dois casos as tags de livro ficam bloqueadas). Mesmo padrão do Curso
// do perfil: fecha o <details> e bloqueia por CSS (--bloqueada), em vez de
// tentar desabilitar um <input> — aqui o campo é um <details>, não um input.
function bloquearCursoAnuncio() {
  const dropdown = document.getElementById("curso-anuncio-dropdown");
  if (!dropdown) return;
  dropdown.classList.add("lista-opcoes--bloqueada");
  dropdown.open = false;
}

const MAX_FOTOS = 5;

// Fotos que já estão salvas no servidor (só existe em modo edição — vem
// de anuncio.imagens) e as que a pessoa acabou de escolher agora (File de
// verdade, ainda não enviado). Remover uma foto existente não apaga nada
// na hora: só marca o caminho em fotosRemovidas, pra mandar junto no
// submit — assim editar só o título não reenvia nenhuma foto de novo.
let fotosExistentes = [];
let fotosNovas = [];
let fotosRemovidas = [];

function criarItemPreview(src, aoRemover) {
  const item = document.createElement("div");
  item.className = "preview-imagens__item";

  const img = document.createElement("img");
  img.src = src;
  img.alt = "";

  const btnRemover = document.createElement("button");
  btnRemover.type = "button";
  btnRemover.className = "preview-imagens__remover";
  btnRemover.setAttribute("aria-label", "Remover foto");
  btnRemover.textContent = "×";
  btnRemover.addEventListener("click", aoRemover);

  item.append(img, btnRemover);
  return item;
}

function renderPreviewImagens() {
  const container = document.getElementById("preview-imagens");
  container.innerHTML = "";

  fotosExistentes.forEach((caminho) => {
    container.appendChild(
      criarItemPreview(resolverUrlFoto(caminho), () => {
        fotosRemovidas.push(caminho);
        fotosExistentes = fotosExistentes.filter((c) => c !== caminho);
        renderPreviewImagens();
      })
    );
  });

  fotosNovas.forEach((arquivo, indice) => {
    container.appendChild(
      criarItemPreview(URL.createObjectURL(arquivo), () => {
        fotosNovas.splice(indice, 1);
        renderPreviewImagens();
      })
    );
  });
}

function configurarImagem() {
  const input = document.getElementById("f-imagem");
  const feedback = document.getElementById("form-feedback");

  input.addEventListener("change", () => {
    // Descarta as pesadas antes de contar o espaço livre, pra uma foto que o
    // servidor recusaria não ocupar uma das 5 vagas.
    const { aceitas, grandes } = separarImagensPorTamanho(input.files);

    const espacoLivre = MAX_FOTOS - fotosExistentes.length - fotosNovas.length;
    const arquivos = aceitas.slice(0, espacoLivre);

    if (grandes.length) {
      feedback.textContent = mensagemImagemGrande(grandes);
      feedback.classList.add("is-error");
    } else if (aceitas.length > espacoLivre) {
      feedback.textContent = `Você pode anunciar com até ${MAX_FOTOS} fotos.`;
      feedback.classList.add("is-error");
    }

    fotosNovas.push(...arquivos);
    renderPreviewImagens();
    input.value = "";
  });
}

function sincronizarCampoPreco() {
  const tipoSelecionado = document.querySelector('input[name="tipo"]:checked')?.value;
  const precoInput = document.getElementById("f-preco");
  precoInput.disabled = tipoSelecionado !== "venda";
  precoInput.required = tipoSelecionado === "venda";
}

// Máscara de preço: trata os dígitos digitados como centavos (ex: "2500"
// vira "25,00"), no padrão brasileiro — milhar com "." e decimal com ",".
function formatarPreco(valor) {
  const digitos = valor.replace(/\D/g, "");
  if (!digitos) return "";
  const numero = Number(digitos) / 100;
  return numero.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Converte o valor mascarado ("21.212,30") de volta pra número (21212.3).
function parsePreco(valorMascarado) {
  if (!valorMascarado) return 0;
  return Number(valorMascarado.replace(/\./g, "").replace(",", "."));
}

function configurarCampoPreco() {
  const precoInput = document.getElementById("f-preco");
  precoInput.addEventListener("input", () => {
    precoInput.value = formatarPreco(precoInput.value);
  });
}

function configurarTipoAnuncio() {
  document.querySelectorAll('input[name="tipo"]').forEach((radio) => {
    radio.addEventListener("change", () => {
      sincronizarCampoPreco();
      if (radio.checked && radio.value === "doacao") {
        document.getElementById("f-preco").value = "";
      }
    });
  });
}

// Carrega um anúncio existente e preenche o formulário com os dados dele
// — é o que transforma esta página de "anunciar" em "editar".
async function preencherParaEdicao(id, camposMultiLivro) {
  const anuncio = await api.buscarAnuncio(id);
  const form = document.getElementById("form-anuncio");

  form.titulo.value = anuncio.titulo;
  form.descricao.value = anuncio.descricao;
  form.categoria.value = anuncio.categoria;
  sincronizarVisibilidadeCamposLivro();

  const radioTipo = form.querySelector(`input[name="tipo"][value="${anuncio.tipo}"]`);
  if (radioTipo) radioTipo.checked = true;
  sincronizarCampoPreco();
  if (anuncio.tipo === "venda") form.preco.value = formatarPreco(String(Math.round(anuncio.preco * 100)));
  form.telefonePublico.checked = anuncio.telefone_publico;

  fotosExistentes = anuncio.imagens ? [...anuncio.imagens] : [];
  fotosNovas = [];
  fotosRemovidas = [];
  renderPreviewImagens();

  if (anuncio.categoria === "Livros") {
    camposMultiLivro.curso.setSelecionados(anuncio.curso || []);
  }

  document.querySelector(".page-header h1").textContent = "Editar item";
  document.querySelector(".page-header p").textContent = "Atualize os dados do seu anúncio.";
  document.querySelector("#form-anuncio .btn__label").textContent = "Salvar alterações";

  // Depois de publicado só dá pra mudar título, descrição e fotos — o
  // resto (categoria, tipo, preço, telefone público, tags de livro) fica
  // travado pra não bagunçar um anúncio que já pode ter interessados.
  form.categoria.disabled = true;
  form.querySelectorAll('input[name="tipo"]').forEach((r) => (r.disabled = true));
  form.telefonePublico.disabled = true;
  bloquearCursoAnuncio();

  return anuncio;
}

const HORAS_24_EM_MS = 24 * 60 * 60 * 1000;

// Mostra o link "Fazer oferta" no formulário de edição normal (não no modo
// oferta em si) — só fica clicável depois de 24h de publicado, item à
// venda e ainda não vendido. Antes disso aparece desabilitado com aviso.
function configurarBlocoOferta(anuncio) {
  if (anuncio.tipo !== "venda" || anuncio.vendido) return;

  const bloco = document.getElementById("bloco-oferta");
  const link = document.getElementById("link-fazer-oferta");
  const aviso = document.getElementById("aviso-oferta");

  const publicadoHaMaisDe24h = Date.now() - new Date(anuncio.criado_em).getTime() >= HORAS_24_EM_MS;

  bloco.hidden = false;

  if (publicadoHaMaisDe24h) {
    link.href = `anunciar.html?editar=${anuncio.id}&oferta=1`;
  } else {
    link.classList.add("btn--desabilitado");
    link.setAttribute("aria-disabled", "true");
    link.addEventListener("click", (event) => event.preventDefault());
    aviso.hidden = false;
    aviso.textContent = "Disponível 24h depois de publicado.";
  }
}

// Modo oferta: só existe pra baixar o preço de um item à venda publicado
// há mais de 24h — trava todos os campos, menos o preço, e o novo valor
// precisa ser menor que o atual.
function ativarModoOferta(precoAtual) {
  const form = document.getElementById("form-anuncio");
  [...form.elements].forEach((campo) => {
    if (campo.name !== "preco") campo.disabled = true;
  });
  bloquearCursoAnuncio();

  document.querySelector(".page-header h1").textContent = "Fazer oferta";
  document.querySelector(".page-header p").textContent =
    `Esse item está publicado há mais de 24h. Baixe o preço (hoje R$ ${precoAtual.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}) pra chamar mais atenção.`;
  document.querySelector("#form-anuncio .btn__label").textContent = "Enviar oferta";
}

function configurarFormulario(camposMultiLivro, idEditando, emOferta, precoAtual) {
  const form = document.getElementById("form-anuncio");
  const feedback = document.getElementById("form-feedback");
  const btn = form.querySelector('button[type="submit"]');
  const btnLabel = btn.querySelector(".btn__label");
  const btnSpinner = btn.querySelector(".btn__spinner");

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    feedback.textContent = "";
    feedback.className = "form-feedback";

    if (emOferta) {
      const precoNovo = parsePreco(form.preco.value);
      if (!precoNovo || precoNovo >= precoAtual) {
        feedback.textContent = `A oferta precisa ser menor que o preço atual (R$ ${precoAtual.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}).`;
        feedback.classList.add("is-error");
        return;
      }

      btn.disabled = true;
      btnLabel.hidden = true;
      btnSpinner.hidden = false;

      try {
        await api.enviarOferta(idEditando, precoNovo);
        window.location.href = "meus-anuncios.html";
      } catch (err) {
        feedback.textContent = "Não foi possível enviar a oferta agora. Tente novamente.";
        feedback.classList.add("is-error");
        btn.disabled = false;
        btnLabel.hidden = false;
        btnSpinner.hidden = true;
      }
      return;
    }

    const titulo = form.titulo.value.trim();
    const descricao = form.descricao.value.trim();

    // Editando: só título, descrição e fotos vão pro servidor — o resto
    // já está travado no formulário e o backend nem aceita mudar.
    if (idEditando) {
      if (!titulo || !descricao) {
        feedback.textContent = "Preencha os campos obrigatórios antes de salvar.";
        feedback.classList.add("is-error");
        return;
      }

      btn.disabled = true;
      btnLabel.hidden = true;
      btnSpinner.hidden = false;

      try {
        await api.editarAnuncio(idEditando, {
          titulo,
          descricao,
          imagensRemovidas: fotosRemovidas,
          fotos: fotosNovas,
        });
        window.location.href = "meus-anuncios.html";
        return;
      } catch (err) {
        feedback.textContent = "Não foi possível salvar agora. Tente novamente.";
        feedback.classList.add("is-error");
      } finally {
        btn.disabled = false;
        btnLabel.hidden = false;
        btnSpinner.hidden = true;
      }
      return;
    }

    const dados = {
      titulo,
      descricao,
      categoria: form.categoria.value,
      tipo: form.tipo.value,
      preco: form.tipo.value === "venda" ? parsePreco(form.preco.value) : null,
      fotos: fotosNovas,
      telefonePublico: form.telefonePublico.checked,
      curso: [],
    };

    if (dados.categoria === "Livros") {
      dados.curso = camposMultiLivro.curso.getSelecionados();
    }

    if (!dados.titulo || !dados.descricao || (dados.tipo === "venda" && !dados.preco)) {
      feedback.textContent = "Preencha os campos obrigatórios antes de publicar.";
      feedback.classList.add("is-error");
      return;
    }

    btn.disabled = true;
    btnLabel.hidden = true;
    btnSpinner.hidden = false;

    try {
      await api.criarAnuncio(dados);
      window.location.href = "meus-anuncios.html";
    } catch (err) {
      feedback.textContent = "Não foi possível salvar agora. Tente novamente.";
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
  preencherSelectCategorias();
  configurarImagem();
  configurarTipoAnuncio();
  configurarCampoPreco();
  const camposMultiLivro = configurarCamposLivro();

  const params = new URLSearchParams(window.location.search);
  const idEditando = params.get("editar");
  const emOferta = params.get("oferta") === "1";
  let precoAtual;

  if (idEditando) {
    try {
      const anuncio = await preencherParaEdicao(idEditando, camposMultiLivro);
      if (emOferta) {
        precoAtual = anuncio.preco;
        ativarModoOferta(precoAtual);
      } else {
        configurarBlocoOferta(anuncio);
      }
    } catch (err) {
      window.location.href = "meus-anuncios.html";
      return;
    }
  }

  configurarFormulario(camposMultiLivro, idEditando, emOferta, precoAtual);
}

init();
