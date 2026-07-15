// ============================================================
// Autenticação por JWT
// ============================================================
import jwt from 'jsonwebtoken';
import 'dotenv/config';

const SECRET = process.env.JWT_SECRET || 'dev-secret-trocar';
const EXPIRES = process.env.JWT_EXPIRES || '8h';

// Áreas do site que podem ser restringidas por conta interna (sub-dealer).
// A lista canônica vive aqui; o front usa as mesmas chaves.
export const AREAS = ['loja', 'finder', 'pedidos', 'financeiro', 'reivindicacoes', 'estoque', 'acoes'];

// Converte a coluna Usuario.Permissoes (JSON array ou NULL) em array ou null
// (null = acesso total). Valor ilegível vira null — nunca derruba o login.
export function parsePermissoes(raw) {
  if (!raw) return null;
  try {
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.filter(a => AREAS.includes(a)) : null;
  } catch { return null; }
}

// Gera o token a partir dos dados essenciais do usuário.
export function signToken(usuario) {
  return jwt.sign(
    {
      id: usuario.UsuarioId,
      email: usuario.Email,
      papel: usuario.Papel,
      empresaId: usuario.EmpresaId,
      gestor: !!usuario.Gestor,
      perm: parsePermissoes(usuario.Permissoes)   // null = acesso total
    },
    SECRET,
    { expiresIn: EXPIRES }
  );
}

// Middleware: exige um token válido no header Authorization: Bearer <token>.
export function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ erro: 'Token ausente.' });
  try {
    req.user = jwt.verify(token, SECRET);
    next();
  } catch {
    res.status(401).json({ erro: 'Token inválido ou expirado.' });
  }
}

// Middleware: exige que o usuário autenticado seja admin.
export function requireAdmin(req, res, next) {
  if (req.user?.papel !== 'admin') {
    return res.status(403).json({ erro: 'Acesso restrito a administradores.' });
  }
  next();
}

// Middleware: bloqueia contas internas (sub-dealers) sem acesso à área.
// Admin, gestor e tokens sem lista de permissões (acesso total) passam direto.
export function requireArea(area) {
  return (req, res, next) => {
    const u = req.user || {};
    if (u.papel === 'admin' || u.gestor || !Array.isArray(u.perm) || u.perm.includes(area)) return next();
    res.status(403).json({ erro: 'Sua conta não tem acesso a esta área. Fale com o gestor da concessionária.' });
  };
}
