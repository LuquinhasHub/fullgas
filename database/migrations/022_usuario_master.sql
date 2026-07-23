USE FullgasB2B;
GO

-- ============================================================
-- 022 — Usuário MASTER + proteção contra exclusão
-- ------------------------------------------------------------
-- Master = conta suprema do sistema (master@fullgas.com.br):
--   * não pode ser apagada por NINGUÉM, em nenhuma hipótese —
--     a API recusa (DELETE /usuarios/:id) e, como última linha
--     de defesa, o trigger TR_Usuario_ProtegeMaster desfaz
--     qualquer DELETE que atinja um Master=1, mesmo vindo de
--     SQL direto no banco;
--   * também não pode ser bloqueada/rebaixada pela API.
-- Idempotente: roda quantas vezes for preciso.
-- ============================================================
SET QUOTED_IDENTIFIER ON;

IF COL_LENGTH('dbo.Usuario', 'Master') IS NULL
  ALTER TABLE dbo.Usuario ADD Master BIT NOT NULL
    CONSTRAINT DF_Usuario_Master DEFAULT 0;
GO

-- Trigger: qualquer DELETE que inclua um usuário Master é revertido inteiro.
CREATE OR ALTER TRIGGER dbo.TR_Usuario_ProtegeMaster
ON dbo.Usuario
AFTER DELETE
AS
BEGIN
  SET NOCOUNT ON;
  IF EXISTS (SELECT 1 FROM deleted WHERE Master = 1)
  BEGIN
    ROLLBACK TRANSACTION;
    THROW 50001, 'O usuário master não pode ser excluído.', 1;
  END
END;
GO

-- Cria o usuário master (uma única vez) na empresa FULLGAS MOTOS (matriz).
-- Senha inicial definida pela equipe; trocar depois do primeiro acesso.
--
-- O teste da empresa é obrigatório: em banco NOVO (servidor recém-provisionado,
-- sem os seeds) a subconsulta devolve NULL e o INSERT morre em EmpresaId NOT
-- NULL, abortando a migração. Sem a matriz cadastrada não há onde pendurar o
-- master — e a 023 logo abaixo o remove de qualquer forma —, então o certo é
-- simplesmente pular.
IF EXISTS (SELECT 1 FROM dbo.Empresa WHERE RazaoSocial = 'FULLGAS MOTOS')
AND NOT EXISTS (SELECT 1 FROM dbo.Usuario WHERE Email = 'master@fullgas.com.br')
  INSERT INTO dbo.Usuario (EmpresaId, Nome, Email, SenhaHash, Papel, Status, Gestor, Master)
  VALUES (
    (SELECT EmpresaId FROM dbo.Empresa WHERE RazaoSocial = 'FULLGAS MOTOS'),
    N'Master Fullgas',
    'master@fullgas.com.br',
    CONVERT(VARBINARY(256), '$2a$10$tA5yUqEaKKMXLXMyVlV7GO./WGSQY.wcuW7.y4b9TrnrZaGN2LCfC'),
    'admin', 'aprovado', 1, 1
  );
ELSE
  UPDATE dbo.Usuario SET Master = 1, Papel = 'admin', Status = 'aprovado'
   WHERE Email = 'master@fullgas.com.br';
GO

PRINT '022 aplicada: Usuario.Master + trigger de proteção + master@fullgas.com.br';
