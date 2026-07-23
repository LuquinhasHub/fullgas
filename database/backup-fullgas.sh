#!/usr/bin/env bash
# ============================================================
# Backup diário do banco FullgasB2B (SQL Server Express em Docker).
# ------------------------------------------------------------
# O que faz, em ordem:
#   1. BACKUP DATABASE para um .bak DENTRO do container;
#   2. RESTORE VERIFYONLY — confirma que o backup é LEGÍVEL (um backup
#      que não restaura é lixo com nome de seguro);
#   3. copia o .bak para fora do container, para o disco do host;
#   4. remove o temporário de dentro do container;
#   5. comprime com gzip (a edição Express NÃO comprime backup, então
#      o gzip corta ~80% do tamanho no host);
#   6. apaga backups com mais de RETENCAO_DIAS dias.
#
# Roda como root (o docker exige). A senha do SA fica num arquivo
# só-root (SA_PASS_FILE), nunca dentro deste script — por isso ele pode
# ser versionado no Git sem vazar nada.
#
# SQL Server Express não tem SQL Agent, então o agendamento é por cron
# do próprio Ubuntu (ver instruções de instalação no fim deste arquivo).
# ============================================================
set -euo pipefail

CONTAINER=fullgas-sql
DB=FullgasB2B
SA_PASS_FILE=/root/.fullgas_sa_pass        # arquivo com a senha do SA (chmod 600)
DEST=/home/fullgas/backups                 # fica na home do fullgas p/ o scp do PC funcionar
RETENCAO_DIAS=14
SQLCMD=/opt/mssql-tools18/bin/sqlcmd

if [ ! -r "$SA_PASS_FILE" ]; then
  echo "ERRO: não achei/consigo ler $SA_PASS_FILE (a senha do SA)." >&2
  exit 1
fi
SA_PASS=$(cat "$SA_PASS_FILE")

mkdir -p "$DEST"
STAMP=$(date +%F_%H%M%S)
TMP="/var/opt/mssql/${DB}_${STAMP}.bak"    # caminho DENTRO do container
OUT="$DEST/${DB}_${STAMP}.bak"

echo "[$(date '+%F %T')] iniciando backup de $DB"

# 1) backup dentro do container
docker exec -i "$CONTAINER" "$SQLCMD" -S localhost -U SA -P "$SA_PASS" -C -b \
  -Q "BACKUP DATABASE [$DB] TO DISK='$TMP' WITH INIT, FORMAT;"

# 2) o backup é restaurável?
docker exec -i "$CONTAINER" "$SQLCMD" -S localhost -U SA -P "$SA_PASS" -C -b \
  -Q "RESTORE VERIFYONLY FROM DISK='$TMP';"

# 3) tira do container -> host
docker cp "$CONTAINER:$TMP" "$OUT"

# 4) limpa o temporário de dentro do container
docker exec -i "$CONTAINER" rm -f "$TMP"

# 5) comprime e devolve o dono ao fullgas (p/ o scp do PC ler)
gzip -f "$OUT"
chown fullgas:fullgas "${OUT}.gz"

# 6) retenção
find "$DEST" -name "${DB}_*.bak.gz" -type f -mtime +"$RETENCAO_DIAS" -delete

echo "[$(date '+%F %T')] OK: ${OUT}.gz ($(du -h "${OUT}.gz" | cut -f1)) | $(ls -1 "$DEST"/${DB}_*.bak.gz | wc -l) backups guardados"

# ============================================================
# COMO INSTALAR (uma vez, como root no servidor):
#
#   # 1. guardar a senha do SA num arquivo só-root
#   printf '%s' 'SENHA_DO_SA' > /root/.fullgas_sa_pass
#   chmod 600 /root/.fullgas_sa_pass
#
#   # 2. disponibilizar o script
#   cp /var/www/fullgas-app/database/backup-fullgas.sh /usr/local/bin/
#   chmod 700 /usr/local/bin/backup-fullgas.sh
#
#   # 3. testar AGORA (não espere o cron para descobrir que quebrou)
#   /usr/local/bin/backup-fullgas.sh
#
#   # 4. agendar todo dia às 03:00, com log
#   ( crontab -l 2>/dev/null; echo '0 3 * * * /usr/local/bin/backup-fullgas.sh >> /var/log/fullgas-backup.log 2>&1' ) | crontab -
#
# COMO RESTAURAR um backup (ex.: recuperar de um desastre):
#
#   gunzip -k /home/fullgas/backups/FullgasB2B_2026-07-23_030000.bak.gz
#   docker cp /home/fullgas/backups/FullgasB2B_2026-07-23_030000.bak \
#             fullgas-sql:/var/opt/mssql/restore.bak
#   docker exec -i fullgas-sql /opt/mssql-tools18/bin/sqlcmd \
#     -S localhost -U SA -P "SENHA_DO_SA" -C -Q \
#     "ALTER DATABASE [FullgasB2B] SET SINGLE_USER WITH ROLLBACK IMMEDIATE;
#      RESTORE DATABASE [FullgasB2B] FROM DISK='/var/opt/mssql/restore.bak' WITH REPLACE;
#      ALTER DATABASE [FullgasB2B] SET MULTI_USER;"
#   # a API precisa ser reiniciada depois: systemctl restart fullgas-api
# ============================================================
