/* ============================================================================
   MIGRAÇÃO 019 — Pedido.Tipo ('venda' | 'garantia')
   ----------------------------------------------------------------------------
   Novo modelo de reivindicação APROVADA: em vez de nota de crédito (desconto
   na conta do cliente), a aprovação cria um PEDIDO DE GARANTIA — reposição
   das peças reclamadas, com preço R$ 0 e sem fatura — que segue o fluxo
   normal de pedidos (aparece na área de pedidos, exporta ao Tiny, itens sem
   estoque entram em pré-venda).

   Idempotente: cada passo verifica antes de alterar. Pode rodar 2x.
   Rodar como administrador (fullgas_app não tem DDL):
     sqlcmd -E -S <servidor> -i 019_pedido_tipo_garantia.sql
   ============================================================================ */

USE FullgasB2B;
GO

SET QUOTED_IDENTIFIER ON;
GO

IF COL_LENGTH(N'dbo.Pedido', N'Tipo') IS NULL
BEGIN
    ALTER TABLE dbo.Pedido ADD Tipo VARCHAR(10) NOT NULL
        CONSTRAINT DF_Pedido_Tipo DEFAULT ('venda');
    PRINT N'Pedido.Tipo criada.';
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints
                WHERE name = N'CK_Pedido_Tipo' AND parent_object_id = OBJECT_ID(N'dbo.Pedido'))
BEGIN
    ALTER TABLE dbo.Pedido ADD CONSTRAINT CK_Pedido_Tipo
        CHECK (Tipo IN ('venda', 'garantia'));
    PRINT N'CHECK CK_Pedido_Tipo criado.';
END
GO

PRINT N'Migração 019 concluída.';
GO
