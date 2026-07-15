// ============================================================
// Integração com o Tiny ERP — API v2 (token simples, sem OAuth)
// ------------------------------------------------------------
// O Tiny é a única fonte de verdade dos produtos importados dele:
// estoque, preço, nome, descrição e foto são sempre espelho do
// Tiny (Tiny → Fullgas, sem override manual). No sentido inverso
// vão só os PEDIDOS (tiny-pedidos.js): cada compra no site vira um
// pedido 'aprovado' no Tiny, baixando o estoque lá na hora.
//
// A atualização automática NÃO usa webhook (método descartado —
// as notificações do Tiny se mostraram pouco confiáveis): é o
// agendamento node-cron em tiny-cron.js que, a cada N minutos,
// roda o MESMO lote do botão "Sincronizar" do admin
// (sincronizarLote, no fim deste arquivo).
//
// Toda a comunicação com o Tiny passa por este arquivo — se a
// API deles mudar, só este arquivo muda.
// ============================================================
import 'dotenv/config';
import { query } from './db.js';

const BASE = 'https://api.tiny.com.br/api2';

// O Tiny v2 bloqueia o token que passa de ~60 requisições por minuto.
// Todas as chamadas passam por uma fila que garante o intervalo mínimo —
// um lote grande fica lento, mas nunca derruba a integração inteira.
// Chamadas PRIORITÁRIAS (cliente esperando: checagem de estoque do checkout
// e exportação de pedido) furam a fila — entram na FRENTE do lote do cron,
// senão o checkout ficaria minutos atrás de uma rodada de sincronização.
const INTERVALO_MS = 1100;
const filaEspera = [];   // resolvers aguardando a vez de chamar o Tiny
let despachando = false;
let ultimaChamadaEm = 0;

function aguardarVez(prioritario = false) {
  return new Promise(resolve => {
    if (prioritario) filaEspera.unshift(resolve);
    else filaEspera.push(resolve);
    despachar();
  });
}

async function despachar() {
  if (despachando) return;
  despachando = true;
  while (filaEspera.length) {
    const espera = ultimaChamadaEm + INTERVALO_MS - Date.now();
    if (espera > 0) await new Promise(r => setTimeout(r, espera));
    ultimaChamadaEm = Date.now();
    filaEspera.shift()();
  }
  despachando = false;
}

class TinyError extends Error {
  constructor(msg, codigo) {
    super(msg);
    this.name = 'TinyError';
    this.codigo = codigo != null ? String(codigo) : null;
  }
}

