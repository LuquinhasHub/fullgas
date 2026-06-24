# Roadmap de Expansão — Fullgas B2B

> **Audiência deste documento**: Claude Code, executando na raiz do monorepo
> `fullgas-monorepo/`. Cada seção descreve uma frente de trabalho com
> critérios de aceitação verificáveis. As frentes estão em ordem de
> dependência — execute-as nesta ordem.

## Estado atual (não construir de novo, já existe)

- Fundação rodando localmente: front em `:5500`, API em `:3000`, SQL Server local
  com banco `FullgasB2B` populado pelos seeds (exceto usuários).
- Autenticação JWT funcional: login, cadastro (entra como pendente), guards de
  `requireAuth` e `requireAdmin` em `api/src/auth.js`.
- Endpoints prontos: `auth/login`, `auth/register`, `categorias`, `produtos`
  (GET lista, GET por SKU, POST/PUT/DELETE admin).
- Adapter do front (`frontend/js/api-adapter.js`) substitui o miolo do `FG` por
  chamadas à API; cache em memória carregado no login mantém as telas síncronas.
- Tabela `ReivindicacaoAnexo` já existe (migração 001 aplicada).

**O sintoma que motivou este roadmap**: pedidos, veículos, reivindicações,
finder, faturas e dashboard ainda não puxam do banco — usam o cache vazio.
A frente 1 fecha essa lacuna.

---

## Princípios que valem para todas as frentes

1. **Migração por mudança de schema**: toda alteração de tabela vira um arquivo
   novo numerado em `database/migrations/` (002, 003…). Cada migração é
   idempotente (`IF NOT EXISTS`, `IF COL_LENGTH ... IS NULL`). Nunca edite o
   `fullgas_schema_sqlserver.sql` depois de aplicado.
2. **Rotas por área**: um arquivo por área em `api/src/routes/` seguindo o
   padrão de `produtos.routes.js`. Não inche um arquivo só.
3. **Consultas parametrizadas** com `query('... @nome', { nome: valor })`.
   Nunca concatene strings em SQL.
4. **Snapshots em pedidos**: ao criar `PedidoItem`, copie `Sku`, `NomeProduto`
   e `PrecoUnitario` no momento da compra. Não dependa de JOIN com `Produto`
   para exibir o histórico — produtos mudam de preço/nome.
5. **Identidade visual própria**: quando uma frente cita inspiração em sistemas
   comerciais (Magento, DealerNet), use as referências apenas para entender
   *funcionalidade e fluxo*. Mantenha a paleta e os componentes Fullgas já
   existentes em `frontend/css/`. Não copie elementos visuais, logos, nem nomes
   de telas de terceiros.
6. **Adapter como ponte**: ao expor endpoint novo na API, adicione no
   `api-adapter.js` a função correspondente do `FG` (substituindo a versão do
   `store.js`). As telas (`portal.js`, `shop.js`, etc.) não precisam mudar se a
   forma do dado retornado bater com o que o `store.js` originalmente devolvia.
7. **Validação contínua**: depois de cada feature, rodar `npm start` (API),
   abrir o front no Live Server, executar o fluxo manualmente. Não confie só em
   tipos — execute.
8. **Commits granulares**: um commit por feature concluída e testada, mensagem
   no formato `feat(area): descrição curta` ou `fix(area): descrição`.

---

# FRENTE 1 — Endpoints faltantes (destrava todas as telas)

**Por que primeiro**: o adapter atual só puxa produtos e categorias. Todas as
outras telas do portal exibem dados em cache vazio. Esta frente faz cada área
do front passar a ler do banco real.

## 1.1 Pedidos ✅ CONCLUÍDO

> Entregue no branch `feat/pedidos`. Além do escopo original, inclui
> cancelamento com devolução de estoque e estorno de fatura/entrega,
> pré-venda/backorder com envio segmentado/parcial (ver
> `docs/06-pre-venda-backorder.md`) e tela de detalhe do pedido.

**Rotas a criar** em `api/src/routes/pedidos.routes.js`:

| Método | Caminho | Quem acessa | O que faz |
|---|---|---|---|
| GET | `/api/pedidos` | autenticado | lista pedidos do usuário/empresa; admin vê todos |
| GET | `/api/pedidos/:numero` | autenticado | detalhe + itens |
| POST | `/api/pedidos` | autenticado | cria pedido a partir da cesta |
| PUT | `/api/pedidos/:numero/status` | admin | muda status |

