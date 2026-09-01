// ============================================================
// Rotas de catálogo: categorias e produtos (SKUs)
// ------------------------------------------------------------
// Camada de ROTEAMENTO — só o fio HTTP: caminho + middlewares + controller.
// Regra de negócio → services/ ; SQL → repositories/ ; forma da resposta →
// controllers/. Ver docs/10-arquitetura-em-camadas.md.
// ============================================================
import { Router } from 'express';
import { requireAuth, requireAdmin, requireAreaAny } from '../auth.js';
import { uploadImagemProduto } from '../middlewares/upload-produto.js';
import { uploadImagemCategoria } from '../middlewares/upload-categoria.js';
import * as categorias from '../controllers/categoria.controller.js';
import * as produtos from '../controllers/produto.controller.js';

const router = Router();

/* ------------------------------------------------------------
   O catálogo é consultado por TRÊS telas — a loja, o Parts Finder e o
   formulário de reivindicação de garantia (que escolhe peças pelo SKU).
   Por isso a leitura aceita qualquer uma das três áreas: exigir só 'loja'
   deixaria uma conta de finder sem os nomes das peças e uma conta de
   garantias sem conseguir montar a reivindicação.

   Não é dado de um cliente específico — o catálogo é o mesmo para todos os
   revendedores. O que o gate evita é entregar preço e estoque a uma conta
   interna que não tem nenhuma área comercial.
   ------------------------------------------------------------ */
const podeLerCatalogo = requireAreaAny(['loja', 'finder', 'reivindicacoes']);

// ---- Categorias ----
router.get('/categorias', requireAuth, podeLerCatalogo, categorias.listar);
router.post('/categorias', requireAuth, requireAdmin, categorias.criar);
router.put('/categorias/:codigo', requireAuth, requireAdmin, categorias.renomear);
router.delete('/categorias/:codigo', requireAuth, requireAdmin, categorias.excluir);
router.post('/categorias/:codigo/imagem', requireAuth, requireAdmin, uploadImagemCategoria, categorias.enviarImagem);
router.delete('/categorias/:codigo/imagem', requireAuth, requireAdmin, categorias.removerImagem);

// ---- Produtos ----
router.get('/produtos', requireAuth, podeLerCatalogo, produtos.listar);
router.get('/produtos/:sku', requireAuth, podeLerCatalogo, produtos.obter);
router.post('/produtos', requireAuth, requireAdmin, produtos.criar);
router.put('/produtos/:sku', requireAuth, requireAdmin, produtos.atualizar);
router.delete('/produtos/:sku', requireAuth, requireAdmin, produtos.excluir);
router.post('/produtos/:sku/imagem', requireAuth, requireAdmin, uploadImagemProduto, produtos.enviarImagem);
router.delete('/produtos/:sku/imagem', requireAuth, requireAdmin, produtos.removerImagem);

export default router;
