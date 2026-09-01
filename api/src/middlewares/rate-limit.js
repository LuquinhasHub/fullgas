// ============================================================
// Limites de requisição por IP nas rotas sensíveis.
// ------------------------------------------------------------
// Antes disto não havia limite nenhum: dava para tentar senha à vontade em
// /auth/login, ou usar /auth/senha/esqueci como metralhadora de e-mail. O
// único freio era um Map em memória dentro de auth.routes.js, que sumia a
// cada restart.
//
// Todos dependem de `app.set('trust proxy', 1)` no server.js — sem isso, atrás
// do Nginx todo mundo aparece como 127.0.0.1 e o limite vira global (o
// primeiro a estourar bloquearia os demais). Em produção há DOIS saltos
// (Cloudflare → Nginx → API), então o Nginx precisa do módulo realip
// traduzindo o CF-Connecting-IP para $remote_addr — senão o que chega aqui é
// o IP de borda da Cloudflare e todos os limites viram por-datacenter em vez
// de por-cliente. Ver deploy/nginx/fullgas.conf.
//
// SOBRE O ARMAZENAMENTO: o express-rate-limit guarda a contagem na MEMÓRIA do
// processo. Isso vale enquanto a API for um processo só (é o caso hoje:
// systemd na VPS, instância única). No dia em que houver mais de uma
// instância, cada uma passa a contar do seu lado e o limite efetivo é
// multiplicado pelo número de instâncias — aí é hora de um store externo
// (Redis). Reiniciar a API também zera as contagens.
// ============================================================
import rateLimit from 'express-rate-limit';

// Resposta no mesmo formato de erro do resto da API ({ erro: '...' }), para o
// front exibir a mensagem sem tratamento especial.
function bloqueio(mensagem) {
  return (_req, res) => res.status(429).json({ erro: mensagem });
}

const COMUM = {
  standardHeaders: 'draft-7',   // RateLimit-* padronizados
  legacyHeaders: false          // sem os X-RateLimit-* antigos
};

// Login (e-mail/senha). `skipSuccessfulRequests` faz só as tentativas
// FRACASSADAS contarem: quem acerta a senha nunca é barrado, mesmo em rede
// compartilhada (a concessionária inteira costuma sair pelo mesmo IP).
export const limiteLogin = rateLimit({
  ...COMUM,
  windowMs: 15 * 60 * 1000,
  limit: 10,
  skipSuccessfulRequests: true,
  handler: bloqueio('Muitas tentativas de login. Tente de novo em 15 minutos.')
});

// Recuperação de senha: cada pedido dispara um e-mail. Aqui TODA requisição
// conta (inclusive as bem-sucedidas) — o abuso é justamente o envio.
export const limiteSenha = rateLimit({
  ...COMUM,
  windowMs: 60 * 60 * 1000,
  limit: 5,
  handler: bloqueio('Muitos pedidos de recuperação de senha. Tente de novo daqui a uma hora.')
});

// Abertura de chamado de suporte. O limite é FOLGADO de propósito: a
// concessionária inteira sai pelo mesmo IP, e barrar quem está tentando pedir
// ajuda é pior do que engolir alguns chamados repetidos. Serve contra o acidente
// (formulário em laço, clique nervoso no "enviar") e contra o abuso grosseiro,
// não contra o revendedor com muitos problemas no mesmo dia.
export const limiteChamado = rateLimit({
  ...COMUM,
  windowMs: 60 * 60 * 1000,
  limit: 30,
  handler: bloqueio('Muitos chamados abertos deste endereço na última hora. Responda em um chamado já aberto ou tente de novo mais tarde.')
});

// Cadastro: cria empresa + usuário e ainda chama o Tiny. Poucos por hora.
export const limiteCadastro = rateLimit({
  ...COMUM,
  windowMs: 60 * 60 * 1000,
  limit: 5,
  handler: bloqueio('Muitos cadastros a partir deste endereço. Tente de novo daqui a uma hora.')
});

// Uso do LINK de recuperação (/senha/verificar e /senha/redefinir) — o passo
// seguinte ao /senha/esqueci, que tem o limite acima.
//
// Não é contra adivinhação do token: ele tem 256 bits de entropia, e nem toda
// a internet junta chuta isso. É contra o resto — martelar a rota consome
// consulta ao banco e um bcrypt.hash (caro de propósito) por tentativa. O
// limite é folgado para não atrapalhar quem legitimamente erra a senha nova
// algumas vezes na tela de redefinição.
export const limiteVerificacaoSenha = rateLimit({
  ...COMUM,
  windowMs: 15 * 60 * 1000,
  limit: 20,
  handler: bloqueio('Muitas tentativas. Aguarde alguns minutos e tente de novo.')
});

// Piso geral para toda a API. NÃO substitui os limites específicos acima — é
// uma rede de segurança para as rotas que ninguém lembrou de proteger e para
// varredura automatizada. O teto é alto de propósito: um revendedor navegando
// pela loja dispara dezenas de requisições por minuto (catálogo, imagens,
// notificações), e a concessionária inteira costuma sair por um IP só.
export const limiteGlobal = rateLimit({
  ...COMUM,
  windowMs: 5 * 60 * 1000,
  limit: 600,
  handler: bloqueio('Muitas requisições deste endereço. Aguarde um instante e tente de novo.')
});
