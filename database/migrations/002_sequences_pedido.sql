/* ============================================================================
   MIGRAÇÃO 002 — Sequências de numeração (pedidos, faturas, entregas, rastreios)
   ----------------------------------------------------------------------------
   A Frente 1.1 (Pedidos) passa a gerar números no banco, não mais no front.
   Em vez de contar linhas (sujeito a corrida), usamos SEQUENCE do SQL Server:
   cada NEXT VALUE FOR é atômico e nunca repete.

   Os valores iniciais começam ACIMA do maior número já presente nos seeds,
   para não colidir com os índices UNIQUE existentes:
     - Pedido   max seed '0005041877' -> parte sequencial 41877  -> START 41878
     - Fatura   max seed '1726017668'                            -> START 1726017669
     - Entrega  max seed '0050731002' -> 50731002                -> START 50731003
     - Rastreio seeds na faixa 000519361..000521104             -> START 521200

   Idempotente: pode rodar 2x sem erro (checa sys.sequences antes de criar).
   ============================================================================ */

USE FullgasB2B;
GO

IF NOT EXISTS (SELECT 1 FROM sys.sequences WHERE name = N'Seq_NumeroPedido' AND schema_id = SCHEMA_ID(N'dbo'))
    CREATE SEQUENCE dbo.Seq_NumeroPedido  AS INT    START WITH 41878      INCREMENT BY 1;
GO

IF NOT EXISTS (SELECT 1 FROM sys.sequences WHERE name = N'Seq_NumeroFatura' AND schema_id = SCHEMA_ID(N'dbo'))
    CREATE SEQUENCE dbo.Seq_NumeroFatura  AS BIGINT START WITH 1726017669 INCREMENT BY 1;
GO

IF NOT EXISTS (SELECT 1 FROM sys.sequences WHERE name = N'Seq_NumeroEntrega' AND schema_id = SCHEMA_ID(N'dbo'))
    CREATE SEQUENCE dbo.Seq_NumeroEntrega AS INT    START WITH 50731003    INCREMENT BY 1;
GO

IF NOT EXISTS (SELECT 1 FROM sys.sequences WHERE name = N'Seq_RastreioEntrega' AND schema_id = SCHEMA_ID(N'dbo'))
    CREATE SEQUENCE dbo.Seq_RastreioEntrega AS INT  START WITH 521200      INCREMENT BY 1;
GO

/* A API roda como o usuário limitado fullgas_app (db_datareader/datawriter).
   Usar NEXT VALUE FOR exige permissão UPDATE na sequência. Concedemos aqui,
   se o usuário já existir (em deploy novo ele é criado depois — nesse caso o
   GRANT equivalente está em criar_usuario_app.sql). Idempotente. */
IF EXISTS (SELECT 1 FROM sys.database_principals WHERE name = N'fullgas_app')
BEGIN
    GRANT UPDATE ON OBJECT::dbo.Seq_NumeroPedido    TO fullgas_app;
    GRANT UPDATE ON OBJECT::dbo.Seq_NumeroFatura    TO fullgas_app;
    GRANT UPDATE ON OBJECT::dbo.Seq_NumeroEntrega   TO fullgas_app;
    GRANT UPDATE ON OBJECT::dbo.Seq_RastreioEntrega TO fullgas_app;
    PRINT N'Permissão de uso das sequências concedida a fullgas_app.';
END
GO

PRINT N'Migração 002 concluída (sequências de numeração criadas).';
GO
