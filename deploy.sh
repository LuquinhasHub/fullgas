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

echo ""
echo "==> Deploy concluido. Confira: https://fullgas.app.br"
echo "    (se algo nao atualizar no navegador, limpe o cache do Cloudflare)"
