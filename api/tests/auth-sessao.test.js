// Testes da camada de sessão: como a credencial é lida (cookie x Bearer) e
// quando a proteção CSRF morde. É lógica de segurança pura — roda sem banco,
// montando req/res falsos.
import { describe, it, expect, beforeAll } from 'vitest';

// A auth.js encerra o processo se JWT_SECRET faltar. Definimos antes do import.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'chave-de-teste-com-mais-de-32-caracteres-ok';

let jwt, auth;
beforeAll(async () => {
  jwt = (await import('jsonwebtoken')).default;
  auth = await import('../src/auth.js');
});

// req falso no formato que o Express entrega aos middlewares.
function req({ metodo = 'POST', caminho = '/api/pedidos', cookies = {}, headers = {} } = {}) {
  return { method: metodo, path: caminho, cookies, headers };
}

// res falso que registra o que foi respondido e os cookies gravados.
function res() {
  const r = {
    codigo: null, corpo: null, cookies: {}, apagados: [],
    status(c) { r.codigo = c; return r; },
    json(o) { r.corpo = o; return r; },
    cookie(nome, valor, opts) { r.cookies[nome] = { valor, opts }; },
    clearCookie(nome, opts) { r.apagados.push({ nome, opts }); }
  };
  return r;
}

function corre(mw, requisicao, resposta) {
  let passou = false;
  mw(requisicao, resposta, () => { passou = true; });
  return passou;
}

const USUARIO = {
  UsuarioId: 1, Email: 'a@b.com', Papel: 'cliente',
  EmpresaId: 10, Gestor: 1, Permissoes: null
};

describe('signToken', () => {
  it('inclui um segredo csrf novo a cada token', () => {
    const a = jwt.decode(auth.signToken(USUARIO));
    const b = jwt.decode(auth.signToken(USUARIO));
    expect(a.csrf).toMatch(/^[0-9a-f]{32}$/);
    expect(a.csrf).not.toBe(b.csrf);
  });

  it('nao deixa `extra` sobrescrever o csrf', () => {
    // Se desse para escolher o proprio csrf, a protecao seria contornavel.
    const t = jwt.decode(auth.signToken(USUARIO, { csrf: 'valor-escolhido' }));
    expect(t.csrf).not.toBe('valor-escolhido');
  });
});

describe('carregarSessao', () => {
  it('le a sessao do cookie', () => {
    const r = req({ cookies: { fg_sess: auth.signToken(USUARIO) } });
    corre(auth.carregarSessao, r, res());
    expect(r.user.email).toBe('a@b.com');
    expect(r.authVia).toBe('cookie');
  });

  it('le a sessao do header Bearer (front antigo)', () => {
    const r = req({ headers: { authorization: 'Bearer ' + auth.signToken(USUARIO) } });
    corre(auth.carregarSessao, r, res());
    expect(r.user.email).toBe('a@b.com');
    expect(r.authVia).toBe('bearer');
  });

  it('Bearer valido tem precedencia sobre o cookie (front antigo)', () => {
    // Em producao front e API sao a mesma origem, entao o navegador anexa o
    // cookie sozinho e o front antigo fica com os dois. Se o cookie vencesse,
    // ele seria tratado como sessao de cookie e levaria 403 do csrfProtect em
    // toda escrita — sem nunca ter aprendido a mandar o header.
    const bearer = auth.signToken({ ...USUARIO, UsuarioId: 99, Email: 'velho@b.com' });
    const r = req({ cookies: { fg_sess: auth.signToken(USUARIO) }, headers: { authorization: 'Bearer ' + bearer } });
    corre(auth.carregarSessao, r, res());
    expect(r.user.email).toBe('velho@b.com');
    expect(r.authVia).toBe('bearer');
  });

  it('front antigo (Bearer + cookie de brinde) escreve sem X-CSRF-Token', () => {
    // O cenario que a Fase 2 promete nao quebrar: ninguem e' deslogado.
    const r = req({
      cookies: { fg_sess: auth.signToken(USUARIO) },
      headers: { authorization: 'Bearer ' + auth.signToken(USUARIO) }
    });
    corre(auth.carregarSessao, r, res());
    expect(corre(auth.csrfProtect, r, res())).toBe(true);
  });

  it('Bearer vencido nao cega um cookie bom', () => {
    // O token do localStorage expira parado la'; o cookie e' a sessao viva.
    const vencido = jwt.sign({ id: 99, email: 'velho@b.com' }, process.env.JWT_SECRET, { expiresIn: '-1s' });
    const r = req({ cookies: { fg_sess: auth.signToken(USUARIO) }, headers: { authorization: 'Bearer ' + vencido } });
    corre(auth.carregarSessao, r, res());
    expect(r.user.email).toBe('a@b.com');
    expect(r.authVia).toBe('cookie');
  });

  it('NUNCA responde 401 — so marca o problema e segue', () => {
    const resposta = res();
    const r = req({ cookies: { fg_sess: 'lixo.que.nao.e.jwt' } });
    expect(corre(auth.carregarSessao, r, resposta)).toBe(true);
    expect(resposta.codigo).toBeNull();
    expect(r.user).toBeUndefined();
    expect(r.tokenInvalido).toBe(true);
  });

  it('recusa token assinado com outra chave', () => {
    const forjado = jwt.sign({ id: 1, papel: 'admin' }, 'chave-errada-mas-longa-o-suficiente!!');
    const r = req({ cookies: { fg_sess: forjado } });
    corre(auth.carregarSessao, r, res());
    expect(r.user).toBeUndefined();
  });
});

