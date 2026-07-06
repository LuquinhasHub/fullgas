# Integração com o Tiny ERP — Fullgas B2B

> **Audiência**: Claude Code, executando na raiz do monorepo.
> Aplicar **depois** que a Frente 1 do `04-roadmap.md` estiver concluída.
> Branch sugerido: `feat/tiny-integration`.

## Visão geral

O Tiny ERP é a **única fonte de verdade** dos produtos. O Fullgas nunca edita
produtos vindos do Tiny — todo campo (estoque, preço, nome, descrição, foto)
é sempre um espelho do que está no Tiny. Não existe edição manual nem override
no Fullgas para produtos de origem Tiny.

A atualização acontece de duas formas complementares:

1. **Sincronização agendada (node-cron)** — a API roda automaticamente, a cada
   N **minutos** (`TINY_SYNC_INTERVALO_MIN` no `.env`), o mesmo lote do botão
   "Sincronizar" do admin, espelhando todos os produtos com `TinyAtivo = 1`.
   > **Nota de revisão**: a primeira versão desta integração usava **webhook**
   > (o Tiny avisava a API a cada mudança). O método foi descartado porque a
   > parte de notificação dos webhooks se mostrou pouco confiável; no lugar
   > entrou o agendamento node-cron (`api/src/tiny-cron.js`), que reaproveita
   > o mecanismo do botão de sincronizar que já existia no projeto.
2. **Sincronização em lote (manual)** — o admin pode, a qualquer momento,
   selecionar um grupo de produtos (ou todos) e forçar uma atualização
   imediata contra o Tiny, sem esperar a próxima rodada do cron.

```
Cron dispara a cada N minutos              Admin clica "Sincronizar em lote"
      ↓                                                  ↓
API busca cada produto Tiny no Tiny         API busca cada produto no Tiny
      ↓                                                  ↓
API atualiza todos no banco                 API atualiza todos no banco
      ↓                                                  ↓
Loja reflete a mudança                      Loja reflete a mudança imediatamente
```

## Decisões de negócio confirmadas

1. **O que sincroniza**: estoque + preço + nome + descrição + foto — **todos
   os campos, sempre**. Sem exceção e sem edição manual no Fullgas.
2. **Sem override**: o admin do Fullgas não edita nenhum campo de produto
   Tiny. Se precisar mudar algo, muda no Tiny — a mudança volta pro Fullgas
   pela sincronização agendada (cron) ou pelo lote manual.
3. **Sincronização em lote**: além do agendamento automático, existe uma tela
   no admin para selecionar produtos (ou "selecionar todos") e disparar uma
   atualização manual imediata contra o Tiny.
4. **Sentido**: somente Tiny → Fullgas. O Fullgas nunca escreve de volta no Tiny.
5. **API do Tiny**: usar a **v2** (token simples, sem OAuth2).
6. **Atualização automática por node-cron, não por webhook**: decisão tomada
   após testes — ver a nota de revisão na visão geral.

---

## Implementação

### Migração 015 — campos de integração Tiny

> Este documento foi escrito quando a próxima migração seria a 007; no
> repositório atual as migrações 007–014 já existem, então esta entra
> como **`015_tiny_integracao.sql`**.

Crie `database/migrations/015_tiny_integracao.sql`, idempotente.

```sql
USE FullgasB2B;
GO

-- Campos de origem no produto
IF COL_LENGTH('dbo.Produto', 'TinyId') IS NULL
    ALTER TABLE dbo.Produto ADD TinyId VARCHAR(40) NULL;
GO
IF COL_LENGTH('dbo.Produto', 'TinyAtivo') IS NULL
    ALTER TABLE dbo.Produto ADD TinyAtivo BIT NOT NULL
        CONSTRAINT DF_Produto_TinyAtivo DEFAULT (0);
GO
IF COL_LENGTH('dbo.Produto', 'TinySincronizadoEm') IS NULL
    ALTER TABLE dbo.Produto ADD TinySincronizadoEm DATETIME2(0) NULL;
GO

-- Log de sincronizações (útil para debugar e para o admin conferir histórico)
IF OBJECT_ID('dbo.TinySyncLog', 'U') IS NULL
CREATE TABLE dbo.TinySyncLog (
    LogId         INT           IDENTITY(1,1) NOT NULL,
    TinyId        VARCHAR(40)   NULL,
    Sku           VARCHAR(40)   NULL,
    Evento        VARCHAR(20)   NOT NULL,  -- 'cron' | 'importacao' | 'lote'
    Status        VARCHAR(10)   NOT NULL,  -- 'ok' | 'erro'
    Mensagem      NVARCHAR(500) NULL,
    CriadoEm     DATETIME2(0)  NOT NULL
        CONSTRAINT DF_TinySyncLog_CriadoEm DEFAULT (SYSUTCDATETIME()),
    CONSTRAINT PK_TinySyncLog PRIMARY KEY (LogId)
);
GO

CREATE INDEX IX_TinySyncLog_TinyId ON dbo.TinySyncLog (TinyId);
GO
CREATE INDEX IX_TinySyncLog_Data   ON dbo.TinySyncLog (CriadoEm);
GO

PRINT N'Migração 015 concluída.';
GO
```