**Comportamento crítico no POST**:
- Receber `{ itens: [{ sku, quantidade }] }` e gerar `NumeroPedido` único
  no formato `'0005' + 6 dígitos sequenciais` e `CodigoCx` no formato
  `'CX' + AAMMDD + 7 dígitos` (espelha o que o `store.js` faz hoje na função
  `createOrder`).
- Para cada item, ler `Produto` (preço/nome/estoque atuais), gravar snapshot
  em `PedidoItem`, decrementar estoque com `UPDATE ... WHERE Estoque >= @qtd`
  (rejeita o pedido inteiro com 409 se algum item ficar negativo).
- Tudo dentro de **transação** (`sql.Transaction`). Falha em qualquer linha
  faz rollback.

**Comportamento do PUT status**:
- Quando mudar para `'Enviado'`, gerar automaticamente uma `Entrega` e uma
  `Fatura` ligadas ao pedido (mesma lógica do `setOrderStatus` no `store.js`).

**Adapter (`api-adapter.js`)**: substituir `FG.createOrder`, `FG.setOrderStatus`
e recarregar `CACHE.orders` ao final. Adicionar `recarregarPedidos()`.

**Critério de aceitação**:
- Logar como cliente, adicionar 2 itens na cesta, finalizar pedido — aparece
  em "Pedidos" no portal e em "Order History" na loja, com número e CX.
- Estoque do produto diminuiu no banco.
- Admin muda o pedido para "Enviado" no painel — aparece uma `Entrega` nova
  com número e uma `Fatura` no `Conta financeira` do cliente.

## 1.2 Veículos (motos no estoque) ✅ CONCLUÍDO

> Entregue no branch `feat/veiculos`. Além do escopo original, a venda captura
> dados detalhados do cliente (CPF, e-mail, telefone e endereço) por um
> formulário em modal estilizado, persistidos via migração
> `005_dados_cliente_veiculo.sql`. Inclui ainda `GET /api/veiculos/modelos`
> para alimentar `FG.model` no front.

**Rotas em `api/src/routes/veiculos.routes.js`**:

| Método | Caminho | Acesso | O que faz |
|---|---|---|---|
| GET | `/api/veiculos` | autenticado | lista da empresa do usuário; admin vê todos |
| GET | `/api/veiculos/:niv` | autenticado | detalhe pelo NIV |
| GET | `/api/veiculos/modelos` | autenticado | lista de modelos (alimenta `FG.model`) |
| POST | `/api/veiculos/:niv/venda` | autenticado | registra venda (recebe `{ cliente, cpf, email, telefone, endereco }`) |
| POST | `/api/veiculos/:niv/garantia` | autenticado | ativa garantia |

**Detalhes**:
- A venda muda `Status='Vendido'`, grava `VendaData`, `VendaCliente` e os dados
  do cliente (`ClienteCpf`, `ClienteEmail`, `ClienteTelefone`, `ClienteEndereco`),
  e ativa `GarantiaAtivaEm` se ainda for NULL. Valida e-mail e CPF (11 dígitos)
  quando informados; só aceita veículo `Disponível`.
- Adapter substitui as funções que o `portal.js` usa hoje em "Ações do veículo"
  e "Estoque do revendedor".

**Critério de aceitação**: as duas telas ("Ações" e "Estoque") mostram os 10
veículos dos seeds. Buscar por NIV `VBFGA125XSM160872` retorna o detalhe.
Registrar venda atualiza o status no banco e na tela.

## 1.3 Reivindicações (versão básica — fotos vêm na Frente 2)

**Rotas em `api/src/routes/reivindicacoes.routes.js`**:

| Método | Caminho | Acesso | O que faz |
|---|---|---|---|
| GET | `/api/reivindicacoes` | autenticado | lista (filtro `?status=`) |
| GET | `/api/reivindicacoes/:numero` | autenticado | detalhe |
| POST | `/api/reivindicacoes` | autenticado | cria |
| PUT | `/api/reivindicacoes/:numero/status` | admin | muda status |

**Detalhes**:
- Cliente só vê as próprias (filtrar por `EmpresaId`); admin vê todas.
- Gerar `Numero` único de 8 dígitos.

**Critério de aceitação**: criar uma reivindicação como cliente, vê-la na lista
"Em processo". Como admin, mover para "Aprovada" — aparece em "Arquivo" no
filtro do cliente.

## 1.4 Parts Finder

**Rotas em `api/src/routes/finder.routes.js`**:

