// ============================================================
// Faturas de pré-venda (backorder) — ciclo de vida standby → ativa.
// ------------------------------------------------------------
// Quando um pedido tem itens sem estoque (EmBackorder=1), eles são vinculados
// a uma Fatura Tipo='PreVenda' Status='Standby' da empresa, acumulada por mês
// (Competencia 'YYYY-MM'). Cada peça referencia o pedido de origem (PedidoId).
//
// Quando o produto volta ao estoque, as linhas daquele produto migram para uma
// Fatura 'Ativa' (também por empresa/mês), que passa a aparecer junto das demais
// e sobe ao topo via AtualizadoEm. A ativação é item a item: só as linhas do
// produto reposto saem; o restante segue em standby.
// ============================================================
import { getPool, sql } from './db.js';

// Competência atual 'YYYY-MM' em UTC (consistente com SYSUTCDATETIME do banco).
export function competenciaAtual() {
  return new Date().toISOString().slice(0, 7);
}

// Recalcula Valor (= soma das linhas vinculadas) e marca AtualizadoEm = agora.
async function recalcularFatura(tx, faturaId) {
  await new sql.Request(tx)
    .input('fid', sql.Int, faturaId)
    .query(`UPDATE dbo.Fatura
               SET Valor = ISNULL((SELECT SUM(pi.PrecoUnitario * pi.Quantidade)
                                     FROM dbo.PedidoItem pi
                                    WHERE pi.PreVendaFaturaId = @fid), 0),
                   AtualizadoEm = SYSUTCDATETIME()
             WHERE FaturaId = @fid`);
}

// Cria uma fatura de pré-venda nova (status informado).
// NumeroFatura prefixado com 'PV' para distinguir das normais.
async function criarFatura(tx, empresaId, competencia, status) {
  const ins = await new sql.Request(tx)
    .input('eid', sql.Int, empresaId)
    .input('comp', sql.Char(7), competencia)
    .input('st', sql.VarChar(16), status)
    .query(`INSERT INTO dbo.Fatura (NumeroFatura, Tipo, EmpresaId, Valor, Status, Competencia, AtualizadoEm)
            OUTPUT inserted.FaturaId
            VALUES ('PV' + CAST(NEXT VALUE FOR dbo.Seq_NumeroFatura AS VARCHAR(20)),
                    'PreVenda', @eid, 0, @st, @comp, SYSUTCDATETIME())`);
  return ins.recordset[0].FaturaId;
}

// Acha (ou cria) a fatura STANDBY aberta da empresa na competência — esta sim
// acumula (uma por cliente por mês) enquanto os itens aguardam reposição.
async function acharOuCriarFaturaStandby(tx, empresaId, competencia) {
  const found = await new sql.Request(tx)
    .input('eid', sql.Int, empresaId)
    .input('comp', sql.Char(7), competencia)
    .query(`SELECT TOP 1 FaturaId FROM dbo.Fatura
             WHERE Tipo='PreVenda' AND Status='Standby' AND EmpresaId=@eid AND Competencia=@comp
             ORDER BY FaturaId DESC`);
  if (found.recordset.length) return found.recordset[0].FaturaId;
  return criarFatura(tx, empresaId, competencia, 'Standby');
}

// Vincula os itens em backorder de um pedido à fatura standby da empresa
// (criando-a se necessário) e recalcula o valor. Chamada no POST /pedidos,
// dentro da transação de criação do pedido.
export async function vincularBackorderDoPedido(tx, empresaId, pedidoId) {
  const faturaId = await acharOuCriarFaturaStandby(tx, empresaId, competenciaAtual());
  await new sql.Request(tx)
    .input('fid', sql.Int, faturaId)
    .input('pid', sql.Int, pedidoId)
    .query(`UPDATE dbo.PedidoItem SET PreVendaFaturaId=@fid
             WHERE PedidoId=@pid AND EmBackorder=1 AND PreVendaFaturaId IS NULL`);
  await recalcularFatura(tx, faturaId);
  return faturaId;
}

