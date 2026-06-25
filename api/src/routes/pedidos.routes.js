// ============================================================
// Rotas de pedidos (e itens).
// Cria pedido a partir da cesta (aceitando itens em pré-venda/backorder
// quando não há estoque), lista, detalha e controla o envio — que pode ser
// segmentado por escopo (itens normais vs. itens em pré-venda), gerando uma
// Entrega + Fatura próprias por envio.
// ============================================================
import { Router } from 'express';
import { query, getPool, sql } from '../db.js';
import { requireAuth, requireAdmin } from '../auth.js';

const router = Router();

// Status válidos (espelham o CHECK constraint da tabela Pedido).
const STATUS_VALIDOS = ['Pendente', 'Processando', 'Enviado', 'Entregue', 'Cancelado'];
// Status terminais: uma vez aqui, o pedido não muda mais.
const STATUS_FINAIS = ['Entregue', 'Cancelado'];
// Escopos de envio aceitos.
const ESCOPOS = ['normal', 'backorder', 'tudo'];

function toIso(d) {
  return d instanceof Date ? d.toISOString() : (d || null);
}

// Snapshot de um item no formato que o front espera, enriquecido com os campos
// de envio parcial e pré-venda.
function montarItem(r) {
  return {
    itemId: r.PedidoItemId,
    artigo: r.Sku,
    nome: r.NomeProduto,
    preco: Number(r.PrecoUnitario),
    qtd: r.Quantidade,
    qtdEnviada: r.QuantidadeEnviada,
    backorder: !!r.EmBackorder
  };
}

// Lista de pedidos no formato do store.js + progresso de envio por pedido.
function montarPedidos(pedidoRows, itemRows) {
  const porPedido = new Map();
  for (const r of itemRows) {
    if (!porPedido.has(r.PedidoId)) porPedido.set(r.PedidoId, []);
    porPedido.get(r.PedidoId).push(montarItem(r));
  }
  return pedidoRows.map(p => {
    const itens = porPedido.get(p.PedidoId) || [];
    const somaQtd = itens.reduce((s, i) => s + i.qtd, 0);
    const somaEnv = itens.reduce((s, i) => s + i.qtdEnviada, 0);
    return {
      id: p.NumeroPedido,
      cx: p.CodigoCx,
      data: toIso(p.DataPedido),
      usuario: p.UsuarioEmail,
      empresa: p.Empresa,
      itens,
      total: Number(p.Total),
      status: p.Status,
      progresso: {
        qtd: somaQtd,
        enviada: somaEnv,
        pct: somaQtd ? Math.round((somaEnv / somaQtd) * 100) : 0,
        parcial: somaEnv > 0 && somaEnv < somaQtd
      },
      temBackorder: itens.some(i => i.backorder)
    };
  });
}

const SELECT_PEDIDO =
  `SELECT p.PedidoId, p.NumeroPedido, p.CodigoCx, p.DataPedido, p.Status, p.Total,
          u.Email AS UsuarioEmail, e.RazaoSocial AS Empresa
     FROM dbo.Pedido p
     JOIN dbo.Usuario u ON u.UsuarioId = p.UsuarioId
     JOIN dbo.Empresa e ON e.EmpresaId = p.EmpresaId`;

const SELECT_ITENS =
  `SELECT pi.PedidoId, pi.PedidoItemId, pi.Sku, pi.NomeProduto, pi.PrecoUnitario,
          pi.Quantidade, pi.QuantidadeEnviada, pi.EmBackorder`;

// Gera a Fatura "original" do pedido: valor cheio (total do pedido, todas as
// peças, inclusive as em pré-venda) + vínculo PedidoFatura. É o ÚNICO documento
// financeiro do pedido — o cliente paga essa. Envios não geram fatura nova.
async function gerarFaturaPedido(tx, pedidoId, empresaId, total) {
  const fat = await new sql.Request(tx)
    .input('eid', sql.Int, empresaId)
    .input('val', sql.Decimal(12, 2), total)
    .query(`INSERT INTO dbo.Fatura (NumeroFatura, Tipo, EmpresaId, Valor)
            OUTPUT inserted.FaturaId, inserted.NumeroFatura
            VALUES (CAST(NEXT VALUE FOR dbo.Seq_NumeroFatura AS VARCHAR(24)), 'Fatura', @eid, @val)`);
  const { FaturaId, NumeroFatura } = fat.recordset[0];
  await new sql.Request(tx)
    .input('pid', sql.Int, pedidoId).input('fid', sql.Int, FaturaId)
    .query('INSERT INTO dbo.PedidoFatura (PedidoId, FaturaId) VALUES (@pid, @fid)');
  return { faturaId: FaturaId, numeroFatura: NumeroFatura };
}

