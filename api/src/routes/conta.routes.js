// ============================================================
// Rotas da conta do concessionário (painel "Minha conta")
//   - GET   /conta                     dados da empresa + contas internas
//   - PUT   /conta/empresa             gestor atualiza cadastro/endereço
//   - POST  /conta/subdealers          gestor cria conta interna
//   - PATCH /conta/subdealers/:id      gestor edita permissões/status/senha
//
// "Sub-dealer" = conta interna da concessionária (Gestor = 0), criada pela
// conta gestora, já aprovada, com acesso restringível por área do site
// (Permissoes = JSON array de áreas permitidas; NULL = acesso total).
// ============================================================
import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { query, getPool, sql } from '../db.js';
import { requireAuth, AREAS, parsePermissoes } from '../auth.js';

const router = Router();

// Middleware local: só a conta GESTORA da empresa gerencia cadastro/internas.
function requireGestor(req, res, next) {
  if (req.user?.gestor || req.user?.papel === 'admin') return next();
  res.status(403).json({ erro: 'Apenas a conta gestora da concessionária pode fazer isso.' });
}

// GET /api/conta — visão da própria empresa: cadastro, endereço principal e
// (para o gestor) as contas internas. Sub-dealer também acessa (só leitura).
router.get('/conta', requireAuth, async (req, res, next) => {
  try {
    const emp = (await query(
      `SELECT e.EmpresaId, e.RazaoSocial, e.NomeFantasia, e.Cnpj, e.Email, e.Telefone
         FROM dbo.Empresa e WHERE e.EmpresaId = @eid`,
      { eid: req.user.empresaId }
    ))[0];
    if (!emp) return res.status(404).json({ erro: 'Empresa não encontrada.' });

    const end = (await query(
      `SELECT TOP 1 Logradouro, Numero, Complemento, Bairro, Cidade, Uf, Cep
         FROM dbo.Endereco WHERE EmpresaId = @eid
        ORDER BY Principal DESC, EnderecoId ASC`,
      { eid: req.user.empresaId }
    ))[0];

    const usuarios = await query(
      `SELECT UsuarioId, Nome, Email, Papel, Status, Gestor, Permissoes, CriadoEm
         FROM dbo.Usuario WHERE EmpresaId = @eid
        ORDER BY Gestor DESC, CriadoEm ASC`,
      { eid: req.user.empresaId }
    );

    res.json({
      empresa: {
        id: emp.EmpresaId, razaoSocial: emp.RazaoSocial, nomeFantasia: emp.NomeFantasia || '',
        cnpj: emp.Cnpj || '', email: emp.Email || '', telefone: emp.Telefone || ''
      },
      endereco: end ? {
        logradouro: end.Logradouro, numero: end.Numero || '', complemento: end.Complemento || '',
        bairro: end.Bairro || '', cidade: end.Cidade, uf: end.Uf || '', cep: end.Cep || ''
      } : null,
      areas: AREAS,
      usuarios: usuarios.map(u => ({
        id: u.UsuarioId, nome: u.Nome, email: u.Email, papel: u.Papel, status: u.Status,
        gestor: !!u.Gestor, permissoes: parsePermissoes(u.Permissoes), criadoEm: u.CriadoEm
      }))
    });
  } catch (e) { next(e); }
});

// PUT /api/conta/empresa — gestor atualiza CNPJ/telefone/e-mail e endereço
// principal (upsert). Razão social não muda por aqui (identidade da conta).
router.put('/conta/empresa', requireAuth, requireGestor, async (req, res, next) => {
  try {
    const { cnpj, telefone, email } = req.body;
    const end = req.body.endereco || {};
    if (!cnpj) return res.status(400).json({ erro: 'Informe o CNPJ.' });
    if (!end.logradouro || !end.numero || !end.bairro || !end.cidade || !end.uf || !end.cep)
      return res.status(400).json({ erro: 'Preencha o endereço (CEP, logradouro, número, bairro, cidade e UF).' });

    const pool = await getPool();
    const tx = new sql.Transaction(pool);
    try {
      await tx.begin();

      await new sql.Request(tx)
        .input('eid', sql.Int, req.user.empresaId)
        .input('cnpj', sql.VarChar(18), cnpj)
        .input('email', sql.NVarChar(160), email || null)
        .input('tel', sql.VarChar(30), telefone || null)
        .query(`UPDATE dbo.Empresa
                   SET Cnpj = @cnpj, Email = @email, Telefone = @tel,
                       AtualizadoEm = SYSUTCDATETIME()
                 WHERE EmpresaId = @eid`);

      // Endereço principal: atualiza o existente ou cria o primeiro.
      const atual = (await new sql.Request(tx)
        .input('eid', sql.Int, req.user.empresaId)
        .query(`SELECT TOP 1 EnderecoId FROM dbo.Endereco WHERE EmpresaId = @eid
                 ORDER BY Principal DESC, EnderecoId ASC`)).recordset[0];

      const reqEnd = new sql.Request(tx)
        .input('eid', sql.Int, req.user.empresaId)
        .input('log', sql.NVarChar(180), end.logradouro)
        .input('num', sql.NVarChar(20), end.numero)
        .input('comp', sql.NVarChar(80), end.complemento || null)
        .input('bairro', sql.NVarChar(80), end.bairro)
        .input('cidade', sql.NVarChar(80), end.cidade)
        .input('uf', sql.Char(2), String(end.uf).toUpperCase().slice(0, 2))
        .input('cep', sql.VarChar(9), end.cep);
      if (atual) {
        await reqEnd.input('id', sql.Int, atual.EnderecoId)
          .query(`UPDATE dbo.Endereco
                     SET Logradouro = @log, Numero = @num, Complemento = @comp,
                         Bairro = @bairro, Cidade = @cidade, Uf = @uf, Cep = @cep, Principal = 1
                   WHERE EnderecoId = @id`);
      } else {
        await reqEnd.query(`INSERT INTO dbo.Endereco
            (EmpresaId, Tipo, Logradouro, Numero, Complemento, Bairro, Cidade, Uf, Cep, Principal)
          VALUES (@eid, 'Entrega', @log, @num, @comp, @bairro, @cidade, @uf, @cep, 1)`);
      }

      await tx.commit();
    } catch (e) { await tx.rollback(); throw e; }

    res.json({ ok: true });
  } catch (e) {
    // Índice único filtrado do CNPJ: outra empresa já usa esse número.
    if (/UQ_Empresa_Cnpj/i.test(e.message)) return res.status(409).json({ erro: 'Este CNPJ já pertence a outra empresa.' });
    next(e);
  }
});

