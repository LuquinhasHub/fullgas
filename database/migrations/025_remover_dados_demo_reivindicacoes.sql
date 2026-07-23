USE FullgasB2B;
GO

-- ============================================================
-- 025 — Remove os dados de DEMONSTRAÇÃO de reivindicações.
-- O "quadro de reivindicações" do admin já é dinâmico (vem da API), mas o
-- banco trazia 6 reivindicações de exemplo (do fullgas_seeds.sql) presas a
-- concessionárias "fantasma" — empresas que só existiam para segurar essas
-- reivindicações, sem usuário, pedido, fatura ou veículo real.
--
-- Esta migração:
--   1) apaga as 6 reivindicações de exemplo (por Numero fixo) e seus filhos;
--   2) apaga as 4 concessionárias fantasma (GOX POWERSPORTS, BK OFF ROAD,
--      M4 RACING-PR, ART MOTO RACING) — só se estiverem realmente vazias.
--
-- POWER MOTOS LTDA e SILVA RACING são PRESERVADAS (a 1ª tem login e histórico
-- real; a 2ª foi mantida por escolha do dono). As reivindicações reais criadas
-- pelos clientes (números aleatórios) NÃO são tocadas — o alvo é por Numero.
-- Idempotente: rodar de novo não faz nada.
-- ============================================================
SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;
SET XACT_ABORT ON;
BEGIN TRAN;

DECLARE @demo TABLE (Numero VARCHAR(20) PRIMARY KEY);
INSERT INTO @demo (Numero) VALUES
  ('12094338'), ('12079465'), ('12079380'), ('12071122'), ('12065540'), ('12060071');

-- 1) Filhos + reivindicações demo.
DELETE ap
  FROM dbo.ReivindicacaoAnexo ap
  JOIN dbo.Reivindicacao r ON r.ReivindicacaoId = ap.ReivindicacaoId
 WHERE r.Numero IN (SELECT Numero FROM @demo);

DELETE pp
  FROM dbo.ReivindicacaoPeca pp
  JOIN dbo.Reivindicacao r ON r.ReivindicacaoId = pp.ReivindicacaoId
 WHERE r.Numero IN (SELECT Numero FROM @demo);

DELETE FROM dbo.Reivindicacao
 WHERE Numero IN (SELECT Numero FROM @demo);

-- 2) Concessionárias fantasma — apaga só se não sobrou nenhum vínculo.
--    (Endereco tem ON DELETE CASCADE; os demais são NO_ACTION, por isso os guards.)
DELETE e
  FROM dbo.Empresa e
 WHERE e.RazaoSocial IN (N'GOX POWERSPORTS', N'BK OFF ROAD', N'M4 RACING-PR', N'ART MOTO RACING')
   AND NOT EXISTS (SELECT 1 FROM dbo.Usuario u       WHERE u.EmpresaId = e.EmpresaId)
   AND NOT EXISTS (SELECT 1 FROM dbo.Pedido p        WHERE p.EmpresaId = e.EmpresaId)
   AND NOT EXISTS (SELECT 1 FROM dbo.Fatura f        WHERE f.EmpresaId = e.EmpresaId)
   AND NOT EXISTS (SELECT 1 FROM dbo.Entrega en      WHERE en.EmpresaId = e.EmpresaId)
   AND NOT EXISTS (SELECT 1 FROM dbo.Veiculo v       WHERE v.EmpresaId = e.EmpresaId)
   AND NOT EXISTS (SELECT 1 FROM dbo.Reivindicacao r WHERE r.EmpresaId = e.EmpresaId)
   AND NOT EXISTS (SELECT 1 FROM dbo.Notificacao n   WHERE n.EmpresaId = e.EmpresaId);

COMMIT;
GO
