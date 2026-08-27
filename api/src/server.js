// ============================================================
// Servidor Express — ponto de entrada da API Fullgas
// ============================================================
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import 'dotenv/config';

import { getPool } from './db.js';
import { carregarSessao, csrfProtect } from './auth.js';
import authRoutes from './routes/auth.routes.js';
import usuariosRoutes from './routes/usuarios.routes.js';
import contaRoutes from './routes/conta.routes.js';
import produtosRoutes from './routes/produtos.routes.js';
import pedidosRoutes from './routes/pedidos.routes.js';
import veiculosRoutes from './routes/veiculos.routes.js';
import faturasRoutes from './routes/faturas.routes.js';
import preVendaRoutes from './routes/prevenda.routes.js';
import reivindicacoesRoutes from './routes/reivindicacoes.routes.js';
import notificacoesRoutes from './routes/notificacoes.routes.js';
import suporteRoutes from './routes/suporte.routes.js';
import finderRoutes from './routes/finder.routes.js';
import tinyRoutes from './routes/tiny.routes.js';
import arquivosRoutes from './routes/arquivos.routes.js';
import { iniciarSincronizacaoAgendada } from './tiny-cron.js';

const app = express();

// Atrás do Nginx: confia no X-Forwarded-For para enxergar o IP real do cliente.
// Sem isto o rate limit abaixo veria 127.0.0.1 para todo mundo e viraria um
// limite global — o primeiro a estourar bloquearia os demais.
app.set('trust proxy', 1);

// Headers de segurança (nosniff, X-Frame-Options, Referrer-Policy, HSTS...).
// O `nosniff` é o mais importante aqui: sem ele o navegador "adivinha" o tipo
// de um arquivo enviado pelo usuário e pode executar como HTML algo que foi
// salvo como imagem em /uploads.
app.use(helmet({
  // CSP fica DESLIGADA nesta camada de propósito: quem serve o front em
  // produção é o Nginx, e a política precisa liberar os `style=` inline que o
  // front gera aos montes via innerHTML. Ligar a CSP padrão do helmet aqui
  // quebraria as telas. A CSP entra no Nginx, com as diretivas certas.
  contentSecurityPolicy: false,
  // As imagens de /uploads são carregadas pelo front, que em desenvolvimento
  // roda em outra porta (Live Server). O padrão `same-origin` as bloquearia.
  crossOriginResourcePolicy: { policy: 'cross-origin' }
}));

// Origens permitidas via CORS_ORIGIN (lista separada por vírgula). Sem a var
// definida, liberamos APENAS origens locais / de rede privada, para o modo dev
// continuar funcionando sem configuração. Origem não permitida NÃO derruba a
// resposta: apenas não recebe os headers de CORS (o navegador bloqueia), em vez
// de virar 500.
//
// Por que não liberar tudo: `credentials: true` combinado com origem refletida
// significa que QUALQUER site da internet poderia chamar esta API com a sessão
// do usuário logado e ler a resposta. Hoje o token vai num header (o navegador
// não anexa sozinho), então o estrago seria limitado — mas quando a sessão
// passar a viajar em cookie isso vira bypass total de autenticação.
// O curinga '*' era aceito antes e liberava tudo. Não derrubamos a API por
// causa dele (isso tiraria o site do ar num deploy), mas ele deixa de liberar
// geral: cai no mesmo modo de quando a variável está vazia (só rede local).
// Produção não sente, porque lá o front e a API são a MESMA origem — e
// requisição de mesma origem nem passa pela checagem de CORS.
const corsBruto = (process.env.CORS_ORIGIN || '').split(',').map(o => o.trim()).filter(Boolean);
const temCuringa = corsBruto.includes('*');
const allowedOrigins = corsBruto.filter(o => o !== '*');

