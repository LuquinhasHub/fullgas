# Arquitetura e como expandir o projeto

Este documento é o mapa do projeto. Leia antes de fazer mudanças grandes — ele
mostra onde cada coisa vive e qual o caminho para adicionar funcionalidades.

## Visão geral

```
┌─────────────┐     HTTP/JSON      ┌─────────────┐      SQL       ┌─────────────┐
│   frontend  │  ───────────────►  │     api     │  ───────────►  │  Azure SQL  │
│  (HTML/JS)  │  ◄───────────────  │  (Node.js)  │  ◄───────────  │  (banco)    │
└─────────────┘                    └─────────────┘                └─────────────┘
```

- **frontend/** — as telas. Não falam com o banco; só fazem `fetch` na API.
- **api/** — recebe as requisições, valida, conversa com o banco, devolve JSON.
- **database/** — os scripts SQL: schema, seeds e migrações.

## Estrutura de pastas

```
fullgas-monorepo/
├── frontend/
│   ├── *.html              telas (index, portal, loja, finder, admin)
│   ├── css/                estilos
│   └── js/
│       ├── config.js       decide qual API usar (local vs produção)
│       ├── store.js        camada de dados (a "ponte" FG)
│       ├── api-adapter.js  liga o store à API real
│       └── *.js            lógica de cada tela
├── api/
│   ├── src/
│   │   ├── server.js       monta o Express e as rotas
│   │   ├── db.js           conexão com o banco
│   │   ├── auth.js         JWT (login/permissões)
│   │   └── routes/         um arquivo por área (auth, produtos, ...)
│   └── package.json
├── database/
│   ├── fullgas_schema_sqlserver.sql   estrutura inicial
│   ├── fullgas_seeds.sql              dados de teste
│   └── migrations/                    mudanças posteriores, numeradas
└── docs/                   estes guias
```

## A ideia central que torna tudo expansível

Toda leitura/escrita de dados no front passa pela camada **FG** (em `store.js`).
O `api-adapter.js` substitui o miolo dessa camada por chamadas à API. Resultado:
as telas não sabem (nem se importam) se os dados vêm do `localStorage` ou de um
banco real. Para adicionar um recurso, você mexe em três camadas, sempre na mesma
ordem: **banco → API → front**.

---

## Exemplo completo: adicionar fotos às reivindicações

Este é o recurso que você citou. O terreno já está preparado (a migração 001 já
criou a tabela de anexos). Eis o caminho das três camadas, como referência para
esta e para futuras expansões.

### Camada 1 — Banco (já feito na migração 001)
A tabela `ReivindicacaoAnexo` guarda o nome do arquivo, o tipo, e a **URL** de
onde a foto está hospedada. Importante: o banco guarda a *referência*, não a foto
em si. A foto vai para um armazenamento de objetos (Azure Blob Storage é o par
natural aqui), e a URL volta para o banco.

### Camada 2 — API (a fazer)
1. Adicionar um pacote de upload (ex.: `multer`) para receber arquivos.
2. Criar uma rota nova, algo como
   `POST /api/reivindicacoes/:id/anexos` — recebe a imagem, envia ao Blob
   Storage, e grava a URL na tabela `ReivindicacaoAnexo`.
3. Criar `GET /api/reivindicacoes/:id/anexos` para listar as fotos.
4. Criar o arquivo `api/src/routes/reivindicacoes.routes.js` (hoje as
   reivindicações ainda não têm rotas — fazem parte do conjunto que falta migrar
   do store para a API).

### Camada 3 — Front (a fazer)
1. Na tela de criar reivindicação (`portal.js`), adicionar um campo de upload
   (`<input type="file">`) e um botão "anexar foto".
2. Ao enviar, fazer o `fetch` para a rota de upload com `FormData`.
3. Na visualização da reivindicação, exibir as miniaturas das fotos retornadas.

Cada uma dessas mudanças vira commits em um branch `reivindicacao-fotos`, testada
localmente, e só então fundida no `main` (que republica sozinho).

---

## O que ainda falta construir (roadmap)

A fundação está pronta (login, catálogo). Estas áreas ainda usam dados locais e
precisam virar rotas de API, seguindo o mesmo padrão de `produtos.routes.js`:

- Pedidos (criar, listar, mudar status) e itens
- Veículos (estoque, registrar venda, ativar garantia)
- Reivindicações (listar, criar, anexos) ← inclui o recurso de fotos
- Parts Finder (seções e peças por modelo)
- Faturas e entregas
- Usuários (aprovar, promover, bloquear) — área admin
- Dashboard (agregações para os gráficos)
- Notificações e log de buscas

Sugestão de ordem: pedidos e veículos primeiro (são o núcleo do dia a dia),
depois reivindicações com as fotos, e o restante conforme a necessidade.

## Princípios para manter a qualidade ao crescer

1. **Uma migração por mudança de banco**, numerada e idempotente (segura para
   rodar duas vezes). Nunca edite o schema original depois do banco no ar.
2. **Uma rota por área**, em arquivos separados em `routes/` — não inche um
   arquivo só.
3. **Consultas sempre parametrizadas** (`@param`), nunca concatenando texto —
   é o que protege contra SQL injection.
4. **Segredos só em variáveis de ambiente**, nunca no código.
5. **Branch para cada recurso novo**, com Pull Request antes de juntar no `main`.
