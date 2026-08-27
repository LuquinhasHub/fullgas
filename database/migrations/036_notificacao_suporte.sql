/* ============================================================================
   MIGRAÇÃO 036 — Notificações do Suporte Técnico
   ----------------------------------------------------------------------------
   Liga o helpdesk (migração 035) à caixa de notificações (o ícone de carta do
   portal). Resposta em chamado passa a chegar no mesmo lugar onde o revendedor
   já procura recado da Fullgas, em vez de depender do badge do pop-up.

   A tabela dbo.Notificacao nasceu para UM caminho só: o administrador
   escrevendo para as concessionárias. Agora ela carrega dois, e em sentidos
   opostos — por isso as três colunas:

     Publico    PARA QUEM é a notificação: 'cliente' (a concessionária) ou
                'admin' (a equipe de suporte). Sem isto não há como avisar o
                administrador: EmpresaId NULL já significa "todas as
                concessionárias", e o admin enxerga tudo o que é delas.
     Origem     QUEM a gerou: 'admin' (mensagem escrita à mão no painel) ou
                'suporte' (automática, vinda de um chamado). É o que mantém a
                tabela "Enviadas" do painel sendo a caixa de SAÍDA do
                administrador, sem se encher de aviso automático.
     ChamadoId  o chamado que a originou. Serve para o link "Abrir chamado" na
                notificação e para marcá-la como lida quando o usuário abre o
                chamado — senão a carta ficaria acesa depois de já ter lido a
                conversa.

   Os DEFAULTs foram escolhidos para descrever as linhas que já existem:
   'cliente' + 'admin' é exatamente o que toda notificação era até aqui. Nada
   a atualizar, e o POST /notificacoes continua funcionando sem tocar em nada.

   Idempotente: confere cada coluna antes de criar. Pode rodar 2x.
   Rodar como administrador (fullgas_app não tem DDL):
     sqlcmd -E -C -f 65001 -S localhost -d FullgasB2B -i 036_notificacao_suporte.sql
   ============================================================================ */

SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;
GO

USE FullgasB2B;
GO

IF COL_LENGTH('dbo.Notificacao', 'Publico') IS NULL
BEGIN
    ALTER TABLE dbo.Notificacao ADD Publico VARCHAR(10) NOT NULL
        CONSTRAINT DF_Notificacao_Publico DEFAULT 'cliente';
    PRINT 'Coluna Notificacao.Publico criada.';
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints
                WHERE name = 'CK_Notificacao_Publico'
                  AND parent_object_id = OBJECT_ID('dbo.Notificacao'))
    ALTER TABLE dbo.Notificacao WITH CHECK
        ADD CONSTRAINT CK_Notificacao_Publico CHECK (Publico IN ('cliente', 'admin'));
GO

IF COL_LENGTH('dbo.Notificacao', 'Origem') IS NULL
BEGIN
    ALTER TABLE dbo.Notificacao ADD Origem VARCHAR(10) NOT NULL
        CONSTRAINT DF_Notificacao_Origem DEFAULT 'admin';
    PRINT 'Coluna Notificacao.Origem criada.';
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints
                WHERE name = 'CK_Notificacao_Origem'
                  AND parent_object_id = OBJECT_ID('dbo.Notificacao'))
    ALTER TABLE dbo.Notificacao WITH CHECK
        ADD CONSTRAINT CK_Notificacao_Origem CHECK (Origem IN ('admin', 'suporte'));
GO

/* ChamadoId só entra se a 035 já rodou (o laço do deploy roda em ordem, então
   ela rodou; a guarda existe para quem aplicar este arquivo solto).

   ON DELETE CASCADE: apagado o chamado, os avisos que ele gerou vão junto —
   não faz sentido guardar "resposta no chamado CH-000012" apontando para um
   chamado que não existe mais. Não há caminho de cascata duplicado aqui: o
   outro pai da Notificacao é a Empresa, que não cascateia. */
IF OBJECT_ID('dbo.SuporteChamado', 'U') IS NOT NULL
   AND COL_LENGTH('dbo.Notificacao', 'ChamadoId') IS NULL
BEGIN
    ALTER TABLE dbo.Notificacao ADD ChamadoId INT NULL
        CONSTRAINT FK_Notificacao_Chamado REFERENCES dbo.SuporteChamado (ChamadoId)
        ON DELETE CASCADE;
    PRINT 'Coluna Notificacao.ChamadoId criada.';
END
GO

/* A caixa de cada lado é lida por este par de colunas em toda abertura de
   página (o portal carrega as notificações junto com o resto). */
IF NOT EXISTS (SELECT 1 FROM sys.indexes
                WHERE name = 'IX_Notificacao_Publico'
                  AND object_id = OBJECT_ID('dbo.Notificacao'))
    CREATE INDEX IX_Notificacao_Publico ON dbo.Notificacao (Publico, CriadoEm DESC);
GO

PRINT 'Migracao 036 concluida: Notificacao ganhou Publico, Origem e ChamadoId.';
GO
