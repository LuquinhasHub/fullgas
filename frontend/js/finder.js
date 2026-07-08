/* =========================================================
   FULLGAS B2B — Spare Parts Finder (finder.html)
   ---------------------------------------------------------
   100% alimentado pela API (/api/finder/*): modelos com árvore,
   seções por lado, peças com quantidade padrão e diagrama com
   hotspots clicáveis — tudo editável no painel do administrador.
   ========================================================= */
(function () {
  'use strict';

  var sess = FG.guard();
  if (!sess) return;

  // Espera o cache (produtos p/ cesta) antes de montar a tela.
  FG.pronto.then(function () {

  var fdView = document.getElementById('fd-view');
  var esc = FG.esc;
  var USAGE_KEY = 'fullgas_finder_usage_v1';

  document.getElementById('fd-who').textContent = sess.email + ' - ' + sess.empresa;

  /* carrinho da loja no topo — o finder envia peças à mesma cesta da loja,
     então o contador acompanha cada "ADD ITEM(S) TO BASKET" */
  function refreshCart() {
    var el = document.getElementById('fd-cart-n');
    if (el) el.textContent = FG.cartCount();
  }
  refreshCart();

  /* estado atual: modelo (código) + lado (chassi/engine) */
  var atual = { modelo: null, lado: 'chassi' };
  var MODELOS = [];           // lista p/ árvore e busca (carregada da API)

  function modeloPorCodigo(cod) {
    for (var i = 0; i < MODELOS.length; i++) if (MODELOS[i].id === cod) return MODELOS[i];
    return null;
  }

  function logUsage(m) {
    try {
      var l = JSON.parse(localStorage.getItem(USAGE_KEY) || '[]').filter(function (x) { return x.id !== m.id; });
      l.unshift({ id: m.id, label: m.label, data: new Date().toISOString() });
      localStorage.setItem(USAGE_KEY, JSON.stringify(l.slice(0, 10)));
    } catch (e) { /* noop */ }
  }

  function falha(msg) {
    return function (e) { FG.toast((e && e.message) || msg || 'Falha ao carregar.', 'erro'); };
  }

  /* ---------- painel de busca: expandir/recolher e reset ---------- */
  var spBody = document.getElementById('sp-body');
  var spToggle = document.getElementById('sp-toggle');
  function recolherBusca() { spBody.classList.add('hidden'); spToggle.textContent = '▸ Search'; }
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

  /* ---------- árvore de modelos (a partir de m.arvore, vinda da API) ------ */
  var tree = document.getElementById('model-tree');
  function buildTree() {
    var root = {};
    MODELOS.forEach(function (m) {
      var arvore = (m.arvore && m.arvore.length) ? m.arvore : [m.label];
      var nivel = root;
      arvore.forEach(function (nome, i) {
        nivel[nome] = nivel[nome] || { filhos: {}, folha: null };
        if (i === arvore.length - 1) nivel[nome].folha = m;
        nivel = nivel[nome].filhos;
      });
    });
    function nodeHTML(obj, prof) {
      var html = '';
      Object.keys(obj).forEach(function (nome) {
        var n = obj[nome];
        var temFilhos = Object.keys(n.filhos).length > 0;
        if (n.folha) {
          html += '<div class="node leaf" data-id="' + esc(n.folha.id) + '" style="padding-left:' + (10 + prof * 18) + 'px;">' +
            esc(n.folha.label) + '</div>';
        } else {
          html += '<div class="node" style="padding-left:' + (10 + prof * 18) + 'px;"><span class="tw">' +
            (temFilhos ? '◢' : '') + '</span>' + esc(nome) + '</div>';
        }
        if (temFilhos) html += nodeHTML(n.filhos, prof + 1);
      });
      return html;
    }
    tree.innerHTML = nodeHTML(root, 0) ||
      '<div class="node muted" style="padding:8px 12px;">Nenhum modelo cadastrado.</div>';
    Array.prototype.forEach.call(tree.querySelectorAll('.leaf'), function (el) {
      el.addEventListener('click', function () {
        tree.classList.remove('open');
        location.hash = '#/modelo/' + el.getAttribute('data-id') + '/' + atual.lado;
      });
    });
  }

  document.getElementById('ms-open').addEventListener('click', function (e) {
    e.stopPropagation(); tree.classList.toggle('open');
  });
  document.getElementById('ms-input').addEventListener('click', function (e) {
    e.stopPropagation(); tree.classList.toggle('open');
  });
  document.addEventListener('click', function () { tree.classList.remove('open'); });

  /* ---------- busca por VIN / número de motor ---------- */
  document.getElementById('sp-search').addEventListener('click', function () {
    var vin = document.getElementById('sp-vin').value.trim().toUpperCase();
    var eng = document.getElementById('sp-eng').value.trim().toUpperCase();
    var lado = document.querySelector('input[name="sp-cat"]:checked').value;
    atual.lado = lado;

    if (vin || eng) {
      FG.finderBusca(vin ? { vin: vin } : { motor: eng }).then(function (r) {
        if (eng) atual.lado = 'engine';
        location.hash = '#/modelo/' + r.modelo.id + '/' + atual.lado;
      }, falha('Nenhum veículo encontrado.'));
      return;
    }
    if (atual.modelo) { location.hash = '#/modelo/' + atual.modelo + '/' + lado; return; }
    FG.toast('Informe um NIV, número de motor ou selecione um modelo.');
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
        return '<p><a href="#/modelo/' + esc(u.id) + '/chassi">' + esc(u.label) + '</a>' +
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

  /* miniatura de uma seção: diagrama enviado pelo admin ou moto esquemática */
  function thumbHTML(s, tam) {
    if (s.imagem) return '<img src="' + esc(s.imagem) + '" alt="' + esc(s.nome) + '" loading="lazy">';
    return '<span class="thumb-bg">' + FG.bikeSVG(s.destaque, tam || 92) + '</span>';
  }

  /* =========================================================
     TELA: visão geral do modelo (lista de seções + miniaturas)
     ========================================================= */
  function renderModelo(codigo, lado) {
    fdView.innerHTML = '<p class="muted">Carregando…</p>';
    FG.finderModelo(codigo).then(function (m) {
      atual.modelo = m.id; atual.lado = lado;
      logUsage(m);
      document.getElementById('ms-input').value = m.label;
      document.querySelector('input[name="sp-cat"][value="' + (lado === 'engine' ? 'engine' : 'chassi') + '"]').checked = true;
      recolherBusca();

      var secoes = m[lado] || [];
      var outro = lado === 'chassi' ? 'engine' : 'chassi';

      fdView.innerHTML =
        '<div class="finder-model-name">' + esc(m.label) + '</div>' +
        '<div class="finder-links">' +
        '<button id="fl-back">‹ Voltar</button>' +
        '<button id="fl-img">🖼 Show Image</button>' +
        '<a href="#/modelo/' + esc(m.id) + '/' + outro + '">Switch To ' + (outro === 'engine' ? 'Engine' : 'Frame') + '</a>' +
        '<button id="fl-doc">📘 Technical documentation</button>' +
        '</div>' +
        (secoes.length
          ? '<div class="finder-layout">' +
            '<div class="sec-list">' + secoes.map(function (s) {
              return '<button class="sec-item" data-id="' + s.id + '"><span class="n">' + esc(s.numero) + '</span>' +
                '<span>' + esc(s.nome) + '</span><span class="chev">›</span></button>';
            }).join('') + '</div>' +
            '<div class="thumb-grid">' + secoes.map(function (s) {
              return '<div class="thumb" data-id="' + s.id + '" role="button" tabindex="0">' +
                '<span class="tn">' + esc(s.numero) + '</span>' + thumbHTML(s, 92) + '</div>';
            }).join('') + '</div>' +
            '</div>'
          : '<p class="muted">Nenhuma seção cadastrada para o lado ' +
            (lado === 'engine' ? 'Engine' : 'Frame') + ' deste modelo.</p>');

      Array.prototype.forEach.call(fdView.querySelectorAll('[data-id]'), function (el) {
        function abrir() { location.hash = '#/secao/' + el.getAttribute('data-id'); }
        el.addEventListener('click', abrir);
        el.addEventListener('keydown', function (e) { if (e.key === 'Enter') abrir(); });
      });

      document.getElementById('fl-img').addEventListener('click', function () {
        if (!m.imagem) { FG.toast('O administrador ainda não enviou a foto deste modelo.'); return; }
        var back = document.createElement('div');
        back.className = 'modal-back';
        back.innerHTML = '<div class="modal modal-img"><header><h3>' + esc(m.label) + '</h3>' +
          '<button class="x">×</button></header><div class="modal-body">' +
          '<img src="' + esc(m.imagem) + '" alt="' + esc(m.label) + '"></div></div>';
        document.body.appendChild(back);
        back.querySelector('.x').addEventListener('click', function () { back.remove(); });
        back.addEventListener('click', function (e) { if (e.target === back) back.remove(); });
      });
      document.getElementById('fl-doc').addEventListener('click', function () {
        if (m.docTecnica) window.open(m.docTecnica, '_blank', 'noopener');
        else FG.toast('Nenhuma documentação técnica cadastrada para este modelo.');
      });
      // Voltar à tela inicial de busca (reabre o painel recolhido).
      document.getElementById('fl-back').addEventListener('click', function () {
        location.hash = '';
        spBody.classList.remove('hidden');
        spToggle.textContent = '▾ Search';
      });
    }, function () {
      fdView.innerHTML = '<p class="muted">Modelo não encontrado.</p>';
    });
  }

  /* =========================================================
     TELA: seção (tabela de peças + diagrama com hotspots e zoom)
     ========================================================= */
  function renderSecao(secaoId) {
    fdView.innerHTML = '<p class="muted">Carregando…</p>';
    FG.finderSecao(secaoId).then(function (s) {
      atual.modelo = s.modelo.id; atual.lado = s.lado;
      recolherBusca();
      document.getElementById('ms-input').value = s.modelo.label;
      var outro = s.lado === 'chassi' ? 'engine' : 'chassi';

      var linhas = s.pecas.map(function (p, i) {
        var marcada = p.quantidadePadrao > 0;
        return '<div class="part-row' + (marcada ? ' sel' : '') + '" data-row="' + i + '" data-num="' + esc(p.numeroImagem) + '">' +
          '<input type="checkbox" class="pr-chk" data-row="' + i + '"' + (marcada ? ' checked' : '') + '>' +
          '<span>' + (i + 1) + '</span>' +
          '<a href="loja.html#/produto/' + encodeURIComponent(p.sku) + '">' + esc(p.sku) + '</a>' +
          '<b><a href="loja.html#/produto/' + encodeURIComponent(p.sku) + '">' + esc(p.nome) + '</a></b>' +
          '<input class="cm" type="text" placeholder="Comment">' +
          '<input class="qn" type="number" min="0" value="' + p.quantidadePadrao + '" data-art="' + esc(p.sku) + '">' +
          '<span>(' + p.quantidade + ')</span>' +
          '</div>';
      }).join('');

      fdView.innerHTML =
        '<div class="finder-crumb"><a href="#/modelo/' + esc(s.modelo.id) + '/' + s.lado + '">' + esc(s.modelo.label) + '</a>' +
        ' <span class="chev">›</span> ' + esc(s.nome) +
        '<button class="link-action crumb-print" id="fa-print">🖨 Print</button></div>' +
        '<div class="fnd-actions">' +
        '<a class="btn" href="#/modelo/' + esc(s.modelo.id) + '/' + s.lado + '">‹ VOLTAR</a>' +
        '<button class="btn" id="fa-next"' + (s.vizinhos.proxima ? '' : ' disabled') + '>NEXT CATEGORY</button>' +
        '<a class="btn" href="#/modelo/' + esc(s.modelo.id) + '/' + outro + '">SWITCH TO ' + (outro === 'engine' ? 'ENGINE' : 'FRAME') + '</a>' +
        '</div>' +
        '<div class="part-layout">' +
        '<div>' +
        '<div class="part-toolbar"><span class="muted">' + esc(s.numero) + ' — ' + esc(s.nome) + '</span>' +
        '<button class="btn" id="fa-cart">🛒 ADD ITEM(S) TO BASKET</button></div>' +
        (linhas || '<p class="muted">Nenhuma peça cadastrada nesta seção ainda.</p>') +
        '</div>' +
        '<div class="diagram-box">' +
        (s.imagem
          ? '<div class="diag-tools">' +
            '<button class="dg-btn" id="dg-reset" title="Ajustar à tela">⟳</button>' +
            '<span class="grow"></span>' +
            '<button class="dg-btn" id="dg-prev"' + (s.vizinhos.anterior ? '' : ' disabled') + ' title="Seção anterior">◀</button>' +
            '<input type="range" id="dg-zoom" min="0.1" max="1.6" step="0.05" value="0.6">' +
            '<span class="dg-marks">0.1&nbsp;&nbsp;0.6&nbsp;&nbsp;1.1&nbsp;&nbsp;1.6</span>' +
            '<button class="dg-btn" id="dg-next"' + (s.vizinhos.proxima ? '' : ' disabled') + ' title="Próxima seção">▶</button>' +
            '</div>' +
            '<div class="diag-viewport" id="dg-view"><div class="diag-canvas" id="dg-canvas">' +
            '<img id="dg-img" src="' + esc(s.imagem) + '" alt="' + esc(s.nome) + '" draggable="false">' +
            '</div></div>'
          : '<div class="diag-vazio">' + FG.bikeSVG(s.destaque, 360) +
            '<div class="cap">O administrador ainda não enviou o diagrama desta seção.</div></div>') +
        '</div></div>';

      document.getElementById('fa-print').addEventListener('click', function () { window.print(); });
      document.getElementById('fa-next').addEventListener('click', function () {
        if (s.vizinhos.proxima) location.hash = '#/secao/' + s.vizinhos.proxima;
      });

      // Destaca no diagrama os hotspots das linhas selecionadas (no-op sem
      // diagrama — o canvas só existe quando a seção tem imagem).
      function sincronizarHotspots() {
        var cv = document.getElementById('dg-canvas');
        if (!cv) return;
        var nums = {};
        Array.prototype.forEach.call(fdView.querySelectorAll('.part-row.sel'), function (r) {
          var n = r.getAttribute('data-num'); if (n) nums[n] = true;
        });
        Array.prototype.forEach.call(cv.querySelectorAll('.hotspot'), function (h) {
          h.classList.toggle('on', !!nums[h.getAttribute('data-num')]);
        });
      }

      /* seleção de linha (checkbox) destaca em vermelho */
      Array.prototype.forEach.call(fdView.querySelectorAll('.pr-chk'), function (chk) {
        chk.addEventListener('change', function () {
          var row = fdView.querySelector('.part-row[data-row="' + chk.getAttribute('data-row') + '"]');
          row.classList.toggle('sel', chk.checked);
          var qn = row.querySelector('.qn');
          if (chk.checked && Number(qn.value) === 0) qn.value = 1;
          sincronizarHotspots();
        });
      });

      /* adicionar selecionados à cesta da loja */
      document.getElementById('fa-cart').addEventListener('click', function () {
        var add = 0, recusadas = 0;
        Array.prototype.forEach.call(fdView.querySelectorAll('.part-row.sel .qn'), function (qn) {
          var qtd = Math.max(0, Number(qn.value) || 0);
          if (qtd <= 0) return;
          if (FG.cartAdd(qn.getAttribute('data-art'), qtd)) add += qtd;
          else recusadas++;
        });
        if (add) FG.toast(add + ' item(ns) enviados à cesta da loja.' + (recusadas ? ' ' + recusadas + ' indisponível(is).' : ''));
        else if (recusadas) FG.toast('Peça(s) indisponível(is) no momento — sem estoque e sem previsão.', 'erro');
        else FG.toast('Marque ao menos uma peça com quantidade.');
        refreshCart();
      });

      /* ---------- diagrama: zoom + hotspots ---------- */
      if (!s.imagem) return;
      var img = document.getElementById('dg-img');
      var canvas = document.getElementById('dg-canvas');
      var viewport = document.getElementById('dg-view');
      var slider = document.getElementById('dg-zoom');
      var natW = 0, natH = 0;

      function aplicarZoom(z) {
        if (!natW) return;
        slider.value = z;
        canvas.style.width = Math.round(natW * z) + 'px';
      }
      // Ajuste automático: a imagem INTEIRA cabe no quadro (largura E altura),
      // qualquer que seja o tamanho enviado pelo admin — o padrão dos diagramas
      // é 750×1080 (retrato), que sem o limite de altura estouraria o quadro.
      function zoomAjuste() {
        if (!natW) return 0.6;
        var fit = Math.min((viewport.clientWidth - 2) / natW,
                           (viewport.clientHeight - 2) / natH);
        return Math.max(0.1, Math.min(1.6, Math.floor(fit * 20) / 20));
      }

      function montarHotspots() {
        s.hotspots.forEach(function (h) {
          var el = document.createElement('button');
          el.className = 'hotspot';
          el.type = 'button';
          el.setAttribute('data-num', h.linkNumero || '');
          el.title = (h.texto ? h.texto + ' — ' : '') + (h.linkNumero ? 'nº ' + h.linkNumero + ' na imagem' : '');
          if (h.linkNumero) el.innerHTML = '<span class="hs-n">' + esc(h.linkNumero) + '</span>';
          el.style.left = (h.x / natW * 100) + '%';
          el.style.top = (h.y / natH * 100) + '%';
          el.style.width = (h.w / natW * 100) + '%';
          el.style.height = (h.h / natH * 100) + '%';
          el.addEventListener('click', function () {
            var num = h.linkNumero;
            if (!num) { if (h.texto) FG.toast(h.texto); return; }
            var alvo = null;
            Array.prototype.forEach.call(fdView.querySelectorAll('.part-row'), function (row) {
              if (row.getAttribute('data-num') === num) {
                var chk = row.querySelector('.pr-chk');
                chk.checked = true;
                row.classList.add('sel');
                var qn = row.querySelector('.qn');
                if (Number(qn.value) === 0) qn.value = 1;
                if (!alvo) alvo = row;
              }
            });
            if (alvo) alvo.scrollIntoView({ behavior: 'smooth', block: 'center' });
            else FG.toast('Nenhuma peça com o nº ' + num + ' nesta lista.');
            sincronizarHotspots();
          });
          canvas.appendChild(el);
        });
        sincronizarHotspots();
      }

      function prontoImg() {
        natW = img.naturalWidth || 1; natH = img.naturalHeight || 1;
        aplicarZoom(zoomAjuste());
        montarHotspots();
      }
      if (img.complete && img.naturalWidth) prontoImg();
      else { img.addEventListener('load', prontoImg); img.addEventListener('error', function () {
        viewport.innerHTML = '<p class="muted" style="padding:20px;">Não foi possível carregar o diagrama.</p>';
      }); }

      slider.addEventListener('input', function () { aplicarZoom(Number(slider.value)); });
      document.getElementById('dg-reset').addEventListener('click', function () { aplicarZoom(zoomAjuste()); });
      document.getElementById('dg-prev').addEventListener('click', function () {
        if (s.vizinhos.anterior) location.hash = '#/secao/' + s.vizinhos.anterior;
      });
      document.getElementById('dg-next').addEventListener('click', function () {
        if (s.vizinhos.proxima) location.hash = '#/secao/' + s.vizinhos.proxima;
      });

      /* passar o mouse numa linha realça os hotspots daquele número */
      Array.prototype.forEach.call(fdView.querySelectorAll('.part-row'), function (row) {
        row.addEventListener('mouseenter', function () {
          var n = row.getAttribute('data-num');
          Array.prototype.forEach.call(canvas.querySelectorAll('.hotspot'), function (h) {
            if (h.getAttribute('data-num') === n && n) h.classList.add('hover');
          });
        });
        row.addEventListener('mouseleave', function () {
          Array.prototype.forEach.call(canvas.querySelectorAll('.hotspot.hover'), function (h) {
            h.classList.remove('hover');
          });
        });
      });
    }, function () {
      fdView.innerHTML = '<p class="muted">Seção não encontrada.</p>';
    });
  }

  /* =========================================================
     ROUTER
     ========================================================= */
  function route() {
    var h = (location.hash || '').slice(1);
    if (h[0] === '/') h = h.slice(1);
    var p = h.split('/');
    if (p[0] === 'modelo' && p[1]) renderModelo(decodeURIComponent(p[1]), p[2] === 'engine' ? 'engine' : 'chassi');
    else if (p[0] === 'secao' && p[1]) renderSecao(Number(p[1]));
    else fdView.innerHTML = '';
    window.scrollTo(0, 0);
  }

  /* carrega os modelos (árvore) e só então liga o router */
  FG.finderModelos().then(function (lista) {
    MODELOS = lista || [];
    buildTree();
    window.addEventListener('hashchange', route);
    route();
  }, function (e) {
    fdView.innerHTML = '<p class="muted">Não foi possível carregar os modelos: ' +
      esc((e && e.message) || 'erro de rede') + '</p>';
  });

  }); // fim FG.pronto.then
})();
