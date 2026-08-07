// ============================================================
// Verificação anti-robô (Cloudflare Turnstile)
// ------------------------------------------------------------
// O navegador resolve o desafio e recebe um token de uso único. Ele manda
// esse token junto com o login; aqui perguntamos à Cloudflare se o token é
// mesmo dela, é nosso e ainda não foi usado.
//
// POR QUE TURNSTILE E NÃO O reCAPTCHA:
// o widget "I'm not a robot" clássico é o reCAPTCHA, que é do Google — usá-lo
// contrariaria a decisão de tirar o Google do caminho de entrada. O Turnstile
// entrega a mesma caixa de verificação, é gratuito e o domínio já passa pela
// Cloudflare. Trocar de provedor depois mexe só neste arquivo e no trecho do
// widget em auth.js: o formato (token no corpo, verificação servidor a
// servidor) é o mesmo em reCAPTCHA, hCaptcha e Turnstile.
//
// SEM CHAVE CONFIGURADA A VERIFICAÇÃO É PULADA. É deliberado: o
// desenvolvimento local e os testes não dependem de rede nem de conta na
// Cloudflare. Quem garante que a produção não fica sem proteção é o deploy,
// que define as duas variáveis.
// ============================================================
const VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

// A site key é PÚBLICA (vai no HTML). A secret key é secreta de verdade —
// diferente do client ID do Google, que não tinha par secreto neste fluxo.
const SITE_KEY = (process.env.TURNSTILE_SITE_KEY || '').trim();
const SECRET_KEY = (process.env.TURNSTILE_SECRET_KEY || '').trim();

export function captchaConfigurado() { return !!(SITE_KEY && SECRET_KEY); }
export function captchaSiteKey() { return SITE_KEY; }

// Verifica o token. Devolve { ok: true } ou { ok: false, erro }.
//
// Sobre falhar aberto ou fechado: se o token é inválido, recusamos (fechado).
// Mas se a Cloudflare não responder, LIBERAMOS, registrando o aviso. O motivo
// é a proporção entre os dois riscos: o captcha aqui é uma barreira contra
// robô, não a autenticação — a senha continua sendo exigida logo em seguida.
// Falhar fechado transformaria uma indisponibilidade da Cloudflare em portal
// inteiro fora do ar para clientes que sabem a própria senha.
export async function verificarCaptcha(token, ip) {
  if (!captchaConfigurado()) return { ok: true };
  if (!token || typeof token !== 'string')
    return { ok: false, erro: 'Confirme que você não é um robô.' };

  let dados;
  try {
    const corpo = new URLSearchParams({ secret: SECRET_KEY, response: token });
    if (ip) corpo.set('remoteip', ip);
    const r = await fetch(VERIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: corpo,
      signal: AbortSignal.timeout(5000)   // o login não pode ficar pendurado
    });
    dados = await r.json();
  } catch (e) {
    console.warn('⚠ Verificação anti-robô indisponível, liberando:', e.message);
    return { ok: true };
  }

  if (dados && dados.success === true) return { ok: true };

  // Códigos em https://developers.cloudflare.com/turnstile/get-started/server-side-validation/
  // O mais comum em uso real é 'timeout-or-duplicate': o token vale uma vez só
  // e expira em ~5 min. É por isso que o front REINICIA o widget a cada
  // tentativa que falha — sem isso, o segundo clique em "Entrar" reenvia um
  // token já queimado e o usuário fica preso num erro que não entende.
  console.warn('⚠ Anti-robô recusou:', (dados && dados['error-codes']) || 'sem detalhe');
  return { ok: false, erro: 'Verificação de segurança expirada. Marque a caixa de novo.' };
}
