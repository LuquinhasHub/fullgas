-- ============================================================
-- 024 — Notificações do admin para as concessionárias
-- ------------------------------------------------------------
-- Notificacao       mensagem enviada pelo admin. EmpresaId NULL =
--                   todas as concessionárias; preenchido = só uma.
--                   Anexo opcional (imagem/vídeo/arquivo) gravado
--                   em /uploads/notificacoes (o banco guarda a URL
--                   relativa, como no finder).
-- NotificacaoLida   estado de leitura POR USUÁRIO (a mesma
--                   notificação pode estar lida p/ um usuário da
--                   concessionária e não lida p/ outro).
-- Idempotente: roda quantas vezes for preciso.
--
-- OBS: o schema INICIAL do banco tinha uma dbo.Notificacao antiga
-- (UsuarioId + Lida inline + DataEnvio) que NUNCA foi usada pela
-- API — só continha linhas de seed demo. Ela é PRESERVADA com o
-- nome NotificacaoLegado (detecção: falta a coluna CriadoEm) e a
-- nova é criada no formato atual.
-- ============================================================
SET QUOTED_IDENTIFIER ON;

IF OBJECT_ID('dbo.Notificacao', 'U') IS NOT NULL
   AND COL_LENGTH('dbo.Notificacao', 'CriadoEm') IS NULL
BEGIN
  -- NotificacaoLida desta própria migração (vazia), apontando p/ a tabela
  -- antiga: sai para ser recriada contra a nova.
  IF OBJECT_ID('dbo.NotificacaoLida', 'U') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM dbo.NotificacaoLida)
    DROP TABLE dbo.NotificacaoLida;
  EXEC sp_rename 'dbo.Notificacao', 'NotificacaoLegado';
END
GO

-- O rename NÃO renomeia as constraints — os nomes antigos liberariam
-- conflito com os da tabela nova.
IF OBJECT_ID('dbo.NotificacaoLegado', 'U') IS NOT NULL
   AND OBJECT_ID('dbo.PK_Notificacao') IS NOT NULL
   AND OBJECT_ID('dbo.Notificacao', 'U') IS NULL
  EXEC sp_rename 'dbo.PK_Notificacao', 'PK_NotificacaoLegado', 'OBJECT';
GO

IF OBJECT_ID('dbo.Notificacao', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.Notificacao (
    NotificacaoId INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_Notificacao PRIMARY KEY,
    EmpresaId     INT NULL CONSTRAINT FK_Notificacao_Empresa REFERENCES dbo.Empresa (EmpresaId),
    Titulo        NVARCHAR(160) NOT NULL,
    Texto         NVARCHAR(2000) NULL,
    Tipo          VARCHAR(10) NOT NULL CONSTRAINT DF_Notificacao_Tipo DEFAULT 'info',
    AnexoUrl      VARCHAR(400) NULL,
    AnexoTipo     VARCHAR(20) NULL,   -- 'imagem' | 'video' | 'arquivo'
    CriadoPor     INT NULL CONSTRAINT FK_Notificacao_Usuario REFERENCES dbo.Usuario (UsuarioId),
    CriadoEm      DATETIME2 NOT NULL CONSTRAINT DF_Notificacao_CriadoEm DEFAULT SYSUTCDATETIME(),
    CONSTRAINT CK_Notificacao_Tipo CHECK (Tipo IN ('info', 'critica'))
  );
  CREATE INDEX IX_Notificacao_Empresa ON dbo.Notificacao (EmpresaId, CriadoEm DESC);
END
GO

IF OBJECT_ID('dbo.NotificacaoLida', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.NotificacaoLida (
    NotificacaoId INT NOT NULL CONSTRAINT FK_NotifLida_Notificacao
      REFERENCES dbo.Notificacao (NotificacaoId) ON DELETE CASCADE,
    UsuarioId     INT NOT NULL CONSTRAINT FK_NotifLida_Usuario REFERENCES dbo.Usuario (UsuarioId),
    LidaEm        DATETIME2 NOT NULL CONSTRAINT DF_NotifLida_LidaEm DEFAULT SYSUTCDATETIME(),
    CONSTRAINT PK_NotificacaoLida PRIMARY KEY (NotificacaoId, UsuarioId)
  );
END
GO

PRINT '024 aplicada: Notificacao + NotificacaoLida';
