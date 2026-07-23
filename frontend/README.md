# FULLGAS B2B — Frontend

Site B2B em **HTML + CSS + JavaScript puro** (sem build, sem dependências de
runtime), que consome a API em `../api`. Servido estático em produção pelo Nginx.

> Visão geral do produto, arquitetura e deploy: veja o **README na raiz** do
> repositório.

## Como rodar (desenvolvimento)

O frontend precisa da **API no ar** (`../api`, porta 3000) e de um servidor HTTP
estático — não abra por `file://`, o navegador bloqueia as requisições.

```bash
# dentro da pasta frontend/
npx serve .
# ou
python -m http.server 8000
```

Depois acesse `http://localhost:8000`. Para qual API o front aponta é decidido em
`js/config.js` (localhost/LAN → API no mesmo host:3000; domínio público → `/api`
relativo, atrás do Nginx).

## Mapa do site

| Arquivo | O que é |
|---|---|
| `index.html` | Login, cadastro (com aprovação) e recuperação de senha |
| `redefinir.html` | Criação de nova senha a partir do link enviado por e-mail |
| `portal.html` | FullgasNet: home, notificações, reivindicações, pedidos, ações do veículo, estoque do revendedor, conta financeira (faturas + PDF) |
| `loja.html` | Dealer Shop: categorias/subcategorias, listagem, filtros, página de produto, Quick Order, cesta e histórico |
| `finder.html` | Parts Finder: busca por VIN, árvore de modelos, seções por diagrama, peças com link para a loja |
| `admin.html` | Painel administrativo: dashboard, catálogo, pedidos (envio por peça), chassis, clientes, reivindicações, notificações e integração Tiny |

Apoio: `js/config.js` (ambiente), `js/store.js` (utilidades + cache),
`js/api-adapter.js` (**ponte com a API**), `js/auth.js`, `js/portal.js`,
`js/shop.js`, `js/finder.js`, `js/admin.js`, `js/redefinir.js`; `css/styles.css`,
`css/admin.css`; `img/` (logo e favicon); `js/vendor/` (html2pdf).

## Observações técnicas

- **Os dados vêm da API**, não do navegador. O `js/api-adapter.js` sobrescreve a
  camada `FG` e carrega tudo por `fetch` num cache em memória; as telas leem desse
  cache de forma síncrona.
- Cache-busting por `?v=AAAAMMDD` nos `<script>`/`<link>` — suba a versão ao
  publicar alterações de JS/CSS.
- Identidade visual própria **FULLGAS** (wordmark + badge "F").
- Sem dependências externas de runtime; compatível com navegadores modernos.
