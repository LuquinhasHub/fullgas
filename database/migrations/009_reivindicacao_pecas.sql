/* ============================================================================
   MIGRAÇÃO 009 — Peças defeituosas da reivindicação (lista com quantidade)
   ----------------------------------------------------------------------------
   Antes a reivindicação tinha UMA peça (coluna Reivindicacao.NumeroPeca). Agora
   o cliente pode informar VÁRIAS peças, cada uma com sua quantidade. Esta tabela
   guarda essa lista (1-N). A coluna NumeroPeca permanece (passa a refletir a 1ª
   peça, por compatibilidade), mas a fonte de verdade é esta tabela.

   Idempotente: cria a tabela só se ainda não existir. Pode rodar 2x.
   ============================================================================ */

USE FullgasB2B;
GO

IF OBJECT_ID(N'dbo.ReivindicacaoPeca', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.ReivindicacaoPeca (
        ReivindicacaoPecaId INT             IDENTITY(1,1) NOT NULL,
        ReivindicacaoId     INT             NOT NULL,
        Sku                 VARCHAR(40)     NOT NULL,          -- código da peça (catálogo)
        NomeProduto         NVARCHAR(200)   NULL,             -- snapshot do nome na criação
        Quantidade          INT             NOT NULL CONSTRAINT DF_ReivPeca_Qtd DEFAULT (1),
        CriadoEm            DATETIME2(0)    NOT NULL CONSTRAINT DF_ReivPeca_CriadoEm DEFAULT (SYSUTCDATETIME()),
        CONSTRAINT PK_ReivindicacaoPeca PRIMARY KEY (ReivindicacaoPecaId),
        CONSTRAINT CK_ReivPeca_Qtd CHECK (Quantidade >= 1),
        CONSTRAINT FK_ReivPeca_Reiv FOREIGN KEY (ReivindicacaoId)
            REFERENCES dbo.Reivindicacao (ReivindicacaoId) ON DELETE CASCADE
    );

    CREATE INDEX IX_ReivPeca_Reiv ON dbo.ReivindicacaoPeca (ReivindicacaoId);

    PRINT N'Tabela ReivindicacaoPeca criada.';
END
ELSE
    PRINT N'Tabela ReivindicacaoPeca já existe — nada a fazer.';
GO

PRINT N'Migração 009 concluída.';
GO
