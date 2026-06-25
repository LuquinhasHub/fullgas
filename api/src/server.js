// ============================================================
// Servidor Express — ponto de entrada da API Fullgas
// ============================================================
import express from 'express';
import cors from 'cors';
import 'dotenv/config';

import { getPool } from './db.js';
import authRoutes from './routes/auth.routes.js';
import produtosRoutes from './routes/produtos.routes.js';
import pedidosRoutes from './routes/pedidos.routes.js';
import veiculosRoutes from './routes/veiculos.routes.js';
import faturasRoutes from './routes/faturas.routes.js';
import preVendaRoutes from './routes/prevenda.routes.js';

const app = express();

app.use(cors({ origin: process.env.CORS_ORIGIN || '*' }));
app.use(express.json());

// Log simples de requisições.
app.use((req, _res, next) => {
  console.log(`${req.method} ${req.url}`);
  next();
});

// Healthcheck — útil pra testar se a API subiu.
app.get('/api/health', (_req, res) => res.json({ ok: true, ts: new Date().toISOString() }));

// Rotas
app.use('/api/auth', authRoutes);
app.use('/api', produtosRoutes);
app.use('/api', pedidosRoutes);
app.use('/api', veiculosRoutes);
app.use('/api', faturasRoutes);
app.use('/api', preVendaRoutes);

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
    app.listen(PORT, () => console.log(`✓ API ouvindo em http://localhost:${PORT}`));
  })
  .catch(() => {
    console.error('A API não subiu porque não conectou no banco. Confira o arquivo .env.');
    process.exit(1);
  });
