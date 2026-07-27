# API em camadas (Rota → Controller → Service → Repository)

Este documento descreve o padrão de organização **recomendado** para a API e
como migrar as rotas atuais para ele, uma de cada vez, sem parar o site.

Complementa o `03-arquitetura-e-expansao.md` (visão geral do projeto). A primeira
fatia migrada — o catálogo (`produtos.routes.js`) — serve de modelo vivo.

## Por que camadas (e não "MVC" ao pé da letra)

MVC clássico assume que o servidor renderiza telas (a "View"). A nossa API **não
renderiza nada** — ela devolve JSON, e a View de fato é o front. Então o padrão
idiomático para Node/Express + banco é **arquitetura em camadas**, o "MVC
traduzido para API":

| Camada | Responsabilidade | O que ela **não** faz |
|---|---|---|
| **Route** (`routes/`) | O fio HTTP: caminho + middlewares + qual controller chamar | Nenhuma regra, nenhum SQL |
| **Controller** (`controllers/`) | Lê `req`, chama o service, monta a resposta (status + DTO) | Não tem regra de negócio nem SQL |
| **Service** (`services/`) | **Regra de negócio**: validações, decisões, orquestração | Não conhece `req`/`res` nem escreve SQL |
| **Repository** (`repositories/`) | **Único** lugar com SQL/`mssql`. Entra e sai dado cru | Não decide regra; não conhece HTTP |

Regra de ouro: **cada camada só conhece a de baixo.** Uma rota nunca toca SQL;
um repositório nunca sabe o que é `req`. Assim a regra fica testável isolada e o
SQL fica trocável num lugar só.

Apoio:
- `middlewares/` — auth, gates de área, upload (multer).
- `lib/` — utilitários transversais. `lib/errors.js` define o `AppError`.

## O fluxo de erro

Services lançam `AppError` (de `lib/errors.js`) quando uma regra é violada:

```js
import { erroValidacao, naoEncontrado, conflito } from '../lib/errors.js';
if (!nome) throw erroValidacao('Informe o nome da categoria.');
```

O controller só faz `catch (e) { next(e); }`. O **tratador central** em
`server.js` reconhece a marca `publica` do `AppError` e responde com o status e a
mensagem certos; qualquer outro erro vira `500` genérico, sem vazar detalhe
interno. Ou seja: o controller não precisa mais espalhar `res.status(400)…`.

## O modelo: catálogo

```
routes/produtos.routes.js         ← fininha: 7 produtos + 4 categorias, só wiring
controllers/produto.controller.js ← DTO toProduto() + urlAbs() (dependem do host)
controllers/categoria.controller.js
services/produto.service.js        ← regra: campo espelhado do Tiny, imagem, etc.
services/categoria.service.js      ← regra: slug único, máx. 2 níveis, apagar vazia
repositories/produto.repository.js ← todo o SQL de Produto
repositories/categoria.repository.js
middlewares/upload-produto.js      ← multer isolado
```

O **contrato público não mudou**: mesmas URLs, mesmos corpos, mesmas respostas.
O front (`store.js`/`api-adapter.js`) não foi tocado.

## Como migrar a próxima rota (estrangulamento)

Faça **uma rota por vez**, mantendo o contrato idêntico:

1. Crie o `repository`: mova cada `query(...)` da rota para funções nomeadas.
2. Crie o `service`: mova as validações e decisões; troque `res.status(4xx)` por
   `throw erroValidacao(...)`/`naoEncontrado(...)`/`conflito(...)`.
3. Crie o `controller`: só lê `req`, chama o service, envia a resposta.
4. Deixe a `route` só com `router.<verbo>(caminho, ...middlewares, controller.x)`.
5. Teste a rota (mesma entrada → mesma saída) e suba. O resto do sistema não vê
   diferença.

Ordem sugerida por valor/risco: `veiculos` → `notificacoes` → `faturas` →
`conta` → `reivindicacoes` → `pedidos` (deixe pedidos por último: é o de maior
regra e maior risco).

## Dívidas conhecidas desta fatia

- `produto.service.js` importa `apagarUpload` de `routes/finder.routes.js`. É o
  mesmo acoplamento que já existia antes; quando o finder for migrado, esse
  helper deve descer para `lib/uploads.js` e os dois passam a importar de lá.
