// ============================================================
// Rotas de usuários (gestão de clientes e administradores no painel admin)
//   - GET    /usuarios       lista todos (com empresa, CNPJ e endereço)
//   - POST   /usuarios       cria um ADMINISTRADOR (equipe Fullgas)
//   - PATCH  /usuarios/:id   aprova / bloqueia / muda papel
//   - DELETE /usuarios/:id   remove cliente indesejado/bloqueado
// Só administradores.
//
// O painel separa as duas populações que convivem nesta tabela: quem compra
// (Papel = 'cliente', pertence a uma concessionária) e quem opera o sistema
// (Papel = 'admin', equipe Fullgas). A lista é a mesma; a divisão é por papel.
// ============================================================
import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { query, getPool, sql } from '../db.js';
import { requireAuth, requireAdmin, signToken, parsePermissoes, abrirSessao } from '../auth.js';

const router = Router();

// Mapeia a linha do banco para o formato que o front (store.js) espera:
// { id, nome, email, papel, status, empresa, empresaId, cnpj, telefone, endereco }
function toUsuario(r) {
  return {
    id: r.UsuarioId,
    nome: r.Nome,
    email: r.Email,
    papel: r.Papel,
    status: r.Status,
    gestor: !!r.Gestor,       // false = conta interna criada pelo gestor (sub-dealer)
    empresa: r.Empresa || '',
    empresaId: r.EmpresaId,
    cnpj: r.Cnpj || '',
    inscricaoEstadual: r.InscricaoEstadual || '',
    telefone: r.Telefone || '',
    tinyContatoId: r.TinyContatoId || null,   // contato do Tiny atrelado ao CNPJ
    criadoEm: r.CriadoEm,
    endereco: r.Logradouro ? {
      logradouro: r.Logradouro, numero: r.Numero || '', complemento: r.Complemento || '',
      bairro: r.Bairro || '', cidade: r.Cidade || '', uf: r.Uf || '', cep: r.Cep || ''
    } : null
  };
}

const SELECT_USUARIO =
  `SELECT u.UsuarioId, u.Nome, u.Email, u.Papel, u.Status, u.Gestor, u.CriadoEm, u.EmpresaId,
          e.RazaoSocial AS Empresa, e.Cnpj, e.InscricaoEstadual, e.Telefone, e.TinyContatoId,
          en.Logradouro, en.Numero, en.Complemento, en.Bairro, en.Cidade, en.Uf, en.Cep
     FROM dbo.Usuario u
     JOIN dbo.Empresa e ON e.EmpresaId = u.EmpresaId
     OUTER APPLY (
       SELECT TOP 1 d.Logradouro, d.Numero, d.Complemento, d.Bairro, d.Cidade, d.Uf, d.Cep
         FROM dbo.Endereco d
        WHERE d.EmpresaId = e.EmpresaId
        ORDER BY d.Principal DESC, d.EnderecoId ASC
     ) en`;

// GET /api/usuarios — lista com empresa e endereço principal (pendentes primeiro).
router.get('/usuarios', requireAuth, requireAdmin, async (_req, res, next) => {
  try {
    const rows = await query(
      SELECT_USUARIO +
      ' ORDER BY CASE WHEN u.Status = \'pendente\' THEN 0 ELSE 1 END, u.CriadoEm DESC'
    );
    res.json(rows.map(toUsuario));
  } catch (e) { next(e); }
});

