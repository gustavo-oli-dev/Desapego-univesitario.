/**
 * Camada de dados: conversa com a API do backend (FastAPI + SQLite) via
 * fetch(). Rotas protegidas mandam o token JWT (de js/auth.js) no header
 * Authorization.
 */

// O endereço do backend é derivado de onde esta página foi aberta, e não
// fixo em "localhost": ao acessar pelo celular (http://192.168.x.x:8000),
// "localhost" apontaria pro próprio celular e nada funcionaria.
//   - servido na porta 8000 (desenvolvimento) -> mesmo host, porta 8001
//   - qualquer outro caso (produção)          -> mesma origem da página
// Dá pra sobrescrever definindo window.DESAPEGO_API_URL antes deste script.
const API_URL =
  window.DESAPEGO_API_URL ||
  (window.location.port === "8000"
    ? `${window.location.protocol}//${window.location.hostname}:8001`
    : window.location.origin);

function headersComToken() {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${obterToken()}`,
  };
}

async function tratarResposta(response) {
  if (!response.ok) {
    const corpo = await response.json().catch(() => ({}));
    throw new Error(corpo.detail ? JSON.stringify(corpo.detail) : `Erro ${response.status}`);
  }
  if (response.status === 204) return null;
  return response.json();
}

const api = {
  categorias: [],
  cursos: [],
  turnos: [],
  materias: [],
  autores: [],
  motivosDenuncia: [],

  // Busca as listas fixas (categorias, cursos, matérias, autores) do
  // backend. Precisa rodar antes de qualquer tela que use essas listas.
  async carregarOpcoes() {
    const opcoes = await fetch(`${API_URL}/opcoes`).then(tratarResposta);
    api.categorias = opcoes.categorias;
    api.cursos = opcoes.cursos;
    api.turnos = opcoes.turnos;
    api.materias = opcoes.materias;
    api.autores = opcoes.autores;
    api.motivosDenuncia = opcoes.motivos_denuncia;
  },

  // Checa no passo 1 do cadastro se o email é válido e ainda não existe.
  // Devolve { disponivel: bool }. Email mal formatado vira 422 (tratarResposta
  // lança) — o chamador trata como "email inválido".
  async verificarEmail(email) {
    return fetch(`${API_URL}/auth/verificar-email`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    }).then(tratarResposta);
  },

  async cadastrar({ nome, email, senha, telefone }) {
    return fetch(`${API_URL}/auth/cadastro`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nome, email, senha, telefone }),
    }).then(tratarResposta);
  },

  async login({ email, senha }) {
    return fetch(`${API_URL}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, senha }),
    }).then(tratarResposta);
  },

  async confirmar2FA({ tokenPendente, codigo }) {
    return fetch(`${API_URL}/auth/2fa/confirmar`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token_pendente: tokenPendente, codigo }),
    }).then(tratarResposta);
  },

  async loginGoogle(credential, telefone) {
    return fetch(`${API_URL}/auth/google`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: credential, telefone }),
    }).then(tratarResposta);
  },

  async solicitarRecuperarSenha(email) {
    return fetch(`${API_URL}/auth/recuperar-senha/solicitar`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    }).then(tratarResposta);
  },

  async confirmarRecuperarSenha({ email, codigo, senhaNova }) {
    return fetch(`${API_URL}/auth/recuperar-senha/confirmar`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, codigo, senha_nova: senhaNova }),
    }).then(tratarResposta);
  },

  async obterPerfil() {
    return fetch(`${API_URL}/usuarios/me`, {
      headers: { Authorization: `Bearer ${obterToken()}` },
    }).then(tratarResposta);
  },

  // multipart/form-data, não JSON — o avatar vai como arquivo de verdade
  // (arquivoFoto é o File escolhido no input, ou null se não trocou).
  // Sem Content-Type manual de propósito: o browser define o boundary
  // certo sozinho quando o body é um FormData.
  async atualizarPerfil({ nome, telefone, curso, turno, arquivoFoto }) {
    const dados = new FormData();
    dados.append("nome", nome);
    dados.append("telefone", telefone || "");
    if (curso) dados.append("curso", curso);
    if (turno) dados.append("turno", turno);
    if (arquivoFoto) dados.append("foto", arquivoFoto);

    return fetch(`${API_URL}/usuarios/me`, {
      method: "PUT",
      headers: { Authorization: `Bearer ${obterToken()}` },
      body: dados,
    }).then(tratarResposta);
  },

  async solicitarTrocaSenha({ senhaAtual, senhaNova }) {
    return fetch(`${API_URL}/usuarios/me/trocar-senha/solicitar`, {
      method: "POST",
      headers: headersComToken(),
      body: JSON.stringify({ senha_atual: senhaAtual, senha_nova: senhaNova }),
    }).then(tratarResposta);
  },

  async confirmarTrocaSenha(codigo) {
    return fetch(`${API_URL}/usuarios/me/trocar-senha/confirmar`, {
      method: "POST",
      headers: headersComToken(),
      body: JSON.stringify({ codigo }),
    }).then(tratarResposta);
  },

  async listarAnuncios({ categoria, usuario, vendido, q, ordem, aleatorio, limit, offset } = {}) {
    const params = new URLSearchParams();
    if (categoria && categoria !== "todas") params.set("categoria", categoria);
    if (usuario) params.set("usuario", usuario);
    if (vendido !== undefined) params.set("vendido", vendido);
    if (q) params.set("q", q);
    if (ordem) params.set("ordem", ordem);
    if (aleatorio) params.set("aleatorio", "true");
    if (limit) params.set("limit", limit);
    if (offset) params.set("offset", offset);
    // Manda o token quando existe (sem exigir login) — é o que permite o
    // backend filtrar quem foi bloqueado por quem está olhando.
    const token = obterToken();
    const headers = token ? { Authorization: `Bearer ${token}` } : {};
    return fetch(`${API_URL}/anuncios?${params}`, { headers }).then(tratarResposta);
  },

  async listarFiltrosAnuncios(categoria) {
    return fetch(`${API_URL}/anuncios/filtros?categoria=${encodeURIComponent(categoria)}`).then(tratarResposta);
  },

  async bloquearUsuario(id) {
    return fetch(`${API_URL}/usuarios/${id}/bloquear`, {
      method: "POST",
      headers: { Authorization: `Bearer ${obterToken()}` },
    }).then(tratarResposta);
  },

  async obterPerfilPublico(id) {
    return fetch(`${API_URL}/usuarios/${id}/publico`).then(tratarResposta);
  },

  async denunciarAnuncio(id, motivo) {
    return fetch(`${API_URL}/anuncios/${id}/denunciar`, {
      method: "POST",
      headers: headersComToken(),
      body: JSON.stringify({ motivo }),
    }).then(tratarResposta);
  },

  async listarTodasDenuncias(status = "ativa") {
    return fetch(`${API_URL}/admin/denuncias?status=${status}`, {
      headers: { Authorization: `Bearer ${obterToken()}` },
    }).then(tratarResposta);
  },

  async adminDescartarDenuncia(id) {
    return fetch(`${API_URL}/admin/denuncias/${id}/descartar`, {
      method: "POST",
      headers: { Authorization: `Bearer ${obterToken()}` },
    }).then(tratarResposta);
  },

  async adminRemoverAnuncio(id) {
    return fetch(`${API_URL}/admin/anuncios/${id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${obterToken()}` },
    }).then(tratarResposta);
  },

  async adminBanirUsuario(id) {
    return fetch(`${API_URL}/admin/usuarios/${id}/banir`, {
      method: "POST",
      headers: { Authorization: `Bearer ${obterToken()}` },
    }).then(tratarResposta);
  },

  async iniciarConversa(anuncioId) {
    return fetch(`${API_URL}/anuncios/${anuncioId}/chat`, {
      method: "POST",
      headers: { Authorization: `Bearer ${obterToken()}` },
    }).then(tratarResposta);
  },

  // Conta o que chegou de novo desde a última visita ao chat (data em ISO).
  async contarNotificacoes(desde) {
    const params = new URLSearchParams();
    if (desde) params.set("desde", desde);
    return fetch(`${API_URL}/notificacoes?${params}`, {
      headers: { Authorization: `Bearer ${obterToken()}` },
    }).then(tratarResposta);
  },

  async listarConversas() {
    return fetch(`${API_URL}/conversas`, {
      headers: { Authorization: `Bearer ${obterToken()}` },
    }).then(tratarResposta);
  },

  async listarMensagens(conversaId) {
    return fetch(`${API_URL}/conversas/${conversaId}/mensagens`, {
      headers: { Authorization: `Bearer ${obterToken()}` },
    }).then(tratarResposta);
  },

  // multipart/form-data — a foto vai como arquivo de verdade (File), não
  // mais base64. Sem Content-Type manual: o browser define o boundary.
  async enviarMensagem(conversaId, { texto, arquivoImagem }) {
    const dados = new FormData();
    if (texto) dados.append("texto", texto);
    if (arquivoImagem) dados.append("imagem", arquivoImagem);

    return fetch(`${API_URL}/conversas/${conversaId}/mensagens`, {
      method: "POST",
      headers: { Authorization: `Bearer ${obterToken()}` },
      body: dados,
    }).then(tratarResposta);
  },

  async obterConfirmacaoVenda(conversaId) {
    return fetch(`${API_URL}/conversas/${conversaId}/confirmar-venda`, {
      headers: { Authorization: `Bearer ${obterToken()}` },
    }).then(tratarResposta);
  },

  async solicitarConfirmacaoVenda(conversaId) {
    return fetch(`${API_URL}/conversas/${conversaId}/confirmar-venda/solicitar`, {
      method: "POST",
      headers: { Authorization: `Bearer ${obterToken()}` },
    }).then(tratarResposta);
  },

  async responderConfirmacaoVenda(conversaId, aceitar) {
    return fetch(`${API_URL}/conversas/${conversaId}/confirmar-venda/responder`, {
      method: "POST",
      headers: headersComToken(),
      body: JSON.stringify({ aceitar }),
    }).then(tratarResposta);
  },

  async buscarAnuncio(id) {
    return fetch(`${API_URL}/anuncios/${id}`).then(tratarResposta);
  },

  async listarMeusAnuncios({ vendido, limit, offset } = {}) {
    const params = new URLSearchParams();
    if (vendido !== undefined) params.set("vendido", vendido);
    if (limit) params.set("limit", limit);
    if (offset) params.set("offset", offset);
    return fetch(`${API_URL}/anuncios/meus?${params}`, {
      headers: { Authorization: `Bearer ${obterToken()}` },
    }).then(tratarResposta);
  },

  // fotos vem como File[] de verdade — multipart, sem base64.
  async criarAnuncio(dados) {
    const formData = new FormData();
    formData.append("titulo", dados.titulo);
    formData.append("descricao", dados.descricao);
    formData.append("categoria", dados.categoria);
    formData.append("tipo", dados.tipo);
    if (dados.preco) formData.append("preco", dados.preco);
    dados.curso.forEach((v) => formData.append("curso", v));
    dados.materia.forEach((v) => formData.append("materia", v));
    dados.autor.forEach((v) => formData.append("autor", v));
    formData.append("telefone_publico", dados.telefonePublico);
    dados.fotos.forEach((arquivo) => formData.append("fotos", arquivo));

    return fetch(`${API_URL}/anuncios`, {
      method: "POST",
      headers: { Authorization: `Bearer ${obterToken()}` },
      body: formData,
    }).then(tratarResposta);
  },

  // Só título, descrição e fotos são editáveis — manda os ids das fotos
  // removidas (imagensRemovidas) e só os arquivos novos, nunca reenvia
  // as fotos que não mudaram (o backend nem saberia reconstruir um File
  // a partir de uma URL já salva).
  async editarAnuncio(id, dados) {
    const formData = new FormData();
    formData.append("titulo", dados.titulo);
    formData.append("descricao", dados.descricao);
    dados.imagensRemovidas.forEach((imgId) => formData.append("imagens_removidas", imgId));
    dados.fotos.forEach((arquivo) => formData.append("fotos", arquivo));

    return fetch(`${API_URL}/anuncios/${id}`, {
      method: "PUT",
      headers: { Authorization: `Bearer ${obterToken()}` },
      body: formData,
    }).then(tratarResposta);
  },

  async enviarOferta(id, precoNovo) {
    return fetch(`${API_URL}/anuncios/${id}/oferta`, {
      method: "PUT",
      headers: headersComToken(),
      body: JSON.stringify({ preco_novo: precoNovo }),
    }).then(tratarResposta);
  },

  async removerAnuncio(id) {
    return fetch(`${API_URL}/anuncios/${id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${obterToken()}` },
    }).then(tratarResposta);
  },
};
