USE FullgasB2B;
GO

-- ============================================================
-- 031 — Foto da categoria.
-- Adiciona Imagem à Categoria: URL relativa (/uploads/categorias/...) da foto
-- enviada pelo painel admin. NULL = sem foto (a loja cai no ícone SVG padrão).
-- Idempotente.
-- ============================================================
SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;
GO

IF COL_LENGTH('dbo.Categoria', 'Imagem') IS NULL
BEGIN
    ALTER TABLE dbo.Categoria ADD Imagem VARCHAR(255) NULL;
END
GO
