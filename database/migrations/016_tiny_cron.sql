/* ============================================================================
   MIGRAÇÃO 016 — Tiny: webhook substituído por sincronização agendada (cron)
   ----------------------------------------------------------------------------
   O método de notificação por webhook foi descartado; a atualização automática
   agora é um agendamento node-cron na API (a cada N minutos), que roda o mesmo
   lote do botão "Sincronizar" do admin. No log, o evento 'webhook' dá lugar a
   'cron'; 'importacao' e 'lote' (manual, pelo botão) continuam.

   Idempotente: recria o CHECK sempre com a definição final. Pode rodar 2x.
   Rodar como administrador (fullgas_app não tem DDL):
     sqlcmd -E -S <servidor> -i 016_tiny_cron.sql
   ============================================================================ */

USE FullgasB2B;
GO

IF EXISTS (SELECT 1 FROM sys.check_constraints
            WHERE name = N'CK_TinySyncLog_Evento'
              AND parent_object_id = OBJECT_ID(N'dbo.TinySyncLog'))
    ALTER TABLE dbo.TinySyncLog DROP CONSTRAINT CK_TinySyncLog_Evento;
GO

/* Nenhum registro 'webhook' existe em produção (log zerado na Frente Tiny),
   então a troca do domínio é segura. */
ALTER TABLE dbo.TinySyncLog ADD CONSTRAINT CK_TinySyncLog_Evento
    CHECK (Evento IN ('cron', 'importacao', 'lote'));
GO

PRINT N'Migração 016 concluída.';
GO
