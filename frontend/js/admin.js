/* =========================================================
   FULLGAS B2B — Painel administrativo (admin.html)
   ========================================================= */
(function () {
  'use strict';

  var sess = FG.guard('admin');
  if (!sess) return;

  // Espera o cache (carregado de forma assíncrona via fetch) antes de montar a
  // tela — nada de renderizar com dados vazios.
  FG.pronto.then(function () {

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
      '<table class="tbl"><thead><tr><th>Foto</th><th>Artigo</th><th>Nome</th><th>Categoria</th>' +
      '<th class="r">Preço</th><th class="r">Estoque</th><th>Ações</th></tr></thead><tbody>' +
      prods.map(function (p) {
        var c = FG.category(p.cat);
        return '<tr><td>' + (p.imagem
            ? '<img class="fnd-thumb" src="' + esc(p.imagem) + '" alt="">'
            : '<span class="fnd-thumb vazio">sem foto</span>') + '</td>' +
          '<td>' + p.artigo + '</td><td>' + esc(p.nome) +
          (p.tinyAtivo ? ' <span class="pill-status Tiny" title="Gerenciado pelo Tiny ERP">Tiny</span>' : '') +
          '</td><td>' + esc(c ? c.nome : p.cat) + '</td>' +
          '<td class="r">' + FG.fmtMoney(p.preco) + '</td>' +
          '<td class="r">' + (p.estoque > 0
            ? p.estoque
            : '<span style="color:#b91c1c;font-weight:700;">Fora de estoque</span>' +
              (p.previsao
                ? '<div style="color:#92600a;font-weight:600;font-size:12px;margin-top:2px;">⏳ Chega em ' + esc(p.previsao) + '</div>'
                : '<div style="color:#92600a;font-size:12px;margin-top:2px;">sem previsão</div>')) + '</td>' +
          '<td><button class="btn-line btn-mini" data-ac="edit" data-art="' + p.artigo + '">Editar</button> ' +
          '<button class="btn-line btn-mini" data-ac="del" data-art="' + p.artigo + '">Excluir</button></td></tr>';
      }).join('') + '</tbody></table></div></div>';

    document.getElementById('pr-novo').addEventListener('click', function () { modalProduto(null); });
    Array.prototype.forEach.call(view.querySelectorAll('[data-ac]'), function (b) {
      b.addEventListener('click', function () {
        var art = b.getAttribute('data-art');
        if (b.getAttribute('data-ac') === 'edit') { modalProduto(FG.product(art)); return; }
        if (!confirm('Excluir o artigo ' + art + '?')) return;
        FG.apiExcluirProduto(art)
          .then(function () { FG.toast('Artigo excluído.'); renderProdutos(); })
          .catch(function (e) { FG.toast((e && e.message) || 'Falha ao excluir.', 'erro'); });
      });
    });
  }

  function modalProduto(p) {
    var novo = !p;
    // Produto do Tiny: nome, preço, estoque, descrição e foto são espelho do
    // ERP — ficam travados aqui. Só categoria e previsão continuam editáveis.
    var tiny = !!(p && p.tinyAtivo);
    var trava = tiny ? ' disabled' : '';
    var back = document.createElement('div');
    back.className = 'modal-back';
    back.innerHTML =
      '<div class="modal"><header><h3>' + (novo ? 'Novo produto' : 'Editar ' + p.artigo) + '</h3><button class="x">×</button></header>' +
      '<div class="modal-body">' +
      (tiny
        ? '<div class="adm-banner">🔒 Este produto é gerenciado pelo <b>Tiny ERP</b>: nome, preço, estoque, descrição e foto ' +
          'são atualizados automaticamente. Para alterar, edite no Tiny. Aqui só categoria e previsão de chegada.' +
          (p.tinySincronizadoEm ? '<br><span class="muted">Última sincronização: ' + FG.fmtDateTime(p.tinySincronizadoEm) + '</span>' : '') +
          '</div>'
        : '') +
      '<div class="field"><label>Número do artigo</label><input id="mp-art" type="text"' + (novo ? '' : ' disabled') + ' value="' + (p ? p.artigo : '') + '"></div>' +
      '<div class="field"><label>Nome</label><input id="mp-nome" type="text"' + trava + ' value="' + (p ? esc(p.nome) : '') + '"></div>' +
      '<div class="field"><label>Categoria</label><select id="mp-cat">' +
      FG.all('categories').map(function (c) {
        return '<option value="' + c.id + '"' + (p && p.cat === c.id ? ' selected' : '') + '>' + esc(c.nome) + '</option>';
      }).join('') + '</select></div>' +
      '<div class="field"><label>Preço (R$)</label><input id="mp-preco" type="number" step="0.01" min="0"' + trava + ' value="' + (p ? p.preco : '') + '"></div>' +
      '<div class="field"><label>Estoque</label><input id="mp-est" type="number" min="0"' + trava + ' value="' + (p ? p.estoque : 0) + '"></div>' +
      '<div class="field"><label>Previsão de chegada (se sem estoque)</label><input id="mp-prev" type="text" placeholder="dd/mm/aa" value="' + (p && p.previsao ? p.previsao : '') + '"></div>' +
      '<div class="field"><label>Descrição</label><textarea id="mp-desc" rows="3"' + trava + '>' + (p ? esc(p.descricao) : '') + '</textarea></div>' +
      '<div class="field"><label>Foto da peça (miniatura no Parts Finder)</label>' +
      '<div class="fnd-foto-row">' +
      (p && p.imagem ? '<img class="fnd-thumb" src="' + esc(p.imagem) + '" alt="">' : '<span class="fnd-thumb vazio">sem foto</span>') +
      '<input id="mp-foto" type="file" accept="image/*"' + trava + '>' +
      (p && p.imagem && !tiny ? '<button class="btn-line btn-mini" id="mp-foto-del" type="button">Remover foto</button>' : '') +
      '</div></div>' +
      '</div>' +
      '<div class="modal-foot"><button class="btn-line" id="mp-canc">Cancelar</button>' +
      '<button class="btn-orange" id="mp-ok">Salvar</button></div></div>';
    document.body.appendChild(back);

    function fechar() { back.remove(); }
    back.querySelector('.x').addEventListener('click', fechar);
    document.getElementById('mp-canc').addEventListener('click', fechar);
    back.addEventListener('click', function (e) { if (e.target === back) fechar(); });

    var mpFotoDel = document.getElementById('mp-foto-del');
    if (mpFotoDel) mpFotoDel.addEventListener('click', function () {
      FG.removerImagemProduto(p.artigo).then(function (r) {
        if (r && r.ok === false) { FG.toast(r.msg || 'Falha ao remover a foto.', 'erro'); return; }
        FG.toast('Foto removida.'); fechar(); renderProdutos();
      });
    });

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
      function fail(e) { FG.toast((e && e.message) || 'Falha ao salvar o produto.', 'erro'); }
      var acao = novo ? FG.apiCriarProduto(dados) : FG.apiEditarProduto(art, dados);
      acao.then(function () {
        var arquivo = document.getElementById('mp-foto').files[0];
        var fotoOk = arquivo ? FG.uploadImagemProduto(art, arquivo) : Promise.resolve({ ok: true });
        return fotoOk.then(function (rf) {
          if (rf && rf.ok === false) FG.toast('Produto salvo, mas a foto falhou: ' + (rf.msg || ''), 'erro');
          else FG.toast(novo ? 'Produto criado.' : 'Produto salvo.');
          fechar(); renderProdutos();
        });
      }).catch(fail);
    });
  }

  /* =========================================================
     PEDIDOS
     ========================================================= */
  var STATUS = ['Pendente', 'Processando', 'Enviado', 'Entregue', 'Cancelado'];
  // Status terminais: uma vez aqui, o pedido não pode mais mudar de status.
  var STATUS_TERMINAIS = ['Entregue', 'Cancelado'];

  // Status de cada peça do pedido (a partir de qtd/qtdEnviada/backorder):
  // Enviado (tudo), Parcial (parte), Pré-venda (backorder não enviado),
  // Pendente (normal não enviado). Não altera o status do pedido em si.
  function itemStatus(it) {
    if (it.qtdEnviada >= it.qtd) return { cls: 'Enviado', txt: 'Enviado' };
    if (it.qtdEnviada > 0) return { cls: 'Parcial', txt: 'Parcial ' + it.qtdEnviada + '/' + it.qtd };
    if (it.backorder) return { cls: 'PreVenda', txt: 'Pré-venda' };
    return { cls: 'Pendente', txt: 'Pendente' };
  }

  // Linha de uma peça no detalhe da venda.
  function linhaItemVenda(it) {
    var st = itemStatus(it);
    return '<tr><td>' + esc(it.artigo) + '</td><td>' + esc(it.nome) + '</td>' +
      '<td class="r">' + it.qtd + '</td><td class="r">' + it.qtdEnviada + '</td>' +
      '<td class="r">' + FG.fmtMoney(it.preco) + '</td>' +
      '<td><span class="pill-status ' + st.cls + '">' + esc(st.txt) + '</span></td></tr>';
  }

  // Grupo de peças (cabeçalho + linhas) dentro do detalhe — separa "Em estoque"
  // das peças em "Pré-venda". Retorna '' quando o grupo está vazio.
  function grupoItens(titulo, itens) {
    if (!itens.length) return '';
    return '<tr class="venda-grp"><td colspan="6">' + esc(titulo) + ' (' + itens.length + ')</td></tr>' +
      itens.map(linhaItemVenda).join('');
  }

  // Bloco de detalhe (cliente + data + peças com status, separadas entre
  // "Em estoque" e "Pré-venda") que abre sob o pedido.
  function detalheVenda(o) {
    var pg = o.progresso || { enviada: 0, qtd: 0, pct: 0 };
    var emEstoque = o.itens.filter(function (it) { return !it.backorder; });
    var preVenda = o.itens.filter(function (it) { return it.backorder; });
    return '<div class="venda-det">' +
      '<div class="venda-meta">' +
      '<div><span class="muted">Cliente</span><br><b>' + esc(o.empresa) + '</b><br><span class="muted">' + esc(o.usuario) + '</span></div>' +
      '<div><span class="muted">Data da compra</span><br><b>' + FG.fmtDateTime(o.data) + '</b></div>' +
      '<div><span class="muted">Pedido</span><br><b>' + esc(o.cx) + '</b><br><span class="muted">' + esc(o.id) + '</span></div>' +
      '<div><span class="muted">Envio</span><br><b>' + pg.enviada + '/' + pg.qtd + '</b> peças (' + pg.pct + '%)</div>' +
      '</div>' +
      '<table class="tbl"><thead><tr><th>Artigo</th><th>Peça</th><th class="r">Qtd.</th>' +
      '<th class="r">Enviada</th><th class="r">Preço un.</th><th>Status da peça</th></tr></thead><tbody>' +
      grupoItens('Em estoque', emEstoque) +
      grupoItens('Pré-venda', preVenda) +
      '</tbody></table></div>';
  }

  function renderPedidos() {
    h1.textContent = 'Gestão de pedidos'; setOn('pedidos');
    var orders = FG.all('orders');
    view.innerHTML =
      '<div class="adm-card"><div class="c-head">Pedidos (' + orders.length + ')</div><div class="c-body">' +
      '<table class="tbl"><thead><tr><th>Pedido</th><th>Empresa</th><th>Data</th>' +
      '<th class="r">Total</th><th>Status</th><th></th></tr></thead><tbody>' +
      orders.map(function (o, i) {
        return '<tr><td><b>' + o.cx + '</b><br><span class="muted">' + o.id + '</span></td>' +
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
          '<td><button class="btn-line btn-mini od-open" data-i="' + i + '">Detalhes ▾</button></td></tr>' +
          '<tr class="venda-row hidden" data-i="' + i + '"><td colspan="6">' + detalheVenda(o) + '</td></tr>';
      }).join('') + '</tbody></table></div></div>';

    Array.prototype.forEach.call(view.querySelectorAll('.od-open'), function (b) {
      b.addEventListener('click', function () {
        var row = view.querySelector('.venda-row[data-i="' + b.getAttribute('data-i') + '"]');
        var aberto = row.classList.toggle('hidden') === false;
        b.textContent = aberto ? 'Detalhes ▴' : 'Detalhes ▾';
      });
    });
    Array.prototype.forEach.call(view.querySelectorAll('select.inline-status'), function (sel) {
      sel.addEventListener('change', async function () {
        var res = await FG.setOrderStatus(sel.getAttribute('data-id'), sel.value);
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
  // "Esboço" não existe no admin — é só do cliente (rascunho no navegador).
  var CL_STATUS = ['Em processo', 'Aprovada', 'Recusada'];

  function renderClaims() {
    h1.textContent = 'Gestão de reivindicações'; setOn('reivindicacoes');
    var claims = FG.all('claims');
    // Tabela enxuta (só identificação). Detalhes + ações no modal ao clicar.
    view.innerHTML =
      '<div class="adm-card"><div class="c-head">Reivindicações (' + claims.length + ')</div><div class="c-body">' +
      '<p class="muted" style="font-size:12px;margin:0 0 8px;">Clique numa reivindicação para ver os detalhes e agir.</p>' +
      '<table class="tbl"><thead><tr><th>N° da reivindicação</th><th>Data</th><th>Criador</th><th>Tipo</th><th>Status</th></tr></thead><tbody>' +
      (claims.length ? claims.map(function (c) {
        return '<tr class="adm-claim-row' + (c.reenviada ? ' tr-reenviada' : '') + '" data-id="' + esc(c.id) + '">' +
          '<td><b class="cl-num">' + c.id + '</b></td>' +
          '<td>' + FG.fmtDate(c.data) + '</td>' +
          '<td>' + esc(c.criador) + '</td>' +
          '<td>' + esc(c.tipo) + '</td>' +
          '<td>' + pill(c.status) +
          (c.reenviada ? ' <span class="pill-status Reenviada">↩ Devolvida pelo revendedor</span>' : '') +
          (c.sentBack ? ' <span class="pill-status Devolvida">↩ Devolvida</span>' : '') +
          '</td></tr>';
      }).join('') : '<tr><td colspan="5" class="muted">Nenhuma reivindicação.</td></tr>') +
      '</tbody></table></div></div>';

    Array.prototype.forEach.call(view.querySelectorAll('.adm-claim-row'), function (row) {
      row.addEventListener('click', function () {
        var c = FG.all('claims').find(function (x) { return x.id === row.getAttribute('data-id'); });
        if (c) modalClaimAdmin(c);
      });
    });
  }

  // Modal de detalhe da reivindicação (admin): todas as infos + ações.
  function modalClaimAdmin(c) {
    var CL = ['Em processo', 'Aprovada', 'Recusada'];
    var term = c.status === 'Aprovada' || c.status === 'Recusada';
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

    var acoes = term
      ? '<div class="muted">Status final (' + esc(c.status) + ') — não pode mais mudar.</div>'
      : '<label style="font-size:12px;margin-right:4px;">Definir status:</label>' +
        '<select id="ad-status">' + CL.map(function (s) { return '<option' + (s === c.status ? ' selected' : '') + '>' + s + '</option>'; }).join('') + '</select> ' +
        '<button class="btn-orange btn-mini" id="ad-aplicar">Aplicar</button> ' +
        '<button class="btn-line btn-mini" id="ad-devolver">Devolver ao revendedor</button>';

    var back = document.createElement('div');
    back.className = 'modal-back';
    back.innerHTML =
      '<div class="modal"><header><h3>Reivindicação ' + esc(c.id) + '</h3><button class="x">×</button></header>' +
      '<div class="modal-body">' +
      (c.reenviada ? '<div class="reenviada-aviso">↩ Devolvida pelo revendedor — revisar' + (c.atualizadoEm ? ' (em ' + FG.fmtDateTime(c.atualizadoEm) + ')' : '') + '</div>' : '') +
      (c.sentBack ? '<div class="devolvida-aviso">↩ Devolvida ao revendedor — aguardando. Falta: ' + esc(c.faltaInformacao || '—') + '</div>' : '') +
      (c.status === 'Aprovada' && c.valorGarantia ? '<div class="det-credito">✔ Aprovada — crédito de ' + FG.fmtMoney(c.valorGarantia) + ' descontado da fatura.</div>' : '') +
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
      '<div class="modal-foot" style="flex-wrap:wrap;gap:8px;">' +
      '<div style="margin-right:auto;">' + acoes + '</div>' +
      '<button class="btn-line" id="ad-fechar">Fechar</button></div></div>';
    document.body.appendChild(back);

    function fechar() { back.remove(); }
    back.querySelector('.x').addEventListener('click', fechar);
    document.getElementById('ad-fechar').addEventListener('click', fechar);
    back.addEventListener('click', function (e) { if (e.target === back) fechar(); });

    if (!term) {
      document.getElementById('ad-aplicar').addEventListener('click', async function () {
        var novo = document.getElementById('ad-status').value;
        if (novo === c.status) { FG.toast('Selecione um status diferente.'); return; }
        if ((novo === 'Aprovada' || novo === 'Recusada') &&
          !confirm('Definir como "' + novo + '"? Esse status é FINAL e não poderá ser alterado' +
            (novo === 'Aprovada' ? ' (gera crédito na fatura do cliente)' : '') + '.')) return;
        var r = await FG.setClaimStatus(c.id, novo);
        if (r && r.ok === false) return;
        fechar();
        FG.toast('Status atualizado.');
        renderClaims();
      });
      document.getElementById('ad-devolver').addEventListener('click', function () { fechar(); modalDevolver(c.id); });
    }
  }

  // Modal para devolver ao revendedor com o que falta (obrigatório).
  function modalDevolver(numero) {
    var back = document.createElement('div');
    back.className = 'modal-back';
    back.innerHTML =
      '<div class="modal"><header><h3>Devolver ao revendedor</h3><button class="x">×</button></header>' +
      '<div class="modal-body">' +
      '<p class="muted" style="margin-top:0;">Descreva o que falta para o revendedor completar e reenviar a reivindicação ' + esc(numero) + '.</p>' +
      '<div class="field"><label>Falta de informação *</label>' +
      '<textarea id="dv-falta" rows="4" placeholder="Ex.: fotos da peça pelo lado interno, horímetro atual, nota fiscal..."></textarea></div>' +
      '</div>' +
      '<div class="modal-foot"><button class="btn-line" id="dv-canc">Cancelar</button>' +
      '<button class="btn-orange" id="dv-ok">Devolver</button></div></div>';
    document.body.appendChild(back);
    function fechar() { back.remove(); }
    back.querySelector('.x').addEventListener('click', fechar);
    document.getElementById('dv-canc').addEventListener('click', fechar);
    back.addEventListener('click', function (e) { if (e.target === back) fechar(); });
    document.getElementById('dv-ok').addEventListener('click', async function () {
      var falta = document.getElementById('dv-falta').value.trim();
      if (!falta) { FG.toast('Descreva o que falta antes de devolver.', 'erro'); return; }
      var r = await FG.devolverClaim(numero, falta);
      if (r && r.ok === false) return;
      fechar();
      FG.toast('Reivindicação devolvida ao revendedor.');
      renderClaims();
    });
  }

  /* =========================================================
     PRÉ-VENDA — rastreador de peças a enviar (sem valor; cobrança é a
     fatura do pedido). Agrupado por cliente; cada peça tem ação "Enviado"
     quando o produto volta ao estoque.
     ========================================================= */
  function pvStatusPill(it) {
    if (it.status === 'Disponivel') return '<span class="pill-status Disponivel">Disponível p/ envio</span>';
    // Aguardando: estoque insuficiente para a quantidade pendente. Mostra o
    // estoque atual quando há algo (parcial) para deixar claro o porquê.
    var detalhe = it.estoque > 0
      ? ' · estoque ' + it.estoque + '/' + it.pendente
      : (it.previsao ? ' · ' + esc(it.previsao) : '');
    return '<span class="pill-status Aguardando">Aguardando reposição' + detalhe + '</span>';
  }

  function renderPreVenda() {
    h1.textContent = 'Pré-venda — peças a enviar'; setOn('prevenda');
    var itens = FG.all('prevenda');
    if (!itens.length) {
      view.innerHTML = '<div class="adm-card"><div class="c-body muted">' +
        'Nenhuma peça em pré-venda pendente. Elas aparecem aqui quando um pedido inclui ' +
        'itens sem estoque, e podem ser marcadas como enviadas quando o produto for reposto.</div></div>';
      return;
    }
    var grupos = {};
    itens.forEach(function (it) { (grupos[it.empresa] = grupos[it.empresa] || []).push(it); });

    view.innerHTML =
      '<div class="adm-card"><div class="c-head">Peças a enviar — pré-venda (' + itens.length + ')</div>' +
      '<div class="c-body">' +
      Object.keys(grupos).map(function (emp) {
        var linhas = grupos[emp].map(function (it) {
          var disp = it.status === 'Disponivel';
          var acao = disp
            ? '<button class="btn-orange btn-mini pv-enviar" data-ped="' + esc(it.pedido) + '" data-item="' + it.itemId + '" data-qtd="' + it.qtd + '">Marcar Enviado</button>'
            : '<span class="muted" style="font-size:11px;">' + (it.estoque > 0 ? 'estoque insuficiente (' + it.estoque + '/' + it.pendente + ')' : 'sem estoque') + '</span>';
          return '<tr><td>' + esc(it.artigo) + '</td><td>' + esc(it.nome) + '</td>' +
            '<td class="r">' + it.pendente + '</td>' +
            '<td>' + (it.data ? FG.fmtDate(it.data) : '—') + '</td>' +
            '<td><a href="#pedidos" title="Ver em Vendas">' + esc(it.cx) + '</a>' +
            ' <span class="muted">' + esc(it.pedido) + '</span></td>' +
            '<td>' + pvStatusPill(it) + '</td><td>' + acao + '</td></tr>';
        }).join('');
        return '<div class="venda-det"><div style="font-weight:600;margin:6px 0 2px;">' + esc(emp) + '</div>' +
          '<table class="tbl"><thead><tr><th>Artigo</th><th>Peça</th><th class="r">Qtd.</th>' +
          '<th>Data do pedido</th><th>Pedido de origem</th><th>Status</th><th>Ação</th></tr></thead><tbody>' +
          linhas + '</tbody></table></div>';
      }).join('') + '</div></div>';

    Array.prototype.forEach.call(view.querySelectorAll('.pv-enviar'), function (b) {
      b.addEventListener('click', async function () {
        var r = await FG.setItemEnviado(b.getAttribute('data-ped'), b.getAttribute('data-item'), Number(b.getAttribute('data-qtd')));
        if (r && r.ok === false) FG.toast(r.msg || 'Não foi possível marcar como enviado.', 'erro');
        else FG.toast('Peça marcada como enviada.');
        renderPreVenda();
      });
    });
  }

  /* =========================================================
     PARTS FINDER — modelos, seções, peças e hotspots
     ---------------------------------------------------------
     Três níveis: #finder (modelos) → #finder/modelo/<código>
     (seções por lado) → #finder/secao/<id> (peças da lista +
     editor visual de áreas clicáveis sobre o diagrama).
     ========================================================= */
  var FND_LADOS = [['chassi', 'Frame (chassi)'], ['engine', 'Engine (motor)']];

  function fndErro(r, msg) {
    if (r && r.ok === false) { FG.toast(r.msg || msg || 'Operação não concluída.', 'erro'); return true; }
    return false;
  }
  function fndCrumb(itens) {
    return '<div class="fnd-crumbs">' + itens.map(function (it, i) {
      var ultimo = i === itens.length - 1;
      return ultimo ? '<b>' + esc(it[0]) + '</b>'
        : '<a href="' + it[1] + '">' + esc(it[0]) + '</a> <span>›</span> ';
    }).join('') + '</div>';
  }
  function thumbCell(url, alt) {
    return url
      ? '<img class="fnd-thumb" src="' + esc(url) + '" alt="' + esc(alt || '') + '">'
      : '<span class="fnd-thumb vazio">sem foto</span>';
  }

  /* ---------- nível 1: modelos ---------- */
  function renderFinderModelos() {
    h1.textContent = 'Parts Finder — modelos'; setOn('finder');
    view.innerHTML = '<div class="adm-card"><div class="c-body muted">Carregando…</div></div>';
    FG.finderModelos(true).then(function (modelos) {
      view.innerHTML =
        '<div class="adm-bar"><span class="muted" style="font-size:13px;">Tudo que aparece no finder do cliente é editado aqui: ' +
        'modelos e árvore de seleção, seções (diagramas), peças de cada seção e áreas clicáveis da imagem.</span>' +
        '<span class="grow"></span><button class="btn-orange" id="fm-novo">Novo modelo</button></div>' +
        '<div class="adm-card"><div class="c-head">Modelos (' + modelos.length + ')</div><div class="c-body">' +
        '<table class="tbl"><thead><tr><th>Foto</th><th>Código</th><th>Modelo</th><th>Etiqueta (label)</th>' +
        '<th>Árvore de seleção</th><th>Situação</th><th>Ações</th></tr></thead><tbody>' +
        (modelos.length ? modelos.map(function (m) {
          return '<tr><td>' + thumbCell(m.imagem, m.nome) + '</td>' +
            '<td><span class="muted">' + esc(m.id) + '</span></td>' +
            '<td><b>' + esc(m.nome) + '</b> ' + m.ano + '</td>' +
            '<td>' + esc(m.label) + '</td>' +
            '<td class="fnd-arvore">' + esc((m.arvore || []).join(' > ')) + '</td>' +
            '<td>' + (m.ativo
              ? '<span class="pill-status aprovado">Ativo</span>'
              : '<span class="pill-status bloqueado">Inativo</span>') + '</td>' +
            '<td class="nowrap">' +
            '<a class="btn-line btn-mini" href="#finder/modelo/' + encodeURIComponent(m.id) + '">Seções</a> ' +
            '<button class="btn-line btn-mini" data-ac="edit" data-id="' + esc(m.id) + '">Editar</button> ' +
            '<button class="btn-line btn-mini" data-ac="del" data-id="' + esc(m.id) + '">Excluir</button></td></tr>';
        }).join('') : '<tr><td colspan="7" class="muted">Nenhum modelo. Crie o primeiro.</td></tr>') +
        '</tbody></table></div></div>';

      document.getElementById('fm-novo').addEventListener('click', function () { modalModelo(null); });
      Array.prototype.forEach.call(view.querySelectorAll('[data-ac]'), function (b) {
        b.addEventListener('click', function () {
          var m = modelos.find(function (x) { return x.id === b.getAttribute('data-id'); });
          if (!m) return;
          if (b.getAttribute('data-ac') === 'edit') { modalModelo(m); return; }
          if (!confirm('Excluir o modelo ' + m.label + '?\nSeções, peças e áreas do diagrama serão apagadas juntas.')) return;
          FG.finderExcluirModelo(m.id).then(function (r) {
            if (fndErro(r, 'Falha ao excluir.')) return;
            FG.toast('Modelo excluído.'); renderFinderModelos();
          });
        });
      });
    }, function (e) {
      view.innerHTML = '<div class="adm-card"><div class="c-body">Erro ao carregar: ' + esc(e.message || '') + '</div></div>';
    });
  }

  function modalModelo(m) {
    var novo = !m;
    var back = document.createElement('div');
    back.className = 'modal-back';
    back.innerHTML =
      '<div class="modal"><header><h3>' + (novo ? 'Novo modelo' : 'Editar ' + esc(m.label)) + '</h3><button class="x">×</button></header>' +
      '<div class="modal-body">' +
      '<div class="field"><label>Código (slug — não muda depois) *</label>' +
      '<input id="fm-cod" type="text" placeholder="fg125-2025"' + (novo ? '' : ' disabled') + ' value="' + (m ? esc(m.id) : '') + '"></div>' +
      '<div class="fnd-2col">' +
      '<div class="field"><label>Nome *</label><input id="fm-nome" type="text" placeholder="FG 125" value="' + (m ? esc(m.nome) : '') + '"></div>' +
      '<div class="field"><label>Ano *</label><input id="fm-ano" type="number" min="1990" max="2100" value="' + (m ? m.ano : new Date().getFullYear()) + '"></div>' +
      '</div>' +
      '<div class="field"><label>Etiqueta (label mostrado no finder)</label>' +
      '<input id="fm-label" type="text" placeholder="FG 125 2025 &lt;2025&gt;&lt;BR&gt;&lt;F0103Y1&gt;" value="' + (m ? esc(m.label) : '') + '"></div>' +
      '<div class="field"><label>Árvore de seleção (níveis separados por &gt;)</label>' +
      '<input id="fm-arv" type="text" placeholder="Fullgas > Offroad > Enduro > E1 > 2 tempos > FG 125 > FG 125 2025" value="' + (m ? esc((m.arvore || []).join(' > ')) : '') + '"></div>' +
      '<div class="fnd-2col">' +
      '<div class="field"><label>Cilindrada</label><input id="fm-cil" type="text" placeholder="125" value="' + (m && m.cilindrada ? esc(m.cilindrada) : '') + '"></div>' +
      '<div class="field"><label>Tipo de motor</label><input id="fm-tm" type="text" placeholder="2 tempos" value="' + (m && m.tipoMotor ? esc(m.tipoMotor) : '') + '"></div>' +
      '</div>' +
      '<div class="fnd-2col">' +
      '<div class="field"><label>Categoria</label><input id="fm-cat" type="text" placeholder="Enduro" value="' + (m && m.categoria ? esc(m.categoria) : '') + '"></div>' +
      '<div class="field"><label>Situação</label><select id="fm-ativo">' +
      '<option value="1"' + (!m || m.ativo ? ' selected' : '') + '>Ativo (aparece no finder)</option>' +
      '<option value="0"' + (m && !m.ativo ? ' selected' : '') + '>Inativo (oculto)</option></select></div>' +
      '</div>' +
      '<div class="field"><label>Documentação técnica (link http)</label>' +
      '<input id="fm-doc" type="url" placeholder="https://..." value="' + (m && m.docTecnica ? esc(m.docTecnica) : '') + '"></div>' +
      '<div class="field"><label>Foto do modelo (botão "Show Image" do finder)</label>' +
      '<div class="fnd-foto-row">' + thumbCell(m && m.imagem, 'foto') +
      '<input id="fm-foto" type="file" accept="image/*">' +
      (m && m.imagem ? '<button class="btn-line btn-mini" id="fm-foto-del" type="button">Remover foto</button>' : '') +
      '</div></div>' +
      '</div>' +
      '<div class="modal-foot"><button class="btn-line" id="fm-canc">Cancelar</button>' +
      '<button class="btn-orange" id="fm-ok">Salvar</button></div></div>';
    document.body.appendChild(back);

    function fechar() { back.remove(); }
    back.querySelector('.x').addEventListener('click', fechar);
    document.getElementById('fm-canc').addEventListener('click', fechar);
    back.addEventListener('click', function (e) { if (e.target === back) fechar(); });

    var btnDel = document.getElementById('fm-foto-del');
    if (btnDel) btnDel.addEventListener('click', function () {
      FG.finderRemoverImagemModelo(m.id).then(function (r) {
        if (fndErro(r, 'Falha ao remover a foto.')) return;
        FG.toast('Foto removida.'); fechar(); renderFinderModelos();
      });
    });

    document.getElementById('fm-ok').addEventListener('click', function () {
      var dados = {
        codigo: document.getElementById('fm-cod').value.trim().toLowerCase(),
        nome: document.getElementById('fm-nome').value.trim(),
        ano: Number(document.getElementById('fm-ano').value),
        label: document.getElementById('fm-label').value.trim(),
        arvore: document.getElementById('fm-arv').value.trim(),
        cilindrada: document.getElementById('fm-cil').value.trim(),
        tipoMotor: document.getElementById('fm-tm').value.trim(),
        categoria: document.getElementById('fm-cat').value.trim(),
        docTecnica: document.getElementById('fm-doc').value.trim(),
        ativo: document.getElementById('fm-ativo').value === '1'
      };
      if (!dados.nome || !dados.ano || (novo && !dados.codigo)) { FG.toast('Preencha código, nome e ano.'); return; }
      var salvar = novo ? FG.finderCriarModelo(dados) : FG.finderEditarModelo(m.id, dados);
      salvar.then(function (r) {
        if (fndErro(r, 'Falha ao salvar o modelo.')) return;
        var codigo = novo ? dados.codigo : m.id;
        var arquivo = document.getElementById('fm-foto').files[0];
        var fotoOk = arquivo
          ? FG.finderUploadImagemModelo(codigo, arquivo)
          : Promise.resolve({ ok: true });
        fotoOk.then(function (rf) {
          if (rf.ok === false) FG.toast('Modelo salvo, mas a foto falhou: ' + (rf.msg || ''), 'erro');
          else FG.toast(novo ? 'Modelo criado.' : 'Modelo salvo.');
          fechar(); renderFinderModelos();
        });
      });
    });
  }

  /* ---------- nível 2: seções (diagramas) de um modelo ---------- */
  function renderFinderModelo(codigo, ladoAtivo) {
    setOn('finder');
    view.innerHTML = '<div class="adm-card"><div class="c-body muted">Carregando…</div></div>';
    FG.finderModelo(codigo).then(function (m) {
      h1.textContent = 'Parts Finder — ' + m.label;
      var lado = ladoAtivo === 'engine' ? 'engine' : 'chassi';
      var secoes = m[lado] || [];

      view.innerHTML =
        fndCrumb([['Modelos', '#finder'], [m.label]]) +
        '<div class="adm-bar">' +
        '<div class="fnd-tabs">' + FND_LADOS.map(function (l) {
          return '<button class="' + (l[0] === lado ? 'on' : '') + '" data-lado="' + l[0] + '">' + l[1] +
            ' (' + ((m[l[0]] || []).length) + ')</button>';
        }).join('') + '</div>' +
        '<span class="grow"></span>' +
        '<a class="btn-line" href="finder.html#/modelo/' + encodeURIComponent(m.id) + '/' + lado + '" target="_blank" rel="noopener">Ver no finder ↗</a> ' +
        '<button class="btn-orange" id="fs-nova">Nova seção</button></div>' +
        '<div class="adm-card"><div class="c-head">Seções — ' + (lado === 'engine' ? 'Engine (motor)' : 'Frame (chassi)') + '</div><div class="c-body">' +
        '<table class="tbl"><thead><tr><th>Diagrama</th><th>Nº</th><th>Nome</th><th class="r">Peças</th>' +
        '<th>Posição</th><th>Ações</th></tr></thead><tbody>' +
        (secoes.length ? secoes.map(function (s, i) {
          return '<tr><td>' + thumbCell(s.imagem, s.nome) + '</td>' +
            '<td>' + esc(s.numero) + '</td><td><b>' + esc(s.nome) + '</b></td>' +
            '<td class="r">' + (s.qtdPecas || 0) + '</td>' +
            '<td class="nowrap"><button class="btn-line btn-mini" data-mv="-1" data-i="' + i + '"' + (i === 0 ? ' disabled' : '') + '>▲</button> ' +
            '<button class="btn-line btn-mini" data-mv="1" data-i="' + i + '"' + (i === secoes.length - 1 ? ' disabled' : '') + '>▼</button></td>' +
            '<td class="nowrap"><a class="btn-orange btn-mini" href="#finder/secao/' + s.id + '">Peças e imagem</a> ' +
            '<button class="btn-line btn-mini" data-ed="' + s.id + '">Editar</button> ' +
            '<button class="btn-line btn-mini" data-del="' + s.id + '">Excluir</button></td></tr>';
        }).join('') : '<tr><td colspan="6" class="muted">Nenhuma seção neste lado ainda.</td></tr>') +
        '</tbody></table></div></div>';

      Array.prototype.forEach.call(view.querySelectorAll('.fnd-tabs button'), function (b) {
        b.addEventListener('click', function () { renderFinderModelo(codigo, b.getAttribute('data-lado')); });
      });
      document.getElementById('fs-nova').addEventListener('click', function () { modalSecao(m, lado); });

      Array.prototype.forEach.call(view.querySelectorAll('[data-mv]'), function (b) {
        b.addEventListener('click', function () {
          var i = Number(b.getAttribute('data-i'));
          var j = i + Number(b.getAttribute('data-mv'));
          if (j < 0 || j >= secoes.length) return;
          var ids = secoes.map(function (s) { return s.id; });
          var t = ids[i]; ids[i] = ids[j]; ids[j] = t;
          FG.finderOrdemSecoes(m.id, lado, ids).then(function (r) {
            if (fndErro(r, 'Falha ao reordenar.')) return;
            renderFinderModelo(codigo, lado);
          });
        });
      });
      Array.prototype.forEach.call(view.querySelectorAll('[data-ed]'), function (b) {
        b.addEventListener('click', function () {
          var s = secoes.find(function (x) { return String(x.id) === b.getAttribute('data-ed'); });
          if (s) modalSecao(m, lado, s);
        });
      });
      Array.prototype.forEach.call(view.querySelectorAll('[data-del]'), function (b) {
        b.addEventListener('click', function () {
          var s = secoes.find(function (x) { return String(x.id) === b.getAttribute('data-del'); });
          if (!s) return;
          if (!confirm('Excluir a seção "' + s.numero + ' ' + s.nome + '"?\nAs peças e áreas do diagrama vão junto.')) return;
          FG.finderExcluirSecao(s.id).then(function (r) {
            if (fndErro(r, 'Falha ao excluir.')) return;
            FG.toast('Seção excluída.'); renderFinderModelo(codigo, lado);
          });
        });
      });
    }, function () {
      view.innerHTML = '<div class="adm-card"><div class="c-body">Modelo não encontrado. <a href="#finder">Voltar</a></div></div>';
    });
  }

  function modalSecao(m, lado, s) {
    var novo = !s;
    var back = document.createElement('div');
    back.className = 'modal-back';
    back.innerHTML =
      '<div class="modal"><header><h3>' + (novo ? 'Nova seção — ' + esc(m.label) : 'Editar seção') + '</h3><button class="x">×</button></header>' +
      '<div class="modal-body">' +
      '<div class="field"><label>Lado</label><select id="se-lado"' + (novo ? '' : ' disabled') + '>' +
      FND_LADOS.map(function (l) {
        return '<option value="' + l[0] + '"' + (l[0] === lado ? ' selected' : '') + '>' + l[1] + '</option>';
      }).join('') + '</select></div>' +
      '<div class="fnd-2col">' +
      '<div class="field"><label>Número (ex.: 01) *</label><input id="se-num" type="text" maxlength="8" value="' + (s ? esc(s.numero) : '') + '"></div>' +
      '<div class="field"><label>Nome *</label><input id="se-nome" type="text" placeholder="FRONT FORK, TRIPLE CLAMP" value="' + (s ? esc(s.nome) : '') + '"></div>' +
      '</div>' +
      '<p class="muted" style="font-size:12px;">A imagem do diagrama e as peças são editadas em "Peças e imagem" depois de criar a seção.</p>' +
      '</div>' +
      '<div class="modal-foot"><button class="btn-line" id="se-canc">Cancelar</button>' +
      '<button class="btn-orange" id="se-ok">Salvar</button></div></div>';
    document.body.appendChild(back);

    function fechar() { back.remove(); }
    back.querySelector('.x').addEventListener('click', fechar);
    document.getElementById('se-canc').addEventListener('click', fechar);
    back.addEventListener('click', function (e) { if (e.target === back) fechar(); });

    document.getElementById('se-ok').addEventListener('click', function () {
      var dados = {
        lado: document.getElementById('se-lado').value,
        numero: document.getElementById('se-num').value.trim(),
        nome: document.getElementById('se-nome').value.trim()
      };
      if (!dados.numero || !dados.nome) { FG.toast('Preencha número e nome.'); return; }
      var salvar = novo ? FG.finderCriarSecao(m.id, dados)
        : FG.finderEditarSecao(s.id, { numero: dados.numero, nome: dados.nome });
      salvar.then(function (r) {
        if (fndErro(r, 'Falha ao salvar a seção.')) return;
        FG.toast(novo ? 'Seção criada.' : 'Seção salva.');
        fechar(); renderFinderModelo(m.id, dados.lado);
      });
    });
  }

  /* ---------- nível 3: peças da seção + editor de hotspots ---------- */
  function renderFinderSecao(secaoId) {
    setOn('finder');
    view.innerHTML = '<div class="adm-card"><div class="c-body muted">Carregando…</div></div>';
    FG.finderSecao(secaoId).then(function (sec) {
      h1.textContent = 'Parts Finder — ' + sec.numero + ' ' + sec.nome;

      view.innerHTML =
        fndCrumb([['Modelos', '#finder'],
          [sec.modelo.label, '#finder/modelo/' + encodeURIComponent(sec.modelo.id)],
          [sec.numero + ' ' + sec.nome]]) +
        '<div class="adm-bar"><span class="muted" style="font-size:13px;">Lado: <b>' +
        (sec.lado === 'engine' ? 'Engine (motor)' : 'Frame (chassi)') + '</b></span><span class="grow"></span>' +
        '<a class="btn-line" href="finder.html#/secao/' + sec.id + '" target="_blank" rel="noopener">Ver no finder ↗</a></div>' +

        /* ---- peças da lista ---- */
        '<div class="adm-card"><div class="c-head">Peças desta seção (' + sec.pecas.length + ')</div><div class="c-body">' +
        '<div class="fnd-add-row"><input id="fp-sku" list="fp-skus" type="text" placeholder="Código do artigo (SKU) — ex.: A46001094000FB">' +
        '<datalist id="fp-skus">' + FG.all('products').map(function (p) {
          return '<option value="' + esc(p.artigo) + '">' + esc(p.nome) + '</option>';
        }).join('') + '</datalist>' +
        '<button class="btn-orange btn-mini" id="fp-add">Adicionar peça</button>' +
        '<span class="muted" style="font-size:12px;">A peça precisa existir no Catálogo. A miniatura vem da foto do produto.</span></div>' +
        '<table class="tbl fnd-itens"><thead><tr><th>ID</th><th>Miniatura</th><th>Nome</th><th>Situação</th><th>Cód.</th>' +
        '<th class="r">Preço</th><th>Qtd. padrão</th><th>Number on Image</th><th>Qtd. no conjunto</th><th>Posição</th><th>Ações</th></tr></thead>' +
        '<tbody id="fp-tbody"></tbody></table>' +
        '</div></div>' +

        /* ---- diagrama + hotspots ---- */
        '<div class="adm-card"><div class="c-head">Imagem do diagrama e áreas clicáveis</div><div class="c-body">' +
        '<div class="fnd-add-row">' +
        '<input id="hi-file" type="file" accept="image/*">' +
        '<button class="btn-line btn-mini" id="hi-up">' + (sec.imagem ? 'Trocar imagem' : 'Enviar imagem') + '</button>' +
        (sec.imagem ? '<button class="btn-line btn-mini" id="hi-del">Remover imagem</button>' : '') +
        '<span class="grow"></span>' +
        (sec.imagem ? '<button class="btn-orange" id="ha-save">Salvar áreas clicáveis</button>' : '') +
        '</div>' +
        (sec.imagem
          ? '<p class="muted" style="font-size:12px;margin:8px 0;">Clique na imagem para criar uma área; arraste para posicionar. ' +
            'O <b>Link Number</b> deve casar com o "Number on Image" das peças — clicar na área seleciona essas peças no finder do cliente.</p>' +
            '<div class="ha-wrap"><div class="ha-canvas" id="ha-canvas"><img id="ha-img" src="' + esc(sec.imagem) + '" alt="diagrama" draggable="false"></div></div>' +
            '<div class="ha-list-head"><span></span><span>Clickable Area (px)</span><span>Texto (opcional)</span><span>Link Number</span><span></span></div>' +
            '<div id="ha-list"></div>'
          : '<p class="muted">Envie a imagem do diagrama explodido para poder marcar as áreas clicáveis.</p>') +
        '</div></div>';

      /* ----- tabela de peças (linhas com edição inline) ----- */
      var tbody = document.getElementById('fp-tbody');
      function linhasPecas() {
        tbody.innerHTML = sec.pecas.length ? sec.pecas.map(function (p, i) {
          return '<tr data-id="' + p.id + '">' +
            '<td class="muted">' + p.id + '</td>' +
            '<td>' + thumbCell(p.imagem, p.nome) + '</td>' +
            '<td><b>' + esc(p.nome) + '</b></td>' +
            '<td><label class="fnd-hab"><input type="checkbox" class="fi-at"' + (p.ativo ? ' checked' : '') + '> Habilitar</label></td>' +
            '<td>' + esc(p.sku) + '</td>' +
            '<td class="r">' + FG.fmtMoney(p.preco) + '</td>' +
            '<td><input class="fi-qp fnd-in" type="number" min="0" value="' + p.quantidadePadrao + '"></td>' +
            '<td><input class="fi-num fnd-in" type="text" maxlength="12" value="' + esc(p.numeroImagem) + '"></td>' +
            '<td><input class="fi-qtd fnd-in" type="number" min="1" value="' + p.quantidade + '"></td>' +
            '<td class="nowrap"><button class="btn-line btn-mini" data-mv="-1" data-i="' + i + '"' + (i === 0 ? ' disabled' : '') + '>▲</button> ' +
            '<button class="btn-line btn-mini" data-mv="1" data-i="' + i + '"' + (i === sec.pecas.length - 1 ? ' disabled' : '') + '>▼</button></td>' +
            '<td><button class="link-action" data-rm="' + p.id + '">Remover</button></td></tr>';
        }).join('') : '<tr><td colspan="11" class="muted">Nenhuma peça nesta seção. Adicione pela busca acima.</td></tr>';

        Array.prototype.forEach.call(tbody.querySelectorAll('tr[data-id]'), function (tr) {
          var pecaId = Number(tr.getAttribute('data-id'));
          ['change'].forEach(function (evt) {
            Array.prototype.forEach.call(tr.querySelectorAll('.fi-at,.fi-qp,.fi-num,.fi-qtd'), function (inp) {
              inp.addEventListener(evt, function () {
                FG.finderEditarPeca(pecaId, {
                  ativo: tr.querySelector('.fi-at').checked,
                  quantidadePadrao: Number(tr.querySelector('.fi-qp').value) || 0,
                  numeroImagem: tr.querySelector('.fi-num').value.trim(),
                  quantidade: Math.max(1, Number(tr.querySelector('.fi-qtd').value) || 1)
                }).then(function (r) {
                  if (fndErro(r, 'Falha ao salvar a peça.')) return;
                  var p = sec.pecas.find(function (x) { return x.id === pecaId; });
                  if (p) {
                    p.ativo = tr.querySelector('.fi-at').checked;
                    p.quantidadePadrao = Number(tr.querySelector('.fi-qp').value) || 0;
                    p.numeroImagem = tr.querySelector('.fi-num').value.trim();
                    p.quantidade = Math.max(1, Number(tr.querySelector('.fi-qtd').value) || 1);
                  }
                  FG.toast('Peça atualizada.');
                });
              });
            });
          });
        });
        Array.prototype.forEach.call(tbody.querySelectorAll('[data-mv]'), function (b) {
          b.addEventListener('click', function () {
            var i = Number(b.getAttribute('data-i'));
            var j = i + Number(b.getAttribute('data-mv'));
            if (j < 0 || j >= sec.pecas.length) return;
            var t = sec.pecas[i]; sec.pecas[i] = sec.pecas[j]; sec.pecas[j] = t;
            FG.finderOrdemPecas(sec.id, sec.pecas.map(function (p) { return p.id; })).then(function (r) {
              if (fndErro(r, 'Falha ao reordenar.')) return;
              linhasPecas();
            });
          });
        });
        Array.prototype.forEach.call(tbody.querySelectorAll('[data-rm]'), function (b) {
          b.addEventListener('click', function () {
            var pecaId = Number(b.getAttribute('data-rm'));
            var p = sec.pecas.find(function (x) { return x.id === pecaId; });
            if (!confirm('Remover ' + (p ? p.sku : 'a peça') + ' desta seção?')) return;
            FG.finderExcluirPeca(pecaId).then(function (r) {
              if (fndErro(r, 'Falha ao remover.')) return;
              sec.pecas = sec.pecas.filter(function (x) { return x.id !== pecaId; });
              FG.toast('Peça removida.'); linhasPecas();
            });
          });
        });
      }
      linhasPecas();

      document.getElementById('fp-add').addEventListener('click', function () {
        var sku = document.getElementById('fp-sku').value.trim().toUpperCase();
        if (!sku) { FG.toast('Informe o SKU da peça.'); return; }
        FG.finderAddPeca(sec.id, { sku: sku }).then(function (r) {
          if (fndErro(r, 'Falha ao adicionar (o SKU existe no catálogo?).')) return;
          FG.toast('Peça adicionada.');
          renderFinderSecao(secaoId); // recarrega com a nova linha
        });
      });

      /* ----- upload / remoção da imagem do diagrama ----- */
      document.getElementById('hi-up').addEventListener('click', function () {
        var f = document.getElementById('hi-file').files[0];
        if (!f) { FG.toast('Escolha o arquivo de imagem primeiro.'); return; }
        FG.finderUploadImagemSecao(sec.id, f).then(function (r) {
          if (fndErro(r, 'Falha no upload.')) return;
          FG.toast('Imagem do diagrama salva.');
          renderFinderSecao(secaoId);
        });
      });
      var hiDel = document.getElementById('hi-del');
      if (hiDel) hiDel.addEventListener('click', function () {
        if (!confirm('Remover a imagem do diagrama? As áreas clicáveis continuam salvas.')) return;
        FG.finderRemoverImagemSecao(sec.id).then(function (r) {
          if (fndErro(r, 'Falha ao remover.')) return;
          FG.toast('Imagem removida.'); renderFinderSecao(secaoId);
        });
      });

      /* ----- editor visual de hotspots ----- */
      if (!sec.imagem) return;
      var canvas = document.getElementById('ha-canvas');
      var img = document.getElementById('ha-img');
      var lista = document.getElementById('ha-list');
      var natW = 0, natH = 0;
      var hs = sec.hotspots.map(function (h) {
        return { x: h.x, y: h.y, w: h.w, h: h.h, texto: h.texto || '', linkNumero: h.linkNumero || '' };
      });

      function escala() { return natW / (img.clientWidth || 1); }

      function boxHTML(h, i) {
        var b = document.createElement('div');
        b.className = 'ha-box';
        b.setAttribute('data-i', i);
        b.style.left = (h.x / natW * 100) + '%';
        b.style.top = (h.y / natH * 100) + '%';
        b.style.width = (h.w / natW * 100) + '%';
        b.style.height = (h.h / natH * 100) + '%';
        b.innerHTML = '<span>' + esc(h.linkNumero || (i + 1)) + '</span>';
        return b;
      }

      function desenharBoxes() {
        Array.prototype.forEach.call(canvas.querySelectorAll('.ha-box'), function (el) { el.remove(); });
        hs.forEach(function (h, i) { canvas.appendChild(boxHTML(h, i)); });
      }

      function desenharLista() {
        lista.innerHTML = hs.map(function (h, i) {
          return '<div class="ha-row" data-i="' + i + '"><span class="muted">' + i + '</span>' +
            '<span class="ha-size"><input class="hw" type="number" min="8" value="' + h.w + '"> × ' +
            '<input class="hh" type="number" min="8" value="' + h.h + '"></span>' +
            '<input class="ht" type="text" maxlength="200" placeholder="texto ao passar o mouse" value="' + esc(h.texto) + '">' +
            '<input class="hl" type="text" maxlength="12" placeholder="nº" value="' + esc(h.linkNumero) + '">' +
            '<button class="ha-x" title="Remover área">X</button></div>';
        }).join('') || '<p class="muted" style="font-size:12px;">Nenhuma área ainda — clique na imagem para criar.</p>';

        Array.prototype.forEach.call(lista.querySelectorAll('.ha-row'), function (row) {
          var i = Number(row.getAttribute('data-i'));
          row.querySelector('.hw').addEventListener('change', function (e) { hs[i].w = Math.max(8, Number(e.target.value) || 32); desenharBoxes(); });
          row.querySelector('.hh').addEventListener('change', function (e) { hs[i].h = Math.max(8, Number(e.target.value) || 32); desenharBoxes(); });
          row.querySelector('.ht').addEventListener('input', function (e) { hs[i].texto = e.target.value; });
          row.querySelector('.hl').addEventListener('input', function (e) { hs[i].linkNumero = e.target.value.trim(); desenharBoxes(); });
          row.querySelector('.ha-x').addEventListener('click', function () {
            hs.splice(i, 1); desenharBoxes(); desenharLista();
          });
          row.addEventListener('mouseenter', function () {
            var b = canvas.querySelector('.ha-box[data-i="' + i + '"]');
            if (b) b.classList.add('sel');
          });
          row.addEventListener('mouseleave', function () {
            var b = canvas.querySelector('.ha-box[data-i="' + i + '"]');
            if (b) b.classList.remove('sel');
          });
        });
      }

      /* clique no vazio cria área; arrastar uma caixa move */
      var drag = null;
      canvas.addEventListener('pointerdown', function (e) {
        var box = e.target.closest('.ha-box');
        if (!box) return;
        e.preventDefault();
        var i = Number(box.getAttribute('data-i'));
        drag = { i: i, px: e.clientX, py: e.clientY, x0: hs[i].x, y0: hs[i].y, moveu: false, box: box };
        box.setPointerCapture && box.setPointerCapture(e.pointerId);
      });
      document.addEventListener('pointermove', function (e) {
        if (!drag) return;
        var k = escala();
        var nx = Math.round(drag.x0 + (e.clientX - drag.px) * k);
        var ny = Math.round(drag.y0 + (e.clientY - drag.py) * k);
        var h = hs[drag.i];
        h.x = Math.max(0, Math.min(natW - h.w, nx));
        h.y = Math.max(0, Math.min(natH - h.h, ny));
        if (Math.abs(e.clientX - drag.px) + Math.abs(e.clientY - drag.py) > 3) drag.moveu = true;
        drag.box.style.left = (h.x / natW * 100) + '%';
        drag.box.style.top = (h.y / natH * 100) + '%';
      });
      document.addEventListener('pointerup', function () { drag = null; });

      canvas.addEventListener('click', function (e) {
        if (e.target.closest('.ha-box')) return;   // clique numa caixa não cria outra
        if (!natW) return;
        var r = canvas.getBoundingClientRect();
        var k = escala();
        var cx = Math.round((e.clientX - r.left) * k);
        var cy = Math.round((e.clientY - r.top) * k);
        var nova = { x: Math.max(0, cx - 16), y: Math.max(0, cy - 16), w: 32, h: 32, texto: '', linkNumero: '' };
        hs.push(nova);
        desenharBoxes(); desenharLista();
        var ultima = lista.querySelector('.ha-row[data-i="' + (hs.length - 1) + '"] .hl');
        if (ultima) ultima.focus();
      });

      document.getElementById('ha-save').addEventListener('click', function () {
        FG.finderSalvarHotspots(sec.id, hs).then(function (r) {
          if (fndErro(r, 'Falha ao salvar as áreas.')) return;
          FG.toast('Áreas clicáveis salvas.');
        });
      });

      function prontoImg() {
        natW = img.naturalWidth || 1; natH = img.naturalHeight || 1;
        desenharBoxes(); desenharLista();
      }
      if (img.complete && img.naturalWidth) prontoImg();
      else img.addEventListener('load', prontoImg);
    }, function () {
      view.innerHTML = '<div class="adm-card"><div class="c-body">Seção não encontrada. <a href="#finder">Voltar</a></div></div>';
    });
  }

  /* =========================================================
     TINY ERP — importação, sincronização em lote e log
     ---------------------------------------------------------
     O Tiny é a fonte de verdade dos produtos importados dele.
     Aqui o admin: (1) importa produtos do Tiny para o catálogo,
     (2) força a sincronização em lote dos já importados e
     (3) confere o log (webhook / importação / lote).
     ========================================================= */
  var TINY_LOTE = 20; // blocos por requisição — o Tiny limita o ritmo da API

  function tinyPillLocal(st) {
    if (st === 'importado') return '<span class="pill-status aprovado">Já importado</span>';
    if (st === 'sku-existe') return '<span class="pill-status Aguardando">SKU existe — vincula</span>';
    return '<span class="pill-status Pendente">Novo</span>';
  }
  function tinyPillLog(st) {
    var cls = st === 'ok' ? 'aprovado' : st === 'erro' ? 'bloqueado' : 'Aguardando';
    return '<span class="pill-status ' + cls + '">' + esc(st) + '</span>';
  }

  function renderTiny() {
    h1.textContent = 'Integração Tiny ERP'; setOn('tiny');
    view.innerHTML =
      '<div class="adm-bar"><span class="muted" style="font-size:13px;">O Tiny é a fonte de verdade: estoque, preço, nome, ' +
      'descrição e foto dos produtos importados são sempre espelho do ERP — pelo webhook (automático) ou pela sincronização em lote abaixo.</span></div>' +

      '<div class="adm-card"><div class="c-head">Produtos no Tiny — importação</div><div class="c-body">' +
      '<div class="fnd-add-row">' +
      '<input id="ty-busca" type="text" placeholder="Pesquisar por nome ou código no Tiny">' +
      '<button class="btn-line btn-mini" id="ty-buscar">Buscar</button>' +
      '<span class="grow"></span>' +
      '<label style="font-size:12px;">Categoria p/ novos: <select id="ty-cat">' +
      FG.all('categories').map(function (c) { return '<option value="' + c.id + '">' + esc(c.nome) + '</option>'; }).join('') +
      '</select></label>' +
      '<button class="btn-orange btn-mini" id="ty-importar">Importar selecionados</button>' +
      '</div><div id="ty-imp" class="muted">Carregando…</div></div></div>' +

      '<div class="adm-card"><div class="c-head">Produtos sincronizados com o Tiny</div><div class="c-body" id="ty-sync"></div></div>' +

      '<div class="adm-card"><div class="c-head">Log de sincronização</div><div class="c-body">' +
      '<div class="fnd-add-row"><span class="muted" style="font-size:12px;">Últimos 100 registros (webhook, importação e lote).</span>' +
      '<span class="grow"></span><button class="btn-line btn-mini" id="ty-log-rl">Atualizar</button></div>' +
      '<div id="ty-log" class="muted">Carregando…</div></div></div>';

    /* ----- importação (lista paginada do Tiny) ----- */
    function carregarImportacao(pagina) {
      var box = document.getElementById('ty-imp');
      box.innerHTML = '<p class="muted">Consultando o Tiny…</p>';
      FG.tinyProdutos(pagina, document.getElementById('ty-busca').value.trim()).then(function (r) {
        box.innerHTML =
          '<table class="tbl"><thead><tr>' +
          '<th><input type="checkbox" id="ty-todos" title="Selecionar todos"></th>' +
          '<th>ID Tiny</th><th>SKU</th><th>Nome</th><th class="r">Preço</th><th>Situação no Fullgas</th></tr></thead><tbody>' +
          (r.produtos.length ? r.produtos.map(function (p) {
            var pode = p.statusLocal !== 'importado';
            return '<tr><td>' + (pode ? '<input type="checkbox" class="ty-sel" value="' + esc(p.tinyId) + '">' : '') + '</td>' +
              '<td class="muted">' + esc(p.tinyId) + '</td><td>' + esc(p.sku || '—') + '</td><td>' + esc(p.nome) + '</td>' +
              '<td class="r">' + FG.fmtMoney(p.preco) + '</td><td>' + tinyPillLocal(p.statusLocal) + '</td></tr>';
          }).join('') : '<tr><td colspan="6" class="muted">Nada encontrado no Tiny.</td></tr>') +
          '</tbody></table>' +
          '<div class="fnd-add-row" style="margin-top:8px;">' +
          '<button class="btn-line btn-mini" id="ty-ant"' + (r.pagina <= 1 ? ' disabled' : '') + '>« Anterior</button>' +
          '<span class="muted" style="font-size:12px;">Página ' + r.pagina + ' de ' + (r.totalPaginas || 1) + '</span>' +
          '<button class="btn-line btn-mini" id="ty-prox"' + (r.pagina >= r.totalPaginas ? ' disabled' : '') + '>Próxima »</button></div>';

        var todos = document.getElementById('ty-todos');
        if (todos) todos.addEventListener('change', function () {
          Array.prototype.forEach.call(box.querySelectorAll('.ty-sel'), function (c) { c.checked = todos.checked; });
        });
        document.getElementById('ty-ant').addEventListener('click', function () { carregarImportacao(r.pagina - 1); });
        document.getElementById('ty-prox').addEventListener('click', function () { carregarImportacao(r.pagina + 1); });
      }, function (e) {
        box.innerHTML = '<p class="muted">Erro ao consultar o Tiny: ' + esc((e && e.message) || '') + '</p>';
      });
    }

    document.getElementById('ty-buscar').addEventListener('click', function () { carregarImportacao(1); });
    document.getElementById('ty-busca').addEventListener('keydown', function (e) { if (e.key === 'Enter') carregarImportacao(1); });

    document.getElementById('ty-importar').addEventListener('click', function () {
      var ids = Array.prototype.map.call(view.querySelectorAll('#ty-imp .ty-sel:checked'), function (c) { return c.value; });
      if (!ids.length) { FG.toast('Selecione ao menos um produto do Tiny.'); return; }
      var btn = document.getElementById('ty-importar');
      btn.disabled = true; btn.textContent = 'Importando…';
      FG.tinyImportar(ids, document.getElementById('ty-cat').value).then(function (r) {
        btn.disabled = false; btn.textContent = 'Importar selecionados';
        if (r.ok === false) { FG.toast(r.msg || 'Falha na importação.', 'erro'); return; }
        FG.toast(r.sucesso + ' importado(s)' + (r.erros ? ', ' + r.erros + ' com erro (ver log)' : '') +
          (r.ignorados ? ', ' + r.ignorados + ' já importado(s)' : '') + '.', r.erros ? 'erro' : undefined);
        carregarImportacao(1); desenharSync(); carregarLog();
      });
    });

    /* ----- sincronizados (produtos locais com TinyAtivo) ----- */
    function desenharSync() {
      var el = document.getElementById('ty-sync');
      var prods = FG.all('products').filter(function (p) { return p.tinyAtivo; });
      if (!prods.length) {
        el.innerHTML = '<p class="muted">Nenhum produto importado do Tiny ainda. Importe pela lista acima.</p>';
        return;
      }
      el.innerHTML =
        '<div class="fnd-add-row">' +
        '<button class="btn-orange btn-mini" id="ty-sync-sel">Sincronizar selecionados</button>' +
        '<button class="btn-line btn-mini" id="ty-sync-all">Sincronizar todos (' + prods.length + ')</button>' +
        '<span class="muted" style="font-size:12px;" id="ty-sync-msg"></span></div>' +
        '<table class="tbl"><thead><tr>' +
        '<th><input type="checkbox" id="ty-sync-todos" title="Selecionar todos"></th>' +
        '<th>SKU</th><th>Nome</th><th class="r">Preço</th><th class="r">Estoque</th><th>Última sincronização</th></tr></thead><tbody>' +
        prods.map(function (p) {
          return '<tr><td><input type="checkbox" class="ty-sync-sel" value="' + esc(p.artigo) + '"></td>' +
            '<td>' + esc(p.artigo) + '</td><td>' + esc(p.nome) + '</td>' +
            '<td class="r">' + FG.fmtMoney(p.preco) + '</td><td class="r">' + p.estoque + '</td>' +
            '<td>' + (p.tinySincronizadoEm ? FG.fmtDateTime(p.tinySincronizadoEm) : '—') + '</td></tr>';
        }).join('') + '</tbody></table>';

      var todos = document.getElementById('ty-sync-todos');
      todos.addEventListener('change', function () {
        Array.prototype.forEach.call(el.querySelectorAll('.ty-sync-sel'), function (c) { c.checked = todos.checked; });
      });

      // Envia em blocos (a API consulta o Tiny produto a produto, e o Tiny
      // limita o ritmo — um catálogo grande leva alguns minutos).
      function sincronizar(skus) {
        var fila = skus.slice();
        var soma = { total: 0, sucesso: 0, erros: 0, ignorados: 0 };
        var msg = document.getElementById('ty-sync-msg');
        var btns = [document.getElementById('ty-sync-sel'), document.getElementById('ty-sync-all')];
        btns.forEach(function (b) { b.disabled = true; });

        function passo() {
          if (!fila.length) {
            FG.toast(soma.sucesso + ' atualizado(s)' + (soma.erros ? ', ' + soma.erros + ' com erro (ver log)' : '') + '.',
              soma.erros ? 'erro' : undefined);
            desenharSync(); carregarLog();
            return;
          }
          msg.textContent = 'Sincronizando… ' + (skus.length - fila.length) + '/' + skus.length +
            ' (pode levar alguns minutos)';
          FG.tinySyncLote(fila.splice(0, TINY_LOTE)).then(function (r) {
            if (r.ok === false) {
              btns.forEach(function (b) { b.disabled = false; });
              msg.textContent = '';
              FG.toast(r.msg || 'Falha na sincronização.', 'erro');
              return;
            }
            soma.total += r.total; soma.sucesso += r.sucesso;
            soma.erros += r.erros; soma.ignorados += r.ignorados;
            passo();
          });
        }
        passo();
      }

      document.getElementById('ty-sync-sel').addEventListener('click', function () {
        var skus = Array.prototype.map.call(el.querySelectorAll('.ty-sync-sel:checked'), function (c) { return c.value; });
        if (!skus.length) { FG.toast('Selecione ao menos um produto.'); return; }
        sincronizar(skus);
      });
      document.getElementById('ty-sync-all').addEventListener('click', function () {
        sincronizar(prods.map(function (p) { return p.artigo; }));
      });
    }

    /* ----- log ----- */
    function carregarLog() {
      var el = document.getElementById('ty-log');
      FG.tinyLog().then(function (rows) {
        el.innerHTML =
          '<table class="tbl"><thead><tr><th>Data</th><th>Evento</th><th>SKU</th><th>ID Tiny</th><th>Status</th><th>Mensagem</th></tr></thead><tbody>' +
          (rows.length ? rows.map(function (l) {
            return '<tr><td>' + FG.fmtDateTime(l.data) + '</td><td>' + esc(l.evento) + '</td>' +
              '<td>' + esc(l.sku || '—') + '</td><td class="muted">' + esc(l.tinyId || '—') + '</td>' +
              '<td>' + tinyPillLog(l.status) + '</td><td>' + esc(l.mensagem || '') + '</td></tr>';
          }).join('') : '<tr><td colspan="6" class="muted">Nenhuma sincronização registrada ainda.</td></tr>') +
          '</tbody></table>';
      }, function (e) {
        el.innerHTML = '<p class="muted">Erro ao carregar o log: ' + esc((e && e.message) || '') + '</p>';
      });
    }
    document.getElementById('ty-log-rl').addEventListener('click', carregarLog);

    carregarImportacao(1);
    desenharSync();
    carregarLog();
  }

  /* =========================================================
     ROUTER
     ========================================================= */
  function route() {
    var h = (location.hash || '#dashboard').slice(1);
    var seg = h.split('/');
    switch (seg[0]) {
      case 'dashboard': renderDash(); break;
      case 'usuarios': renderUsuarios(); break;
      case 'produtos': renderProdutos(); break;
      case 'pedidos': renderPedidos(); break;
      case 'prevenda': renderPreVenda(); break;
      case 'reivindicacoes': renderClaims(); break;
      case 'tiny': renderTiny(); break;
      case 'finder':
        if (seg[1] === 'modelo' && seg[2]) renderFinderModelo(decodeURIComponent(seg[2]));
        else if (seg[1] === 'secao' && seg[2]) renderFinderSecao(Number(seg[2]));
        else renderFinderModelos();
        break;
      default: renderDash();
    }
    refreshBell();
    window.scrollTo(0, 0);
  }

  window.addEventListener('hashchange', route);
  route();

  }); // fim FG.pronto.then — tela montada só após o cache chegar
})();
