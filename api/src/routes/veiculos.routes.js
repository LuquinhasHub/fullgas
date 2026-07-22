// ============================================================
// Rotas de veículos (motos no estoque, identificadas pelo NIV)
// ============================================================
import { Router } from 'express';
import { query } from '../db.js';
import { requireAuth, requireAdmin } from '../auth.js';

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
    numeroMotor: r.NumeroMotor || null,
    empresaId: r.EmpresaId || null,
    empresa: r.EmpresaNome || null    // concessionária dona do chassi (null = não atribuído)
  };
  if (r.VendaData) v.venda = {
    data: r.VendaData,
    cliente: r.VendaCliente || '',
    cpf: r.ClienteCpf || '',
    email: r.ClienteEmail || '',
    telefone: r.ClienteTelefone || '',
    endereco: r.ClienteEndereco || ''
  };
  if (r.GarantiaAtivaEm) v.garantia = r.GarantiaAtivaEm;
  return v;
}

const SELECT_VEIC =
  `SELECT v.VeiculoId, v.Niv, v.Cor, v.Status, v.EntradaEstoque, v.VendaData,
          v.VendaCliente, v.ClienteCpf, v.ClienteEmail, v.ClienteTelefone,
          v.ClienteEndereco, v.GarantiaAtivaEm, v.NumeroMotor, v.EmpresaId,
          m.Codigo AS ModeloCodigo, e.RazaoSocial AS EmpresaNome
     FROM dbo.Veiculo v
     JOIN dbo.ModeloMoto m ON m.ModeloId = v.ModeloId
     LEFT JOIN dbo.Empresa e ON e.EmpresaId = v.EmpresaId`;

// Cliente vê SOMENTE veículos atribuídos à própria empresa; admin vê todos.
// Todo chassi é inserido/atribuído por um administrador — enquanto um chassi
// não tiver EmpresaId, ele não aparece para nenhum cliente. Devolve o trecho
// WHERE e os parâmetros conforme o papel.
function escopoEmpresa(user) {
  if (user.papel === 'admin') return { where: '', params: {} };
  return { where: ' v.EmpresaId = @empresaId', params: { empresaId: user.empresaId } };
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

// GET /api/empresas — lista de concessionárias ativas (SÓ ADMIN). Alimenta o
// autocomplete de atribuição/transferência de chassi no front.
router.get('/empresas', requireAuth, requireAdmin, async (_req, res, next) => {
  try {
    const rows = await query(
      `SELECT EmpresaId, RazaoSocial, NomeFantasia FROM dbo.Empresa
        WHERE Ativo = 1 ORDER BY RazaoSocial`
    );
    res.json(rows.map(r => ({
      id: r.EmpresaId, nome: r.RazaoSocial, fantasia: r.NomeFantasia || ''
    })));
  } catch (e) { next(e); }
});

// POST /api/veiculos (SÓ ADMIN) — cadastra um chassi novo.
//   { niv, modeloId (código do modelo), cor?, numeroMotor?, empresaId? }
// empresaId opcional: já nasce atribuído àquela concessionária; sem ele o
// chassi fica "não atribuído" (nenhum cliente vê até o admin atribuir).
router.post('/veiculos', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const niv = String(req.body?.niv || '').trim().toUpperCase();
    const modeloCod = String(req.body?.modeloId || '').trim();
    const cor = String(req.body?.cor || '').trim();
    const numeroMotor = String(req.body?.numeroMotor || '').trim();
    const empresaId = req.body?.empresaId ? Number(req.body.empresaId) : null;

    if (!/^[A-Z0-9]{11,17}$/.test(niv))
      return res.status(400).json({ erro: 'NIV inválido — use 11 a 17 letras/números (sem espaços).' });
    if (!modeloCod) return res.status(400).json({ erro: 'Informe o modelo da moto.' });

    const mod = (await query(
      'SELECT ModeloId FROM dbo.ModeloMoto WHERE Codigo = @cod', { cod: modeloCod }))[0];
    if (!mod) return res.status(400).json({ erro: 'Modelo não encontrado.' });

    if (empresaId) {
      const emp = (await query(
        'SELECT 1 FROM dbo.Empresa WHERE EmpresaId = @eid AND Ativo = 1', { eid: empresaId })).length;
      if (!emp) return res.status(400).json({ erro: 'Concessionária não encontrada.' });
    }

    const jaExiste = (await query('SELECT 1 FROM dbo.Veiculo WHERE Niv = @niv', { niv })).length;
    if (jaExiste) return res.status(409).json({ erro: 'Já existe um chassi cadastrado com este NIV.' });

    await query(
      `INSERT INTO dbo.Veiculo (Niv, ModeloId, Cor, Status, EntradaEstoque, NumeroMotor, EmpresaId)
       VALUES (@niv, @mid, @cor, 'Disponível', SYSUTCDATETIME(), @motor, @eid)`,
      { niv, mid: mod.ModeloId, cor: cor || null, motor: numeroMotor || null, eid: empresaId }
    );

    const rows = await query(SELECT_VEIC + ' WHERE v.Niv = @niv', { niv });
    res.status(201).json(toVeiculo(rows[0]));
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
    const { cliente, cpf, email, telefone, endereco } = req.body;
    const nome = (cliente || '').trim();
    if (!nome) return res.status(400).json({ erro: 'Informe o nome do cliente.' });
    if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))
      return res.status(400).json({ erro: 'E-mail do cliente inválido.' });
    // CPF: aceita com ou sem máscara, mas precisa ter 11 dígitos se informado.
    if (cpf && (String(cpf).replace(/\D/g, '').length !== 11))
      return res.status(400).json({ erro: 'CPF do cliente inválido.' });

    const veic = await acharVeiculo(req.params.niv, req.user);
    if (!veic) return res.status(404).json({ erro: 'Veículo não encontrado.' });
    if (veic.Status !== 'Disponível')
      return res.status(409).json({ erro: 'Veículo não está disponível para venda.' });

    await query(
      `UPDATE dbo.Veiculo
          SET Status = 'Vendido',
              VendaData = SYSUTCDATETIME(),
              VendaCliente = @cliente,
              ClienteCpf = @cpf,
              ClienteEmail = @email,
              ClienteTelefone = @telefone,
              ClienteEndereco = @endereco,
              GarantiaAtivaEm = COALESCE(GarantiaAtivaEm, SYSUTCDATETIME()),
              AtualizadoEm = SYSUTCDATETIME()
        WHERE VeiculoId = @id`,
      {
        cliente: nome,
        cpf: (cpf || '').trim() || null,
        email: (email || '').trim() || null,
        telefone: (telefone || '').trim() || null,
        endereco: (endereco || '').trim() || null,
        id: veic.VeiculoId
      }
    );

    const rows = await query(SELECT_VEIC + ' WHERE v.VeiculoId = @id', { id: veic.VeiculoId });
    res.json(toVeiculo(rows[0]));
  } catch (e) { next(e); }
});