// Acha a fatura original do pedido (cria se faltar — ex.: pedidos antigos sem
// fatura no momento do pedido). Usada pelo envio para ligar a Entrega.
async function faturaDoPedido(tx, pedidoId, empresaId, totalFallback) {
  const r = await new sql.Request(tx)
    .input('pid', sql.Int, pedidoId)
    .query(`SELECT TOP 1 f.FaturaId FROM dbo.PedidoFatura pf
              JOIN dbo.Fatura f ON f.FaturaId = pf.FaturaId
             WHERE pf.PedidoId=@pid AND f.Tipo='Fatura' AND f.Status <> 'Anulada'
             ORDER BY f.FaturaId`);
  if (r.recordset.length) return r.recordset[0].FaturaId;
  const nova = await gerarFaturaPedido(tx, pedidoId, empresaId, totalFallback || 0);
  return nova.faturaId;
}

// Gera uma Entrega (remessa) + rastreio ligada a uma fatura existente (a do
// pedido). NÃO cria fatura nova — a cobrança é sempre a fatura do pedido.
async function gerarEntrega(tx, pedidoId, empresaId, faturaId) {
  const ent = await new sql.Request(tx)
    .input('eid', sql.Int, empresaId).input('fid', sql.Int, faturaId)
    .query(`INSERT INTO dbo.Entrega (NumeroEntrega, EmpresaId, FaturaId)
            OUTPUT inserted.EntregaId, inserted.NumeroEntrega
            VALUES (RIGHT('0000000000' + CAST(NEXT VALUE FOR dbo.Seq_NumeroEntrega AS VARCHAR(20)), 10), @eid, @fid)`);
  const { EntregaId, NumeroEntrega } = ent.recordset[0];

  await new sql.Request(tx)
    .input('entid', sql.Int, EntregaId).input('pid', sql.Int, pedidoId)
    .query('INSERT INTO dbo.EntregaPedido (EntregaId, PedidoId) VALUES (@entid, @pid)');

  await new sql.Request(tx)
    .input('entid', sql.Int, EntregaId)
    .query(`INSERT INTO dbo.RastreioEntrega (EntregaId, Codigo)
            VALUES (@entid, '000' + RIGHT('000000' + CAST(NEXT VALUE FOR dbo.Seq_RastreioEntrega AS VARCHAR(20)), 6))`);

  return { numeroEntrega: NumeroEntrega };
}

// GET /api/pedidos — cliente vê os da sua empresa; admin vê todos.
router.get('/pedidos', requireAuth, async (req, res, next) => {
  try {
    const admin = req.user.papel === 'admin';
    const eid = admin ? null : req.user.empresaId;

    const pedidoRows = await query(
      SELECT_PEDIDO +
      ' WHERE (@eid IS NULL OR p.EmpresaId = @eid) ORDER BY p.DataPedido DESC, p.PedidoId DESC',
      { eid }
    );
    const itemRows = await query(
      SELECT_ITENS +
      `   FROM dbo.PedidoItem pi
          JOIN dbo.Pedido p ON p.PedidoId = pi.PedidoId
         WHERE (@eid IS NULL OR p.EmpresaId = @eid)
         ORDER BY pi.PedidoItemId`,
      { eid }
    );
    res.json(montarPedidos(pedidoRows, itemRows));
  } catch (e) { next(e); }
});

