// ============================================================
// Rotas de autenticação: login e cadastro
// ============================================================
import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { query, getPool, sql } from '../db.js';
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

// POST /api/auth/register
//   { nome, empresa, email, senha, cnpj, telefone,
//     endereco: { cep, logradouro, numero, complemento, bairro, cidade, uf } }
//
// O CNPJ e o endereço principal já entram no cadastro da EMPRESA — assim o
// pedido exportado ao Tiny sai com os dados do cliente e o admin vê tudo.
router.post('/register', async (req, res, next) => {
  try {
    const { nome, empresa, email, senha, cnpj, telefone } = req.body;
    const end = req.body.endereco || {};
    if (!nome || !empresa || !email || !senha)
      return res.status(400).json({ erro: 'Preencha nome, empresa, e-mail e senha.' });
    if (senha.length < 6)
      return res.status(400).json({ erro: 'A senha precisa de ao menos 6 caracteres.' });
    if (!cnpj)
      return res.status(400).json({ erro: 'Informe o CNPJ da empresa.' });
    if (!end.logradouro || !end.numero || !end.bairro || !end.cidade || !end.uf || !end.cep)
      return res.status(400).json({ erro: 'Preencha o endereço (CEP, logradouro, número, bairro, cidade e UF).' });

    const existe = await query('SELECT 1 FROM dbo.Usuario WHERE Email = @email', { email });
    if (existe.length) return res.status(409).json({ erro: 'Já existe um usuário com este e-mail.' });

    const hash = await bcrypt.hash(senha, 10);
    const pool = await getPool();
    const tx = new sql.Transaction(pool);
    try {
      await tx.begin();

      // Identifica a empresa: primeiro pelo CNPJ (identidade fiscal), depois
      // pela razão social. Se não existir, cria com todos os dados. Se já
      // existir, preenche os campos que estiverem vazios (não sobrescreve).
      let empRow = (await new sql.Request(tx)
        .input('cnpj', sql.VarChar(18), cnpj)
        .query('SELECT EmpresaId FROM dbo.Empresa WHERE Cnpj = @cnpj')).recordset[0];
      if (!empRow) {
        empRow = (await new sql.Request(tx)
          .input('r', sql.NVarChar(160), empresa)
          .query('SELECT EmpresaId FROM dbo.Empresa WHERE RazaoSocial = @r')).recordset[0];
      }

      let empresaId;
      if (empRow) {
        empresaId = empRow.EmpresaId;
        await new sql.Request(tx)
          .input('id', sql.Int, empresaId)
          .input('cnpj', sql.VarChar(18), cnpj)
          .input('email', sql.NVarChar(160), email)
          .input('tel', sql.VarChar(30), telefone || null)
          .query(`UPDATE dbo.Empresa
                     SET Cnpj = COALESCE(Cnpj, @cnpj),
                         Email = COALESCE(Email, @email),
                         Telefone = COALESCE(Telefone, @tel),
                         AtualizadoEm = SYSUTCDATETIME()
                   WHERE EmpresaId = @id`);
      } else {
        empresaId = (await new sql.Request(tx)
          .input('r', sql.NVarChar(160), empresa)
          .input('cnpj', sql.VarChar(18), cnpj)
          .input('email', sql.NVarChar(160), email)
          .input('tel', sql.VarChar(30), telefone || null)
          .query(`INSERT INTO dbo.Empresa (RazaoSocial, Cnpj, Email, Telefone)
                  OUTPUT INSERTED.EmpresaId VALUES (@r, @cnpj, @email, @tel)`)).recordset[0].EmpresaId;
      }

      // Endereço principal (só grava se a empresa ainda não tiver nenhum).
      const temEnd = (await new sql.Request(tx)
        .input('id', sql.Int, empresaId)
        .query('SELECT 1 FROM dbo.Endereco WHERE EmpresaId = @id')).recordset.length;
      if (!temEnd) {
        await new sql.Request(tx)
          .input('id', sql.Int, empresaId)
          .input('log', sql.NVarChar(180), end.logradouro)
          .input('num', sql.NVarChar(20), end.numero)
          .input('comp', sql.NVarChar(80), end.complemento || null)
          .input('bairro', sql.NVarChar(80), end.bairro)
          .input('cidade', sql.NVarChar(80), end.cidade)
          .input('uf', sql.Char(2), String(end.uf).toUpperCase().slice(0, 2))
          .input('cep', sql.VarChar(9), end.cep)
          .query(`INSERT INTO dbo.Endereco
                    (EmpresaId, Tipo, Logradouro, Numero, Complemento, Bairro, Cidade, Uf, Cep, Principal)
                  VALUES (@id, 'Entrega', @log, @num, @comp, @bairro, @cidade, @uf, @cep, 1)`);
      }

      // Usuário (hash gravado como bytes — coluna VARBINARY).
      await new sql.Request(tx)
        .input('empresaId', sql.Int, empresaId)
        .input('nome', sql.NVarChar(120), nome)
        .input('email', sql.NVarChar(160), email)
        .input('hash', sql.VarBinary(256), Buffer.from(hash, 'utf8'))
        .query(`INSERT INTO dbo.Usuario (EmpresaId, Nome, Email, SenhaHash, Papel, Status)
                VALUES (@empresaId, @nome, @email, @hash, 'cliente', 'pendente')`);

      await tx.commit();
    } catch (e) {
      await tx.rollback();
      throw e;
    }

    res.status(201).json({ ok: true, msg: 'Cadastro enviado. Aguarde aprovação do administrador.' });
  } catch (e) { next(e); }
});

export default router;