// PUT /api/veiculos/:niv/transferir (SÓ ADMIN) — transfere o chassi para
// outra concessionária. Aceita { empresaId } (vindo do autocomplete do front)
// ou { empresa } com o NOME (razão social ou fantasia; case-insensitive pela
// collation). Nome ambíguo ou inexistente devolve erro com sugestões.
router.put('/veiculos/:niv/transferir', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const empresaId = req.body?.empresaId ? Number(req.body.empresaId) : null;
    const nome = String(req.body?.empresa || '').trim();
    if (!empresaId && !nome) return res.status(400).json({ erro: 'Informe a concessionária de destino.' });

    const veic = await acharVeiculo(req.params.niv, req.user);
    if (!veic) return res.status(404).json({ erro: 'Veículo não encontrado.' });

    const emp = await (empresaId
      ? query('SELECT EmpresaId, RazaoSocial FROM dbo.Empresa WHERE Ativo = 1 AND EmpresaId = @eid', { eid: empresaId })
      : query(
        `SELECT EmpresaId, RazaoSocial FROM dbo.Empresa
          WHERE Ativo = 1 AND (RazaoSocial = @n OR NomeFantasia = @n)`, { n: nome }));
    if (!emp.length && empresaId)
      return res.status(404).json({ erro: 'Concessionária não encontrada.' });
    if (!emp.length) {
      const parecidas = await query(
        `SELECT TOP 5 RazaoSocial FROM dbo.Empresa
          WHERE Ativo = 1 AND (RazaoSocial LIKE @p OR NomeFantasia LIKE @p)
          ORDER BY RazaoSocial`, { p: '%' + nome + '%' });
      return res.status(404).json({
        erro: 'Concessionária não encontrada: "' + nome + '".' +
          (parecidas.length ? ' Parecidas: ' + parecidas.map(r => r.RazaoSocial).join(', ') + '.' : '')
      });
    }
    if (emp.length > 1)
      return res.status(409).json({ erro: 'Mais de uma concessionária com esse nome — informe a razão social exata.' });
    if (emp[0].EmpresaId === veic.EmpresaId)
      return res.status(409).json({ erro: 'O veículo já pertence a ' + emp[0].RazaoSocial + '.' });

    await query(
      'UPDATE dbo.Veiculo SET EmpresaId = @eid, AtualizadoEm = SYSUTCDATETIME() WHERE VeiculoId = @id',
      { eid: emp[0].EmpresaId, id: veic.VeiculoId }
    );

    const rows = await query(SELECT_VEIC + ' WHERE v.VeiculoId = @id', { id: veic.VeiculoId });
    res.json({ ...toVeiculo(rows[0]), empresa: emp[0].RazaoSocial });
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