// GET /api/pedidos/:numero — detalhe + itens (com estoque atual de cada item)
// + entregas/faturas ligadas + progresso de envio.
router.get('/pedidos/:numero', requireAuth, async (req, res, next) => {
  try {
    const admin = req.user.papel === 'admin';
    const eid = admin ? null : req.user.empresaId;
    const num = req.params.numero;

    const pedidoRows = await query(
      SELECT_PEDIDO + ' WHERE p.NumeroPedido = @num AND (@eid IS NULL OR p.EmpresaId = @eid)',
      { num, eid }
    );
    if (!pedidoRows.length) return res.status(404).json({ erro: 'Pedido não encontrado.' });
    const p = pedidoRows[0];

    const itemRows = await query(
      SELECT_ITENS + `, pr.Estoque AS EstoqueAtual
         FROM dbo.PedidoItem pi
         JOIN dbo.Pedido p ON p.PedidoId = pi.PedidoId
         LEFT JOIN dbo.Produto pr ON pr.ProdutoId = pi.ProdutoId
        WHERE p.NumeroPedido = @num
        ORDER BY pi.PedidoItemId`,
      { num }
    );
    const itens = itemRows.map(r => Object.assign(montarItem(r), {
      estoque: r.EstoqueAtual == null ? null : r.EstoqueAtual
    }));

    const entregaRows = await query(
      `SELECT e.NumeroEntrega, e.DataEntrega, e.Status AS EntregaStatus,
              f.NumeroFatura, f.Valor AS FaturaValor, f.Status AS FaturaStatus
         FROM dbo.EntregaPedido ep
         JOIN dbo.Entrega e ON e.EntregaId = ep.EntregaId
         LEFT JOIN dbo.Fatura f ON f.FaturaId = e.FaturaId
         JOIN dbo.Pedido p ON p.PedidoId = ep.PedidoId
        WHERE p.NumeroPedido = @num
        ORDER BY e.EntregaId`,
      { num }
    );
    const rastreioRows = await query(
      `SELECT e.NumeroEntrega, r.Codigo
         FROM dbo.RastreioEntrega r
         JOIN dbo.Entrega e ON e.EntregaId = r.EntregaId
         JOIN dbo.EntregaPedido ep ON ep.EntregaId = e.EntregaId
         JOIN dbo.Pedido p ON p.PedidoId = ep.PedidoId
        WHERE p.NumeroPedido = @num`,
      { num }
    );
    const rastPorEnt = {};
    for (const r of rastreioRows) {
      (rastPorEnt[r.NumeroEntrega] = rastPorEnt[r.NumeroEntrega] || []).push(r.Codigo);
    }
    const entregas = entregaRows.map(e => ({
      numero: e.NumeroEntrega,
      data: toIso(e.DataEntrega),
      status: e.EntregaStatus,
      fatura: e.NumeroFatura,
      faturaValor: e.FaturaValor == null ? null : Number(e.FaturaValor),
      faturaStatus: e.FaturaStatus,
      rastreios: rastPorEnt[e.NumeroEntrega] || []
    }));
    const faturas = entregaRows
      .filter(e => e.NumeroFatura)
      .map(e => ({ numero: e.NumeroFatura, valor: Number(e.FaturaValor), status: e.FaturaStatus }));

    const somaQtd = itens.reduce((s, i) => s + i.qtd, 0);
    const somaEnv = itens.reduce((s, i) => s + i.qtdEnviada, 0);

    res.json({
      id: p.NumeroPedido,
      cx: p.CodigoCx,
      data: toIso(p.DataPedido),
      usuario: p.UsuarioEmail,
      empresa: p.Empresa,
      total: Number(p.Total),
      status: p.Status,
      itens,
      entregas,
      faturas,
      progresso: {
        qtd: somaQtd,
        enviada: somaEnv,
        pct: somaQtd ? Math.round((somaEnv / somaQtd) * 100) : 0,
        parcial: somaEnv > 0 && somaEnv < somaQtd
      },
      temBackorder: itens.some(i => i.backorder)
    });
  } catch (e) { next(e); }
});

