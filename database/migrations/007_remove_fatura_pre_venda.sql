-- ============================================================
-- Migração 007 — Remove a fatura de pré-venda (reverte a 006)
-- ------------------------------------------------------------
-- O modelo de "Fatura de pré-venda" (Tipo='PreVenda', Status Standby/Ativa,
-- vínculo PedidoItem.PreVendaFaturaId) foi descontinuado. No modelo atual a
-- cobrança é UMA fatura cheia por pedido (Tipo='Fatura') e a pré-venda é apenas
-- um rastreador logístico derivado de PedidoItem.EmBackorder — sem fatura,
-- sem valor. Esta migração limpa tudo que a 006 introduziu e não é mais usado:
--   * apaga as faturas Tipo='PreVenda' (e suas entregas/links de teste);
--   * remove FK/índice/coluna PedidoItem.PreVendaFaturaId;
--   * remove Fatura.Competencia e Fatura.AtualizadoEm (nunca usadas);
--   * reverte CK_Fatura_Tipo e CK_Fatura_Status aos valores originais
--     (Tipo IN ('Fatura','Nota de crédito'); Status IN ('Emitida','Anulada')).
--
-- A coluna Fatura.Status permanece (criada na 003); só o CHECK é revertido.
--
-- Idempotente: seguro rodar mais de uma vez.
-- Aplicar com admin (fullgas_app não tem DDL) e codepage UTF-8 por causa do
-- acento em 'Nota de crédito':
--   sqlcmd -S localhost -E -C -f 65001 -i database/migrations/007_remove_fatura_pre_venda.sql
-- ============================================================
USE FullgasB2B;
GO
SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;
GO

-- ---- 1) Remover o vínculo peça -> fatura de pré-venda (FK, índice, coluna) ----
IF OBJECT_ID('dbo.FK_PedidoItem_PreVendaFatura', 'F') IS NOT NULL
    ALTER TABLE dbo.PedidoItem DROP CONSTRAINT FK_PedidoItem_PreVendaFatura;
GO
IF EXISTS (SELECT 1 FROM sys.indexes
           WHERE name = 'IX_PedidoItem_PreVenda'
             AND object_id = OBJECT_ID('dbo.PedidoItem'))
    DROP INDEX IX_PedidoItem_PreVenda ON dbo.PedidoItem;
GO
IF COL_LENGTH('dbo.PedidoItem', 'PreVendaFaturaId') IS NOT NULL
    ALTER TABLE dbo.PedidoItem DROP COLUMN PreVendaFaturaId;
GO

-- ---- 2) Apagar faturas de pré-venda (modelo antigo) e dependências ----
-- Nenhuma fatura do modelo atual tem Tipo='PreVenda'; estas são resíduos de
-- testes da 006. Apaga na ordem das FKs: rastreio -> entrega-pedido -> entrega
-- -> vínculo pedido-fatura -> fatura.
DELETE re
  FROM dbo.RastreioEntrega re
  JOIN dbo.Entrega e ON e.EntregaId = re.EntregaId
  JOIN dbo.Fatura  f ON f.FaturaId  = e.FaturaId
 WHERE f.Tipo = 'PreVenda';
GO
DELETE ep
  FROM dbo.EntregaPedido ep
  JOIN dbo.Entrega e ON e.EntregaId = ep.EntregaId
  JOIN dbo.Fatura  f ON f.FaturaId  = e.FaturaId
 WHERE f.Tipo = 'PreVenda';
GO
DELETE e
  FROM dbo.Entrega e
  JOIN dbo.Fatura f ON f.FaturaId = e.FaturaId
 WHERE f.Tipo = 'PreVenda';
GO
DELETE pf
  FROM dbo.PedidoFatura pf
  JOIN dbo.Fatura f ON f.FaturaId = pf.FaturaId
 WHERE f.Tipo = 'PreVenda';
GO
DELETE FROM dbo.Fatura WHERE Tipo = 'PreVenda';
GO

-- ---- 3) Reverter os CHECKs aos valores originais ----
IF OBJECT_ID('dbo.CK_Fatura_Tipo', 'C') IS NOT NULL
    ALTER TABLE dbo.Fatura DROP CONSTRAINT CK_Fatura_Tipo;
GO
ALTER TABLE dbo.Fatura ADD CONSTRAINT CK_Fatura_Tipo
    CHECK (Tipo IN ('Fatura', 'Nota de crédito'));
GO

IF OBJECT_ID('dbo.CK_Fatura_Status', 'C') IS NOT NULL
    ALTER TABLE dbo.Fatura DROP CONSTRAINT CK_Fatura_Status;
GO
ALTER TABLE dbo.Fatura ADD CONSTRAINT CK_Fatura_Status
    CHECK (Status IN ('Emitida', 'Anulada'));
GO

-- ---- 4) Remover colunas não usadas de Fatura ----
IF COL_LENGTH('dbo.Fatura', 'Competencia') IS NOT NULL
    ALTER TABLE dbo.Fatura DROP COLUMN Competencia;
GO
IF COL_LENGTH('dbo.Fatura', 'AtualizadoEm') IS NOT NULL
    ALTER TABLE dbo.Fatura DROP COLUMN AtualizadoEm;
GO
