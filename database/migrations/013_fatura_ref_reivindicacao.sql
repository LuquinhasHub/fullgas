/* ============================================================================
   MIGRAÇÃO 013 — Referência da reivindicação na Fatura (nota de crédito)
   ----------------------------------------------------------------------------
   Ao aprovar uma garantia, a "Nota de crédito" gerada passa a guardar o NÚMERO
   da reivindicação de origem, para ficar corretamente referenciada na conta
   financeira (antes o crédito só tinha o número de sequência da fatura, sem
   ligação visível com a reivindicação).

   Idempotente: pode rodar 2x.
   ============================================================================ */

USE FullgasB2B;
GO

IF COL_LENGTH('dbo.Fatura', 'ReferenciaReivindicacao') IS NULL
    ALTER TABLE dbo.Fatura ADD ReferenciaReivindicacao VARCHAR(20) NULL;
GO

PRINT N'Migração 013 concluída.';
GO