// POST /api/pedidos — cria a partir da cesta: { itens: [{ sku, quantidade }] }.
// Itens com estoque suficiente baixam estoque normalmente (EmBackorder=0). Itens
// sem estoque entram em pré-venda (EmBackorder=1) SEM decrementar — o pedido
// inteiro é aceito, nunca rejeitado por falta de estoque. Tudo em transação.
router.post('/pedidos', requireAuth, async (req, res, next) => {
  const itensReq = Array.isArray(req.body?.itens) ? req.body.itens : [];
  if (!itensReq.length) return res.status(400).json({ erro: 'A cesta está vazia.' });

  // Mescla SKUs repetidos e valida quantidades inteiras positivas.
  const merged = new Map();
  for (const it of itensReq) {
    const skuItem = String(it?.sku || '').trim();
    const qtd = Number(it?.quantidade);
    if (!skuItem || !Number.isInteger(qtd) || qtd <= 0)
      return res.status(400).json({ erro: 'Item inválido na cesta.' });
    merged.set(skuItem, (merged.get(skuItem) || 0) + qtd);
  }

  const pool = await getPool();
  const tx = new sql.Transaction(pool);
  try {
    await tx.begin();

    const itensSnap = [];
    let total = 0;
    for (const [skuItem, qtd] of merged) {
      // Tenta a baixa atômica. Se houver estoque, decrementa e o item é normal.
      const upd = await new sql.Request(tx)
        .input('sku', sql.VarChar(40), skuItem)
        .input('qtd', sql.Int, qtd)
        .query(`UPDATE dbo.Produto
                   SET Estoque = Estoque - @qtd, AtualizadoEm = SYSUTCDATETIME()
                OUTPUT inserted.ProdutoId, inserted.Nome, inserted.Preco
                 WHERE Sku = @sku AND Estoque >= @qtd`);

      let row, backorder;
      if (upd.recordset.length) {
        row = upd.recordset[0];
        backorder = false;
      } else {
        // A baixa falhou: produto inexistente OU estoque insuficiente.
        const prod = await new sql.Request(tx)
          .input('sku', sql.VarChar(40), skuItem)
          .query('SELECT ProdutoId, Nome, Preco, Estoque FROM dbo.Produto WHERE Sku = @sku');
        if (!prod.recordset.length) {
          await tx.rollback();
          return res.status(400).json({ erro: 'Produto não encontrado: ' + skuItem });
        }
        row = prod.recordset[0];
        // Produto "Em estoque" (Estoque > 0): o cliente só pode comprar até a
        // quantidade disponível — não vira pré-venda. Produto sem estoque
        // (Indisponível ou Pré-venda, Estoque <= 0): aceito em pré-venda.
        if (row.Estoque > 0) {
          await tx.rollback();
          return res.status(409).json({
            erro: 'Estoque insuficiente para ' + row.Nome + ' (' + skuItem + '): ' +
              'disponível ' + row.Estoque + ' un.',
            sku: skuItem, disponivel: row.Estoque
          });
        }
        backorder = true;
      }

      const preco = Number(row.Preco);
      itensSnap.push({ produtoId: row.ProdutoId, sku: skuItem, nome: row.Nome, preco, qtd, backorder });
      total += preco * qtd;
    }

    // Numeração no banco. NumeroPedido por SEQUENCE global ('0005' + 6 dígitos).
    // CodigoCx: 'CX' + AAMMDD + 7 dígitos sequenciais que reiniciam por dia.
    const num = await new sql.Request(tx).query(`
      DECLARE @now DATETIME2(0) = SYSUTCDATETIME();
      DECLARE @dia DATE = CAST(@now AS DATE);
      DECLARE @seqDia INT;
      SELECT @seqDia = COUNT(*) + 1
        FROM dbo.Pedido WITH (UPDLOCK, HOLDLOCK)
       WHERE CAST(DataPedido AS DATE) = @dia;
      SELECT
        '0005' + RIGHT('000000' + CAST(NEXT VALUE FOR dbo.Seq_NumeroPedido AS VARCHAR(20)), 6) AS NumeroPedido,
        'CX' + FORMAT(@now, 'yyMMdd') + RIGHT('0000000' + CAST(@seqDia AS VARCHAR(7)), 7) AS CodigoCx,
        @now AS Agora;`);
    const { NumeroPedido, CodigoCx, Agora } = num.recordset[0];

    const insPed = await new sql.Request(tx)
      .input('num', sql.VarChar(20), NumeroPedido)
      .input('cx', sql.VarChar(24), CodigoCx)
      .input('uid', sql.Int, req.user.id)
      .input('eid', sql.Int, req.user.empresaId)
      .input('data', sql.DateTime2, Agora)
      .input('total', sql.Decimal(12, 2), total)
      .query(`INSERT INTO dbo.Pedido (NumeroPedido, CodigoCx, UsuarioId, EmpresaId, DataPedido, Status, Total)
              OUTPUT inserted.PedidoId
              VALUES (@num, @cx, @uid, @eid, @data, 'Pendente', @total)`);
    const pedidoId = insPed.recordset[0].PedidoId;

    for (const it of itensSnap) {
      await new sql.Request(tx)
        .input('pid', sql.Int, pedidoId)
        .input('prod', sql.Int, it.produtoId)
        .input('sku', sql.VarChar(40), it.sku)
        .input('nome', sql.NVarChar(200), it.nome)
        .input('preco', sql.Decimal(12, 2), it.preco)
        .input('qtd', sql.Int, it.qtd)
        .input('back', sql.Bit, it.backorder ? 1 : 0)
        .query(`INSERT INTO dbo.PedidoItem (PedidoId, ProdutoId, Sku, NomeProduto, PrecoUnitario, Quantidade, EmBackorder)
                VALUES (@pid, @prod, @sku, @nome, @preco, @qtd, @back)`);
    }

    // Fatura "original" do pedido: valor cheio (todas as peças, inclusive as em
    // pré-venda). É o documento financeiro que o cliente paga. As peças em
    // pré-venda são acompanhadas pelo rastreador de envio (sem cobrança própria).
    await gerarFaturaPedido(tx, pedidoId, req.user.empresaId, total);

    await tx.commit();

    const emp = await query('SELECT RazaoSocial FROM dbo.Empresa WHERE EmpresaId = @id', { id: req.user.empresaId });
    const itensEmBackorder = itensSnap.filter(i => i.backorder)
      .map(i => ({ sku: i.sku, nome: i.nome, quantidade: i.qtd }));

    res.status(201).json({
      id: NumeroPedido,
      cx: CodigoCx,
      data: toIso(Agora),
      usuario: req.user.email,
      empresa: emp[0]?.RazaoSocial || '',
      itens: itensSnap.map(i => ({ artigo: i.sku, nome: i.nome, preco: i.preco, qtd: i.qtd, backorder: i.backorder })),
      itensEmBackorder,
      total,
      status: 'Pendente'
    });
  } catch (e) {
    try { await tx.rollback(); } catch { /* já desfeita */ }
    next(e);
  }
});

