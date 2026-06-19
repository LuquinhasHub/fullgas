/* =========================================================
   FULLGAS B2B — Painel administrativo (admin.html)
   ========================================================= */
(function () {
  'use strict';

  var sess = FG.guard('admin');
  if (!sess) return;

  var view = document.getElementById('adm-view');
  var h1 = document.getElementById('adm-h1');
  var esc = FG.esc;

  document.getElementById('adm-user').textContent = sess.nome;
  document.getElementById('adm-sair').addEventListener('click', function () { FG.logout(); });
  document.getElementById('adm-bell').addEventListener('click', function () { location.hash = '#usuarios'; });

  function refreshBell() {
    var n = FG.all('users').filter(function (u) { return u.status === 'pendente'; }).length;
    var dot = document.getElementById('adm-dot');
    dot.textContent = n;
    dot.classList.toggle('hidden', !n);
  }

  function setOn(rota) {
    Array.prototype.forEach.call(document.querySelectorAll('.adm-side a[data-rota]'), function (a) {
      a.classList.toggle('on', a.getAttribute('data-rota') === rota);
    });
  }
  function pill(v) { return '<span class="pill-status ' + esc(v) + '">' + esc(v) + '</span>'; }

  /* =========================================================
     DASHBOARD
     ========================================================= */
  function renderDash() {
    h1.textContent = 'Painel de Controle'; setOn('dashboard');
    var orders = FG.all('orders');
    var totalVendas = orders.reduce(function (t, o) { return t + o.total; }, 0);
    var ticket = orders.length ? totalVendas / orders.length : 0;

    /* pedidos por dia — últimos 7 dias */
    var dias = [], qtds = [], receita7 = 0, qtd7 = 0;
    for (var i = 6; i >= 0; i--) {
      var d = new Date(); d.setDate(d.getDate() - i);
      var chave = d.toISOString().slice(0, 10);
      var doDia = orders.filter(function (o) { return o.data.slice(0, 10) === chave; });
      dias.push(FG.pad(d.getDate(), 2) + '/' + FG.pad(d.getMonth() + 1, 2));
      qtds.push(doDia.length);
      doDia.forEach(function (o) { receita7 += o.total; qtd7 += o.itens.reduce(function (n, it) { return n + it.qtd; }, 0); });
    }
    var maxQ = Math.max.apply(null, qtds.concat([1]));

    /* mais vendidos */
    var agg = {};
    orders.forEach(function (o) {
      o.itens.forEach(function (it) {
        var a = agg[it.artigo] || (agg[it.artigo] = { nome: it.nome, preco: it.preco, qtd: 0 });
        a.qtd += it.qtd;
      });
    });
    var top = Object.keys(agg).map(function (k) { return { artigo: k, nome: agg[k].nome, preco: agg[k].preco, qtd: agg[k].qtd }; })
      .sort(function (a, b) { return b.qtd - a.qtd; }).slice(0, 5);

    var buscas = FG.all('searches').slice(0, 5);

    view.innerHTML =
      '<div class="adm-banner">ℹ️ É hora de <b>mudar sua senha</b>.</div>' +
      '<div class="adm-bar"><span class="scope">Escopo: <b>Todas as Visões de Loja</b> ▾ ❓</span>' +
      '<span class="grow"></span><button class="btn-orange" id="dz-reload">Recarregar</button></div>' +

      '<div class="dash-grid">' +

      /* coluna esquerda */
      '<div>' +
      '<div class="kpi"><div class="k-lbl">Período de Vendas</div><div class="k-val">' + FG.fmtMoney(totalVendas) + '</div></div>' +
      '<div class="kpi"><div class="k-lbl">Ticket Médio</div><div class="k-val">' + FG.fmtMoney(ticket) + '</div></div>' +

      '<div class="adm-card"><div class="c-head">Últimos Pedidos</div><div class="c-body">' +
      '<table class="tbl"><thead><tr><th>Cliente</th><th class="r">Itens</th><th class="r">Total</th></tr></thead><tbody>' +
      orders.slice(0, 5).map(function (o) {
        var n = o.itens.reduce(function (t, it) { return t + it.qtd; }, 0);
        return '<tr><td>' + esc(o.empresa) + '</td><td class="r">' + n + '</td><td class="r">' + FG.fmtMoney(o.total) + '</td></tr>';
      }).join('') + '</tbody></table></div></div>' +

      '<div class="adm-card"><div class="c-head">Últimas Buscas</div><div class="c-body">' +
      '<table class="tbl"><thead><tr><th>Termo de pesquisa</th><th class="r">Resultados</th></tr></thead><tbody>' +
      (buscas.length ? buscas.map(function (s) {
        return '<tr><td>' + esc(s.termo) + '</td><td class="r">' + s.resultados + '</td></tr>';
      }).join('') : '<tr><td colspan="2" class="muted">Sem buscas registradas ainda.</td></tr>') +
      '</tbody></table></div></div>' +
      '</div>' +

      /* coluna direita */
      '<div>' +
      '<div class="adm-card"><div class="c-head">Pedidos — últimos 7 dias</div><div class="c-body">' +
      '<div class="chart">' + qtds.map(function (q) {
        return '<div class="bar" data-v="' + q + ' pedido(s)" style="height:' + Math.round((q / maxQ) * 100) + '%;"></div>';
      }).join('') + '</div>' +
      '<div class="chart-x">' + dias.map(function (d) { return '<span>' + d + '</span>'; }).join('') + '</div>' +
      '<div class="chart-stats">' +
      '<div class="s"><b>Receita</b><span class="v">' + FG.fmtMoney(receita7) + '</span></div>' +
      '<div class="s"><b>Taxas</b><span class="v">' + FG.fmtMoney(0) + '</span></div>' +
      '<div class="s"><b>Entrega</b><span class="v">' + FG.fmtMoney(receita7 ? 102.26 : 0) + '</span></div>' +
      '<div class="s"><b>Quantidade</b><span class="v">' + qtd7 + '</span></div>' +
      '</div></div></div>' +

      '<div class="adm-card"><div class="c-head">Mais Vendidos</div><div class="c-body">' +
      '<table class="tbl"><thead><tr><th>Produto</th><th class="r">Preço</th><th class="r">Quantidade</th></tr></thead><tbody>' +
      (top.length ? top.map(function (t) {
        return '<tr><td>' + esc(t.nome) + ' <span class="muted">(' + t.artigo + ')</span></td>' +
          '<td class="r">' + FG.fmtMoney(t.preco) + '</td><td class="r">' + t.qtd + '</td></tr>';
      }).join('') : '<tr><td colspan="3" class="muted">Sem vendas.</td></tr>') +
      '</tbody></table></div></div>' +
      '</div></div>';

    document.getElementById('dz-reload').addEventListener('click', renderDash);
  }

  /* =========================================================
     USUÁRIOS
     ========================================================= */
  function renderUsuarios() {
    h1.textContent = 'Administração de usuários'; setOn('usuarios');
    var users = FG.all('users');
    view.innerHTML =
      '<div class="adm-card"><div class="c-head">Usuários cadastrados (' + users.length + ')</div><div class="c-body">' +
      '<table class="tbl"><thead><tr><th>Nome</th><th>E-mail</th><th>Empresa</th><th>Papel</th><th>Status</th><th>Ações</th></tr></thead><tbody>' +
      users.map(function (u) {
        var acoes = '';
        if (u.status === 'pendente') acoes += '<button class="btn-orange btn-mini" data-ac="aprovar" data-id="' + u.id + '">Aprovar</button> ';
        if (u.id !== sess.id) {
          acoes += '<button class="btn-line btn-mini" data-ac="papel" data-id="' + u.id + '">' +
            (u.papel === 'admin' ? 'Tornar cliente' : 'Tornar admin') + '</button> ';
          acoes += '<button class="btn-line btn-mini" data-ac="bloq" data-id="' + u.id + '">' +
            (u.status === 'bloqueado' ? 'Desbloquear' : 'Bloquear') + '</button>';
        } else {
          acoes += '<span class="muted">(você)</span>';
        }
        return '<tr><td>' + esc(u.nome) + '</td><td>' + esc(u.email) + '</td><td>' + esc(u.empresa) + '</td>' +
          '<td>' + pill(u.papel) + '</td><td>' + pill(u.status) + '</td><td>' + acoes + '</td></tr>';
      }).join('') + '</tbody></table></div></div>';

    Array.prototype.forEach.call(view.querySelectorAll('[data-ac]'), function (b) {
      b.addEventListener('click', function () {
        var id = b.getAttribute('data-id');
        var u = FG.all('users').find(function (x) { return x.id === id; });
        if (!u) return;
        var ac = b.getAttribute('data-ac');
        if (ac === 'aprovar') { FG.setUser(id, { status: 'aprovado' }); FG.toast('Usuário aprovado.'); }
        if (ac === 'papel') {
          var novo = u.papel === 'admin' ? 'cliente' : 'admin';
          FG.setUser(id, { papel: novo }); FG.toast('Papel alterado para ' + novo + '.');
        }
        if (ac === 'bloq') {
          var st = u.status === 'bloqueado' ? 'aprovado' : 'bloqueado';
          FG.setUser(id, { status: st }); FG.toast(st === 'bloqueado' ? 'Usuário bloqueado.' : 'Usuário desbloqueado.');
        }
        refreshBell(); renderUsuarios();
      });
    });
  }

  /* =========================================================
     CATÁLOGO DE PRODUTOS
     ========================================================= */
  function renderProdutos() {
    h1.textContent = 'Catálogo de produtos'; setOn('produtos');
    var prods = FG.all('products');
    view.innerHTML =
      '<div class="adm-bar"><span class="grow"></span>' +
      '<button class="btn-orange" id="pr-novo">Adicionar produto</button></div>' +
      '<div class="adm-card"><div class="c-head">Produtos (' + prods.length + ')</div><div class="c-body">' +
      '<table class="tbl"><thead><tr><th>Artigo</th><th>Nome</th><th>Categoria</th>' +
      '<th class="r">Preço</th><th class="r">Estoque</th><th>Ações</th></tr></thead><tbody>' +
      prods.map(function (p) {
        var c = FG.category(p.cat);
        return '<tr><td>' + p.artigo + '</td><td>' + esc(p.nome) + '</td><td>' + esc(c ? c.nome : p.cat) + '</td>' +
          '<td class="r">' + FG.fmtMoney(p.preco) + '</td>' +
          '<td class="r">' + (p.estoque > 0 ? p.estoque : '<span style="color:#b91c1c;font-weight:700;">0</span>') + '</td>' +
          '<td><button class="btn-line btn-mini" data-ac="edit" data-art="' + p.artigo + '">Editar</button> ' +
          '<button class="btn-line btn-mini" data-ac="del" data-art="' + p.artigo + '">Excluir</button></td></tr>';
      }).join('') + '</tbody></table></div></div>';

    document.getElementById('pr-novo').addEventListener('click', function () { modalProduto(null); });
    Array.prototype.forEach.call(view.querySelectorAll('[data-ac]'), function (b) {
      b.addEventListener('click', function () {
        var art = b.getAttribute('data-art');
        if (b.getAttribute('data-ac') === 'edit') { modalProduto(FG.product(art)); return; }
        if (!confirm('Excluir o artigo ' + art + '?')) return;
        FG.setCol('products', FG.all('products').filter(function (p) { return p.artigo !== art; }));
        FG.toast('Artigo excluído.'); renderProdutos();
      });
    });
  }

  function modalProduto(p) {
    var novo = !p;
    var back = document.createElement('div');
    back.className = 'modal-back';
    back.innerHTML =
      '<div class="modal"><header><h3>' + (novo ? 'Novo produto' : 'Editar ' + p.artigo) + '</h3><button class="x">×</button></header>' +
      '<div class="modal-body">' +
      '<div class="field"><label>Número do artigo</label><input id="mp-art" type="text"' + (novo ? '' : ' disabled') + ' value="' + (p ? p.artigo : '') + '"></div>' +
      '<div class="field"><label>Nome</label><input id="mp-nome" type="text" value="' + (p ? esc(p.nome) : '') + '"></div>' +
      '<div class="field"><label>Categoria</label><select id="mp-cat">' +
      FG.all('categories').map(function (c) {
        return '<option value="' + c.id + '"' + (p && p.cat === c.id ? ' selected' : '') + '>' + esc(c.nome) + '</option>';
      }).join('') + '</select></div>' +
      '<div class="field"><label>Preço (R$)</label><input id="mp-preco" type="number" step="0.01" min="0" value="' + (p ? p.preco : '') + '"></div>' +
      '<div class="field"><label>Estoque</label><input id="mp-est" type="number" min="0" value="' + (p ? p.estoque : 0) + '"></div>' +
      '<div class="field"><label>Previsão de chegada (se sem estoque)</label><input id="mp-prev" type="text" placeholder="dd/mm/aa" value="' + (p && p.previsao ? p.previsao : '') + '"></div>' +
      '<div class="field"><label>Descrição</label><textarea id="mp-desc" rows="3">' + (p ? esc(p.descricao) : '') + '</textarea></div>' +
      '</div>' +
      '<div class="modal-foot"><button class="btn-line" id="mp-canc">Cancelar</button>' +
      '<button class="btn-orange" id="mp-ok">Salvar</button></div></div>';
    document.body.appendChild(back);

    function fechar() { back.remove(); }
    back.querySelector('.x').addEventListener('click', fechar);
    document.getElementById('mp-canc').addEventListener('click', fechar);
    back.addEventListener('click', function (e) { if (e.target === back) fechar(); });

    document.getElementById('mp-ok').addEventListener('click', function () {
      var art = document.getElementById('mp-art').value.trim().toUpperCase();
      var nome = document.getElementById('mp-nome').value.trim();
      var preco = Number(document.getElementById('mp-preco').value);
      if (!art || !nome || !(preco >= 0)) { FG.toast('Preencha artigo, nome e preço.'); return; }
      var prods = FG.all('products');
      if (novo && prods.some(function (x) { return x.artigo === art; })) { FG.toast('Já existe um produto com este artigo.'); return; }
      var dados = {
        artigo: art, nome: nome,
        cat: document.getElementById('mp-cat').value,
        preco: preco,
        estoque: Math.max(0, Number(document.getElementById('mp-est').value) || 0),
        previsao: document.getElementById('mp-prev').value.trim() || null,
        descricao: document.getElementById('mp-desc').value.trim()
      };
      if (novo) prods.push(dados);
      else prods = prods.map(function (x) { return x.artigo === art ? dados : x; });
      FG.setCol('products', prods);
      fechar(); FG.toast('Produto salvo.'); renderProdutos();
    });
  }

  /* =========================================================
     PEDIDOS
     ========================================================= */
  var STATUS = ['Pendente', 'Processando', 'Enviado', 'Entregue', 'Cancelado'];
  // Status terminais: uma vez aqui, o pedido não pode mais mudar de status.
  var STATUS_TERMINAIS = ['Entregue', 'Cancelado'];

  function renderPedidos() {
    h1.textContent = 'Gestão de pedidos'; setOn('pedidos');
    var orders = FG.all('orders');
    view.innerHTML =
      '<div class="adm-card"><div class="c-head">Pedidos (' + orders.length + ')</div><div class="c-body">' +
      '<table class="tbl"><thead><tr><th>Pedido</th><th>Empresa</th><th>Data</th>' +
      '<th class="r">Total</th><th>Status</th><th></th></tr></thead><tbody>' +
      orders.map(function (o, i) {
        return '<tr><td><b>' + o.cx + '</b><br><span class="muted">' + o.id + '</span>' +
          '<div class="od-itens hidden" data-i="' + i + '" style="margin-top:6px;">' +
          o.itens.map(function (it) { return '<div class="muted">' + it.qtd + '× ' + esc(it.nome) + ' (' + it.artigo + ')</div>'; }).join('') +
          '</div></td>' +
          '<td>' + esc(o.empresa) + '<br><span class="muted">' + esc(o.usuario) + '</span></td>' +
          '<td>' + FG.fmtDateTime(o.data) + '</td>' +
          '<td class="r">' + FG.fmtMoney(o.total) + '</td>' +
          '<td>' + pill(o.status) +
          (STATUS_TERMINAIS.indexOf(o.status) >= 0
            ? '<br><span class="muted" style="font-size:11px;">Pedido ' + esc(o.status.toLowerCase()) + ' — status final.</span>'
            : '<br><select class="inline-status" data-id="' + o.id + '" style="margin-top:6px;">' +
              STATUS.map(function (s) { return '<option' + (s === o.status ? ' selected' : '') + '>' + s + '</option>'; }).join('') +
              '</select>') +
          '</td>' +
          '<td><button class="btn-line btn-mini od-open" data-i="' + i + '">Itens</button></td></tr>';
      }).join('') + '</tbody></table></div></div>';

    Array.prototype.forEach.call(view.querySelectorAll('.od-open'), function (b) {
      b.addEventListener('click', function () {
        view.querySelector('.od-itens[data-i="' + b.getAttribute('data-i') + '"]').classList.toggle('hidden');
      });
    });
    Array.prototype.forEach.call(view.querySelectorAll('select.inline-status'), function (sel) {
      sel.addEventListener('change', function () {
        var res = FG.setOrderStatus(sel.getAttribute('data-id'), sel.value);
        if (res && res.ok === false) {
          FG.toast(res.msg || 'Não foi possível mudar o status.', 'erro');
        } else {
          FG.toast('Status atualizado' + (sel.value === 'Enviado' ? ' — entrega e fatura geradas.' : '.'));
        }
        renderPedidos();
      });
    });
  }

  /* =========================================================
     REIVINDICAÇÕES
     ========================================================= */
  var CL_STATUS = ['Em processo', 'Esboço', 'Aprovada', 'Recusada'];

  function renderClaims() {
    h1.textContent = 'Gestão de reivindicações'; setOn('reivindicacoes');
    var claims = FG.all('claims');
    view.innerHTML =
      '<div class="adm-card"><div class="c-head">Reivindicações (' + claims.length + ')</div><div class="c-body">' +
      '<table class="tbl"><thead><tr><th>N°</th><th>Data</th><th>Criador</th><th>Tipo</th>' +
      '<th>NIV</th><th>Descrição</th><th>Status</th></tr></thead><tbody>' +
      claims.map(function (c) {
        return '<tr><td>' + c.id + '</td><td>' + FG.fmtDate(c.data) + '</td><td>' + esc(c.criador) + '</td>' +
          '<td>' + esc(c.tipo) + '</td><td>' + c.niv + '</td><td>' + esc(c.descricao) + '</td>' +
          '<td>' + pill(c.status) + '<br><select class="inline-status" data-id="' + c.id + '" style="margin-top:6px;">' +
          CL_STATUS.map(function (s) { return '<option' + (s === c.status ? ' selected' : '') + '>' + s + '</option>'; }).join('') +
          '</select></td></tr>';
      }).join('') + '</tbody></table></div></div>';

    Array.prototype.forEach.call(view.querySelectorAll('select.inline-status'), function (sel) {
      sel.addEventListener('change', function () {
        FG.setClaimStatus(sel.getAttribute('data-id'), sel.value);
        FG.toast('Status da reivindicação atualizado.');
        renderClaims();
      });
    });
  }

  /* =========================================================
     ROUTER
     ========================================================= */
  function route() {
    var h = (location.hash || '#dashboard').slice(1);
    switch (h) {
      case 'dashboard': renderDash(); break;
      case 'usuarios': renderUsuarios(); break;
      case 'produtos': renderProdutos(); break;
      case 'pedidos': renderPedidos(); break;
      case 'reivindicacoes': renderClaims(); break;
      default: renderDash();
    }
    refreshBell();
    window.scrollTo(0, 0);
  }

  window.addEventListener('hashchange', route);
  route();
})();
