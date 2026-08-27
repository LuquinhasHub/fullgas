// ============================================================
// Notificações geradas pelo SISTEMA (o ícone de carta do portal)
// ------------------------------------------------------------
// A tabela dbo.Notificacao tem dois caminhos de escrita, e eles são diferentes
// o bastante para viverem separados:
//
//   à mão      POST /api/notificacoes — o administrador escreve para as
//              concessionárias, com upload de anexo e validação de formulário.
//              Continua em routes/notificacoes.routes.js.
//   sistema    ESTE arquivo. Um aviso curto disparado por algo que aconteceu
//              em outra parte do portal (hoje: uma mensagem em um chamado de
//              suporte). Sem anexo, sem formulário, sem ninguém digitando.
//
// REGRA CENTRAL, a mesma do histórico do veículo: notificar NUNCA pode
// derrubar a ação que está sendo notificada. Se a gravação falhar, o erro vai
// para o log e a resposta do suporte segue seu curso — o contrário seria
// deixar um aviso decidir se a conversa acontece. Por isso a função engole o
// próprio erro e devolve true/false.
// ============================================================
import { query } from './db.js';

// Limites das colunas (migração 024). Cortar aqui evita que uma mensagem longa
// derrube o INSERT inteiro por truncamento.
const MAX_TITULO = 160;
const MAX_TEXTO = 2000;

/**
 * Grava uma notificação automática.
 *
 * @param {object} n
 * @param {string} n.titulo         linha principal ("Resposta no chamado CH-000012")
 * @param {string} [n.texto]        corpo (prévia da mensagem)
 * @param {'cliente'|'admin'} n.publico  para QUEM é: a concessionária ou o suporte
 * @param {number} [n.empresaId]    concessionária dona do assunto (null = todas)
 * @param {number} [n.chamadoId]    chamado que originou (dá o link e a marca de lida)
 * @param {'info'|'critica'} [n.tipo]
 * @param {number} [n.criadoPor]    UsuarioId de quem provocou o aviso
 * @returns {Promise<boolean>} true se gravou
 *
 * Não existe "marcar como lida para quem escreveu": o aviso sempre vai para o
 * LADO OPOSTO ao de quem falou (resposta do suporte avisa a concessionária;
 * mensagem da concessionária avisa o suporte). Quem escreveu nunca está entre
 * os destinatários.
 */
export async function criarNotificacao(n) {
  try {
    const titulo = String(n.titulo || '').trim().slice(0, MAX_TITULO) || '(sem título)';
    const texto = String(n.texto || '').trim().slice(0, MAX_TEXTO) || null;
    const publico = n.publico === 'admin' ? 'admin' : 'cliente';

    await query(
      `INSERT INTO dbo.Notificacao
         (EmpresaId, Titulo, Texto, Tipo, CriadoPor, Publico, Origem, ChamadoId)
       VALUES (@eid, @titulo, @texto, @tipo, @uid, @publico, 'suporte', @cid)`,
      {
        eid: n.empresaId || null,
        titulo,
        texto,
        tipo: n.tipo === 'critica' ? 'critica' : 'info',
        uid: n.criadoPor || null,
        publico,
        cid: n.chamadoId || null
      }
    );
    return true;
  } catch (e) {
    console.error('Falha ao criar notificação (a ação principal seguiu):', e.message);
    return false;
  }
}

/**
 * Marca como lidas, PARA UM USUÁRIO, as notificações de um chamado destinadas
 * ao lado dele. Chamado quando ele abre o chamado: quem já leu a conversa não
 * pode continuar com a carta acesa por causa dela.
 *
 * @param {number} chamadoId
 * @param {'cliente'|'admin'} publico  o lado de quem está lendo
 * @param {number} usuarioId
 * @returns {Promise<boolean>}
 */
export async function marcarNotificacoesDoChamadoLidas(chamadoId, publico, usuarioId) {
  try {
    await query(
      `INSERT INTO dbo.NotificacaoLida (NotificacaoId, UsuarioId)
       SELECT n.NotificacaoId, @uid
         FROM dbo.Notificacao n
        WHERE n.ChamadoId = @cid
          AND n.Publico = @publico
          AND NOT EXISTS (SELECT 1 FROM dbo.NotificacaoLida l
                           WHERE l.NotificacaoId = n.NotificacaoId AND l.UsuarioId = @uid)`,
      { cid: chamadoId, publico: publico === 'admin' ? 'admin' : 'cliente', uid: usuarioId }
    );
    return true;
  } catch (e) {
    console.error('Falha ao marcar notificações do chamado como lidas:', e.message);
    return false;
  }
}
