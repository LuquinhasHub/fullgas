// ============================================================
// Rotas de usuários (gestão de clientes no painel admin)
//   - GET   /usuarios      lista todos (com empresa, CNPJ e endereço)
//   - PATCH /usuarios/:id   aprova / bloqueia / muda papel
// Só administradores.
// ============================================================
import { Router } from 'express';
import { query, getPool, sql } from '../db.js';
import { requireAuth, requireAdmin } from '../auth.js';

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

export default router;
