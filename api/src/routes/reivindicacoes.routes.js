// ============================================================
// Rotas de reivindicações (garantia) — versão básica.
// Cliente vê/abre apenas as da própria empresa; admin vê todas e muda status.
// Anexos (fotos) e campos expandidos vêm na Frente 2.
// ============================================================
import { Router } from 'express';
import { query, getPool, sql } from '../db.js';
import { requireAuth, requireAdmin } from '../auth.js';

const router = Router();

// Status válidos (espelham o CHECK constraint da tabela Reivindicacao).
const STATUS_VALIDOS = ['Em processo', 'Esboço', 'Aprovada', 'Recusada'];
// Na criação o cliente só pode abrir como "Em processo" ou salvar "Esboço".
const STATUS_CRIACAO = ['Em processo', 'Esboço'];
const TIPOS_VALIDOS = ['IT', 'Manufacturer', 'Implícito'];

function toIso(d) {
  return d instanceof Date ? d.toISOString() : (d || null);
}

// SELECT base com os JOINs que alimentam o formato esperado pelo front.
const SELECT_REIV =
  `SELECT r.Numero, r.Tipo, r.Status, r.Pais, r.PreAutorizacao, r.Devolvido,
          r.Descricao, r.DataAbertura, r.EmpresaId,
          e.RazaoSocial AS Empresa, v.Niv AS Niv
     FROM dbo.Reivindicacao r
     LEFT JOIN dbo.Empresa e ON e.EmpresaId = r.EmpresaId
     LEFT JOIN dbo.Veiculo v ON v.VeiculoId = r.VeiculoId`;

// Mapeia a linha do banco para o formato que o store.js/portal.js esperam.
function montar(r) {
  return {
    id: r.Numero,
    data: toIso(r.DataAbertura),
    criador: r.Empresa || '',
    pais: r.Pais,
    tipo: r.Tipo,
    niv: r.Niv || '',
    status: r.Status,
    preAuth: r.PreAutorizacao ? 'Sim' : 'Não',
    sentBack: !!r.Devolvido,
    descricao: r.Descricao || '',
    empresaId: r.EmpresaId
  };
}

// GET /api/reivindicacoes — cliente vê as da própria empresa; admin vê todas.
// Filtro opcional ?status=Em processo|Esboço|Aprovada|Recusada.
router.get('/reivindicacoes', requireAuth, async (req, res, next) => {
  try {
    const eid = req.user.papel === 'admin' ? null : req.user.empresaId;
    const status = STATUS_VALIDOS.includes(req.query.status) ? req.query.status : null;
    const rows = await query(
      SELECT_REIV +
        ` WHERE (@eid IS NULL OR r.EmpresaId = @eid)
            AND (@status IS NULL OR r.Status = @status)
          ORDER BY r.DataAbertura DESC, r.ReivindicacaoId DESC`,
      { eid, status }
    );
    res.json(rows.map(montar));
  } catch (e) { next(e); }
});

// GET /api/reivindicacoes/:numero — detalhe (respeita o escopo de empresa).
router.get('/reivindicacoes/:numero', requireAuth, async (req, res, next) => {
  try {
    const eid = req.user.papel === 'admin' ? null : req.user.empresaId;
    const rows = await query(
      SELECT_REIV + ' WHERE r.Numero = @num AND (@eid IS NULL OR r.EmpresaId = @eid)',
      { num: req.params.numero, eid }
    );
    if (!rows.length) return res.status(404).json({ erro: 'Reivindicação não encontrada.' });
    res.json(montar(rows[0]));
  } catch (e) { next(e); }
});

