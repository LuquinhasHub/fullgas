#!/usr/bin/env bash
# ============================================================================
#  Deploy do Fullgas — um único comando faz tudo, na ordem certa.
#  Uso na VPS (como usuário fullgas, já no grupo docker):
#      SA_PASSWORD='senha_do_sa' ./deploy.sh
#  Ou deixe a senha num arquivo fora do git (ex.: ~/.fullgas-deploy.env) e:
#      source ~/.fullgas-deploy.env && ./deploy.sh
#
#  Variáveis desse arquivo (~/.fullgas-deploy.env, chmod 600, NUNCA no git):
#      SA_PASSWORD          senha do sa, para aplicar as migrations
#      CLOUDFLARE_API_TOKEN token da Cloudflare — OPCIONAL, ver passo 5
#      CLOUDFLARE_ZONE_ID   id da zona fullgas.app.br — idem
#
#  Pré-requisitos (configurados UMA vez — ver README de deploy):
#    - Nginx servindo direto de /var/www/fullgas-app/frontend
#    - usuário fullgas no grupo docker  (sudo usermod -aG docker fullgas)
#    - permissão para reiniciar a API sem senha. Como root, rode:
#        echo 'fullgas ALL=(root) NOPASSWD: /usr/bin/systemctl restart fullgas-api' \
#          > /etc/sudoers.d/fullgas-deploy && chmod 440 /etc/sudoers.d/fullgas-deploy
#
#  NOTA: só o systemd gerencia a API. O pm2 NÃO é usado (havia os dois
#  configurados, brigando pela porta 3000 — ver comentário no passo 4).
# ============================================================================
set -euo pipefail

REPO=/var/www/fullgas-app
DB_CONTAINER=fullgas-sql
DB_NAME=FullgasB2B
SERVICO=fullgas-api          # unidade systemd (NAO e' o pm2 — ver nota abaixo)
SQLCMD=/opt/mssql-tools18/bin/sqlcmd

# A senha do sa NUNCA fica no git — vem de variável de ambiente.
: "${SA_PASSWORD:?Defina SA_PASSWORD antes de rodar (export SA_PASSWORD=... )}"

cd "$REPO"

echo "==> [1/4] Atualizando código (git) ..."
git fetch origin
git reset --hard origin/main          # produção = espelho fiel da main

echo "==> [2/4] Instalando dependencias da API ..."
# Obrigatorio: quando um commit acrescenta um pacote (helmet, express-rate-limit
# etc.), sem este passo o `pm2 restart` sobe a API sem a dependencia e ela entra
# em crash-loop com ERR_MODULE_NOT_FOUND. `npm ci` instala exatamente o que esta
# no package-lock.json — nao "resolve" versoes por conta propria como o install.
( cd "$REPO/api" && npm ci --omit=dev )

