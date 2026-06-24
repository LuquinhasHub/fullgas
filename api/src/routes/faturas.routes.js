// ============================================================
// Rotas de faturas — superfície da "Conta financeira".
// Devolve apenas faturas reais (cobrança): a fatura "original" do pedido
// (Tipo 'Fatura', valor cheio = todas as peças) e eventuais 'Nota de crédito'.
// A pré-venda NÃO é fatura — vive no rastreador (GET /api/prevenda).
// ============================================================
import { Router } from 'express';
import { query } from '../db.js';
import { requireAuth } from '../auth.js';

const router = Router();

// GET /api/faturas — cliente vê as da própria empresa; admin vê todas.
router.get('/faturas', requireAuth, async (req, res, next) => {
  try {
    const eid = req.user.papel === 'admin' ? null : req.user.empresaId;
    const faturas = await query(
      `SELECT f.NumeroFatura, f.Tipo, f.DataEmissao, f.Valor, f.Moeda, f.Status,
              f.EmpresaId, e.RazaoSocial AS Empresa
         FROM dbo.Fatura f
         LEFT JOIN dbo.Empresa e ON e.EmpresaId = f.EmpresaId
        WHERE f.Tipo IN ('Fatura', 'Nota de crédito')
          AND (@eid IS NULL OR f.EmpresaId = @eid)
        ORDER BY f.DataEmissao DESC, f.FaturaId DESC`,
      { eid }
    );
    res.json(faturas.map(f => ({
      id: f.NumeroFatura,
      numero: f.NumeroFatura,
      tipo: f.Tipo,
      data: f.DataEmissao instanceof Date ? f.DataEmissao.toISOString() : f.DataEmissao,
      valor: Number(f.Valor),
      moeda: f.Moeda,
      status: f.Status,
      empresa: f.Empresa || '',
      empresaId: f.EmpresaId
    })));
  } catch (e) { next(e); }
});

export default router;
