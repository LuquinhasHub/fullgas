// ============================================================
// Rotas da integração Tiny ERP
// ------------------------------------------------------------
//   GET  /api/tiny/produtos    lista do Tiny p/ importação (admin)
//   POST /api/tiny/importar    importa/vincula selecionados (admin)
//   POST /api/tiny/sync-lote   sincroniza produtos importados (admin)
//   GET  /api/tiny/log         histórico de sincronizações (admin)
//
// A atualização automática não passa por rota: é o agendamento
// node-cron (tiny-cron.js), que roda o mesmo lote do sync-lote.
// ============================================================
import { Router } from 'express';
import { query } from '../db.js';
import { requireAuth, requireAdmin } from '../auth.js';
import {
  listarProdutos, obterProdutoCompleto, aplicarAtualizacao,
  sincronizarLote, registrarLog
} from '../tiny.js';

const router = Router();

// Falha da integração (token faltando, Tiny fora do ar, limite da API) vira
// resposta clara para o admin em vez de "erro interno" genérico.
function tratarErro(e, res, next) {
  if (e && e.name === 'TinyError') return res.status(502).json({ erro: e.message });
  next(e);
}

// "sucesso" (e não "ok") porque o adapter do front usa "ok" como flag do HTTP.
function resumo(resultados) {
  return {
    total: resultados.length,
    sucesso: resultados.filter(r => r.status === 'ok').length,
    erros: resultados.filter(r => r.status === 'erro').length,
    ignorados: resultados.filter(r => r.status === 'ignorado').length
  };
}

// GET /api/tiny/produtos?pagina=1&pesquisa=  (admin)
// Lista do Tiny anotada com a situação local de cada item:
//   'importado'  já vinculado (TinyId no banco)
//   'sku-existe' o SKU existe no Fullgas sem vínculo — importar vincula
//   'novo'       não existe no Fullgas
router.get('/tiny/produtos', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const pagina = Math.max(1, Number(req.query.pagina) || 1);
    const lista = await listarProdutos(pagina, String(req.query.pesquisa || '').trim());

    let locais = [];
    if (lista.produtos.length) {
      const params = {};
      const porTiny = [], porSku = [];
      lista.produtos.forEach((p, i) => {
        params[`t${i}`] = p.tinyId; porTiny.push(`@t${i}`);
        if (p.sku) { params[`s${i}`] = p.sku; porSku.push(`@s${i}`); }
      });
      locais = await query(
        `SELECT Sku, TinyId FROM dbo.Produto
          WHERE TinyId IN (${porTiny.join(',')})` +
        (porSku.length ? ` OR Sku IN (${porSku.join(',')})` : ''),
        params
      );
    }
    const tinyIdsLocais = new Set(locais.filter(l => l.TinyId).map(l => l.TinyId));
    const skusLocais = new Set(locais.map(l => l.Sku));

    res.json({
      pagina: lista.pagina,
      totalPaginas: lista.totalPaginas,
      produtos: lista.produtos.map(p => ({
        ...p,
        statusLocal: tinyIdsLocais.has(p.tinyId) ? 'importado'
          : (p.sku && skusLocais.has(p.sku)) ? 'sku-existe'
          : 'novo'
      }))
    });
  } catch (e) { tratarErro(e, res, next); }
});