| Método | Caminho | Acesso | O que faz |
|---|---|---|---|
| GET | `/api/finder/modelos` | autenticado | lista modelos com árvore |
| GET | `/api/finder/modelos/:codigo` | autenticado | modelo + seções (chassi e engine) |
| GET | `/api/finder/secoes/:secaoId/pecas` | autenticado | peças de uma seção |
| GET | `/api/finder/vin/:niv` | autenticado | resolve VIN para modelo |

**Detalhes**:
- O retorno do modelo precisa incluir as seções já agrupadas por lado
  (`chassi: [...]`, `engine: [...]`), no mesmo formato que o `finder.js`
  espera hoje no `FG.model()`.
- A peça referencia o SKU do produto para o link funcionar para a loja.

**Critério de aceitação**: abrir o Parts Finder, selecionar `FG 125 2025` na
árvore, ver as 11 seções do chassi, clicar em uma e ver as peças com link
funcional para a página do artigo na loja.

## 1.5 Faturas, Entregas, Notificações, Usuários (admin), Dashboard

**Rotas a expor** (resumo — sem detalhar quadro, padrão igual aos anteriores):

- `GET /api/faturas` — lista da empresa do usuário; admin vê todas.
- `GET /api/entregas` — idem.
- `GET /api/notificacoes` + `PUT /api/notificacoes/:id/lida`.
- `GET /api/usuarios` (admin) + `PUT /api/usuarios/:id` (admin) para aprovar,
  promover, bloquear.
- `GET /api/dashboard` (admin) — agrega vendas dos últimos 7 dias, ticket médio,
  últimos pedidos, mais vendidos, últimas buscas. Devolve tudo em um JSON único
  para a tela renderizar sem fazer várias chamadas.
- `GET /api/busca?q=termo` — busca global usada pela barra do topo.
- `POST /api/log-busca` — alimenta `LogBusca` (chamada interna do front).

**Critério de aceitação da Frente 1 inteira**:
- Login limpo (sem nada em localStorage) e abrir cada aba do portal — todas
  mostram dados do banco, nenhuma fica vazia ou com placeholder.
- Painel admin mostra os números reais nos KPIs e gráficos.
- A barra de busca do topo retorna resultados de produtos, veículos e modelos.

---

# FRENTE 2 — Reivindicações expandidas com fotos

**Por que aqui**: terreno do banco já preparado pela migração 001. Esta frente
ativa o recurso de ponta a ponta.

## 2.1 Armazenamento de arquivos

Decisão de design: para desenvolvimento local, salvar fotos em
`api/uploads/reivindicacoes/<id>/<arquivo>` (pasta já no `.gitignore`). Em
produção, trocar para Azure Blob Storage — abstrair a função `salvarArquivo()`
para que o "onde guardar" seja a única coisa que mude.

**Tarefas**:
- Adicionar pacote `multer` no `api/package.json`.
- Criar `api/src/storage.js` exportando `salvarArquivo(buffer, mime, prefixo)`
  e `removerArquivo(url)`. Implementação local primeiro; a função aceita as
  duas no mesmo formato (retorna URL ou caminho público).
- Servir estaticamente `api/uploads/` em `server.js` com
  `app.use('/uploads', express.static('uploads'))` para o front carregar as
  imagens via `<img src="...">`.

## 2.2 API de anexos

**Rotas em `reivindicacoes.routes.js`** (estende a Frente 1):

| Método | Caminho | Acesso | O que faz |
|---|---|---|---|
| POST | `/api/reivindicacoes/:numero/anexos` | autenticado | upload de imagem |
| GET | `/api/reivindicacoes/:numero/anexos` | autenticado | lista anexos |
| DELETE | `/api/reivindicacoes/:numero/anexos/:id` | dono ou admin | remove |

**Regras**:
- Aceitar apenas `image/jpeg`, `image/png`, `image/webp`. Limite 5 MB por arquivo,
  até 10 arquivos por reivindicação.
- O dono da reivindicação só pode anexar/remover em reivindicações próprias.
- Gravar `NomeArquivo` (original), `TipoConteudo`, `TamanhoBytes`, `Url`,
  `EnviadoPor` (UsuarioId) em `ReivindicacaoAnexo`.

## 2.3 Campos expandidos da reivindicação

A migração 001 já adicionou `NumeroPeca`, `DataDefeito`, `Horimetro` na
`Reivindicacao`. Tarefa: incluí-los no formulário de criação e no detalhe.

**Formulário de criação (no `portal.js`, seção Reivindicações)**:
- Tipo, NIV do veículo (já existe).
- Adicionar: número da peça (SKU, autocompletar com lista de produtos),
  data do defeito, horímetro, descrição detalhada, upload de fotos
  (múltiplos arquivos, com preview antes de enviar).
