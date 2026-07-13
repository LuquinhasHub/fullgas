/* ============================================================================
   MIGRAÇÃO 018 — Exportação de pedidos ao Tiny ERP (docs/08-integracao-tiny.md)
   ----------------------------------------------------------------------------
   O estoque do Tiny é compartilhado com outro e-commerce (Magento); por isso,
   quando o cliente compra no Fullgas o pedido é criado no Tiny NA HORA e
   aprovado por lá (a aprovação baixa o estoque no Tiny — configurar a conta
   do Tiny para "lançar estoque na aprovação").

   Nova tabela TinyPedidoExport: fila/estado da exportação de cada pedido.
   - Escopo 'normal'   : itens em estoque, exportados na criação do pedido.
   - Escopo 'backorder': itens de pré-venda, exportados quando o admin libera
     o envio (vira um SEGUNDO pedido no Tiny). ItensJson guarda o snapshot do
     que foi liberado naquele momento (pode haver mais de uma liberação).
   - Status: 'pendente' → 'enviado' (criado E aprovado no Tiny). 'erro' aguarda
     retry (cron ou botão do admin); 'cancelado' desiste (pedido cancelado).
   - TinyPedidoId preenchido logo após a inclusão: um pedido NUNCA é incluído
     duas vezes no Tiny — se a aprovação falhar, o retry só reaprova.

   Idempotente: cada passo verifica antes de alterar. Pode rodar 2x.
   Rodar como administrador (fullgas_app não tem DDL):
     sqlcmd -E -S <servidor> -i 018_tiny_pedidos.sql
   (fullgas_app é db_datareader/db_datawriter: sem GRANT extra para a tabela.)
   ============================================================================ */

USE FullgasB2B;
GO

-- O índice filtrado (abaixo) exige QUOTED_IDENTIFIER ON; o sqlcmd roda OFF
-- por padrão.
SET QUOTED_IDENTIFIER ON;
GO

IF OBJECT_ID(N'dbo.TinyPedidoExport', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.TinyPedidoExport (
        ExportId      INT            IDENTITY(1,1) NOT NULL,
        PedidoId      INT            NOT NULL,
        Escopo        VARCHAR(10)    NOT NULL,  -- 'normal' | 'backorder'
        Status        VARCHAR(10)    NOT NULL
            CONSTRAINT DF_TinyPedidoExport_Status DEFAULT ('pendente'),
        TinyPedidoId  VARCHAR(40)    NULL,      -- id do pedido no Tiny (pós-inclusão)
        TinyNumero    VARCHAR(20)    NULL,      -- número do pedido no Tiny
        ItensJson     NVARCHAR(MAX)  NULL,      -- snapshot dos itens (só backorder)
        Tentativas    INT            NOT NULL
            CONSTRAINT DF_TinyPedidoExport_Tentativas DEFAULT (0),
        UltimoErro    NVARCHAR(500)  NULL,
        CriadoEm      DATETIME2(0)   NOT NULL
            CONSTRAINT DF_TinyPedidoExport_CriadoEm DEFAULT (SYSUTCDATETIME()),
        ExportadoEm   DATETIME2(0)   NULL,
        CONSTRAINT PK_TinyPedidoExport PRIMARY KEY (ExportId),
        CONSTRAINT FK_TinyPedidoExport_Pedido FOREIGN KEY (PedidoId)
            REFERENCES dbo.Pedido (PedidoId),
        CONSTRAINT CK_TinyPedidoExport_Escopo CHECK (Escopo IN ('normal', 'backorder')),
        CONSTRAINT CK_TinyPedidoExport_Status CHECK (Status IN ('pendente', 'enviado', 'erro', 'cancelado'))
    );

    CREATE INDEX IX_TinyPedidoExport_Status ON dbo.TinyPedidoExport (Status)
        INCLUDE (PedidoId, Escopo);
    CREATE INDEX IX_TinyPedidoExport_Pedido ON dbo.TinyPedidoExport (PedidoId);

    PRINT N'Tabela TinyPedidoExport criada.';
END
ELSE
    PRINT N'Tabela TinyPedidoExport já existe — nada a fazer.';
GO

/* Um pedido só gera UMA exportação 'normal' (a da criação). As de 'backorder'
   podem se repetir (uma por liberação de pré-venda), por isso o índice único
   é filtrado. */
IF NOT EXISTS (SELECT 1 FROM sys.indexes
                WHERE name = N'UX_TinyPedidoExport_Normal'
                  AND object_id = OBJECT_ID(N'dbo.TinyPedidoExport'))
BEGIN
    CREATE UNIQUE INDEX UX_TinyPedidoExport_Normal
        ON dbo.TinyPedidoExport (PedidoId) WHERE Escopo = 'normal';
    PRINT N'Índice UX_TinyPedidoExport_Normal criado.';
END
GO

PRINT N'Migração 018 concluída.';
GO
