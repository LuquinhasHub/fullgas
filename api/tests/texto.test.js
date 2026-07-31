import { describe, it, expect } from 'vitest';
import { padronizarNome } from '../src/utils/texto.js';

describe('padronizarNome', () => {
  it('coloca tudo em maiúsculas', () => {
    expect(padronizarNome('joão silva')).toBe('JOÃO SILVA');
  });

  it('remove espaços nas pontas', () => {
    expect(padronizarNome('  moto peças  ')).toBe('MOTO PEÇAS');
  });

  it('não quebra com valor vazio ou nulo', () => {
    expect(padronizarNome(null)).toBe('');
    expect(padronizarNome(undefined)).toBe('');
  });
});