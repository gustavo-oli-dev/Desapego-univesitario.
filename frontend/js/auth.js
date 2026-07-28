/**
 * Sessão do usuário: guarda o token JWT (devolvido pelo backend no
 * cadastro/login) e os dados básicos (nome/email) no localStorage.
 */

const TOKEN_KEY = "desapego:token";
const USUARIO_KEY = "desapego:usuario";

function salvarSessao(token, usuario) {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USUARIO_KEY, JSON.stringify(usuario));
}

function obterToken() {
  return localStorage.getItem(TOKEN_KEY);
}

function obterUsuario() {
  try {
    return JSON.parse(localStorage.getItem(USUARIO_KEY));
  } catch {
    return null;
  }
}

// Lê o id do dono da sessão direto do token (claim "sub") — não precisa
// de mais uma chamada à API só pra saber "quem sou eu".
function obterIdUsuarioAtual() {
  const token = obterToken();
  if (!token) return null;
  try {
    const payload = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    return payload.sub;
  } catch {
    return null;
  }
}

function sair() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USUARIO_KEY);

  // Sem isso o Google "lembra" da conta e faz login automático de novo
  // na próxima vez que a pessoa abrir a tela de login (o One Tap volta
  // sozinho) — precisa avisar explicitamente que foi um logout.
  if (typeof google !== "undefined" && google.accounts && google.accounts.id) {
    google.accounts.id.disableAutoSelect();
  }

  window.location.href = "login.html";
}

// Usado nas páginas que só fazem sentido pra quem está logado
// (anunciar item, meus anúncios).
function exigirLogin() {
  if (!obterToken()) {
    // replace (não href): substitui a página protegida no histórico em vez de
    // empilhar. Assim o "Voltar" do login não cai de volta nela (que
    // redirecionaria pro login de novo, criando um loop).
    window.location.replace("login.html");
  }
}

// Callback chamado pelo botão "Entrar com Google" (login.html e
// cadastro.html) assim que a pessoa autoriza — recebe um token, o backend
// confere se é legítimo e devolve nosso próprio token de sessão.
async function handleGoogleCredential(resposta) {
  const feedback = document.getElementById("form-feedback");
  try {
    const sessao = await api.loginGoogle(resposta.credential);
    salvarSessao(sessao.token, { nome: sessao.nome, email: sessao.email });
    window.location.href = "index.html";
  } catch (err) {
    if (feedback) {
      feedback.textContent = "Não foi possível entrar com o Google. Tente novamente.";
      feedback.classList.add("is-error");
    }
  }
}
