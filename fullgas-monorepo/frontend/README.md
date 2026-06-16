# FULLGAS B2B — Portal do Concessionário

Site B2B completo em **HTML + CSS + JavaScript puro** (sem build, sem dependências), com dados de demonstração persistidos em `localStorage`.

## Como rodar

Opção 1 — abrir direto: dê dois cliques em `index.html`.

Opção 2 — servidor local (recomendado se o navegador bloquear `localStorage` em `file://`):

```bash
# dentro da pasta do projeto
npx serve .
# ou
python -m http.server 8000
```

Depois acesse `http://localhost:8000` (ou a porta indicada).

## Acessos de demonstração

| Perfil | E-mail | Senha |
|---|---|---|
| Administrador | `admin@fullgas.com.br` | `admin123` |
| Cliente aprovado | `cliente@exemplo.com` | `cliente123` |
| Cadastro pendente (teste de aprovação) | `maria@silvaracing.com` | `maria123` |

Novos cadastros entram com papel **cliente** e status **pendente** — só conseguem entrar depois que um administrador aprovar em *Administração de usuários*.

## Mapa do site

| Arquivo | O que é |
|---|---|
| `index.html` | Login e cadastro com aprovação |
| `portal.html` | FullgasNet: home (banner de notificações críticas, estoque de veículos, resumo de reivindicações), Notificações, Reivindicações (Em processo / Esboço / Arquivo + criação RMA/varejo/remoção), Pedidos (cestas, ordens, entregas), Ações do veículo (busca por NIV, registrar venda, ativar garantia), Estoque do revendedor, Conta financeira (faturas com "PDF" imprimível e exportação CSV) e busca global |
| `loja.html` | Dealer Shop: grade de categorias, listagem com sidebar, filtro "somente disponíveis", filtro por moto, paginação, página de produto, Quick Order, cesta com envio de pedido, Order History e Delivery History |
| `finder.html` | SparePartsFinder: busca por VIN/nº de motor, árvore de modelos, divisão **Frame (chassi) / Engine (motor)**, miniaturas por seção, tabela de peças com link direto para a página do artigo na loja, comentários/quantidades, envio das peças selecionadas para a cesta e diagrama ilustrativo |
| `admin.html` | Painel administrativo (inspirado em Magento 2): dashboard com vendas, ticket médio, gráfico de pedidos (7 dias), últimos pedidos, últimas buscas e mais vendidos; administração de usuários (aprovar, promover a admin, bloquear); catálogo (criar/editar/excluir produtos); gestão de pedidos (mudança de status — "Enviado" gera entrega + fatura automaticamente); gestão de reivindicações |

Estrutura de apoio: `js/store.js` (camada de dados + seeds), `js/auth.js`, `js/portal.js`, `js/shop.js`, `js/finder.js`, `js/admin.js`, `css/styles.css`, `css/admin.css`.

## Observações técnicas

- **Demo front-end**: todos os dados (usuários, produtos, pedidos, reivindicações…) vivem no `localStorage` do navegador. Para zerar, limpe os dados do site ou rode `FG.reset()` no console.
- A camada `FG` em `js/store.js` concentra toda a leitura/escrita — é o ponto único a trocar quando você plugar um backend real (API REST, etc.).
- Identidade visual própria **FULLGAS** (wordmark + badge "F"); nenhum logotipo ou material de terceiros é utilizado.
- Compatível com navegadores modernos; sem dependências externas, funciona offline.
