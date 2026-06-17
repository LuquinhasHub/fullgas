// ============================================================
// Rotas de pedidos (e itens). Espelha o que o store.js fazia
// no front: criar pedido a partir da cesta, listar, detalhar e
// mudar status (gerando entrega + fatura ao enviar).
// ============================================================
import { Router } from 'express';
import { query, getPool, sql } from '../db.js';
import { requireAuth, requireAdmin } from '../auth.js';

const router = Router();

// Status válidos (espelham o CHECK constraint da tabela Pedido).
const STATUS_VALIDOS = ['Pendente', 'Processando', 'Enviado', 'Entregue', 'Cancelado'];
// Status terminais: uma vez aqui, o pedido não muda mais.
const STATUS_FINAIS = ['Entregue', 'Cancelado'];

function toIso(d) {
  return d instanceof Date ? d.toISOString() : (d || null);
}

// Monta a lista de pedidos no MESMO formato que o store.js devolvia, para o
// front (portal/shop/admin) não precisar mudar: { id, cx, data, usuario,
// empresa, itens:[{artigo,nome,preco,qtd}], total, status }.
function montarPedidos(pedidoRows, itemRows) {
  const porPedido = new Map();
  for (const r of itemRows) {
    if (!porPedido.has(r.PedidoId)) porPedido.set(r.PedidoId, []);
    porPedido.get(r.PedidoId).push({
      artigo: r.Sku,
      nome: r.NomeProduto,
      preco: Number(r.PrecoUnitario),
      qtd: r.Quantidade
    });
  }
  return pedidoRows.map(p => ({
    id: p.NumeroPedido,
    cx: p.CodigoCx,
    data: toIso(p.DataPedido),
    usuario: p.UsuarioEmail,
    empresa: p.Empresa,
    itens: porPedido.get(p.PedidoId) || [],
    total: Number(p.Total),
    status: p.Status
  }));
}

const SELECT_PEDIDO =
  `SELECT p.PedidoId, p.NumeroPedido, p.CodigoCx, p.DataPedido, p.Status, p.Total,
          u.Email AS UsuarioEmail, e.RazaoSocial AS Empresa
     FROM dbo.Pedido p
     JOIN dbo.Usuario u ON u.UsuarioId = p.UsuarioId
     JOIN dbo.Empresa e ON e.EmpresaId = p.EmpresaId`;

// GET /api/pedidos — cliente vê os da sua empresa; admin vê todos.
// O filtro é por EmpresaId; o UsuarioId fica como auditoria (o front ainda
// separa "meus" x "da empresa" pelo e-mail/razão que vão em cada pedido).
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
      `SELECT pi.PedidoId, pi.Sku, pi.NomeProduto, pi.PrecoUnitario, pi.Quantidade
         FROM dbo.PedidoItem pi
         JOIN dbo.Pedido p ON p.PedidoId = pi.PedidoId
        WHERE (@eid IS NULL OR p.EmpresaId = @eid)
        ORDER BY pi.PedidoItemId`,
      { eid }
    );
    res.json(montarPedidos(pedidoRows, itemRows));
  } catch (e) { next(e); }
});

// GET /api/pedidos/:numero — detalhe + itens (mesmo escopo da listagem).
router.get('/pedidos/:numero', requireAuth, async (req, res, next) => {
  try {
    const admin = req.user.papel === 'admin';
    const eid = admin ? null : req.user.empresaId;

    const pedidoRows = await query(
      SELECT_PEDIDO + ' WHERE p.NumeroPedido = @num AND (@eid IS NULL OR p.EmpresaId = @eid)',
      { num: req.params.numero, eid }
    );
    if (!pedidoRows.length) return res.status(404).json({ erro: 'Pedido não encontrado.' });

    const itemRows = await query(
      `SELECT pi.PedidoId, pi.Sku, pi.NomeProduto, pi.PrecoUnitario, pi.Quantidade
         FROM dbo.PedidoItem pi
         JOIN dbo.Pedido p ON p.PedidoId = pi.PedidoId
        WHERE p.NumeroPedido = @num
        ORDER BY pi.PedidoItemId`,
      { num: req.params.numero }
    );
    res.json(montarPedidos(pedidoRows, itemRows)[0]);
  } catch (e) { next(e); }
});

