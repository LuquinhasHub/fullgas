/* ============================================================
   Cria um login/usuário dedicado para a API (boa prática:
   a aplicação NÃO deve usar a conta 'sa').
   Rode no SSMS conectado como administrador, UMA vez.
   Troque 'SENHA_FORTE_AQUI' por uma senha forte de verdade.
   ============================================================ */

-- 1) Login no nível do servidor
IF NOT EXISTS (SELECT 1 FROM sys.server_principals WHERE name = N'fullgas_app')
BEGIN
    CREATE LOGIN fullgas_app
        WITH PASSWORD = N'SENHA_FORTE_AQUI',
             CHECK_POLICY = ON;
END
GO

-- 2) Usuário dentro do banco FullgasB2B
USE FullgasB2B;
GO

IF NOT EXISTS (SELECT 1 FROM sys.database_principals WHERE name = N'fullgas_app')
BEGIN
    CREATE USER fullgas_app FOR LOGIN fullgas_app;
END
GO

-- 3) Permissões de leitura e escrita nos dados (sem poder alterar o schema)
ALTER ROLE db_datareader ADD MEMBER fullgas_app;
ALTER ROLE db_datawriter ADD MEMBER fullgas_app;
GO

PRINT N'Usuário fullgas_app criado. Use estas credenciais no .env (DB_USER / DB_PASSWORD).';
GO

/* ------------------------------------------------------------
   IMPORTANTE: a API usa autenticação SQL (usuário + senha).
   Por padrão, o SQL Server pode estar só em "Windows Authentication".
   Para habilitar o modo misto (necessário p/ o login acima):

   1. No SSMS: clique direito no servidor > Properties > Security
      > marque "SQL Server and Windows Authentication mode" > OK.
   2. Reinicie o serviço: SQL Server Configuration Manager
      > SQL Server Services > SQL Server (MSSQLSERVER) > Restart.

   Confirme também que o TCP/IP está habilitado na porta 1433:
   Configuration Manager > SQL Server Network Configuration
   > Protocols > TCP/IP = Enabled.
   ------------------------------------------------------------ */
