-- ============================================================
-- 027 — Cria subcategorias e classifica os produtos importados.
-- Os produtos vindos do Tiny caíram quase todos em "Acessórios Técnicos".
-- Esta migração cria subcategorias sob "Peças de Reposição" (pecas) e move
-- cada produto para a categoria/subcategoria adequada, por palavra-chave do
-- nome. Produtos que não casam com nenhuma regra ficam onde estão.
-- Idempotente: as subcategorias só são criadas se faltarem; o UPDATE é seguro
-- de repetir (sempre reclassifica pelo nome).
-- ============================================================
SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;
SET XACT_ABORT ON;
GO

BEGIN TRAN;

DECLARE @pecas INT = (SELECT CategoriaId FROM dbo.Categoria WHERE Codigo = 'pecas');
DECLARE @ord   INT = (SELECT ISNULL(MAX(Ordem), 0) FROM dbo.Categoria);

-- 1) Subcategorias de "Peças de Reposição" (cria as que faltarem).
-- Nomes acentuados montados com NCHAR() (á=225, ã=227, é=233, ç=231) para o
-- arquivo ser 100% ASCII e não depender do encoding com que o sqlcmd o lê.
DECLARE @subs TABLE (Codigo VARCHAR(40), Nome NVARCHAR(120), Seq INT);
INSERT INTO @subs (Codigo, Nome, Seq) VALUES
  ('freios',      N'Freios',                                                     1),
  ('transmissao', N'Transmiss' + NCHAR(227) + N'o',                              2),  -- Transmissão
  ('carenagem',   N'Carenagem e Pl' + NCHAR(225) + N'sticos',                    3),  -- Carenagem e Plásticos
  ('eletrica',    N'El' + NCHAR(233) + N'trica e Bateria',                       4),  -- Elétrica e Bateria
  ('comandos',    N'Comandos e Guid' + NCHAR(227) + N'o',                        5),  -- Comandos e Guidão
  ('ferragens',   N'Fixa' + NCHAR(231) + NCHAR(227) + N'o e Ferragens',          6);  -- Fixação e Ferragens

INSERT INTO dbo.Categoria (Codigo, Nome, Icone, Ordem, Ativo, ParentId)
SELECT s.Codigo, s.Nome, NULL, @ord + s.Seq, 1, @pecas
  FROM @subs s
 WHERE NOT EXISTS (SELECT 1 FROM dbo.Categoria c WHERE c.Codigo = s.Codigo);

-- 2) Classificação por palavra-chave (primeira regra que casar vence).
;WITH alvo AS (
  SELECT p.ProdutoId,
    CASE
      WHEN UPPER(p.Nome) LIKE N'%FREIO%'                                        THEN 'freios'
      WHEN UPPER(p.Nome) LIKE N'%PINHAO%' OR UPPER(p.Nome) LIKE N'%COROA%'
        OR UPPER(p.Nome) LIKE N'%CORRENTE%' OR UPPER(p.Nome) LIKE N'%ROLETE%'   THEN 'transmissao'
      WHEN UPPER(p.Nome) LIKE N'%BATERIA%'                                      THEN 'eletrica'
      WHEN UPPER(p.Nome) LIKE N'%ACELERADOR%' OR UPPER(p.Nome) LIKE N'%MANOPLA%' THEN 'comandos'
      WHEN UPPER(p.Nome) LIKE N'%PARA-LAMA%' OR UPPER(p.Nome) LIKE N'%ALETA%'
        OR UPPER(p.Nome) LIKE N'%TANQUE%'                                       THEN 'carenagem'
      WHEN UPPER(p.Nome) LIKE N'%TRAVA%' OR UPPER(p.Nome) LIKE N'% DIN%'        THEN 'ferragens'
      WHEN UPPER(p.Nome) LIKE N'%CAMISETA%' OR UPPER(p.Nome) LIKE N'%MOLETOM%'
        OR UPPER(p.Nome) LIKE N'%BONE%'                                        THEN 'vestuario'
      WHEN UPPER(p.Nome) LIKE N'%ADESIVO%' OR UPPER(p.Nome) LIKE N'%BANDEIROLA%'
        OR UPPER(p.Nome) LIKE N'%CHAVEIRO%' OR UPPER(p.Nome) LIKE N'%TAPETE%'
        OR UPPER(p.Nome) LIKE N'%TENDA%'                                        THEN 'marketing'
      ELSE NULL
    END AS Codigo
  FROM dbo.Produto p
)
UPDATE p
   SET p.CategoriaId = c.CategoriaId, p.AtualizadoEm = SYSUTCDATETIME()
  FROM dbo.Produto p
  JOIN alvo a ON a.ProdutoId = p.ProdutoId
  JOIN dbo.Categoria c ON c.Codigo = a.Codigo
 WHERE a.Codigo IS NOT NULL
   AND p.CategoriaId <> c.CategoriaId;

COMMIT;
GO
