/* ============================================================================
   038 — dbo.AuditoriaAcesso: trilha das acoes privilegiadas
   ----------------------------------------------------------------------------
   O caso que motiva esta tabela e' a ALTERACAO DE IDENTIDADE: um admin entra
   na conta de um cliente e, durante aquela hora, TUDO o que ele faz fica
   gravado como se fosse o cliente. Pedidos, reivindicacoes, edicoes de
   cadastro — o banco registra o UsuarioId do cliente, porque e' isso que o
   token diz. Nao ha, no dado de negocio, nenhuma marca de que houve um
   terceiro no meio.

   Ate aqui o unico registro disso era um console.log. Ou seja: existia
   enquanto o journald guardasse, sumia na rotacao, nao dava para consultar,
   nao dava para mostrar a ninguem. Para uma funcionalidade em que um
   funcionario da Fullgas opera a conta de um cliente, isso e' pouco — tanto
   para investigar um problema ("quem mexeu neste pedido?") quanto para
   proteger o proprio admin de uma acusacao injusta.

   Decisoes de desenho:

   • SEM chave estrangeira. E' trilha HISTORICA: precisa sobreviver a exclusao
     do usuario auditado. Uma FK faria o DELETE de um usuario falhar ou apagar
     a auditoria junto — os dois resultados errados.
   • DetalheJson livre. Cada acao guarda o que faz sentido para ela, sem
     obrigar a tabela a crescer uma coluna por tipo de evento.
   • Indice por data (consulta mais comum: "o que aconteceu ontem?") e por
     AdminId (o "o que o fulano andou fazendo?").

   Idempotente: o deploy.sh roda todas as migrations a cada publicacao.
   ============================================================================ */

USE FullgasB2B;
GO

IF OBJECT_ID('dbo.AuditoriaAcesso', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.AuditoriaAcesso (
        AuditoriaId    INT             IDENTITY(1,1) NOT NULL,
        -- Quem AGIU. Null so' em evento de origem nao autenticada.
        AdminId        INT             NULL,
        AdminEmail     NVARCHAR(160)   NULL,   -- copia: sobrevive a exclusao
        -- Sobre QUEM. Idem.
        AlvoUsuarioId  INT             NULL,
        AlvoEmail      NVARCHAR(160)   NULL,
        AlvoEmpresaId  INT             NULL,
        -- O QUE. Vocabulario fechado no codigo (api/src/auditoria.js).
        Acao           VARCHAR(40)     NOT NULL,
        DetalheJson    NVARCHAR(MAX)   NULL,
        Ip             VARCHAR(64)     NULL,
        CriadoEm       DATETIME2(0)    NOT NULL
                       CONSTRAINT DF_AuditoriaAcesso_CriadoEm DEFAULT (SYSUTCDATETIME()),
        CONSTRAINT PK_AuditoriaAcesso PRIMARY KEY (AuditoriaId)
    );

    CREATE INDEX IX_AuditoriaAcesso_CriadoEm ON dbo.AuditoriaAcesso (CriadoEm DESC);
    CREATE INDEX IX_AuditoriaAcesso_Admin    ON dbo.AuditoriaAcesso (AdminId, CriadoEm DESC);
    CREATE INDEX IX_AuditoriaAcesso_Alvo     ON dbo.AuditoriaAcesso (AlvoUsuarioId, CriadoEm DESC);

    PRINT N'038: tabela dbo.AuditoriaAcesso criada.';
END
ELSE
    PRINT N'038: dbo.AuditoriaAcesso ja existe — nada a fazer.';
GO
