/* ============================================================================
   MIGRAÇÃO 033 — Histórico do veículo (linha do tempo do chassi)
   ----------------------------------------------------------------------------
   Tudo que acontece com um chassi passa a ficar registrado numa linha só do
   tempo: cadastro, atribuição e transferências entre concessionárias, venda ao
   consumidor, ativação de garantia, reivindicações e — o que não existia —
   recalls, revisões e anotações lançadas à mão pelo administrador.

   Três decisões que valem o comentário:

   • FK só para Veiculo (com CASCADE). Usuario e Empresa entram como ID SEM
     chave estrangeira, acompanhados de um snapshot do nome. O motivo é que o
     painel exclui usuários (DELETE /api/usuarios/:id): com FK, a primeira
     exclusão passaria a falhar por causa de linhas de histórico, e um registro
     histórico não pode ser o que impede uma operação corriqueira. O snapshot
     ainda resolve o caso de renomear a empresa: o histórico guarda o nome de
     quando o evento aconteceu, que é o que interessa numa auditoria.

   • Manual separa o que o sistema registrou sozinho do que uma pessoa lançou.
     Só o lançamento manual pode ser apagado depois; evento automático é fato
     consumado — poder apagá-lo esvaziaria o sentido de existir um histórico.

   • DataEvento é separada de CriadoEm porque um recall pode ser lançado hoje
     referindo-se a uma campanha da semana passada.

   Idempotente: cria a tabela só se ainda não existir, e o backfill dos eventos
   já conhecidos (entrada em estoque, venda, garantia, reivindicações) roda uma
   única vez, junto da criação.

   Rodar como administrador (fullgas_app não tem DDL), em UTF-8 por causa dos
   acentos nos textos semeados:
     sqlcmd -E -C -f 65001 -S localhost -d FullgasB2B -i 033_veiculo_historico.sql
   ============================================================================ */

SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;
GO

USE FullgasB2B;
GO

