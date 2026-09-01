/* ============================================================================
   037 — Usuario.TokenVersion: permite REVOGAR sessoes ja emitidas
   ----------------------------------------------------------------------------
   O problema que esta coluna resolve:

   A sessao e' um JWT assinado. Ate aqui, uma vez emitido, ele valia ate a
   propria expiracao (JWT_EXPIRES, 8h por padrao) e NADA o derrubava antes
   disso — porque a API so conferia a assinatura, nunca reconsultava o banco.
   Na pratica:

     • Clicar em "Sair" so apagava o cookie do navegador. O token continuava
       valido; quem tivesse uma copia dele seguia entrando.
     • Redefinir a senha (inclusive por suspeita de invasao) NAO expulsava
       ninguem. O invasor com um token vivo continuava dentro por ate 8h,
       agora sem a vitima nem saber a senha nova.
     • Bloquear ou excluir um usuario, ou rebaixar um admin a cliente, so
       valia no LOGIN SEGUINTE. Ate la o token antigo carregava o papel
       antigo, e o requireAdmin acreditava nele.

   Como funciona: o token passa a carregar o numero desta coluna no claim
   `tv`. A cada requisicao, o middleware revalidarSessao (api/src/auth.js)
   compara o `tv` do token com o do banco. Incrementar a coluna invalida, na
   hora, TODAS as sessoes daquele usuario — em qualquer dispositivo.

   DEFAULT 0 para as linhas existentes: os tokens em circulacao no momento do
   deploy nascem sem o claim `tv`, e o middleware trata `undefined` como 0.
   Assim ninguem e' deslogado pela migracao em si.

   Idempotente: o deploy.sh roda todas as migrations a cada publicacao.
   ============================================================================ */

USE FullgasB2B;
GO

IF COL_LENGTH('dbo.Usuario', 'TokenVersion') IS NULL
BEGIN
    ALTER TABLE dbo.Usuario
        ADD TokenVersion INT NOT NULL
            CONSTRAINT DF_Usuario_TokenVersion DEFAULT (0);
    PRINT N'037: coluna Usuario.TokenVersion criada.';
END
ELSE
    PRINT N'037: Usuario.TokenVersion ja existe — nada a fazer.';
GO
