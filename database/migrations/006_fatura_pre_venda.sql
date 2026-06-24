-- ============================================================
-- Migração 006 — Fatura de pré-venda (standby → ativação)
-- ------------------------------------------------------------
-- Pedidos com itens em pré-venda (PedidoItem.EmBackorder = 1) passam a abrir
-- uma Fatura própria, separada das normais, com ciclo de vida:
--   Tipo  = 'PreVenda'
--   Status= 'Standby'  -> aguardando reposição (fora da lista normal)
--           'Ativa'    -> produto voltou ao estoque (aparece junto das demais)
-- Acumulada por empresa+mês (Competencia 'YYYY-MM'); cada peça referencia o
-- pedido de origem via PedidoItem.PreVendaFaturaId (+ PedidoId já existente).
-- AtualizadoEm permite ordenar as recém-ativadas no topo.
--
-- Idempotente: seguro rodar mais de uma vez.
-- Aplicar com admin (fullgas_app não tem DDL) e codepage UTF-8 por causa do
-- acento em 'Nota de crédito':
--   sqlcmd -S localhost -E -C -f 65001 -i database/migrations/006_fatura_pre_venda.sql
-- ============================================================
USE FullgasB2B;
GO

-- ---- Fatura.Tipo: permitir 'PreVenda' ----
IF OBJECT_ID('dbo.CK_Fatura_Tipo', 'C') IS NOT NULL
    ALTER TABLE dbo.Fatura DROP CONSTRAINT CK_Fatura_Tipo;
GO
ALTER TABLE dbo.Fatura ADD CONSTRAINT CK_Fatura_Tipo
    CHECK (Tipo IN ('Fatura', 'Nota de crédito', 'PreVenda'));
GO

-- ---- Fatura.Status: permitir 'Standby' e 'Ativa' ----
IF OBJECT_ID('dbo.CK_Fatura_Status', 'C') IS NOT NULL
    ALTER TABLE dbo.Fatura DROP CONSTRAINT CK_Fatura_Status;
GO
ALTER TABLE dbo.Fatura ADD CONSTRAINT CK_Fatura_Status
    CHECK (Status IN ('Emitida', 'Anulada', 'Standby', 'Ativa'));
GO

-- ---- Colunas novas em Fatura ----
IF COL_LENGTH('dbo.Fatura', 'Competencia') IS NULL
    ALTER TABLE dbo.Fatura ADD Competencia CHAR(7) NULL;  -- 'YYYY-MM' (só PreVenda)
GO
IF COL_LENGTH('dbo.Fatura', 'AtualizadoEm') IS NULL
    ALTER TABLE dbo.Fatura ADD AtualizadoEm DATETIME2 NULL;
GO

-- ---- Vínculo peça ↔ fatura de pré-venda ----
IF COL_LENGTH('dbo.PedidoItem', 'PreVendaFaturaId') IS NULL
    ALTER TABLE dbo.PedidoItem ADD PreVendaFaturaId INT NULL;
GO
IF OBJECT_ID('dbo.FK_PedidoItem_PreVendaFatura', 'F') IS NULL
    ALTER TABLE dbo.PedidoItem ADD CONSTRAINT FK_PedidoItem_PreVendaFatura
        FOREIGN KEY (PreVendaFaturaId) REFERENCES dbo.Fatura(FaturaId);
GO

-- ---- Índice para a varredura de ativação por produto ----
-- Índice filtrado exige QUOTED_IDENTIFIER/ANSI_NULLS ON na criação.
SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes
               WHERE name = 'IX_PedidoItem_PreVenda'
                 AND object_id = OBJECT_ID('dbo.PedidoItem'))
    CREATE INDEX IX_PedidoItem_PreVenda ON dbo.PedidoItem (ProdutoId)
        WHERE EmBackorder = 1 AND PreVendaFaturaId IS NOT NULL;
GO
