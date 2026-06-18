# Mudanças Visuais e Funcionais — Lote 1

> **Audiência**: Claude Code, executando na raiz do monorepo.
> Aplicar **depois** que a Frente 1 do `04-roadmap.md` estiver concluída
> (precisamos dos endpoints de pedidos e faturas funcionando antes).
> Cada item é independente; podem ser commits separados.

---

## Item 1 — Modelo de PDF para faturas

**O que existe hoje**: na aba "Conta financeira" do portal, o botão "PDF" abre
uma versão imprimível minimalista via `imprimirFatura()` em `portal.js` (linhas
~415-440). Ela monta um HTML simples no elemento `#print-area` e chama
`window.print()`.

**O que mudar**: substituir esse template por um modelo profissional inspirado
no layout-padrão de notas/faturas comerciais (campos no topo, tabela de itens,
totais embaixo). Mantenha a abordagem `window.print()` — é simples e funciona;
não introduza biblioteca de geração de PDF agora.

**Campos obrigatórios no PDF**:

- Cabeçalho: wordmark "FULLGAS" + texto "Portal B2B do Concessionário"
- Bloco "Fatura": número da fatura, número do pedido, data de emissão
- Bloco "Cliente": nome da empresa (RazaoSocial), nome do usuário comprador,
  e o endereço da empresa (logradouro, número, complemento, bairro, cidade/UF,
  CEP). Endereço vem da tabela `dbo.Endereco` com `Tipo='Cobranca'` e
  `Principal=1`, com fallback para `Tipo='Entrega'`/`Principal=1`.
- Tabela de itens do pedido: SKU, nome do produto, quantidade,
  preço unitário, subtotal (somente itens, sem mistura com totais).
- Bloco de totais: subtotal, total geral (sem impostos por enquanto — aparece
  no apêndice futuro de NF-e).
- Rodapé: data/hora de geração + texto "Documento demonstrativo. Não substitui
  nota fiscal."

**Como obter os dados**:
- Estender o endpoint `GET /api/faturas/:numero` para devolver: dados da
  fatura, dados do pedido vinculado (via `PedidoFatura`), itens do pedido
  (de `PedidoItem`), dados da empresa e endereço.
- No front, o clique no botão "PDF" busca esse endpoint, monta o HTML
  enriquecido em `#print-area` e chama `window.print()`.

**CSS de impressão**:
- Adicionar regras `@media print` em `frontend/css/styles.css` para esconder
  toda a UI exceto `#print-area`, remover sombras/cores de fundo, e usar
  preto sobre branco. A área tem largura fixa de 18cm para caber em A4.

**Critério de aceitação**:
- Clicar em "PDF" numa fatura abre o diálogo de impressão do navegador com a
  prévia do documento já formatado.
- Salvar como PDF pelo próprio navegador (Ctrl+P → "Salvar como PDF") gera
  um arquivo legível com todos os campos.

**Observação importante**: o documento gerado é demonstrativo. **Não confundir
com Nota Fiscal Eletrônica** — emissão de NF-e exige certificado digital,
integração com SEFAZ e serviço autorizado. Está no apêndice "fase futura" do
roadmap. O rodapé deixa isso claro.

---

## Item 2 — Botão "Voltar" mais acessível

**Contexto**: hoje, em várias telas do portal e da loja, o caminho de volta
está só nos breadcrumbs ou em links pequenos no menu. Usuário do dia a dia
quer botão grande e óbvio.

**Mudança**:
- Adicionar um botão flutuante "← Voltar" em todas as páginas internas do
  portal e da loja, posicionado **abaixo do menu superior, alinhado à
  esquerda**, antes do conteúdo da tela. Tamanho generoso (~36px altura),
  cor secundária da paleta (cinza escuro com borda), ícone de seta antes do
  texto.
- O botão usa `history.back()` quando há histórico de navegação na sessão,
  senão volta para `#home` no portal e para `#/` na loja (fallback seguro).
