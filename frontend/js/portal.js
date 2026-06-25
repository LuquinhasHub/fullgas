/* =========================================================
   FULLGAS B2B — Portal do concessionário (portal.html)
   ========================================================= */
(function () {
  'use strict';

  var sess = FG.guard();
  if (!sess) return;

  var view = document.getElementById('view');
  var crumb = document.getElementById('crumb');
  var esc = FG.esc;

  /* ---------- cabeçalho ---------- */
  document.getElementById('user-who').textContent =
    sess.nome + ' (' + sess.email + ') - ' + sess.empresa + ', ' + (sess.papel === 'admin' ? 'Administrador' : 'Concessionário');

  document.getElementById('btn-sair').addEventListener('click', function (e) { e.preventDefault(); FG.logout(); });
  document.getElementById('btn-notif').addEventListener('click', function () { location.hash = '#notificacoes'; });

  if (sess.papel === 'admin') document.getElementById('tab-admin').classList.remove('hidden');

  function refreshPill() {
    var n = FG.unreadCount();
    var pill = document.getElementById('notif-pill');
    pill.textContent = n;
    pill.style.display = n ? '' : 'none';
  }

  /* dropdowns das abas */
  Array.prototype.forEach.call(document.querySelectorAll('.tabs .drop > button'), function (btn) {
    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      var d = btn.parentElement;
      var aberto = d.classList.contains('open');
      Array.prototype.forEach.call(document.querySelectorAll('.tabs .drop.open'), function (x) { x.classList.remove('open'); });
      if (!aberto) d.classList.add('open');
    });
  });
  document.addEventListener('click', function () {
    Array.prototype.forEach.call(document.querySelectorAll('.tabs .drop.open'), function (x) { x.classList.remove('open'); });
  });

  /* busca do topo */
  document.getElementById('search-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var q = document.getElementById('search-input').value.trim();
    if (q) location.hash = '#busca/' + encodeURIComponent(q);
  });

  /* ---------- util ---------- */
  function setCrumb(partes) {
    var html = '<a href="#home">Página inicial</a>';
    (partes || []).forEach(function (p) { html += ' &rsaquo; <span>' + esc(p) + '</span>'; });
    crumb.innerHTML = html;
  }
  function setTabOn(rota) {
    Array.prototype.forEach.call(document.querySelectorAll('.tabs a[data-rota]'), function (a) {
      a.classList.toggle('on', a.getAttribute('data-rota') === rota);
    });
    document.querySelector('#tab-fin > button').classList.toggle('on', rota === 'financeiro');
  }
  function statusBadge(st) {
    var cls = { 'Em processo': 'proc', 'Aprovada': 'ok', 'Recusada': 'bad', 'Esboço': 'draft' }[st] || 'proc';
    return '<span class="badge ' + cls + '">' + esc(st) + '</span>';
  }
  function modelName(modeloId) {
    var m = FG.model(modeloId);
    return m ? (m.nome + ' ' + m.ano) : modeloId;
  }

  /* =========================================================
     HOME
     ========================================================= */
  function renderHome() {
    setCrumb([]); setTabOn('');
    var crit = FG.unreadCritical();
    var disp = FG.all('vehicles').filter(function (v) { return v.status === 'Disponível'; }).length;
    var claims = FG.all('claims');

    // agrupa reivindicações por criador para a mini tabela
    var grupos = {};
    claims.forEach(function (c) {
      var g = grupos[c.criador] || (grupos[c.criador] = { total: 0, dar: 0, imp: 0, hq: 0, novas: 0 });
      g.total++;
      if (c.tipo === 'Implícito') g.imp++;
      if (c.status === 'Em processo') g.hq++;
      if (c.status === 'Esboço') g.novas++;
    });
    var nomes = Object.keys(grupos).sort();

    var html = '';
    if (crit > 0) {
      html += '<div class="banner-crit" id="banner-crit">' +
        '<span>Você tem ' + crit + ' notificaç' + (crit === 1 ? 'ão crítica' : 'ões críticas') + ' na sua caixa de entrada</span>' +
        '<span class="arrow">&rsaquo;</span></div>';
    }

    html += '<div class="home-cards">';
    html += '<div><div class="card-title">Estoque de veículos (' + disp + ')</div>' +
      '<div class="stock-card"><span class="lbl">Standard</span><span class="fab">🏭</span>' +
      '<span class="num">' + disp + '</span><span class="sub">em estoque</span></div></div>';

    html += '<div><div class="card-title">Reivindicações (' + claims.length + ')</div>' +
      '<table class="claims-mini"><thead><tr><th></th><th>Claims</th><th>DAR</th><th>IMP</th><th>HQ</th><th>New</th></tr></thead><tbody>';
    nomes.forEach(function (n) {
      var g = grupos[n];
      html += '<tr><td>' + esc(n) + '</td><td class="num"><b>' + g.total + '</b></td>' +
        '<td class="num">' + g.dar + '</td><td class="num">' + g.imp + '</td>' +
        '<td class="hq">' + g.hq + '</td><td class="num">' + g.novas + '</td></tr>';
    });
    html += '</tbody></table></div></div>';

    html += '<div class="home-heroes">' +
      '<div class="hero-panel">' + FG.bikeSVG('plastics', 230, { cls: 'lite' }) + '<span class="cap">Linha Enduro 2026</span></div>' +
      '<div class="hero-panel">' + FG.bikeSVG('engine', 230, { cls: 'lite' }) + '<span class="cap">Peças originais Fullgas</span></div>' +
      '</div>';

    view.innerHTML = html;
    var banner = document.getElementById('banner-crit');
    if (banner) banner.addEventListener('click', function () { location.hash = '#notificacoes'; });
  }

  /* =========================================================
     NOTIFICAÇÕES
     ========================================================= */
  function renderNotifs() {
    setCrumb(['Notificações']); setTabOn('notificacoes');
    var list = FG.all('notifications').slice().sort(function (a, b) { return a.data < b.data ? 1 : -1; });
    var html = '<h2>Notificações</h2>';
    if (!list.length) html += '<p class="muted">Nenhuma notificação.</p>';
    list.forEach(function (n) {
      html += '<div class="notif ' + n.tipo + (n.lida ? '' : ' unread') + '">' +
        '<div class="nt-body"><div class="nt-title">' + (n.tipo === 'critica' ? '⚠ ' : '') + esc(n.titulo) + '</div>' +
        '<div>' + esc(n.texto) + '</div>' +
        '<div class="nt-date">' + FG.fmtDateTime(n.data) + '</div></div>' +
        '<button class="link-action" data-id="' + n.id + '" data-lida="' + (!n.lida) + '">' +
        (n.lida ? 'Marcar como não lida' : 'Marcar como lida') + '</button></div>';
    });
    view.innerHTML = html;
    Array.prototype.forEach.call(view.querySelectorAll('[data-id]'), function (b) {
      b.addEventListener('click', function () {
        FG.markNotif(b.getAttribute('data-id'), b.getAttribute('data-lida') === 'true');
        refreshPill(); renderNotifs();
      });
    });
  }

  /* =========================================================
     REIVINDICAÇÕES
     ========================================================= */
  var claimFiltro = 'Em processo';

  function claimsDoFiltro() {
    var all = FG.all('claims');
    if (claimFiltro === 'Arquivo') return all.filter(function (c) { return c.status === 'Aprovada' || c.status === 'Recusada'; });
    return all.filter(function (c) { return c.status === claimFiltro; });
  }

  function renderClaims() {
    setCrumb(['Reivindicações']); setTabOn('reivindicacoes');
    var lista = claimsDoFiltro();

    var html =
      '<div class="toolbar" style="margin-bottom:18px;">' +
      '<button class="tool red" id="cl-rma">Criar reiv. RMA</button>' +
      '<button class="tool red" id="cl-var">Criar reiv. varejo</button>' +
      '<button class="tool red" id="cl-rem">Criar remoção de armazém</button>' +
      '</div>' +
      '<div class="side-layout">' +
      '<aside class="side-nav"><h2>Reivindicações</h2>' +
      btnNav('Em processo') + btnNav('Esboço') + btnNav('Arquivo') +
      '</aside>' +
      '<section>' +
      '<div class="toolbar">' +
      '<button class="tool" id="cl-reset">✖ Redefinir grade</button>' +
      '<button class="tool" id="cl-csv">📄 Export. p/ Excel</button>' +
      '<span class="grow"></span>' +
      '<span class="mini-search"><input id="cl-q" type="text" placeholder="Filtrar..."></span>' +
      '</div>' +
      '<div class="claim-head"><span>Data da reivindicação</span><span>Creator Country</span>' +
      '<span>Criador da reivindicação</span><span>Tipo</span><span>Sent Back</span><span>Status</span><span>Pre-Authorization</span><span></span></div>' +
      '<div id="cl-rows"></div>' +
      '</section></div>';

    view.innerHTML = html;

    function btnNav(nome) {
      return '<button class="' + (claimFiltro === nome ? 'on' : '') + '" data-f="' + nome + '">' + nome + '</button>';
    }

    Array.prototype.forEach.call(view.querySelectorAll('.side-nav [data-f]'), function (b) {
      b.addEventListener('click', function () { claimFiltro = b.getAttribute('data-f'); renderClaims(); });
    });

    function rows(filtroTexto) {
      var box = document.getElementById('cl-rows');
      var q = (filtroTexto || '').toLowerCase();
      var l = lista.filter(function (c) {
        return !q || (c.id + c.criador + c.niv + c.tipo).toLowerCase().indexOf(q) >= 0;
      });
      if (!l.length) { box.innerHTML = '<p class="muted" style="padding:20px 10px;">Nenhuma reivindicação neste filtro.</p>'; return; }
      box.innerHTML = l.map(function (c) {
        return '<div class="row-claim">' +
          '<div><span class="cell-label">Data</span><span class="cell-value">' + FG.fmtDate(c.data) + '</span><br>' +
          '<span class="cell-label">N° da reivindicação</span><span class="cell-value">' + c.id + '</span></div>' +
          '<div><span class="cell-label">Creator Country</span><span class="cell-value">' + esc(c.pais) + '</span></div>' +
          '<div><span class="cell-label">Criado por</span><span class="cell-value">' + esc(c.criador) + '</span><br>' +
          '<span class="cell-label">Descrição</span><span class="cell-value">' + esc(c.descricao) + '</span></div>' +
          '<div><span class="cell-label">Tipo</span><span class="cell-value">' + esc(c.tipo) + '</span></div>' +
          '<div><span class="cell-label">Sent Back</span><span class="cell-value">' + c.sentBack + '</span></div>' +
          '<div>' + statusBadge(c.status) + '<br><span class="cell-label">NIV</span><a href="#acoes/' + c.niv + '">' + c.niv + '</a></div>' +
          '<div><span class="cell-label">Pre-Auth.</span><span class="cell-value">' + esc(c.preAuth) + '</span></div>' +
          '<span class="chev">&rsaquo;</span></div>';
      }).join('');
    }
    rows('');

    document.getElementById('cl-q').addEventListener('input', function (e) { rows(e.target.value); });
    document.getElementById('cl-reset').addEventListener('click', function () { document.getElementById('cl-q').value = ''; rows(''); });
    document.getElementById('cl-csv').addEventListener('click', function () {
      var linhas = [['N°', 'Data', 'Criador', 'País', 'Tipo', 'NIV', 'Status', 'Pré-autorização', 'Descrição']];
      lista.forEach(function (c) { linhas.push([c.id, FG.fmtDate(c.data), c.criador, c.pais, c.tipo, c.niv, c.status, c.preAuth, c.descricao]); });
      FG.exportCSV('reivindicacoes', linhas);
    });
    document.getElementById('cl-rma').addEventListener('click', function () { modalClaim('IT'); });
    document.getElementById('cl-var').addEventListener('click', function () { modalClaim('Implícito'); });
    document.getElementById('cl-rem').addEventListener('click', function () { modalClaim('Manufacturer'); });
  }

  function modalClaim(tipoPadrao) {
    var vehs = FG.all('vehicles');
    var back = document.createElement('div');
    back.className = 'modal-back';
    back.innerHTML =
      '<div class="modal"><header><h3>Nova reivindicação</h3><button class="x">×</button></header>' +
      '<div class="modal-body">' +
      '<div class="field"><label>Tipo</label><select id="nc-tipo">' +
      ['IT', 'Manufacturer', 'Implícito'].map(function (t) {
        return '<option' + (t === tipoPadrao ? ' selected' : '') + '>' + t + '</option>';
      }).join('') + '</select></div>' +
      '<div class="field"><label>NIV do veículo</label><select id="nc-niv">' +
      vehs.map(function (v) { return '<option value="' + v.niv + '">' + v.niv + ' — ' + esc(modelName(v.modeloId)) + '</option>'; }).join('') +
      '</select></div>' +
      '<div class="field"><label>Descrição do problema</label><textarea id="nc-desc" rows="4" placeholder="Descreva o defeito constatado..."></textarea></div>' +
      '</div>' +
      '<div class="modal-foot"><button class="btn" id="nc-rasc">Salvar como esboço</button>' +
      '<button class="btn red" id="nc-env">Enviar reivindicação</button></div></div>';
    document.body.appendChild(back);

    function fechar() { back.remove(); }
    back.querySelector('.x').addEventListener('click', fechar);
    back.addEventListener('click', function (e) { if (e.target === back) fechar(); });

    function criar(status) {
      var desc = document.getElementById('nc-desc').value.trim();
      if (!desc) { FG.toast('Descreva o problema antes de salvar.'); return; }
      FG.createClaim({
        criador: sess.empresa, tipo: document.getElementById('nc-tipo').value,
        niv: document.getElementById('nc-niv').value, descricao: desc, status: status
      });
      fechar();
      claimFiltro = status === 'Esboço' ? 'Esboço' : 'Em processo';
      FG.toast('Reivindicação registrada.');
      renderClaims();
    }
    document.getElementById('nc-env').addEventListener('click', function () { criar('Em processo'); });
    document.getElementById('nc-rasc').addEventListener('click', function () { criar('Esboço'); });
  }

  /* =========================================================
     PEDIDOS
     ========================================================= */
  var pedFiltro = 'Ordens pendentes';

  function renderPedidos() {
    setCrumb(['Pedidos']); setTabOn('pedidos');
    var html =
      '<div class="side-layout">' +
      '<aside class="side-nav"><h2>Gestão de pedidos</h2>' +
      '<div class="group-title">Cestas</div>' + nav('Cesta atual') +
      '<div class="group-title">Pedidos</div>' + nav('Ordens pendentes') + nav('Arquivado') +
      '<div class="group-title">Entregas</div>' + nav('Entregas em processo') + nav('Entregas arquivadas') +
      '</aside>' +
      '<section id="ped-body"></section></div>';
    view.innerHTML = html;

    function nav(n) { return '<button class="' + (pedFiltro === n ? 'on' : '') + '" data-f="' + n + '">' + n + '</button>'; }

    Array.prototype.forEach.call(view.querySelectorAll('.side-nav [data-f]'), function (b) {
      b.addEventListener('click', function () { pedFiltro = b.getAttribute('data-f'); renderPedidos(); });
    });

    var body = document.getElementById('ped-body');

    if (pedFiltro === 'Cesta atual') {
      var n = FG.cartCount();
      body.innerHTML = '<div class="empty-box">' +
        (n ? 'Sua cesta atual tem <b>' + n + '</b> item(ns) aguardando envio.' : 'Sua cesta está vazia.') +
        '<br><a class="btn red" href="loja.html#/carrinho">Abrir cesta na loja</a></div>';
      return;
    }

    if (pedFiltro.indexOf('Entregas') === 0) {
      var arq = pedFiltro === 'Entregas arquivadas';
      var dels = FG.all('deliveries').filter(function (d, i) { return arq ? i >= 2 : i < 2; });
      body.innerHTML =
        '<div class="toolbar"><button class="tool" id="pd-csv">📄 Export. p/ Excel</button></div>' +
        '<table class="table"><thead><tr><th class="filt">N° da entrega</th><th class="filt">Data</th>' +
        '<th>Rastreio(s)</th><th>Pedido(s)</th><th>Fatura</th></tr></thead><tbody>' +
        (dels.length ? dels.map(function (d) {
          return '<tr><td>' + d.numero + '</td><td>' + FG.fmtDate(d.data) + '</td>' +
            '<td>' + d.rastreios.join('<br>') + '</td><td>' + d.pedidos.map(esc).join('<br>') + '</td>' +
            '<td><a href="#financeiro">' + d.fatura + '</a></td></tr>';
        }).join('') : '<tr><td colspan="5" class="muted">Vazio</td></tr>') +
        '</tbody></table>';
      document.getElementById('pd-csv').addEventListener('click', function () {
        var linhas = [['N° entrega', 'Data', 'Rastreios', 'Pedidos', 'Fatura']];
        dels.forEach(function (d) { linhas.push([d.numero, FG.fmtDate(d.data), d.rastreios.join(' '), d.pedidos.join(' | '), d.fatura]); });
        FG.exportCSV('entregas', linhas);
      });
      return;
    }

    var arquivado = pedFiltro === 'Arquivado';
    var meus = FG.all('orders').filter(function (o) {
      var fim = o.status === 'Entregue' || o.status === 'Cancelado';
      var meu = sess.papel === 'admin' || o.usuario === sess.email || o.empresa === sess.empresa;
      return meu && (arquivado ? fim : !fim);
    });

    body.innerHTML =
      '<div class="toolbar">' +
      '<button class="tool" id="pd-exp">↗ Expandir todos</button>' +
      '<button class="tool" id="pd-csv">📄 Exportar</button>' +
      '<span class="grow"></span></div>' +
      '<table class="table"><thead><tr><th class="filt">Título</th><th class="filt">Classe de pedido</th>' +
      '<th class="filt">Criado</th><th>Status</th><th class="right">Total</th></tr></thead><tbody id="pd-rows">' +
      (meus.length ? meus.map(function (o, i) {
        var statusCol = '<span class="pill-status ' + esc(o.status) + '">' + esc(o.status) + '</span>' +
          (o.progresso && o.progresso.parcial ? ' <span class="pill-status Parcial">Parcial</span>' : '') +
          (o.temBackorder ? '<br><span class="muted" style="font-size:11px;">contém pré-venda</span>' : '');
        return '<tr><td><a href="#pedido/' + esc(o.id) + '">' + o.cx + ' / ' + o.id + '</a>' +
          ' <button class="link-action pd-open" data-i="' + i + '" title="Ver itens">⤢</button>' +
          '<div class="pd-itens hidden" data-i="' + i + '">' +
          o.itens.map(function (it) { return '<div class="muted">' + it.qtd + '× ' + esc(it.nome) + ' (' + it.artigo + ')</div>'; }).join('') +
          '</div></td>' +
          '<td>Peças de reposição</td><td>' + FG.fmtDateTime(o.data) + '</td>' +
          '<td>' + statusCol + '</td><td class="right">' + FG.fmtMoney(o.total) + '</td></tr>';
      }).join('') : '<tr><td colspan="5" class="muted">Vazio</td></tr>') +
      '</tbody></table>';

    Array.prototype.forEach.call(body.querySelectorAll('.pd-open'), function (a) {
      a.addEventListener('click', function (e) {
        e.preventDefault();
        body.querySelector('.pd-itens[data-i="' + a.getAttribute('data-i') + '"]').classList.toggle('hidden');
      });
    });
    document.getElementById('pd-exp').addEventListener('click', function () {
      Array.prototype.forEach.call(body.querySelectorAll('.pd-itens'), function (d) { d.classList.remove('hidden'); });
    });
    document.getElementById('pd-csv').addEventListener('click', function () {
      var linhas = [['Pedido', 'CX', 'Data', 'Status', 'Total']];
      meus.forEach(function (o) { linhas.push([o.id, o.cx, FG.fmtDateTime(o.data), o.status, o.total.toFixed(2)]); });
      FG.exportCSV('pedidos', linhas);
    });
  }

  /* =========================================================
     DETALHE DO PEDIDO (#pedido/:numero)
     ========================================================= */
  // Indicador circular por item: verde=enviado, amarelo=parcial, cinza=pendente.
  function dotItem(it) {
    var cls = it.qtdEnviada >= it.qtd ? 'dot-ok' : (it.qtdEnviada > 0 ? 'dot-parcial' : 'dot-pendente');
    var t = it.qtdEnviada >= it.qtd ? 'Enviado' : (it.qtdEnviada > 0 ? 'Parcial' : 'Não enviado');
    return '<span class="item-dot ' + cls + '" title="' + t + '"></span>';
  }

  function tabelaItens(itens) {
    return '<table class="table"><thead><tr><th></th><th>SKU</th><th>Produto</th>' +
      '<th class="right">Qtd. pedida</th><th class="right">Qtd. enviada</th>' +
      '<th class="right">Preço un.</th><th class="right">Subtotal</th></tr></thead><tbody>' +
      itens.map(function (it) {
        return '<tr><td>' + dotItem(it) + '</td><td>' + esc(it.artigo) + '</td><td>' + esc(it.nome) + '</td>' +
          '<td class="right">' + it.qtd + '</td><td class="right">' + it.qtdEnviada + '</td>' +
          '<td class="right">' + FG.fmtMoney(it.preco) + '</td>' +
          '<td class="right">' + FG.fmtMoney(it.preco * it.qtd) + '</td></tr>';
      }).join('') + '</tbody></table>';
  }

  function renderPedidoDetalhe(numero) {
    setCrumb(['Pedidos', numero]); setTabOn('pedidos');
    var d = FG.pedidoDetalhe(numero);
    if (!d || !d.id) {
      view.innerHTML = '<div class="empty-box">Pedido não encontrado.<br>' +
        '<a class="btn red" href="#pedidos">Voltar para Pedidos</a></div>';
      return;
    }
    var normais = d.itens.filter(function (i) { return !i.backorder; });
    var preVenda = d.itens.filter(function (i) { return i.backorder; });
    var pg = d.progresso;

    var html =
      '<div style="margin-bottom:12px;"><a class="btn" href="#pedidos">← Voltar para Pedidos</a></div>' +
      '<div class="ped-det-head"><h2 style="margin:0;">Pedido ' + esc(d.cx) + ' / ' + esc(d.id) + '</h2>' +
      '<span class="pill-status ' + esc(d.status) + '">' + esc(d.status) + '</span>' +
      (pg.parcial ? ' <span class="pill-status Parcial">Parcial</span>' : '') + '</div>' +
      '<p class="muted">' + FG.fmtDateTime(d.data) + ' · ' + esc(d.empresa) + ' · Total ' + FG.fmtMoney(d.total) + '</p>' +
      '<div class="prog-wrap"><div class="prog-bar"><div class="prog-fill" style="width:' + pg.pct + '%;"></div></div>' +
      '<span class="prog-label">' + pg.pct + '% (' + pg.enviada + ' de ' + pg.qtd + ' enviadas)</span></div>';

    if (normais.length)
      html += '<h3 class="sec-title">Itens em envio normal</h3>' + tabelaItens(normais);

    if (preVenda.length)
      html += '<h3 class="sec-title">Itens em pré-venda</h3>' +
        '<div class="backorder-aviso">Estes itens serão enviados quando o estoque for reposto. ' +
        'Eles farão parte de uma entrega/fatura separada.</div>' + tabelaItens(preVenda);

    if (d.entregas.length)
      html += '<h3 class="sec-title">Entregas e faturas</h3>' +
        '<table class="table"><thead><tr><th>Entrega</th><th>Data</th><th>Status</th>' +
        '<th>Rastreio(s)</th><th>Fatura</th><th class="right">Valor</th></tr></thead><tbody>' +
        d.entregas.map(function (e) {
          return '<tr><td>' + esc(e.numero) + '</td><td>' + (e.data ? FG.fmtDate(e.data) : '—') + '</td>' +
            '<td><span class="pill-status ' + esc(e.status) + '">' + esc(e.status) + '</span></td>' +
            '<td>' + (e.rastreios.join('<br>') || '—') + '</td>' +
            '<td>' + (e.fatura || '—') +
              (e.faturaStatus ? ' <span class="pill-status ' + esc(e.faturaStatus) + '">' + esc(e.faturaStatus) + '</span>' : '') + '</td>' +
            '<td class="right">' + (e.faturaValor != null ? FG.fmtMoney(e.faturaValor) : '—') + '</td></tr>';
        }).join('') + '</tbody></table>';

    view.innerHTML = html;
  }

  /* =========================================================
     AÇÕES DO VEÍCULO
     ========================================================= */
  // Modal estilizado para registrar a venda com os dados do comprador final.
  // onDone() é chamado após sucesso (re-renderiza a busca do veículo).
  function modalVenda(v, onDone) {
    var back = document.createElement('div');
    back.className = 'modal-back';
    back.innerHTML =
      '<div class="modal"><header><h3>Registrar venda — ' + esc(v.niv) + '</h3><button class="x">×</button></header>' +
      '<div class="modal-body">' +
      '<p class="muted" style="margin-top:0;">Dados do comprador final. A garantia é ativada automaticamente na venda. Campos marcados com * são obrigatórios.</p>' +
      '<div class="form-grid">' +
      '<div class="field full"><label>Nome do cliente *</label><input id="vd-nome" type="text" placeholder="Nome completo" autocomplete="off"></div>' +
      '<div class="field"><label>CPF</label><input id="vd-cpf" type="text" inputmode="numeric" placeholder="000.000.000-00" maxlength="14"></div>' +
      '<div class="field"><label>Telefone</label><input id="vd-tel" type="tel" placeholder="(00) 00000-0000"></div>' +
      '<div class="field full"><label>E-mail pessoal</label><input id="vd-email" type="email" placeholder="cliente@email.com"></div>' +
      '<div class="field full"><label>Endereço</label><input id="vd-end" type="text" placeholder="Rua, número, bairro, cidade/UF, CEP"></div>' +
      '</div></div>' +
      '<div class="modal-foot"><button class="btn-line" id="vd-canc">Cancelar</button>' +
      '<button class="btn red" id="vd-ok">Confirmar venda</button></div></div>';
    document.body.appendChild(back);

    function fechar() { back.remove(); }
    back.querySelector('.x').addEventListener('click', fechar);
    back.querySelector('#vd-canc').addEventListener('click', fechar);
    back.addEventListener('click', function (e) { if (e.target === back) fechar(); });
    document.getElementById('vd-nome').focus();

    // Máscara leve de CPF enquanto digita (000.000.000-00).
    var cpf = document.getElementById('vd-cpf');
    cpf.addEventListener('input', function () {
      var d = cpf.value.replace(/\D/g, '').slice(0, 11), out = d;
      if (d.length > 9) out = d.slice(0, 3) + '.' + d.slice(3, 6) + '.' + d.slice(6, 9) + '-' + d.slice(9);
      else if (d.length > 6) out = d.slice(0, 3) + '.' + d.slice(3, 6) + '.' + d.slice(6);
      else if (d.length > 3) out = d.slice(0, 3) + '.' + d.slice(3);
      cpf.value = out;
    });

    document.getElementById('vd-ok').addEventListener('click', function () {
      var nome = document.getElementById('vd-nome').value.trim();
      if (!nome) { FG.toast('Informe o nome do cliente.'); return; }
      var r = FG.registrarVenda(v.niv, {
        cliente: nome,
        cpf: document.getElementById('vd-cpf').value.trim(),
        telefone: document.getElementById('vd-tel').value.trim(),
        email: document.getElementById('vd-email').value.trim(),
        endereco: document.getElementById('vd-end').value.trim()
      });
      if (!r.ok) { FG.toast(r.msg || 'Não foi possível registrar a venda.'); return; }
      fechar();
      FG.toast('Venda registrada e garantia ativada.');
      if (onDone) onDone();
    });
  }

  function renderAcoes(nivBusca) {
    setCrumb(['Ações do veículo']); setTabOn('acoes');
    view.innerHTML =
      '<h2>Ações do veículo</h2>' +
      '<div class="field" style="max-width:480px;"><label>NIV (chassi)</label>' +
      '<div class="searchbox" style="display:flex;"><input id="av-niv" type="text" placeholder="Ex.: VBFGA125XSM160872" value="' + esc(nivBusca || '') + '">' +
      '<button class="btn red" id="av-go" type="button" style="border-radius:0;">Buscar</button></div></div>' +
      '<div id="av-result"></div>';

    function buscar() {
      var q = document.getElementById('av-niv').value.trim().toUpperCase();
      var box = document.getElementById('av-result');
      if (!q) { box.innerHTML = ''; return; }
      var v = FG.all('vehicles').find(function (x) { return x.niv.toUpperCase() === q; });
      FG.logSearch(q, v ? 1 : 0);
      if (!v) { box.innerHTML = '<p class="muted">Nenhum veículo encontrado com este NIV.</p>'; return; }
      var m = FG.model(v.modeloId);
      box.innerHTML =
        '<div class="veh-card"><h3 style="color:var(--red);">' + esc(m ? m.label : v.modeloId) + '</h3>' +
        '<div class="veh-grid">' +
        '<div><b>NIV</b>' + v.niv + '</div>' +
        '<div><b>Modelo</b>' + esc(modelName(v.modeloId)) + '</div>' +
        '<div><b>Cor</b>' + esc(v.cor) + '</div>' +
        '<div><b>Status</b>' + esc(v.status) + '</div>' +
        '<div><b>Entrada no estoque</b>' + FG.fmtDate(v.entrada) + '</div>' +
        (v.venda ? '<div><b>Venda</b>' + FG.fmtDate(v.venda.data) + ' — ' + esc(v.venda.cliente) + '</div>' +
          (v.venda.cpf ? '<div><b>CPF</b>' + esc(v.venda.cpf) + '</div>' : '') +
          (v.venda.telefone ? '<div><b>Telefone</b>' + esc(v.venda.telefone) + '</div>' : '') +
          (v.venda.email ? '<div><b>E-mail</b>' + esc(v.venda.email) + '</div>' : '') +
          (v.venda.endereco ? '<div><b>Endereço</b>' + esc(v.venda.endereco) + '</div>' : '') : '') +
        (v.garantia ? '<div><b>Garantia ativada em</b>' + FG.fmtDate(v.garantia) + '</div>' : '') +
        '</div>' +
        '<div style="display:flex;gap:10px;flex-wrap:wrap;">' +
        (v.status === 'Disponível' ? '<button class="btn red" id="av-venda">Registrar venda</button>' : '') +
        (!v.garantia ? '<button class="btn" id="av-gar">Ativar garantia</button>' : '') +
        '<a class="btn" href="#reivindicacoes">Criar reivindicação</a>' +
        '<a class="btn" href="finder.html">Abrir no Parts Finder</a>' +
        '</div></div>';

      var bv = document.getElementById('av-venda');
      if (bv) bv.addEventListener('click', function () { modalVenda(v, buscar); });
      var bg = document.getElementById('av-gar');
      if (bg) bg.addEventListener('click', function () {
        var r = FG.ativarGarantia(v.niv);
        if (!r.ok) { FG.toast(r.msg || 'Não foi possível ativar a garantia.'); return; }
        FG.toast('Garantia ativada.');
        buscar();
      });
    }

    document.getElementById('av-go').addEventListener('click', buscar);
    document.getElementById('av-niv').addEventListener('keydown', function (e) { if (e.key === 'Enter') buscar(); });
    if (nivBusca) buscar();
  }

  /* =========================================================
     ESTOQUE DO REVENDEDOR
     ========================================================= */
  function renderEstoque() {
    setCrumb(['Estoque do revendedor']); setTabOn('estoque');
    var vehs = FG.all('vehicles');
    view.innerHTML =
      '<h2>Estoque do revendedor</h2>' +
      '<div class="toolbar"><button class="tool" id="es-csv">📄 Export. p/ Excel</button></div>' +
      '<table class="table"><thead><tr><th class="filt">NIV</th><th class="filt">Modelo</th><th>Cor</th>' +
      '<th class="filt">Status</th><th>Entrada</th><th></th></tr></thead><tbody>' +
      vehs.map(function (v) {
        return '<tr><td>' + v.niv + '</td><td>' + esc(modelName(v.modeloId)) + '</td><td>' + esc(v.cor) + '</td>' +
          '<td>' + (v.status === 'Disponível' ? '<span class="stock-ok">Disponível</span>' : esc(v.status)) + '</td>' +
          '<td>' + FG.fmtDate(v.entrada) + '</td>' +
          '<td><a href="#acoes/' + v.niv + '">Ações &rsaquo;</a></td></tr>';
      }).join('') +
      '</tbody></table>';
    document.getElementById('es-csv').addEventListener('click', function () {
      var linhas = [['NIV', 'Modelo', 'Cor', 'Status', 'Entrada']];
      vehs.forEach(function (v) { linhas.push([v.niv, modelName(v.modeloId), v.cor, v.status, FG.fmtDate(v.entrada)]); });
      FG.exportCSV('estoque', linhas);
    });
  }

  /* =========================================================
     CONTA FINANCEIRA
     ========================================================= */
  function renderFinanceiro() {
    setCrumb(['Conta financeira', 'Faturas']); setTabOn('financeiro');
    var inv = FG.all('invoices'); // faturas reais (cobrança)
    var faturado = 0, credito = 0;
    inv.forEach(function (i) { if (i.valor >= 0) faturado += i.valor; else credito += i.valor; });

    // Pré-venda: peças já compradas (incluídas na fatura do pedido, sem cobrança
    // à parte) que aguardam envio. Derivado dos pedidos; status pelo estoque atual.
    var preParts = [];
    FG.all('orders').forEach(function (o) {
      (o.itens || []).forEach(function (it) {
        if (!it.backorder) return;
        var p = FG.product(it.artigo);
        var st = it.qtdEnviada >= it.qtd ? 'Enviado' : ((p && p.estoque > 0) ? 'Disponivel' : 'Aguardando');
        preParts.push({ it: it, o: o, st: st, prev: p && p.previsao });
      });
    });

    var preVendaHTML = '';
    if (preParts.length) {
      preVendaHTML =
        '<h3 class="sec-title">Pré-venda — peças a enviar</h3>' +
        '<div class="backorder-aviso">Estas peças já estão incluídas na fatura do pedido (sem cobrança ' +
        'à parte). São enviadas assim que voltam ao estoque — acompanhe o status abaixo.</div>' +
        '<table class="table"><thead><tr><th>Artigo</th><th>Peça</th><th class="right">Qtd.</th>' +
        '<th>Data do pedido</th><th>Pedido</th><th>Status do envio</th></tr></thead><tbody>' +
        preParts.map(function (x) {
          var pill = x.st === 'Enviado' ? '<span class="pill-status Enviado">Enviado</span>'
            : x.st === 'Disponivel' ? '<span class="pill-status Disponivel">Disponível — envio em breve</span>'
            : '<span class="pill-status Aguardando">Aguardando reposição' + (x.prev ? ' · ' + esc(x.prev) : '') + '</span>';
          return '<tr><td>' + esc(x.it.artigo) + '</td><td>' + esc(x.it.nome) + '</td>' +
            '<td class="right">' + x.it.qtd + '</td>' +
            '<td>' + (x.o.data ? FG.fmtDate(x.o.data) : '—') + '</td>' +
            '<td><a href="#pedido/' + esc(x.o.id) + '">' + esc(x.o.cx) + '</a></td>' +
            '<td>' + pill + '</td></tr>';
        }).join('') + '</tbody></table>';
    }

    view.innerHTML =
      '<h2>Conta financeira</h2>' +
      '<div class="fin-cards">' +
      '<div class="fin-card"><div class="muted">Total faturado</div><div class="v">' + FG.fmtMoney(faturado) + '</div></div>' +
      '<div class="fin-card"><div class="muted">Notas de crédito</div><div class="v">' + FG.fmtMoney(credito) + '</div></div>' +
      '<div class="fin-card"><div class="muted">Documentos</div><div class="v">' + inv.length + '</div></div>' +
      '</div>' +
      '<div class="toolbar"><button class="tool" id="fi-csv">📄 Export. p/ Excel</button></div>' +
      '<table class="table"><thead><tr><th class="filt">Tipo</th><th class="filt">N° da fatura</th>' +
      '<th class="filt">Data da fatura ↓</th><th class="right filt">Quantia cobrada</th><th>Moeda</th><th></th></tr></thead><tbody>' +
      inv.map(function (i, idx) {
        return '<tr><td>' + esc(i.tipo) +
          (i.status && i.status !== 'Emitida' ? ' <span class="pill-status ' + esc(i.status) + '">' + esc(i.status) + '</span>' : '') +
          '</td><td>' + i.numero + '</td><td>' + FG.fmtDate(i.data) + '</td>' +
          '<td class="right">' + i.valor.toLocaleString('pt-BR', { minimumFractionDigits: 2 }) + '</td>' +
          '<td>' + esc(i.moeda) + '</td><td><button class="pdf-ico" data-i="' + idx + '">PDF</button></td></tr>';
      }).join('') +
      '</tbody></table>' + preVendaHTML;

    document.getElementById('fi-csv').addEventListener('click', function () {
      var linhas = [['Tipo', 'N°', 'Data', 'Valor', 'Moeda']];
      inv.forEach(function (i) { linhas.push([i.tipo, i.numero, FG.fmtDate(i.data), i.valor.toFixed(2), i.moeda]); });
      FG.exportCSV('faturas', linhas);
    });
    Array.prototype.forEach.call(view.querySelectorAll('.pdf-ico'), function (b) {
      b.addEventListener('click', function () { imprimirFatura(inv[Number(b.getAttribute('data-i'))]); });
    });
  }

  function imprimirFatura(i) {
    var area = document.getElementById('print-area');
    area.classList.remove('hidden');
    area.innerHTML =
      '<div style="font-family:Arial,sans-serif;max-width:680px;">' +
      '<h1 style="color:#d20a11;font-style:italic;">FULLGAS</h1>' +
      '<h2>' + esc(i.tipo) + ' n° ' + i.numero + '</h2>' +
      '<p><b>Data:</b> ' + FG.fmtDate(i.data) + '<br><b>Cliente:</b> ' + esc(sess.empresa) + '<br>' +
      '<b>Moeda:</b> ' + esc(i.moeda) + '</p>' +
      '<table style="width:100%;border-collapse:collapse;margin-top:14px;">' +
      '<tr><th style="text-align:left;border-bottom:2px solid #d20a11;padding:8px 4px;">Descrição</th>' +
      '<th style="text-align:right;border-bottom:2px solid #d20a11;padding:8px 4px;">Valor</th></tr>' +
      '<tr><td style="padding:8px 4px;">Movimentação de peças e acessórios</td>' +
      '<td style="text-align:right;padding:8px 4px;">' + FG.fmtMoney(i.valor) + '</td></tr>' +
      '<tr><td style="padding:14px 4px;font-weight:700;">Total</td>' +
      '<td style="text-align:right;padding:14px 4px;font-weight:700;">' + FG.fmtMoney(i.valor) + '</td></tr>' +
      '</table><p style="font-size:11px;color:#777;margin-top:30px;">Documento demonstrativo gerado pelo portal Fullgas B2B.</p></div>';
    window.print();
    setTimeout(function () { area.classList.add('hidden'); }, 300);
  }

  /* =========================================================
     BUSCA GLOBAL
     ========================================================= */
  function renderBusca(q) {
    setCrumb(['Pesquisa']); setTabOn('');
    var termo = decodeURIComponent(q || '').trim();
    var t = termo.toLowerCase();

    var vehs = FG.all('vehicles').filter(function (v) { return v.niv.toLowerCase().indexOf(t) >= 0; });
    var prods = FG.all('products').filter(function (p) {
      return p.artigo.toLowerCase().indexOf(t) >= 0 || p.nome.toLowerCase().indexOf(t) >= 0;
    });
    var mods = FG.all('models').filter(function (m) { return m.label.toLowerCase().indexOf(t) >= 0; });
    FG.logSearch(termo, vehs.length + prods.length + mods.length);

    var html = '<h2>Resultados para “' + esc(termo) + '”</h2>';
    if (!vehs.length && !prods.length && !mods.length) html += '<p class="muted">Nada encontrado.</p>';

    if (vehs.length) {
      html += '<h3>Veículos</h3><table class="table"><tbody>' + vehs.map(function (v) {
        return '<tr><td><a href="#acoes/' + v.niv + '">' + v.niv + '</a></td><td>' + esc(modelName(v.modeloId)) + '</td><td>' + esc(v.status) + '</td></tr>';
      }).join('') + '</tbody></table>';
    }
    if (mods.length) {
      html += '<h3 style="margin-top:18px;">Modelos</h3><table class="table"><tbody>' + mods.map(function (m) {
        return '<tr><td>' + esc(m.label) + '</td><td><a href="finder.html#/modelo/' + m.id + '/chassi">Abrir no Parts Finder</a></td></tr>';
      }).join('') + '</tbody></table>';
    }
    if (prods.length) {
      html += '<h3 style="margin-top:18px;">Artigos</h3><table class="table"><tbody>' + prods.slice(0, 25).map(function (p) {
        return '<tr><td><a href="loja.html#/produto/' + p.artigo + '">' + p.artigo + '</a></td><td>' + esc(p.nome) + '</td>' +
          '<td class="right">' + FG.fmtMoney(p.preco) + '</td></tr>';
      }).join('') + '</tbody></table>';
    }
    view.innerHTML = html;
  }

  /* =========================================================
     ROUTER
     ========================================================= */
  function route() {
    var h = (location.hash || '#home').slice(1);
    var partes = h.split('/');
    var rota = partes[0] || 'home';
    switch (rota) {
      case 'home': renderHome(); break;
      case 'notificacoes': renderNotifs(); break;
      case 'reivindicacoes': renderClaims(); break;
      case 'pedidos': renderPedidos(); break;
      case 'pedido': renderPedidoDetalhe(partes[1]); break;
      case 'acoes': renderAcoes(partes[1]); break;
      case 'estoque': renderEstoque(); break;
      case 'financeiro': renderFinanceiro(); break;
      case 'busca': renderBusca(partes.slice(1).join('/')); break;
      default: renderHome();
    }
    refreshPill();
    window.scrollTo(0, 0);
  }

  window.addEventListener('hashchange', route);
  route();
})();