---

### Variáveis de ambiente

Adicionar ao `api/.env` e ao `api/.env.example`:

```
# --- Integração Tiny ERP ---
TINY_TOKEN=seu_token_aqui
# Gere em: Tiny → Menu → Início → Extensões → Token API

# Sincronização automática (node-cron): intervalo em MINUTOS entre as rodadas
# que espelham todos os produtos Tiny (mesmo lote do botão "Sincronizar" do
# admin). Use 1 a 59, ou múltiplos de 60 (60 = 1h). 0 ou vazio = desligado.
TINY_SYNC_INTERVALO_MIN=15
```

---

### Módulo Tiny — `api/src/tiny.js`

Encapsula toda comunicação com a API v2 do Tiny.
Se o Tiny mudar a API, só este arquivo muda.

```javascript
// api/src/tiny.js
import 'dotenv/config';
import { query } from './db.js';

const BASE = 'https://api.tiny.com.br/api2';
const TOKEN = process.env.TINY_TOKEN;

// POST para a API v2 do Tiny (sempre POST com form-encoded).
async function tinyPost(endpoint, params) {
  const body = new URLSearchParams({ token: TOKEN, formato: 'JSON', ...params });
  const r = await fetch(`${BASE}/${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString()
  });
  const data = await r.json();
  if (data.retorno?.status === 'Erro') {
    const msg = data.retorno?.erros?.[0]?.erro || 'Erro desconhecido do Tiny';
    throw new Error(`Tiny API: ${msg}`);
  }
  return data.retorno;
}

// Lista produtos do Tiny (paginado, 100 por página) — tela de importação.
export async function listarProdutos(pagina = 1) {
  return tinyPost('produtos.pesquisa.php', { pagina });
}

// Detalhe completo de um produto pelo ID do Tiny.
export async function obterProduto(tinyId) {
  return tinyPost('produto.obter.php', { id: tinyId });
}

// Aplica os dados do Tiny num produto do banco. SEM overrides: todo campo
// presente no payload é sempre sobrescrito.
export async function aplicarAtualizacao(tinyId, dados, evento = 'lote') {
  const produtos = await query(
    `SELECT ProdutoId, Sku, TinyAtivo FROM dbo.Produto WHERE TinyId = @tid`,
    { tid: tinyId }
  );
  if (!produtos.length) {
    await registrarLog(tinyId, null, evento, 'erro', 'Produto não importado no Fullgas');
    return { status: 'ignorado', msg: 'Produto não importado no Fullgas' };
  }

  const p = produtos[0];
  if (!p.TinyAtivo) {
    await registrarLog(tinyId, p.Sku, evento, 'erro', 'TinyAtivo = 0');
    return { status: 'ignorado', msg: 'TinyAtivo = 0' };
  }

  const sets = ['TinySincronizadoEm = SYSUTCDATETIME()', 'AtualizadoEm = SYSUTCDATETIME()'];
  const params = { pid: p.ProdutoId };

  if (dados.estoque !== undefined) { sets.push('Estoque = @est'); params.est = Number(dados.estoque) || 0; }
  if (dados.preco !== undefined)   { sets.push('Preco = @preco'); params.preco = Number(dados.preco) || 0; }
  if (dados.nome !== undefined)    { sets.push('Nome = @nome'); params.nome = dados.nome; }
  if (dados.descricao !== undefined) { sets.push('Descricao = @desc'); params.desc = dados.descricao; }
  if (dados.foto !== undefined)    { sets.push('ImagemPrincipal = @foto'); params.foto = dados.foto; }

  await query(`UPDATE dbo.Produto SET ${sets.join(', ')} WHERE ProdutoId = @pid`, params);
  await registrarLog(tinyId, p.Sku, evento, 'ok', null);

  return { status: 'ok' };
}

