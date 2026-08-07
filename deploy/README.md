# Deploy — configuração de infraestrutura

O `deploy.sh` (na raiz) cuida do que muda a cada versão: código, dependências,
migrações e restart. **Este diretório cuida do que se configura uma vez** e
depois só se confere.

| Arquivo | O que é |
|---|---|
| `nginx/fullgas.conf` | Configuração do Nginx de produção, versionada |

---

## Os quatro itens críticos

Todos têm a mesma característica desagradável: **o portal funciona mesmo com
eles errados**. Não há erro, não há log, não há tela quebrada — só uma
proteção ausente que ninguém percebe até o incidente.

### 1. Nenhuma resposta de `/api` pode ser cacheada

É o item mais grave da lista. As respostas de autenticação carregam
`Set-Cookie`. Se qualquer camada guardar uma cópia, **o cookie de sessão de um
usuário é entregue ao próximo que pedir a mesma URL** — a sessão troca de dono.

Três camadas cobrem isso, de propósito:

1. **A API** manda `Cache-Control: no-store` em tudo sob `/api`
   (`api/src/server.js`). Viaja com a aplicação, vale em qualquer ambiente.
2. **O Nginx** remove e reescreve o header no `location /api/`, garantindo um
   valor só, e já deixa `/api` fora de um eventual `proxy_cache` futuro.
3. **A Cloudflare** precisa de uma regra explícita — é a única camada que não
   está neste repositório:

   > Painel da Cloudflare → **Caching** → **Cache Rules** → *Create rule*
   > - Nome: `Bypass cache /api`
   > - Quando: `URI Path` **starts with** `/api/`
   > - Então: **Bypass cache**
   > - Salve e coloque essa regra **acima** de qualquer outra que use
   >   "Cache Everything".

   A Cloudflare, na configuração padrão, já não cacheia resposta com
   `Set-Cookie` nem caminho sem extensão de arquivo. A regra existe porque o
   padrão pode ser derrubado por **uma única** regra "Cache Everything" criada
   depois para acelerar o site — e aí o estrago é silencioso e imediato.

**Conferência:**
```bash
curl -sSI https://fullgas.app.br/api/health | grep -i -E 'cache-control|cf-cache-status'
# Esperado: Cache-Control: no-store
#           cf-cache-status: BYPASS   (ou DYNAMIC)
```
O `deploy.sh` já faz essa checagem no fim e avisa se falhar.

### 2. `NODE_ENV=production` na unidade do systemd

Sem isto (ou sem `COOKIE_SECURE=1`), os cookies de sessão saem **sem a marca
`Secure`** e o navegador aceita mandá-los por HTTP. O portal continua
funcionando normalmente — é exatamente o que torna a falha perigosa.

```bash
sudo systemctl edit fullgas-api
# [Service]
# Environment=NODE_ENV=production

sudo systemctl daemon-reload && sudo systemctl restart fullgas-api
```

**Conferência:**
```bash
systemctl show fullgas-api -p Environment
curl -sSI https://fullgas.app.br/api/health | grep -i set-cookie   # se houver, precisa dizer Secure
```
A API também grita no arranque quando os cookies não vão sair com `Secure`:
procure o aviso com `journalctl -u fullgas-api -n 30`.

### 3. `X-Forwarded-Proto` no proxy da API

Sem esse header a API acha que está em `http://`, e o `appUrl()` do `mail.js`
monta os links de **recuperação de senha** com `http://`. Já está no
`nginx/fullgas.conf`, nos dois blocos de proxy.

**Conferência:** peça uma recuperação de senha e olhe o link do e-mail — tem de
começar com `https://`.

### 4. O HTML não pode ficar preso no cache

O truque de `?v=AAAAMMDDx` nos assets só funciona se o **HTML** for buscado de
novo: é ele que diz qual `?v=` usar. Com HTML velho em cache, o usuário roda a
versão antiga inteira sem saber — aconteceu num teste local, com o Chrome
servindo HTML antigo depois de um deploy.

O `location /` do Nginx manda `Cache-Control: no-cache`, que **não** proíbe
guardar: obriga a revalidar antes de usar. O 304 continua barato e o conteúdo
fica sempre correto.

**Conferência:**
```bash
curl -sSI https://fullgas.app.br/portal | grep -i cache-control   # no-cache
curl -sSI https://fullgas.app.br/js/api-adapter.js | grep -i cache-control   # max-age longo
```

---

## Instalar / atualizar o Nginx

```bash
cd /var/www/fullgas-app
sudo cp deploy/nginx/fullgas.conf /etc/nginx/sites-available/fullgas
sudo ln -sf /etc/nginx/sites-available/fullgas /etc/nginx/sites-enabled/fullgas
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx
```

> **Antes de recarregar**, compare com o que está no ar:
> `diff /etc/nginx/sites-available/fullgas deploy/nginx/fullgas.conf`
> A configuração de produção nunca esteve versionada, então pode haver ajustes
> feitos à mão que ninguém documentou.

Dois pontos da configuração que se apagam sem dar erro:

- **`add_header` dentro de um `location` descarta os herdados do `server`.** Não
  é acumulativo. Por isso os headers de segurança aparecem repetidos em cada
  bloco — tirar uma repetição remove a proteção só naquele caminho.
- **As regras de URL limpa** (`if ($request_uri ~ ...)` + `try_files $uri
  $uri.html`) são obrigatórias. Sem elas `/portal` responde 404. O bloco HTTPS
  de `docs/09-deploy-vps-linux.md` estava sem elas.

---

## Checklist do deploy que troca a sessão para cookie

Este deploy específico derruba todas as sessões (uma vez só). Faça em horário
de baixo movimento.

1. `git push` da branch para a `main`.
2. Na VPS, **antes** do `deploy.sh`: instalar o Nginx novo (acima) e criar a
   regra de bypass na Cloudflare.
3. Definir `NODE_ENV=production` na unidade do systemd.
4. **Rotacionar o `JWT_SECRET`** no `.env` da API — uma vez só, neste deploy.
   Em qualquer outro momento seria um segundo logout em massa de graça.
   ```bash
   node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
   ```
5. Preencher `TURNSTILE_SITE_KEY` e `TURNSTILE_SECRET_KEY` no `.env`.
6. `./deploy.sh` e ler os avisos do fim.
7. Limpar o cache da Cloudflare (*Purge Everything*) — o HTML antigo ainda está
   nos edges.
8. Entrar no portal e conferir, no DevTools → Application → Cookies:
   `fg_sess` com **HttpOnly** e **Secure** marcados.
