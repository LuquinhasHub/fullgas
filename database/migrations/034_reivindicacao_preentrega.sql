/* ============================================================================
   MIGRAÇÃO 034 — Garantia de PRÉ-ENTREGA
   ----------------------------------------------------------------------------
   Furo que esta migração fecha: a garantia por chassi só podia ser aberta com
   a venda já registrada (é a venda que ativa a garantia e começa o prazo de 90
   dias). Só que o defeito costuma aparecer ANTES — na inspeção de pré-entrega,
   quando a moto ainda está no estoque do revendedor. Nesse momento não há
   comprador, não há venda e, pela regra antiga, não havia como reclamar.

   A solução reaproveita o discriminador que já existe (Reivindicacao.Origem,
   migração 032) com um terceiro valor:

     • 'veiculo'    — garantia do consumidor, exige venda registrada.
     • 'varejo'     — garantia de peça de um pedido.
     • 'preentrega' — defeito achado na inspeção, com a moto AINDA NÃO VENDIDA.

   Por que um terceiro valor de Origem e não um Tipo novo: o que muda aqui é o
   conjunto de REGRAS (quem pode abrir, o que é exigido, o que é dispensado) —
   exatamente o papel que Origem já cumpre entre veículo e varejo. Tipo continua
   sendo a categoria da garantia (Manufacturer / Implícito).

   Nada mais muda de estrutura: a pré-entrega usa VeiculoId como a garantia
   comum. A diferença vive nas regras da API (reivindicacoes.routes.js):
   exige que o chassi NÃO tenha venda, dispensa a garantia ativa e — de
   propósito — NÃO ativa o prazo de 90 dias, que só deve começar a correr
   quando a moto for entregue ao consumidor.

   Idempotente: verifica antes de alterar. Pode rodar 2x.
   Rodar como administrador (fullgas_app não tem DDL):
     sqlcmd -E -C -f 65001 -S localhost -d FullgasB2B -i 034_reivindicacao_preentrega.sql
   ============================================================================ */

SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;
GO

USE FullgasB2B;
GO

/* O CHECK precisa ser recriado: não dá para "acrescentar" um valor a um
   CHECK existente. Derrubamos e criamos de novo com os três valores. */
IF EXISTS (SELECT 1 FROM sys.check_constraints
            WHERE name = N'CK_Reiv_Origem' AND parent_object_id = OBJECT_ID(N'dbo.Reivindicacao'))
BEGIN
    ALTER TABLE dbo.Reivindicacao DROP CONSTRAINT CK_Reiv_Origem;
    PRINT N'CHECK CK_Reiv_Origem antigo removido.';
END
GO

ALTER TABLE dbo.Reivindicacao WITH CHECK
    ADD CONSTRAINT CK_Reiv_Origem CHECK (Origem IN ('veiculo', 'varejo', 'preentrega'));
GO

PRINT N'CHECK CK_Reiv_Origem recriado com preentrega.';
GO

PRINT N'Migração 034 concluída.';
GO