if (temCuringa) {
  console.warn(
    "⚠ CORS_ORIGIN contém '*' — ignorado. Liberando apenas localhost e rede\n" +
    '  local. Para permitir uma origem externa (Live Server, ngrok, outro\n' +
    '  domínio), liste-a explicitamente: CORS_ORIGIN=https://seusite.com'
  );
}

// localhost, 127.0.0.1 e as três faixas privadas da RFC 1918.
const ehOrigemLocal = o =>
  /^https?:\/\/(localhost|127\.0\.0\.1|192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)(:\d+)?$/.test(o);

app.use(cors({
  origin: function (origin, callback) {
    // Sem Origin = mesma origem, curl, app nativo. Não é caso de CORS.
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) return callback(null, true);
    if (allowedOrigins.length === 0 && ehOrigemLocal(origin)) return callback(null, true);
    callback(null, false);
  },
  credentials: true,
  // X-CSRF-Token não é um header "seguro" da lista do CORS: sem declará-lo
  // aqui, todo preflight de origem cruzada (ex.: Live Server na :5500) falha
  // assim que o front começar a enviá-lo.
  allowedHeaders: ['Content-Type', 'Authorization', 'X-CSRF-Token', 'ngrok-skip-browser-warning']
}));

// Limite explícito do corpo JSON. O padrão do Express já é 100 kb, mas deixar
// escrito evita que uma mudança futura abra a porta para payload gigante.
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());

// Arquivos enviados. O banco guarda a URL relativa (/uploads/...).
//
// ATENÇÃO: só as pastas de CATÁLOGO ficam no estático público — o conteúdo
// delas é o mesmo para todos os revendedores (foto de produto, de categoria e
// diagrama do finder). As pastas com material de cliente (reivindicacoes,
// notificacoes) NÃO entram aqui: saem por /api/arquivos/:tipo/:nome, que
// confere no banco se o arquivo é mesmo da empresa de quem pediu.
// Ver api/src/routes/arquivos.routes.js.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UPLOADS_DIR = path.join(__dirname, '..', 'uploads');
for (const pasta of ['produtos', 'categorias', 'finder']) {
  app.use(`/uploads/${pasta}`, express.static(path.join(UPLOADS_DIR, pasta)));
}

// Log simples de requisições.
app.use((req, _res, next) => {
  console.log(`${req.method} ${req.url}`);
  next();
});

/* ============================================================
   NADA DE /api PODE SER GUARDADO EM CACHE
   ------------------------------------------------------------
   É a regra mais importante desta lista, e a razão é específica: as respostas
   de autenticação carregam Set-Cookie. Se QUALQUER camada entre a API e o
   navegador guardar uma cópia — Nginx com proxy_cache, uma regra "Cache
   Everything" na Cloudflare, um proxy corporativo na rede do cliente —, o
   cookie de sessão de um usuário é entregue ao próximo que pedir a mesma URL.
   A sessão troca de dono sem que ninguém perceba.

   Isto fica AQUI, e não só na configuração do Nginx, porque assim a garantia
   viaja junto com a aplicação: vale em qualquer ambiente, com qualquer proxy
   na frente, e não depende de alguém lembrar de replicar uma diretiva ao
   mexer na infraestrutura. O Nginx repete a regra como segunda camada.
   ============================================================ */
app.use('/api', (_req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});

// Sessão e CSRF, antes de qualquer rota. carregarSessao só preenche req.user
// (nunca barra); csrfProtect exige o header X-CSRF-Token nas escritas feitas
// com sessão em cookie. Rotas públicas passam direto — ver auth.js.
app.use(carregarSessao);
app.use(csrfProtect);

// Healthcheck — útil pra testar se a API subiu.
app.get('/api/health', (_req, res) => res.json({ ok: true, ts: new Date().toISOString() }));

