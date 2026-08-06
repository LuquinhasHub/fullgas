// ============================================================
// Autenticação por JWT
// ============================================================
import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import 'dotenv/config';

// A chave de assinatura NÃO tem valor padrão de propósito. Antes havia um
// fallback ('dev-secret-trocar'): se a variável faltasse no servidor, a API
// subia normalmente assinando com uma chave que está publicada no código —
// qualquer pessoa conseguiria forjar um token de admin. Falhar no boot é ruim;
// subir inseguro em silêncio é pior.
const SECRET = process.env.JWT_SECRET || '';
if (SECRET.length < 32) {
  console.error(
    'JWT_SECRET ausente ou curto demais (mínimo de 32 caracteres).\n' +
    'Defina no .env antes de subir a API. Para gerar uma chave nova:\n' +
    "  node -e \"console.log(require('crypto').randomBytes(48).toString('base64url'))\""
  );
  process.exit(1);
}
const EXPIRES = process.env.JWT_EXPIRES || '8h';

// Áreas do site que podem ser restringidas por conta interna (sub-dealer).
// A lista canônica vive aqui; o front usa as mesmas chaves.
export const AREAS = ['loja', 'finder', 'pedidos', 'financeiro', 'reivindicacoes', 'estoque', 'acoes'];

// Converte a coluna Usuario.Permissoes (JSON array ou NULL) em array ou null
// (null = acesso total). Valor ilegível vira null — nunca derruba o login.
export function parsePermissoes(raw) {
  if (!raw) return null;
  try {
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.filter(a => AREAS.includes(a)) : null;
  } catch { return null; }
}

// Gera o token a partir dos dados essenciais do usuário.
// `extra` acrescenta claims (hoje: a marca de acesso por identidade assumida —
// `imp` = id do admin que assumiu) e pode encurtar a validade via `expiresIn`.
export function signToken(usuario, extra) {
  const { expiresIn, ...claims } = extra || {};
  return jwt.sign(
    {
      id: usuario.UsuarioId,
      email: usuario.Email,
      papel: usuario.Papel,
      empresaId: usuario.EmpresaId,
      gestor: !!usuario.Gestor,
      perm: parsePermissoes(usuario.Permissoes),  // null = acesso total
      ...claims,
      // Segredo anti-CSRF. Vem DEPOIS do spread para que `extra` não consiga
      // sobrescrevê-lo — quem escolhesse o próprio csrf contornaria a proteção.
      // O mesmo valor é copiado para o cookie fg_csrf; o navegador o devolve no
      // header X-CSRF-Token e csrfProtect compara os dois. Ver o comentário do
      // csrfProtect para o porquê do desenho.
      csrf: crypto.randomBytes(16).toString('hex')
    },
    SECRET,
    { expiresIn: expiresIn || EXPIRES }
  );
}

/* ============================================================
   COOKIES DE SESSÃO
   ------------------------------------------------------------
   A sessão saiu do localStorage e passou a viajar em cookie. O motivo é
   XSS: qualquer script injetado na página consegue ler o localStorage e
   roubar o token; um cookie httpOnly é invisível para o JavaScript.

   São três cookies, e só o primeiro é secreto:
     fg_sess  (httpOnly) — o JWT. O navegador manda, o JS não lê.
     fg_csrf             — cópia do claim csrf, para o front devolver no header.
     fg_exp              — validade do token, para o guardião de sessão do
                           front saber quando expirou sem precisar ler o JWT.
   ============================================================ */
export const COOKIE_SESS = 'fg_sess';
export const COOKIE_CSRF = 'fg_csrf';
export const COOKIE_EXP = 'fg_exp';

// Secure só em produção: sob HTTP puro (desenvolvimento) o navegador
// DESCARTA cookie marcado como Secure, e ninguém consegue entrar.
const COOKIE_SECURE = process.env.COOKIE_SECURE === '1' ||
                      process.env.NODE_ENV === 'production';

// SameSite=Lax basta: em produção o Nginx serve front e API na mesma origem,
// e SameSite compara o SITE (ignora a porta), então o Live Server em :5500
// falando com a API em :3000 também é considerado same-site.
// 'Strict' derrubaria a sessão ao entrar no portal por link de e-mail.
function baseCookie(maxAgeMs) {
  return { sameSite: 'lax', secure: COOKIE_SECURE, path: '/', maxAge: maxAgeMs };
}

// Grava os três cookies a partir de um token já assinado.
export function abrirSessao(res, token) {
  const p = jwt.decode(token) || {};
  const restanteMs = Math.max(0, (p.exp - Math.floor(Date.now() / 1000)) * 1000);
  const base = baseCookie(restanteMs);
  res.cookie(COOKIE_SESS, token, { ...base, httpOnly: true });
  res.cookie(COOKIE_CSRF, p.csrf || '', { ...base, httpOnly: false });
  res.cookie(COOKIE_EXP, String(p.exp || ''), { ...base, httpOnly: false });
}

// Apaga os três. Os atributos precisam ser IGUAIS aos do res.cookie, senão o
// navegador entende que é outro cookie e ignora a remoção — é o motivo nº 1
// de "logout que não desloga" neste padrão.
export function fecharSessao(res) {
  const o = { path: '/', sameSite: 'lax', secure: COOKIE_SECURE };
  res.clearCookie(COOKIE_SESS, { ...o, httpOnly: true });
  res.clearCookie(COOKIE_CSRF, o);
  res.clearCookie(COOKIE_EXP, o);
}

