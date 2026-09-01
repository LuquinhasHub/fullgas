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
      // Versão da sessão (migration 037). O revalidarSessao compara este
      // número com o do banco a cada requisição; incrementar a coluna
      // derruba todas as sessões do usuário na hora. Token antigo, emitido
      // antes da coluna existir, vem sem o claim e é tratado como 0.
      tv: usuario.TokenVersion ?? 0,
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

// Quanto tempo o fg_exp continua no navegador DEPOIS de o JWT vencer.
const SOBREVIDA_EXP_MS = 7 * 24 * 60 * 60 * 1000;    // 7 dias

// Grava os três cookies a partir de um token já assinado.
//
// O fg_exp vive de propósito mais que os outros dois. Ele é o único sinal pelo
// qual o front sabe que existe uma sessão (temSessao(), no api-adapter), e
// antes ele morria no mesmo instante que o JWT — os três nasciam com a mesma
// validade. No segundo em que a sessão vencia o cookie sumia junto, o guardião
// concluía "não há sessão a encerrar" e PARAVA de agir: a pessoa ficava presa
// numa tela logada onde toda chamada respondia 401, que é exatamente a sessão
// morta que o guardião existe para impedir. Sobrevivendo ao token, o fg_exp
// segue legível com uma data no passado, o guardião lê 'expirada' e devolve a
// pessoa ao login. Não há segredo nenhum nele — é um carimbo de data; quem
// autentica é o fg_sess, que continua vencendo na hora certa.
export function abrirSessao(res, token) {
  const p = jwt.decode(token) || {};
  const restanteMs = Math.max(0, (p.exp - Math.floor(Date.now() / 1000)) * 1000);
  const base = baseCookie(restanteMs);
  res.cookie(COOKIE_SESS, token, { ...base, httpOnly: true });
  res.cookie(COOKIE_CSRF, p.csrf || '', { ...base, httpOnly: false });
  res.cookie(COOKIE_EXP, String(p.exp || ''),
    { ...baseCookie(restanteMs + SOBREVIDA_EXP_MS), httpOnly: false });
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

/* ============================================================
   REVALIDAÇÃO DA SESSÃO CONTRA O BANCO (middleware GLOBAL)
   ------------------------------------------------------------
   O carregarSessao acima confere a ASSINATURA do token. Isso prova que o
   token foi emitido por nós e que ainda não expirou — e nada mais. Um JWT é
   uma fotografia: ele carrega o papel, as permissões e o status que o usuário
   tinha NO MOMENTO DO LOGIN, e continua afirmando isso até vencer.

   Enquanto só a assinatura era conferida, três coisas simplesmente não
   funcionavam, apesar de a interface dizer que sim:

     • "Sair" apagava o cookie do navegador e nada mais. O token seguia
       válido pelas horas restantes.
     • Redefinir a senha não expulsava ninguém — inclusive quem tivesse
       invadido a conta, que é justamente quando se troca a senha.
     • Bloquear um usuário, excluí-lo, ou rebaixar um admin a cliente só
       valia no login seguinte. Até lá o requireAdmin continuava acreditando
       no papel gravado no token.

   Agora cada requisição autenticada confere no banco: o status ainda é
   'aprovado'? o TokenVersion bate? E, se estiver tudo certo, os campos que
   decidem autorização (papel, gestor, permissões) são SOBRESCRITOS com os
   valores atuais — assim tirar uma área de um sub-dealer passa a valer na
   requisição seguinte, não no próximo login.

   CACHE: uma consulta por requisição multiplicaria o tráfego no banco (o
   portal dispara ~10 chamadas ao abrir). Guardamos o resultado por poucos
   segundos, o que mantém a revogação praticamente imediata sem transformar
   cada request num round-trip. O cache é por processo e some no restart — o
   deploy é de instância única (ver middlewares/rate-limit.js).
   ============================================================ */
const CACHE_SESSAO_MS = 15 * 1000;
const cacheSessao = new Map();   // usuarioId -> { dados, expira }

// Injetável para teste: quem consulta o banco. O auth.js não importa o db.js
// de propósito — isso o manteria impossível de testar sem SQL Server, e os
// testes desta camada rodam sem banco nenhum.
let consultarUsuario = null;
export function configurarRevalidacao(fn) { consultarUsuario = fn; }

// Limpa a entrada do cache de um usuário. Chamado logo após incrementar o
// TokenVersion, para a revogação não esperar o TTL.
export function invalidarCacheSessao(usuarioId) {
  cacheSessao.delete(Number(usuarioId));
}

export async function revalidarSessao(req, res, next) {
  // Sem sessão não há o que revalidar. Rota pública segue direto.
  if (!req.user || !consultarUsuario) return next();

  try {
    const id = req.user.id;
    const agora = Date.now();
    let linha = cacheSessao.get(id);
    if (!linha || linha.expira < agora) {
      const dados = await consultarUsuario(id);
      linha = { dados, expira: agora + CACHE_SESSAO_MS };
      cacheSessao.set(id, linha);
    }
    const u = linha.dados;

    // Usuário excluído, bloqueado ou ainda pendente: a sessão morre aqui.
    // Também derruba quando o TokenVersion do banco passou o do token —
    // é o efeito de "sair de todos os dispositivos", troca de senha, etc.
    // `?? 0` nos dois lados: token antigo (anterior à migration 037) não
    // tem o claim, e comparar undefined derrubaria todo mundo no deploy.
    const morreu = !u || u.Status !== 'aprovado' || (u.TokenVersion ?? 0) !== (req.user.tv ?? 0);
    if (morreu) {
      fecharSessao(res);
      req.user = null;
      req.tokenInvalido = true;
      return next();
    }

    // Estado FRESCO por cima do que o token afirmava. É o que faz a mudança
    // de papel/permissão valer sem esperar novo login.
    req.user.papel = u.Papel;
    req.user.gestor = !!u.Gestor;
    req.user.perm = parsePermissoes(u.Permissoes);
    next();
  } catch (e) {
    // Banco fora do ar não pode virar "todo mundo deslogado": seria trocar
    // uma indisponibilidade de leitura por uma de autenticação. Seguimos com
    // o que o token afirma — que é exatamente o comportamento de antes desta
    // função existir — e registramos para não passar despercebido.
    console.error('⚠ Revalidação de sessão falhou, seguindo com o token:', e.message);
    next();
  }
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

/* ============================================================
   PERMISSÃO POR ÁREA (contas internas / sub-dealers)
   ------------------------------------------------------------
   O gestor da concessionária cria contas internas e marca a que áreas cada
   uma tem acesso (loja, finder, pedidos, financeiro...). Até 2026-08-27 essa
   marcação existia mas quase não era APLICADA: o requireArea abaixo estava
   montado numa única rota (GET /api/faturas), e o resto do portal escondia as
   abas no navegador. Esconder uma aba não é controle de acesso — a rota
   continuava respondendo para quem a chamasse direto, e uma conta marcada
   como "só loja" lia pedidos, reivindicações, veículos e valores de fatura da
   concessionária inteira. Agora o gate está no servidor, rota a rota.

   Quem passa direto, sempre:
     • admin (é a Fullgas, não um sub-dealer);
     • gestor (dono da conta da concessionária — ele é quem distribui as áreas);
     • token sem lista de permissões (`perm` null = acesso total, é o padrão
       de quem foi criado antes das áreas existirem).
   ============================================================ */
// ATENÇÃO ao `u.papel` no primeiro teste: ele também serve para separar
// "usuário sem lista de permissões" de "requisição SEM USUÁRIO NENHUM". Sem
// ele, um req.user ausente daria `perm === undefined`, o !Array.isArray()
// devolveria true e o gate LIBERARIA — falha aberta numa rota que esquecesse
// o requireAuth antes. Hoje todas o têm; a garantia não deve depender disso.
function temAcessoTotal(u) {
  if (!u || !u.papel) return false;
  return u.papel === 'admin' || u.gestor || !Array.isArray(u.perm);
}

const ERRO_AREA = 'Sua conta não tem acesso a esta área. Fale com o gestor da concessionária.';

// Middleware: bloqueia contas internas (sub-dealers) sem acesso à área.
export function requireArea(area) {
  return (req, res, next) => {
    const u = req.user;
    if (temAcessoTotal(u) || (Array.isArray(u?.perm) && u.perm.includes(area))) return next();
    res.status(403).json({ erro: ERRO_AREA });
  };
}

// Igual ao requireArea, mas basta UMA das áreas da lista. Existe para a tela
// que é alcançada por mais de um caminho — a lista de veículos, por exemplo,
// serve tanto a "estoque" quanto a "ações".
export function requireAreaAny(areas) {
  return (req, res, next) => {
    const u = req.user;
    if (temAcessoTotal(u) || (Array.isArray(u?.perm) && areas.some(a => u.perm.includes(a)))) return next();
    res.status(403).json({ erro: ERRO_AREA });
  };
}
