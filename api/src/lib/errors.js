// ============================================================
// Erros de aplicação (com status HTTP e mensagem segura ao cliente)
// ------------------------------------------------------------
// Os services lançam estes erros em vez de mexer em req/res. O tratador
// central (server.js) reconhece a marca `publica` e responde com o status e
// a mensagem certos; qualquer OUTRO erro continua virando 500 genérico —
// nada de vazar stack ou detalhe interno para o cliente.
// ============================================================

export class AppError extends Error {
  constructor(status, mensagem) {
    super(mensagem);
    this.name = 'AppError';
    this.status = status;
    this.publica = true;   // sinaliza ao tratador central que pode ir ao cliente
  }
}

export const erroValidacao = (msg) => new AppError(400, msg);
export const naoEncontrado = (msg = 'Recurso não encontrado.') => new AppError(404, msg);
export const conflito = (msg) => new AppError(409, msg);
