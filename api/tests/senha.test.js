// Política de senha (Fase 6). Regra ÚNICA para os cinco pontos que definem
// senha: cadastro público, redefinição por e-mail, criação de admin, criação
// de conta interna e reset dessa conta pelo gestor. Antes cada um repetia o
// próprio `length < 6` — e o de admin usava 8, divergência que ninguém via
// porque estava espalhada.
import { describe, it, expect } from 'vitest';
import { erroSenha, SENHA_MINIMA } from '../src/validacao.js';

const ok = s => expect(erroSenha(s, { email: 'lucas@oficina.com.br', nome: 'Lucas Ferreira' })).toBe(null);
const recusa = s => expect(erroSenha(s, { email: 'lucas@oficina.com.br', nome: 'Lucas Ferreira' })).toBeTruthy();

describe('erroSenha', () => {
  it('o mínimo é 8', () => {
    expect(SENHA_MINIMA).toBe(8);
    recusa('Abc123!');        // 7
    ok('Abc123!x');           // 8
  });

  it('aceita frase longa sem símbolo (comprimento é o que vale)', () => {
    // Não exigimos maiúscula/número/símbolo de propósito: essas regras
    // empurram para "Senha@123" e penalizam frases, que são melhores.
    ok('cavalo bateria grampo azul');
    ok('minha oficina fica na esquina');
  });

  it('recusa as triviais conhecidas, inclusive as deste projeto', () => {
    ['12345678', 'password', 'senha123', 'admin123', 'cliente123'].forEach(recusa);
  });

  it('recusa caractere repetido e sequência de teclado', () => {
    recusa('aaaaaaaa');
    recusa('abcdefgh');
    recusa('12345678');
  });

  it('recusa senha que contém o próprio e-mail ou nome', () => {
    // É o primeiro palpite de quem tem a lista de cadastros em mãos — que é
    // exatamente o que um vazamento de banco entrega.
    recusa('lucas12345');
    recusa('senhaDoLucasFerreira');
  });

  it('não se confunde com trecho curto do e-mail', () => {
    // Local part curta (2 chars) não deve bloquear meio mundo.
    expect(erroSenha('barquinho azul', { email: 'ab@x.com' })).toBe(null);
  });

  it('recusa acima de 72 BYTES (limite silencioso do bcrypt)', () => {
    // Sem este teto, duas senhas longas com o mesmo começo seriam a MESMA
    // senha no login, e ninguém entenderia por quê.
    // Senha variada, para nao esbarrar na regra de caractere repetido.
    const longa = 'frase-longa-de-senha-para-testar-o-limite-do-bcrypt-aqui-vamos-nos-ok';
    expect(longa.length).toBeLessThanOrEqual(72);
    ok(longa);
    recusa(longa + 'mais-alguns-caracteres-para-passar-de-72');
    // Acentos ocupam 2 bytes: 40 caracteres já passam de 72 bytes.
    recusa('á'.repeat(40));
  });

  it('min configurável (o admin usa 8, mas a porta existe)', () => {
    expect(erroSenha('abc123XY', { min: 12 })).toBeTruthy();
    expect(erroSenha('abc123XYZabc', { min: 12 })).toBe(null);
  });

  it('vazio e nulo são recusados, sem explodir', () => {
    expect(erroSenha('')).toBeTruthy();
    expect(erroSenha(null)).toBeTruthy();
    expect(erroSenha(undefined)).toBeTruthy();
  });
});

describe('nome da empresa na senha', () => {
  // Regra e nao lista: enumerar as variantes exigiria escrever as senhas reais
  // num arquivo versionado. Ver o comentario de MARCA em validacao.js.
  it('recusa qualquer senha construida sobre "fullgas"', () => {
    ['Fullgas2026', 'fullgas123', 'FullGas!2026', 'minhafullgassenha']
      .forEach(p => expect(erroSenha(p)).toBeTruthy());
  });

  it('nao recusa senha que so menciona o ramo', () => {
    expect(erroSenha('oficina da esquina 2026')).toBe(null);
  });
});
