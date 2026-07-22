/* ============================================================================
   MIGRAÇÃO 017 — Remove o catálogo fictício (produtos de demonstração)
   ----------------------------------------------------------------------------
   Com a integração Tiny no ar, o catálogo real vem do ERP. Esta migração
   apaga todos os produtos SEM vínculo com o Tiny (TinyId IS NULL) — o
   "estoque fictício" criado nas cargas de demonstração — e, por arrasto de
   chave estrangeira, os dados demo que dependiam deles:

   - PecaSecao: vínculos de peças nas seções do Parts Finder (o admin
     re-monta as seções com os produtos reais importados do Tiny);
   - PedidoItem + Pedido: itens e pedidos de demonstração que ficarem vazios;
   - Entrega/RastreioEntrega e Fatura órfãs desses pedidos (inclusive as
     faturas avulsas da carga demo, que nunca tiveram pedido).

   O que NÃO é tocado:
   - Produtos com TinyId (catálogo real);
   - Faturas com ReferenciaReivindicacao (notas de crédito de garantia);
   - Reivindicações, veículos, usuários, categorias e modelos do finder
     (as seções ficam sem peças, mas continuam existindo).

   Idempotente: re-executar sem produtos fictícios não apaga nada.
   Rodar como administrador (fullgas_app não tem permissão p/ estes DELETEs):
     sqlcmd -E -S <servidor> -i 017_remover_catalogo_ficticio.sql
   ============================================================================ */

USE FullgasB2B;
GO

-- DML em tabela com índice filtrado (UX_Produto_TinyId) exige QUOTED_IDENTIFIER
-- ON; o sqlcmd roda OFF por padrão.
SET QUOTED_IDENTIFIER ON;
GO

SET XACT_ABORT ON;   -- qualquer erro desfaz a transação inteira
BEGIN TRAN;

DECLARE @ficticios TABLE (ProdutoId INT PRIMARY KEY);
INSERT INTO @ficticios
    SELECT ProdutoId FROM dbo.Produto WHERE TinyId IS NULL;
PRINT CONCAT(N'Produtos fictícios a remover: ', @@ROWCOUNT);

/* ---- 1) Parts Finder: peças das seções que apontavam p/ fictícios --------- */
DELETE pc FROM dbo.PecaSecao pc
    JOIN @ficticios f ON f.ProdutoId = pc.ProdutoId;
PRINT CONCAT(N'PecaSecao removidas: ', @@ROWCOUNT);

/* ---- 2) Itens de pedido desses produtos ------------------------------------ */
DELETE pi FROM dbo.PedidoItem pi
    JOIN @ficticios f ON f.ProdutoId = pi.ProdutoId;
PRINT CONCAT(N'PedidoItem removidos: ', @@ROWCOUNT);

/* ---- 3) Pedidos demo que ficaram sem nenhum item --------------------------- */
DECLARE @pedidosVazios TABLE (PedidoId INT PRIMARY KEY);
INSERT INTO @pedidosVazios
    SELECT pd.PedidoId FROM dbo.Pedido pd
     WHERE NOT EXISTS (SELECT 1 FROM dbo.PedidoItem pi WHERE pi.PedidoId = pd.PedidoId);

DELETE ep FROM dbo.EntregaPedido ep JOIN @pedidosVazios v ON v.PedidoId = ep.PedidoId;
DELETE pf FROM dbo.PedidoFatura pf JOIN @pedidosVazios v ON v.PedidoId = pf.PedidoId;
DELETE pd FROM dbo.Pedido pd       JOIN @pedidosVazios v ON v.PedidoId = pd.PedidoId;
PRINT CONCAT(N'Pedidos vazios removidos: ', @@ROWCOUNT);

/* ---- 4) Entregas que ficaram sem pedido (e seus rastreios) ----------------- */
DELETE r FROM dbo.RastreioEntrega r
    WHERE NOT EXISTS (SELECT 1 FROM dbo.EntregaPedido ep WHERE ep.EntregaId = r.EntregaId);
DELETE e FROM dbo.Entrega e
    WHERE NOT EXISTS (SELECT 1 FROM dbo.EntregaPedido ep WHERE ep.EntregaId = e.EntregaId);
PRINT CONCAT(N'Entregas órfãs removidas: ', @@ROWCOUNT);

/* ---- 5) Faturas órfãs — preservando notas de crédito de reivindicação ------ */
DELETE fa FROM dbo.Fatura fa
    WHERE fa.ReferenciaReivindicacao IS NULL
      AND NOT EXISTS (SELECT 1 FROM dbo.PedidoFatura pf WHERE pf.FaturaId = fa.FaturaId)
      AND NOT EXISTS (SELECT 1 FROM dbo.Entrega e WHERE e.FaturaId = fa.FaturaId);
PRINT CONCAT(N'Faturas órfãs removidas: ', @@ROWCOUNT);

/* ---- 6) Por fim, os próprios produtos fictícios ----------------------------- */
DELETE pr FROM dbo.Produto pr
    JOIN @ficticios f ON f.ProdutoId = pr.ProdutoId;
PRINT CONCAT(N'Produtos removidos: ', @@ROWCOUNT);

COMMIT;
GO

PRINT N'Migração 017 concluída.';
GO
