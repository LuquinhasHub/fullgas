// ============================================================
// Servidor Express — ponto de entrada da API Fullgas
// ============================================================
import express from 'express';
import cors from 'cors';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import 'dotenv/config';

import { getPool } from './db.js';
import authRoutes from './routes/auth.routes.js';
import usuariosRoutes from './routes/usuarios.routes.js';
import contaRoutes from './routes/conta.routes.js';
import produtosRoutes from './routes/produtos.routes.js';
import pedidosRoutes from './routes/pedidos.routes.js';
import veiculosRoutes from './routes/veiculos.routes.js';
import faturasRoutes from './routes/faturas.routes.js';
import preVendaRoutes from './routes/prevenda.routes.js';
import reivindicacoesRoutes from './routes/reivindicacoes.routes.js';
import finderRoutes from './routes/finder.routes.js';
import tinyRoutes from './routes/tiny.routes.js';
import { iniciarSincronizacaoAgendada } from './tiny-cron.js';

const app = express();

// Origens permitidas via CORS_ORIGIN (lista separada por vírgula). Sem a var
// definida — ou com '*' — libera qualquer origem (modo dev/LAN). Origem não
// permitida NÃO derruba a resposta: apenas não recebe os headers de CORS (o
// navegador bloqueia), em vez de virar 500.
const allowedOrigins = (process.env.CORS_ORIGIN || '')
  .split(',').map(o => o.trim()).filter(Boolean);
const liberarTudo = allowedOrigins.length === 0 || allowedOrigins.includes('*');
app.use(cors({
  origin: function (origin, callback) {
    if (liberarTudo || !origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(null, false);
    }
  },
  credentials: true
}));
app.use(express.json());

// Arquivos enviados (fotos de reivindicação, etc.) servidos estaticamente.
// O banco guarda a URL relativa (/uploads/...); aqui ela vira acessível.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads')));

// Log simples de requisições.
app.use((req, _res, next) => {
  console.log(`${req.method} ${req.url}`);
  next();
});

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
app.use('/api', finderRoutes);
app.use('/api', tinyRoutes);

// 404
app.use((req, res) => res.status(404).json({ erro: 'Rota não encontrada.' }));

// Tratador central de erros
app.use((err, _req, res, _next) => {
  console.error('ERRO:', err.message);
  res.status(500).json({ erro: 'Erro interno do servidor.' });
});

const PORT = Number(process.env.PORT || 3000);

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
