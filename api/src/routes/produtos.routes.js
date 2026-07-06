// ============================================================
// Rotas de catálogo: categorias e produtos (SKUs)
// ============================================================
import { Router } from 'express';
import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { query } from '../db.js';
import { requireAuth, requireAdmin } from '../auth.js';
import { apagarUpload } from './finder.routes.js';

const router = Router();

// ---- Upload da foto do produto (miniatura no finder/admin) ----------------
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROD_DIR = path.join(__dirname, '..', '..', 'uploads', 'produtos');
fs.mkdirSync(PROD_DIR, { recursive: true });
const PROD_URL_BASE = '/uploads/produtos/';
const IMG_EXT = ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp', '.svg'];

const uploadProd = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, PROD_DIR),
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname || '').toLowerCase().slice(0, 10);
      cb(null, Date.now() + '-' + Math.random().toString(36).slice(2, 10) + ext);
    }
  }),
  limits: { fileSize: 15 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    const mime = file.mimetype || '';
    const ext = path.extname(file.originalname || '').toLowerCase();
    if (mime.startsWith('image/') || IMG_EXT.includes(ext)) return cb(null, true);
    cb(new Error('Envie apenas imagens.'));
  }
});
function uploadImagemProduto(req, res, next) {
  uploadProd.single('imagem')(req, res, (err) => {
    if (err) {
      const msg = err.code === 'LIMIT_FILE_SIZE'
        ? 'Imagem muito grande (máximo 15 MB).'
        : (err.message || 'Falha no upload.');
      return res.status(400).json({ erro: msg });
    }
    if (!req.file) return res.status(400).json({ erro: 'Envie o arquivo no campo "imagem".' });
    next();
  });
}

function urlAbs(req, rel) {
  if (!rel) return rel || null;
  if (/^https?:\/\//i.test(rel)) return rel;
  return req.protocol + '://' + req.get('host') + rel;
}

// Mapeia uma linha do banco para o formato que o front (store.js) já espera.
function toProduto(req, r) {
  return {
    artigo: r.Sku,
    nome: r.Nome,
    cat: r.CategoriaCodigo,
    preco: Number(r.Preco),
    estoque: r.Estoque,
    descricao: r.Descricao || '',
    previsao: r.PrevisaoChegada || null,
    imagem: urlAbs(req, r.ImagemUrl),
    tinyAtivo: !!r.TinyAtivo,
    tinySincronizadoEm: r.TinySincronizadoEm || null
  };
}

const SELECT_PROD =
  `SELECT p.ProdutoId, p.Sku, p.Nome, p.Descricao, p.Preco, p.Estoque,
          p.PrevisaoChegada, p.ImagemUrl, p.TinyAtivo, p.TinySincronizadoEm,
          c.Codigo AS CategoriaCodigo
     FROM dbo.Produto p
     JOIN dbo.Categoria c ON c.CategoriaId = p.CategoriaId`;

// GET /api/categorias
router.get('/categorias', requireAuth, async (req, res, next) => {
  try {
    const rows = await query(
      'SELECT Codigo AS id, Nome AS nome, Icone AS icone FROM dbo.Categoria WHERE Ativo = 1 ORDER BY Ordem, Nome'
    );
    res.json(rows);
  } catch (e) { next(e); }
});

// GET /api/produtos  (?categoria=pecas opcional)
router.get('/produtos', requireAuth, async (req, res, next) => {
  try {
    const { categoria } = req.query;
    let rows;
    if (categoria) {
      rows = await query(SELECT_PROD + ' WHERE c.Codigo = @cat ORDER BY p.Nome', { cat: categoria });
    } else {
      rows = await query(SELECT_PROD + ' ORDER BY p.Nome');
    }
    res.json(rows.map(r => toProduto(req, r)));
  } catch (e) { next(e); }
});

// GET /api/produtos/:sku
router.get('/produtos/:sku', requireAuth, async (req, res, next) => {
  try {
    const rows = await query(SELECT_PROD + ' WHERE p.Sku = @sku', { sku: req.params.sku });
    if (!rows.length) return res.status(404).json({ erro: 'Produto não encontrado.' });
    res.json(toProduto(req, rows[0]));
  } catch (e) { next(e); }
});

// POST /api/produtos  (admin) — cria
router.post('/produtos', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const { artigo, nome, cat, preco, estoque, previsao, descricao } = req.body;
    if (!artigo || !nome || !(preco >= 0)) return res.status(400).json({ erro: 'Dados incompletos.' });

    const c = await query('SELECT CategoriaId FROM dbo.Categoria WHERE Codigo = @cat', { cat });
    if (!c.length) return res.status(400).json({ erro: 'Categoria inválida.' });

    await query(
      `INSERT INTO dbo.Produto (Sku, Nome, CategoriaId, Descricao, Preco, Estoque, PrevisaoChegada)
       VALUES (@sku, @nome, @catId, @desc, @preco, @est, @prev)`,
      {
        sku: artigo, nome, catId: c[0].CategoriaId, desc: descricao || null,
        preco, est: estoque || 0, prev: previsao || null
      }
    );
    res.status(201).json({ ok: true });
  } catch (e) { next(e); }
});

