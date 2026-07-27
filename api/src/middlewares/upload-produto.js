// ============================================================
// Middleware de upload da foto do produto (miniatura no finder/admin).
// Isola a configuração do multer e a validação do arquivo; a rota só o
// encadeia antes do controller.
// ============================================================
import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const PROD_DIR = path.join(__dirname, '..', '..', 'uploads', 'produtos');
fs.mkdirSync(PROD_DIR, { recursive: true });

// URL pública (relativa) onde as fotos ficam acessíveis. Usada também pelo
// service para montar o caminho gravado no banco.
export const PROD_URL_BASE = '/uploads/produtos/';

const IMG_EXT = ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp', '.svg'];

const uploadProd = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, PROD_DIR),
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname || '').toLowerCase().slice(0, 10);
      cb(null, Date.now() + '-' + Math.random().toString(36).slice(2, 10) + ext);
    }
  }),
  limits: { fileSize: 15 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    const mime = file.mimetype || '';
    const ext = path.extname(file.originalname || '').toLowerCase();
    if (mime.startsWith('image/') || IMG_EXT.includes(ext)) return cb(null, true);
    cb(new Error('Envie apenas imagens.'));
  }
});

// Recebe o campo multipart "imagem" e traduz erros do multer em 400 legível.
export function uploadImagemProduto(req, res, next) {
  uploadProd.single('imagem')(req, res, (err) => {
    if (err) {
      const msg = err.code === 'LIMIT_FILE_SIZE'
        ? 'Imagem muito grande (máximo 15 MB).'
        : (err.message || 'Falha no upload.');
      return res.status(400).json({ erro: msg });
    }
    if (!req.file) return res.status(400).json({ erro: 'Envie o arquivo no campo "imagem".' });
    next();
  });
}