// POST /api/conta/subdealers — gestor cria conta interna já aprovada.
// { nome, email, senha, permissoes: ['loja', ...] } (lista vazia = nenhum
// acesso além do portal básico; omitida/null = acesso total).
router.post('/conta/subdealers', requireAuth, requireGestor, async (req, res, next) => {
  try {
    const { nome, email, senha } = req.body;
    if (!nome || !email || !senha) return res.status(400).json({ erro: 'Informe nome, e-mail e senha.' });
    if (senha.length < 6) return res.status(400).json({ erro: 'A senha precisa de ao menos 6 caracteres.' });

    const existe = await query('SELECT 1 FROM dbo.Usuario WHERE Email = @email', { email });
    if (existe.length) return res.status(409).json({ erro: 'Já existe um usuário com este e-mail.' });

    const perm = Array.isArray(req.body.permissoes)
      ? JSON.stringify(req.body.permissoes.filter(a => AREAS.includes(a)))
      : null;

    const hash = await bcrypt.hash(senha, 10);
    const ins = await (await getPool()).request()
      .input('eid', sql.Int, req.user.empresaId)
      .input('nome', sql.NVarChar(120), nome)
      .input('email', sql.NVarChar(160), email)
      .input('hash', sql.VarBinary(256), Buffer.from(hash, 'utf8'))
      .input('perm', sql.VarChar(400), perm)
      .query(`INSERT INTO dbo.Usuario (EmpresaId, Nome, Email, SenhaHash, Papel, Status, Gestor, Permissoes)
              OUTPUT INSERTED.UsuarioId
              VALUES (@eid, @nome, @email, @hash, 'cliente', 'aprovado', 0, @perm)`);

    res.status(201).json({ ok: true, id: ins.recordset[0].UsuarioId });
  } catch (e) { next(e); }
});

// PATCH /api/conta/subdealers/:id — gestor edita permissões, bloqueia/
// desbloqueia ou redefine a senha de uma conta interna DA SUA empresa.
router.patch('/conta/subdealers/:id', requireAuth, requireGestor, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ erro: 'ID inválido.' });

    // Só contas internas (Gestor = 0) da própria empresa.
    const alvo = (await query(
      'SELECT UsuarioId FROM dbo.Usuario WHERE UsuarioId = @id AND EmpresaId = @eid AND Gestor = 0',
      { id, eid: req.user.empresaId }
    ))[0];
    if (!alvo) return res.status(404).json({ erro: 'Conta interna não encontrada.' });

    const { permissoes, status, senha } = req.body;
    if (status && !['aprovado', 'bloqueado'].includes(status))
      return res.status(400).json({ erro: 'Status inválido.' });
    if (senha !== undefined && String(senha).length < 6)
      return res.status(400).json({ erro: 'A senha precisa de ao menos 6 caracteres.' });

    const request = (await getPool()).request().input('id', sql.Int, id);
    const sets = [];
    if (permissoes !== undefined) {
      const perm = Array.isArray(permissoes)
        ? JSON.stringify(permissoes.filter(a => AREAS.includes(a)))
        : null; // null = acesso total
      sets.push('Permissoes = @perm'); request.input('perm', sql.VarChar(400), perm);
    }
    if (status) { sets.push('Status = @st'); request.input('st', sql.VarChar(12), status); }
    if (senha !== undefined) {
      const hash = await bcrypt.hash(String(senha), 10);
      sets.push('SenhaHash = @hash'); request.input('hash', sql.VarBinary(256), Buffer.from(hash, 'utf8'));
    }
    if (!sets.length) return res.status(400).json({ erro: 'Nada para atualizar.' });
    sets.push('AtualizadoEm = SYSUTCDATETIME()');

    await request.query(`UPDATE dbo.Usuario SET ${sets.join(', ')} WHERE UsuarioId = @id`);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

export default router;