async function registrarLog(tinyId, sku, evento, status, mensagem) {
  await query(
    `INSERT INTO dbo.TinySyncLog (TinyId, Sku, Evento, Status, Mensagem)
     VALUES (@tid, @sku, @ev, @st, @msg)`,
    { tid: tinyId, sku, ev: evento, st: status, msg: mensagem }
  );
}

// Sincroniza uma lista de produtos (por ProdutoId do Fullgas) contra o Tiny.
// Usada pela sincronização em lote no painel admin.
export async function sincronizarLote(produtoIds) {
  const placeholders = produtoIds.map((_, i) => `@p${i}`).join(',');
  const params = {};
  produtoIds.forEach((id, i) => { params[`p${i}`] = id; });

  const produtos = await query(
    `SELECT ProdutoId, TinyId, Sku FROM dbo.Produto
      WHERE ProdutoId IN (${placeholders}) AND TinyAtivo = 1`,
    params
  );

  const resultados = [];
  for (const p of produtos) {
    try {
      const detalhe = await obterProduto(p.TinyId);
      const prod = detalhe.produto;
      const r = await aplicarAtualizacao(p.TinyId, {
        estoque: prod.estoqueAtual,
        preco: prod.preco,
        nome: prod.nome,
        descricao: prod.descricao_complementar,
        foto: prod.anexos?.[0]?.anexo
      }, 'lote');
      resultados.push({ sku: p.Sku, ...r });
    } catch (e) {
      await registrarLog(p.TinyId, p.Sku, 'lote', 'erro', e.message);
      resultados.push({ sku: p.Sku, status: 'erro', msg: e.message });
    }
  }
  return resultados;
}
```

---

### Rotas — `api/src/routes/tiny.routes.js`

```
GET  /api/tiny/produtos          Lista produtos do Tiny (admin) — tela de importação
POST /api/tiny/importar          Importa produtos selecionados pro banco
POST /api/tiny/sync-lote         Sincroniza um lote de produtos selecionados (admin)
GET  /api/tiny/log               Histórico de sincronizações (admin)
```

A atualização automática **não passa por rota** — é o agendamento node-cron
descrito a seguir.

**Sincronização agendada (node-cron)** — `api/src/tiny-cron.js`:

- Substitui o webhook. Ao subir a API (depois do banco conectar), o
  `server.js` chama `iniciarSincronizacaoAgendada()`.
- A cada `TINY_SYNC_INTERVALO_MIN` **minutos** (1–59, ou múltiplos de 60 para
  virar horas; 0 ou vazio desliga), roda `sincronizarLote(null, 'cron')` — o
  **mesmo lote do botão "Sincronizar" do admin**, cobrindo todos os produtos
  com `TinyAtivo = 1`.
- No `TinySyncLog` a rodada automática grava `Evento = 'cron'`; o botão do
  admin grava `'lote'` — o log diferencia as duas origens.
- Trava de sobreposição: se uma rodada ainda estiver em andamento quando a
  próxima disparar, a nova é pulada (aviso no console). Nunca rodam duas ao
  mesmo tempo.
- Ritmo: cada produto custa até 2 requisições ao Tiny e a fila do `tiny.js`
  espaça as chamadas (~1,1 s) pelo limite de ~60 req/min do Tiny. Escolha um
  intervalo maior que a duração de uma rodada do catálogo inteiro.

**Detalhe do sync em lote** (`POST /api/tiny/sync-lote`):

- Recebe `{ produtoIds: [1, 2, 3, ...] }` — se vier vazio ou com a flag
  `{ todos: true }`, sincroniza **todos** os produtos com `TinyAtivo = 1`.
- Chama `tiny.sincronizarLote(produtoIds)`.
- Devolve um resumo: quantos OK, quantos com erro, e o detalhe de cada um
  (útil para o admin ver na tela se algo falhou).
- Como pode demorar (um request ao Tiny por produto), considerar rodar em
  lotes de no máximo ~50 por vez, com uma barra de progresso simples no front
  se o admin selecionar "todos" com catálogo grande.

**Detalhe do importar** — fluxo em duas etapas:

1. Admin busca lista (`GET /api/tiny/produtos?pagina=1`) — traz produtos do
   Tiny que ainda não foram importados (sem `TinyId` correspondente no banco).
2. Admin seleciona e envia `POST /api/tiny/importar` com array de TinyIds.
3. Para cada TinyId: busca detalhe completo no Tiny, cria produto no banco
   com `TinyAtivo = 1`.
   - Se o SKU já existe no banco: vincula (atualiza `TinyId` e `TinyAtivo = 1`)
     em vez de duplicar.

---

### Configuração da sincronização automática

**Nada a configurar no lado do Tiny** (não há webhook nem URL de notificação
para cadastrar; ngrok deixou de ser necessário). Basta o `api/.env`:

- `TINY_TOKEN` — token da API v2.
- `TINY_SYNC_INTERVALO_MIN` — intervalo em minutos entre as rodadas
  automáticas (0 ou vazio desliga; a sincronização manual pelo botão do
  admin continua funcionando mesmo com o cron desligado).

Ao subir, a API loga o estado do agendamento no console:
`✓ Sync Tiny (cron): agendado a cada 15 min (expressão "*/15 * * * *")`.

---

### Tela de importação e sincronização no painel admin

Nova seção no `admin.html` / `admin.js`: **"Produtos do Tiny"**.

**Lista de importação** (produtos ainda não trazidos pro Fullgas):
- Tabela com: SKU, nome, estoque atual (Tiny), preço, status
  ("Novo" se não existe no Fullgas, "Já importado" se TinyId já está no banco,
  "SKU existe" se o SKU existe mas sem TinyId — pode vincular).
- Checkbox por linha + "Selecionar todos".
- Botão "Importar selecionados".
- Paginação (Tiny retorna 100 por página).

**Lista de produtos já sincronizados** (depois de importados):
- No catálogo admin, produtos com `TinyAtivo = 1` mostram um badge "Tiny" e a
  data da última sincronização (`TinySincronizadoEm`).
- Esses produtos **não têm campos editáveis** no formulário do admin — nome,
  preço, descrição e foto aparecem como somente leitura, com uma nota:
  "Este produto é gerenciado pelo Tiny ERP. Para alterar, edite no Tiny."
- Checkbox por linha + "Selecionar todos" + botão **"Sincronizar selecionados"**
  — dispara `POST /api/tiny/sync-lote` com os IDs marcados.
- Botão **"Sincronizar todos os produtos Tiny"** — atalho para o lote completo.
- Após o sync, mostrar um resumo: "42 produtos atualizados, 1 com erro (ver log)".

**Log de sincronização**:
- Tabela simples em `/api/tiny/log`: data, SKU, evento (cron/importação/lote),
  status, mensagem de erro se houver. Últimos 100 registros.

---

## Critério de aceitação

### Importação
1. Admin abre "Produtos do Tiny" no painel.
2. Lista carrega com produtos do Tiny que não estão no Fullgas.
3. Admin seleciona 3 produtos e clica "Importar".
4. Os 3 aparecem na loja com SKU, nome, preço e foto vindos do Tiny.
5. No banco: `TinyId` preenchido, `TinyAtivo = 1`.
6. No formulário de edição desses produtos, os campos aparecem como
   somente leitura.

### Sincronização agendada (node-cron)
7. No Tiny, alterar o estoque e o preço de um produto importado.
8. Aguardar a próxima rodada do agendamento (até `TINY_SYNC_INTERVALO_MIN`
   minutos).
9. Estoque e preço no Fullgas refletem os novos valores sem nenhuma ação
   manual.
10. Log registra a sincronização com `Evento = 'cron'`, `Status = 'ok'`.

### Sincronização em lote
11. Admin altera manualmente um produto no Tiny (sem esperar o cron).
12. No painel Fullgas, seleciona esse produto na lista de "Produtos Tiny" e
    clica "Sincronizar selecionados".
13. O produto atualiza imediatamente com os dados do Tiny.
14. Testar também "Sincronizar todos" com o catálogo inteiro — confirma que
    todos os produtos com `TinyAtivo = 1` são atualizados, e o resumo final
    mostra a contagem correta de sucesso/erro.

---

## Fora do escopo desta implementação

- **Criação automática de produto**: a sincronização (agendada ou manual) só
  atualiza produtos **já importados** (`TinyAtivo = 1`). Produtos novos no
  Tiny precisam ser importados manualmente pelo admin via tela de importação.
- **Sincronização de categorias**: as categorias do Tiny não mapeiam para as
  categorias do Fullgas. O admin define a categoria do Fullgas na hora de importar.
- **Variações/grades**: produtos com variação no Tiny (ex.: tamanho P/M/G)
  entram como produtos simples no Fullgas. Suporte a variações pode entrar
  como melhoria futura.
- **Escrita no Tiny**: o Fullgas nunca altera dados no Tiny.
  Pedidos feitos no Fullgas não são enviados pro Tiny (fase futura, se necessário).
- **Edição manual de produtos Tiny no Fullgas**: removida por decisão de
  negócio. Se precisar reintroduzir no futuro, é o sistema de "override por
  campo" que havia numa versão anterior deste documento.
