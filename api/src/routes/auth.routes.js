// ============================================================
// Rotas de autenticação: login e cadastro
// ============================================================
import { Router } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import { query, getPool, sql } from '../db.js';
import { signToken, parsePermissoes } from '../auth.js';
import { erroEndereco, limparIe } from '../validacao.js';
import { vincularContatoTiny } from '../tiny-contatos.js';
import { enviarEmail, emailRecuperacaoSenha, appUrl } from '../mail.js';

const router = Router();

// Validade do link de recuperação e janela mínima entre dois pedidos seguidos
// para o mesmo e-mail (evita usar a rota como metralhadora de spam).
const RESET_MINUTOS = 60;
const RESET_ESPERA_MS = 60 * 1000;
const ultimoPedidoReset = new Map();   // email -> timestamp

// POST /api/auth/login  { email, senha }
router.post('/login', async (req, res, next) => {
  try {
    const { email, senha } = req.body;
    if (!email || !senha) return res.status(400).json({ erro: 'Informe e-mail e senha.' });

    const rows = await query(
      `SELECT u.UsuarioId, u.Nome, u.Email, u.SenhaHash, u.Papel, u.Status,
              u.EmpresaId, u.Gestor, u.Permissoes, e.RazaoSocial AS Empresa
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
        papel: u.Papel, empresa: u.Empresa, empresaId: u.EmpresaId,
        gestor: !!u.Gestor,
        permissoes: parsePermissoes(u.Permissoes)   // null = acesso total
      }
    });
  } catch (e) { next(e); }
});

// POST /api/auth/register
//   { nome, empresa, email, senha, cnpj, inscricaoEstadual?, telefone,
//     endereco: { cep, logradouro, numero, complemento, bairro, cidade, uf } }
//
// O CNPJ e o endereço principal já entram no cadastro da EMPRESA — assim o
// pedido exportado ao Tiny sai com os dados do cliente e o admin vê tudo.
// Após o commit, o CNPJ é atrelado a um contato no Tiny (tiny-contatos.js):
// existente → vincula; inexistente → cria lá com os dados do cadastro.
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
    const errEnd = erroEndereco(end);
    if (errEnd) return res.status(400).json({ erro: errEnd });
    const ie = limparIe(req.body.inscricaoEstadual);

    const existe = await query('SELECT 1 FROM dbo.Usuario WHERE Email = @email', { email });
    if (existe.length) return res.status(409).json({ erro: 'Já existe um usuário com este e-mail.' });

    const hash = await bcrypt.hash(senha, 10);
    const pool = await getPool();
    const tx = new sql.Transaction(pool);
    let empresaId;
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

      if (empRow) {
        empresaId = empRow.EmpresaId;
        // TinyContatoPendente: agenda o vínculo com o Tiny se ainda não há um.
        await new sql.Request(tx)
          .input('id', sql.Int, empresaId)
          .input('cnpj', sql.VarChar(18), cnpj)
          .input('ie', sql.VarChar(20), ie)
          .input('email', sql.NVarChar(160), email)
          .input('tel', sql.VarChar(30), telefone || null)
          .query(`UPDATE dbo.Empresa
                     SET Cnpj = COALESCE(Cnpj, @cnpj),
                         InscricaoEstadual = COALESCE(InscricaoEstadual, @ie),
                         Email = COALESCE(Email, @email),
                         Telefone = COALESCE(Telefone, @tel),
                         TinyContatoPendente = CASE WHEN TinyContatoId IS NULL THEN 1 ELSE TinyContatoPendente END,
                         AtualizadoEm = SYSUTCDATETIME()
                   WHERE EmpresaId = @id`);
      } else {
        empresaId = (await new sql.Request(tx)
          .input('r', sql.NVarChar(160), empresa)
          .input('cnpj', sql.VarChar(18), cnpj)
          .input('ie', sql.VarChar(20), ie)
          .input('email', sql.NVarChar(160), email)
          .input('tel', sql.VarChar(30), telefone || null)
          .query(`INSERT INTO dbo.Empresa (RazaoSocial, Cnpj, InscricaoEstadual, Email, Telefone, TinyContatoPendente)
                  OUTPUT INSERTED.EmpresaId VALUES (@r, @cnpj, @ie, @email, @tel, 1)`)).recordset[0].EmpresaId;
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

      // Usuário (hash gravado como bytes — coluna VARBINARY). Quem se
      // cadastra é a conta GESTORA da empresa: gerencia as contas internas
      // (sub-dealers) criadas depois no painel "Minha conta".
      await new sql.Request(tx)
        .input('empresaId', sql.Int, empresaId)
        .input('nome', sql.NVarChar(120), nome)
        .input('email', sql.NVarChar(160), email)
        .input('hash', sql.VarBinary(256), Buffer.from(hash, 'utf8'))
        .query(`INSERT INTO dbo.Usuario (EmpresaId, Nome, Email, SenhaHash, Papel, Status, Gestor)
                VALUES (@empresaId, @nome, @email, @hash, 'cliente', 'pendente', 1)`);

      await tx.commit();
    } catch (e) {
      await tx.rollback();
      throw e;
    }

    // Atrela o CNPJ a um contato no Tiny (existente → vincula; não existe →
    // cria). Fire-and-forget: se o Tiny estiver fora, a empresa fica com
    // TinyContatoPendente = 1 e o cron re-tenta — o cadastro nunca trava.
    vincularContatoTiny(empresaId).catch(() => { });

    res.status(201).json({ ok: true, msg: 'Cadastro enviado. Aguarde aprovação do administrador.' });
  } catch (e) { next(e); }
});

/* ============================================================
   RECUPERAÇÃO DE SENHA ("esqueci minha senha")
   ------------------------------------------------------------
   Fluxo: /senha/esqueci gera um token aleatório, guarda só o HASH dele e
   manda o token cru por e-mail. /senha/verificar diz se o link ainda vale
   (para a tela não pedir a senha duas vezes à toa) e /senha/redefinir troca
   a senha e queima o token.

   Nenhuma das rotas revela se o e-mail existe: a resposta é sempre a mesma.
   ============================================================ */

// Guardamos o SHA-256 do token — quem lê o banco não reconstrói o link.
function hashToken(t) {
  return crypto.createHash('sha256').update(t).digest('hex');
}

// "lucas@gmail.com" -> "lu***@gmail.com". Só aparece para quem já tem o token.
function mascararEmail(e) {
  const [u, d] = String(e).split('@');
  if (!d) return '***';
  return (u.length <= 2 ? u[0] + '***' : u.slice(0, 2) + '***') + '@' + d;
}

// Localiza um token válido (existe, não usado, não expirado). Devolve a linha
// com os dados do usuário ou null.
async function tokenValido(tokenCru) {
  if (!tokenCru || typeof tokenCru !== 'string') return null;
  const rows = await query(
    `SELECT r.SenhaResetId, r.UsuarioId, u.Nome, u.Email, u.Status
       FROM dbo.SenhaReset r
       JOIN dbo.Usuario u ON u.UsuarioId = r.UsuarioId
      WHERE r.TokenHash = @h AND r.UsadoEm IS NULL AND r.ExpiraEm > SYSUTCDATETIME()`,
    { h: hashToken(tokenCru) }
  );
  return rows[0] || null;
}

// POST /api/auth/senha/esqueci  { email }
// A pedido do dono, a rota DIZ quando o e-mail não existe ("Esse e-mail não
// possui cadastro") em vez da resposta genérica. É uma troca consciente: fica
// possível descobrir quais e-mails têm conta aqui. Aceitável neste portal
// fechado (concessionárias cadastradas e aprovadas a dedo) e a janela mínima
// entre pedidos evita varredura em massa pela mesma origem.
router.post('/senha/esqueci', async (req, res, next) => {
  const enviado = {
    ok: true,
    msg: 'Enviamos as instruções para o seu e-mail. Confira também o spam.'
  };
  try {
    const email = String(req.body?.email || '').trim().toLowerCase();
    if (!email || !/^\S+@\S+\.\S+$/.test(email))
      return res.status(400).json({ erro: 'Informe um e-mail válido.' });

    const u = (await query(
      'SELECT UsuarioId, Nome, Email, Status FROM dbo.Usuario WHERE Email = @email', { email }
    ))[0];
    if (!u) return res.status(404).json({ erro: 'Esse e-mail não possui cadastro.' });
    if (u.Status === 'pendente')
      return res.status(403).json({ erro: 'Cadastro aguardando aprovação do administrador.' });
    if (u.Status === 'bloqueado')
      return res.status(403).json({ erro: 'Usuário bloqueado. Procure o administrador.' });

    // Janela mínima entre pedidos do mesmo e-mail — só depois de saber que a
    // conta existe, senão o "não possui cadastro" ficaria engolido pela trava.
    const agora = Date.now();
    if (agora - (ultimoPedidoReset.get(email) || 0) < RESET_ESPERA_MS)
      return res.status(429).json({ erro: 'Já enviamos um link agora há pouco. Espere um minuto e confira sua caixa de entrada.' });
    ultimoPedidoReset.set(email, agora);

    const tokenCru = crypto.randomBytes(32).toString('hex');
    // Um pedido novo invalida os anteriores: só o último link funciona.
    await query('UPDATE dbo.SenhaReset SET UsadoEm = SYSUTCDATETIME() WHERE UsuarioId = @uid AND UsadoEm IS NULL',
      { uid: u.UsuarioId });
    await query(
      `INSERT INTO dbo.SenhaReset (UsuarioId, TokenHash, ExpiraEm)
       VALUES (@uid, @h, DATEADD(minute, @min, SYSUTCDATETIME()))`,
      { uid: u.UsuarioId, h: hashToken(tokenCru), min: RESET_MINUTOS }
    );

    // appUrl(req): sem APP_URL no .env, o link nasce com a MESMA origem de onde
    // o portal foi aberto — assim funciona no celular/rede local sem configurar.
    const link = `${appUrl(req)}/redefinir.html?token=${tokenCru}`;
    const corpo = emailRecuperacaoSenha(u.Nome, link, RESET_MINUTOS);
    try {
      await enviarEmail({
        para: u.Email, assunto: 'Fullgas B2B — redefinição de senha',
        texto: corpo.texto, html: corpo.html
      });
    } catch (e) {
      // Agora que a rota confirma o cadastro, falha de SMTP também pode ser
      // dita na cara: o cliente precisa saber que o e-mail NÃO saiu.
      console.error('ERRO ao enviar e-mail de recuperação:', e.message);
      ultimoPedidoReset.delete(email);   // deixa tentar de novo na hora
      return res.status(502).json({ erro: 'Não conseguimos enviar o e-mail agora. Tente de novo em instantes.' });
    }
    res.json(enviado);
  } catch (e) { next(e); }
});

// POST /api/auth/senha/verificar  { token } -> { ok, email mascarado, nome }
router.post('/senha/verificar', async (req, res, next) => {
  try {
    const r = await tokenValido(req.body?.token);
    if (!r) return res.status(400).json({ erro: 'Link inválido ou expirado. Peça um novo.' });
    res.json({ ok: true, nome: r.Nome, email: mascararEmail(r.Email) });
  } catch (e) { next(e); }
});

// POST /api/auth/senha/redefinir  { token, senha }
router.post('/senha/redefinir', async (req, res, next) => {
  try {
    const senha = String(req.body?.senha || '');
    if (senha.length < 6)
      return res.status(400).json({ erro: 'A senha precisa de ao menos 6 caracteres.' });

    const r = await tokenValido(req.body?.token);
    if (!r) return res.status(400).json({ erro: 'Link inválido ou expirado. Peça um novo.' });
    if (r.Status === 'bloqueado')
      return res.status(403).json({ erro: 'Usuário bloqueado. Procure o administrador.' });

    // SenhaHash é VARBINARY: gravamos os bytes da string do bcrypt (como no login).
    const hash = await bcrypt.hash(senha, 10);
    const pool = await getPool();
    const tx = new sql.Transaction(pool);
    try {
      await tx.begin();
      await new sql.Request(tx)
        .input('uid', sql.Int, r.UsuarioId)
        .input('hash', sql.VarBinary(256), Buffer.from(hash, 'utf8'))
        .query('UPDATE dbo.Usuario SET SenhaHash = @hash, AtualizadoEm = SYSUTCDATETIME() WHERE UsuarioId = @uid');
      // Queima ESTE token e qualquer outro pendente do mesmo usuário.
      await new sql.Request(tx)
        .input('uid', sql.Int, r.UsuarioId)
        .query('UPDATE dbo.SenhaReset SET UsadoEm = SYSUTCDATETIME() WHERE UsuarioId = @uid AND UsadoEm IS NULL');
      await tx.commit();
    } catch (e) {
      try { await tx.rollback(); } catch { /* já desfeita */ }
      throw e;
    }

    res.json({ ok: true, msg: 'Senha alterada! Faça login com a nova senha.' });
  } catch (e) { next(e); }
});

export default router;
