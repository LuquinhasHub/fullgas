// ============================================================
// Rastreador de pré-venda (logística, NÃO financeiro).
// Lista as peças em pré-venda (PedidoItem.EmBackorder=1) que ainda faltam
// enviar, por cliente, com referência ao pedido de origem. A cobrança é a
// fatura cheia do pedido — aqui não há valor, só organização de envio.
// Status por peça:
//   'Aguardando'  -> produto ainda sem estoque
//   'Disponivel'  -> produto voltou ao estoque (admin pode marcar "Enviado")
// Marcar "Enviado" usa PUT /api/pedidos/:numero/itens/:itemId/enviado.
// ============================================================
import { Router } from 'express';
import { query } from '../db.js';
import { requireAuth } from '../auth.js';

const router = Router();

// GET /api/prevenda — cliente vê as suas; admin vê todas (para organizar por cliente).
router.get('/prevenda', requireAuth, async (req, res, next) => {
  try {
    const eid = req.user.papel === 'admin' ? null : req.user.empresaId;
    const rows = await query(
      `SELECT pi.PedidoItemId, pi.Sku, pi.NomeProduto, pi.Quantidade, pi.QuantidadeEnviada,
              p.NumeroPedido, p.CodigoCx, p.DataPedido, p.EmpresaId, e.RazaoSocial AS Empresa,
              pr.Estoque AS EstoqueAtual, pr.PrevisaoChegada
         FROM dbo.PedidoItem pi
         JOIN dbo.Pedido p ON p.PedidoId = pi.PedidoId
         JOIN dbo.Empresa e ON e.EmpresaId = p.EmpresaId
         LEFT JOIN dbo.Produto pr ON pr.ProdutoId = pi.ProdutoId
        WHERE pi.EmBackorder = 1 AND pi.Quantidade > pi.QuantidadeEnviada
          AND p.Status <> 'Cancelado'
          AND (@eid IS NULL OR p.EmpresaId = @eid)
        ORDER BY e.RazaoSocial, p.NumeroPedido, pi.PedidoItemId`,
      { eid }
    );
    res.json(rows.map(r => ({
      itemId: r.PedidoItemId,
      artigo: r.Sku,
      nome: r.NomeProduto,
      qtd: r.Quantidade,
      qtdEnviada: r.QuantidadeEnviada,
      pendente: r.Quantidade - r.QuantidadeEnviada,
      pedido: r.NumeroPedido,
      cx: r.CodigoCx,
      data: r.DataPedido instanceof Date ? r.DataPedido.toISOString() : (r.DataPedido || null),
      empresa: r.Empresa,
      empresaId: r.EmpresaId,
      estoque: r.EstoqueAtual == null ? 0 : r.EstoqueAtual,
      previsao: r.PrevisaoChegada || null,
      // Só fica "Disponível p/ envio" quando o estoque cobre a quantidade
      // pendente; estoque parcial (abaixo do pendente) continua "Aguardando".
      status: (r.EstoqueAtual || 0) >= (r.Quantidade - r.QuantidadeEnviada) ? 'Disponivel' : 'Aguardando'
    })));
  } catch (e) { next(e); }
});

export default router;
