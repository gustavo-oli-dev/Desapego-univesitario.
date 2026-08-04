/**
 * Service Worker básico: guarda em cache os arquivos estáticos da aplicação
 * (o "app shell") para que o site abra rápido. Os anúncios em si vêm da
 * API (backend), então precisam de internet/rede local pra funcionar —
 * só o "esqueleto" da interface (HTML/CSS/JS/imagens) funciona offline.
 */

const CACHE_NAME = "desapego-shell-v284";

const APP_SHELL = [
  "./",
  "./landing.html",
  "./index.html",
  "./catalogo.html",
  "./anunciar.html",
  "./meus-anuncios.html",
  "./login.html",
  "./cadastro.html",
  "./anuncio.html",
  "./perfil.html",
  "./perfil-publico.html",
  "./recuperar-senha.html",
  "./termos.html",
  "./chat.html",
  "./admin-denuncias.html",
  "./css/styles.css",
  "./css/landing.css",
  "./js/config.js",
  "./js/auth.js",
  "./js/api.js",
  "./js/site.js",
  "./js/index.js",
  "./js/catalogo.js",
  "./js/anunciar.js",
  "./js/meus-anuncios.js",
  "./js/login.js",
  "./js/cadastro.js",
  "./js/anuncio.js",
  "./js/perfil.js",
  "./js/perfil-publico.js",
  "./js/recuperar-senha.js",
  "./js/chat.js",
  "./js/admin-denuncias.js",
  "./js/landing.js",
  "./manifest.json",
  "./img/mascote-hero.jpg",
  "./img/mascote-badge.png",
  "./img/hero-biblioteca.jpg",
  "./img/hero-biblioteca-mobile.jpg",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
];

// Cacheia cada arquivo individualmente (não com addAll) de propósito:
// se um arquivo falhar ao cachear, os outros continuam funcionando e a
// instalação não trava — era isso que deixava o site preso numa versão
// antiga em algumas abas sempre que um arquivo mudava.
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      Promise.all(
        APP_SHELL.map((url) =>
          cache.add(url).catch((err) => console.warn("Falha ao cachear", url, err))
        )
      )
    )
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((nomes) =>
      Promise.all(
        nomes.filter((nome) => nome !== CACHE_NAME).map((nome) => caches.delete(nome))
      )
    )
  );
  self.clients.claim();
});

// Network-first pra TUDO (app shell e API): busca a rede sempre que
// possível e só cai pro cache se a rede falhar — é o que mantém o site
// funcionando offline sem nunca mostrar uma versão velha de CSS/JS quando
// há internet. (Antes o app shell usava stale-while-revalidate, que abria
// mais rápido mas sempre entregava a versão anterior primeiro: qualquer
// alteração só aparecia no carregamento seguinte.)
function networkFirst(request) {
  return fetch(request)
    .then((response) => {
      const clone = response.clone();
      caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
      return response;
    })
    .catch(() =>
      caches.match(request).then((cached) => {
        if (cached) return cached;
        // Cair pro index.html só faz sentido pra NAVEGAÇÃO (abrir uma página
        // offline). Pra imagem, CSS ou JS que falhou e não está em cache,
        // devolver HTML é sempre errado: o navegador recebe 200 com conteúdo
        // que não sabe decodificar e o recurso some sem nenhum erro visível —
        // era isso que podia apagar a ilustração do hero deixando só a cor de
        // fundo. Sem resposta, o navegador ao menos reporta a falha de verdade.
        if (request.mode === "navigate") return caches.match("./index.html");
        return Response.error();
      })
    );
}

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  // A API mora em outra origem (Render, enquanto o site é Netlify) — sem
  // esse filtro, uma chamada de API que falhasse por rede caía no mesmo
  // fallback do app shell e voltava com o HTML de "./index.html" no lugar
  // de JSON (ou pior: um JSON antigo em cache, sem avisar que tá velho).
  // No mobile, com rede mais instável (troca de wifi pra dados, túnel,
  // elevador), isso fazia anúncios de verdade "sumirem" da tela sem
  // nenhum erro — não é cache que resolve, é a API respondendo de novo.
  if (new URL(event.request.url).origin !== self.location.origin) return;
  event.respondWith(networkFirst(event.request));
});