- Não aparecer em: tela de login, página inicial do portal (`#home`) e grade
  inicial da loja (`#/`) — nesses lugares não há "para onde voltar".

**Implementação sugerida**:
- Criar componente reutilizável: função `renderBotaoVoltar(destinoFallback)`
  em um arquivo novo `frontend/js/ui-comuns.js`.
- Chamar de cada tela na hora de montar o HTML, recebendo o fallback
  apropriado.

**Critério de aceitação**:
- Em qualquer tela interna do portal (notificações, reivindicações, pedidos,
  etc.) há um botão "← Voltar" visível e clicável no topo.
- Voltar funciona via histórico (mantém estado de filtros se aplicável).

---

## Item 3 — Paleta de cores nova: vermelho e preto

> **Sobre o logo enviado**: o arquivo de logo enviado pelo usuário tem
> semelhança visual significativa com a marca registrada de terceiros
> (rede varejista). Não aplicar esse logo no projeto. **Manter o
> wordmark tipográfico "FULLGAS" atual** (em `frontend/index.html` e
> demais arquivos onde aparece o badge "F + FULLGAS"). Esta seção trata
> apenas da paleta.

**O que mudar**:

A paleta atual já é majoritariamente vermelha (`--red: #d20a11`) com cinzas
neutros. A mudança é tornar **preto** um pilar visual junto com o vermelho,
substituindo cinzas neutros por preto puro ou quase puro em superfícies
de destaque.

**Variáveis CSS a ajustar** (em `frontend/css/styles.css`, dentro de
`:root`):

```css
--red: #c4030a;              /* vermelho um pouco mais profundo, melhor contraste com preto */
--red-dark: #8a0207;         /* novo: vermelho escuro para hover/active */
--black: #0d0d0d;            /* preto principal (não #000 puro, fica mais agradável) */
--black-soft: #1f1f1f;       /* preto suave para superfícies secundárias */
--ink: var(--black);         /* tinta de texto principal */
--paper: #ffffff;            /* fundo */
--bg-soft: #f5f5f5;          /* fundo de cards/superfícies */
--line: #e5e5e5;             /* divisórias */
```

**Onde aplicar preto em vez do cinza-neutro**:
- Topbar do portal (`.topbar`): fundo preto (`--black`), texto branco, badges
  vermelhas para notificações.
- Sidebar do admin (`.adm-side`): trocar `#373330` por `--black-soft`.
- Botões primários (`.btn.red`, `.btn-orange`): manter vermelho, mas o
  "secundário escuro" (hoje cinza) vira preto.
- Header da loja (`.shop-head`): manter vermelho, mas com detalhes pretos.

**Princípio**: vermelho continua sendo cor de ação (call-to-action, status
crítico, marca); preto vira a cor de superfície e tipografia forte; branco e
cinza muito claro são respiros. Evitar terceira cor de destaque (laranja, azul,
verde de status são exceções permitidas em contextos específicos: badge "ok"
verde, badge "erro" vermelha, etc.).

**Critério de aceitação**:
- Comparar a tela atual e a nova lado a lado: topbar e sidebar visivelmente
  pretos, vermelho preservado nos botões e elementos de ação.
- Nenhum texto fica com contraste insuficiente (testar com a aba "Inspetor"
  → "Acessibilidade" no Chrome).
- A identidade segue Fullgas; não vira "outra coisa".

---

## Item 4 — Detalhe expandido do pedido

**Contexto**: hoje, na aba "Pedidos" do portal, cada linha tem só um expandir
inline mostrando itens em texto cru (`portal.js` linha ~330). Você quer uma
**tela própria de detalhe** com toda a informação visual, similar ao que
sistemas comerciais B2B oferecem (referência: imagem 4 enviada, mostrando
linhas com indicador verde/cinza por item).

**Mudança**:

### 4.1 Backend

