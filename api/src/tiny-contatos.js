// ============================================================
// Vínculo de CLIENTES com o Tiny ERP (sentido Fullgas → Tiny)
// ------------------------------------------------------------
// Regra de negócio: todo cliente cadastrado no Fullgas deve ter
// o CNPJ atrelado a um contato já existente no Tiny; se não
// existir contato com aquele CNPJ, um é CRIADO lá com todas as
// informações capturadas no cadastro (razão social, IE, e-mail,
// telefone e endereço completo).
//
// Fluxo:
//   POST /api/auth/register → grava Empresa com
//   TinyContatoPendente = 1 (na mesma transação) → após o commit
//   este módulo pesquisa o CNPJ no Tiny e vincula/cria o contato,
//   gravando Empresa.TinyContatoId. Se o Tiny estiver fora, a
//   empresa continua pendente e o cron (tiny-cron.js) re-tenta a
//   cada rodada até conseguir.
//
// Só o /register liga a flag — empresas antigas do banco NÃO são
// exportadas em massa para o Tiny.
//
// Liga/desliga: TINY_SINCRONIZAR_CLIENTES=1 no .env (além do
// TINY_TOKEN). Desligado, o cadastro funciona normalmente e as
// empresas ficam pendentes até a chave ser ligada.
// ============================================================
import 'dotenv/config';
import { query } from './db.js';
import { pesquisarContatoPorCpfCnpj, incluirContato, registrarLog } from './tiny.js';

export function clientesLigado() {
  return !!process.env.TINY_TOKEN && process.env.TINY_SINCRONIZAR_CLIENTES === '1';
}

// "12345678000190" → "12.345.678/0001-90" (o Tiny costuma armazenar com
// máscara; a pesquisa tenta os dois formatos).
function fmtCnpj(dig) {
  return dig.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
}

// Monta o payload de contato.incluir.php com tudo que o cadastro capturou.
function montarContato(emp) {
  const dig = String(emp.Cnpj || '').replace(/\D/g, '');
  const c = {
    nome: emp.RazaoSocial,
    tipo_pessoa: dig.length === 11 ? 'F' : 'J',
    cpf_cnpj: dig,
    situacao: 'A',
    obs: 'Criado automaticamente pelo portal Fullgas B2B.'
  };
  if (emp.NomeFantasia) c.fantasia = emp.NomeFantasia;
  if (emp.InscricaoEstadual) c.ie = emp.InscricaoEstadual;
  if (emp.Email) c.email = emp.Email;
  if (emp.Telefone) c.fone = emp.Telefone;
  if (emp.Logradouro) {
    c.endereco = emp.Logradouro;
    if (emp.Numero) c.numero = emp.Numero;
    if (emp.Complemento) c.complemento = emp.Complemento;
    if (emp.Bairro) c.bairro = emp.Bairro;
    if (emp.Cep) c.cep = emp.Cep;
    if (emp.Cidade) c.cidade = emp.Cidade;
    if (emp.Uf) c.uf = emp.Uf;
  }
  return c;
}

// Vincula UMA empresa: pesquisa o CNPJ no Tiny; achou → grava o id do
// contato existente; não achou → cria o contato com os dados do cadastro.
// Falha não propaga (devolve null): a empresa segue pendente e o cron
// re-tenta. Chamada após o commit do /register e pelo cron.
export async function vincularContatoTiny(empresaId) {
  if (!clientesLigado()) return null;

  const emp = (await query(
    `SELECT e.EmpresaId, e.RazaoSocial, e.NomeFantasia, e.Cnpj, e.InscricaoEstadual,
            e.Email, e.Telefone, e.TinyContatoId,
            en.Logradouro, en.Numero, en.Complemento, en.Bairro, en.Cidade, en.Uf, en.Cep
       FROM dbo.Empresa e
       OUTER APPLY (
         SELECT TOP 1 d.Logradouro, d.Numero, d.Complemento, d.Bairro, d.Cidade, d.Uf, d.Cep
           FROM dbo.Endereco d
          WHERE d.EmpresaId = e.EmpresaId
          ORDER BY d.Principal DESC, d.EnderecoId ASC
       ) en
      WHERE e.EmpresaId = @eid`,
    { eid: empresaId }
  ))[0];
  if (!emp) return null;
  if (emp.TinyContatoId) {              // já vinculado — só apaga a pendência
    await desmarcarPendente(empresaId);
    return emp.TinyContatoId;
  }

  const dig = String(emp.Cnpj || '').replace(/\D/g, '');
  if (!dig) {                           // sem CNPJ não há o que atrelar
    await desmarcarPendente(empresaId);
    await registrarLog(null, null, 'contato', 'ignorado',
      `Empresa "${emp.RazaoSocial}" sem CNPJ — vínculo com o Tiny ignorado.`);
    return null;
  }

  try {
    // Pesquisa nos dois formatos (o Tiny pode armazenar com ou sem máscara).
    let contato = await pesquisarContatoPorCpfCnpj(fmtCnpj(dig))
      || await pesquisarContatoPorCpfCnpj(dig);
    let acao = 'vinculado ao contato existente';

    if (!contato) {
      try {
        contato = await incluirContato(montarContato(emp));
        acao = 'contato criado no Tiny';
      } catch (e) {
        // Corrida/formatação: o Tiny recusou por CNPJ duplicado — então o
        // contato existe; pesquisa de novo e vincula.
        if (!/j[áa] (existe|cadastrad)/i.test(e.message)) throw e;
        contato = await pesquisarContatoPorCpfCnpj(fmtCnpj(dig))
          || await pesquisarContatoPorCpfCnpj(dig);
        if (!contato) throw e;
      }
    }

    await query(
      `UPDATE dbo.Empresa
          SET TinyContatoId = @cid, TinyContatoPendente = 0, AtualizadoEm = SYSUTCDATETIME()
        WHERE EmpresaId = @eid`,
      { cid: contato.id, eid: empresaId }
    );
    await registrarLog(contato.id, null, 'contato', 'ok',
      `Empresa "${emp.RazaoSocial}" (CNPJ ${fmtCnpj(dig)}): ${acao}.`);
    return contato.id;
  } catch (e) {
    // Continua pendente — o cron re-tenta na próxima rodada.
    await registrarLog(null, null, 'contato', 'erro',
      `Empresa "${emp.RazaoSocial}" (CNPJ ${fmtCnpj(dig)}): ${e.message}`);
    console.error(`✗ Vínculo Tiny da empresa ${empresaId} falhou: ${e.message}`);
    return null;
  }
}

async function desmarcarPendente(empresaId) {
  await query(
    'UPDATE dbo.Empresa SET TinyContatoPendente = 0 WHERE EmpresaId = @eid',
    { eid: empresaId }
  ).catch(() => { });
}

// Re-tenta os vínculos que ficaram pendentes (Tiny fora do ar na hora do
// cadastro, chave desligada, etc.). Chamada pelo cron a cada rodada.
export async function processarContatosPendentes() {
  if (!clientesLigado()) return;
  try {
    const rows = await query(
      `SELECT EmpresaId FROM dbo.Empresa
        WHERE TinyContatoPendente = 1 AND TinyContatoId IS NULL
        ORDER BY EmpresaId`
    );
    for (const r of rows) await vincularContatoTiny(r.EmpresaId);
  } catch (e) {
    console.error('✗ Fila de contatos Tiny falhou:', e.message);
  }
}
