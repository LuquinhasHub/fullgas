/* =========================================================
   FULLGAS B2B — Spare Parts Finder (finder.html)
   ========================================================= */
(function () {
  'use strict';

  var sess = FG.guard();
  if (!sess) return;

  // Espera o cache (carregado de forma assíncrona via fetch) antes de montar a
  // tela — nada de renderizar com dados vazios.
  FG.pronto.then(function () {

  var fdView = document.getElementById('fd-view');
  var esc = FG.esc;
  var USAGE_KEY = 'fullgas_finder_usage_v1';

  document.getElementById('fd-who').textContent = sess.email + ' - ' + sess.empresa;

  /* estado atual: modelo + lado (chassi/engine) */
  var atual = { modelo: null, lado: 'chassi' };

  function logUsage(m) {
    try {
      var l = JSON.parse(localStorage.getItem(USAGE_KEY) || '[]').filter(function (x) { return x.id !== m.id; });
      l.unshift({ id: m.id, label: m.label, data: new Date().toISOString() });
      localStorage.setItem(USAGE_KEY, JSON.stringify(l.slice(0, 10)));
    } catch (e) { /* noop */ }
  }

  /* ---------- painel de busca: expandir/recolher e reset ---------- */
  var spBody = document.getElementById('sp-body');
  var spToggle = document.getElementById('sp-toggle');
  spToggle.addEventListener('click', function () {
    var aberto = !spBody.classList.contains('hidden');
    spBody.classList.toggle('hidden', aberto);
    spToggle.textContent = (aberto ? '▸' : '▾') + ' Search';
  });
  document.getElementById('sp-reset').addEventListener('click', function (e) {
    e.preventDefault();
    location.hash = '';
    document.getElementById('sp-vin').value = '';
    document.getElementById('sp-eng').value = '';
    document.getElementById('ms-input').value = '';
    atual = { modelo: null, lado: 'chassi' };
    fdView.innerHTML = '';
    spBody.classList.remove('hidden');
    spToggle.textContent = '▾ Search';
  });

  /* ---------- árvore de modelos ---------- */
  var tree = document.getElementById('model-tree');
  function buildTree() {
    /* monta a hierarquia a partir de m.arvore (último nó = folha do modelo) */
    var root = {};
    FG.all('models').forEach(function (m) {
      var nivel = root;
      m.arvore.forEach(function (nome, i) {
        nivel[nome] = nivel[nome] || { filhos: {}, folha: null };
        if (i === m.arvore.length - 1) nivel[nome].folha = m;
        nivel = nivel[nome].filhos;
      });
    });
    function nodeHTML(obj, prof) {
      var html = '';
      Object.keys(obj).forEach(function (nome) {
        var n = obj[nome];
        var temFilhos = Object.keys(n.filhos).length > 0;
        if (n.folha) {
          html += '<div class="node leaf" data-id="' + n.folha.id + '" style="padding-left:' + (10 + prof * 18) + 'px;">' +
            esc(n.folha.label) + '</div>';
        } else {
          html += '<div class="node" style="padding-left:' + (10 + prof * 18) + 'px;"><span class="tw">' +
            (temFilhos ? '◢' : '') + '</span>' + esc(nome) + '</div>';
        }
        if (temFilhos) html += nodeHTML(n.filhos, prof + 1);
      });
      return html;
    }
    tree.innerHTML = nodeHTML(root, 0);
    Array.prototype.forEach.call(tree.querySelectorAll('.leaf'), function (el) {
      el.addEventListener('click', function () {
        tree.classList.remove('open');
        location.hash = '#/modelo/' + el.getAttribute('data-id') + '/' + atual.lado;
      });
    });
  }
  buildTree();

  document.getElementById('ms-open').addEventListener('click', function (e) {
    e.stopPropagation(); tree.classList.toggle('open');
  });
  document.getElementById('ms-input').addEventListener('click', function (e) {
    e.stopPropagation(); tree.classList.toggle('open');
  });
  document.addEventListener('click', function () { tree.classList.remove('open'); });

  /* ---------- busca por VIN / motor ---------- */
  document.getElementById('sp-search').addEventListener('click', function () {
    var vin = document.getElementById('sp-vin').value.trim().toUpperCase();
    var eng = document.getElementById('sp-eng').value.trim().toUpperCase();
    var lado = document.querySelector('input[name="sp-cat"]:checked').value;
    atual.lado = lado;

    var modelo = null;
    if (vin) {
      var v = FG.all('vehicles').find(function (x) { return x.niv.toUpperCase() === vin; });
      if (v) modelo = FG.model(v.modeloId);
      FG.logSearch(vin, modelo ? 1 : 0);
      if (!modelo) { FG.toast('Nenhum veículo encontrado com este NIV.'); return; }
    } else if (eng) {
      /* número de motor demonstrativo: usa os 3 primeiros dígitos para achar a cilindrada */
      modelo = FG.all('models').find(function (m) { return eng.indexOf(String(m.nome).replace(/\D/g, '')) >= 0; }) || FG.all('models')[0];
      FG.logSearch(eng, modelo ? 1 : 0);
      atual.lado = 'engine';
    } else if (atual.modelo) {
      modelo = atual.modelo;
    } else {
      FG.toast('Informe um NIV, número de motor ou selecione um modelo.');
      return;
    }
    location.hash = '#/modelo/' + modelo.id + '/' + atual.lado;
  });

  /* ---------- usage list ---------- */
  document.getElementById('btn-usage').addEventListener('click', function () {
    var l = [];
    try { l = JSON.parse(localStorage.getItem(USAGE_KEY) || '[]'); } catch (e) { /* noop */ }
    var back = document.createElement('div');
    back.className = 'modal-back';
    back.innerHTML = '<div class="modal"><header><h3>Usage list</h3><button class="x">×</button></header>' +
      '<div class="modal-body">' +
      (l.length ? l.map(function (u) {
        return '<p><a href="#/modelo/' + u.id + '/chassi">' + esc(u.label) + '</a>' +
          ' <span class="muted" style="font-size:11px;">' + FG.fmtDateTime(u.data) + '</span></p>';
      }).join('') : '<p class="muted">Nenhum modelo consultado ainda.</p>') +
      '</div></div>';
    document.body.appendChild(back);
    back.querySelector('.x').addEventListener('click', function () { back.remove(); });
    back.addEventListener('click', function (e) { if (e.target === back) back.remove(); });
    Array.prototype.forEach.call(back.querySelectorAll('a'), function (a) {
      a.addEventListener('click', function () { back.remove(); });
    });
  });

  /* =========================================================
     TELA: visão geral do modelo (lista de seções + miniaturas)
     ========================================================= */
  function renderModelo(modeloId, lado) {
    var m = FG.model(modeloId);
    if (!m) { fdView.innerHTML = '<p class="muted">Modelo não encontrado.</p>'; return; }
    atual.modelo = m; atual.lado = lado;
    logUsage(m);
    document.getElementById('ms-input').value = m.label;
    document.querySelector('input[name="sp-cat"][value="' + (lado === 'engine' ? 'engine' : 'chassi') + '"]').checked = true;

    /* recolhe o painel de busca, como no fluxo original */
    spBody.classList.add('hidden');
    spToggle.textContent = '▸ Search';

    var secoes = m[lado] || [];
    var outro = lado === 'chassi' ? 'engine' : 'chassi';

    fdView.innerHTML =
      '<div class="finder-model-name">' + esc(m.label) + '</div>' +
      '<div class="finder-links">' +
      '<button id="fl-img">🖼 Show Image</button>' +
      '<a href="#/modelo/' + m.id + '/' + outro + '">Switch To ' + (outro === 'engine' ? 'Engine' : 'Frame') + '</a>' +
      '<button id="fl-doc">📘 Technical documentation</button>' +
      '</div>' +
      '<div class="finder-layout">' +
      '<div class="sec-list">' + secoes.map(function (s, i) {
        return '<button class="sec-item" data-i="' + i + '"><span class="n">' + s.num + '</span>' +
          '<span>' + esc(s.nome) + '</span><span class="chev">›</span></button>';
      }).join('') + '</div>' +
      '<div class="thumb-grid">' + secoes.map(function (s, i) {
        return '<div class="thumb" data-i="' + i + '" role="button" tabindex="0">' +
          '<span class="tn">' + s.num + '</span>' +
          '<span class="thumb-bg">' + FG.bikeSVG(s.destaque, 92) + '</span></div>';
      }).join('') + '</div>' +
      '</div>';

    function abrir(i) { location.hash = '#/secao/' + m.id + '/' + lado + '/' + i; }
    Array.prototype.forEach.call(fdView.querySelectorAll('[data-i]'), function (el) {
      el.addEventListener('click', function () { abrir(Number(el.getAttribute('data-i'))); });
      el.addEventListener('keydown', function (e) { if (e.key === 'Enter') abrir(Number(el.getAttribute('data-i'))); });
    });
    document.getElementById('fl-img').addEventListener('click', function () {
      FG.toast('Imagens em alta resolução: disponíveis na versão integrada ao servidor.');
    });
    document.getElementById('fl-doc').addEventListener('click', function () {
      FG.toast('Documentação técnica: disponível na versão integrada ao servidor.');
    });
  }

  /* =========================================================
     TELA: seção (tabela de peças + diagrama)
     ========================================================= */
  function renderSecao(modeloId, lado, idx) {
    var m = FG.model(modeloId);
    if (!m) { fdView.innerHTML = '<p class="muted">Modelo não encontrado.</p>'; return; }
    atual.modelo = m; atual.lado = lado;
    var secoes = m[lado] || [];
    var s = secoes[idx];
    if (!s) { location.hash = '#/modelo/' + m.id + '/' + lado; return; }
    var outro = lado === 'chassi' ? 'engine' : 'chassi';
    var proxima = (idx + 1) % secoes.length;

    spBody.classList.add('hidden');
    spToggle.textContent = '▸ Search';
    document.getElementById('ms-input').value = m.label;

    var linhas = s.parts.map(function (p, i) {
      var prod = FG.product(p.artigo);
      var nome = prod ? prod.nome : p.artigo;
      return '<div class="part-row' + (i === 0 ? ' sel' : '') + '" data-row="' + i + '">' +
        '<input type="checkbox" class="pr-chk" data-row="' + i + '"' + (i === 0 ? ' checked' : '') + '>' +
        '<span>' + p.pos + '</span>' +
        '<a href="loja.html#/produto/' + encodeURIComponent(p.artigo) + '">' + p.artigo + '</a>' +
        '<b><a href="loja.html#/produto/' + encodeURIComponent(p.artigo) + '">' + esc(nome) + '</a></b>' +
        '<input class="cm" type="text" placeholder="Comment">' +
        '<input class="qn" type="number" min="0" value="' + (i === 0 ? 1 : 0) + '" data-art="' + p.artigo + '">' +
        '<span>(' + p.qtd + ')</span>' +
        '<span class="pr-min">' + p.minutos + ' Minutes</span>' +
        '</div>';
    }).join('');

    fdView.innerHTML =
      '<div class="finder-model-name"><a href="#/modelo/' + m.id + '/' + lado + '">' + esc(m.label) + '</a> › ' + esc(s.nome) + '</div>' +
      '<div class="fnd-actions">' +
      '<button class="btn" id="fa-next">NEXT CATEGORY</button>' +
      '<a class="btn" href="#/modelo/' + m.id + '/' + outro + '">SWITCH TO ' + (outro === 'engine' ? 'ENGINE' : 'FRAME') + '</a>' +
      '<span style="flex:1;"></span>' +
      '<button class="btn" id="fa-cart">🛒 Adicionar selecionados à loja</button>' +
      '<button class="link-action" id="fa-print">🖨 Print</button>' +
      '</div>' +
      '<div class="part-layout">' +
      '<div>' + linhas + '</div>' +
      '<div class="diagram-box">' + FG.bikeSVG(s.destaque, 360) +
      '<div class="cap">Diagrama ilustrativo — ' + esc(s.num + ' ' + s.nome) + '. Clique no artigo para abrir na loja.</div>' +
      '</div></div>';

    document.getElementById('fa-next').addEventListener('click', function () {
      location.hash = '#/secao/' + m.id + '/' + lado + '/' + proxima;
    });
    document.getElementById('fa-print').addEventListener('click', function () { window.print(); });

    /* seleção de linha destaca em vermelho */
    Array.prototype.forEach.call(fdView.querySelectorAll('.pr-chk'), function (chk) {
      chk.addEventListener('change', function () {
        var row = fdView.querySelector('.part-row[data-row="' + chk.getAttribute('data-row') + '"]');
        row.classList.toggle('sel', chk.checked);
        var qn = row.querySelector('.qn');
        if (chk.checked && Number(qn.value) === 0) qn.value = 1;
      });
    });

    /* adicionar selecionados ao carrinho da loja */
    document.getElementById('fa-cart').addEventListener('click', function () {
      var add = 0;
      Array.prototype.forEach.call(fdView.querySelectorAll('.part-row.sel .qn'), function (qn) {
        var qtd = Math.max(0, Number(qn.value) || 0);
        if (qtd > 0 && FG.cartAdd(qn.getAttribute('data-art'), qtd)) add += qtd;
      });
      if (add) FG.toast(add + ' item(ns) enviados à cesta da loja.');
      else FG.toast('Marque ao menos uma peça com quantidade.');
    });
  }

  /* =========================================================
     ROUTER
     ========================================================= */
  function route() {
    var h = (location.hash || '').slice(1);
    if (h[0] === '/') h = h.slice(1);
    var p = h.split('/');
    if (p[0] === 'modelo' && p[1]) renderModelo(p[1], p[2] === 'engine' ? 'engine' : 'chassi');
    else if (p[0] === 'secao' && p[1]) renderSecao(p[1], p[2] === 'engine' ? 'engine' : 'chassi', Number(p[3]) || 0);
    else fdView.innerHTML = '';
    window.scrollTo(0, 0);
  }

  window.addEventListener('hashchange', route);
  route();

  }); // fim FG.pronto.then — tela montada só após o cache chegar
})();