/* ============================================================
   Carregamento da sessão (middleware GLOBAL)
   ------------------------------------------------------------
   Roda em toda requisição e apenas PREENCHE req.user quando há credencial
   válida — nunca responde 401. Quem barra é o requireAuth, rota a rota.

   O COOKIE É A ÚNICA FORMA DE AUTENTICAÇÃO. Até a fase anterior este
   middleware também aceitava `Authorization: Bearer <token>`, para o front
   antigo — já carregado no navegador dos usuários — continuar funcionando
   durante a migração. Esse ramo saiu: enquanto ele existia, um token roubado
   do localStorage ainda valia como credencial, e era exatamente isso que a
   mudança para cookie httpOnly veio impedir. Guardar sessão no localStorage
   deixa de ser possível, não apenas desaconselhado.
   ============================================================ */
export function carregarSessao(req, _res, next) {
  const token = req.cookies?.[COOKIE_SESS] || null;
  if (token) {
    try {
      req.user = jwt.verify(token, SECRET);
    } catch {
      req.tokenInvalido = true;
    }
  }
  next();
}

// Middleware: exige sessão. O trabalho pesado já foi feito por carregarSessao.
export function requireAuth(req, res, next) {
  if (!req.user) {
    return res.status(401).json({
      erro: req.tokenInvalido ? 'Token inválido ou expirado.' : 'Token ausente.'
    });
  }
  next();
}

/* ============================================================
   Proteção CSRF
   ------------------------------------------------------------
   Com a sessão em cookie surge um risco que não existia com Bearer: o
   navegador anexa o cookie SOZINHO. Um site malicioso poderia fazer o
   navegador da vítima enviar um POST autenticado para cá.

   O segredo comparado aqui vem do JWT ASSINADO, não do cookie fg_csrf.
   Isso é de propósito: no double-submit clássico (cookie contra header) um
   atacante que consiga escrever cookie — subdomínio, MITM em HTTP — planta
   as duas metades com o mesmo valor e passa. Aqui a metade autoritativa
   está dentro de uma assinatura que ele não consegue forjar, então um
   fg_csrf plantado simplesmente não bate. Dá a força de um token
   sincronizador sem guardar estado nenhum no servidor.
   ============================================================ */
const METODOS_SEGUROS = new Set(['GET', 'HEAD', 'OPTIONS']);

// Rotas de ENTRADA E SAÍDA da sessão, isentas por desenho. Duas razões:
//
// 1) Recuperabilidade. O fg_csrf é legível por JavaScript (tem de ser), logo
//    apagável por script, extensão ou limpeza parcial do navegador — enquanto
//    o fg_sess é httpOnly e sobrevive. Nesse estado o usuário teria sessão
//    válida e nenhum segredo para provar: sem esta isenção, login e logout
//    responderiam 403 e ele ficaria trancado, sem caminho de saída pela
//    interface.
// 2) O que um atacante ganharia aqui é pequeno e conhecido: login CSRF
//    (empurrar a vítima para uma conta dele) e logout forçado. Nenhum toca
//    dado do cliente. Já o preço da alternativa é ficar preso do lado de fora.
//
// A isenção vale só para estas rotas — qualquer escrita que mexa em dado do
// cliente continua exigindo o header.
const ROTAS_SEM_CSRF = new Set([
  '/api/auth/login', '/api/auth/register', '/api/auth/logout',
  '/api/auth/senha/esqueci', '/api/auth/senha/verificar', '/api/auth/senha/redefinir'
]);

export function csrfProtect(req, res, next) {
  if (METODOS_SEGUROS.has(req.method)) return next();
  if (ROTAS_SEM_CSRF.has(req.path)) return next();
  // Sem sessão não há o que sequestrar. Toda sessão agora é cookie, então
  // basta perguntar se existe uma — a distinção cookie × Bearer que morava
  // aqui saiu junto com o Bearer.
  if (!req.user) return next();

  // Comparação em BYTES, não em caracteres: uma string de 32 caracteres
  // acentuados vira um buffer de 64 bytes, e o timingSafeEqual LANÇA quando os
  // tamanhos diferem. Comparar o length da string deixaria um jeito trivial de
  // transformar o 403 num 500.
  const enviado = Buffer.from(String(req.headers['x-csrf-token'] || ''), 'utf8');
  const esperado = Buffer.from(String(req.user?.csrf || ''), 'utf8');
  const ok = esperado.length > 0 &&
             enviado.length === esperado.length &&
             crypto.timingSafeEqual(enviado, esperado);

  if (ok) return next();
  res.status(403).json({ erro: 'Sessão desatualizada. Recarregue a página e tente de novo.' });
}

// Middleware: exige que o usuário autenticado seja admin.
export function requireAdmin(req, res, next) {
  if (req.user?.papel !== 'admin') {
    return res.status(403).json({ erro: 'Acesso restrito a administradores.' });
  }
  next();
}

// Middleware: bloqueia contas internas (sub-dealers) sem acesso à área.
// Admin, gestor e tokens sem lista de permissões (acesso total) passam direto.
export function requireArea(area) {
  return (req, res, next) => {
    const u = req.user || {};
    if (u.papel === 'admin' || u.gestor || !Array.isArray(u.perm) || u.perm.includes(area)) return next();
    res.status(403).json({ erro: 'Sua conta não tem acesso a esta área. Fale com o gestor da concessionária.' });
  };
}