// POST na API v2 (o Tiny só aceita POST form-encoded). Lança TinyError
// quando o retorno vem com status "Erro".
async function tinyPost(endpoint, params = {}, { prioritario = false } = {}) {
  const token = process.env.TINY_TOKEN;
  if (!token) throw new TinyError('TINY_TOKEN não configurado no .env da API.');
  await aguardarVez(prioritario);

  const body = new URLSearchParams({ token, formato: 'json' });
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') body.append(k, String(v));
  }

  const resp = await fetch(`${BASE}/${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString()
  });
  if (!resp.ok) throw new TinyError(`Tiny respondeu HTTP ${resp.status}.`);

  const data = await resp.json().catch(() => null);
  const ret = data?.retorno;
  if (!ret) throw new TinyError('Resposta do Tiny em formato inesperado.');
  if (String(ret.status).toLowerCase() === 'erro') {
    const erros = ret.erros || [];
    const msg = erros.map(e => e?.erro).filter(Boolean).join('; ')
      || 'Erro não especificado do Tiny.';
    throw new TinyError(`Tiny: ${msg}`, ret.codigo_erro);
  }
  return ret;
}

/* ---------------- normalização dos dados do Tiny ---------------- */

// Descrição no Tiny vem em HTML (parágrafos e listas <ul><li>). A coluna
// guarda 1000 chars de TEXTO — mas preservamos a estrutura como quebras de
// linha: cada item de lista vira uma linha com marcador "• " e o fim de cada
// bloco (</p>, </li>, </div>...) quebra linha. Sem isso os itens ficariam
// grudados num texto corrido. A loja renderiza essas quebras (white-space).
function limparDescricao(html) {
  if (!html) return null;
  const texto = String(html)
    .replace(/<li[^>]*>/gi, '\n• ')                       // item de lista → linha com marcador
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|ul|ol|tr|h[1-6])\s*>/gi, '\n')     // fim de bloco → quebra (</li> não: o <li> já abriu linha)
    .replace(/<[^>]+>/g, '')                              // remove as demais tags
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#3?9;|&apos;/gi, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')                             // sem espaços em volta das quebras
    .replace(/\n{3,}/g, '\n\n')                           // no máximo uma linha em branco
    .trim();
  return texto ? texto.slice(0, 1000) : null;
}

// Primeira imagem dos anexos ([{ anexo: 'https://...' }]).
function primeiraFoto(anexos) {
  if (!Array.isArray(anexos)) return null;
  for (const a of anexos) {
    const url = typeof a === 'string' ? a : a?.anexo;
    if (url && /^https?:\/\//i.test(url)) return String(url).slice(0, 400);
  }
  return null;
}

// Estoque nunca negativo (o Tiny permite saldo negativo; o Fullgas não).
function clampEstoque(v) {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/* ---------------- consultas ao Tiny ---------------- */

// Lista paginada de produtos do Tiny (100 por página) — tela de importação.
// Página sem resultados não é erro: o Tiny devolve codigo_erro 20.
export async function listarProdutos(pagina = 1, pesquisa = '') {
  let ret;
  try {
    ret = await tinyPost('produtos.pesquisa.php', { pagina, pesquisa });
  } catch (e) {
    if (e instanceof TinyError && e.codigo === '20') {
      return { pagina: Number(pagina) || 1, totalPaginas: 0, produtos: [] };
    }
    throw e;
  }
  const produtos = (ret.produtos || []).map(w => w.produto).filter(Boolean).map(p => ({
    tinyId: String(p.id),
    sku: String(p.codigo || '').trim().toUpperCase(),
    nome: String(p.nome || '').trim(),
    preco: Math.max(0, Number(p.preco) || 0),
    situacao: p.situacao || ''       // 'A' ativo | 'I' inativo | 'E' excluído
  }));
  return {
    pagina: Number(ret.pagina) || Number(pagina) || 1,
    totalPaginas: Number(ret.numero_paginas) || 1,
    produtos
  };
}

// Detalhe completo + saldo de estoque de um produto, já normalizado para as
// colunas do Fullgas. O saldo vem de produto.obter.estoque.php quando o
// detalhe não o trouxer junto.
export async function obterProdutoCompleto(tinyId) {
  const p = (await tinyPost('produto.obter.php', { id: tinyId })).produto;
  if (!p) throw new TinyError('Produto não encontrado no Tiny.');

  let saldo = p.saldo ?? p.estoqueAtual ?? p.estoque_atual;
  if (saldo === undefined) {
    const est = (await tinyPost('produto.obter.estoque.php', { id: tinyId })).produto;
    saldo = est?.saldo;
  }

  return {
    tinyId: String(p.id ?? tinyId),
    sku: String(p.codigo || '').trim().toUpperCase(),
    nome: String(p.nome || '').trim().slice(0, 200),
    preco: Math.max(0, Number(p.preco) || 0),
    estoque: clampEstoque(saldo),
    descricao: limparDescricao(p.descricao_complementar),
    foto: primeiraFoto(p.anexos)
  };
}

/* ---------------- pedidos no Tiny (escrita) ---------------- */

// Saldo atual de um produto no Tiny — usado pela checagem em tempo real do
// checkout (prioritário: o cliente está esperando a resposta).
export async function obterSaldoAtual(tinyId) {
  const est = (await tinyPost('produto.obter.estoque.php', { id: tinyId }, { prioritario: true })).produto;
  return clampEstoque(est?.saldo);
}

// Inclui um pedido no Tiny (pedido.incluir.php). Recebe o objeto já no formato
// da API v2 (cliente, itens, numero_pedido_ecommerce...) e devolve { id, numero }
// do pedido criado lá. O retorno vem em registros[].registro (às vezes objeto).
export async function incluirPedido(pedido) {
  const ret = await tinyPost('pedido.incluir.php',
    { pedido: JSON.stringify({ pedido }) }, { prioritario: true });
  const regs = ret.registros;
  const reg = Array.isArray(regs) ? regs[0]?.registro : (regs?.registro ?? regs);
  if (String(reg?.status).toLowerCase() === 'erro') {
    const msg = (reg.erros || []).map(e => e?.erro).filter(Boolean).join('; ')
      || 'Erro não especificado ao incluir o pedido.';
    throw new TinyError(`Tiny: ${msg}`, reg.codigo_erro);
  }
  if (!reg?.id) throw new TinyError('Tiny não devolveu o id do pedido incluído.');
  return { id: String(reg.id), numero: reg.numero != null ? String(reg.numero) : null };
}

// Muda a situação de um pedido no Tiny. 'aprovado' baixa o estoque lá (com a
// conta configurada para lançar estoque na aprovação); 'cancelado' devolve.
export async function alterarSituacaoPedido(tinyPedidoId, situacao) {
  await tinyPost('pedido.alterar.situacao.php',
    { id: tinyPedidoId, situacao }, { prioritario: true });
}

// Vendas do Fullgas ainda não registradas no Tiny (exportação pendente ou com
// erro): o saldo do Tiny ainda não desconta essas peças, então quem ESPELHA o
// estoque precisa subtraí-las — sem isso o cron "devolveria" ao site um estoque
// que já foi vendido aqui. Cobre o escopo 'normal' (itens baixados na criação
// do pedido); a janela do 'backorder' dura segundos e ficou de fora de propósito.
export async function reservaPendente(produtoId) {
  const rows = await query(
    `SELECT ISNULL(SUM(pi.Quantidade), 0) AS Reserva
       FROM dbo.PedidoItem pi
       JOIN dbo.TinyPedidoExport te ON te.PedidoId = pi.PedidoId
      WHERE te.Escopo = 'normal' AND te.Status IN ('pendente', 'erro')
        AND pi.EmBackorder = 0 AND pi.ProdutoId = @pid`,
    { pid: produtoId }
  );
  return rows[0]?.Reserva || 0;
}

/* ---------------- gravação no banco ---------------- */

export async function registrarLog(tinyId, sku, evento, status, mensagem) {
  await query(
    `INSERT INTO dbo.TinySyncLog (TinyId, Sku, Evento, Status, Mensagem)
     VALUES (@tid, @sku, @ev, @st, @msg)`,
    {
      tid: tinyId != null ? String(tinyId).slice(0, 40) : null,
      sku: sku || null,
      ev: evento,
      st: status,
      msg: mensagem ? String(mensagem).slice(0, 500) : null
    }
  ).catch(e => console.error('TinySyncLog falhou:', e.message));
}

// Mantém no TinySyncLog apenas os 3 registros de 'cron' mais recentes de cada
// produto — o cron roda o dia todo e o log do editor de produto ficava
// gigante sem dizer nada de novo. Eventos manuais ('lote', 'importacao') não
// são tocados. Chamada ao fim de cada rodada do cron (tiny-cron.js).
export async function podarLogCron(manterPorProduto = 3) {
  await query(
    `WITH ranqueado AS (
       SELECT LogId,
              ROW_NUMBER() OVER (PARTITION BY COALESCE(Sku, TinyId)
                                 ORDER BY LogId DESC) AS rn
         FROM dbo.TinySyncLog
        WHERE Evento = 'cron'
     )
     DELETE FROM ranqueado WHERE rn > @n`,
    { n: Math.max(1, manterPorProduto) }
  ).catch(e => console.error('Poda do TinySyncLog falhou:', e.message));
}

// Aplica no produto local os campos espelhados do Tiny. Só grava o que veio
// definido em `dados` (um campo ausente não apaga o valor atual).
export async function aplicarAtualizacao(tinyId, dados, evento) {
  const rows = await query(
    'SELECT ProdutoId, Sku, TinyAtivo FROM dbo.Produto WHERE TinyId = @tid',
    { tid: String(tinyId) }
  );
  if (!rows.length) {
    await registrarLog(tinyId, null, evento, 'ignorado', 'Produto não importado no Fullgas.');
    return { status: 'ignorado', msg: 'Produto não importado no Fullgas.' };
  }
  const p = rows[0];
  if (!p.TinyAtivo) {
    await registrarLog(tinyId, p.Sku, evento, 'ignorado', 'Sincronização desativada (TinyAtivo = 0).');
    return { status: 'ignorado', sku: p.Sku, msg: 'Sincronização desativada.' };
  }

  const sets = ['TinySincronizadoEm = SYSUTCDATETIME()', 'AtualizadoEm = SYSUTCDATETIME()'];
  const params = { pid: p.ProdutoId };
  if (dados.estoque !== undefined) {
    // Saldo do Tiny menos as vendas locais que ainda não chegaram lá
    // (exportação pendente/erro) — ver reservaPendente.
    const reserva = await reservaPendente(p.ProdutoId);
    sets.push('Estoque = @est');
    params.est = Math.max(0, clampEstoque(dados.estoque) - reserva);
  }
  if (dados.preco !== undefined) { sets.push('Preco = @preco'); params.preco = Math.max(0, Number(dados.preco) || 0); }
  if (dados.nome !== undefined && dados.nome) { sets.push('Nome = @nome'); params.nome = String(dados.nome).slice(0, 200); }
  if (dados.descricao !== undefined) { sets.push('Descricao = @desc'); params.desc = dados.descricao || null; }
  if (dados.foto !== undefined && dados.foto) { sets.push('ImagemUrl = @foto'); params.foto = dados.foto; }

  await query(`UPDATE dbo.Produto SET ${sets.join(', ')} WHERE ProdutoId = @pid`, params);
  await registrarLog(tinyId, p.Sku, evento, 'ok', null);
  return { status: 'ok', sku: p.Sku };
}

// Sincroniza um lote de produtos locais (por ProdutoId) contra o Tiny.
// É o coração da atualização automática E da manual — o botão "Sincronizar"
// do admin e o agendamento do tiny-cron.js chamam esta mesma função:
//   - `produtoIds = null` sincroniza todos os produtos com TinyAtivo = 1
//     (é assim que o cron usa);
//   - `evento` identifica a origem no TinySyncLog: 'lote' (botão do admin)
//     ou 'cron' (agendamento automático).
// Sequencial de propósito: a fila de requisições já limita o ritmo.
export async function sincronizarLote(produtoIds = null, evento = 'lote') {
  let sqlSel = `SELECT ProdutoId, TinyId, Sku FROM dbo.Produto
                 WHERE TinyAtivo = 1 AND TinyId IS NOT NULL`;
  const params = {};
  if (Array.isArray(produtoIds)) {
    if (!produtoIds.length) return [];
    const marcadores = produtoIds.map((_, i) => `@p${i}`);
    produtoIds.forEach((id, i) => { params[`p${i}`] = Number(id); });
    sqlSel += ` AND ProdutoId IN (${marcadores.join(',')})`;
  }
  const produtos = await query(sqlSel + ' ORDER BY Sku', params);

  const resultados = [];
  for (const p of produtos) {
    try {
      const dados = await obterProdutoCompleto(p.TinyId);
      const r = await aplicarAtualizacao(p.TinyId, dados, evento);
      resultados.push({ sku: p.Sku, tinyId: p.TinyId, ...r });
    } catch (e) {
      await registrarLog(p.TinyId, p.Sku, evento, 'erro', e.message);
      resultados.push({ sku: p.Sku, tinyId: p.TinyId, status: 'erro', msg: e.message });
    }
  }
  return resultados;
}