// PUT /api/pedidos/:numero/status (admin) — controla status e envio.
// Body: { status?, escopo? }.
//  - status 'Cancelado'  -> cancela: devolve ao estoque só o que foi baixado
//    (itens normais: Quantidade; pré-venda: só a parte já enviada) e anula as
//    faturas/entregas geradas.
//  - escopo presente OU status 'Enviado' -> ENVIO segmentado: gera Entrega +
//    Fatura próprias cobrindo apenas os itens do escopo que ainda faltam enviar
//    (pré-venda só envia o que já tem estoque, baixando-o agora). O status do
//    pedido vira 'Enviado' se tudo foi enviado, senão 'Processando'.
//  - demais status (Pendente/Processando/Entregue) -> apenas muda o status.
router.put('/pedidos/:numero/status', requireAuth, requireAdmin, async (req, res, next) => {
  const status = String(req.body?.status || '').trim();
  let escopo = String(req.body?.escopo || '').trim().toLowerCase();

  if (escopo && !ESCOPOS.includes(escopo))
    return res.status(400).json({ erro: 'Escopo inválido.' });
  if (status && !STATUS_VALIDOS.includes(status))
    return res.status(400).json({ erro: 'Status inválido.' });
  if (!status && !escopo)
    return res.status(400).json({ erro: 'Informe um status ou um escopo de envio.' });

  const isShip = !!escopo || status === 'Enviado';
  if (isShip && !escopo) escopo = 'tudo';

  const pool = await getPool();
  const tx = new sql.Transaction(pool);
  try {
    await tx.begin();

    const cur = await new sql.Request(tx)
      .input('num', sql.VarChar(20), req.params.numero)
      .query('SELECT PedidoId, Status, EmpresaId, Total FROM dbo.Pedido WHERE NumeroPedido = @num');
    if (!cur.recordset.length) {
      await tx.rollback();
      return res.status(404).json({ erro: 'Pedido não encontrado.' });
    }
    const ped = cur.recordset[0];
    if (STATUS_FINAIS.includes(ped.Status)) {
      await tx.rollback();
      return res.status(409).json({ erro: `Pedido ${ped.Status.toLowerCase()} não pode mudar de status.` });
    }

    // ---- Cancelamento ----
    if (status === 'Cancelado') {
      await new sql.Request(tx)
        .input('pid', sql.Int, ped.PedidoId)
        .query(`UPDATE p
                   SET p.Estoque = p.Estoque +
                       CASE WHEN pi.EmBackorder = 0 THEN pi.Quantidade ELSE pi.QuantidadeEnviada END,
                       p.AtualizadoEm = SYSUTCDATETIME()
                  FROM dbo.Produto p
                  JOIN dbo.PedidoItem pi ON pi.ProdutoId = p.ProdutoId
                 WHERE pi.PedidoId = @pid`);

      // Anula a fatura do pedido (ligada via PedidoFatura) e as entregas.
      await new sql.Request(tx)
        .input('pid', sql.Int, ped.PedidoId)
        .query(`UPDATE f SET f.Status = 'Anulada'
                  FROM dbo.Fatura f
                  JOIN dbo.PedidoFatura pf ON pf.FaturaId = f.FaturaId
                 WHERE pf.PedidoId = @pid`);
      await new sql.Request(tx)
        .input('pid', sql.Int, ped.PedidoId)
        .query(`UPDATE e SET e.Status = 'Anulada'
                  FROM dbo.Entrega e
                  JOIN dbo.EntregaPedido ep ON ep.EntregaId = e.EntregaId
                 WHERE ep.PedidoId = @pid`);

      await new sql.Request(tx)
        .input('pid', sql.Int, ped.PedidoId)
        .query("UPDATE dbo.Pedido SET Status = 'Cancelado', AtualizadoEm = SYSUTCDATETIME() WHERE PedidoId = @pid");

      await tx.commit();
      return res.json({ ok: true, status: 'Cancelado' });
    }

    // ---- Envio segmentado ----
    // Peças em pré-venda (EmBackorder=1) vivem numa fatura separada e NÃO entram
    // no fluxo de envio normal do pedido. O status 'Enviado' (escopo 'normal'/
    // 'tudo') envia só as peças em estoque; o escopo 'backorder' envia as de
    // pré-venda que já voltaram ao estoque, reusando a fatura ativada.
    if (isShip) {
      const alvoBackorder = escopo === 'backorder' ? 1 : 0;
      const cand = await new sql.Request(tx)
        .input('pid', sql.Int, ped.PedidoId)
        .input('alvo', sql.Bit, alvoBackorder)
        .query(`SELECT pi.PedidoItemId, pi.ProdutoId, pi.Quantidade,
                       pi.QuantidadeEnviada, pi.EmBackorder
                  FROM dbo.PedidoItem pi
                 WHERE pi.PedidoId = @pid AND pi.Quantidade > pi.QuantidadeEnviada
                   AND pi.EmBackorder = @alvo`);

      let enviados = 0;
      for (const it of cand.recordset) {
        const restante = it.Quantidade - it.QuantidadeEnviada;
        if (it.EmBackorder) {
          // Pré-venda só sai se houver estoque agora; baixa atômica.
          const dec = await new sql.Request(tx)
            .input('prod', sql.Int, it.ProdutoId)
            .input('rem', sql.Int, restante)
            .query(`UPDATE dbo.Produto SET Estoque = Estoque - @rem, AtualizadoEm = SYSUTCDATETIME()
                     WHERE ProdutoId = @prod AND Estoque >= @rem`);
          if (!dec.rowsAffected[0]) continue; // sem estoque: fica pendente
        }
        await new sql.Request(tx)
          .input('iid', sql.Int, it.PedidoItemId)
          .query('UPDATE dbo.PedidoItem SET QuantidadeEnviada = Quantidade WHERE PedidoItemId = @iid');
        enviados++;
      }

      // Envio de pré-venda exige estoque; sem nada disponível é erro. Para o
      // envio normal, não enviar nada não é erro (ex.: marcar 'Enviado' com as
      // peças em estoque já enviadas e só pré-venda pendente) — apenas atualiza
      // o status do pedido.
      if (alvoBackorder && !enviados) {
        await tx.rollback();
        return res.status(409).json({ erro: 'Nenhuma peça de pré-venda disponível para envio (sem estoque).' });
      }

      // Remessa (Entrega) do que foi enviado, ligada à fatura ÚNICA do pedido —
      // sem gerar fatura nova (a cobrança é sempre a fatura original do pedido).
      let numeroEntrega = null;
      if (enviados) {
        const fid = await faturaDoPedido(tx, ped.PedidoId, ped.EmpresaId, ped.Total);
        const d = await gerarEntrega(tx, ped.PedidoId, ped.EmpresaId, fid);
        numeroEntrega = d.numeroEntrega;
      }

      // Status do pedido considera APENAS as peças em estoque (não-backorder);
      // as de pré-venda seguem no rastreador de envio.
      const rest = await new sql.Request(tx)
        .input('pid', sql.Int, ped.PedidoId)
        .query(`SELECT COUNT(*) AS pend FROM dbo.PedidoItem
                 WHERE PedidoId = @pid AND EmBackorder = 0 AND Quantidade > QuantidadeEnviada`);
      const faltamNormais = rest.recordset[0].pend > 0;
      const novoStatus = faltamNormais ? 'Processando' : 'Enviado';
      await new sql.Request(tx)
        .input('pid', sql.Int, ped.PedidoId)
        .input('st', sql.VarChar(14), novoStatus)
        .query('UPDATE dbo.Pedido SET Status = @st, AtualizadoEm = SYSUTCDATETIME() WHERE PedidoId = @pid');

      await tx.commit();
      return res.json({
        ok: true, status: novoStatus, parcial: faltamNormais, entrega: numeroEntrega
      });
    }

    // ---- Mudança simples de status (Pendente/Processando/Entregue) ----
    await new sql.Request(tx)
      .input('num', sql.VarChar(20), req.params.numero)
      .input('st', sql.VarChar(14), status)
      .query('UPDATE dbo.Pedido SET Status = @st, AtualizadoEm = SYSUTCDATETIME() WHERE NumeroPedido = @num');

    await tx.commit();
    res.json({ ok: true, status });
  } catch (e) {
    try { await tx.rollback(); } catch { /* já desfeita */ }
    next(e);
  }
});

