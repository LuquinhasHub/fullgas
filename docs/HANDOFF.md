# Handoff — estado do trabalho (Fullgas B2B)

> Documento de passagem de contexto entre sessões/máquinas. Atualizado em
> **2026-06-25**. Leia junto com `docs/04-roadmap.md` (plano oficial) e
> `docs/03-arquitetura-e-expansao.md`.

## Onde estamos

- Branch ativa: **`main`**. Tudo abaixo já está no `main` e **com push** para
  `origin/main`.
- Frente 1 do roadmap: **1.1, 1.2 e 1.3 concluídas**. Próximo passo natural:
  **Frente 1.4 — Parts Finder** (`api/src/routes/finder.routes.js`), depois 1.5.

## O que foi feito nesta leva (resumo por tema)

### Consolidação de branches
- Mergeadas no `main` e removidas: `feat/veiculos`, `fix/catalogo-fora-de-estoque`,
  `feat/vendas-detalhe`, `feat/fatura-pre-venda`, `feat/reivindicacoes`.
- Aba **Vendas** (admin): detalhe expansível do pedido (cliente, data, peças com
  status por peça) **com** os itens separados em "Em estoque" / "Pré-venda".
- Catálogo admin mostra "Fora de estoque" + previsão de chegada na listagem.

### Pré-venda = rastreador de envio (NÃO é cobrança)
- Cada pedido gera **1 fatura cheia** (Tipo `Fatura`, valor total = todas as
  peças, inclusive pré-venda). É o único documento financeiro. Envios geram só
  `Entrega` (sem fatura nova).
- A pré-venda é um **rastreador logístico** por cliente (sem valor): rota
  `GET /api/prevenda`, derivada de `PedidoItem.EmBackorder=1` pendente. Status
  por peça: `Aguardando` / `Disponivel` (botão admin "Marcar Enviado") / `Enviado`.
- Removido o modelo antigo de "Fatura PreVenda" (standby/ativa) e `prevenda.js`.
- **Migração 007** (`007_remove_fatura_pre_venda.sql`) reverte a 006: apaga
  faturas `Tipo='PreVenda'` residuais, remove colunas não usadas
  (`PedidoItem.PreVendaFaturaId`, `Fatura.Competencia`, `Fatura.AtualizadoEm`) e
  reverte os CHECKs de `Fatura.Tipo`/`Status` aos valores originais. Idempotente.

### Regras de estoque na loja
- Produto **"Em estoque"** (`Estoque > 0`): cliente só compra **até o estoque**
  disponível. API rejeita (409) acima disso; a loja limita os inputs e avisa.
- Produto **"Pré-venda"** (`Estoque <= 0` **com** previsão): comprável, vai p/
  backorder (inalterado).
- Produto **"Indisponível"** (`Estoque <= 0` **sem** previsão): **não pode ser
  comprado**. API rejeita (409); a loja desabilita o botão (grade e página),
  `FG.cartAdd` recusa, quick order ignora, carrinho bloqueia "Enviar pedido".
- Helpers novos no `store.js`: `FG.compravel(artigo)`, `FG.limiteCompra(artigo)`.

### Fix do rastreador de pré-venda
- "Disponível p/ envio" só quando `estoque >= pendente` (antes bastava
  `estoque > 0`). Aplicado na API e no portal do cliente; admin mostra
  "estoque X/Y" quando o estoque é parcial.

### Frente 1.3 — Reivindicações (básico)
- `api/src/routes/reivindicacoes.routes.js`: `GET /reivindicacoes` (filtro
  `?status=`), `GET /reivindicacoes/:numero`, `POST /reivindicacoes`,
  `PUT /reivindicacoes/:numero/status` (admin). Cliente vê só as da própria
  empresa (escopo por `EmpresaId` do token); admin vê todas. `Numero` único de
  8 dígitos.
- Adapter carrega `CACHE.claims` da API e substitui `FG.createClaim` /
  `FG.setClaimStatus` (antes só localStorage).
- Fotos e campos expandidos ficam para a **Frente 2**.

## Ao configurar a NOVA máquina

1. `git clone` (ou `git pull`) — traz código + `docs/` (roadmap, este handoff).
2. **Banco**: subir SQL Server local com `FullgasB2B`. Aplicar, em ordem, o
   schema + seeds + **todas as migrações** de `database/migrations/` (001 → 007),
   com auth admin e UTF-8:
   `sqlcmd -S localhost -E -C -f 65001 -i database/migrations/00X_*.sql`
   (todas idempotentes). Detalhes de permissão em `memory`/docs.
3. **API**: `cd api && npm install && npm start` (porta 3000).
4. **Front**: servir `frontend/` (Live Server :5500). Login demo:
   `demo@fullgas.com.br` / `demo123`; admin: `admin@fullgas.com.br` / `admin123`.

## Próximo passo sugerido

Frente **1.4 — Parts Finder**: criar `finder.routes.js` com
`GET /finder/modelos`, `/finder/modelos/:codigo`, `/finder/secoes/:secaoId/pecas`,
`/finder/vin/:niv`; ligar no adapter para `FG.model()` puxar do banco. Critério
de aceitação no `docs/04-roadmap.md` (seção 1.4).
