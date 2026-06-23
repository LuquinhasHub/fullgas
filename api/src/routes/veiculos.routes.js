// ============================================================
// Rotas de veículos (motos no estoque, identificadas pelo NIV)
// ============================================================
import { Router } from 'express';
import { query } from '../db.js';
import { requireAuth } from '../auth.js';

const router = Router();

// Mapeia uma linha do banco para o formato que o front (store.js) já espera:
// { niv, modeloId (código do modelo), cor, status, entrada, venda?, garantia? }.
function toVeiculo(r) {
  const v = {
    niv: r.Niv,
    modeloId: r.ModeloCodigo,
    cor: r.Cor || '',
    status: r.Status,
    entrada: r.EntradaEstoque,
    numeroMotor: r.NumeroMotor || null
  };
  if (r.VendaData) v.venda = { data: r.VendaData, cliente: r.VendaCliente || '' };
  if (r.GarantiaAtivaEm) v.garantia = r.GarantiaAtivaEm;
  return v;
}

const SELECT_VEIC =
  `SELECT v.VeiculoId, v.Niv, v.Cor, v.Status, v.EntradaEstoque, v.VendaData,
          v.VendaCliente, v.GarantiaAtivaEm, v.NumeroMotor, v.EmpresaId,
          m.Codigo AS ModeloCodigo
     FROM dbo.Veiculo v
     JOIN dbo.ModeloMoto m ON m.ModeloId = v.ModeloId`;

// Cliente vê veículos da própria empresa ou não atribuídos (EmpresaId NULL);
// admin vê todos. Devolve o trecho WHERE e os parâmetros conforme o papel.
function escopoEmpresa(user) {
  if (user.papel === 'admin') return { where: '', params: {} };
  return { where: ' (v.EmpresaId = @empresaId OR v.EmpresaId IS NULL)', params: { empresaId: user.empresaId } };
}

// GET /api/veiculos/modelos — lista de modelos (alimenta FG.model no front).
// Declarado ANTES de /:niv para não ser capturado como se "modelos" fosse um NIV.
router.get('/veiculos/modelos', requireAuth, async (_req, res, next) => {
  try {
    const rows = await query(
      `SELECT Codigo AS id, Nome AS nome, Ano AS ano, Etiqueta AS label
         FROM dbo.ModeloMoto WHERE Ativo = 1 ORDER BY Nome, Ano`
    );
    res.json(rows.map(r => ({ id: r.id, nome: r.nome, ano: r.ano, label: r.label || (r.nome + ' ' + r.ano) })));
  } catch (e) { next(e); }
});

// GET /api/veiculos — lista da empresa do usuário; admin vê todos.
router.get('/veiculos', requireAuth, async (req, res, next) => {
  try {
    const esc = escopoEmpresa(req.user);
    const rows = await query(
      SELECT_VEIC + (esc.where ? ' WHERE' + esc.where : '') + ' ORDER BY v.EntradaEstoque DESC',
      esc.params
    );
    res.json(rows.map(toVeiculo));
  } catch (e) { next(e); }
});

// GET /api/veiculos/:niv — detalhe pelo NIV (respeita o escopo de empresa).
router.get('/veiculos/:niv', requireAuth, async (req, res, next) => {
  try {
    const esc = escopoEmpresa(req.user);
    const rows = await query(
      SELECT_VEIC + ' WHERE v.Niv = @niv' + (esc.where ? ' AND' + esc.where : ''),
      { niv: req.params.niv, ...esc.params }
    );
    if (!rows.length) return res.status(404).json({ erro: 'Veículo não encontrado.' });
    res.json(toVeiculo(rows[0]));
  } catch (e) { next(e); }
});

// Carrega o veículo pelo NIV aplicando o escopo de empresa. Devolve a linha
// crua (com VeiculoId/Status) ou null se não existe / fora do escopo.
async function acharVeiculo(niv, user) {
  const esc = escopoEmpresa(user);
  const rows = await query(
    SELECT_VEIC + ' WHERE v.Niv = @niv' + (esc.where ? ' AND' + esc.where : ''),
    { niv, ...esc.params }
  );
  return rows[0] || null;
}

// POST /api/veiculos/:niv/venda  { cliente } — registra a venda.
// Muda Status para 'Vendido', grava data/cliente e ativa a garantia se ainda
// não estiver ativa. Só vale para veículo 'Disponível'.
router.post('/veiculos/:niv/venda', requireAuth, async (req, res, next) => {
  try {
    const { cliente } = req.body;
    if (!cliente || !String(cliente).trim())
      return res.status(400).json({ erro: 'Informe o nome do cliente.' });

    const veic = await acharVeiculo(req.params.niv, req.user);
    if (!veic) return res.status(404).json({ erro: 'Veículo não encontrado.' });
    if (veic.Status !== 'Disponível')
      return res.status(409).json({ erro: 'Veículo não está disponível para venda.' });

    await query(
      `UPDATE dbo.Veiculo
          SET Status = 'Vendido',
              VendaData = SYSUTCDATETIME(),
              VendaCliente = @cliente,
              GarantiaAtivaEm = COALESCE(GarantiaAtivaEm, SYSUTCDATETIME()),
              AtualizadoEm = SYSUTCDATETIME()
        WHERE VeiculoId = @id`,
      { cliente: String(cliente).trim(), id: veic.VeiculoId }
    );

    const rows = await query(SELECT_VEIC + ' WHERE v.VeiculoId = @id', { id: veic.VeiculoId });
    res.json(toVeiculo(rows[0]));
  } catch (e) { next(e); }
});

// POST /api/veiculos/:niv/garantia — ativa a garantia (se ainda não ativa).
router.post('/veiculos/:niv/garantia', requireAuth, async (req, res, next) => {
  try {
    const veic = await acharVeiculo(req.params.niv, req.user);
    if (!veic) return res.status(404).json({ erro: 'Veículo não encontrado.' });
    if (veic.GarantiaAtivaEm)
      return res.status(409).json({ erro: 'Garantia já está ativa.' });

    await query(
      `UPDATE dbo.Veiculo
          SET GarantiaAtivaEm = SYSUTCDATETIME(), AtualizadoEm = SYSUTCDATETIME()
        WHERE VeiculoId = @id`,
      { id: veic.VeiculoId }
    );

    const rows = await query(SELECT_VEIC + ' WHERE v.VeiculoId = @id', { id: veic.VeiculoId });
    res.json(toVeiculo(rows[0]));
  } catch (e) { next(e); }
});

export default router;
