/**
 * URL da API em produção. Só entra em ação fora do fluxo de desenvolvimento
 * (que sempre serve o frontend na porta 8000 e resolve a API sozinho, em
 * js/api.js — porta 8000 -> 8001, inclusive pelo IP da rede local). Em
 * qualquer outra porta (produção: Netlify serve na 443/80), o frontend não
 * tem como adivinhar onde está o backend, porque ficam em domínios
 * diferentes — por isso essa URL precisa vir fixa aqui.
 *
 * Ajuste se o serviço no Render mudar de nome (a URL segue o nome do
 * serviço definido em render.yaml).
 */
// Precisa ser IGUAL ao "name" do serviço em render.yaml, porque o Render
// deriva o subdomínio do nome. Atenção: esse nome é único no Render inteiro —
// "desapego-universitario-api" (sem sufixo) pertence a outro projeto do mesmo
// desafio, e apontar pra lá faria o site conversar com a API de um estranho.
const API_PRODUCAO = "https://desapego-universitario-api-gustavo.onrender.com";

if (window.location.port !== "8000") {
  window.DESAPEGO_API_URL = API_PRODUCAO;
}