// POST /api/tiny/importar  (admin) — { tinyIds: [...], categoria: 'pecas' }
// Para cada id: busca o detalhe no Tiny e cria o produto no Fullgas com
// TinyAtivo = 1. Se o SKU já existe, vincula em vez de duplicar (e a
// categoria local é mantida — a do body só vale para produtos novos).
router.post('/tiny/importar', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const tinyIds = [...new Set((req.body.tinyIds || []).map(String).filter(Boolean))];
    if (!tinyIds.length) return res.status(400).json({ erro: 'Informe os produtos do Tiny a importar.' });

    const cat = await query('SELECT CategoriaId FROM dbo.Categoria WHERE Codigo = @cat', { cat: req.body.categoria });
    if (!cat.length) return res.status(400).json({ erro: 'Categoria inválida.' });
    const categoriaId = cat[0].CategoriaId;

    const resultados = [];
    for (const tinyId of tinyIds) {
      try {
        const jaVinculado = await query('SELECT Sku FROM dbo.Produto WHERE TinyId = @tid', { tid: tinyId });
        if (jaVinculado.length) {
          resultados.push({ tinyId, sku: jaVinculado[0].Sku, status: 'ignorado', msg: 'Já importado.' });
          continue;
        }

        const dados = await obterProdutoCompleto(tinyId);
        if (!dados.sku) {
          await registrarLog(tinyId, null, 'importacao', 'erro', 'Produto sem código (SKU) no Tiny.');
          resultados.push({ tinyId, status: 'erro', msg: 'Produto sem código (SKU) no Tiny.' });
          continue;
        }

        const existente = await query('SELECT ProdutoId FROM dbo.Produto WHERE Sku = @sku', { sku: dados.sku });
        if (existente.length) {
          await query(
            'UPDATE dbo.Produto SET TinyId = @tid, TinyAtivo = 1 WHERE ProdutoId = @pid',
            { tid: tinyId, pid: existente[0].ProdutoId }
          );
        } else {
          await query(
            `INSERT INTO dbo.Produto
               (Sku, Nome, CategoriaId, Descricao, Preco, Estoque, ImagemUrl,
                TinyId, TinyAtivo, TinySincronizadoEm)
             VALUES (@sku, @nome, @catId, @desc, @preco, @est, @foto,
                     @tid, 1, SYSUTCDATETIME())`,
            {
              sku: dados.sku, nome: dados.nome || dados.sku, catId: categoriaId,
              desc: dados.descricao, preco: dados.preco, est: dados.estoque,
              foto: dados.foto, tid: tinyId
            }
          );
        }
        // Vincular também espelha os campos na hora (e carimba a sincronização).
        const r = await aplicarAtualizacao(tinyId, dados, 'importacao');
        resultados.push({
          tinyId, sku: dados.sku,
          status: r.status === 'ok' ? 'ok' : r.status,
          msg: existente.length ? 'SKU já existia — vinculado ao Tiny.' : 'Importado.'
        });
      } catch (e) {
        await registrarLog(tinyId, null, 'importacao', 'erro', e.message);
        resultados.push({ tinyId, status: 'erro', msg: e.message });
      }
    }
    res.status(201).json({ ...resumo(resultados), resultados });
  } catch (e) { tratarErro(e, res, next); }
});

// POST /api/tiny/sync-lote  (admin)
// Body: { produtoIds: [...] } ou { skus: [...] } ou { todos: true }.
// Sequencial contra a API do Tiny — lotes grandes demoram (≈2 s por produto);
// o front envia em blocos e mostra o progresso.
router.post('/tiny/sync-lote', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    let produtoIds = null; // null = todos com TinyAtivo = 1
    if (!req.body.todos) {
      if (Array.isArray(req.body.produtoIds) && req.body.produtoIds.length) {
        produtoIds = req.body.produtoIds.map(Number).filter(Number.isFinite);
      } else if (Array.isArray(req.body.skus) && req.body.skus.length) {
        const params = {};
        req.body.skus.forEach((s, i) => { params[`s${i}`] = String(s); });
        const rows = await query(
          `SELECT ProdutoId FROM dbo.Produto WHERE Sku IN (${Object.keys(params).map(k => '@' + k).join(',')})`,
          params
        );
        produtoIds = rows.map(r => r.ProdutoId);
      } else {
        return res.status(400).json({ erro: 'Informe produtoIds, skus ou todos: true.' });
      }
      if (!produtoIds.length) return res.status(400).json({ erro: 'Nenhum produto encontrado para sincronizar.' });
    }

    const resultados = await sincronizarLote(produtoIds);
    res.json({ ...resumo(resultados), resultados });
  } catch (e) { tratarErro(e, res, next); }
});

// GET /api/tiny/log?limite=100  (admin) — últimos registros de sincronização
// (evento 'cron' = rodada automática, 'lote' = botão do admin, 'importacao').
router.get('/tiny/log', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const limite = Math.min(500, Math.max(1, Number(req.query.limite) || 100));
    const rows = await query(
      `SELECT TOP (@n) LogId, TinyId, Sku, Evento, Status, Mensagem, CriadoEm
         FROM dbo.TinySyncLog ORDER BY LogId DESC`,
      { n: limite }
    );
    res.json(rows.map(r => ({
      id: r.LogId, tinyId: r.TinyId, sku: r.Sku, evento: r.Evento,
      status: r.Status, mensagem: r.Mensagem, data: r.CriadoEm
    })));
  } catch (e) { tratarErro(e, res, next); }
});

export default router;
