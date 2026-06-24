/* =========================================================
   FULLGAS B2B — Adaptador de API
   ---------------------------------------------------------
   Inclua este arquivo DEPOIS de js/store.js em cada página:
     <script src="js/store.js"></script>
     <script src="js/api-adapter.js"></script>

   Ele substitui o "miolo" das funções FG que mexiam no
   localStorage por chamadas à API real. As telas (portal,
   loja, finder, admin) não precisam mudar nada.

   Estratégia: no login a API devolve o token; guardamos em
   localStorage. As leituras (FG.all) usam um cache em memória
   carregado uma vez por página, mantendo a interface síncrona
   que as telas já esperam.
   ========================================================= */
(function () {
  'use strict';

  // Ajuste para a URL onde a API está publicada.
  var API_BASE = window.FULLGAS_API_BASE || 'http://localhost:3000/api';
  var TOKEN_KEY = 'fullgas_token_v1';

  function token() { return localStorage.getItem(TOKEN_KEY) || ''; }

  // fetch autenticado que devolve JSON (lança em erro HTTP).
  function api(path, opts) {
    opts = opts || {};
    var headers = opts.headers || {};
    headers['Content-Type'] = 'application/json';
    if (token()) headers['Authorization'] = 'Bearer ' + token();
    return fetch(API_BASE + path, {
      method: opts.method || 'GET',
      headers: headers,
      body: opts.body ? JSON.stringify(opts.body) : undefined
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (data) {
        if (!r.ok) throw new Error(data.erro || ('HTTP ' + r.status));
        return data;
      });
    });
  }

  // Versão síncrona via XHR — usada só no boot para encher o cache
  // antes das telas renderizarem (mantém FG.all síncrono).
  function apiSync(path) {
    var xhr = new XMLHttpRequest();
    xhr.open('GET', API_BASE + path, false); // síncrono
    if (token()) xhr.setRequestHeader('Authorization', 'Bearer ' + token());
    try { xhr.send(); } catch (e) { return null; }
    if (xhr.status < 200 || xhr.status >= 300) return null;
    try { return JSON.parse(xhr.responseText); } catch (e) { return null; }
  }

  // Cache em memória que espelha o antigo "db".
  var CACHE = { products: [], categories: [], models: [], vehicles: [],
                orders: [], claims: [], invoices: [], deliveries: [],
                notifications: [], users: [], searches: [] };

  function carregarCache() {
    if (!token()) return;
    var prod = apiSync('/produtos'); if (prod) CACHE.products = prod;
    var cat = apiSync('/categorias'); if (cat) CACHE.categories = cat;
    var ped = apiSync('/pedidos'); if (ped) CACHE.orders = ped;
    var mod = apiSync('/veiculos/modelos'); if (mod) CACHE.models = mod;
    var veic = apiSync('/veiculos'); if (veic) CACHE.vehicles = veic;
    var fat = apiSync('/faturas'); if (fat) CACHE.invoices = fat;
    // (demais coleções entram nas próximas rotas: reivindicações, etc.)
  }

  // Recarrega o cache de faturas de forma síncrona (após mudanças que afetam
  // faturas de pré-venda, ex.: reposição de estoque que ativa pré-vendas).
  function recarregarFaturas() {
    var lista = apiSync('/faturas'); if (lista) CACHE.invoices = lista; return lista;
  }
  FG.recarregarFaturas = recarregarFaturas;

  // Recarrega o cache de veículos de forma síncrona (após venda/garantia).
  function recarregarVeiculos() {
    var lista = apiSync('/veiculos'); if (lista) CACHE.vehicles = lista; return lista;
  }
  FG.recarregarVeiculos = recarregarVeiculos;

  /* ---------- sobrescreve a camada de dados do FG ---------- */
  // Leituras passam a ler do cache em memória.
  FG.db = function () { return CACHE; };
  FG.all = function (col) { return CACHE[col] || []; };

  // Login agora chama a API; ao dar certo, guarda token + sessão e enche o cache.
  FG.login = function (email, senha) {
    try {
      var xhr = new XMLHttpRequest();
      xhr.open('POST', API_BASE + '/auth/login', false);
      xhr.setRequestHeader('Content-Type', 'application/json');
      xhr.send(JSON.stringify({ email: email, senha: senha }));
      var data = JSON.parse(xhr.responseText || '{}');
      if (xhr.status < 200 || xhr.status >= 300) return { ok: false, msg: data.erro || 'Falha no login.' };
      localStorage.setItem(TOKEN_KEY, data.token);
      localStorage.setItem('fullgas_session_v1', JSON.stringify({
        id: data.usuario.id, nome: data.usuario.nome, email: data.usuario.email,
        papel: data.usuario.papel, empresa: data.usuario.empresa, empresaId: data.usuario.empresaId
      }));
      carregarCache();
      return { ok: true };
    } catch (e) { return { ok: false, msg: 'Servidor indisponível.' }; }
  };

  FG.register = function (dados) {
    try {
      var xhr = new XMLHttpRequest();
      xhr.open('POST', API_BASE + '/auth/register', false);
      xhr.setRequestHeader('Content-Type', 'application/json');
      xhr.send(JSON.stringify(dados));
      var data = JSON.parse(xhr.responseText || '{}');
      if (xhr.status < 200 || xhr.status >= 300) return { ok: false, msg: data.erro || 'Falha no cadastro.' };
      return { ok: true };
    } catch (e) { return { ok: false, msg: 'Servidor indisponível.' }; }
  };

  FG.logout = function () {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem('fullgas_session_v1');
    location.href = 'index.html';
  };

  // Produtos (admin) — gravações assíncronas que atualizam o cache no fim.
  // Após gravar produto, recarrega produtos E faturas (a reposição de estoque
  // pode ter ativado faturas de pré-venda no servidor).
  function aposGravarProduto(lista) { recarregarFaturas(); return lista; }
  FG.apiCriarProduto = function (p) { return api('/produtos', { method: 'POST', body: p }).then(recarregarProdutos).then(aposGravarProduto); };
  FG.apiEditarProduto = function (sku, p) { return api('/produtos/' + encodeURIComponent(sku), { method: 'PUT', body: p }).then(recarregarProdutos).then(aposGravarProduto); };
  FG.apiExcluirProduto = function (sku) { return api('/produtos/' + encodeURIComponent(sku), { method: 'DELETE' }).then(recarregarProdutos).then(aposGravarProduto); };

  function recarregarProdutos() {
    return api('/produtos').then(function (lista) { CACHE.products = lista; return lista; });
  }

  // Recarrega o cache de pedidos de forma SÍNCRONA (usado logo após criar
  // pedido ou mudar status, para as telas já renderizarem o estado novo).
  function recarregarPedidos() {
    var lista = apiSync('/pedidos'); if (lista) CACHE.orders = lista; return lista;
  }
  FG.recarregarPedidos = recarregarPedidos;

  /* ---------- pedidos: substitui o miolo do store.js ---------- */
  // Cria o pedido a partir da cesta atual. Mantém a assinatura síncrona que o
  // shop.js espera (usa o retorno {cx,id} na confirmação imediata).
  FG.createOrder = function () {
    var s = FG.session(); var cart = FG.cart();
    if (!s || !cart.length) return null;
    var itens = cart.map(function (i) { return { sku: i.artigo, quantidade: i.qtd }; });
    try {
      var xhr = new XMLHttpRequest();
      xhr.open('POST', API_BASE + '/pedidos', false);
      xhr.setRequestHeader('Content-Type', 'application/json');
      if (token()) xhr.setRequestHeader('Authorization', 'Bearer ' + token());
      xhr.send(JSON.stringify({ itens: itens }));
      var data = JSON.parse(xhr.responseText || '{}');
      if (xhr.status < 200 || xhr.status >= 300) {
        FG.toast(data.erro || 'Não foi possível finalizar o pedido.');
        return null;
      }
      FG.cartClear();
      recarregarPedidos();                       // pedido novo entra no histórico
      var prod = apiSync('/produtos'); if (prod) CACHE.products = prod; // estoque baixou
      return data;
    } catch (e) {
      FG.toast('Servidor indisponível.');
      return null;
    }
  };

  // PUT síncrono genérico que devolve { ok, ... }. Em sucesso recarrega os
  // caches de pedidos e produtos (status/envio podem mexer no estoque).
  function putSync(path, body) {
    try {
      var xhr = new XMLHttpRequest();
      xhr.open('PUT', API_BASE + path, false);
      xhr.setRequestHeader('Content-Type', 'application/json');
      if (token()) xhr.setRequestHeader('Authorization', 'Bearer ' + token());
      xhr.send(JSON.stringify(body || {}));
      var data = JSON.parse(xhr.responseText || '{}');
      if (xhr.status < 200 || xhr.status >= 300)
        return { ok: false, msg: data.erro || 'Operação não concluída.' };
      recarregarPedidos();
      var prod = apiSync('/produtos'); if (prod) CACHE.products = prod;
      data.ok = true;
      return data;
    } catch (e) {
      return { ok: false, msg: 'Servidor indisponível.' };
    }
  }

  // Muda o status do pedido (admin). Ao enviar, a API gera entrega + fatura.
  // Devolve { ok, ... }; em 409 (ex.: pedido terminal) vem { ok:false, msg }.
  FG.setOrderStatus = function (id, status) {
    return putSync('/pedidos/' + encodeURIComponent(id) + '/status', { status: status });
  };

  // Detalhe rico do pedido (itens com qtdEnviada/backorder/estoque, entregas,
  // faturas e progresso). Síncrono — as telas renderizam direto.
  FG.pedidoDetalhe = function (numero) {
    return apiSync('/pedidos/' + encodeURIComponent(numero));
  };

  // Envio segmentado por escopo: 'normal' | 'backorder' | 'tudo' (admin).
  // Gera Entrega + Fatura cobrindo só os itens daquele escopo.
  FG.enviarPedidoEscopo = function (numero, escopo) {
    return putSync('/pedidos/' + encodeURIComponent(numero) + '/status', { escopo: escopo });
  };

  // Ajuste manual da quantidade enviada de um item do pedido (admin).
  FG.setItemEnviado = function (numero, itemId, qtd) {
    return putSync('/pedidos/' + encodeURIComponent(numero) + '/itens/' + itemId + '/enviado', { qtd: qtd });
  };

  /* ---------- veículos: substitui as ações inline do portal.js ---------- */
  // POST síncrono genérico; em sucesso devolve { ok, ... } com o corpo da API.
  function postSync(path, body) {
    try {
      var xhr = new XMLHttpRequest();
      xhr.open('POST', API_BASE + path, false);
      xhr.setRequestHeader('Content-Type', 'application/json');
      if (token()) xhr.setRequestHeader('Authorization', 'Bearer ' + token());
      xhr.send(JSON.stringify(body || {}));
      var data = JSON.parse(xhr.responseText || '{}');
      if (xhr.status < 200 || xhr.status >= 300)
        return { ok: false, msg: data.erro || 'Operação não concluída.' };
      data.ok = true;
      return data;
    } catch (e) {
      return { ok: false, msg: 'Servidor indisponível.' };
    }
  }

  // Registra venda do veículo (Status=Vendido + garantia). Recarrega o cache.
  // `dados` = { cliente, cpf, email, telefone, endereco }.
  FG.registrarVenda = function (niv, dados) {
    var r = postSync('/veiculos/' + encodeURIComponent(niv) + '/venda', dados || {});
    if (r.ok) recarregarVeiculos();
    return r;
  };

  // Ativa a garantia do veículo. Recarrega o cache em caso de sucesso.
  FG.ativarGarantia = function (niv) {
    var r = postSync('/veiculos/' + encodeURIComponent(niv) + '/garantia');
    if (r.ok) recarregarVeiculos();
    return r;
  };

  // Expõe helpers para depuração no console.
  FG._api = api;
  FG._cache = CACHE;

  // Carrega o cache assim que a página abre (se já houver token).
  carregarCache();
})();
