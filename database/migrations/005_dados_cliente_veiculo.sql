-- ============================================================
-- Migração 005 — Dados do cliente na venda do veículo
-- ------------------------------------------------------------
-- A venda de um veículo passa a registrar dados detalhados do
-- comprador final, além do nome (VendaCliente, já existente):
--   ClienteCpf       — CPF do comprador
--   ClienteEmail     — e-mail pessoal
--   ClienteTelefone  — telefone de contato
--   ClienteEndereco  — endereço completo
-- Idempotente: seguro para rodar mais de uma vez.
-- Aplicar com admin (fullgas_app não tem DDL):
--   sqlcmd -S localhost -E -C -i database/migrations/005_dados_cliente_veiculo.sql
-- ============================================================
USE FullgasB2B;
GO

IF COL_LENGTH('dbo.Veiculo', 'ClienteCpf') IS NULL
    ALTER TABLE dbo.Veiculo ADD ClienteCpf VARCHAR(14) NULL;
GO

IF COL_LENGTH('dbo.Veiculo', 'ClienteEmail') IS NULL
    ALTER TABLE dbo.Veiculo ADD ClienteEmail NVARCHAR(160) NULL;
GO

IF COL_LENGTH('dbo.Veiculo', 'ClienteTelefone') IS NULL
    ALTER TABLE dbo.Veiculo ADD ClienteTelefone VARCHAR(30) NULL;
GO

IF COL_LENGTH('dbo.Veiculo', 'ClienteEndereco') IS NULL
    ALTER TABLE dbo.Veiculo ADD ClienteEndereco NVARCHAR(300) NULL;
GO