IF OBJECT_ID(N'dbo.VeiculoHistorico', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.VeiculoHistorico (
        HistoricoId   INT             IDENTITY(1,1) NOT NULL,
        VeiculoId     INT             NOT NULL,
        Tipo          VARCHAR(16)     NOT NULL,
        Titulo        NVARCHAR(160)   NOT NULL,
        Detalhe       NVARCHAR(1000)  NULL,
        -- Quem provocou o evento e sob qual concessionária. IDs sem FK (ver o
        -- cabeçalho) + nome gravado no momento do evento.
        UsuarioId     INT             NULL,
        UsuarioNome   NVARCHAR(120)   NULL,
        EmpresaId     INT             NULL,
        EmpresaNome   NVARCHAR(160)   NULL,
        -- Nº da reivindicação, do pedido, da campanha de recall...
        Referencia    VARCHAR(40)     NULL,
        Manual        BIT             NOT NULL CONSTRAINT DF_VeicHist_Manual   DEFAULT (0),
        DataEvento    DATETIME2(0)    NOT NULL CONSTRAINT DF_VeicHist_DataEv   DEFAULT (SYSUTCDATETIME()),
        CriadoEm      DATETIME2(0)    NOT NULL CONSTRAINT DF_VeicHist_CriadoEm DEFAULT (SYSUTCDATETIME()),
        CONSTRAINT PK_VeiculoHistorico PRIMARY KEY (HistoricoId),
        CONSTRAINT FK_VeicHist_Veiculo FOREIGN KEY (VeiculoId)
            REFERENCES dbo.Veiculo (VeiculoId) ON DELETE CASCADE,
        CONSTRAINT CK_VeicHist_Tipo CHECK (Tipo IN
            ('cadastro','atribuicao','transferencia','venda','garantia',
             'reivindicacao','recall','revisao','nota'))
    );

    -- A leitura é sempre "o histórico deste chassi, do mais recente para o mais
    -- antigo" — o índice cobre exatamente isso.
    CREATE INDEX IX_VeicHist_Veiculo_Data ON dbo.VeiculoHistorico (VeiculoId, DataEvento DESC);

    PRINT N'Tabela VeiculoHistorico criada.';

    /* ---------------------------------------------------------------------
       BACKFILL — o que já aconteceu antes desta migração
       ---------------------------------------------------------------------
       Sem isto, todo chassi já cadastrado abriria com um histórico vazio, o que
       dá a impressão errada de que nada aconteceu com ele. Reconstruímos o que
       o banco ainda sabe: entrada no estoque, venda, garantia e reivindicações.
       Não dá para reconstruir transferências passadas (nunca foram gravadas) —
       daqui para frente, sim.
       --------------------------------------------------------------------- */

    -- 1) Entrada no estoque (data de cadastro do chassi).
    INSERT INTO dbo.VeiculoHistorico (VeiculoId, Tipo, Titulo, Detalhe, EmpresaId, EmpresaNome, DataEvento)
    SELECT v.VeiculoId, 'cadastro', N'Chassi cadastrado',
           N'Registro reconstruído a partir da data de entrada no estoque.',
           v.EmpresaId, e.RazaoSocial,
           COALESCE(v.EntradaEstoque, v.CriadoEm)
      FROM dbo.Veiculo v
      LEFT JOIN dbo.Empresa e ON e.EmpresaId = v.EmpresaId;

    -- 2) Venda ao consumidor final.
    INSERT INTO dbo.VeiculoHistorico (VeiculoId, Tipo, Titulo, Detalhe, EmpresaId, EmpresaNome, DataEvento)
    SELECT v.VeiculoId, 'venda', N'Venda registrada',
           N'Cliente: ' + ISNULL(v.VendaCliente, N'—'),
           v.EmpresaId, e.RazaoSocial, v.VendaData
      FROM dbo.Veiculo v
      LEFT JOIN dbo.Empresa e ON e.EmpresaId = v.EmpresaId
     WHERE v.VendaData IS NOT NULL;

    -- 3) Ativação da garantia.
    INSERT INTO dbo.VeiculoHistorico (VeiculoId, Tipo, Titulo, Detalhe, EmpresaId, EmpresaNome, DataEvento)
    SELECT v.VeiculoId, 'garantia', N'Garantia ativada', NULL,
           v.EmpresaId, e.RazaoSocial, v.GarantiaAtivaEm
      FROM dbo.Veiculo v
      LEFT JOIN dbo.Empresa e ON e.EmpresaId = v.EmpresaId
     WHERE v.GarantiaAtivaEm IS NOT NULL;

    -- 4) Reivindicações de garantia abertas para o chassi.
    INSERT INTO dbo.VeiculoHistorico (VeiculoId, Tipo, Titulo, Detalhe, UsuarioId, UsuarioNome,
                                      EmpresaId, EmpresaNome, Referencia, DataEvento)
    SELECT r.VeiculoId, 'reivindicacao', N'Reivindicação aberta',
           LEFT(ISNULL(r.Descricao, N''), 1000),
           r.UsuarioId, u.Nome, r.EmpresaId, e.RazaoSocial, r.Numero, r.DataAbertura
      FROM dbo.Reivindicacao r
      LEFT JOIN dbo.Usuario u ON u.UsuarioId = r.UsuarioId
      LEFT JOIN dbo.Empresa e ON e.EmpresaId = r.EmpresaId
     WHERE r.VeiculoId IS NOT NULL;

    -- 5) Desfecho das reivindicações já aprovadas (a data existe na coluna).
    INSERT INTO dbo.VeiculoHistorico (VeiculoId, Tipo, Titulo, Detalhe,
                                      EmpresaId, EmpresaNome, Referencia, DataEvento)
    SELECT r.VeiculoId, 'reivindicacao', N'Reivindicação aprovada', NULL,
           r.EmpresaId, e.RazaoSocial, r.Numero, r.DataAprovacao
      FROM dbo.Reivindicacao r
      LEFT JOIN dbo.Empresa e ON e.EmpresaId = r.EmpresaId
     WHERE r.VeiculoId IS NOT NULL
       AND r.Status = 'Aprovada'
       AND r.DataAprovacao IS NOT NULL;

    PRINT N'Backfill do histórico concluído.';
END
ELSE
    PRINT N'Tabela VeiculoHistorico já existe — nada a fazer.';
GO

PRINT N'Migração 033 concluída.';
GO
