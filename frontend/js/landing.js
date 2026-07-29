/**
 * Landing page: animações e comportamento de rolagem.
 *
 * Entrada escalonada dos blocos, parallax do hero, contagem dos números e
 * o cabeçalho que ganha fundo ao rolar. Tudo em CSS transform +
 * IntersectionObserver — sem biblioteca — e desligado quando o sistema
 * pede menos movimento.
 */

const MENOS_MOVIMENTO = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// --- Entrada escalonada ----------------------------------------------------
// Cada elemento .lp-anim sobe e aparece ao entrar na tela. Dentro de um
// [data-anim-grupo], os itens ganham índices crescentes (--i), e o CSS
// converte isso em atraso — é o que dá o efeito "um depois do outro".
function configurarEntradas() {
  const alvos = document.querySelectorAll(".lp-anim");
  if (!alvos.length) return;

  document.querySelectorAll("[data-anim-grupo]").forEach((grupo) => {
    grupo.querySelectorAll(".lp-anim").forEach((el, i) => {
      el.style.setProperty("--i", i);
    });
  });

  // Sem observador (ou com menos movimento), tudo já entra visível.
  if (!("IntersectionObserver" in window) || MENOS_MOVIMENTO) {
    alvos.forEach((el) => el.classList.add("is-dentro"));
    return;
  }

  // Só agora o CSS pode esconder: se o script parasse antes, a página
  // continuaria legível.
  document.body.classList.add("lp-js");

  const observador = new IntersectionObserver((entradas) => {
    entradas.forEach((entrada) => {
      if (!entrada.isIntersecting) return;
      entrada.target.classList.add("is-dentro");
      observador.unobserve(entrada.target);
    });
  }, { threshold: 0.12, rootMargin: "0px 0px -60px 0px" });

  alvos.forEach((el) => observador.observe(el));

  // Rede de segurança: se algo não for observado (página aberta já rolada,
  // por exemplo), aparece assim mesmo em vez de ficar invisível.
  setTimeout(() => alvos.forEach((el) => el.classList.add("is-dentro")), 2200);
}

// Mede a altura real do cabeçalho e publica em --lp-topo-altura. O hero usa
// esse valor pra subir por baixo da barra — sem número fixo no CSS, então
// mudar o espaçamento da barra (ou o tamanho da fonte) não descola nada.
function medirAlturaDoTopo() {
  const topbar = document.getElementById("lp-topbar");
  if (!topbar) return;

  const aplicar = () => {
    document.body.style.setProperty("--lp-topo-altura", `${topbar.offsetHeight}px`);
  };
  aplicar();
  window.addEventListener("resize", aplicar, { passive: true });
  // A fonte pode chegar depois e mudar a altura da barra.
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(aplicar);
}

// --- Parallax do hero + cabeçalho ------------------------------------------
function configurarRolagem() {
  const topbar = document.getElementById("lp-topbar");
  const fundo = document.getElementById("lp-hero-fundo");
  let agendado = false;

  function avaliar() {
    const y = window.scrollY;
    if (topbar) topbar.classList.toggle("is-preso", y > 10);

    // A ilustração sobe mais devagar que a página (fator 0.28) — dá
    // profundidade sem tirar a cena do lugar. Limitado a 260px pra a
    // imagem nunca descobrir a borda de baixo do hero.
    if (fundo && !MENOS_MOVIMENTO) {
      const deslocamento = Math.min(y * 0.28, 260);
      fundo.style.transform = `translate3d(0, ${deslocamento}px, 0)`;
    }
    agendado = false;
  }

  window.addEventListener("scroll", () => {
    if (!agendado) {
      window.requestAnimationFrame(avaliar);
      agendado = true;
    }
  }, { passive: true });

  avaliar();
}

// --- Contadores ------------------------------------------------------------
function animarContador(el) {
  const alvo = Number(el.dataset.alvo) || 0;
  const prefixo = el.dataset.prefixo || "";
  const sufixo = el.dataset.sufixo || "";
  const duracao = 1400;
  const inicio = performance.now();

  function passo(agora) {
    const t = Math.min((agora - inicio) / duracao, 1);
    const suave = 1 - Math.pow(1 - t, 3); // desacelera no fim
    el.textContent = prefixo + Math.round(alvo * suave).toLocaleString("pt-BR") + sufixo;
    if (t < 1) requestAnimationFrame(passo);
  }
  requestAnimationFrame(passo);
}

function configurarContadores() {
  const contadores = document.querySelectorAll("[data-alvo]");
  if (!contadores.length) return;

  // Sem observador ou com menos movimento, os números ficam como já estão
  // no HTML — que é justamente o valor final.
  if (!("IntersectionObserver" in window) || MENOS_MOVIMENTO) return;

  const observador = new IntersectionObserver((entradas) => {
    entradas.forEach((entrada) => {
      if (!entrada.isIntersecting) return;
      animarContador(entrada.target);
      observador.unobserve(entrada.target);
    });
  }, { threshold: 0.4 });

  contadores.forEach((c) => observador.observe(c));
}

medirAlturaDoTopo();
configurarEntradas();
configurarRolagem();
configurarContadores();
