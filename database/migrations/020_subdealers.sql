USE FullgasB2B;
GO

/* ============================================================================
   020 — Sub-dealers (contas internas da concessionária)
   ----------------------------------------------------------------------------
   O cliente "gestor" (a conta que se cadastrou) pode criar contas internas
   para os funcionários da concessionária e restringir áreas do site
   (loja, finder, pedidos, financeiro, reivindicações, estoque, ações).

   - Gestor     BIT: 1 = conta principal da empresa (gerencia as internas).
                 Todas as contas já existentes viram gestoras.
   - Permissoes VARCHAR(400): JSON array com as ÁREAS PERMITIDAS
                 (ex.: '["loja","pedidos"]'). NULL = acesso total.
   Idempotente — pode rodar mais de uma vez.
   ============================================================================ */
SET QUOTED_IDENTIFIER ON;
GO

IF COL_LENGTH('dbo.Usuario', 'Gestor') IS NULL
BEGIN
    ALTER TABLE dbo.Usuario ADD
        Gestor     BIT          NOT NULL CONSTRAINT DF_Usuario_Gestor DEFAULT (0),
        Permissoes VARCHAR(400) NULL;
END
GO

/* Contas pré-existentes são as principais das suas empresas. */
IF NOT EXISTS (SELECT 1 FROM dbo.Usuario WHERE Gestor = 1)
    UPDATE dbo.Usuario SET Gestor = 1;
GO
