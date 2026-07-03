/* ============================================================================
   MIGRAÇÃO 010 — Devolução ao revendedor + fim do status "Esboço" no banco
   ----------------------------------------------------------------------------
   - "Esboço" deixa de ser status do banco: rascunhos passam a viver no navegador
     do cliente (localStorage). Convertemos qualquer 'Esboço' existente para
     'Em processo' e apertamos o CHECK de Status.
   - Novo campo FaltaInformacao: o admin descreve o que falta ao DEVOLVER a
     reivindicação (Devolvido=1) para o revendedor completar e reenviar.

   Idempotente: pode rodar 2x.
   ============================================================================ */

USE FullgasB2B;
GO

/* 1) Campo do motivo da devolução (o que falta). */
IF COL_LENGTH('dbo.Reivindicacao', 'FaltaInformacao') IS NULL
    ALTER TABLE dbo.Reivindicacao ADD FaltaInformacao NVARCHAR(500) NULL;
GO

/* 2) Rascunhos não existem mais no banco: converte para 'Em processo'. */
UPDATE dbo.Reivindicacao SET Status = 'Em processo' WHERE Status = 'Esboço';
GO

/* 3) Aperta o CHECK de Status removendo 'Esboço'. */
IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_Reiv_Status')
    ALTER TABLE dbo.Reivindicacao DROP CONSTRAINT CK_Reiv_Status;
GO
ALTER TABLE dbo.Reivindicacao ADD CONSTRAINT CK_Reiv_Status
    CHECK (Status IN ('Em processo', 'Aprovada', 'Recusada'));
GO

PRINT N'Migração 010 concluída.';
GO
