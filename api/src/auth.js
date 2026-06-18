// ============================================================
// Autenticação por JWT
// ============================================================
import jwt from 'jsonwebtoken';
import 'dotenv/config';

const SECRET = process.env.JWT_SECRET || 'dev-secret-trocar';
const EXPIRES = process.env.JWT_EXPIRES || '8h';

// Gera o token a partir dos dados essenciais do usuário.
export function signToken(usuario) {
  return jwt.sign(
    {
      id: usuario.UsuarioId,
      email: usuario.Email,
      papel: usuario.Papel,
      empresaId: usuario.EmpresaId
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
