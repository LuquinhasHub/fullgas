-- ============================================================
-- 021 — Inscrição estadual + vínculo do cliente com o Tiny ERP
-- ------------------------------------------------------------
-- InscricaoEstadual   campo opcional do cadastro da empresa.
-- TinyContatoId       id do contato no Tiny atrelado ao CNPJ da
--                     empresa (regra: todo cliente Fullgas vira/
--                     usa um contato no Tiny — tiny-contatos.js).
-- TinyContatoPendente 1 = cadastro aguardando vínculo com o Tiny
--                     (Tiny fora do ar na hora, etc.); o cron
--                     re-tenta até conseguir. Só o /register liga
--                     esta flag — empresas antigas não são
--                     exportadas em massa para o Tiny.
-- Idempotente: roda quantas vezes for preciso.
-- ============================================================
SET QUOTED_IDENTIFIER ON;

IF COL_LENGTH('dbo.Empresa', 'InscricaoEstadual') IS NULL
  ALTER TABLE dbo.Empresa ADD InscricaoEstadual VARCHAR(20) NULL;

IF COL_LENGTH('dbo.Empresa', 'TinyContatoId') IS NULL
  ALTER TABLE dbo.Empresa ADD TinyContatoId VARCHAR(40) NULL;

IF COL_LENGTH('dbo.Empresa', 'TinyContatoPendente') IS NULL
  ALTER TABLE dbo.Empresa ADD TinyContatoPendente BIT NOT NULL
    CONSTRAINT DF_Empresa_TinyContatoPendente DEFAULT 0;
GO

-- O TinySyncLog agora também registra o vínculo de clientes (Evento
-- 'contato') — o CHECK antigo só conhecia lote/importacao/cron.
IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_TinySyncLog_Evento')
  ALTER TABLE dbo.TinySyncLog DROP CONSTRAINT CK_TinySyncLog_Evento;
ALTER TABLE dbo.TinySyncLog ADD CONSTRAINT CK_TinySyncLog_Evento
  CHECK (Evento IN ('lote', 'importacao', 'cron', 'contato'));
GO

PRINT '021 aplicada: Empresa.InscricaoEstadual / TinyContatoId / TinyContatoPendente';
