# Fullgas B2B

Portal B2B para concessionárias: catálogo de peças, Parts Finder, pedidos,
reivindicações de garantia e painel administrativo.

## Estrutura

| Pasta | O que é |
|---|---|
| `frontend/` | O site (HTML/CSS/JS). Abra `index.html` ou sirva por HTTP. |
| `api/` | API Node.js + Express que conecta o front ao banco. |
| `database/` | Scripts SQL: schema, dados de teste e migrações. |
| `docs/` | Guias de Git, deploy e arquitetura. |

## Começar (desenvolvimento local)

1. **Banco**: no SQL Server, rode os scripts de `database/` na ordem:
   `fullgas_schema_sqlserver.sql` → `migrations/001_anexos_reivindicacao.sql`
   → `fullgas_seeds.sql` → `criar_usuario_app.sql`.
2. **API**: `cd api`, copie `.env.example` para `.env` e preencha, depois
   `npm install` e `npm start`.
3. **Front**: sirva a pasta `frontend/` por HTTP (ex.: Live Server do VS Code).

Login de teste: `admin@fullgas.com.br` / `admin123`.

## Documentação

- `docs/01-guia-git.md` — versionamento do zero (comece por aqui se nunca usou Git)
- `docs/02-guia-deploy.md` — colocar no ar (banco no Azure, API e front no Render)
- `docs/03-arquitetura-e-expansao.md` — como o projeto é montado e como crescê-lo

## Status

Fundação pronta: autenticação e catálogo já passam pela API/banco. As demais
áreas (pedidos, veículos, reivindicações com fotos, finder, dashboard) estão
mapeadas no roadmap em `docs/03-arquitetura-e-expansao.md`.
