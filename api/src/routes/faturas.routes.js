// ============================================================
// Rotas de faturas — superfície da "Conta financeira".
// Inclui faturas normais (Tipo 'Fatura'/'Nota de crédito') e as de pré-venda
// (Tipo 'PreVenda', Status 'Standby'/'Ativa'/'Emitida'). As de pré-venda trazem
// as peças com referência ao pedido de origem (para o link na tela).
// ============================================================
import { Router } from 'express';
import { query } from '../db.js';
import { requireAuth } from '../auth.js';

const router = Router();

// Rótulo amigável do tipo para exibição.
function tipoLabel(t) {
  if (t === 'PreVenda') return 'Pré-venda';
  return t; // 'Fatura' | 'Nota de crédito'
}

// GET /api/faturas — cliente vê as da própria empresa; admin vê todas.
// Ordena por última atualização (faturas de pré-venda recém-ativadas sobem ao topo).
router.get('/faturas', requireAuth, async (req, res, next) => {
  try {
    const eid = req.user.papel === 'admin' ? null : req.user.empresaId;

    const faturas = await query(
      `SELECT f.FaturaId, f.NumeroFatura, f.Tipo, f.DataEmissao, f.AtualizadoEm,
              f.Valor, f.Moeda, f.Status, f.Competencia, f.EmpresaId,
              e.RazaoSocial AS Empresa
         FROM dbo.Fatura f
         LEFT JOIN dbo.Empresa e ON e.EmpresaId = f.EmpresaId
        WHERE (@eid IS NULL OR f.EmpresaId = @eid)
        ORDER BY COALESCE(f.AtualizadoEm, f.DataEmissao) DESC, f.FaturaId DESC`,
      { eid }
    );

    // Peças das faturas de pré-venda, com o pedido de origem.
    const itens = await query(
      `SELECT pi.PreVendaFaturaId AS FaturaId, pi.Sku, pi.NomeProduto,
              pi.Quantidade, pi.PrecoUnitario, p.NumeroPedido, p.CodigoCx
         FROM dbo.PedidoItem pi
         JOIN dbo.Pedido p ON p.PedidoId = pi.PedidoId
         JOIN dbo.Fatura f ON f.FaturaId = pi.PreVendaFaturaId
        WHERE f.Tipo = 'PreVenda' AND (@eid IS NULL OR f.EmpresaId = @eid)
        ORDER BY pi.PedidoItemId`,
      { eid }
    );

    const porFatura = new Map();
    for (const r of itens) {
      if (!porFatura.has(r.FaturaId)) porFatura.set(r.FaturaId, []);
      porFatura.get(r.FaturaId).push({
        artigo: r.Sku,
        nome: r.NomeProduto,
        qtd: r.Quantidade,
        preco: Number(r.PrecoUnitario),
        pedido: r.NumeroPedido,
        cx: r.CodigoCx
      });
    }

    res.json(faturas.map(f => ({
      id: f.NumeroFatura,
      numero: f.NumeroFatura,
      tipo: tipoLabel(f.Tipo),
      preVenda: f.Tipo === 'PreVenda',
      data: f.DataEmissao instanceof Date ? f.DataEmissao.toISOString() : f.DataEmissao,
      atualizadoEm: f.AtualizadoEm instanceof Date ? f.AtualizadoEm.toISOString() : f.AtualizadoEm,
      valor: Number(f.Valor),
      moeda: f.Moeda,
      status: f.Status,
      competencia: f.Competencia ? f.Competencia.trim() : null,
      empresa: f.Empresa || '',
      empresaId: f.EmpresaId,
      itens: porFatura.get(f.FaturaId) || []
    })));
  } catch (e) { next(e); }
});

export default router;
