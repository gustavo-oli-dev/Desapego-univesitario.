/**
 * Página Entrar: email+senha, depois confirma com um código de 2 etapas
 * (2FA). Como o projeto ainda não manda email de verdade, o código
 * simulado aparece na própria tela — ver comentário em backend/main.py.
 */

let tokenPendente2FA = null;

function mostrarPassoLogin(id) {
  document.querySelectorAll(".cadastro-passo").forEach((el) => {
    el.hidden = el.id !== id;
  });
}

function configurarFormularioLogin() {
  const form = document.getElementById("form-login");
  const feedback = document.getElementById("form-feedback");
  const btn = form.querySelector('button[type="submit"]');
  const btnLabel = btn.querySelector(".btn__label");
  const btnSpinner = btn.querySelector(".btn__spinner");

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    feedback.textContent = "";
    feedback.className = "form-feedback";

    btn.disabled = true;
    btnLabel.hidden = true;
    btnSpinner.hidden = false;

    try {
      const resposta = await api.login({
        email: form.email.value.trim(),
        senha: form.senha.value,
      });
      tokenPendente2FA = resposta.token_pendente;
      document.getElementById("aviso-codigo-simulado").textContent = textoAvisoCodigo(resposta);
      mostrarPassoLogin("passo-2fa");
    } catch (err) {
      feedback.textContent = "Email ou senha incorretos.";
      feedback.classList.add("is-error");
    } finally {
      btn.disabled = false;
      btnLabel.hidden = false;
      btnSpinner.hidden = true;
    }
  });
}

function configurarFormulario2FA() {
  const form = document.getElementById("form-2fa");
  const feedback = document.getElementById("form-feedback-2fa");
  const btn = form.querySelector('button[type="submit"]');
  const btnLabel = btn.querySelector(".btn__label");
  const btnSpinner = btn.querySelector(".btn__spinner");

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    feedback.textContent = "";
    feedback.className = "form-feedback";

    btn.disabled = true;
    btnLabel.hidden = true;
    btnSpinner.hidden = false;

    try {
      const sessao = await api.confirmar2FA({
        tokenPendente: tokenPendente2FA,
        codigo: form.codigo.value.trim(),
      });
      salvarSessao(sessao.token, { nome: sessao.nome, email: sessao.email });
      window.location.href = "index.html";
    } catch (err) {
      feedback.textContent = "Código incorreto ou expirado.";
      feedback.classList.add("is-error");
      btn.disabled = false;
      btnLabel.hidden = false;
      btnSpinner.hidden = true;
    }
  });
}

configurarFormularioLogin();
configurarFormulario2FA();