describe('csrfProtect', () => {
  // Monta uma requisicao ja autenticada por cookie.
  function comCookie(headerCsrf) {
    const token = auth.signToken(USUARIO);
    const r = req({
      cookies: { fg_sess: token },
      headers: headerCsrf === undefined ? {} : { 'x-csrf-token': headerCsrf }
    });
    corre(auth.carregarSessao, r, res());
    return r;
  }

  it('BLOQUEIA escrita por cookie sem o header', () => {
    const resposta = res();
    expect(corre(auth.csrfProtect, comCookie(undefined), resposta)).toBe(false);
    expect(resposta.codigo).toBe(403);
  });

  it('BLOQUEIA escrita por cookie com header errado', () => {
    const resposta = res();
    expect(corre(auth.csrfProtect, comCookie('a'.repeat(32)), resposta)).toBe(false);
    expect(resposta.codigo).toBe(403);
  });

  it('libera escrita por cookie com o header correto', () => {
    const r = comCookie(undefined);
    r.headers['x-csrf-token'] = r.user.csrf;
    expect(corre(auth.csrfProtect, r, res())).toBe(true);
  });

  it('libera leitura (GET) sem header', () => {
    const r = comCookie(undefined);
    r.method = 'GET';
    expect(corre(auth.csrfProtect, r, res())).toBe(true);
  });

  it('libera Bearer sem header — o navegador nao anexa header sozinho', () => {
    const r = req({ headers: { authorization: 'Bearer ' + auth.signToken(USUARIO) } });
    corre(auth.carregarSessao, r, res());
    expect(corre(auth.csrfProtect, r, res())).toBe(true);
  });

  it('libera rota publica (sem sessao)', () => {
    expect(corre(auth.csrfProtect, req(), res())).toBe(true);
  });

  it('responde 403 (nao quebra) com header de caracteres multibyte', () => {
    // 32 caracteres acentuados = 64 bytes. Comparar o length da STRING em vez
    // do numero de BYTES fazia o timingSafeEqual lancar, virando 500.
    const resposta = res();
    expect(corre(auth.csrfProtect, comCookie('é'.repeat(32)), resposta)).toBe(false);
    expect(resposta.codigo).toBe(403);
  });

  it('deixa sair e entrar mesmo sem o fg_csrf (rotas isentas)', () => {
    // Sessao valida + fg_csrf apagado: sem a isencao o usuario ficaria preso,
    // sem conseguir nem deslogar nem logar de novo pela interface.
    for (const caminho of ['/api/auth/logout', '/api/auth/login', '/api/auth/senha/redefinir']) {
      const r = req({ caminho, cookies: { fg_sess: auth.signToken(USUARIO) } });
      corre(auth.carregarSessao, r, res());
      expect(corre(auth.csrfProtect, r, res()), caminho).toBe(true);
    }
  });

  it('a isencao NAO vaza para rotas de dado do cliente', () => {
    const resposta = res();
    const r = req({ caminho: '/api/auth/identidade/voltar', cookies: { fg_sess: auth.signToken(USUARIO) } });
    corre(auth.carregarSessao, r, res());
    expect(corre(auth.csrfProtect, r, resposta)).toBe(false);
    expect(resposta.codigo).toBe(403);
  });

  it('nao aceita cookie fg_csrf plantado — o valor vale e o do JWT', () => {
    // Este e' o ataque que derruba o double-submit classico: quem consegue
    // escrever cookie (subdominio, MITM em HTTP) planta as duas metades com o
    // mesmo valor. Aqui a metade autoritativa esta dentro da assinatura.
    const r = comCookie('valor-plantado-pelo-atacante');
    r.cookies.fg_csrf = 'valor-plantado-pelo-atacante';
    const resposta = res();
    expect(corre(auth.csrfProtect, r, resposta)).toBe(false);
    expect(resposta.codigo).toBe(403);
  });
});

describe('abrirSessao / fecharSessao', () => {
  it('grava os tres cookies, so o de sessao com httpOnly', () => {
    const resposta = res();
    auth.abrirSessao(resposta, auth.signToken(USUARIO));
    expect(resposta.cookies.fg_sess.opts.httpOnly).toBe(true);
    expect(resposta.cookies.fg_csrf.opts.httpOnly).toBe(false);
    expect(resposta.cookies.fg_exp.opts.httpOnly).toBe(false);
  });

  it('fg_csrf espelha o claim do token e fg_exp traz a validade', () => {
    const token = auth.signToken(USUARIO);
    const p = jwt.decode(token);
    const resposta = res();
    auth.abrirSessao(resposta, token);
    expect(resposta.cookies.fg_csrf.valor).toBe(p.csrf);
    expect(resposta.cookies.fg_exp.valor).toBe(String(p.exp));
  });

  it('usa SameSite=Lax', () => {
    const resposta = res();
    auth.abrirSessao(resposta, auth.signToken(USUARIO));
    expect(resposta.cookies.fg_sess.opts.sameSite).toBe('lax');
  });

  it('fecharSessao apaga os tres repetindo os atributos', () => {
    // Atributo diferente do usado ao gravar = navegador ignora a remocao.
    // E' o motivo numero 1 de "logout que nao desloga".
    const resposta = res();
    auth.fecharSessao(resposta);
    expect(resposta.apagados.map(a => a.nome).sort()).toEqual(['fg_csrf', 'fg_exp', 'fg_sess']);
    for (const a of resposta.apagados) {
      expect(a.opts.path).toBe('/');
      expect(a.opts.sameSite).toBe('lax');
    }
  });
});
