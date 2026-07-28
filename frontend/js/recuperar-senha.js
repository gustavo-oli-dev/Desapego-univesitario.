/**
 * Página Recuperar senha: pede o email, mostra o código (simulado, sem
 * email real — ver comentário em backend/main.py) e redefine a senha.
 */

let emailRecuperacao = "";

function mostrarPassoRecuperar(id) {
  document.querySelectorAll(".cadastro-passo").forEach((el) => {
    el.hidden = el.id !== id;
  });
}

function configurarPassoEmail() {
  const form = document.getElementById("form-email");
  const feedback = document.getElementById("form-feedback-email");
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
      emailRecuperacao = form.email.value.trim();
      const resposta = await api.solicitarRecuperarSenha(emailRecuperacao);
      document.getElementById("aviso-codigo-recuperar").textContent = textoAvisoCodigo(resposta);
      mostrarPassoRecuperar("passo-redefinir");
    } catch (err) {
      feedback.textContent = "Não foi possível enviar o código agora. Tente novamente em instantes.";
      feedback.classList.add("is-error");
    } finally {
      btn.disabled = false;
      btnLabel.hidden = false;
      btnSpinner.hidden = true;
    }
  });
}

function configurarPassoRedefinir() {
  const form = document.getElementById("form-redefinir");
  const feedback = document.getElementById("form-feedback-redefinir");
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
      await api.confirmarRecuperarSenha({
        email: emailRecuperacao,
        codigo: form.codigo.value.trim(),
        senhaNova: form.senhaNova.value,
      });
      feedback.textContent = "Senha redefinida! Redirecionando pra tela de entrar...";
      feedback.classList.add("is-success");
      setTimeout(() => { window.location.href = "login.html"; }, 1500);
    } catch (err) {
      feedback.textContent = "Código incorreto ou expirado.";
      feedback.classList.add("is-error");
      btn.disabled = false;
      btnLabel.hidden = false;
      btnSpinner.hidden = true;
    }
  });
}

configurarPassoEmail();
configurarPassoRedefinir();
