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

  /* =======================================================================
     GUARDIÃO DE SESSÃO — expiração por tempo e por inatividade
     -----------------------------------------------------------------------
     Problema que isto resolve: o token JWT expira no servidor (8h), mas o
     front guardava a sessão no localStorage SEM nenhuma validade. Se o
     usuário deixava o PC ligado e logado, ao voltar (F5) a tela continuava
     "logada" — mas toda chamada à API respondia 401 e o portal quebrava,
     sem devolver o usuário ao login.

     Três camadas, todas convergindo para encerrarSessao():
       1. Validade do token: lemos o claim `exp` do próprio JWT.
       2. Inatividade: INATIVIDADE_MS sem mouse/teclado/toque encerram a
          sessão. O carimbo fica no localStorage porque o site tem várias
          páginas (portal → loja → finder) e um timer em memória zeraria a
          cada navegação.
       3. Resposta 401 da API: qualquer chamada autenticada que volte 401
          encerra a sessão na hora (ver função api(), logo abaixo).
     ======================================================================= */
  var INATIVIDADE_MS = 30 * 60 * 1000;          // 30 min sem interação
  var ATIVIDADE_KEY  = 'fullgas_ultima_atividade';
  var CHECAGEM_MS    = 30 * 1000;               // varredura periódica
  var encerrando     = false;                   // trava anti-loop de redirect

  // Lê o claim `exp` (segundos UNIX) de dentro do JWT e devolve em ms.
  // 0 quando não há token ou o payload é ilegível (idle ainda cobre o caso).
  function tokenExpiraEm() {
    var t = token();
    if (!t) return 0;
    try {
      var b64 = t.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
      var exp = JSON.parse(atob(b64)).exp;
      return exp ? exp * 1000 : 0;
    } catch (e) { return 0; }
  }

  function marcarAtividade() {
    try { localStorage.setItem(ATIVIDADE_KEY, String(Date.now())); } catch (e) {}
  }

  // Devolve o motivo pelo qual a sessão deve ser encerrada, ou null se está OK.
  // 'expirada' = token venceu; 'inatividade' = tempo ocioso estourado.
  function motivoEncerramento() {
    if (!token()) return null;                  // não há sessão a encerrar
    var exp = tokenExpiraEm();
    if (exp && Date.now() >= exp) return 'expirada';
    var ultima = parseInt(localStorage.getItem(ATIVIDADE_KEY) || '0', 10);
    if (ultima && (Date.now() - ultima) >= INATIVIDADE_MS) return 'inatividade';
    return null;
  }

  // Limpa a sessão e volta ao login com o motivo na URL, para que a tela de
  // login (auth.js) explique ao usuário por que ele foi desconectado.
  function encerrarSessao(motivo) {
    if (encerrando) return;
    encerrando = true;
    try {
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem('fullgas_session_v1');
      localStorage.removeItem(ADMIN_TOKEN_KEY);
      localStorage.removeItem(ADMIN_SESS_KEY);
      localStorage.removeItem(ATIVIDADE_KEY);
    } catch (e) {}
    location.href = '/?sessao=' + (motivo || 'expirada');
  }
  FG.encerrarSessao = encerrarSessao;

  // FG.guard() (definido em store.js) passa a checar validade, não só presença.
  var guardBase = FG.guard;
  FG.guard = function (papel) {
    var motivo = motivoEncerramento();
    if (motivo) { encerrarSessao(motivo); return null; }
    return guardBase ? guardBase.call(FG, papel) : null;
  };

  // Vigilância só faz sentido quando há sessão. Na tela de login não há token.
  if (token()) {
    marcarAtividade();                          // (re)abrir a página conta como atividade
    ['click', 'keydown', 'mousemove', 'scroll', 'touchstart'].forEach(function (ev) {
      window.addEventListener(ev, marcarAtividade, { passive: true });
    });
    // Pega o PC deixado ligado sem nenhuma chamada de API acontecendo.
    setInterval(function () {
      var motivo = motivoEncerramento();
      if (motivo) encerrarSessao(motivo);
    }, CHECAGEM_MS);
  }

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
        if (!r.ok) {
          // Token vencido/invalidado no servidor: se ainda temos um token
          // guardado, a sessão morreu — encerra na hora e volta ao login.
          if (r.status === 401 && token()) encerrarSessao('expirada');
          throw new Error(data.erro || ('HTTP ' + r.status));
        }
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
      apiGet('/reivindicacoes'),
      apiGet('/usuarios'), // só admin recebe; cliente resolve null (apiGet nunca rejeita)
      apiGet('/notificacoes')
    ]).then(function (r) {
      if (r[0]) CACHE.products = r[0];
      if (r[1]) CACHE.categories = r[1];
      if (r[2]) CACHE.orders = r[2];
      if (r[3]) CACHE.models = r[3];
      if (r[4]) CACHE.vehicles = r[4];
      if (r[5]) CACHE.invoices = r[5];
      if (r[6]) CACHE.prevenda = r[6];
      if (r[7]) CACHE.claims = r[7];
      if (r[8]) CACHE.users = r[8];
      if (r[9]) CACHE.notifications = r[9];
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

  function recarregarUsuarios() {
    return apiGet('/usuarios').then(function (l) { if (l) CACHE.users = l; return l; });
  }
  FG.recarregarUsuarios = recarregarUsuarios;

  function recarregarNotifs() {
    return apiGet('/notificacoes').then(function (l) { if (l) CACHE.notifications = l; return l; });
  }
  FG.recarregarNotifs = recarregarNotifs;

  /* ---------- notificações (admin → concessionárias) ---------- */
  // Marca lida/não lida (estado POR USUÁRIO na API). Atualiza o cache.
  FG.markNotif = function (id, lida) {
    var n = CACHE.notifications.find(function (x) { return String(x.id) === String(id); });
    if (n) n.lida = lida; // otimista: a tela reflete na hora
    return req('PATCH', '/notificacoes/' + encodeURIComponent(id) + '/lida', { lida: !!lida });
  };

  // Admin envia notificação. `dados` = { titulo, texto, tipo, empresaId?,
  // anexo? (File) }. Multipart montado aqui (fetch próprio — o api() força
  // Content-Type JSON). Devolve Promise<{ ok, msg? }>.
  FG.notifEnviar = function (dados) {
    var fd = new FormData();
    fd.append('titulo', dados.titulo || '');
    fd.append('texto', dados.texto || '');
    fd.append('tipo', dados.tipo || 'info');
    if (dados.empresaId) fd.append('empresaId', dados.empresaId);
    if (dados.anexo) fd.append('anexo', dados.anexo);
    return fetch(API_BASE + '/notificacoes', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + token(), 'ngrok-skip-browser-warning': '1' },
      body: fd
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (data) {
        if (!r.ok) return { ok: false, msg: data.erro || ('HTTP ' + r.status) };
        return recarregarNotifs().then(function () { return { ok: true }; });
      });
    }, function () { return { ok: false, msg: 'Sem conexão com a API.' }; });
  };

  // Admin apaga uma notificação (anexo sai do disco na API).
  FG.notifApagar = function (id) {
    return req('DELETE', '/notificacoes/' + encodeURIComponent(id)).then(function (r) {
      if (!r.ok) return r;
      CACHE.notifications = CACHE.notifications.filter(function (x) { return String(x.id) !== String(id); });
      return r;
    });
  };

  /* ---------- Minha conta (concessionário) ---------- */
  // Visão da própria empresa: cadastro, endereço e contas internas.
  // Devolve Promise<{empresa, endereco, areas, usuarios} | null>.
  FG.conta = function () { return apiGet('/conta'); };

  // Gestor atualiza o cadastro da empresa (CNPJ, telefone, e-mail, endereço).
  FG.contaSalvarEmpresa = function (dados) { return req('PUT', '/conta/empresa', dados); };

  // Gestor cria conta interna (sub-dealer): { nome, email, senha, permissoes }.
  FG.subdealerCriar = function (dados) { return req('POST', '/conta/subdealers', dados); };

  // Gestor edita conta interna: { permissoes?, status?, senha? }.
  FG.subdealerEditar = function (id, patch) {
    return req('PATCH', '/conta/subdealers/' + encodeURIComponent(id), patch);
  };

  // Gestor exclui uma conta interna da própria empresa.
  FG.subdealerExcluir = function (id) {
    return req('DELETE', '/conta/subdealers/' + encodeURIComponent(id));
  };

  // Sub-dealer tem acesso à área? (null/ausente = acesso total; admin e
  // gestor nunca são restringidos). Usada p/ esconder abas e travar páginas.
  FG.temArea = function (sess, area) {
    if (!sess) return false;
    if (sess.papel === 'admin' || sess.gestor || !Array.isArray(sess.permissoes)) return true;
    return sess.permissoes.indexOf(area) !== -1;
  };

  // Gestão de usuários (admin): aprova / bloqueia / muda papel. Devolve
  // Promise<{ ok, msg? }>. Atualiza o cache no sucesso para o re-render refletir.
  FG.setUser = function (id, patch) {
    return req('PATCH', '/usuarios/' + encodeURIComponent(id), patch).then(function (r) {
      if (!r.ok) return r;
      var u = CACHE.users.find(function (x) { return String(x.id) === String(id); });
      if (u) Object.keys(patch).forEach(function (k) { u[k] = patch[k]; });
      return r;
    });
  };

  // Exclui um cliente indesejado/bloqueado (admin). Master e usuários com
  // histórico são recusados pela API. Devolve Promise<{ ok, msg? }>.
  FG.delUser = function (id) {
    return req('DELETE', '/usuarios/' + encodeURIComponent(id)).then(function (r) {
      if (!r.ok) return r;
      CACHE.users = CACHE.users.filter(function (x) { return String(x.id) !== String(id); });
      return r;
    });
  };

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
          papel: data.usuario.papel, empresa: data.usuario.empresa, empresaId: data.usuario.empresaId,
          gestor: !!data.usuario.gestor,
          permissoes: data.usuario.permissoes || null  // null = acesso total
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

  /* ---------- esqueci minha senha ----------
     Nenhuma das três revela se o e-mail existe: a mensagem de sucesso é
     sempre a mesma, venha o cadastro de onde vier. */

  // Dispara o e-mail com o link de redefinição. Promise<{ ok, msg }>.
  FG.esqueciSenha = function (email) {
    return api('/auth/senha/esqueci', { method: 'POST', body: { email: email } })
      .then(function (d) { return { ok: true, msg: d.msg }; },
            function (e) { return { ok: false, msg: (e && e.message) || 'Não foi possível enviar agora.' }; });
  };

  // O link ainda vale? Promise<{ ok, nome?, email? (mascarado), msg? }>.
  FG.verificarTokenSenha = function (token) {
    return api('/auth/senha/verificar', { method: 'POST', body: { token: token } })
      .then(function (d) { return { ok: true, nome: d.nome, email: d.email }; },
            function (e) { return { ok: false, msg: (e && e.message) || 'Link inválido ou expirado.' }; });
  };

  // Grava a nova senha e queima o token. Promise<{ ok, msg }>.
  FG.redefinirSenha = function (token, senha) {
    return api('/auth/senha/redefinir', { method: 'POST', body: { token: token, senha: senha } })
      .then(function (d) { return { ok: true, msg: d.msg }; },
            function (e) { return { ok: false, msg: (e && e.message) || 'Não foi possível alterar a senha.' }; });
  };

  /* ---------- alteração de identidade (admin entra na conta do cliente) ----------
     A sessão do admin é guardada à parte antes da troca, para ele voltar com um
     clique. Enquanto durar, uma tarja fixa no topo avisa em qual conta ele está
     — ninguém pode esquecer que está agindo pelo cliente. */
  var ADMIN_TOKEN_KEY = 'fullgas_admin_token_v1';
  var ADMIN_SESS_KEY = 'fullgas_admin_sessao_v1';

  // Sessão do admin guardada, ou null quando não há identidade assumida.
  FG.identidadeAssumida = function () {
    try { return JSON.parse(localStorage.getItem(ADMIN_SESS_KEY) || 'null'); }
    catch (e) { return null; }
  };

  // Admin assume a identidade de um usuário. Promise<{ ok, msg? }>.
  FG.assumirIdentidade = function (id) {
    return api('/usuarios/' + encodeURIComponent(id) + '/identidade', { method: 'POST' })
      .then(function (d) {
        // Guarda a sessão do admin ANTES de sobrescrever (só a primeira vez —
        // assumir outra identidade em seguida não pode perder o original).
        if (!localStorage.getItem(ADMIN_TOKEN_KEY)) {
          localStorage.setItem(ADMIN_TOKEN_KEY, localStorage.getItem(TOKEN_KEY) || '');
          localStorage.setItem(ADMIN_SESS_KEY, localStorage.getItem('fullgas_session_v1') || '');
        }
        localStorage.setItem(TOKEN_KEY, d.token);
        localStorage.setItem('fullgas_session_v1', JSON.stringify({
          id: d.usuario.id, nome: d.usuario.nome, email: d.usuario.email,
          papel: d.usuario.papel, empresa: d.usuario.empresa, empresaId: d.usuario.empresaId,
          gestor: !!d.usuario.gestor, permissoes: d.usuario.permissoes || null
        }));
        return { ok: true, usuario: d.usuario };
      }, function (e) {
        return { ok: false, msg: (e && e.message) || 'Não foi possível assumir a identidade.' };
      });
  };

  // Devolve o admin à própria conta.
  FG.voltarIdentidade = function (destino) {
    var t = localStorage.getItem(ADMIN_TOKEN_KEY);
    var s = localStorage.getItem(ADMIN_SESS_KEY);
    localStorage.removeItem(ADMIN_TOKEN_KEY);
    localStorage.removeItem(ADMIN_SESS_KEY);
    if (t && s) {
      localStorage.setItem(TOKEN_KEY, t);
      localStorage.setItem('fullgas_session_v1', s);
      location.href = destino || '/admin';
      return;
    }
    FG.logout();   // sem backup não dá para voltar: cai no login
  };

  // Tarja fixa de aviso, injetada em qualquer página enquanto houver identidade
  // assumida. Fica no adaptador (carregado em todas as telas) para não precisar
  // repetir o mesmo bloco em portal/loja/finder.
  function montarTarjaIdentidade() {
    var adm = FG.identidadeAssumida();
    if (!adm || document.getElementById('fg-imp-bar')) return;
    var atual = FG.session() || {};
    var bar = document.createElement('div');
    bar.id = 'fg-imp-bar';
    bar.className = 'imp-bar';
    bar.innerHTML =
      '<span class="imp-ico" aria-hidden="true">👁</span>' +
      '<span class="imp-txt">Você está usando o portal como <b></b>' +
      '<span class="imp-emp"></span> — tudo o que fizer aqui vale como se fosse o cliente.</span>' +
      '<button type="button" class="imp-sair">Voltar para minha conta</button>';
    bar.querySelector('b').textContent = atual.nome || '—';
    bar.querySelector('.imp-emp').textContent = atual.empresa ? ' (' + atual.empresa + ')' : '';
    bar.querySelector('.imp-sair').addEventListener('click', function () { FG.voltarIdentidade(); });
    document.body.insertBefore(bar, document.body.firstChild);
    document.body.classList.add('com-imp-bar');
  }
  if (document.readyState === 'loading')
    document.addEventListener('DOMContentLoaded', montarTarjaIdentidade);
  else montarTarjaIdentidade();

  FG.logout = function () {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem('fullgas_session_v1');
    localStorage.removeItem(ADMIN_TOKEN_KEY);
    localStorage.removeItem(ADMIN_SESS_KEY);
    location.href = '/';
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

  /* ---------- categorias (admin) ---------- */
  function recarregarCategorias() {
    return apiGet('/categorias').then(function (l) { if (l) CACHE.categories = l; return l; });
  }
  FG.recarregarCategorias = recarregarCategorias;

  // Cria categoria de topo ou subcategoria. `dados` = { nome, icone?, pai? }.
  FG.apiCriarCategoria = function (dados) {
    return req('POST', '/categorias', dados).then(function (r) {
      if (!r.ok) return r;
      return recarregarCategorias().then(function () { return r; });
    });
  };
  // Renomeia / troca o ícone. `dados` = { nome, icone? }.
  FG.apiEditarCategoria = function (codigo, dados) {
    return req('PUT', '/categorias/' + encodeURIComponent(codigo), dados).then(function (r) {
      if (!r.ok) return r;
      return recarregarCategorias().then(function () { return r; });
    });
  };
  FG.apiExcluirCategoria = function (codigo) {
    return req('DELETE', '/categorias/' + encodeURIComponent(codigo)).then(function (r) {
      if (!r.ok) return r;
      return recarregarCategorias().then(function () { return r; });
    });
  };
  // Foto da categoria (miniatura da grade da loja). Recarrega o cache no ok.
  FG.uploadImagemCategoria = function (codigo, file) {
    return uploadImagem('/categorias/' + encodeURIComponent(codigo) + '/imagem', file).then(function (r) {
      if (!r.ok) return r;
      return recarregarCategorias().then(function () { return r; });
    });
  };
  FG.removerImagemCategoria = function (codigo) {
    return req('DELETE', '/categorias/' + encodeURIComponent(codigo) + '/imagem').then(function (r) {
      if (!r.ok) return r;
      return recarregarCategorias().then(function () { return r; });
    });
  };

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

  // Detalhe rico do pedido (itens com qtdEnviada/backorder/estoque, faturas
  // e progresso). Promise<detalhe|null>.
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

  // Lista de concessionárias ativas (SÓ ADMIN) — alimenta o autocomplete de
  // atribuição/transferência de chassi. Cacheada após a primeira chamada.
  var _empresas = null;
  FG.empresas = function () {
    if (_empresas) return Promise.resolve(_empresas);
    return apiGet('/empresas').then(function (l) { _empresas = l || []; return _empresas; });
  };

  // Cadastra um chassi novo (SÓ ADMIN): { niv, modeloId, cor?, numeroMotor?,
  // empresaId? }. Recarrega o cache de veículos no sucesso.
  FG.criarVeiculo = function (dados) {
    return req('POST', '/veiculos', dados).then(function (r) {
      if (!r.ok) return r;
      return recarregarVeiculos().then(function () { return r; });
    });
  };

  // Transfere o chassi para outra concessionária (SÓ ADMIN). `destino` pode
  // ser o NOME (string) ou { empresaId } vindo do autocomplete. Recarrega o
  // cache de veículos no sucesso.
  FG.transferirVeiculo = function (niv, destino) {
    var body = typeof destino === 'object' ? destino : { empresa: destino };
    return req('PUT', '/veiculos/' + encodeURIComponent(niv) + '/transferir', body).then(function (r) {
      if (!r.ok) return r;
      return recarregarVeiculos().then(function () { return r; });
    });
  };

  /* ---------- reivindicações ---------- */
  // Cria reivindicação. `dados` = { tipo, niv, descricao, status, pecas?,
  // dataDefeito?, horimetro?, quilometragem? }, onde pecas = [{ sku, quantidade }].
  // EmpresaId/UsuarioId vêm do token. As fotos sobem depois via
  // FG.uploadClaimFotos. Promise<claim|null>.
  FG.createClaim = function (dados) {
    return req('POST', '/reivindicacoes', {
      origem: dados.origem, numeroPedido: dados.numeroPedido,
      tipo: dados.tipo, niv: dados.niv, descricao: dados.descricao, status: dados.status,
      pecas: dados.pecas, dataDefeito: dados.dataDefeito,
      horimetro: dados.horimetro, quilometragem: dados.quilometragem
    }).then(function (r) {
      if (!r.ok) { FG.toast(r.msg || 'Não foi possível registrar a reivindicação.', 'erro'); return null; }
      return recarregarClaims().then(function () { return r; });
    });
  };

  // Sobe fotos para uma reivindicação (multipart). `files` = FileList/array de
  // File. Promise<{ ok, anexos?, msg? }>. NÃO define Content-Type (o browser
  // monta o boundary do multipart). Recarrega o cache de claims no sucesso.
  FG.uploadClaimFotos = function (numero, files) {
    if (!files || !files.length) return Promise.resolve({ ok: true, anexos: [] });
    var fd = new FormData();
    for (var i = 0; i < files.length; i++) fd.append('fotos', files[i]);
    var headers = { 'ngrok-skip-browser-warning': '1' };
    if (token()) headers['Authorization'] = 'Bearer ' + token();
    return fetch(API_BASE + '/reivindicacoes/' + encodeURIComponent(numero) + '/anexos', {
      method: 'POST', headers: headers, body: fd
    }).then(function (resp) {
      return resp.json().catch(function () { return {}; }).then(function (data) {
        if (!resp.ok) return { ok: false, msg: data.erro || ('HTTP ' + resp.status) };
        data.ok = true;
        return recarregarClaims().then(function () { return data; });
      });
    }, function () { return { ok: false, msg: 'Falha no envio das fotos.' }; });
  };

  // Muda o status da reivindicação (admin). Promise<{ ok, ... }>.
  // Aprovar cria um pedido de garantia (e baixa estoque) — recarrega também
  // pedidos, produtos e o rastreador de pré-venda.
  FG.setClaimStatus = function (id, status) {
    return req('PUT', '/reivindicacoes/' + encodeURIComponent(id) + '/status', { status: status }).then(function (r) {
      if (!r.ok) { FG.toast(r.msg || 'Não foi possível atualizar o status.', 'erro'); return r; }
      var extras = status === 'Aprovada'
        ? [recarregarPedidos(), recarregarProdutos(), recarregarPreVenda()]
        : [];
      return Promise.all([recarregarClaims()].concat(extras)).then(function () { return r; });
    });
  };

  // Edita/reenvia uma reivindicação (cliente da própria empresa, ex.: após ser
  // devolvida). `dados` no mesmo formato de createClaim. Promise<claim|null>.
  FG.updateClaim = function (numero, dados) {
    return req('PUT', '/reivindicacoes/' + encodeURIComponent(numero), {
      origem: dados.origem, numeroPedido: dados.numeroPedido,
      tipo: dados.tipo, niv: dados.niv, descricao: dados.descricao,
      pecas: dados.pecas, dataDefeito: dados.dataDefeito,
      horimetro: dados.horimetro, quilometragem: dados.quilometragem
    }).then(function (r) {
      if (!r.ok) { FG.toast(r.msg || 'Não foi possível salvar as alterações.', 'erro'); return null; }
      return recarregarClaims().then(function () { return r; });
    });
  };

  // Devolve a reivindicação ao revendedor (admin), com o que falta (obrigatório).
  FG.devolverClaim = function (numero, faltaInformacao) {
    return req('PUT', '/reivindicacoes/' + encodeURIComponent(numero) + '/devolver',
      { faltaInformacao: faltaInformacao }).then(function (r) {
      if (!r.ok) { FG.toast(r.msg || 'Não foi possível devolver.', 'erro'); return r; }
      return recarregarClaims().then(function () { return r; });
    });
  };

  /* ---------- Parts Finder ---------- */
  // Upload multipart genérico (campo "imagem"). NÃO define Content-Type (o
  // browser monta o boundary). Devolve Promise<{ ok, imagem?, msg? }>.
  function uploadImagem(path, file, method) {
    var fd = new FormData();
    fd.append('imagem', file);
    var headers = { 'ngrok-skip-browser-warning': '1' };
    if (token()) headers['Authorization'] = 'Bearer ' + token();
    return fetch(API_BASE + path, { method: method || 'POST', headers: headers, body: fd })
      .then(function (resp) {
        return resp.json().catch(function () { return {}; }).then(function (data) {
          if (!resp.ok) return { ok: false, msg: data.erro || ('HTTP ' + resp.status) };
          data.ok = true;
          return data;
        });
      }, function () { return { ok: false, msg: 'Falha no envio da imagem.' }; });
  }

  // ---- leituras (REJEITAM em erro — as telas tratam com .catch) ----
  // Lista de modelos do finder (com árvore). admin + todos=true inclui inativos.
  FG.finderModelos = function (todos) {
    return api('/finder/modelos' + (todos ? '?todos=1' : ''));
  };
  // Modelo + seções agrupadas por lado ({ chassi: [...], engine: [...] }).
  FG.finderModelo = function (codigo) {
    return api('/finder/modelos/' + encodeURIComponent(codigo));
  };
  // Seção com peças + hotspots + vizinhos (anterior/próxima do mesmo lado).
  FG.finderSecao = function (secaoId) {
    return api('/finder/secoes/' + secaoId);
  };
  // Busca por VIN ou número de motor → { modelo, veiculo }. Loga no LogBusca.
  FG.finderBusca = function (filtro) {
    var qs = filtro.vin ? 'vin=' + encodeURIComponent(filtro.vin)
      : 'motor=' + encodeURIComponent(filtro.motor);
    return api('/finder/busca?' + qs);
  };

  // ---- mutações admin (resolvem { ok, ... } — nunca rejeitam) ----
  FG.finderCriarModelo = function (d) { return req('POST', '/finder/modelos', d); };
  FG.finderEditarModelo = function (codigo, d) { return req('PUT', '/finder/modelos/' + encodeURIComponent(codigo), d); };
  FG.finderExcluirModelo = function (codigo) { return req('DELETE', '/finder/modelos/' + encodeURIComponent(codigo)); };
  FG.finderUploadImagemModelo = function (codigo, file) { return uploadImagem('/finder/modelos/' + encodeURIComponent(codigo) + '/imagem', file); };
  FG.finderRemoverImagemModelo = function (codigo) { return req('DELETE', '/finder/modelos/' + encodeURIComponent(codigo) + '/imagem'); };

  FG.finderCriarSecao = function (codigo, d) { return req('POST', '/finder/modelos/' + encodeURIComponent(codigo) + '/secoes', d); };
  FG.finderEditarSecao = function (secaoId, d) { return req('PUT', '/finder/secoes/' + secaoId, d); };
  FG.finderExcluirSecao = function (secaoId) { return req('DELETE', '/finder/secoes/' + secaoId); };
  FG.finderOrdemSecoes = function (codigo, lado, ids) {
    return req('PUT', '/finder/modelos/' + encodeURIComponent(codigo) + '/secoes/ordem', { lado: lado, ids: ids });
  };
  FG.finderUploadImagemSecao = function (secaoId, file) { return uploadImagem('/finder/secoes/' + secaoId + '/imagem', file); };
  FG.finderRemoverImagemSecao = function (secaoId) { return req('DELETE', '/finder/secoes/' + secaoId + '/imagem'); };

  FG.finderAddPeca = function (secaoId, d) { return req('POST', '/finder/secoes/' + secaoId + '/pecas', d); };
  FG.finderEditarPeca = function (pecaId, d) { return req('PUT', '/finder/pecas/' + pecaId, d); };
  FG.finderExcluirPeca = function (pecaId) { return req('DELETE', '/finder/pecas/' + pecaId); };
  FG.finderOrdemPecas = function (secaoId, ids) { return req('PUT', '/finder/secoes/' + secaoId + '/pecas/ordem', { ids: ids }); };

  FG.finderSalvarHotspots = function (secaoId, lista) { return req('PUT', '/finder/secoes/' + secaoId + '/hotspots', { hotspots: lista }); };
  FG.finderAddHotspot = function (secaoId, d) { return req('POST', '/finder/secoes/' + secaoId + '/hotspots', d); };
  FG.finderEditarHotspot = function (hotspotId, d) { return req('PUT', '/finder/hotspots/' + hotspotId, d); };
  FG.finderExcluirHotspot = function (hotspotId) { return req('DELETE', '/finder/hotspots/' + hotspotId); };

  // Foto do produto (miniatura da peça no finder). Recarrega o cache no ok.
  FG.uploadImagemProduto = function (sku, file) {
    return uploadImagem('/produtos/' + encodeURIComponent(sku) + '/imagem', file).then(function (r) {
      if (!r.ok) return r;
      return recarregarProdutos().then(function () { return r; });
    });
  };
  FG.removerImagemProduto = function (sku) {
    return req('DELETE', '/produtos/' + encodeURIComponent(sku) + '/imagem').then(function (r) {
      if (!r.ok) return r;
      return recarregarProdutos().then(function () { return r; });
    });
  };

  /* ---------- integração Tiny ERP (admin) ---------- */
  // Lista paginada de produtos do Tiny com a situação local de cada um
  // (novo / sku-existe / importado). REJEITA em erro — a tela trata.
  FG.tinyProdutos = function (pagina, pesquisa) {
    return api('/tiny/produtos?pagina=' + (pagina || 1) +
      (pesquisa ? '&pesquisa=' + encodeURIComponent(pesquisa) : ''));
  };
  // Importa/vincula os produtos selecionados. Recarrega o catálogo no fim.
  FG.tinyImportar = function (tinyIds, categoria) {
    return req('POST', '/tiny/importar', { tinyIds: tinyIds, categoria: categoria }).then(function (r) {
      if (!r.ok) return r;
      return recarregarProdutos().then(function () { return r; });
    });
  };
  // Sincroniza um bloco de SKUs contra o Tiny (a tela envia em lotes e soma
  // os resumos). Recarrega o catálogo no fim.
  FG.tinySyncLote = function (skus) {
    return req('POST', '/tiny/sync-lote', { skus: skus }).then(function (r) {
      if (!r.ok) return r;
      return recarregarProdutos().then(function () { return r; });
    });
  };
  // Registros de sincronização de UM produto (o log fica no editor do produto).
  FG.tinyLog = function (sku, limite) {
    return api('/tiny/log?limite=' + (limite || 20) +
      (sku ? '&sku=' + encodeURIComponent(sku) : ''));
  };
  // Exportações ao Tiny de UM pedido (exibidas no detalhe da venda no admin).
  FG.tinyPedidos = function (pedido) {
    return api('/tiny/pedidos' + (pedido ? '?pedido=' + encodeURIComponent(pedido) : ''));
  };
  // Força nova tentativa de uma exportação com erro.
  FG.tinyReexportar = function (exportId) {
    return req('POST', '/tiny/pedidos/' + exportId + '/reexportar');
  };

  // Expõe helpers para depuração no console.
  FG._api = api;
  FG._cache = CACHE;

  // Dispara o carregamento do cache assim que a página abre (se houver token).
  // FG.pronto resolve quando o cache está cheio — cada tela espera por ele
  // antes de montar o HTML, para nunca renderizar com dados vazios.
  FG.pronto = carregarCache();
})();
