Auditoria de segurança (SAST) do monorepo inteiro, com remediação em 6 fases.
**101 testes** passando (eram 59). Nenhuma mudança exige ação do usuário final.

## Os dois achados graves

### 1. Controle de acesso por área — *broken access control*
`requireArea` existia mas estava montado em **uma** rota (`/api/faturas`). O gating das contas internas era client-side: o portal escondia as abas. Uma conta marcada como "só loja" continuava lendo pedidos, reivindicações, veículos e valores de fatura da concessionária inteira — bastava chamar a API direto.

Agora são **21 rotas**, com o helper `requireAreaAny` para a tela alcançada por mais de um caminho. Valores monetários (`total`, `preco`, `faturas`) saem da resposta de pedido para quem não tem a área `financeiro`.

### 2. Sessão sem revogação — migration 037
Só a assinatura do JWT era conferida, nunca o banco. Logout apagava o cookie e nada mais; redefinir a senha **não expulsava o invasor**; bloquear alguém ou rebaixar um admin só valia no login seguinte, até 8h depois.

Nova coluna `Usuario.TokenVersion` + middleware `revalidarSessao`, com cache de 15s e invalidação explícita nos 4 pontos que revogam.

## Demais fases

- **Config de deploy** — `render.yaml` sem `NODE_ENV`/`COOKIE_SECURE`/Turnstile/SMTP fazia um deploy subir com cookie sem `Secure`, CAPTCHA desligado e o token de recuperação de senha impresso no log: três falhas silenciosas. Seeds versionados criavam `admin@fullgas.com.br` / `admin123` — agora exigem `-v ALLOW_SEEDS=1` e abortam se houver dado transacional. `multer` 1.4.5 (EOL, CVEs de DoS de 2025) → 2.x.
- **Endurecimento** — CSP passou a sair da API (existia só no `location /` do Nginx, deixando `/api` e `/uploads` sem política); em produção é byte a byte idêntica à dele. Rate limit em `/senha/verificar` e `/senha/redefinir`, piso global, CAPTCHA também no cadastro. Nginx com `set_real_ip_from`/`CF-Connecting-IP` — sem isso os limites contavam por datacenter da Cloudflare, não por cliente. 21 escapes faltantes no `shop.js` e validação de SKU no servidor, inclusive no feed do Tiny.
- **Multi-tenant no finder** — `/finder/busca` resolvia **qualquer VIN de qualquer concessionária**. Agora escopado por empresa, como o resto da API.
- **Auditoria — migration 038** — a impersonação tinha trilha só em `console.log`, enquanto todo dado gerado naquela hora fica gravado no nome do cliente. Nova tabela `AuditoriaAcesso`; o autor sai de `req.user.imp`, senão a trilha acusaria o cliente das ações do admin. Query string saiu do log de requisições (o chassi do cliente ia parar no journald).
- **Política de senha** — cinco pontos repetiam o próprio `length < 6`, e o de admin usava 8. Regra única em `validacao.js`, mínimo 8. Só afeta senha **nova**: ninguém é deslogado nem obrigado a trocar.

## Armadilhas corrigidas durante a verificação

- `requireArea` tinha **fail-open**: sem `req.user`, `perm` era `undefined`, `!Array.isArray(undefined)` dava `true` e o gate liberava. Só não era explorável porque toda rota tem `requireAuth` antes.
- A CSP usava `http://192.168.*:*` — fonte inválida que o navegador descarta com aviso, deixando a política pela metade.

## Nota de arquitetura

`server.js` foi partido: `app.js` monta e exporta a aplicação (destrava o supertest), `server.js` só faz `listen` + cron.

## ⚠️ Deploy

Rodar as migrations **037 e 038 antes** de reiniciar a API. Sem a 037 o `revalidarSessao` cai no ramo de erro e segue com o token — o site não quebra, mas **a revogação não funciona**, e o único aviso é uma linha no log.

Vale conferir no mesmo deploy que `NODE_ENV=production` está na unidade do systemd (`systemctl show fullgas-api -p Environment`); sem isso os cookies de sessão saem sem `Secure`.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
