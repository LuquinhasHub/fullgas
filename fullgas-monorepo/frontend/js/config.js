/* =========================================================
   FULLGAS B2B — Configuração de ambiente do front-end
   ---------------------------------------------------------
   Este arquivo decide para qual API o front aponta, sem que
   você precise editar código ao trocar de ambiente.

   Carregue-o ANTES do api-adapter.js em cada página:
     <script src="js/config.js"></script>
     <script src="js/store.js"></script>
     <script src="js/api-adapter.js"></script>

   Como funciona: se o site estiver rodando em localhost,
   usa a API local; caso contrário, usa a API de produção.
   ========================================================= */
(function () {
  'use strict';

  var host = location.hostname;
  var ehLocal = host === 'localhost' || host === '127.0.0.1' || host === '';

  // >>> AJUSTE AQUI a URL pública da sua API depois do deploy <<<
  var API_PRODUCAO = 'https://fullgas-api.onrender.com/api';
  var API_LOCAL = 'http://localhost:3000/api';

  window.FULLGAS_API_BASE = ehLocal ? API_LOCAL : API_PRODUCAO;

  // Pequeno log pra você confirmar no console qual API está em uso.
  console.log('[Fullgas] Ambiente:', ehLocal ? 'local' : 'produção', '→', window.FULLGAS_API_BASE);
})();
