#!/usr/bin/env bash
# ============================================================================
#  Deploy do Fullgas — um único comando faz tudo, na ordem certa.
#  Uso na VPS (como usuário fullgas, já no grupo docker):
#      SA_PASSWORD='senha_do_sa' ./deploy.sh
#  Ou deixe a senha num arquivo fora do git (ex.: ~/.fullgas-deploy.env) e:
#      source ~/.fullgas-deploy.env && ./deploy.sh
#
#  Pré-requisitos (configurados UMA vez — ver README de deploy):
#    - Nginx servindo direto de /var/www/fullgas-app/frontend
#    - usuário fullgas no grupo docker  (sudo usermod -aG docker fullgas)
# ============================================================================
set -euo pipefail

REPO=/var/www/fullgas-app
DB_CONTAINER=fullgas-sql
DB_NAME=FullgasB2B
PM2_APP=fullgas-api
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
for f in database/migrations/*.sql; do
  echo "        - $(basename "$f")"
  docker exec -i "$DB_CONTAINER" "$SQLCMD" \
    -S localhost -U sa -P "$SA_PASSWORD" -C -d "$DB_NAME" < "$f"
done

echo "==> [4/4] Reiniciando a API ..."
pm2 restart "$PM2_APP"

# A API se recusa a subir sem JWT_SECRET (e outras checagens de configuracao).
# O pm2 restart nao falha nesses casos — ele reporta sucesso e o processo morre
# logo depois. Entao conferimos o estado alguns segundos depois.
sleep 4
if ! pm2 describe "$PM2_APP" | grep -q "status.*online"; then
  echo ""
  echo "!! A API NAO esta online depois do restart."
  echo "!! Veja o motivo com:  pm2 logs $PM2_APP --lines 30"
  exit 1
fi

echo ""
echo "==> Deploy concluido. Confira: https://fullgas.app.br"
echo "    (se algo nao atualizar no navegador, limpe o cache do Cloudflare)"
