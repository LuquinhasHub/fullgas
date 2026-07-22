// ============================================================
// Envio de e-mail (SMTP) — usado hoje só pela recuperação de senha.
// ------------------------------------------------------------
// Sem SMTP_HOST no .env o módulo entra em "modo dev": nada sai pela rede, o
// e-mail é despejado no console do servidor. Assim dá para testar o fluxo
// inteiro sem mandar mensagem para ninguém — e um deploy sem SMTP configurado
// avisa no log em vez de derrubar a rota.
// ============================================================
import nodemailer from 'nodemailer';
import 'dotenv/config';

let transporte = null;

export function mailConfigurado() {
  return !!process.env.SMTP_HOST;
}

// Endereço público do site — é a base do link que vai no e-mail. Sem barra no fim.
//
// Com APP_URL definido, ele manda e pronto (é o caso de produção: o valor é
// fixo e não depende de quem chamou). SEM APP_URL, em vez de cravar
// "localhost" — que não abre em nenhum outro aparelho — aproveitamos a origem
// de quem fez o pedido: se o gerente abriu o portal em http://192.168.1.131:5500
// pelo celular, o link chega com esse mesmo endereço e funciona.
//
// SEGURANÇA: a origem vem de um cabeçalho, ou seja, do cliente. Aceitá-la de
// olhos fechados permitiria alguém pedir a recuperação de OUTRA pessoa forjando
// o Origin e receber um link apontando para o servidor dele — o token vazaria.
// Por isso só passam origens comprovadamente nossas: as listadas em
// CORS_ORIGIN, ou endereços locais/de rede interna (uso em desenvolvimento).
export function appUrl(req) {
  const conf = (process.env.APP_URL || '').replace(/\/+$/, '');
  if (conf) return conf;
  return origemConfiavel(req) || 'http://localhost:5500';
}

function origemConfiavel(req) {
  const bruta = req?.headers?.origin || '';
  if (!bruta) return null;
  let u;
  try { u = new URL(bruta); } catch { return null; }

  const permitidas = (process.env.CORS_ORIGIN || '')
    .split(',').map(o => o.trim().replace(/\/+$/, '')).filter(Boolean);
  if (permitidas.includes(u.origin)) return u.origin;

  // Rede local: localhost, 127.x e as faixas privadas (192.168, 10.x, 172.16-31).
  const h = u.hostname;
  const local = h === 'localhost' || h === '127.0.0.1' ||
    /^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(h);
  return local ? u.origin : null;
}

function obterTransporte() {
  if (transporte) return transporte;
  const porta = Number(process.env.SMTP_PORT || 587);
  transporte = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: porta,
    // 465 é TLS implícito; 587/25 sobem para TLS via STARTTLS.
    secure: process.env.SMTP_SECURE ? process.env.SMTP_SECURE === '1' : porta === 465,
    auth: process.env.SMTP_USER
      ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS || '' }
      : undefined
  });
  return transporte;
}

// Envia um e-mail. Devolve { enviado } — em modo dev, { enviado: false }.
// Nunca lança por falta de configuração; lança só em erro real de SMTP.
export async function enviarEmail({ para, assunto, texto, html }) {
  if (!mailConfigurado()) {
    console.warn(
      '\n──────── E-MAIL NÃO ENVIADO (SMTP não configurado) ────────\n' +
      `Para:    ${para}\nAssunto: ${assunto}\n\n${texto}\n` +
      '───────────────────────────────────────────────────────────\n' +
      'Defina SMTP_HOST/SMTP_PORT/SMTP_USER/SMTP_PASS no api/.env para enviar de verdade.\n'
    );
    return { enviado: false };
  }
  await obterTransporte().sendMail({
    from: process.env.SMTP_FROM || process.env.SMTP_USER,
    to: para, subject: assunto, text: texto, html
  });
  return { enviado: true };
}

// Corpo do e-mail de recuperação de senha. `minutos` = validade do link.
export function emailRecuperacaoSenha(nome, link, minutos) {
  const texto =
    `Olá, ${nome}.\n\n` +
    'Recebemos um pedido para redefinir a senha da sua conta no portal Fullgas B2B.\n\n' +
    `Abra este link para escolher uma nova senha (válido por ${minutos} minutos):\n${link}\n\n` +
    'Se não foi você quem pediu, ignore esta mensagem — sua senha continua a mesma.\n\n' +
    'Fullgas B2B';
  const html =
    '<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#1c1c1c;line-height:1.5;">' +
    `<p>Olá, <b>${escHtml(nome)}</b>.</p>` +
    '<p>Recebemos um pedido para redefinir a senha da sua conta no portal <b>Fullgas B2B</b>.</p>' +
    `<p><a href="${escHtml(link)}" style="display:inline-block;background:#E5B100;color:#1c1c1c;` +
    'font-weight:700;text-decoration:none;padding:12px 22px;border-radius:4px;">Criar nova senha</a></p>' +
    `<p style="font-size:12px;color:#666;">O link vale por ${minutos} minutos. ` +
    `Se o botão não funcionar, copie e cole no navegador:<br>${escHtml(link)}</p>` +
    '<p style="font-size:12px;color:#666;">Se não foi você quem pediu, ignore esta mensagem — ' +
    'sua senha continua a mesma.</p></div>';
  return { texto, html };
}

function escHtml(s) {
  return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}