// Rotas
app.use('/api/auth', authRoutes);
app.use('/api', usuariosRoutes);
app.use('/api', contaRoutes);
app.use('/api', produtosRoutes);
app.use('/api', pedidosRoutes);
app.use('/api', veiculosRoutes);
app.use('/api', faturasRoutes);
app.use('/api', preVendaRoutes);
app.use('/api', reivindicacoesRoutes);
app.use('/api', notificacoesRoutes);
app.use('/api', suporteRoutes);
app.use('/api', finderRoutes);
app.use('/api', tinyRoutes);
app.use('/api', arquivosRoutes);

// Frontend estático com URLs LIMPAS (esconder o .html).
// `extensions: ['html']` faz /portal servir portal.html, /loja → loja.html,
// etc.; a raiz "/" serve index.html. Em produção quem serve o front é o Nginx
// (mesmo comportamento via try_files) — aqui é para o dev abrir tudo na mesma
// origem da API (http://localhost:3000) sem depender de outro servidor.
const FRONT_DIR = path.join(__dirname, '..', '..', 'frontend');
app.use(express.static(FRONT_DIR, { extensions: ['html'] }));

// 404 — só cai aqui o que não é arquivo do front nem rota conhecida. Rotas de
// API (JSON) e navegação de página (HTML) recebem o formato adequado.
app.use((req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ erro: 'Rota não encontrada.' });
  res.status(404).sendFile(path.join(FRONT_DIR, 'index.html'));
});

// Tratador central de erros
app.use((err, _req, res, _next) => {
  // Erro de aplicação (AppError, marca `publica`): status e mensagem podem ir
  // ao cliente. Qualquer outro erro vira 500 genérico — nada de vazar detalhe.
  if (err && err.publica) {
    return res.status(err.status || 400).json({ erro: err.message });
  }
  // Corpo maior que o limite do express.json(): é erro do cliente, não nosso.
  // Sem este caso o body-parser cairia no 500 genérico abaixo e o front
  // mostraria "erro interno" para um upload grande demais.
  if (err && err.type === 'entity.too.large') {
    return res.status(413).json({ erro: 'Conteúdo grande demais.' });
  }
  console.error('ERRO:', err.message);
  res.status(500).json({ erro: 'Erro interno do servidor.' });
});

const PORT = Number(process.env.PORT || 3000);

// Aviso alto sobre a falha mais silenciosa que existe neste projeto.
// Os cookies de sessão só saem marcados como Secure quando NODE_ENV=production
// ou COOKIE_SECURE=1. Se a unidade do systemd em produção não define nenhum
// dos dois, tudo continua FUNCIONANDO — o portal abre, o login entra — e o
// cookie de sessão simplesmente trafega sem a marca que impede o navegador de
// mandá-lo por HTTP. Não há erro, não há log, não há sintoma. Por isso a
// checagem grita aqui, no arranque.
if (process.env.NODE_ENV !== 'production' && process.env.COOKIE_SECURE !== '1') {
  console.warn(
    '⚠ Cookies de sessão SEM a marca Secure (NODE_ENV != production e\n' +
    '  COOKIE_SECURE != 1). Correto em desenvolvimento sob http://.\n' +
    '  Se esta mensagem apareceu em PRODUÇÃO, corrija antes de seguir:\n' +
    '  a sessão está trafegando sem a proteção contra envio em texto claro.'
  );
}

// Tenta conectar no banco antes de abrir a porta (falha cedo se o DB estiver fora).
getPool()
  .then(() => {
    // 0.0.0.0 = escuta em todas as interfaces: localhost, 127.0.0.1 e o IP da
    // rede local (acesso de outro dispositivo). Não fixe um IP aqui.
    app.listen(PORT, '0.0.0.0', () =>
      console.log(`✓ API ouvindo na porta ${PORT} (localhost e rede local)`)
    );
    // Sincronização automática com o Tiny (node-cron, intervalo em minutos
    // via TINY_SYNC_INTERVALO_MIN) — só depois do banco estar de pé.
    iniciarSincronizacaoAgendada();
  })
  .catch(() => {
    console.error('A API não subiu porque não conectou no banco. Confira o arquivo .env.');
    process.exit(1);
  });
