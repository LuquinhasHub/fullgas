// ============================================================
// Rotas de catálogo: categorias e produtos (SKUs)
// ============================================================
import { Router } from 'express';
import { query } from '../db.js';
import { requireAuth, requireAdmin } from '../auth.js';

const router = Router();

// Mapeia uma linha do banco para o formato que o front (store.js) já espera.
function toProduto(r) {
  return {
    artigo: r.Sku,
    nome: r.Nome,
    cat: r.CategoriaCodigo,
    preco: Number(r.Preco),
    estoque: r.Estoque,
    descricao: r.Descricao || '',
    previsao: r.PrevisaoChegada || null
  };
}

const SELECT_PROD =
  `SELECT p.ProdutoId, p.Sku, p.Nome, p.Descricao, p.Preco, p.Estoque,
          p.PrevisaoChegada, c.Codigo AS CategoriaCodigo
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
    res.json(rows.map(toProduto));
  } catch (e) { next(e); }
});

// GET /api/produtos/:sku
router.get('/produtos/:sku', requireAuth, async (req, res, next) => {
  try {
    const rows = await query(SELECT_PROD + ' WHERE p.Sku = @sku', { sku: req.params.sku });
    if (!rows.length) return res.status(404).json({ erro: 'Produto não encontrado.' });
    res.json(toProduto(rows[0]));
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
router.put('/produtos/:sku', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const { nome, cat, preco, estoque, previsao, descricao } = req.body;
    const c = await query('SELECT CategoriaId FROM dbo.Categoria WHERE Codigo = @cat', { cat });
    if (!c.length) return res.status(400).json({ erro: 'Categoria inválida.' });

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
    await query('DELETE FROM dbo.Produto WHERE Sku=@sku', { sku: req.params.sku });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

export default router;