echo "==> [3/4] Aplicando migrations (são idempotentes, podem rodar sempre) ..."
# So database/migrations/ entra aqui. database/fullgas_seeds.sql NAO e' e nunca
# deve ser incluido neste laco: ele apaga as tabelas e cria contas com senha
# publicada no Git (o proprio arquivo tem duas travas contra isso desde
# 2026-08-27, mas a regra e' nao apontar o deploy para ele).
for f in database/migrations/*.sql; do
  echo "        - $(basename "$f")"
  docker exec -i "$DB_CONTAINER" "$SQLCMD" \
    -S localhost -U sa -P "$SA_PASSWORD" -C -d "$DB_NAME" < "$f"
done

echo "==> [4/4] Reiniciando a API ..."
# ATENCAO: quem roda a API e' o SYSTEMD, nao o pm2. Ate 2026-08-04 este script
# terminava com `pm2 restart`, que reiniciava um processo que nem estava
# atendendo (o systemd ja segurava a porta 3000). Resultado: o deploy dizia
# "concluido" e a producao seguia com o codigo antigo por mais de um dia.
sudo systemctl restart "$SERVICO"

# A API se recusa a subir sem JWT_SECRET valido (e outras checagens de config).
# Nesses casos o processo morre logo depois de iniciar, entao conferimos o
# estado alguns segundos depois em vez de confiar no retorno do restart.
sleep 4
if ! systemctl is-active --quiet "$SERVICO"; then
  echo ""
  echo "!! A API NAO esta ativa depois do restart."
  echo "!! Veja o motivo com:  sudo journalctl -u $SERVICO -n 40 --no-pager"
  exit 1
fi

# ---------------------------------------------------------------------------
# Conferencias que falham em SILENCIO se ninguem olhar.
# Nao interrompem o deploy: o site sobe e funciona nos dois casos. O problema e
# que funciona ERRADO, sem sintoma nenhum, e so se descobre num incidente.
# ---------------------------------------------------------------------------

# 1) Sem NODE_ENV=production (ou COOKIE_SECURE=1) os cookies de sessao saem sem
#    a marca Secure e podem trafegar em texto claro.
if ! systemctl show "$SERVICO" -p Environment | grep -qE 'NODE_ENV=production|COOKIE_SECURE=1'; then
  echo ""
  echo "!! ATENCAO: a unidade $SERVICO nao define NODE_ENV=production nem"
  echo "!! COOKIE_SECURE=1. Os cookies de sessao estao saindo SEM Secure."
  echo "!! Corrija com:  sudo systemctl edit $SERVICO"
  echo "!!   [Service]"
  echo "!!   Environment=NODE_ENV=production"
fi

# 2) Nenhuma resposta de /api pode ser cacheavel: elas carregam Set-Cookie, e
#    uma copia guardada entrega a sessao de um usuario para o proximo.
CACHE_API=$(curl -sS -o /dev/null -D - https://fullgas.app.br/api/health 2>/dev/null \
            | grep -i '^cache-control:' || true)
if ! echo "$CACHE_API" | grep -qi 'no-store'; then
  echo ""
  echo "!! ATENCAO: /api/health nao respondeu com Cache-Control: no-store."
  echo "!! Recebido: ${CACHE_API:-(nenhum header Cache-Control)}"
  echo "!! Confira o location /api/ do Nginx (deploy/nginx/fullgas.conf) e se"
  echo "!! ha alguma regra 'Cache Everything' na Cloudflare pegando /api/*."
fi

# 3) Toda origem de foto de produto precisa estar liberada no img-src do CSP.
#    O Tiny NAO hospeda tudo no mesmo lugar: hoje distribui entre
#    anexos.tiny.com.br e um bucket S3, e pode passar a usar um terceiro
#    endereco sem aviso. Quando isso acontece o navegador bloqueia a imagem e
#    a loja fica sem foto — SEM erro no servidor, sem nada no log do Nginx. O
#    unico sintoma e o console do navegador, que ninguem abre. Em 13/08/2026
#    metade dos produtos ficou sem foto assim, por horas.
IMG_SRC=$(curl -sS --max-time 15 -D - -o /dev/null https://fullgas.app.br/loja 2>/dev/null \
          | grep -i '^content-security-policy:' | tr ';' '\n' | grep -i 'img-src' || true)
if [ -z "$IMG_SRC" ]; then
  echo ""
  echo "!! ATENCAO: nao foi possivel ler o img-src do CSP em /loja."
  echo "!! Verifique o location / do Nginx (deploy/nginx/fullgas.conf)."
else
  DOMINIOS=$(docker exec "$DB_CONTAINER" "$SQLCMD" \
    -S localhost -U sa -P "$SA_PASSWORD" -C -d "$DB_NAME" -h -1 -W -Q \
    "SET NOCOUNT ON; SELECT DISTINCT LEFT(ImagemUrl, CHARINDEX('/', ImagemUrl, 9) - 1) \
     FROM dbo.Produto WHERE ImagemUrl LIKE 'http%';" 2>/dev/null \
    | tr -d '\r' | grep -E '^https?://' || true)
  for d in $DOMINIOS; do
    if ! echo "$IMG_SRC" | grep -qF "$d"; then
      echo ""
      echo "!! ATENCAO: ha foto de produto vinda de $d,"
      echo "!! mas esse endereco NAO esta liberado no img-src do CSP."
      echo "!! O navegador vai BLOQUEAR essas imagens — a loja fica sem foto."
      echo "!! Acrescente em deploy/nginx/fullgas.conf, no location /, e prefira"
      echo "!! incluir o CAMINHO e nao so o host quando o dominio for"
      echo "!! compartilhado (ex.: https://s3.amazonaws.com/tiny-anexos-us/ —"
      echo "!! so o host autorizaria qualquer bucket de qualquer pessoa)."
    fi
  done
fi

# 4) A config do Nginx no ar tem de ser a versionada. Em 13/08/2026 o
#    sites-enabled tinha virado uma COPIA solta, editada a mao: quem corrigia o
#    arquivo do repo nao via efeito nenhum, e o proximo deploy desfaria as
#    correcoes feitas direto no servidor.
if [ ! -L /etc/nginx/sites-enabled/fullgas ]; then
  echo ""
  echo "!! ATENCAO: /etc/nginx/sites-enabled/fullgas NAO e um link simbolico."
  echo "!! Vire uma copia independente — o que estiver no repo nao esta no ar."
  echo "!! Corrija (como root):"
  echo "!!   ln -sfn /etc/nginx/sites-available/fullgas /etc/nginx/sites-enabled/fullgas"
elif ! diff -q deploy/nginx/fullgas.conf /etc/nginx/sites-available/fullgas >/dev/null 2>&1; then
  echo ""
  echo "!! ATENCAO: deploy/nginx/fullgas.conf difere do que esta instalado."
  echo "!! Alguem editou o Nginx direto no servidor, ou o repo mudou e ninguem"
  echo "!! instalou. Veja a diferenca com:"
  echo "!!   diff deploy/nginx/fullgas.conf /etc/nginx/sites-available/fullgas"
  echo "!! Instale (como root) e recarregue:"
  echo "!!   cp deploy/nginx/fullgas.conf /etc/nginx/sites-available/fullgas"
  echo "!!   nginx -t && systemctl reload nginx"
fi

# 5) Quem atende na 3000 tem de ser o processo deste servico. Ate 13/08/2026
#    havia um pm2 segurando a porta enquanto o systemd tentava subir e morria
#    com EADDRINUSE (1308 tentativas numa hora). Como o deploy so reinicia o
#    systemd, o codigo em execucao continuava sendo o antigo e o deploy dizia
#    "concluido" do mesmo jeito.
PID_SERVICO=$(systemctl show "$SERVICO" -p MainPID --value 2>/dev/null || echo "")
PID_PORTA=$(ss -ltnp 2>/dev/null | grep ':3000 ' | grep -oP 'pid=\K[0-9]+' | head -1 || true)
if [ -n "$PID_PORTA" ] && [ -n "$PID_SERVICO" ] && [ "$PID_PORTA" != "$PID_SERVICO" ]; then
  echo ""
  echo "!! ATENCAO: quem atende na porta 3000 (pid $PID_PORTA) NAO e o processo"
  echo "!! do $SERVICO (pid $PID_SERVICO). Ha outro gerenciador segurando a"
  echo "!! porta — provavelmente pm2. Este deploy NAO trocou o codigo no ar."
  echo "!! Veja quem e:  sudo ss -ltnp | grep :3000"
fi

# ---------------------------------------------------------------------------
# [5/5] Purga do cache da Cloudflare.
#
# POR QUE ISTO EXISTE: a Cloudflare fica NA FRENTE do Nginx e guarda copia das
# respostas. Sem purgar, o visitante continua recebendo a versao velha mesmo
# com o deploy concluido — e o pior caso ja aconteceu em 13/08/2026: um bug de
# `location` fez as imagens responderem 404, a Cloudflare guardou esse 404 com
# max-age de 30 DIAS, e consertar o Nginx nao adiantou nada para quem acessava
# o site. So a purga resolveu.
#
# E OPCIONAL de proposito: sem as variaveis o deploy segue normalmente, so
# avisando. Assim quem clonar o projeto nao fica travado por falta de token.
#
# O token vem do painel: My Profile -> API Tokens -> Create Token, com a
# permissao MINIMA `Zone -> Cache Purge -> Purge`, restrito a zona do site.
# NAO use a Global API Key: ela da acesso total a conta, e este script roda
# num servidor exposto a internet.
# ---------------------------------------------------------------------------
if [ -n "${CLOUDFLARE_API_TOKEN:-}" ] && [ -n "${CLOUDFLARE_ZONE_ID:-}" ]; then
  echo ""
  echo "==> [5/5] Limpando o cache da Cloudflare ..."
  CF_RESP=$(curl -sS --max-time 20 -X POST \
    "https://api.cloudflare.com/client/v4/zones/${CLOUDFLARE_ZONE_ID}/purge_cache" \
    -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
    -H "Content-Type: application/json" \
    --data '{"purge_everything":true}' 2>&1) || CF_RESP="falha de rede ao chamar a API da Cloudflare"

  if echo "$CF_RESP" | grep -q '"success":true'; then
    echo "        cache limpo."
  else
    # Nao aborta: o deploy em si deu certo. Mas precisa gritar, porque o
    # sintoma (site "sem atualizar") nao parece um erro de deploy.
    echo ""
    echo "!! ATENCAO: a purga do cache FALHOU."
    echo "!! O codigo novo esta no ar, mas os visitantes podem continuar vendo"
    echo "!! a versao antiga ate o cache expirar sozinho."
    echo "!! Resposta da Cloudflare: $CF_RESP"
    echo "!! Limpe a mao: painel -> Caching -> Configuration -> Purge Everything"
  fi
else
  echo ""
  echo "!! Purga da Cloudflare PULADA (CLOUDFLARE_API_TOKEN e/ou"
  echo "!! CLOUDFLARE_ZONE_ID nao definidos em ~/.fullgas-deploy.env)."
  echo "!! Se algo nao atualizar no navegador, limpe o cache no painel."
fi

echo ""
echo "==> Deploy concluido. Confira: https://fullgas.app.br"