// PUT /api/pedidos/:numero/itens/:itemId/enviado (admin) — ajuste manual da
// quantidade enviada de um item. { qtd } entre 0 e Quantidade. Para itens em
// pré-venda, aumentar consome estoque (e exige tê-lo); diminuir devolve.
router.put('/pedidos/:numero/itens/:itemId/enviado', requireAuth, requireAdmin, async (req, res, next) => {
  const qtd = Number(req.body?.qtd);
  if (!Number.isInteger(qtd) || qtd < 0)
    return res.status(400).json({ erro: 'Quantidade inválida.' });

  const pool = await getPool();
  const tx = new sql.Transaction(pool);
  try {
    await tx.begin();

    const cur = await new sql.Request(tx)
      .input('num', sql.VarChar(20), req.params.numero)
      .input('iid', sql.Int, Number(req.params.itemId))
      .query(`SELECT pi.PedidoItemId, pi.ProdutoId, pi.Quantidade, pi.QuantidadeEnviada, pi.EmBackorder
                FROM dbo.PedidoItem pi
                JOIN dbo.Pedido p ON p.PedidoId = pi.PedidoId
               WHERE p.NumeroPedido = @num AND pi.PedidoItemId = @iid`);
    if (!cur.recordset.length) {
      await tx.rollback();
      return res.status(404).json({ erro: 'Item não encontrado neste pedido.' });
    }
    const it = cur.recordset[0];
    if (qtd > it.Quantidade) {
      await tx.rollback();
      return res.status(400).json({ erro: 'Quantidade enviada não pode exceder a pedida.' });
    }

    const delta = qtd - it.QuantidadeEnviada;
    if (it.EmBackorder && delta !== 0) {
      // Aumentar consome estoque; diminuir devolve. Baixa atômica no aumento.
      const dec = await new sql.Request(tx)
        .input('prod', sql.Int, it.ProdutoId)
        .input('d', sql.Int, delta)
        .query(`UPDATE dbo.Produto SET Estoque = Estoque - @d, AtualizadoEm = SYSUTCDATETIME()
                 WHERE ProdutoId = @prod AND (@d <= 0 OR Estoque >= @d)`);
      if (!dec.rowsAffected[0]) {
        await tx.rollback();
        return res.status(409).json({ erro: 'Estoque insuficiente para enviar essa quantidade.' });
      }
    }

    await new sql.Request(tx)
      .input('iid', sql.Int, it.PedidoItemId)
      .input('q', sql.Int, qtd)
      .query('UPDATE dbo.PedidoItem SET QuantidadeEnviada = @q WHERE PedidoItemId = @iid');

    await tx.commit();
    res.json({ ok: true, itemId: it.PedidoItemId, qtdEnviada: qtd });
  } catch (e) {
    try { await tx.rollback(); } catch { /* já desfeita */ }
    next(e);
  }
});

export default router;
