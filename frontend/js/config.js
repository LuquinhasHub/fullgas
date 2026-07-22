/* =========================================================
   FULLGAS B2B — Configuração de ambiente do front-end
   ---------------------------------------------------------
   Este arquivo decide para qual API o front aponta, sem que
   você precise editar código ao trocar de ambiente.

   Carregue-o ANTES do api-adapter.js em cada página:
     <script src="js/config.js"></script>
     <script src="js/store.js"></script>
     <script src="js/api-adapter.js"></script>

   Como funciona: se o site estiver rodando em localhost ou
   num IP de rede local (192.168.x, 10.x, 172.16–31.x), usa a
   API no MESMO host na porta 3000; caso contrário (domínio
   público), usa a API de produção.
   ========================================================= */
(function () {
  'use strict';

  var host = location.hostname;
  // IPs de rede privada (LAN): 192.168.x, 10.x, 172.16–31.x.
  var ehLanIp = /^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host);
  var ehLocal = host === 'localhost' || host === '127.0.0.1' || host === '' || ehLanIp;

  // Em produção o Nginx serve o site e faz proxy de /api para a Node no MESMO
  // domínio (fullgas.app.br), então o caminho relativo é o mais robusto: não
  // depende de domínio fixo, funciona igual em www/sem-www e não esbarra em
  // CORS. Não troque por URL absoluta sem necessidade.
  var API_PRODUCAO = '/api';
  // API no MESMO host que serviu a página, na porta 3000 (sem IP fixo): funciona
  // tanto em localhost quanto acessado pelo IPv4 de outro dispositivo na rede.
  var API_LOCAL = 'http://' + (host || 'localhost') + ':3000/api';

  window.FULLGAS_API_BASE = ehLocal ? API_LOCAL : API_PRODUCAO;

  // Pequeno log pra você confirmar no console qual API está em uso.
  console.log('[Fullgas] Ambiente:', ehLocal ? 'local' : 'produção', '→', window.FULLGAS_API_BASE);
})();