// POST /api/reivindicacoes — cria a partir de { tipo, niv, descricao, status }.
// EmpresaId/UsuarioId vêm do token (não confia no corpo). Numero único de 8 díg.
router.post('/reivindicacoes', requireAuth, async (req, res, next) => {
  const tipo = String(req.body?.tipo || '').trim();
  const niv = String(req.body?.niv || '').trim();
  const descricao = String(req.body?.descricao || '').trim();
  let status = String(req.body?.status || 'Em processo').trim();

  if (!TIPOS_VALIDOS.includes(tipo))
    return res.status(400).json({ erro: 'Tipo de reivindicação inválido.' });
  if (!descricao)
    return res.status(400).json({ erro: 'Descreva o problema antes de salvar.' });
  if (!STATUS_CRIACAO.includes(status)) status = 'Em processo';

  const pool = await getPool();
  const tx = new sql.Transaction(pool);
  try {
    await tx.begin();

    // Resolve o veículo pelo NIV (se informado).
    let veiculoId = null;
    if (niv) {
      const veic = await new sql.Request(tx)
        .input('niv', sql.VarChar(30), niv)
        .query('SELECT VeiculoId FROM dbo.Veiculo WHERE Niv = @niv');
      if (!veic.recordset.length) {
        await tx.rollback();
        return res.status(400).json({ erro: 'Veículo não encontrado: ' + niv });
      }
      veiculoId = veic.recordset[0].VeiculoId;
    }

    // Numero único de 8 dígitos — tenta algumas vezes em caso de colisão.
    let numero = null;
    for (let i = 0; i < 8 && !numero; i++) {
      const cand = String(Math.floor(10000000 + Math.random() * 90000000));
      const ja = await new sql.Request(tx)
        .input('n', sql.VarChar(20), cand)
        .query('SELECT 1 FROM dbo.Reivindicacao WHERE Numero = @n');
      if (!ja.recordset.length) numero = cand;
    }
    if (!numero) {
      await tx.rollback();
      return res.status(503).json({ erro: 'Não foi possível gerar o número. Tente novamente.' });
    }

    const ins = await new sql.Request(tx)
      .input('num', sql.VarChar(20), numero)
      .input('eid', sql.Int, req.user.empresaId)
      .input('uid', sql.Int, req.user.id)
      .input('vid', sql.Int, veiculoId)
      .input('tipo', sql.VarChar(16), tipo)
      .input('status', sql.VarChar(14), status)
      .input('desc', sql.NVarChar(1000), descricao)
      .query(`INSERT INTO dbo.Reivindicacao
                (Numero, EmpresaId, UsuarioId, VeiculoId, Tipo, Status, Descricao)
              OUTPUT inserted.ReivindicacaoId
              VALUES (@num, @eid, @uid, @vid, @tipo, @status, @desc)`);

    await tx.commit();

    const rows = await query(SELECT_REIV + ' WHERE r.ReivindicacaoId = @id',
      { id: ins.recordset[0].ReivindicacaoId });
    res.status(201).json(montar(rows[0]));
  } catch (e) {
    try { await tx.rollback(); } catch { /* já desfeita */ }
    next(e);
  }
});

// PUT /api/reivindicacoes/:numero/status (admin) — muda o status.
router.put('/reivindicacoes/:numero/status', requireAuth, requireAdmin, async (req, res, next) => {
  const status = String(req.body?.status || '').trim();
  if (!STATUS_VALIDOS.includes(status))
    return res.status(400).json({ erro: 'Status inválido.' });
  try {
    const existe = await query('SELECT 1 AS ok FROM dbo.Reivindicacao WHERE Numero = @num',
      { num: req.params.numero });
    if (!existe.length) return res.status(404).json({ erro: 'Reivindicação não encontrada.' });
    await query(
      `UPDATE dbo.Reivindicacao
          SET Status = @status, AtualizadoEm = SYSUTCDATETIME()
        WHERE Numero = @num`,
      { status, num: req.params.numero }
    );
    const rows = await query(SELECT_REIV + ' WHERE r.Numero = @num', { num: req.params.numero });
    res.json(montar(rows[0]));
  } catch (e) { next(e); }
});

export default router;
