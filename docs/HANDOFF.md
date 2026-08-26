# Handoff — estado do trabalho (Fullgas B2B)

> Documento de passagem de contexto entre sessões/máquinas. Atualizado em
> **2026-08-26**. Leia junto com `docs/04-roadmap.md` (plano oficial) e
> `docs/03-arquitetura-e-expansao.md`.

### Garantia de pré-entrega (2026-08-26, `Separar_clientes_dos_admin`)

Furo fechado: a garantia por chassi exigia venda registrada (é a venda que
ativa a garantia), mas o defeito costuma aparecer ANTES — na inspeção de
pré-entrega, com a moto ainda no estoque. Não havia como reclamar.

- **Migração 034** — `CK_Reiv_Origem` passa a aceitar `preentrega` ao lado de
  `veiculo` e `varejo`. Origem (e não um Tipo novo) porque o que muda é o
  conjunto de REGRAS, que é o papel que Origem já cumpre.
- **Regras** (`resolverVeicPreEntrega`): chassi existe, **é da empresa que
  abre** (admin isento) e **não tem venda registrada**. Dispensa garantia
  ativa e não há prazo a verificar. Abrir a reivindicação **NÃO ativa** a
  garantia — o relógio dos 90 dias só começa na entrega ao consumidor.
- **Não é uma escolha na tela.** O formulário detecta o estado da moto pelo
  NIV: sem venda registrada, ele entra em modo pré-entrega sozinho (aviso
  explicativo, sem seletor de Tipo, sem horas/km, data vira "da inspeção").
  Registrada a venda, o mesmo formulário volta ao normal. No reenvio a origem
  vem do banco, nunca do corpo — senão daria para converter uma garantia
  comum em pré-entrega e contornar a regra.
- Pré-entrega aparece na sub-aba **Garantia de Veículo** (se comparasse a
  origem direto com a aba, sumiria das duas listas) e é rotulada como
  "Pré-entrega" no portal e no painel.
- Aprovada, gera pedido de garantia como qualquer outra (peça reposta sem
  cobrança).
- Testes: curl (aberta em moto de estoque; recusada em moto vendida; recusada
  para chassi de outra concessionária; garantia comum em moto não vendida
  continua recusada; garantia não ativada; aprovação gerando pedido) e o
  formulário em jsdom nos dois estados (25 verificações).

### Histórico do veículo (2026-08-26, `Separar_clientes_dos_admin`)

A tela **Ações do veículo** (portal, `#acoes/<NIV>`) ganhou o bloco
**Histórico do veículo**: a linha do tempo do chassi, dentro do mesmo cartão.

- **Migração 033** — `dbo.VeiculoHistorico`. FK (cascata) só para `Veiculo`;
  `UsuarioId`/`EmpresaId` entram SEM FK, com snapshot do nome: com FK, o
  `DELETE /api/usuarios/:id` passaria a falhar por causa de linhas de
  histórico. A coluna `Manual` separa o que o sistema gravou do que uma pessoa
  lançou. O backfill reconstruiu 50 eventos do que o banco já sabia (entrada
  em estoque, venda, garantia, reivindicações) — transferências antigas não
  dava para reconstruir, nunca foram gravadas.
- **Gravação automática** (`api/src/historico-veiculo.js`, `registrarEvento`):
  cadastro, atribuição, transferência, venda, garantia e o ciclo das
  reivindicações (aberta / aprovada / recusada / devolvida). A regra do módulo
  é não derrubar a ação que registra: falha ao gravar vira log, não erro 500.
- **Lançamento manual** (só admin): `POST /api/veiculos/:niv/historico` com
  `tipo` ∈ `recall | revisao | nota`, título, detalhe, referência e data (não
  aceita futuro). `DELETE .../historico/:id` só apaga lançamento manual —
  evento automático é o que de fato aconteceu e não sai.
- **Leitura**: `GET /api/veiculos/:niv/historico`, no mesmo escopo do veículo
  (o cliente só lê o histórico de um chassi que é dele).
- Testes: ciclo completo por curl (cada tipo de evento gerando entrada, mais
  403/404/409/400 das regras) e a tela em jsdom (27 verificações).

### Clientes × Administradores no painel (2026-08-26, `Separar_clientes_dos_admin`)

A aba única "Clientes" (`#usuarios`) listava as duas populações da tabela
`Usuario` misturadas. Agora são duas:

- **`#clientes`** — contas de concessionária (`Papel = 'cliente'`): conta
  principal (gestora, nasce no cadastro do site) e contas internas
  (sub-dealers). Mantém empresa, CNPJ, endereço expansível e o filtro por
  tipo de conta.
- **`#administradores`** — equipe Fullgas (`Papel = 'admin'`), com o botão
  **Adicionar administrador**.

`#usuarios` continua funcionando e cai em Clientes (favoritos antigos).

- **API**: `POST /api/usuarios` (admin) cria administrador — nasce
  `aprovado`, `Gestor = 1`, `Permissoes = NULL` e na **mesma empresa de quem
  cria** (a casa). Senha mínima de **8** caracteres, contra os 6 do cadastro
  de cliente: é a conta que enxerga todas as concessionárias.
- **Painel**: "Alterar identidade" some no modal de um administrador (a API
  já recusava assumir a identidade de outro admin); trocar o papel avisa que
  a conta muda de aba.
- Testes: rotas conferidas com curl (201/409/400/403/401 + login real da
  conta criada) e as duas telas renderizadas em jsdom (40 verificações).

## Onde estamos

- Branch ativa: **`main`**.
- Frente 1 do roadmap: **1.1, 1.2, 1.3 e 1.4 concluídas**. Próximo passo
  natural: **Frente 1.5** (faturas/entregas/notificações/usuários/dashboard).

### Frente 1.4 — Parts Finder 100% administrável (2026-07-03)

- **Migração 014** (`014_partsfinder_admin.sql`): `ModeloMoto` ganhou
  `Arvore`/`ImagemUrl`/`DocTecnicaUrl`; `Produto.ImagemUrl`;
  `SecaoModelo.ImagemUrl`; `PecaSecao` ganhou `NumeroImagem`,
  `QuantidadePadrao`, `Ordem`, `Ativo`; nova tabela `SecaoHotspot`
  (áreas clicáveis do diagrama, em pixels da imagem natural).
- **API** `api/src/routes/finder.routes.js`: leitura (modelos c/ árvore,
  modelo+seções por lado, seção c/ peças+hotspots+vizinhos, busca VIN/motor
  com log) e CRUD admin completo de modelos, seções, peças e hotspots
  (individual e em lote) + upload de imagens (modelo, diagrama). Produtos
  ganharam foto (`POST/DELETE /api/produtos/:sku/imagem`, campo `imagem` no
  GET). Referência completa: `docs/07-partsfinder.md`.
- **Cliente** (`finder.js` reescrito): árvore da API, busca por VIN/nº motor,
  diagrama com zoom 0.1–1.6, hotspots bidirecionais (área ⇔ linha da peça),
  quantidade padrão pré-marcada, cesta, Show Image e doc técnica.
- **Admin** (`admin.html#finder`): 3 níveis (modelos → seções → peças +
  editor visual de hotspots com clique-para-criar e arrastar). Foto da peça
  no modal de produto do Catálogo.
- Uploads em `api/uploads/finder/` e `api/uploads/produtos/` (troca/remoção
  apaga o arquivo antigo do disco).

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
