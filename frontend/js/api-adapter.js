/* =========================================================
   FULLGAS B2B — Adaptador de API
   ---------------------------------------------------------
   Inclua este arquivo DEPOIS de js/store.js em cada página:
     <script src="js/store.js"></script>
     <script src="js/api-adapter.js"></script>

   Ele substitui o "miolo" das funções FG que mexiam no
   localStorage por chamadas à API real. As telas (portal,
   loja, finder, admin) continuam LENDO os dados de forma
   síncrona: FG.all() lê de um cache em memória.

   O cache é carregado de forma ASSÍNCRONA (fetch) — sem
   XMLHttpRequest síncrono, que os navegadores bloqueiam em
   requisições cross-origin (impede acesso de outro dispositivo
   ou hospedagem externa). Cada tela espera FG.pronto (uma
   Promise que resolve quando o cache está cheio) antes de
   renderizar.
   ========================================================= */
(function () {
  'use strict';

  // Ajuste para a URL onde a API está publicada.
  var API_BASE = window.FULLGAS_API_BASE || 'http://localhost:3000/api';
  var TOKEN_KEY = 'fullgas_token_v1';

  function token() { return localStorage.getItem(TOKEN_KEY) || ''; }

  // fetch autenticado que devolve JSON (REJEITA em erro HTTP, com a msg da API).
  function api(path, opts) {
    opts = opts || {};
    var headers = opts.headers || {};
    headers['Content-Type'] = 'application/json';
    headers['ngrok-skip-browser-warning'] = '1';
    if (token()) headers['Authorization'] = 'Bearer ' + token();
    return fetch(API_BASE + path, {
      method: opts.method || 'GET',
      headers: headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (data) {
        if (!r.ok) throw new Error(data.erro || ('HTTP ' + r.status));
        return data;
      });
    });
  }

  // GET resiliente para o cache: resolve com os dados ou null (nunca rejeita).
  function apiGet(path) {
    return api(path).then(function (d) { return d; }, function () { return null; });
  }

  // Cache em memória que espelha o antigo "db".
  var CACHE = { products: [], categories: [], models: [], vehicles: [],
                orders: [], claims: [], invoices: [], deliveries: [],
                notifications: [], users: [], searches: [], prevenda: [] };

  // Carrega TODO o cache de uma vez (em paralelo). Assíncrono — devolve uma
  // Promise que resolve quando o cache está cheio. Sem token, resolve vazio.
  function carregarCache() {
    if (!token()) return Promise.resolve(CACHE);
    return Promise.all([
      apiGet('/produtos'),
      apiGet('/categorias'),
      apiGet('/pedidos'),
      apiGet('/veiculos/modelos'),
      apiGet('/veiculos'),
      apiGet('/faturas'),
      apiGet('/prevenda'),
      apiGet('/reivindicacoes')
    ]).then(function (r) {
      if (r[0]) CACHE.products = r[0];
      if (r[1]) CACHE.categories = r[1];
      if (r[2]) CACHE.orders = r[2];
      if (r[3]) CACHE.models = r[3];
      if (r[4]) CACHE.vehicles = r[4];
      if (r[5]) CACHE.invoices = r[5];
      if (r[6]) CACHE.prevenda = r[6];
      if (r[7]) CACHE.claims = r[7];
      return CACHE;
      // (demais coleções entram nas próximas rotas: notificações, etc.)
    });
  }

  // Recargas pontuais (após mutações). Todas assíncronas — devolvem Promise.
  function recarregarFaturas() {
    return apiGet('/faturas').then(function (l) { if (l) CACHE.invoices = l; return l; });
  }
  FG.recarregarFaturas = recarregarFaturas;

  function recarregarPreVenda() {
    return apiGet('/prevenda').then(function (l) { if (l) CACHE.prevenda = l; return l; });
  }
  FG.recarregarPreVenda = recarregarPreVenda;

  function recarregarVeiculos() {
    return apiGet('/veiculos').then(function (l) { if (l) CACHE.vehicles = l; return l; });
  }
  FG.recarregarVeiculos = recarregarVeiculos;

  function recarregarClaims() {
    return apiGet('/reivindicacoes').then(function (l) { if (l) CACHE.claims = l; return l; });
  }
  FG.recarregarClaims = recarregarClaims;

  function recarregarPedidos() {
    return apiGet('/pedidos').then(function (l) { if (l) CACHE.orders = l; return l; });
  }
  FG.recarregarPedidos = recarregarPedidos;

  function recarregarProdutos() {
    return apiGet('/produtos').then(function (l) { if (l) CACHE.products = l; return l; });
  }

  /* ---------- sobrescreve a camada de dados do FG ---------- */
  // Leituras continuam SÍNCRONAS, lendo do cache em memória.
  FG.db = function () { return CACHE; };
  FG.all = function (col) { return CACHE[col] || []; };

  // Requisição genérica que NÃO rejeita: resolve { ok:true, ... } no sucesso
  // ou { ok:false, msg } no erro. Usada pelos wrappers de mutação.
  function req(method, path, body) {
    var opts = { method: method };
    if (body !== undefined) opts.body = body;
    return api(path, opts).then(function (data) {
      data = data || {};
      data.ok = true;
      return data;
    }, function (e) {
      return { ok: false, msg: (e && e.message) || 'Operação não concluída.' };
    });
  }

  // Login: chama a API e guarda token + sessão. Devolve Promise<{ ok, msg? }>.
  // O cache é (re)carregado na próxima página (redirect recarrega o app).
  FG.login = function (email, senha) {
    return api('/auth/login', { method: 'POST', body: { email: email, senha: senha } })
      .then(function (data) {
        localStorage.setItem(TOKEN_KEY, data.token);
        localStorage.setItem('fullgas_session_v1', JSON.stringify({
          id: data.usuario.id, nome: data.usuario.nome, email: data.usuario.email,
          papel: data.usuario.papel, empresa: data.usuario.empresa, empresaId: data.usuario.empresaId
        }));
        return { ok: true };
      }, function (e) {
        return { ok: false, msg: (e && e.message) || 'Falha no login.' };
      });
  };

  // Cadastro. Devolve Promise<{ ok, msg? }>.
  FG.register = function (dados) {
    return api('/auth/register', { method: 'POST', body: dados })
      .then(function () { return { ok: true }; },
            function (e) { return { ok: false, msg: (e && e.message) || 'Falha no cadastro.' }; });
  };

  FG.logout = function () {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem('fullgas_session_v1');
    location.href = 'index.html';
  };

  // Produtos (admin) — gravações que atualizam o cache no fim. Após gravar,
  // recarrega também o rastreador de pré-venda (repor estoque muda o status
  // das peças de "Aguardando" para "Disponível").
  function aposGravarProduto(lista) {
    return recarregarPreVenda().then(function () { return lista; });
  }
  FG.apiCriarProduto = function (p) { return api('/produtos', { method: 'POST', body: p }).then(recarregarProdutos).then(aposGravarProduto); };
  FG.apiEditarProduto = function (sku, p) { return api('/produtos/' + encodeURIComponent(sku), { method: 'PUT', body: p }).then(recarregarProdutos).then(aposGravarProduto); };
  FG.apiExcluirProduto = function (sku) { return api('/produtos/' + encodeURIComponent(sku), { method: 'DELETE' }).then(recarregarProdutos).then(aposGravarProduto); };

  /* ---------- pedidos ---------- */
  // Cria o pedido a partir da cesta atual. Devolve Promise<data|null>; em erro
  // avisa via toast e resolve null. Recarrega pedidos + produtos no sucesso.
  FG.createOrder = function () {
    var s = FG.session(); var cart = FG.cart();
    if (!s || !cart.length) return Promise.resolve(null);
    var itens = cart.map(function (i) { return { sku: i.artigo, quantidade: i.qtd }; });
    return api('/pedidos', { method: 'POST', body: { itens: itens } }).then(function (data) {
      FG.cartClear();
      return Promise.all([recarregarPedidos(), recarregarProdutos()]).then(function () { return data; });
    }, function (e) {
      FG.toast((e && e.message) || 'Não foi possível finalizar o pedido.');
      return null;
    });
  };

  // PUT de pedido que mexe em estoque/envio: recarrega pedidos + produtos no ok.
  function putPedido(path, body) {
    return req('PUT', path, body).then(function (r) {
      if (!r.ok) return r;
      return Promise.all([recarregarPedidos(), recarregarProdutos()]).then(function () { return r; });
    });
  }

  // Muda o status do pedido (admin). Promise<{ ok, ... }>.
  FG.setOrderStatus = function (id, status) {
    return putPedido('/pedidos/' + encodeURIComponent(id) + '/status', { status: status });
  };

  // Detalhe rico do pedido (itens com qtdEnviada/backorder/estoque, entregas,
  // faturas e progresso). Promise<detalhe|null>.
  FG.pedidoDetalhe = function (numero) {
    return apiGet('/pedidos/' + encodeURIComponent(numero));
  };

  // Envio segmentado por escopo: 'normal' | 'backorder' | 'tudo' (admin).
  FG.enviarPedidoEscopo = function (numero, escopo) {
    return putPedido('/pedidos/' + encodeURIComponent(numero) + '/status', { escopo: escopo });
  };

  // Ação "Enviado" de um item / do rastreador de pré-venda (admin). Recarrega
  // pedidos, produtos e o rastreador no fim.
  FG.setItemEnviado = function (numero, itemId, qtd) {
    return putPedido('/pedidos/' + encodeURIComponent(numero) + '/itens/' + itemId + '/enviado', { qtd: qtd })
      .then(function (r) {
        if (!r.ok) return r;
        return recarregarPreVenda().then(function () { return r; });
      });
  };

  /* ---------- veículos: substitui as ações inline do portal.js ---------- */
  // Registra venda do veículo (Status=Vendido + garantia). Recarrega o cache.
  // `dados` = { cliente, cpf, email, telefone, endereco }.
  FG.registrarVenda = function (niv, dados) {
    return req('POST', '/veiculos/' + encodeURIComponent(niv) + '/venda', dados || {}).then(function (r) {
      if (!r.ok) return r;
      return recarregarVeiculos().then(function () { return r; });
    });
  };

  // Ativa a garantia do veículo. Recarrega o cache em caso de sucesso.
  FG.ativarGarantia = function (niv) {
    return req('POST', '/veiculos/' + encodeURIComponent(niv) + '/garantia').then(function (r) {
      if (!r.ok) return r;
      return recarregarVeiculos().then(function () { return r; });
    });
  };

  /* ---------- reivindicações ---------- */
  // Cria reivindicação. `dados` = { criador?, tipo, niv, descricao, status }.
  // EmpresaId/UsuarioId são derivados do token na API. Promise<claim|null>.
  FG.createClaim = function (dados) {
    return req('POST', '/reivindicacoes', {
      tipo: dados.tipo, niv: dados.niv, descricao: dados.descricao, status: dados.status
    }).then(function (r) {
      if (!r.ok) { FG.toast(r.msg || 'Não foi possível registrar a reivindicação.', 'erro'); return null; }
      return recarregarClaims().then(function () { return r; });
    });
  };

  // Muda o status da reivindicação (admin). Promise<{ ok, ... }>.
  FG.setClaimStatus = function (id, status) {
    return req('PUT', '/reivindicacoes/' + encodeURIComponent(id) + '/status', { status: status }).then(function (r) {
      if (!r.ok) { FG.toast(r.msg || 'Não foi possível atualizar o status.', 'erro'); return r; }
      return recarregarClaims().then(function () { return r; });
    });
  };

  // Expõe helpers para depuração no console.
  FG._api = api;
  FG._cache = CACHE;

  // Dispara o carregamento do cache assim que a página abre (se houver token).
  // FG.pronto resolve quando o cache está cheio — cada tela espera por ele
  // antes de montar o HTML, para nunca renderizar com dados vazios.
  FG.pronto = carregarCache();
})();
