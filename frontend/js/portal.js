/* =========================================================
   FULLGAS B2B — Portal do concessionário (portal.html)
   ========================================================= */
(function () {
  'use strict';

  var sess = FG.guard();
  if (!sess) return;

  // Espera o cache (carregado de forma assíncrona via fetch) antes de montar a
  // tela — nada de renderizar com dados vazios.
  FG.pronto.then(function () {

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

  // Rascunhos ("Esboço") vivem no navegador do cliente (localStorage), NÃO no
  // banco. Só viram reivindicação de verdade ao "Enviar".
  var RASC_KEY = 'fullgas_reiv_rascunhos_v1';
  function lerRascunhos() {
    try { return JSON.parse(localStorage.getItem(RASC_KEY) || '[]'); } catch (e) { return []; }
  }
  function salvarRascunhos(l) { localStorage.setItem(RASC_KEY, JSON.stringify(l)); }
  function gravarRascunho(d) {
    var l = lerRascunhos();
    if (d.localId) {
      var i = l.findIndex(function (x) { return x.localId === d.localId; });
      if (i >= 0) l[i] = d; else l.push(d);
    } else {
      d.localId = 'r' + Date.now() + Math.random().toString(36).slice(2, 7);
      l.push(d);
    }
    salvarRascunhos(l);
    return d;
  }
  function excluirRascunho(localId) {
    salvarRascunhos(lerRascunhos().filter(function (x) { return x.localId !== localId; }));
  }

  function claimsDoFiltro() {
    var all = FG.all('claims');
    if (claimFiltro === 'Arquivo') return all.filter(function (c) { return c.status === 'Aprovada' || c.status === 'Recusada'; });
    return all.filter(function (c) { return c.status === claimFiltro; });
  }

  function renderClaims() {
    setCrumb(['Reivindicações']); setTabOn('reivindicacoes');
    var lista = claimFiltro === 'Esboço' ? [] : claimsDoFiltro();
    function distintos(key) { var s = {}; lista.forEach(function (c) { if (c[key]) s[c[key]] = 1; }); return Object.keys(s).sort(); }
    function selFiltro(col, labels, values) {
      return '<select class="cl-filter" data-col="' + col + '"><option value="">Todos</option>' +
        labels.map(function (lab, i) { var v = values ? values[i] : lab; return '<option value="' + esc(v) + '">' + esc(lab) + '</option>'; }).join('') + '</select>';
    }
    var fPaises = distintos('pais'), fTipos = distintos('tipo'), fStatus = distintos('status');

    var html =
      '<button class="btn-nova-reiv" id="cl-nova"><span class="plus">＋</span><b>Nova reivindicação</b></button>' +
      '<div class="side-layout">' +
      '<aside class="side-nav"><h2>Reivindicações</h2>' +
      btnNav('Em processo') + btnNav('Esboço') + btnNav('Arquivo') +
      '</aside>' +
      '<section>' +
      '<div class="toolbar">' +
      '<button class="tool" id="cl-csv">📄 Exportar p/ Excel</button>' +
      '<label class="cl-selall"><input type="checkbox" id="cl-all"> Selecionar todas</label>' +
      '<span class="grow"></span>' +
      '<button class="tool" id="cl-limpar">✖ Limpar filtros</button>' +
      '</div>' +
      '<div class="claim-head"><span>N° da reivindicação</span><span>Data da reivindicação</span>' +
      '<span>Creator Country</span><span>Criador da reivindicação</span><span>Tipo</span><span>Status</span><span></span></div>' +
      '<div class="claim-filters">' +
      '<input class="cl-filter" data-col="numero" placeholder="Filtrar...">' +
      '<input class="cl-filter" data-col="data" placeholder="Filtrar...">' +
      selFiltro('pais', fPaises) +
      '<input class="cl-filter" data-col="criador" placeholder="Filtrar...">' +
      selFiltro('tipo', fTipos) +
      selFiltro('status', fStatus) +
      '<span></span>' +
      '</div>' +
      '<div id="cl-rows"></div>' +
      '</section></div>';

    view.innerHTML = html;

    function btnNav(nome) {
      return '<button class="' + (claimFiltro === nome ? 'on' : '') + '" data-f="' + nome + '">' + nome + '</button>';
    }

    Array.prototype.forEach.call(view.querySelectorAll('.side-nav [data-f]'), function (b) {
      b.addEventListener('click', function () { claimFiltro = b.getAttribute('data-f'); renderClaims(); });
    });

    // Aba "Esboço": lista os rascunhos do navegador (não vão ao banco).
    function renderRascunhos(box, q) {
      var l = lerRascunhos().filter(function (d) {
        return !q || ((d.niv || '') + (d.descricao || '') + (d.tipo || '')).toLowerCase().indexOf(q) >= 0;
      });
      if (!l.length) { box.innerHTML = '<p class="muted" style="padding:20px 10px;">Nenhum rascunho salvo. Use "Salvar como esboço" ao criar uma reivindicação.</p>'; return; }
      box.innerHTML = l.map(function (d) {
        var pecasTxt = (d.pecas || []).map(function (p) { return esc(p.sku) + ' ×' + p.quantidade; }).join(', ');
        return '<div class="row-claim rascunho">' +
          '<div><span class="cell-label">Rascunho</span><span class="cell-value">' + esc(d.tipo || '—') + '</span><br>' +
          '<span class="cell-label">Descrição</span><span class="cell-value">' + esc(d.descricao || '(sem descrição)') + '</span>' +
          (pecasTxt ? '<br><span class="cell-label">Peças</span><span class="cell-value">' + pecasTxt + '</span>' : '') + '</div>' +
          '<div><span class="cell-label">NIV</span><span class="cell-value">' + esc(d.niv || '—') + '</span></div>' +
          '<div><span class="cell-label">Data ocorrido</span><span class="cell-value">' + (d.dataDefeito ? FG.fmtDate(d.dataDefeito) : '—') + '</span></div>' +
          '<div class="rasc-acoes"><button class="btn red rasc-edit" data-id="' + esc(d.localId) + '">Editar</button> ' +
          '<button class="btn rasc-del" data-id="' + esc(d.localId) + '">Excluir</button></div></div>';
      }).join('');
      Array.prototype.forEach.call(box.querySelectorAll('.rasc-edit'), function (b) {
        b.addEventListener('click', function () {
          var d = lerRascunhos().find(function (x) { return x.localId === b.getAttribute('data-id'); });
          if (d) modalClaim(d.tipo || 'IT', { modo: 'rascunho', rasc: d });
        });
      });
      Array.prototype.forEach.call(box.querySelectorAll('.rasc-del'), function (b) {
        b.addEventListener('click', function () { excluirRascunho(b.getAttribute('data-id')); renderClaims(); });
      });
    }

    // Filtro por coluna (lê os controles do cabeçalho).
    function passaFiltros(c) {
      function g(col) { var el = view.querySelector('.cl-filter[data-col="' + col + '"]'); return el ? el.value.trim().toLowerCase() : ''; }
      var fNum = g('numero'), fData = g('data'), fPais = g('pais'), fCriador = g('criador'),
        fTipo = g('tipo'), fSt = g('status');
      if (fNum && String(c.id || '').toLowerCase().indexOf(fNum) < 0) return false;
      if (fData && FG.fmtDate(c.data).toLowerCase().indexOf(fData) < 0) return false;
      if (fPais && (c.pais || '').toLowerCase() !== fPais) return false;
      if (fCriador && (c.criador || '').toLowerCase().indexOf(fCriador) < 0) return false;
      if (fTipo && (c.tipo || '').toLowerCase() !== fTipo) return false;
      if (fSt && (c.status || '').toLowerCase() !== fSt) return false;
      return true;
    }

    function rows() {
      var box = document.getElementById('cl-rows');
      if (claimFiltro === 'Esboço') { renderRascunhos(box, ''); return; }
      var l = lista.filter(passaFiltros);
      if (!l.length) { box.innerHTML = '<p class="muted" style="padding:20px 10px;">Nenhuma reivindicação neste filtro.</p>'; return; }
      box.innerHTML = l.map(function (c) {
        var devolvida = c.sentBack
          ? '<div class="devolvida-aviso">↩ Devolvida — falta: ' + esc(c.faltaInformacao || 'informações') + '</div>'
          : '';
        return '<div class="row-claim" data-cid="' + esc(c.id) + '">' +
          '<div><label class="cl-check"><input type="checkbox" class="cl-sel" data-cid="' + esc(c.id) + '"></label> ' +
          '<span class="cell-label">N° da reivindicação</span><span class="cell-value cl-num">' + c.id + '</span></div>' +
          '<div><span class="cell-label">Data</span><span class="cell-value">' + FG.fmtDate(c.data) + '</span></div>' +
          '<div><span class="cell-label">Creator Country</span><span class="cell-value">' + esc(c.pais) + '</span></div>' +
          '<div><span class="cell-label">Criado por</span><span class="cell-value">' + esc(c.criador) + '</span>' +
          (c.pecas && c.pecas.length ? '<br><span class="cell-label">Peças</span><span class="cell-value">' + c.pecas.map(function (p) { return esc(p.sku) + ' ×' + p.quantidade; }).join(', ') + '</span>' : '') +
          (c.anexos && c.anexos.length ? ' <span class="muted">📎 ' + c.anexos.length + '</span>' : '') +
          devolvida +
          (c.sentBack ? '<div style="margin-top:6px;"><button class="btn red cl-editar" data-id="' + esc(c.id) + '">Editar e reenviar</button></div>' : '') +
          '</div>' +
          '<div><span class="cell-label">Tipo</span><span class="cell-value">' + esc(c.tipo) + '</span></div>' +
          '<div>' + statusBadge(c.status) + '<br><span class="cell-label">NIV</span><a href="#acoes/' + c.niv + '">' + c.niv + '</a></div>' +
          '<span class="chev">&rsaquo;</span></div>';
      }).join('');
      Array.prototype.forEach.call(box.querySelectorAll('.cl-editar'), function (b) {
        b.addEventListener('click', function () {
          var c = FG.all('claims').find(function (x) { return x.id === b.getAttribute('data-id'); });
          if (c) modalClaim(c.tipo, { modo: 'editar', claim: c });
        });
      });
      // Clique na linha (ou na seta) abre o detalhe — ignora botões/links/checkbox.
      Array.prototype.forEach.call(box.querySelectorAll('.row-claim[data-cid]'), function (row) {
        row.addEventListener('click', function (e) {
          if (e.target.closest('button') || e.target.closest('a') || e.target.closest('label') || e.target.closest('input')) return;
          var c = FG.all('claims').find(function (x) { return x.id === row.getAttribute('data-cid'); });
          if (c) modalClaimDetalhe(c);
        });
      });
    }
    rows();

    // Filtros por coluna: re-renderizam ao digitar/selecionar.
    Array.prototype.forEach.call(view.querySelectorAll('.cl-filter'), function (el) {
      el.addEventListener('input', rows);
      el.addEventListener('change', rows);
    });
    document.getElementById('cl-limpar').addEventListener('click', function () {
      Array.prototype.forEach.call(view.querySelectorAll('.cl-filter'), function (el) { el.value = ''; });
      rows();
    });
    // Exporta as selecionadas (checkbox); sem seleção, exporta as visíveis (filtradas).
    document.getElementById('cl-csv').addEventListener('click', function () {
      var selIds = Array.prototype.map.call(view.querySelectorAll('.cl-sel:checked'), function (x) { return x.getAttribute('data-cid'); });
      var alvo = selIds.length ? lista.filter(function (c) { return selIds.indexOf(c.id) >= 0; }) : lista.filter(passaFiltros);
      if (!alvo.length) { FG.toast('Nada para exportar.'); return; }
      var linhas = [['N°', 'Data', 'Criador', 'País', 'Tipo', 'NIV', 'Status', 'Descrição']];
      alvo.forEach(function (c) { linhas.push([c.id, FG.fmtDate(c.data), c.criador, c.pais, c.tipo, c.niv, c.status, c.descricao]); });
      FG.exportCSV('reivindicacoes', linhas);
    });
    var chkAll = document.getElementById('cl-all');
    if (chkAll) chkAll.addEventListener('change', function () {
      Array.prototype.forEach.call(view.querySelectorAll('.cl-sel'), function (x) { x.checked = chkAll.checked; });
    });
    document.getElementById('cl-nova').addEventListener('click', function () { modalClaim('Manufacturer'); });
  }

  function modalClaim(tipoPadrao, ctx) {
    var vehs = FG.all('vehicles');
    var pre = ctx && (ctx.rasc || ctx.claim);
    var modo = (ctx && ctx.modo) || 'novo';
    var titulo = ctx && ctx.claim ? 'Editar reivindicação ' + ctx.claim.id
      : (ctx && ctx.rasc ? 'Editar rascunho' : 'Nova reivindicação');
    var back = document.createElement('div');
    back.className = 'modal-back';
    back.innerHTML =
      '<div class="modal"><header><h3>' + esc(titulo) + '</h3><button class="x">×</button></header>' +
      '<div class="modal-body">' +
      '<div class="field"><label>Tipo</label><select id="nc-tipo">' +
      ['Manufacturer', 'Implícito'].map(function (t) {
        return '<option' + (t === tipoPadrao ? ' selected' : '') + '>' + t + '</option>';
      }).join('') + '</select></div>' +
      '<div class="field"><label>NIV do veículo *</label><select id="nc-niv">' +
      vehs.map(function (v) { return '<option value="' + v.niv + '">' + v.niv + ' — ' + esc(modelName(v.modeloId)) + '</option>'; }).join('') +
      '</select></div>' +
      '<div class="field"><label>Peça(s) defeituosa(s) *</label>' +
      '<div class="peca-add">' +
      // Autocomplete PRÓPRIO (dropdown estilizado) — o datalist nativo herdava
      // o visual do sistema operacional e destoava do resto do portal.
      '<div class="ac-wrap"><input id="nc-peca" autocomplete="off" placeholder="Digite o código ou o nome da peça">' +
      '<div class="ac-list hidden" id="nc-peca-ac"></div></div>' +
      '<input id="nc-peca-qtd" type="number" min="1" step="1" value="1" title="Quantidade">' +
      '<button type="button" class="btn" id="nc-peca-add">Adicionar</button>' +
      '</div>' +
      '<div id="nc-peca-info" class="muted" style="font-size:11px;margin-top:4px;"></div>' +
      '<div id="nc-pecas-list" class="pecas-list"></div></div>' +
      '<div class="form-grid">' +
      '<div class="field"><label>Data do ocorrido *</label><input id="nc-data" type="date"></div>' +
      '<div class="field"><label>Horas de operação</label><input id="nc-horas" type="number" min="0" step="1" placeholder="ex.: 120"></div>' +
      '<div class="field"><label>Quilometragem (km)</label><input id="nc-km" type="number" min="0" step="1" placeholder="ex.: 3500"></div>' +
      '</div>' +
      '<div class="field"><label>Descrição do problema *</label><textarea id="nc-desc" rows="4" placeholder="Descreva o defeito constatado..."></textarea></div>' +
      '<div class="field"><label>Fotos e vídeos da peça defeituosa</label>' +
      '<input id="nc-fotos" type="file" accept="image/*,video/*" multiple>' +
      '<div id="nc-fotos-prev" class="media-gallery"></div></div>' +
      '</div>' +
      '<div class="modal-foot"><button class="btn" id="nc-rasc">Salvar como esboço</button>' +
      '<button class="btn red" id="nc-env">Enviar reivindicação</button></div></div>';
    document.body.appendChild(back);

    function fechar() { back.remove(); }
    // Só o X fecha o formulário — clicar no fundo escuro NÃO fecha, para o
    // cliente não perder o que preencheu por um clique fora sem querer.
    back.querySelector('.x').addEventListener('click', fechar);

    // Consultor de peças: resolve o que foi digitado para um SKU do catálogo.
    // Retorna '' (vazio), o SKU (válido) ou null (digitado mas não encontrado).
    function resolverPeca() {
      var v = document.getElementById('nc-peca').value.trim();
      if (!v) return '';
      var sku = v.split(' — ')[0].trim().toLowerCase();
      var p = FG.all('products').find(function (x) {
        return x.artigo.toLowerCase() === sku || (x.artigo + ' — ' + x.nome) === v;
      });
      return p ? p.artigo : null;
    }
    // Feedback ao vivo: mostra a peça cadastrada conforme o cliente digita.
    var pecaInfo = document.getElementById('nc-peca-info');
    var inpPeca = document.getElementById('nc-peca');
    function atualizarInfo() {
      var v = inpPeca.value.trim();
      if (!v) { pecaInfo.textContent = ''; pecaInfo.style.color = ''; return; }
      var sku = resolverPeca();
      if (sku) {
        var p = FG.product(sku);
        pecaInfo.style.color = 'var(--green)';
        pecaInfo.textContent = '✔ ' + p.artigo + ' — ' + p.nome + ' · ' + FG.fmtMoney(p.preco);
      } else {
        pecaInfo.style.color = '';
        pecaInfo.textContent = 'Selecione uma peça da lista (código cadastrado).';
      }
    }

    // --- Autocomplete próprio: dropdown com até 8 sugestões (código OU nome).
    // Setas navegam, Enter escolhe, Esc fecha; clicar também escolhe.
    var ac = document.getElementById('nc-peca-ac');
    var acItens = [], acIdx = -1;
    function acFechar() { ac.classList.add('hidden'); ac.innerHTML = ''; acItens = []; acIdx = -1; }
    function acMarcar(n) {
      acIdx = n;
      Array.prototype.forEach.call(ac.querySelectorAll('.ac-item'), function (el, i) {
        el.classList.toggle('on', i === acIdx);
        if (i === acIdx) el.scrollIntoView({ block: 'nearest' });
      });
    }
    function acEscolher(i) {
      var p = acItens[i]; if (!p) return;
      inpPeca.value = p.artigo + ' — ' + p.nome;
      acFechar(); atualizarInfo();
      document.getElementById('nc-peca-qtd').focus();
    }
    function acAbrir() {
      var t = inpPeca.value.trim().toLowerCase();
      if (t.length < 2) { acFechar(); return; }
      acItens = FG.all('products').filter(function (p) {
        return p.artigo.toLowerCase().indexOf(t) >= 0 || p.nome.toLowerCase().indexOf(t) >= 0;
      }).slice(0, 8);
      if (!acItens.length) { acFechar(); return; }
      acIdx = -1;
      ac.innerHTML = acItens.map(function (p, i) {
        return '<div class="ac-item" data-i="' + i + '"><b>' + esc(p.artigo) + '</b><span class="ac-nome">' +
          esc(p.nome) + '</span><span class="ac-preco">' + FG.fmtMoney(p.preco) + '</span></div>';
      }).join('');
      ac.classList.remove('hidden');
      Array.prototype.forEach.call(ac.querySelectorAll('.ac-item'), function (el) {
        // mousedown (não click): dispara antes do blur do input fechar a lista.
        el.addEventListener('mousedown', function (e) {
          e.preventDefault();
          acEscolher(Number(el.getAttribute('data-i')));
        });
      });
    }
    inpPeca.addEventListener('input', function () { acAbrir(); atualizarInfo(); });
    inpPeca.addEventListener('keydown', function (e) {
      if (ac.classList.contains('hidden')) return;
      if (e.key === 'ArrowDown') { e.preventDefault(); acMarcar(Math.min(acItens.length - 1, acIdx + 1)); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); acMarcar(Math.max(0, acIdx - 1)); }
      else if (e.key === 'Enter') { e.preventDefault(); acEscolher(acIdx >= 0 ? acIdx : 0); }
      else if (e.key === 'Escape') acFechar();
    });
    inpPeca.addEventListener('blur', function () { setTimeout(acFechar, 150); });

    // --- Peças defeituosas: lista dinâmica (código + quantidade) ---
    var pecas = [];
    var pecasBox = document.getElementById('nc-pecas-list');
    function renderPecas() {
      if (!pecas.length) {
        pecasBox.innerHTML = '<span class="muted" style="font-size:12px;">Nenhuma peça adicionada.</span>';
        return;
      }
      pecasBox.innerHTML = pecas.map(function (p) {
        return '<div class="peca-row"><span>' + esc(p.sku) + ' — ' + esc(p.nome) +
          ' <b>×' + p.quantidade + '</b></span>' +
          '<button type="button" class="peca-del" data-sku="' + esc(p.sku) + '" title="Remover">×</button></div>';
      }).join('');
      Array.prototype.forEach.call(pecasBox.querySelectorAll('.peca-del'), function (b) {
        b.addEventListener('click', function () {
          var sku = b.getAttribute('data-sku');
          pecas = pecas.filter(function (x) { return x.sku !== sku; });
          renderPecas();
        });
      });
    }
    // Prefill quando editando um rascunho ou uma reivindicação devolvida.
    if (pre) {
      var selTipo = document.getElementById('nc-tipo');
      if (pre.tipo) {
        // Garante que o tipo original apareça (inclusive legados, ex.: IT).
        if (!Array.prototype.some.call(selTipo.options, function (o) { return o.value === pre.tipo; })) {
          var op = document.createElement('option'); op.value = pre.tipo; op.textContent = pre.tipo; selTipo.appendChild(op);
        }
        selTipo.value = pre.tipo;
      }
      // Tipo é imutável a partir do 1º envio — trava ao editar reivindicação.
      if (modo === 'editar') selTipo.disabled = true;
      if (pre.niv) document.getElementById('nc-niv').value = pre.niv;
      document.getElementById('nc-data').value = pre.dataDefeito || '';
      document.getElementById('nc-horas').value = (pre.horimetro != null ? pre.horimetro : '');
      document.getElementById('nc-km').value = (pre.quilometragem != null ? pre.quilometragem : '');
      document.getElementById('nc-desc').value = pre.descricao || '';
      pecas = (pre.pecas || []).map(function (p) {
        var prod = FG.product(p.sku);
        return { sku: p.sku, nome: p.nome || (prod ? prod.nome : ''), quantidade: p.quantidade };
      });
    }
    renderPecas();
    document.getElementById('nc-peca-add').addEventListener('click', function () {
      var sku = resolverPeca();
      if (!sku) { FG.toast('Selecione uma peça válida da lista.', 'erro'); return; }
      var q = Math.max(1, parseInt(document.getElementById('nc-peca-qtd').value, 10) || 1);
      var p = FG.product(sku);
      var ex = pecas.find(function (x) { return x.sku === sku; });
      if (ex) ex.quantidade = q; else pecas.push({ sku: sku, nome: p.nome, quantidade: q });
      document.getElementById('nc-peca').value = '';
      document.getElementById('nc-peca-qtd').value = '1';
      pecaInfo.textContent = '';
      renderPecas();
    });

    // Preview das fotos escolhidas.
    var inpFotos = document.getElementById('nc-fotos');
    var prev = document.getElementById('nc-fotos-prev');
    inpFotos.addEventListener('change', function () {
      prev.innerHTML = '';
      Array.prototype.forEach.call(inpFotos.files, function (f) {
        var url = URL.createObjectURL(f);
        var video = f.type.indexOf('video/') === 0 || /\.(mp4|webm|mov|avi|mkv|m4v|3gp|ogv|mpe?g)$/i.test(f.name || '');
        var item = document.createElement('div');
        item.className = 'media-item' + (video ? ' is-video' : '');
        var media = document.createElement(video ? 'video' : 'img');
        if (video) { media.muted = true; media.preload = 'metadata'; }
        media.src = url;
        media.onload = media.onloadeddata = function () { URL.revokeObjectURL(url); };
        item.appendChild(media);
        if (video) { var pl = document.createElement('span'); pl.className = 'play'; pl.textContent = '▶'; item.appendChild(pl); }
        prev.appendChild(item);
      });
    });

    // Coleta os campos do formulário no formato da API.
    function coletar() {
      return {
        tipo: document.getElementById('nc-tipo').value,
        niv: document.getElementById('nc-niv').value,
        descricao: document.getElementById('nc-desc').value.trim(),
        dataDefeito: document.getElementById('nc-data').value || null,
        horimetro: document.getElementById('nc-horas').value || null,
        quilometragem: document.getElementById('nc-km').value || null,
        pecas: pecas.map(function (p) { return { sku: p.sku, quantidade: p.quantidade }; })
      };
    }
    // Validação obrigatória ao ENVIAR (NIV, peças, data e descrição).
    function validarEnvio(d) {
      if (!d.niv) { FG.toast('Selecione o NIV do veículo.', 'erro'); return false; }
      if (!pecas.length) { FG.toast('Adicione ao menos uma peça defeituosa.', 'erro'); return false; }
      if (!d.dataDefeito) { FG.toast('Informe a data do ocorrido.', 'erro'); return false; }
      if (!d.descricao) { FG.toast('Descreva o problema.', 'erro'); return false; }
      return true;
    }

    // ENVIAR: cria (novo/rascunho) ou atualiza+reenvia (editar). Sobe as fotos.
    // Durante o envio, uma cortina cobre o modal com um carregamento breve e,
    // no sucesso, a confirmação de que a garantia será avaliada pela equipe.
    document.getElementById('nc-env').addEventListener('click', async function () {
      var d = coletar();
      if (!validarEnvio(d)) return;

      var cortina = document.createElement('div');
      cortina.className = 'claim-envio';
      cortina.innerHTML = '<div class="fg-spinner"></div><p><b>Enviando sua garantia…</b></p>';
      back.querySelector('.modal').appendChild(cortina);

      // Espera mínima de ~0,9s: sem ela a cortina "pisca" e o cliente não
      // percebe que o envio aconteceu.
      var minimo = new Promise(function (r) { setTimeout(r, 900); });
      var c;
      if (modo === 'editar') {
        c = await FG.updateClaim(ctx.claim.id, d);
      } else {
        d.status = 'Em processo';
        d.criador = sess.empresa;
        c = await FG.createClaim(d);
      }
      if (!c) { cortina.remove(); return; }   // a API já avisou o erro; o form fica intacto
      if (inpFotos.files && inpFotos.files.length) {
        var up = await FG.uploadClaimFotos(c.id, inpFotos.files);
        if (!up.ok) FG.toast(up.msg || 'Salvo, mas falhou o envio das fotos.', 'erro');
      }
      await minimo;
      if (modo === 'rascunho' && ctx.rasc) excluirRascunho(ctx.rasc.localId);

      cortina.innerHTML =
        '<div class="claim-ok">✔</div>' +
        '<h3 style="margin:0;">Garantia enviada!</h3>' +
        '<p class="muted" style="max-width:340px;">Sua reivindicação <b>' + esc(c.id) + '</b> foi registrada ' +
        'e será avaliada por nossos representantes. Acompanhe o andamento na aba Reivindicações.</p>';
      setTimeout(function () {
        fechar();
        claimFiltro = 'Em processo';
        renderClaims();
      }, 2600);
    });

    // SALVAR COMO ESBOÇO: grava no navegador (não vai ao banco). Some ao editar
    // uma reivindicação já enviada.
    var rascBtn = document.getElementById('nc-rasc');
    if (modo === 'editar') { rascBtn.style.display = 'none'; }
    else rascBtn.addEventListener('click', function () {
      var d = coletar();
      if (!d.descricao && !pecas.length && !d.niv) { FG.toast('Nada para salvar no rascunho.'); return; }
      gravarRascunho({
        localId: (ctx && ctx.rasc && ctx.rasc.localId) || null,
        tipo: d.tipo, niv: d.niv, descricao: d.descricao,
        dataDefeito: d.dataDefeito, horimetro: d.horimetro, quilometragem: d.quilometragem,
        pecas: pecas.map(function (p) { return { sku: p.sku, nome: p.nome, quantidade: p.quantidade }; }),
        criadoEm: new Date().toISOString()
      });
      fechar();
      claimFiltro = 'Esboço';
      FG.toast('Rascunho salvo.');
      renderClaims();
    });
  }

  // Modal de VISUALIZAÇÃO (somente leitura) de uma reivindicação.
  function modalClaimDetalhe(c) {
    var back = document.createElement('div');
    back.className = 'modal-back';
    var uso = [];
    if (c.horimetro != null) uso.push(c.horimetro + ' h');
    if (c.quilometragem != null) uso.push(c.quilometragem + ' km');
    var pecas = (c.pecas || []).map(function (p) {
      return '<div class="peca-row"><span>' + esc(p.sku) + ' — ' + esc(p.nome) + ' <b>×' + p.quantidade + '</b></span></div>';
    }).join('') || '<span class="muted">—</span>';
    function anexoThumb(a) {
      var video = (a.tipo && a.tipo.indexOf('video/') === 0) || /\.(mp4|webm|mov|avi|mkv|m4v|3gp|ogv|mpe?g)$/i.test(a.url || a.nome || '');
      var inner = video
        ? '<video src="' + esc(a.url) + '" muted preload="metadata"></video><span class="play">▶</span>'
        : '<img src="' + esc(a.url) + '" alt="' + esc(a.nome || 'foto') + '">';
      return '<a class="media-item' + (video ? ' is-video' : '') + '" href="' + esc(a.url) + '" target="_blank" rel="noopener">' + inner + '</a>';
    }
    var fotos = (c.anexos && c.anexos.length)
      ? '<div class="media-gallery">' + c.anexos.map(anexoThumb).join('') + '</div>'
      : '<span class="muted">Sem fotos ou vídeos</span>';
    function linha(rot, val) { return '<div><span class="cell-label">' + rot + '</span><span class="cell-value">' + val + '</span></div>'; }
    back.innerHTML =
      '<div class="modal"><header><h3>Reivindicação ' + esc(c.id) + '</h3><button class="x">×</button></header>' +
      '<div class="modal-body">' +
      (c.sentBack ? '<div class="devolvida-aviso">↩ Devolvida — falta: ' + esc(c.faltaInformacao || 'informações') + '</div>' : '') +
      (c.status === 'Aprovada' ? '<div class="det-credito">✔ Garantia aprovada — as peças serão repostas sem cobrança ' +
        'por um pedido de garantia. Acompanhe na área de pedidos.</div>' : '') +
      '<div class="det-grid">' +
      linha('N° da reivindicação', '<b class="cl-num">' + esc(c.id) + '</b>') +
      linha('Status', esc(c.status)) +
      linha('Tipo', esc(c.tipo)) +
      linha('NIV', esc(c.niv || '—')) +
      linha('Criador', esc(c.criador || '—')) +
      linha('Data da reivindicação', FG.fmtDateTime(c.data)) +
      linha('Data do ocorrido', c.dataDefeito ? FG.fmtDate(c.dataDefeito) : '—') +
      linha('Uso', uso.length ? uso.join(' / ') : '—') +
      '</div>' +
      '<div class="field"><label>Peça(s) defeituosa(s)</label><div class="pecas-list">' + pecas + '</div></div>' +
      '<div class="field"><label>Descrição</label><div class="cell-value">' + esc(c.descricao || '—') + '</div></div>' +
      '<div class="field"><label>Fotos e vídeos</label>' + fotos + '</div>' +
      '</div>' +
      '<div class="modal-foot">' +
      (c.sentBack ? '<button class="btn red" id="det-editar">Editar e reenviar</button>' : '') +
      '<button class="btn-line" id="det-fechar">Fechar</button></div></div>';
    document.body.appendChild(back);
    function fechar() { back.remove(); }
    back.querySelector('.x').addEventListener('click', fechar);
    document.getElementById('det-fechar').addEventListener('click', fechar);
    back.addEventListener('click', function (e) { if (e.target === back) fechar(); });
    var ed = document.getElementById('det-editar');
    if (ed) ed.addEventListener('click', function () { fechar(); modalClaim(c.tipo, { modo: 'editar', claim: c }); });
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
          (o.garantia ? ' <span class="pill-status Garantia">Garantia</span>' : '') +
          (o.progresso && o.progresso.parcial ? ' <span class="pill-status Parcial">Parcial</span>' : '') +
          (o.temBackorder ? '<br><span class="muted" style="font-size:11px;">contém pré-venda</span>' : '');
        return '<tr><td><a href="#pedido/' + esc(o.id) + '">' + esc(o.id) + '</a>' +
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
      var linhas = [['Pedido', 'Data', 'Status', 'Total']];
      meus.forEach(function (o) { linhas.push([o.id, FG.fmtDateTime(o.data), o.status, o.total.toFixed(2)]); });
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
    FG.pedidoDetalhe(numero).then(function (d) {
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
      '<div class="ped-det-head"><h2 style="margin:0;">Pedido ' + esc(d.id) + '</h2>' +
      '<span class="pill-status ' + esc(d.status) + '">' + esc(d.status) + '</span>' +
      (d.garantia ? ' <span class="pill-status Garantia">Garantia — reposição sem cobrança</span>' : '') +
      (pg.parcial ? ' <span class="pill-status Parcial">Parcial</span>' : '') + '</div>' +
      '<p class="muted">' + FG.fmtDateTime(d.data) + ' · ' + esc(d.empresa) + ' · Total ' + FG.fmtMoney(d.total) + '</p>' +
      '<div class="prog-wrap"><div class="prog-bar"><div class="prog-fill" style="width:' + pg.pct + '%;"></div></div>' +
      '<span class="prog-label">' + pg.pct + '% (' + pg.enviada + ' de ' + pg.qtd + ' enviadas)</span></div>';

    if (normais.length)
      html += '<h3 class="sec-title">Itens em envio normal</h3>' + tabelaItens(normais);

    if (preVenda.length)
      html += '<h3 class="sec-title">Itens em pré-venda</h3>' +
        '<div class="backorder-aviso">Estes itens serão enviados quando o estoque for reposto.</div>' +
        tabelaItens(preVenda);

    if (d.faturas && d.faturas.length)
      html += '<h3 class="sec-title">Faturas</h3>' +
        '<table class="table"><thead><tr><th>Fatura</th><th>Data</th><th>Status</th>' +
        '<th class="right">Valor</th></tr></thead><tbody>' +
        d.faturas.map(function (f) {
          return '<tr><td>' + esc(f.numero) + '</td><td>' + (f.data ? FG.fmtDate(f.data) : '—') + '</td>' +
            '<td>' + (f.status ? '<span class="pill-status ' + esc(f.status) + '">' + esc(f.status) + '</span>' : '—') + '</td>' +
            '<td class="right">' + (f.valor != null ? FG.fmtMoney(f.valor) : '—') + '</td></tr>';
        }).join('') + '</tbody></table>';

    view.innerHTML = html;
    });
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

    document.getElementById('vd-ok').addEventListener('click', async function () {
      var nome = document.getElementById('vd-nome').value.trim();
      if (!nome) { FG.toast('Informe o nome do cliente.'); return; }
      var r = await FG.registrarVenda(v.niv, {
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

  // Modal (SÓ ADMIN) para transferir o chassi para outra concessionária,
  // digitando o nome dela (razão social ou nome fantasia).
  function modalTransferir(v, onDone) {
    var back = document.createElement('div');
    back.className = 'modal-back';
    back.innerHTML =
      '<div class="modal"><header><h3>Transferir revendedor — ' + esc(v.niv) + '</h3><button class="x">×</button></header>' +
      '<div class="modal-body">' +
      '<p class="muted" style="margin-top:0;">O chassi passa a pertencer à concessionária informada. ' +
      'Digite a razão social (ou nome fantasia) exata.</p>' +
      '<div class="field"><label>Concessionária de destino *</label>' +
      '<input id="tf-emp" type="text" placeholder="Ex.: POWER MOTOS LTDA" autocomplete="off"></div>' +
      '</div>' +
      '<div class="modal-foot"><button class="btn-line" id="tf-canc">Cancelar</button>' +
      '<button class="btn red" id="tf-ok">Transferir</button></div></div>';
    document.body.appendChild(back);

    function fechar() { back.remove(); }
    back.querySelector('.x').addEventListener('click', fechar);
    back.querySelector('#tf-canc').addEventListener('click', fechar);
    back.addEventListener('click', function (e) { if (e.target === back) fechar(); });
    document.getElementById('tf-emp').focus();

    document.getElementById('tf-ok').addEventListener('click', async function () {
      var nome = document.getElementById('tf-emp').value.trim();
      if (!nome) { FG.toast('Informe o nome da concessionária.'); return; }
      var r = await FG.transferirVeiculo(v.niv, nome);
      if (!r.ok) { FG.toast(r.msg || 'Não foi possível transferir.', 'erro'); return; }
      fechar();
      FG.toast('Veículo transferido para ' + esc(r.empresa || nome) + '.');
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
        (sess.papel === 'admin' ? '<button class="btn" id="av-transf">Transferir revendedor</button>' : '') +
        '<a class="btn" href="#reivindicacoes">Criar reivindicação</a>' +
        '<a class="btn" href="finder.html">Abrir no Parts Finder</a>' +
        '</div></div>';

      var bv = document.getElementById('av-venda');
      if (bv) bv.addEventListener('click', function () { modalVenda(v, buscar); });
      var bt = document.getElementById('av-transf');
      if (bt) bt.addEventListener('click', function () { modalTransferir(v, buscar); });
      var bg = document.getElementById('av-gar');
      if (bg) bg.addEventListener('click', async function () {
        var r = await FG.ativarGarantia(v.niv);
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
        var st = it.qtdEnviada >= it.qtd ? 'Enviado'
          : ((p && p.estoque >= (it.qtd - it.qtdEnviada)) ? 'Disponivel' : 'Aguardando');
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
            '<td><a href="#pedido/' + esc(x.o.id) + '">' + esc(x.o.id) + '</a></td>' +
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
          (i.referencia ? '<br><span class="muted" style="font-size:11px;">ref. reivindicação ' + esc(i.referencia) + '</span>' : '') +
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
      (i.referencia ? '<b>Ref. reivindicação:</b> ' + esc(i.referencia) + '<br>' : '') +
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

  }); // fim FG.pronto.then — tela montada só após o cache chegar
})();
