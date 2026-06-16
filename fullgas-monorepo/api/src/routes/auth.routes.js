// ============================================================
// Rotas de autenticação: login e cadastro
// ============================================================
import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { query, sql } from '../db.js';
import { signToken } from '../auth.js';

const router = Router();

// POST /api/auth/login  { email, senha }
router.post('/login', async (req, res, next) => {
  try {
    const { email, senha } = req.body;
    if (!email || !senha) return res.status(400).json({ erro: 'Informe e-mail e senha.' });

    const rows = await query(
      `SELECT u.UsuarioId, u.Nome, u.Email, u.SenhaHash, u.Papel, u.Status,
              u.EmpresaId, e.RazaoSocial AS Empresa
         FROM dbo.Usuario u
         JOIN dbo.Empresa e ON e.EmpresaId = u.EmpresaId
        WHERE u.Email = @email`,
      { email }
    );
    const u = rows[0];
    if (!u) return res.status(401).json({ erro: 'Credenciais inválidas.' });

    if (u.Status === 'pendente')
      return res.status(403).json({ erro: 'Cadastro aguardando aprovação do administrador.' });
    if (u.Status === 'bloqueado')
      return res.status(403).json({ erro: 'Usuário bloqueado. Procure o administrador.' });

    // SenhaHash é VARBINARY no banco; o bcrypt gera string -> guardamos os bytes da string.
    const hashStr = u.SenhaHash ? Buffer.from(u.SenhaHash).toString('utf8') : '';
    const ok = hashStr && await bcrypt.compare(senha, hashStr);
    if (!ok) return res.status(401).json({ erro: 'Credenciais inválidas.' });

    const token = signToken(u);
    res.json({
      token,
      usuario: {
        id: u.UsuarioId, nome: u.Nome, email: u.Email,
        papel: u.Papel, empresa: u.Empresa, empresaId: u.EmpresaId
      }
    });
  } catch (e) { next(e); }
});

// POST /api/auth/register  { nome, empresa, email, senha }
router.post('/register', async (req, res, next) => {
  try {
    const { nome, empresa, email, senha } = req.body;
    if (!nome || !empresa || !email || !senha)
      return res.status(400).json({ erro: 'Preencha todos os campos.' });
    if (senha.length < 6)
      return res.status(400).json({ erro: 'A senha precisa de ao menos 6 caracteres.' });

    const existe = await query('SELECT 1 FROM dbo.Usuario WHERE Email = @email', { email });
    if (existe.length) return res.status(409).json({ erro: 'Já existe um usuário com este e-mail.' });

    // Acha (ou cria) a empresa pela razão social.
    let emp = await query('SELECT EmpresaId FROM dbo.Empresa WHERE RazaoSocial = @r', { r: empresa });
    let empresaId;
    if (emp.length) {
      empresaId = emp[0].EmpresaId;
    } else {
      const ins = await query(
        'INSERT INTO dbo.Empresa (RazaoSocial) OUTPUT INSERTED.EmpresaId VALUES (@r)',
        { r: empresa }
      );
      empresaId = ins[0].EmpresaId;
    }

    const hash = await bcrypt.hash(senha, 10);
    // Grava o hash como bytes (VARBINARY).
    const pool = await (await import('../db.js')).getPool();
    await pool.request()
      .input('empresaId', sql.Int, empresaId)
      .input('nome', sql.NVarChar(120), nome)
      .input('email', sql.NVarChar(160), email)
      .input('hash', sql.VarBinary(256), Buffer.from(hash, 'utf8'))
      .query(`INSERT INTO dbo.Usuario (EmpresaId, Nome, Email, SenhaHash, Papel, Status)
              VALUES (@empresaId, @nome, @email, @hash, 'cliente', 'pendente')`);

    res.status(201).json({ ok: true, msg: 'Cadastro enviado. Aguarde aprovação do administrador.' });
  } catch (e) { next(e); }
});

export default router;