// PUT /api/produtos/:sku  (admin) — edita
// Produto do Tiny (TinyAtivo = 1): nome, preço, estoque, descrição e foto são
// espelho do ERP — aqui só categoria e previsão de chegada podem mudar.
router.put('/produtos/:sku', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const { nome, cat, preco, estoque, previsao, descricao } = req.body;
    const c = await query('SELECT CategoriaId FROM dbo.Categoria WHERE Codigo = @cat', { cat });
    if (!c.length) return res.status(400).json({ erro: 'Categoria inválida.' });

    const atual = await query('SELECT TinyAtivo FROM dbo.Produto WHERE Sku = @sku', { sku: req.params.sku });
    if (!atual.length) return res.status(404).json({ erro: 'Produto não encontrado.' });
    if (atual[0].TinyAtivo) {
      await query(
        `UPDATE dbo.Produto
            SET CategoriaId=@catId, PrevisaoChegada=@prev, AtualizadoEm=SYSUTCDATETIME()
          WHERE Sku=@sku`,
        { sku: req.params.sku, catId: c[0].CategoriaId, prev: previsao || null }
      );
      return res.json({ ok: true, tiny: true });
    }

    await query(
      `UPDATE dbo.Produto
          SET Nome=@nome, CategoriaId=@catId, Descricao=@desc,
              Preco=@preco, Estoque=@est, PrevisaoChegada=@prev, AtualizadoEm=SYSUTCDATETIME()
        WHERE Sku=@sku`,
      {
        sku: req.params.sku, nome, catId: c[0].CategoriaId, desc: descricao || null,
        preco, est: estoque || 0, prev: previsao || null
      }
    );
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// DELETE /api/produtos/:sku  (admin)
router.delete('/produtos/:sku', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const rows = await query('DELETE FROM dbo.Produto OUTPUT deleted.ImagemUrl WHERE Sku=@sku', { sku: req.params.sku });
    if (rows.length) apagarUpload(rows[0].ImagemUrl);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// POST /api/produtos/:sku/imagem  (admin) — sobe/troca a foto da peça
// (miniatura mostrada no Parts Finder e no painel). Campo multipart: "imagem".
router.post('/produtos/:sku/imagem', requireAuth, requireAdmin, uploadImagemProduto, async (req, res, next) => {
  try {
    const atual = await query('SELECT TinyAtivo FROM dbo.Produto WHERE Sku = @sku', { sku: req.params.sku });
    if (atual.length && atual[0].TinyAtivo) {
      apagarUpload(PROD_URL_BASE + req.file.filename);
      return res.status(400).json({ erro: 'A foto deste produto é gerenciada pelo Tiny ERP.' });
    }
    const rel = PROD_URL_BASE + req.file.filename;
    const rows = await query(
      `UPDATE dbo.Produto SET ImagemUrl = @img, AtualizadoEm = SYSUTCDATETIME()
       OUTPUT deleted.ImagemUrl AS Anterior
       WHERE Sku = @sku`,
      { img: rel, sku: req.params.sku }
    );
    if (!rows.length) {
      apagarUpload(rel);
      return res.status(404).json({ erro: 'Produto não encontrado.' });
    }
    apagarUpload(rows[0].Anterior);
    res.status(201).json({ ok: true, imagem: urlAbs(req, rel) });
  } catch (e) { next(e); }
});

// DELETE /api/produtos/:sku/imagem  (admin) — remove a foto da peça.
router.delete('/produtos/:sku/imagem', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const atual = await query('SELECT TinyAtivo FROM dbo.Produto WHERE Sku = @sku', { sku: req.params.sku });
    if (atual.length && atual[0].TinyAtivo) {
      return res.status(400).json({ erro: 'A foto deste produto é gerenciada pelo Tiny ERP.' });
    }
    const rows = await query(
      `UPDATE dbo.Produto SET ImagemUrl = NULL, AtualizadoEm = SYSUTCDATETIME()
       OUTPUT deleted.ImagemUrl AS Anterior
       WHERE Sku = @sku`,
      { sku: req.params.sku }
    );
    if (!rows.length) return res.status(404).json({ erro: 'Produto não encontrado.' });
    apagarUpload(rows[0].Anterior);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

export default router;