// POST /api/usuarios — cria um ADMINISTRADOR pelo próprio painel.
//   { nome, email, senha }
//
// Três decisões que valem o comentário:
//
// • A conta nasce 'aprovado'. A fila de aprovação existe para quem se cadastra
//   sozinho pela tela pública; aqui quem cria já é administrador, então pedir
//   que outro admin aprove seria uma cerimônia sem ganho.
// • EmpresaId é o do admin que está criando — a casa (Fullgas). Usuario.EmpresaId
//   é NOT NULL e todo admin precisa de uma empresa; herdar a de quem cria mantém
//   a equipe interna sob o mesmo CNPJ, sem inventar empresa nova a cada convite.
// • Senha mínima de 8, contra os 6 do cadastro de cliente. É a conta que enxerga
//   pedidos, faturas e cadastros de todas as concessionárias — o piso mais alto
//   é proporcional ao estrago de perdê-la.
const SENHA_MINIMA_ADMIN = 8;
router.post('/usuarios', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const nome = String(req.body?.nome || '').trim();
    const email = String(req.body?.email || '').trim().toLowerCase();
    const senha = String(req.body?.senha || '');

    if (!nome || !email || !senha)
      return res.status(400).json({ erro: 'Informe nome, e-mail e senha.' });
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))
      return res.status(400).json({ erro: 'E-mail inválido.' });
    if (senha.length < SENHA_MINIMA_ADMIN)
      return res.status(400).json({ erro: `A senha do administrador precisa de ao menos ${SENHA_MINIMA_ADMIN} caracteres.` });

    const existe = await query('SELECT 1 FROM dbo.Usuario WHERE Email = @email', { email });
    if (existe.length) return res.status(409).json({ erro: 'Já existe um usuário com este e-mail.' });

    // Hash gravado como BYTES da string do bcrypt — a coluna é VARBINARY e é
    // assim que login e recuperação de senha esperam encontrar (auth.routes.js).
    const hash = await bcrypt.hash(senha, 10);
    const ins = await (await getPool()).request()
      .input('eid', sql.Int, req.user.empresaId)
      .input('nome', sql.NVarChar(120), nome.toUpperCase())
      .input('email', sql.NVarChar(160), email)
      .input('hash', sql.VarBinary(256), Buffer.from(hash, 'utf8'))
      .query(`INSERT INTO dbo.Usuario (EmpresaId, Nome, Email, SenhaHash, Papel, Status, Gestor, Permissoes)
              OUTPUT INSERTED.UsuarioId
              VALUES (@eid, @nome, @email, @hash, 'admin', 'aprovado', 1, NULL)`);

    const id = ins.recordset[0].UsuarioId;
    console.log(`+ Administrador criado: #${id} (${email}) por admin #${req.user.id} (${req.user.email}).`);

    const rows = await query(SELECT_USUARIO + ' WHERE u.UsuarioId = @id', { id });
    res.status(201).json(toUsuario(rows[0]));
  } catch (e) {
    if (/UQ_Usuario_Email/i.test(e.message))
      return res.status(409).json({ erro: 'Já existe um usuário com este e-mail.' });
    next(e);
  }
});

// PATCH /api/usuarios/:id — altera status e/ou papel.
const PAPEIS = ['admin', 'cliente'];
const STATUS = ['pendente', 'aprovado', 'bloqueado'];
router.patch('/usuarios/:id', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ erro: 'ID inválido.' });
    // Impede o admin de se auto-bloquear ou se rebaixar (evita ficar sem acesso).
    if (id === req.user.id) return res.status(400).json({ erro: 'Você não pode alterar o próprio usuário.' });

    const { status, papel } = req.body;
    if (status && !STATUS.includes(status)) return res.status(400).json({ erro: 'Status inválido.' });
    if (papel && !PAPEIS.includes(papel)) return res.status(400).json({ erro: 'Papel inválido.' });
    if (!status && !papel) return res.status(400).json({ erro: 'Nada para atualizar.' });

    const request = (await getPool()).request().input('id', sql.Int, id);
    const sets = [];
    if (status) { sets.push('Status = @status'); request.input('status', sql.VarChar(12), status); }
    if (papel) { sets.push('Papel = @papel'); request.input('papel', sql.VarChar(10), papel); }
    sets.push('AtualizadoEm = SYSUTCDATETIME()');

    const r = await request.query(`UPDATE dbo.Usuario SET ${sets.join(', ')} WHERE UsuarioId = @id`);
    if (!r.rowsAffected[0]) return res.status(404).json({ erro: 'Usuário não encontrado.' });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// DELETE /api/usuarios/:id — remove um cliente indesejado e/ou bloqueado.
