// ============================================================
// Rotas de usuários (gestão de clientes no painel admin)
//   - GET    /usuarios       lista todos (com empresa, CNPJ e endereço)
//   - PATCH  /usuarios/:id   aprova / bloqueia / muda papel
//   - DELETE /usuarios/:id   remove cliente indesejado/bloqueado
// Só administradores.
// ============================================================
import { Router } from 'express';
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

// GET /api/usuarios — lista com empresa e endereço principal (pendentes primeiro).
router.get('/usuarios', requireAuth, requireAdmin, async (_req, res, next) => {
  try {
    const rows = await query(
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
         ) en
        ORDER BY CASE WHEN u.Status = 'pendente' THEN 0 ELSE 1 END, u.CriadoEm DESC`
    );
    res.json(rows.map(toUsuario));
  } catch (e) { next(e); }
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
    const token = signToken(alvo, { imp: req.user.id, expiresIn: '1h' });
    abrirSessao(res, token);

    res.json({
      token,
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
