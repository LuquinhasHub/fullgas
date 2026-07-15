// ============================================================
// Validações de cadastro compartilhadas entre as rotas
// (auth.routes.js — registro público; conta.routes.js — painel
// "Minha conta" do gestor). O front aplica as mesmas regras nas
// máscaras, mas a API é quem garante.
// ============================================================

// Cidade: só letras (com acento), espaço, apóstrofo, ponto e hífen —
// cobre "Mogi-Mirim", "Santa Bárbara d'Oeste"... Sem dígitos/símbolos.
const RE_CIDADE = /^[A-Za-zÀ-ÖØ-öø-ÿ][A-Za-zÀ-ÖØ-öø-ÿ'. -]*$/;

// Valida o endereço do cadastro. Devolve a mensagem de erro ou null se ok.
export function erroEndereco(end) {
  if (!end || !end.logradouro || !end.numero || !end.bairro || !end.cidade || !end.uf || !end.cep)
    return 'Preencha o endereço (CEP, logradouro, número, bairro, cidade e UF).';
  if (String(end.cep).replace(/\D/g, '').length !== 8)
    return 'CEP inválido — use os 8 dígitos.';
  if (!/^\d{1,10}$/.test(String(end.numero).trim()))
    return 'Número do endereço deve conter apenas dígitos.';
  if (!RE_CIDADE.test(String(end.cidade).trim()))
    return 'Cidade não pode conter números ou caracteres especiais.';
  if (!/^[A-Za-z]{2}$/.test(String(end.uf).trim()))
    return 'UF inválida — use a sigla de 2 letras.';
  return null;
}

// Inscrição estadual (opcional): normaliza para maiúsculas e mantém só
// dígitos, letras, ponto, hífen, barra e espaço (formatos variam por UF;
// "ISENTO" também é aceito). Devolve null quando vazia/só lixo.
export function limparIe(v) {
  const ie = String(v || '').toUpperCase().replace(/[^0-9A-Z./ -]/g, '').trim().slice(0, 20);
  return ie || null;
}
