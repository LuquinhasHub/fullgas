# Guia de Deploy — colocar o Fullgas no ar

Três peças vão para a nuvem, nesta ordem: **banco → API → front**. Cada uma
depende da anterior, então siga a sequência.

---

## Parte 1 — Banco no Azure SQL Database

### 1.1 Criar o banco
1. Crie uma conta em https://azure.microsoft.com (precisa de cartão para
   verificação, mas a oferta abaixo é gratuita).
2. Acesse o Azure SQL hub: https://aka.ms/azuresqlhub → **Create database**.
3. Procure o banner **Apply offer** (oferta gratuita) e aplique — o card de
   custo à direita deve mostrar **R$ 0,00 / mês**.
4. Em **Behavior when free limit reached**, escolha
   **"Auto-pause até o próximo mês"**. Isso evita qualquer cobrança surpresa.
5. Nomeie o banco `FullgasB2B`. Crie um servidor novo quando pedir, e **anote
   o nome do servidor** (algo como `fullgas-srv.database.windows.net`) e o
   usuário/senha de administrador que você definir.

### 1.2 Liberar o firewall
O Azure SQL bloqueia tudo por padrão. No painel do servidor SQL:
- Em **Networking** → marque **"Allow Azure services and resources to access
  this server"** (para a API conseguir conectar).
- Adicione seu IP atual na lista (para você rodar os scripts pelo SSMS).

### 1.3 Criar as tabelas e os dados
Abra o **SSMS** e conecte usando o nome do servidor do Azure (em vez de
`localhost`), com **SQL Server Authentication** e o usuário/senha de admin.
Depois rode, nesta ordem, os scripts da pasta `database/`:
1. `fullgas_schema_sqlserver.sql`
2. `migrations/001_anexos_reivindicacao.sql`
3. `fullgas_seeds.sql`
4. `criar_usuario_app.sql` (cria o usuário que a API vai usar)

> Dica de economia: feche o SSMS ao terminar. Conexões abertas impedem o banco
> de pausar e consomem sua cota gratuita.

---

## Parte 2 — API no Render

### 2.1 Subir o código para o GitHub
Siga o `docs/01-guia-git.md` até o código estar no GitHub.

### 2.2 Criar o serviço no Render
1. Crie conta em https://render.com (dá para entrar com o GitHub).
2. **New** → **Blueprint** → conecte seu repositório `fullgas`. O Render lê o
   `render.yaml` e já propõe criar a API e o front.
3. Antes de finalizar, preencha as variáveis marcadas como "sync:false" no
   painel — são os segredos que não ficam no Git:

| Variável | Valor |
|---|---|
| `DB_SERVER` | nome do servidor Azure (ex.: `fullgas-srv.database.windows.net`) |
| `DB_NAME` | `FullgasB2B` |
| `DB_USER` | `fullgas_app` (o criado no passo 1.3) |
| `DB_PASSWORD` | a senha que você definiu para esse usuário |
| `CORS_ORIGIN` | a URL do front no Render (você terá após o deploy do front) |
| `JWT_SECRET` | uma chave longa e aleatória (veja abaixo) |

Para gerar o `JWT_SECRET`:
```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

4. Confirme. O Render instala, sobe a API e te dá uma URL
   (ex.: `https://fullgas-api.onrender.com`). Teste no navegador:
   `https://fullgas-api.onrender.com/api/health` → deve responder `{"ok":true}`.

---

## Parte 3 — Front-end

1. No `render.yaml` o front já está descrito como site estático; ele sobe junto
   no Blueprint e ganha uma URL própria (ex.: `https://fullgas-front.onrender.com`).
2. Abra `frontend/js/config.js` e ajuste a constante `API_PRODUCAO` para a URL
   da sua API no Render. Faça commit e push — o Render republica sozinho.
3. Volte na API (Parte 2) e coloque a URL do front em `CORS_ORIGIN`.

Pronto. Acesse a URL do front de qualquer lugar e faça login com
`admin@fullgas.com.br` / `admin123`.

---

## Detalhes que evitam dor de cabeça

- **Primeiro acesso lento**: o banco serverless e o plano grátis do Render
  "dormem" quando ociosos. A primeira chamada após um tempo parado demora alguns
  segundos para acordar. É normal, não é bug.
- **Senhas só nas variáveis de ambiente**: nunca no código, nunca no Git. Se uma
  senha vazar num commit, troque-a no banco imediatamente.
- **Toda mudança no banco vira uma migração** numerada em `database/migrations/`
  (veja a 001 como modelo). Nunca edite o schema original depois que o banco
  está no ar — você não conseguiria aplicar a mudança sem apagar os dados.
- **Republicar é só dar push**: com o Render conectado ao GitHub, todo `git push`
  no branch `main` redeploya automaticamente.