Estender `GET /api/pedidos/:numero` (criado na Frente 1) para incluir, além
do que já devolve:
- Lista de `PedidoItem` com **status por item**: `QuantidadePedida` (já existe
  como `Quantidade`) e novo campo `QuantidadeEnviada INT NOT NULL DEFAULT 0`.
- Dados de entrega vinculada (via `EntregaPedido`): número da entrega, data,
  rastreios.

### 4.2 Migração de schema

Criar `database/migrations/002_envio_parcial.sql`:

```sql
USE FullgasB2B;
GO

IF COL_LENGTH('dbo.PedidoItem', 'QuantidadeEnviada') IS NULL
    ALTER TABLE dbo.PedidoItem ADD QuantidadeEnviada INT NOT NULL
        CONSTRAINT DF_PedidoItem_QtdEnviada DEFAULT (0);
GO

/* Índice para consultar rapidamente itens não enviados de um pedido */
CREATE INDEX IX_PedidoItem_QtdEnviada
    ON dbo.PedidoItem (PedidoId)
    WHERE QuantidadeEnviada < Quantidade;
GO
```

E ajustar o `setOrderStatus`/`PUT status` para que ao mover para "Enviado"
sem especificação por item, marque `QuantidadeEnviada = Quantidade` em todos
(envio total). Para envio parcial, criar endpoint admin:
`PUT /api/pedidos/:numero/itens/:itemId/enviado { qtd }`.

### 4.3 Nova tela no front

- Rota nova no portal: `#pedido/:numero`.
- Renderizar página completa (não modal) com:
  - Cabeçalho: número do pedido, status (badge), barra de progresso
    "X% (Y de Z enviadas)" calculada como soma de `QuantidadeEnviada` /
    soma de `Quantidade`.
  - Tabela de itens com colunas: indicador circular (verde se totalmente
    enviado, amarelo se parcial, vermelho/cinza se não enviado), SKU, nome,
    quantidade pedida, quantidade enviada, preço unitário, subtotal.
  - Bloco lateral: dados de entrega (número, data, rastreios) se houver.
  - Botões no topo: "Voltar para Pedidos" (item 2 deste lote), "Ver PDF da
    fatura" (item 1 deste lote, se houver fatura vinculada).
- Lista de pedidos (rota `#pedidos`): cada linha vira clicável e leva para a
  nova tela. Manter o expandir-inline atual como atalho rápido.

### 4.4 Painel admin

Permitir ao admin alterar o `QuantidadeEnviada` de cada item na visão de
detalhe do pedido (input numérico ao lado de cada linha + botão "Salvar").
Útil para registrar envios parciais reais.

**Critério de aceitação**:
- Cliente cria pedido com 3 itens, fica "Pendente".
- Admin abre o detalhe no painel, marca 2 itens como totalmente enviados e
  1 com metade da quantidade. Status do pedido continua "Pendente" ou
  "Processando" (regra de negócio: status do pedido é manual, não derivado).
- Cliente abre a aba "Pedidos", clica no número, vai para `#pedido/:numero`.
  Vê barra de progresso "75%" (ou o cálculo correto), itens com bolinhas
  coloridas refletindo o estado, e quantidades pedidas vs. enviadas.
- Botão "Ver PDF" abre a fatura formatada (item 1).
- Botão "Voltar" leva de volta para a lista de pedidos (item 2).

---

## Ordem sugerida de execução

1. **Itens 2 e 3 primeiro** (visuais, baixo risco): botão Voltar + paleta nova.
   Commits independentes e fáceis de revisar.
2. **Item 1 depois**: PDF da fatura. Depende do endpoint de faturas da
   Frente 1, mas a parte do template é isolada.
3. **Item 4 por último**: é o maior; mexe em migração de schema, API e front
   de uma vez. Quebrar em sub-commits (migração, endpoint, tela do cliente,
   visão admin).

Como sempre: branch por item (`feat/pdf-fatura`, `feat/botao-voltar`,
`feat/paleta-preto-vermelho`, `feat/pedido-detalhe-expandido`), critério de
aceitação testado manualmente antes do merge.