// O admin não exclui a si mesmo. Usuário com histórico (pedidos,
// reivindicações...) é protegido pelas FKs — a orientação é bloquear.
router.delete('/usuarios/:id', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ erro: 'ID inválido.' });
    if (id === req.user.id) return res.status(400).json({ erro: 'Você não pode excluir o próprio usuário.' });

    const alvo = (await query('SELECT Nome FROM dbo.Usuario WHERE UsuarioId = @id', { id }))[0];
    if (!alvo) return res.status(404).json({ erro: 'Usuário não encontrado.' });

    try {
      await query('DELETE FROM dbo.Usuario WHERE UsuarioId = @id', { id });
    } catch (e) {
      // FK: o usuário tem pedidos/reivindicações/etc. — histórico não se apaga.
      if (/REFERENCE constraint|conflicted with the REFERENCE|instrução DELETE conflitou/i.test(e.message))
        return res.status(409).json({
          erro: 'Este usuário tem histórico (pedidos, reivindicações...) e não pode ser excluído — bloqueie o acesso dele.'
        });
      throw e;
    }
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// POST /api/usuarios/:id/identidade — ALTERAÇÃO DE IDENTIDADE (só admin).
// ------------------------------------------------------------
// Devolve um token do usuário-alvo para o admin entrar na conta dele e ver o
// portal exatamente como o cliente vê (útil para suporte). Serve tanto para a
// conta gestora quanto para as contas internas (sub-dealers).
//
// Cuidados de propósito:
//   • o token sai marcado com `imp` = id do admin que assumiu — dá para
//     auditar depois e o front usa isso para mostrar a tarja de aviso;
//   • validade curta (1 h), independente do JWT_EXPIRES normal;
//   • ninguém assume a própria identidade nem a de outro admin (não teria
//     ganho de suporte e só serviria para confundir a trilha de auditoria).
router.post('/usuarios/:id/identidade', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ erro: 'ID inválido.' });
    if (id === req.user.id) return res.status(400).json({ erro: 'Você já está na sua própria conta.' });
    // Encadear identidades embaralharia a trilha de auditoria: o `imp` guarda
    // um id só, então a volta cairia no admin errado.
    // Na prática o requireAdmin acima já barra (durante a impersonação o papel
    // é o do alvo, não 'admin'). Esta checagem fica como rede de proteção: se
    // um dia a regra "não assumir a identidade de outro admin" for afrouxada,
    // o encadeamento continua bloqueado.
    if (req.user.imp)
      return res.status(400).json({ erro: 'Você já está em outra identidade. Volte para a sua conta primeiro.' });

    const alvo = (await query(
      `SELECT u.UsuarioId, u.Nome, u.Email, u.Papel, u.Status, u.EmpresaId, u.Gestor, u.Permissoes,
              e.RazaoSocial AS Empresa
         FROM dbo.Usuario u
         JOIN dbo.Empresa e ON e.EmpresaId = u.EmpresaId
        WHERE u.UsuarioId = @id`, { id }))[0];
    if (!alvo) return res.status(404).json({ erro: 'Usuário não encontrado.' });
    if (alvo.Papel === 'admin')
      return res.status(400).json({ erro: 'Não é possível assumir a identidade de outro administrador.' });

    console.log(`↪ Identidade assumida: admin #${req.user.id} (${req.user.email}) → ` +
                `#${alvo.UsuarioId} (${alvo.Email}) da empresa "${alvo.Empresa}".`);

    // Sobrescreve os cookies de sessão com a identidade assumida. O token do
    // admin não é guardado em lugar nenhum: a volta reemite a partir do claim
    // `imp` (POST /api/auth/identidade/voltar).
    abrirSessao(res, signToken(alvo, { imp: req.user.id, expiresIn: '1h' }));

    res.json({
      // Quem assumiu. O front usa para desenhar a tarja de aviso já na
      // primeira renderização, sem esperar o GET /auth/sessao.
      imp: req.user.id,
      usuario: {
        id: alvo.UsuarioId, nome: alvo.Nome, email: alvo.Email,
        papel: alvo.Papel, empresa: alvo.Empresa, empresaId: alvo.EmpresaId,
        gestor: !!alvo.Gestor,
        permissoes: parsePermissoes(alvo.Permissoes),   // null = acesso total
        status: alvo.Status
      }
    });
  } catch (e) { next(e); }
});

export default router;