- Remover do menu de criação a opção **"Criar remoção de armazém"** (item 2.1
  do seu pedido). Manter "Criar reiv. RMA" e "Criar reiv. varejo".

**Detalhe da reivindicação**:
- Tela nova (ou modal) acessível ao clicar numa linha da lista. Mostra todos
  os campos + galeria de fotos clicáveis (lightbox simples).

## 2.4 Visão admin das reivindicações

No painel admin, área de reivindicações:
- Lista com filtros por status, tipo e empresa.
- Detalhe com as fotos enviadas pelo cliente e campo de "Resposta do analista".
- Mudança de status já existente, mantida.

**Critério de aceitação da Frente 2**:
- Cliente cria reivindicação anexando 3 fotos. Vê as 3 miniaturas no detalhe.
- Admin abre a reivindicação no painel, vê as 3 fotos em tamanho maior,
  responde e aprova.
- Tentar enviar PDF: rejeitado. Tentar enviar 11ª foto: rejeitado.

---

# FRENTE 3 — Catálogo gerenciado pelo painel + fotos nos produtos

## 3.1 Campos de imagem no produto

**Migração 002** (`002_fotos_produto.sql`): adicionar à `dbo.Produto`:
- `ImagemPrincipal NVARCHAR(1000) NULL` (URL).
- Tabela `dbo.ProdutoImagem` (`ProdutoImagemId`, `ProdutoId` FK,
  `Url NVARCHAR(1000)`, `Ordem INT`) para galerias.

## 3.2 Upload de imagens no painel admin

- Estender `produtos.routes.js` com `POST /api/produtos/:sku/imagens` e
  `DELETE /api/produtos/:sku/imagens/:id` (admin).
- Reaproveitar `storage.js` da Frente 2.

## 3.3 UI de gestão

No `admin.js`, seção Catálogo:
- Tela atual de listagem mantida; modal de edição ganha aba "Imagens" com
  dropzone, ordem das imagens por arrastar e marcar uma como principal.
- Listagem mostra miniatura da imagem principal na coluna inicial.

No `shop.js`:
- Substituir o placeholder atual (`prodImg()` que usa `bikeSVG` e ícones de
  categoria) pelo `<img src={produto.imagemPrincipal}>`. Manter o fallback
  do ícone quando o produto não tiver imagem cadastrada.

**Critério de aceitação**: admin cadastra 3 fotos num produto. Cliente abre a
página do produto e vê a galeria. Lista de produtos mostra a miniatura.

---

# FRENTE 4 — Cadastro de motos no estoque + transferência entre concessionárias

## 4.1 Cadastro

No painel admin (e também acessível ao usuário admin de uma concessionária):
- Tela "Estoque de motos" com botão "Adicionar moto".
- Formulário: NIV (chassi), modelo (select), cor, número do motor, entrada
  no estoque, empresa que detém o veículo.

**Rotas a adicionar em `veiculos.routes.js`**:
- `POST /api/veiculos` — cria veículo (admin).
- `PUT /api/veiculos/:niv` — atualiza dados (admin).

## 4.2 Transferência entre concessionárias

**Migração 003** (`003_transferencia_veiculo.sql`): tabela
`dbo.TransferenciaVeiculo` com `TransferenciaId`, `VeiculoId` FK,
`EmpresaOrigemId` FK, `EmpresaDestinoId` FK, `Status` (Solicitada, Aprovada,
Recusada, Concluída), `SolicitadoPor` FK, `Motivo NVARCHAR(500)`, `CriadoEm`,
`AtualizadoEm`.

**Rotas**:
- `POST /api/veiculos/:niv/transferir` — solicita transferência.
- `GET /api/transferencias` — lista (própria empresa origem/destino, ou admin).
- `PUT /api/transferencias/:id/decisao` — aprovar/recusar (admin destino).
- A aprovação muda `Veiculo.EmpresaId` para a de destino dentro de transação.

**Critério de aceitação**: empresa A solicita transferência do NIV X para
empresa B. Admin da B aprova. NIV X aparece no estoque da B e some do da A.
Histórico de transferências fica registrado.

## 4.3 Registro simplificado de venda

Você pediu campos mínimos: chassi, concessionária, dados do cliente, data
da venda. Já temos quase tudo — adicionar apenas:
- Campo "Dados do cliente" como objeto opcional (`ClienteCpf VARCHAR(14)`,
  `ClienteEmail NVARCHAR(160)`, `ClienteTelefone VARCHAR(30)`) na tabela
  `Veiculo`, via migração 004.
