-- ============================================================
-- Migração 004 — Envio parcial e pré-venda (backorder) em PedidoItem
-- ------------------------------------------------------------
-- Item 4 do lote 1 + adendo 06 (pré-venda/backorder):
--   QuantidadeEnviada: quanto de cada item já foi efetivamente enviado.
--   EmBackorder: item aceito sem estoque no momento do pedido (pré-venda);
--                decisão tomada na hora da compra, persiste mesmo que o
--                estoque mude depois (não é Quantidade > QuantidadeEnviada).
-- Idempotente: seguro para rodar mais de uma vez.
-- Aplicar com admin (fullgas_app não tem DDL):
--   sqlcmd -S localhost -E -C -i database/migrations/004_envio_parcial_e_backorder.sql
-- ============================================================
USE FullgasB2B;
GO

-- Necessário porque PedidoItem tem coluna computada (Subtotal) e os índices
-- abaixo são filtrados — ambos exigem estas opções ligadas para ALTER/CREATE.
SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;
GO

/* QuantidadeEnviada — soma do que já saiu para entrega (0..Quantidade) */
IF COL_LENGTH('dbo.PedidoItem', 'QuantidadeEnviada') IS NULL
    ALTER TABLE dbo.PedidoItem ADD QuantidadeEnviada INT NOT NULL
        CONSTRAINT DF_PedidoItem_QtdEnviada DEFAULT (0);
GO

/* EmBackorder — 1 = item entrou em pré-venda (sem estoque na hora do pedido) */
IF COL_LENGTH('dbo.PedidoItem', 'EmBackorder') IS NULL
    ALTER TABLE dbo.PedidoItem ADD EmBackorder BIT NOT NULL
        CONSTRAINT DF_PedidoItem_Backorder DEFAULT (0);
GO

/* Obs.: não criamos índice filtrado por "QuantidadeEnviada < Quantidade":
   o SQL Server não aceita comparação entre duas colunas no predicado de
   índice filtrado (apenas coluna vs. constante). Os itens a enviar de um
   pedido são poucos, então o IX_PedidoItem_Pedido já atende. */

/* Índice para achar rápido itens em pré-venda de um pedido */
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_PedidoItem_Backorder')
    CREATE INDEX IX_PedidoItem_Backorder
        ON dbo.PedidoItem (PedidoId)
        WHERE EmBackorder = 1;
GO