// POST /api/pedidos — cria a partir da cesta: { itens: [{ sku, quantidade }] }.
// Tudo em transação: lê preço/nome atuais (sem desconto), grava snapshot e
// baixa estoque de forma atômica (409 se faltar estoque para qualquer item).
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
      // Baixa atômica: só decrementa se houver estoque suficiente. Devolve o
      // snapshot (preço/nome atuais) na mesma operação.
      const upd = await new sql.Request(tx)
        .input('sku', sql.VarChar(40), skuItem)
        .input('qtd', sql.Int, qtd)
        .query(`UPDATE dbo.Produto
                   SET Estoque = Estoque - @qtd, AtualizadoEm = SYSUTCDATETIME()
                OUTPUT inserted.ProdutoId, inserted.Nome, inserted.Preco
                 WHERE Sku = @sku AND Estoque >= @qtd`);

      if (!upd.recordset.length) {
        // Diferencia SKU inexistente de estoque insuficiente.
        const existe = await new sql.Request(tx)
          .input('sku', sql.VarChar(40), skuItem)
          .query('SELECT 1 FROM dbo.Produto WHERE Sku = @sku');
        await tx.rollback();
        if (!existe.recordset.length)
          return res.status(400).json({ erro: 'Produto não encontrado: ' + skuItem });
        return res.status(409).json({ erro: 'Estoque insuficiente para o produto ' + skuItem + '.' });
      }

      const row = upd.recordset[0];
      const preco = Number(row.Preco);
      itensSnap.push({ produtoId: row.ProdutoId, sku: skuItem, nome: row.Nome, preco, qtd });
      total += preco * qtd;
    }

    // Numeração no banco. NumeroPedido por SEQUENCE global ('0005' + 6 dígitos).
    // CodigoCx: 'CX' + AAMMDD + 7 dígitos sequenciais que reiniciam por dia.
    // O UPDLOCK/HOLDLOCK serializa inserções do mesmo dia (evita corrida).
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
        .query(`INSERT INTO dbo.PedidoItem (PedidoId, ProdutoId, Sku, NomeProduto, PrecoUnitario, Quantidade)
                VALUES (@pid, @prod, @sku, @nome, @preco, @qtd)`);
    }

    await tx.commit();

    // Razão social da empresa para devolver o pedido completo (o front filtra
    // por empresa). Leitura fora da transação, já confirmada.
    const emp = await query('SELECT RazaoSocial FROM dbo.Empresa WHERE EmpresaId = @id', { id: req.user.empresaId });

    res.status(201).json({
      id: NumeroPedido,
      cx: CodigoCx,
      data: toIso(Agora),
      usuario: req.user.email,
      empresa: emp[0]?.RazaoSocial || '',
      itens: itensSnap.map(i => ({ artigo: i.sku, nome: i.nome, preco: i.preco, qtd: i.qtd })),
      total,
      status: 'Pendente'
    });
  } catch (e) {
    try { await tx.rollback(); } catch { /* já desfeita */ }
    next(e);
  }
});

// PUT /api/pedidos/:numero/status (admin) — transição livre, exceto saindo de
// um status terminal. Ao virar 'Enviado', gera Entrega + Fatura ligadas (mesma
// lógica do setOrderStatus do store.js). Idempotente: não duplica entrega.
router.put('/pedidos/:numero/status', requireAuth, requireAdmin, async (req, res, next) => {
  const novo = String(req.body?.status || '').trim();
  if (!STATUS_VALIDOS.includes(novo))
    return res.status(400).json({ erro: 'Status inválido.' });

  const pool = await getPool();
  const tx = new sql.Transaction(pool);
  try {
    await tx.begin();

    const cur = await new sql.Request(tx)
      .input('num', sql.VarChar(20), req.params.numero)
      .query('SELECT PedidoId, Status, Total, EmpresaId FROM dbo.Pedido WHERE NumeroPedido = @num');
    if (!cur.recordset.length) {
      await tx.rollback();
      return res.status(404).json({ erro: 'Pedido não encontrado.' });
    }
    const ped = cur.recordset[0];
    if (STATUS_FINAIS.includes(ped.Status)) {
      await tx.rollback();
      return res.status(409).json({ erro: `Pedido ${ped.Status.toLowerCase()} não pode mudar de status.` });
    }

    await new sql.Request(tx)
      .input('num', sql.VarChar(20), req.params.numero)
      .input('st', sql.VarChar(14), novo)
      .query('UPDATE dbo.Pedido SET Status = @st, AtualizadoEm = SYSUTCDATETIME() WHERE NumeroPedido = @num');

    if (novo === 'Enviado') {
      // Idempotência: só gera entrega/fatura se ainda não houver entrega ligada.
      const jaTem = await new sql.Request(tx)
        .input('pid', sql.Int, ped.PedidoId)
        .query('SELECT 1 FROM dbo.EntregaPedido WHERE PedidoId = @pid');

      if (!jaTem.recordset.length) {
        const fat = await new sql.Request(tx)
          .input('eid', sql.Int, ped.EmpresaId)
          .input('val', sql.Decimal(12, 2), ped.Total)
          .query(`INSERT INTO dbo.Fatura (NumeroFatura, Tipo, EmpresaId, Valor)
                  OUTPUT inserted.FaturaId
                  VALUES (CAST(NEXT VALUE FOR dbo.Seq_NumeroFatura AS VARCHAR(24)), 'Fatura', @eid, @val)`);
        const faturaId = fat.recordset[0].FaturaId;

        const ent = await new sql.Request(tx)
          .input('eid', sql.Int, ped.EmpresaId)
          .input('fid', sql.Int, faturaId)
          .query(`INSERT INTO dbo.Entrega (NumeroEntrega, EmpresaId, FaturaId)
                  OUTPUT inserted.EntregaId
                  VALUES (RIGHT('0000000000' + CAST(NEXT VALUE FOR dbo.Seq_NumeroEntrega AS VARCHAR(20)), 10), @eid, @fid)`);
        const entregaId = ent.recordset[0].EntregaId;

        await new sql.Request(tx)
          .input('entid', sql.Int, entregaId)
          .input('pid', sql.Int, ped.PedidoId)
          .query('INSERT INTO dbo.EntregaPedido (EntregaId, PedidoId) VALUES (@entid, @pid)');

        await new sql.Request(tx)
          .input('entid', sql.Int, entregaId)
          .query(`INSERT INTO dbo.RastreioEntrega (EntregaId, Codigo)
                  VALUES (@entid, '000' + RIGHT('000000' + CAST(NEXT VALUE FOR dbo.Seq_RastreioEntrega AS VARCHAR(20)), 6))`);
      }
    }

    await tx.commit();
    res.json({ ok: true, status: novo });
  } catch (e) {
    try { await tx.rollback(); } catch { /* já desfeita */ }
    next(e);
  }
});

export default router;
