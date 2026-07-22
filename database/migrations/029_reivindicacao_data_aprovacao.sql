-- ============================================================
-- 029 — Data de aprovação da reivindicação.
-- Grava quando a reivindicação foi aprovada (controle no painel admin).
-- Backfill: aprovadas antigas usam AtualizadoEm como melhor aproximação.
-- Idempotente.
-- ============================================================
SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;
GO

IF COL_LENGTH('dbo.Reivindicacao', 'DataAprovacao') IS NULL
    ALTER TABLE dbo.Reivindicacao ADD DataAprovacao DATETIME2 NULL;
GO

UPDATE dbo.Reivindicacao
   SET DataAprovacao = ISNULL(AtualizadoEm, DataAbertura)
 WHERE Status = N'Aprovada' AND DataAprovacao IS NULL;
GO