- Atualizar `POST /api/veiculos/:niv/venda` para receber esses campos.

---

# FRENTE 5 — Produtos agrupados

**O que é (em termos genéricos)**: um produto-pai que agrega vários
produtos-filhos relacionados, exibidos juntos numa única página com seleção
de variante (cor, tamanho, configuração). É um padrão comum de e-commerce.

## 5.1 Schema

**Migração 005**: tabela `dbo.ProdutoGrupo` (`GrupoId`, `Nome`, `Descricao`,
`ImagemPrincipal`) e tabela de junção `dbo.ProdutoGrupoItem` (`GrupoId` FK,
`ProdutoId` FK, `Ordem`, `Rotulo NVARCHAR(80)` — o rótulo exibido para a
variante, ex.: "Cor preta", "Tamanho G").

## 5.2 API

- `GET /api/grupos` — lista grupos com produtos.
- `GET /api/grupos/:id` — detalhe com produtos-filhos.
- CRUD admin para criar grupos e adicionar produtos.

## 5.3 UI

- Página de grupo na loja mostra imagem do grupo, descrição, e tabela com os
  produtos-filhos (rótulo, preço, estoque, botão de adicionar à cesta).
- Painel admin permite criar grupo, escolher produtos existentes, definir
  ordem e rótulo.

**Observação importante**: implementação própria. Use o conceito de "produto
agrupado" como entendido genericamente em e-commerce, não replique elementos
visuais ou nomenclaturas de plataformas específicas. Componentes seguem a
identidade visual já presente em `frontend/css/`.

---

# FRENTE 6 — Painel financeiro separado

## 6.1 Novo papel de usuário

**Migração 006**: alterar o `CHECK` constraint de `Usuario.Papel` para aceitar
o valor `'financeiro'` além de `'admin'` e `'cliente'`.

```sql
ALTER TABLE dbo.Usuario DROP CONSTRAINT CK_Usuario_Papel;
ALTER TABLE dbo.Usuario ADD CONSTRAINT CK_Usuario_Papel
  CHECK (Papel IN ('admin','cliente','financeiro'));
```

## 6.2 Novo guard na API

Em `api/src/auth.js`, adicionar `requireFinanceiroOrAdmin`. Endpoints
financeiros aceitam ambos.

## 6.3 Tela própria

- `frontend/financeiro.html` (espelha estrutura de `admin.html` com paleta
  própria, mas reusando `styles.css`).
- `frontend/js/financeiro.js` com rotas: dashboard de recebíveis, lista de
  todos os pedidos da plataforma com filtros (período, empresa, status),
  faturas pendentes, exportação CSV.
- Sem acesso a usuários, catálogo ou reivindicações.

**Critério de aceitação**: criar usuário com `Papel='financeiro'`, fazer login
— é redirecionado para `financeiro.html` (não para `portal.html`). Não consegue
acessar `admin.html` (guard rejeita).

---

# Apêndice: fase futura — Boletos e NF-e

**Não executar antes de uma reunião de decisão.** São integrações com terceiros
que envolvem custos, ambiente de homologação e impactos fiscais.

Pontos a decidir antes de começar:

- **Gateway de boleto**: Asaas, Pagar.me, Iugu? Cada um tem taxas e fluxo
  diferente. Comece sempre em ambiente de **sandbox**.
- **NF-e**: contratar serviço (Focus NFe, NFe.io, eNotas) ou integrar direto
  com SEFAZ? Direto é muito mais complexo; recomenda-se o serviço.
- **Certificado digital A1** da empresa — pré-requisito para qualquer emissão
  de NF-e.
- **Regime tributário** da Fullgas — define quais campos a nota precisa carregar.
- Discussão com contador antes de implementar — emissão errada gera passivo
  fiscal real.

Quando essas decisões existirem, abrir uma nova frente neste documento.

---

# Como o Claude Code deve trabalhar daqui

1. Leia este arquivo, leia `docs/03-arquitetura-e-expansao.md` e a estrutura
   do projeto antes de começar.
2. Comece pela **Frente 1**, sub-item **1.1** (Pedidos). Execute na ordem do
   documento. Não pule.
3. Para cada sub-item:
   - Crie branch `feat/<area>` (ex.: `feat/pedidos`).
   - Implemente.
   - Teste manualmente o critério de aceitação.
   - Commit, merge no main, próximo sub-item.
4. Pergunte ao usuário quando tiver dúvida sobre comportamento esperado — não
   adivinhe regras de negócio.
5. Ao terminar cada Frente, marque-a como concluída neste documento e peça
   confirmação antes de seguir para a próxima.