// Cancelamento de pedido: desvincula seus itens das faturas de pré-venda,
// recalcula e remove as faturas standby/ativa que ficarem vazias. Faturas já
// 'Emitida'/'Anulada' (enviadas) são preservadas para auditoria.
export async function desvincularPedido(tx, pedidoId) {
  const af = await new sql.Request(tx).input('pid', sql.Int, pedidoId)
    .query(`SELECT DISTINCT PreVendaFaturaId FROM dbo.PedidoItem
             WHERE PedidoId=@pid AND PreVendaFaturaId IS NOT NULL`);
  const faturas = af.recordset.map(r => r.PreVendaFaturaId);
  if (!faturas.length) return;
  await new sql.Request(tx).input('pid', sql.Int, pedidoId)
    .query(`UPDATE dbo.PedidoItem SET PreVendaFaturaId=NULL WHERE PedidoId=@pid`);
  for (const fid of faturas) {
    await recalcularFatura(tx, fid);
    await new sql.Request(tx).input('fid', sql.Int, fid)
      .query(`DELETE FROM dbo.Fatura
               WHERE FaturaId=@fid AND Tipo='PreVenda' AND Status IN ('Standby','Ativa')
                 AND NOT EXISTS (SELECT 1 FROM dbo.PedidoItem WHERE PreVendaFaturaId=@fid)`);
  }
}

// Gatilho: produto voltou ao estoque. Move as linhas standby desse produto para
// a fatura 'Ativa' da respectiva empresa. Abre transação própria.
export async function ativarPreVendaPorProduto(produtoId) {
  const pool = await getPool();
  const tx = new sql.Transaction(pool);
  await tx.begin();
  try {
    // Faturas standby de origem (para recalcular/limpar) e empresas afetadas.
    const orig = await new sql.Request(tx)
      .input('prod', sql.Int, produtoId)
      .query(`SELECT DISTINCT pi.PreVendaFaturaId, p.EmpresaId
                FROM dbo.PedidoItem pi
                JOIN dbo.Pedido p ON p.PedidoId = pi.PedidoId
                JOIN dbo.Fatura f ON f.FaturaId = pi.PreVendaFaturaId
               WHERE pi.ProdutoId=@prod AND pi.EmBackorder=1
                 AND f.Tipo='PreVenda' AND f.Status='Standby'`);

    if (!orig.recordset.length) { await tx.commit(); return 0; }

    const comp = competenciaAtual();
    const empresas = [...new Set(orig.recordset.map(r => r.EmpresaId))];
    let movidas = 0;

    for (const empresaId of empresas) {
      // Cada produto que sai do standby ganha a SUA fatura ativa (individual),
      // por isso criamos uma nova fatura a cada ativação em vez de reaproveitar.
      const ativaId = await criarFatura(tx, empresaId, comp, 'Ativa');
      const upd = await new sql.Request(tx)
        .input('prod', sql.Int, produtoId).input('eid', sql.Int, empresaId).input('fid', sql.Int, ativaId)
        .query(`UPDATE pi SET pi.PreVendaFaturaId=@fid
                  FROM dbo.PedidoItem pi
                  JOIN dbo.Pedido p ON p.PedidoId=pi.PedidoId
                  JOIN dbo.Fatura f ON f.FaturaId=pi.PreVendaFaturaId
                 WHERE pi.ProdutoId=@prod AND pi.EmBackorder=1 AND p.EmpresaId=@eid
                   AND f.Tipo='PreVenda' AND f.Status='Standby'`);
      movidas += upd.rowsAffected[0] || 0;
      await recalcularFatura(tx, ativaId);
    }

    // Recalcula as standby de origem e apaga as que ficaram sem itens.
    for (const fid of [...new Set(orig.recordset.map(r => r.PreVendaFaturaId))]) {
      await recalcularFatura(tx, fid);
      await new sql.Request(tx).input('fid', sql.Int, fid)
        .query(`DELETE FROM dbo.Fatura
                 WHERE FaturaId=@fid AND Tipo='PreVenda' AND Status='Standby'
                   AND NOT EXISTS (SELECT 1 FROM dbo.PedidoItem WHERE PreVendaFaturaId=@fid)`);
    }

    await tx.commit();
    return movidas;
  } catch (e) {
    try { await tx.rollback(); } catch { /* já desfeita */ }
    throw e;
  }
}
