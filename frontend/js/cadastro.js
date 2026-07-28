/**
 * Página Criar conta: cadastro em 2 passos.
 * Passo 1 — email+senha (ou clicar em "Entrar com Google").
 * Passo 2 — completa o perfil: nome+telefone (manual) ou só telefone
 * (Google, que já manda nome e email prontos).
 */

let credencialGoogle = null;

function mostrarPasso(id) {
  document.querySelectorAll(".cadastro-passo").forEach((el) => {
    el.hidden = el.id !== id;
  });
}

function configurarPassoCredenciais() {
  const form = document.getElementById("form-credenciais");
  const feedback = document.getElementById("form-feedback");
  const btn = form.querySelector('button[type="submit"]');

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    feedback.textContent = "";
    feedback.className = "form-feedback";

    const email = form.email.value.trim();

    // Formato do email (o form é novalidate, então checamos na mão). checkValidity
    // usa a validação nativa do type="email".
    if (!email || !form.email.checkValidity()) {
      feedback.textContent = "Digite um email válido.";
      feedback.classList.add("is-error");
      return;
    }
    if (form.senha.value.length < 8) {
      feedback.textContent = "A senha precisa ter pelo menos 8 caracteres.";
      feedback.classList.add("is-error");
      return;
    }

    // Email já cadastrado é barrado AQUI (passo 1), não lá no fim depois de
    // pedir o nome — que era o que fazia o erro aparecer só no passo do nome.
    btn.disabled = true;
    try {
      const { disponivel } = await api.verificarEmail(email);
      if (!disponivel) {
        feedback.textContent = "Já existe uma conta com esse email. Tente entrar.";
        feedback.classList.add("is-error");
        return;
      }
    } catch (err) {
      // 422 = email inválido pro backend; qualquer outra falha = rede/servidor.
      feedback.textContent = err.message && err.message.includes("value_error")
        ? "Digite um email válido."
        : "Não foi possível validar o email agora. Tente de novo.";
      feedback.classList.add("is-error");
      return;
    } finally {
      btn.disabled = false;
    }

    mostrarPasso("passo-perfil-manual");
  });
}

function configurarPassoPerfilManual() {
  const formCredenciais = document.getElementById("form-credenciais");
  const form = document.getElementById("form-perfil-manual");
  const feedback = document.getElementById("form-feedback-perfil");
  const btn = form.querySelector('button[type="submit"]');
  const btnLabel = btn.querySelector(".btn__label");
  const btnSpinner = btn.querySelector(".btn__spinner");

  configurarCampoTelefone(document.getElementById("f-telefone"));

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    feedback.textContent = "";
    feedback.className = "form-feedback";

    btn.disabled = true;
    btnLabel.hidden = true;
    btnSpinner.hidden = false;

    try {
      const resposta = await api.cadastrar({
        nome: form.nome.value.trim(),
        email: formCredenciais.email.value.trim(),
        senha: formCredenciais.senha.value,
        telefone: form.telefone.value,
      });
      salvarSessao(resposta.token, { nome: resposta.nome, email: resposta.email });
      window.location.href = "index.html";
    } catch (err) {
      feedback.textContent = "Não foi possível criar a conta. Talvez esse email já esteja em uso.";
      feedback.classList.add("is-error");
      btn.disabled = false;
      btnLabel.hidden = false;
      btnSpinner.hidden = true;
    }
  });
}

function configurarPassoPerfilGoogle() {
  const form = document.getElementById("form-perfil-google");
  const feedback = document.getElementById("form-feedback-google");
  const btn = form.querySelector('button[type="submit"]');
  const btnLabel = btn.querySelector(".btn__label");
  const btnSpinner = btn.querySelector(".btn__spinner");

  configurarCampoTelefone(document.getElementById("f-telefone-google"));

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    feedback.textContent = "";
    feedback.className = "form-feedback";

    btn.disabled = true;
    btnLabel.hidden = true;
    btnSpinner.hidden = false;

    try {
      const sessao = await api.loginGoogle(credencialGoogle, form.telefone.value);
      salvarSessao(sessao.token, { nome: sessao.nome, email: sessao.email });
      window.location.href = "index.html";
    } catch (err) {
      feedback.textContent = "Não foi possível criar a conta com o Google. Tente novamente.";
      feedback.classList.add("is-error");
      btn.disabled = false;
      btnLabel.hidden = false;
      btnSpinner.hidden = true;
    }
  });
}

// Callback do botão "Entrar com Google" — só existe em cadastro.html (o de
// login.html usa handleGoogleCredential, em js/auth.js). Guarda a
// credencial e pede o telefone antes de mandar tudo pro backend.
async function handleGoogleCredencialCadastro(resposta) {
  credencialGoogle = resposta.credential;
  mostrarPasso("passo-perfil-google");
}

configurarPassoCredenciais();
configurarPassoPerfilManual();
configurarPassoPerfilGoogle();
