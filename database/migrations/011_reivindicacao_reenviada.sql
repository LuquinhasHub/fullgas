/* ============================================================================
   MIGRAÇÃO 011 — Sinal de "reenviada pelo revendedor"
   ----------------------------------------------------------------------------
   Fecha o ciclo devolver ↔ reenviar: quando o revendedor completa e REENVIA uma
   reivindicação que havia sido devolvida, marcamos Reenviada=1 para o admin ver
   um aviso de que ela foi atualizada. O admin, ao agir (devolver de novo, mudar
   status), zera o sinal. O ciclo pode repetir quantas vezes for preciso.

   Idempotente: pode rodar 2x.
   ============================================================================ */

USE FullgasB2B;
GO

IF COL_LENGTH('dbo.Reivindicacao', 'Reenviada') IS NULL
    ALTER TABLE dbo.Reivindicacao
        ADD Reenviada BIT NOT NULL CONSTRAINT DF_Reiv_Reenviada DEFAULT (0);
GO

PRINT N'Migração 011 concluída.';
GO
