/* ============================================================================
   MIGRAÇÃO 008 — Quilometragem na reivindicação
   ----------------------------------------------------------------------------
   Complementa a migração 001 (que adicionou DataDefeito e Horimetro). A
   "duração de operação" da peça pode ser informada em HORAS (Horimetro, já
   existente) e/ou em QUILÔMETROS (esta coluna). O cliente preenche o que tiver.

   Idempotente: adiciona a coluna só se ainda não existir. Pode rodar 2x.
   ============================================================================ */

USE FullgasB2B;
GO

IF COL_LENGTH('dbo.Reivindicacao', 'Quilometragem') IS NULL
    ALTER TABLE dbo.Reivindicacao ADD Quilometragem INT NULL;   -- km de uso da moto
GO

PRINT N'Migração 008 concluída.';
GO
