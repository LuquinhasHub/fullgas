// ============================================================
// Middleware de upload da foto da categoria (miniatura da grade da loja).
// Espelha o upload-produto.js: isola a configuração do multer e a validação
// do arquivo; a rota só o encadeia antes do controller.
// ============================================================
import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { EXT_IMAGEM, nomeArquivo, filtroImagem } from './upload-comum.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const CAT_DIR = path.join(__dirname, '..', '..', 'uploads', 'categorias');
fs.mkdirSync(CAT_DIR, { recursive: true });

// URL pública (relativa) onde as fotos ficam acessíveis. Usada também pelo
// service para montar o caminho gravado no banco.
export const CAT_URL_BASE = '/uploads/categorias/';

const uploadCat = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, CAT_DIR),
    filename: (_req, file, cb) => cb(null, nomeArquivo(file, EXT_IMAGEM))
  }),
  limits: { fileSize: 15 * 1024 * 1024, files: 1 },
  fileFilter: filtroImagem()
});

// Recebe o campo multipart "imagem" e traduz erros do multer em 400 legível.
export function uploadImagemCategoria(req, res, next) {
  uploadCat.single('imagem')(req, res, (err) => {
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
