// Normaliza nome de cadastro: sem espaços nas pontas, tudo em MAIÚSCULAS.
// toUpperCase preserva acentos (á -> Á).
export function padronizarNome(valor) {
  return String(valor ?? '').trim().toUpperCase();
}
