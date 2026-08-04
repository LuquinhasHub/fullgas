// ============================================================
// Regras compartilhadas de upload (nome do arquivo e filtro de tipo).
// ------------------------------------------------------------
// Antes, cada lugar que recebia arquivo repetia a mesma configuração — e o
// filtro tinha dois problemas sérios:
//
// 1. Era um OU: `mime.startsWith('image/') || EXT_OK.includes(ext)`. Bastava
//    mandar um .html com Content-Type: image/png para passar. Como o tipo que
//    o navegador usa ao exibir vem da EXTENSÃO, o arquivo seria servido como
//    HTML — script rodando na mesma origem do portal.
// 2. Aceitava .svg. SVG é XML: pode carregar <script> dentro. Servido da
//    mesma origem, vira XSS armazenado.
//
// Agora a extensão é obrigatória e conferida contra uma lista fixa (é ela que
// manda na hora de servir), e o mime precisa ser da mesma família.
// ============================================================
import crypto from 'node:crypto';
import path from 'node:path';

// .svg fica DE FORA de propósito (ver comentário acima).
// .heic/.heif são o padrão de foto do iPhone — sem eles, o revendedor não
// consegue anexar foto tirada no celular.
export const EXT_IMAGEM = ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp', '.heic', '.heif'];
export const EXT_VIDEO = ['.mp4', '.webm', '.mov', '.avi', '.mkv', '.m4v', '.3gp', '.ogv', '.ogg', '.mpeg', '.mpg'];

// Documentos que o admin costuma anexar numa notificação (boletim técnico,
// tabela de preços). Ficam DE FORA: .html/.htm (script na mesma origem),
// .svg, e qualquer executável (.exe, .bat, .sh, .js, .jar...).
export const EXT_DOCUMENTO = ['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.csv', '.txt', '.zip'];

// Nome gerado por nós: o nome original do usuário nunca vira caminho no disco.
// A aleatoriedade vem do crypto (Math.random não serve para nada que precise
// ser difícil de adivinhar — é previsível a partir de algumas amostras).
export function nomeArquivo(file, extensoesOk) {
  const ext = path.extname(file.originalname || '').toLowerCase();
  const seguro = extensoesOk.includes(ext) ? ext : '';
  return Date.now() + '-' + crypto.randomBytes(12).toString('hex') + seguro;
}

// Monta um fileFilter do multer que exige extensão permitida E mime da família
// certa. `familias` são os prefixos aceitos, ex.: ['image/'].
//
// `application/octet-stream` passa porque alguns celulares e navegadores
// mandam isso mesmo em foto legítima. Não enfraquece a proteção: quem decide
// como o arquivo será servido é a extensão, que já foi validada.
export function filtroArquivo(extensoesOk, familias, mensagemErro) {
  return (_req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    if (!extensoesOk.includes(ext)) return cb(new Error(mensagemErro));

    const mime = (file.mimetype || '').toLowerCase();
    const mimeOk = mime === 'application/octet-stream' ||
                   familias.some(f => mime.startsWith(f));
    if (!mimeOk) return cb(new Error(mensagemErro));

    cb(null, true);
  };
}

// Atalhos para os dois casos que existem hoje.
export const filtroImagem = () =>
  filtroArquivo(EXT_IMAGEM, ['image/'], 'Envie apenas imagens (JPG, PNG, WEBP, GIF ou BMP).');

export const filtroMidia = () =>
  filtroArquivo(
    [...EXT_IMAGEM, ...EXT_VIDEO], ['image/', 'video/'],
    'Envie apenas fotos ou vídeos.'
  );

// Anexo de notificação: aceita mídia e também documento. Continua sendo
// allowlist — o que não está na lista não entra, incluindo .html e executável.
export const filtroAnexo = () =>
  filtroArquivo(
    [...EXT_IMAGEM, ...EXT_VIDEO, ...EXT_DOCUMENTO],
    ['image/', 'video/', 'application/', 'text/'],
    'Tipo de arquivo não permitido. Envie imagem, vídeo, PDF, documento do Office, CSV, TXT ou ZIP.'
  );
