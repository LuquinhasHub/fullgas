/* ============================================================================
   MIGRAÇÃO 012 — Valor da garantia (crédito ao aprovar)
   ----------------------------------------------------------------------------
   Quando uma reivindicação é APROVADA, o valor das peças reivindicadas
   (Σ preço × quantidade) é creditado ao cliente como uma "Nota de crédito"
   (Fatura de valor negativo, que a financeira já soma como crédito). Guardamos
   o valor apurado aqui, para exibição e rastreio. A partir da aprovação (ou
   recusa), o status fica travado.

   Idempotente: pode rodar 2x.
   ============================================================================ */

USE FullgasB2B;
GO

IF COL_LENGTH('dbo.Reivindicacao', 'ValorGarantia') IS NULL
    ALTER TABLE dbo.Reivindicacao ADD ValorGarantia DECIMAL(12, 2) NULL;
GO

PRINT N'Migração 012 concluída.';
GO
