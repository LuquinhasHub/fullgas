# Fullgas B2B

Portal B2B para a rede de concessionárias Fullgas: catálogo de peças integrado ao
ERP, localizador visual de peças (Parts Finder), pedidos com controle de envio por
item, reivindicações de garantia com fotos, e um painel administrativo completo.

**Em produção:** https://fullgas.app.br

---

## O que o portal faz

**Para a concessionária**
- **Catálogo** sincronizado automaticamente com o **Tiny ERP** (produtos, preços e
  estoque real).
- **Parts Finder** — localiza a peça pelo diagrama do modelo: navega por seções,
  clica na área do desenho e chega ao produto.
- **Pedidos** com baixa de estoque, envio parcial e **pré-venda/backorder** (itens
  sem estoque entram numa fila e são liberados quando repostos).
- **Reivindicações de garantia** com anexos (fotos/vídeos), fluxo de aprovação e
  geração de pedido de reposição.
- **Conta financeira** com faturas e **PDF** da fatura.
- **Contas internas (sub-dealers)** com permissões por área, criadas pelo gestor
  da concessionária.
- **Recuperação de senha** por e-mail.

**Para o administrador**
- Gestão de catálogo, categorias e subcategorias, pedidos (com **controle de envio
  peça a peça**), chassis, clientes e reivindicações.
- **Notificações** para as concessionárias.
- **Alteração de identidade**: entra na conta de um cliente para dar suporte,
  com tarja de aviso e registro em log.
- Filtros e busca em todas as abas; integração Tiny (importação e exportação de
  pedidos).

---

## Arquitetura

```
Internet ──HTTPS──> Cloudflare ──HTTPS──> Nginx (VPS)
                                            ├─ /         → front estático
                                            ├─ /api      → API Node (localhost:3000)
                                            └─ /uploads  → API Node
                                                              │
                                                              └─ SQL Server (Docker)
                                                                     ↕
                                                                  Tiny ERP
```

| Camada | Tecnologia |
|---|---|
| Frontend | HTML/CSS/JavaScript puro (sem build), servido estático |
| API | Node.js + Express (ESM) |
| Banco | Microsoft SQL Server (Express, em Docker) |
| Auth | JWT + bcrypt |
| Integração | Tiny ERP (API v2) — catálogo e pedidos |
| E-mail | SMTP (recuperação de senha) |
| Infra | VPS Ubuntu · Nginx · Cloudflare (HTTPS Full strict) |

---

## Estrutura do repositório

| Pasta | O que é |
|---|---|
| `frontend/` | O site (HTML/CSS/JS). `index.html` é a tela de acesso. |
| `api/` | API Node.js + Express. Ponto de entrada `src/server.js`. |
| `api/scripts/` | Utilitários operacionais (ex.: `criar-admin.mjs`). |
| `database/` | Schema, migrações numeradas (`migrations/`), seeds e o backup. |
| `docs/` | Especificações, roadmap e o **guia de deploy** (`09-deploy-vps-linux.md`). |

---

## Rodar em desenvolvimento

1. **Banco** (SQL Server): rode, nesta ordem —
   `database/fullgas_schema_sqlserver.sql`, depois todas as
   `database/migrations/*.sql` em ordem numérica, depois
   `database/criar_usuario_app.sql`.
   > Se usar o `sqlcmd`, passe `-f 65001` (senão os acentos das constraints
   > corrompem). Os seeds (`fullgas_seeds.sql`) são opcionais e trazem dados de
   > demonstração.
2. **API**: `cd api`, copie `.env.example` para `.env` e preencha, então
   `npm install` e `npm start` (ou `npm run dev` para recarregar ao salvar).
3. **Frontend**: sirva a pasta `frontend/` por HTTP (ex.: Live Server do VS Code).
4. **Primeiro admin** (banco sem seeds):
   `node scripts/criar-admin.mjs "Nome" email@dominio "SenhaForte"`.

---

## Deploy em produção

Guia completo, testado no servidor real, em
[`docs/09-deploy-vps-linux.md`](docs/09-deploy-vps-linux.md): VPS Ubuntu, SQL
Server Express em Docker, API como serviço systemd, Nginx + certificado de origem
da Cloudflare.

**Backup:** `database/backup-fullgas.sh` roda por cron no servidor (backup diário +
`RESTORE VERIFYONLY` + retenção), com cópia externa para a nuvem. Inclui a receita
de restauração no próprio arquivo.

---

## Documentação complementar

- `docs/04-roadmap.md` — evolução do produto
- `docs/07-partsfinder.md` — o localizador de peças
- `docs/08-integracao-tiny.md` — a integração com o ERP
- `docs/09-deploy-vps-linux.md` — colocar (e manter) no ar
