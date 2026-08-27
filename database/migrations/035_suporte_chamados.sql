/* ============================================================================
   MIGRAÇÃO 035 — Suporte Técnico (helpdesk por chamados)
   ----------------------------------------------------------------------------
   O canal que faltava: hoje o revendedor com dúvida liga, manda WhatsApp ou
   e-mail, e nada disso fica registrado no portal. Nasce aqui um helpdesk por
   CHAMADO (ticket), não um chat ao vivo — ninguém precisa estar do outro lado
   no mesmo instante, e a conversa inteira fica guardada com o chamado.

   Duas tabelas:

     SuporteChamado    o chamado em si: quem abriu, de qual concessionária,
                       categoria de ajuda, assunto, prioridade e status.
     SuporteMensagem   a conversa. A primeira mensagem é a descrição escrita
                       pelo revendedor; as seguintes são as respostas do
                       suporte e as réplicas dele. Anexo opcional por mensagem,
                       gravado em /uploads/suporte (o banco guarda a URL
                       relativa, como notificações e reivindicações).

   POR QUE NÃO EXISTE UMA TABELA DE CATEGORIAS
   As categorias de ajuda espelham as ÁREAS DO SITE (Pedidos, Loja, Garantia,
   Parts Finder, Conta financeira...) — elas mudam quando o portal ganha uma
   área nova, junto com o código, não por cadastro do dia a dia. Ficam em
   api/src/utils/suporte.js e o banco guarda só o código curto (ASCII). De
   quebra, nenhum texto acentuado precisa entrar por esta migração — ver a nota
   de encoding abaixo.

   NÚMERO DO CHAMADO: não há sequência nova. O número mostrado ao usuário
   ("CH-000123") é derivado do ChamadoId pela API. Sequência exigiria GRANT
   UPDATE para o fullgas_app (ver database/criar_usuario_app.sql); o IDENTITY
   já resolve, e a leitura/escrita de tabela nova o db_datawriter cobre sozinho.

   NOTA DE ENCODING: este arquivo é ASCII em todo literal de dado (o texto
   acentuado só aparece em comentário, que o SQL Server ignora). O laço de
   migrations do deploy.sh roda `sqlcmd < arquivo` SEM -f 65001, então o
   conteúdo é lido na codepage do console — literal acentuado sairia corrompido
   no banco. Mesma precaução da migração 028.

   Idempotente: verifica antes de criar. Pode rodar quantas vezes for preciso.
   Rodar como administrador (fullgas_app não tem DDL):
     sqlcmd -E -C -f 65001 -S localhost -d FullgasB2B -i 035_suporte_chamados.sql
   ============================================================================ */

SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;
GO

USE FullgasB2B;
GO

IF OBJECT_ID('dbo.SuporteChamado', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.SuporteChamado (
        ChamadoId    INT IDENTITY(1,1) NOT NULL
                     CONSTRAINT PK_SuporteChamado PRIMARY KEY,
        -- De quem é o chamado. A empresa é a dona (qualquer conta da
        -- concessionária acompanha); o usuário é quem abriu.
        EmpresaId    INT NOT NULL
                     CONSTRAINT FK_SupChamado_Empresa REFERENCES dbo.Empresa (EmpresaId),
        UsuarioId    INT NOT NULL
                     CONSTRAINT FK_SupChamado_Usuario REFERENCES dbo.Usuario (UsuarioId),
        -- Código curto da categoria de ajuda (ver api/src/utils/suporte.js).
        -- Sem CHECK de propósito: a lista muda com o portal, e um valor
        -- aposentado não pode invalidar chamado antigo já gravado.
        Categoria    VARCHAR(30) NOT NULL,
        Assunto      NVARCHAR(160) NOT NULL,
        Prioridade   VARCHAR(10) NOT NULL
                     CONSTRAINT DF_SupChamado_Prioridade DEFAULT 'normal',
        Status       VARCHAR(24) NOT NULL
                     CONSTRAINT DF_SupChamado_Status DEFAULT 'Aberto',
        -- Administrador que respondeu por último (quem está atendendo).
        AtendenteId  INT NULL
                     CONSTRAINT FK_SupChamado_Atendente REFERENCES dbo.Usuario (UsuarioId),
        CriadoEm     DATETIME2 NOT NULL
                     CONSTRAINT DF_SupChamado_CriadoEm DEFAULT SYSUTCDATETIME(),
        -- Carimbo da última movimentação (mensagem ou troca de status). É por
        -- ele que as listas ordenam: o que se mexeu vai para o topo.
        AtualizadoEm DATETIME2 NOT NULL
                     CONSTRAINT DF_SupChamado_AtualizadoEm DEFAULT SYSUTCDATETIME(),
        FechadoEm    DATETIME2 NULL,
        CONSTRAINT CK_SupChamado_Prioridade CHECK (Prioridade IN ('baixa', 'normal', 'alta')),
        CONSTRAINT CK_SupChamado_Status CHECK (Status IN
            ('Aberto', 'Em atendimento', 'Aguardando cliente', 'Resolvido', 'Fechado'))
    );
    -- A lista do revendedor (a sua concessionária, mais recente primeiro).
    CREATE INDEX IX_SupChamado_Empresa ON dbo.SuporteChamado (EmpresaId, AtualizadoEm DESC);
    -- A fila do atendente (por status, mais recente primeiro).
    CREATE INDEX IX_SupChamado_Status ON dbo.SuporteChamado (Status, AtualizadoEm DESC);
    PRINT 'Tabela dbo.SuporteChamado criada.';
END
GO

IF OBJECT_ID('dbo.SuporteMensagem', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.SuporteMensagem (
        MensagemId    INT IDENTITY(1,1) NOT NULL
                      CONSTRAINT PK_SuporteMensagem PRIMARY KEY,
        ChamadoId     INT NOT NULL
                      CONSTRAINT FK_SupMsg_Chamado REFERENCES dbo.SuporteChamado (ChamadoId)
                      ON DELETE CASCADE,
        -- NULL só para autor 'sistema' (registro automático de mudança de status).
        UsuarioId     INT NULL
                      CONSTRAINT FK_SupMsg_Usuario REFERENCES dbo.Usuario (UsuarioId),
        Autor         VARCHAR(10) NOT NULL,
        Texto         NVARCHAR(4000) NULL,
        AnexoUrl      VARCHAR(400) NULL,
        AnexoTipo     VARCHAR(20) NULL,   -- 'imagem' | 'video' | 'arquivo'
        CriadoEm      DATETIME2 NOT NULL
                      CONSTRAINT DF_SupMsg_CriadoEm DEFAULT SYSUTCDATETIME(),
        -- Leitura por LADO, não por usuário: o que importa é "o revendedor já
        -- viu a resposta do suporte?" e "o suporte já viu a réplica dele?".
        -- É o que alimenta o contador do pop-up flutuante e o do painel.
        LidaClienteEm DATETIME2 NULL,
        LidaAdminEm   DATETIME2 NULL,
        CONSTRAINT CK_SupMsg_Autor CHECK (Autor IN ('cliente', 'admin', 'sistema'))
    );
    CREATE INDEX IX_SupMsg_Chamado ON dbo.SuporteMensagem (ChamadoId, CriadoEm);
    PRINT 'Tabela dbo.SuporteMensagem criada.';
END
GO

PRINT 'Migracao 035 concluida: SuporteChamado + SuporteMensagem.';
GO
