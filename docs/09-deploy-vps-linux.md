# Guia de Deploy — VPS Linux (Ubuntu) com SQL Server no próprio servidor

Cenário deste guia:
- **VPS Ubuntu/Debian** (recomendado Ubuntu 22.04 ou 24.04).
- **Banco Microsoft SQL Server rodando no próprio VPS** (via Docker).
- **Domínio .br (Registro.br)** apontado pela **Cloudflare**.
- **Nginx** como porta de entrada: serve o front estático e faz proxy do `/api`
  para a API Node (localhost:3000). Front e API no mesmo domínio → sem dor de
  cabeça com CORS.

> **Requisito de RAM:** o SQL Server sozinho pede ~2 GB. Some a API + Nginx +
> sistema e o VPS deve ter **no mínimo 4 GB de RAM** (2 GB é arriscado, trava).

Arquitetura final:

```
Internet ──HTTPS──> Cloudflare ──HTTPS──> Nginx (VPS :443)
                                            ├─ /            → front estático (/var/www/fullgas)
                                            ├─ /api  ─proxy→ Node API (localhost:3000)
                                            └─ /uploads ─proxy→ Node API (localhost:3000)
                                                                    │
                                                                    └─ SQL Server (Docker, localhost:1433)
```

---

## Parte 1 — Apontar o domínio pela Cloudflare

Você já usa a Cloudflare, então o fluxo é o mesmo dos outros domínios.

### 1.1 Adicionar o domínio na Cloudflare
1. No painel Cloudflare → **Add a site** → digite seu domínio (ex.: `fullgas.com.br`).
2. Escolha o plano **Free**.
3. A Cloudflare mostra **dois nameservers** (ex.: `xxx.ns.cloudflare.com` e
   `yyy.ns.cloudflare.com`). **Anote os dois.**

### 1.2 Trocar os nameservers no Registro.br
1. Entre em https://registro.br → seus domínios → selecione o domínio.
2. Em **DNS** → **Alterar servidores DNS** (ou "Usar outros servidores DNS").
3. Apague os servidores atuais e coloque os **dois nameservers da Cloudflare**.
4. Salve. A propagação leva de alguns minutos até ~24h (geralmente < 1h).

> O Registro.br às vezes exige que os nameservers já respondam pela zona antes
> de aceitar. Se reclamar, aguarde a Cloudflare terminar o "scan" (status
> "Pending" → "Active") e tente de novo.

### 1.3 Criar o registro A (aponta pro IP do VPS)
Na Cloudflare, aba **DNS** → **Add record**:

| Type | Name | Content (IPv4) | Proxy status |
|---|---|---|---|
| A | `@`   | IP_DO_SEU_VPS | Proxied (nuvem laranja) |
| A | `www` | IP_DO_SEU_VPS | Proxied (nuvem laranja) |

- `@` = domínio raiz (`fullgas.com.br`). Se preferir um subdomínio (ex.:
  `portal.fullgas.com.br`), crie um A com Name = `portal`.
- **Proxy ON (laranja)** = a Cloudflare cuida do HTTPS público e esconde o IP.

### 1.4 SSL/TLS na Cloudflare
Aba **SSL/TLS** → **Overview** → modo **Full (strict)**.
(Vamos instalar um certificado de origem no Nginx na Parte 6 pra esse modo funcionar.)

---

## Parte 2 — Preparar o VPS

Conecte via SSH (troque pelo IP/usuário do seu VPS):

```bash
ssh root@IP_DO_SEU_VPS
```

### 2.1 Atualizar e criar um usuário (não use root pra tudo)
```bash
apt update && apt upgrade -y
adduser fullgas            # crie uma senha
usermod -aG sudo fullgas
# opcional: copie sua chave SSH para o novo usuário e passe a usar ele
```

### 2.2 Firewall
```bash
apt install -y ufw
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw enable
```
> Repare que **não** liberamos a porta 1433 (banco) nem a 3000 (API). Elas ficam
> só no localhost — ninguém acessa de fora. Só o Nginx (80/443) fica exposto.

### 2.3 Instalar Docker (para o SQL Server)
```bash
apt install -y docker.io docker-compose-plugin
systemctl enable --now docker
```

### 2.4 Instalar Node.js 20+
```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo bash -
apt install -y nodejs
node --version   # deve mostrar v20.x ou superior
```

### 2.5 Instalar Nginx e Git
```bash
apt install -y nginx git
```

---

## Parte 3 — Banco SQL Server no Docker

### 3.1 Subir o container
Escolha uma senha forte para o usuário `SA` (mínimo 8 caracteres, com maiúscula,
minúscula, número e símbolo). Guarde bem.

```bash
docker run -d --name fullgas-sql \
  --restart unless-stopped \
  -e "ACCEPT_EULA=Y" \
  -e "MSSQL_SA_PASSWORD=SUA_SENHA_SA_FORTE" \
  -p 127.0.0.1:1433:1433 \
  -v fullgas-sqldata:/var/opt/mssql \
  mcr.microsoft.com/mssql/server:2022-latest
```

Explicando o importante:
- `-p 127.0.0.1:1433:1433` → o banco só aceita conexão **de dentro do VPS**.
- `-v fullgas-sqldata:/var/opt/mssql` → volume persistente: os dados sobrevivem
  a reinícios e updates do container.
- `--restart unless-stopped` → sobe sozinho quando o VPS reinicia.

Confira que subiu:
```bash
docker ps                       # deve listar fullgas-sql "Up"
docker logs fullgas-sql | tail  # procure "SQL Server is now ready"
```

### 3.2 Ter o `sqlcmd` à mão
A forma mais simples é usar o `sqlcmd` que já vem dentro do container:
```bash
# um "atalho" pra rodar sqlcmd sem digitar tudo toda vez:
alias fgsql='docker exec -i fullgas-sql /opt/mssql-tools18/bin/sqlcmd -S localhost -U SA -P "SUA_SENHA_SA_FORTE" -C'
fgsql -Q "SELECT @@VERSION"
```
> `-C` confia no certificado autoassinado do container. Se a imagem for antiga e
> não tiver `mssql-tools18`, troque por `/opt/mssql-tools/bin/sqlcmd` (sem `-C`).

### 3.3 Enviar os scripts do projeto pro VPS
Do **seu PC** (não do VPS), copie a pasta `database/`:
```bash
scp -r database fullgas@IP_DO_SEU_VPS:/home/fullgas/database
```

### 3.4 Criar o banco, tabelas, seeds e o usuário da aplicação
No VPS, rode **nesta ordem** (usando o `fgsql` do passo 3.2):
```bash
cd /home/fullgas/database
fgsql -i fullgas_schema_sqlserver.sql
# depois TODAS as migrações, em ordem numérica:
for f in $(ls migrations/*.sql | sort); do echo ">> $f"; fgsql -i "$f"; done
fgsql -i fullgas_seeds.sql
fgsql -i criar_usuario_app.sql        # cria o usuário fullgas_app
```

> **Encoding:** alguns arquivos de migração usam acentos (NCHAR). Se aparecer
> caractere estranho, garanta que a cópia `scp` não converteu o arquivo. Em
> geral funciona direto.

### 3.5 (Opcional) Migrar os dados que você já tem no PC
Se quiser levar os dados atuais do seu SQL Server local (e não só recomeçar do
seed), o caminho mais direto é exportar um **.bacpac** pelo SSMS no seu PC
(botão direito no banco → Tasks → Export Data-tier Application), copiar pro VPS
e importar. Como boa parte do catálogo vem do **Tiny** (sincroniza sozinho pela
API), muita gente prefere só rodar schema+seeds e deixar o Tiny repovoar. Decida
conforme sua necessidade.

---

## Parte 4 — Subir a API (Node)

### 4.1 Clonar o código
```bash
sudo mkdir -p /var/www && sudo chown fullgas:fullgas /var/www
cd /var/www
git clone SEU_REPOSITORIO_GIT fullgas-app
cd fullgas-app/api
npm install --omit=dev
```

### 4.2 Criar o arquivo `.env` da API
```bash
nano /var/www/fullgas-app/api/.env
```
Conteúdo (troque as senhas e o domínio):
```env
# Banco (SQL Server no Docker, mesmo VPS)
DB_SERVER=localhost
DB_PORT=1433
DB_NAME=FullgasB2B
DB_USER=fullgas_app
DB_PASSWORD=SENHA_DO_fullgas_app
DB_ENCRYPT=false
DB_TRUST_CERT=true

# API
PORT=3000
CORS_ORIGIN=https://SEU_DOMINIO           # ex.: https://fullgas.com.br
JWT_SECRET=COLE_UMA_CHAVE_LONGA_AQUI
JWT_EXPIRES=8h

# Tiny ERP (se usar a integração; senão deixe em branco)
TINY_TOKEN=
TINY_SYNC_INTERVALO_MIN=30
TINY_EXPORTAR_PEDIDOS=true
TINY_SINCRONIZAR_CLIENTES=true
```

Gere o `JWT_SECRET` com:
```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

> A senha do `fullgas_app` é a que está dentro de `criar_usuario_app.sql`. Se
> quiser, edite lá antes de rodar o script (passo 3.4) e use a mesma aqui.

### 4.3 Rodar a API como serviço (systemd) — sobe sozinha e reinicia
```bash
sudo nano /etc/systemd/system/fullgas-api.service
```
```ini
[Unit]
Description=Fullgas API
After=network.target docker.service

[Service]
Type=simple
User=fullgas
WorkingDirectory=/var/www/fullgas-app/api
ExecStart=/usr/bin/node src/server.js
Restart=always
RestartSec=5
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```
```bash
sudo systemctl daemon-reload
sudo systemctl enable --now fullgas-api
sudo systemctl status fullgas-api          # deve estar "active (running)"
curl http://localhost:3000/api/health      # deve responder {"ok":true}
```
Logs quando precisar:
```bash
journalctl -u fullgas-api -f
```

---

## Parte 5 — Frontend + Nginx

### 5.1 Ajustar a URL da API no front
No **seu PC**, edite `frontend/js/config.js`, a linha `API_PRODUCAO`. Como front
e API ficam no mesmo domínio (atrás do Nginx), o mais robusto é usar caminho
relativo:
```js
var API_PRODUCAO = '/api';
```
Faça commit/push (ou edite direto no VPS depois de copiar).

### 5.2 Copiar o front pro VPS
```bash
sudo mkdir -p /var/www/fullgas
sudo cp -r /var/www/fullgas-app/frontend/* /var/www/fullgas/
sudo chown -R www-data:www-data /var/www/fullgas
```

### 5.3 Configurar o Nginx
```bash
sudo nano /etc/nginx/sites-available/fullgas
```
```nginx
server {
    listen 80;
    server_name SEU_DOMINIO www.SEU_DOMINIO;   # ex.: fullgas.com.br www.fullgas.com.br

    root /var/www/fullgas;
    index index.html;

    # uploads (fotos de reivindicação, anexos de notificação) até 60 MB
    client_max_body_size 64M;

    # front estático
    location / {
        try_files $uri $uri/ =404;
    }

    # API → Node na porta 3000
    location /api/ {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # arquivos enviados (servidos pela API)
    location /uploads/ {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
    }
}
```
```bash
sudo ln -s /etc/nginx/sites-available/fullgas /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t          # testa a config
sudo systemctl reload nginx
```

Neste ponto, acessando `http://SEU_DOMINIO` já deve abrir o site (a Cloudflare
força HTTPS na frente). Falta o certificado de origem pro modo Full (strict).

---

## Parte 6 — HTTPS (certificado de origem da Cloudflare)

Como o domínio está **proxied** na Cloudflare, o jeito mais simples é usar um
**Origin Certificate** da própria Cloudflare (vale 15 anos, sem renovação).

1. Cloudflare → **SSL/TLS** → **Origin Server** → **Create Certificate**.
2. Deixe o padrão (RSA, `*.SEU_DOMINIO` e `SEU_DOMINIO`) → **Create**.
3. Copie os dois blocos exibidos.

No VPS:
```bash
sudo mkdir -p /etc/nginx/ssl
sudo nano /etc/nginx/ssl/fullgas.pem   # cole o "Origin Certificate"
sudo nano /etc/nginx/ssl/fullgas.key   # cole a "Private Key"
sudo chmod 600 /etc/nginx/ssl/fullgas.key
```

Ajuste o server block para 443:
```bash
sudo nano /etc/nginx/sites-available/fullgas
```
Troque a primeira linha `listen 80;` por um bloco HTTPS e um redirect:
```nginx
server {
    listen 80;
    server_name SEU_DOMINIO www.SEU_DOMINIO;
    return 301 https://$host$request_uri;      # tudo vai pra HTTPS
}

server {
    listen 443 ssl;
    server_name SEU_DOMINIO www.SEU_DOMINIO;

    ssl_certificate     /etc/nginx/ssl/fullgas.pem;
    ssl_certificate_key /etc/nginx/ssl/fullgas.key;

    root /var/www/fullgas;
    index index.html;
    client_max_body_size 64M;

    location / { try_files $uri $uri/ =404; }
    location /api/ {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
    location /uploads/ {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
    }
}
```
```bash
sudo nginx -t && sudo systemctl reload nginx
```

Pronto: `https://SEU_DOMINIO` abre com cadeado. Login inicial:
`admin@fullgas.com.br` / `admin123` (troque a senha depois).

---

## Parte 7 — Manutenção

**Atualizar o código (novo deploy):**
```bash
cd /var/www/fullgas-app
git pull
cd api && npm install --omit=dev
sudo systemctl restart fullgas-api
# se mexeu no front:
sudo cp -r /var/www/fullgas-app/frontend/* /var/www/fullgas/
```
> Ao mexer no front, lembre de subir o `?v=` dos `<link>`/`<script>` (o projeto
> já usa isso pra furar cache do navegador).

**Nova mudança no banco:** crie uma migração numerada em `database/migrations/` e
rode com o `fgsql -i migrations/0XX_....sql` (nunca edite o schema original).

**Backup do banco (faça periodicamente):**
```bash
docker exec fullgas-sql /opt/mssql-tools18/bin/sqlcmd -S localhost -U SA \
  -P "SUA_SENHA_SA_FORTE" -C -Q \
  "BACKUP DATABASE FullgasB2B TO DISK='/var/opt/mssql/backup/fullgas.bak' WITH INIT"
# copie o arquivo pra fora do VPS:
docker cp fullgas-sql:/var/opt/mssql/backup/fullgas.bak ./fullgas-$(date +%F).bak
```

**Logs:**
```bash
journalctl -u fullgas-api -f      # API
docker logs -f fullgas-sql        # banco
sudo tail -f /var/log/nginx/error.log
```

---

## Checklist rápido

- [ ] Nameservers da Cloudflare configurados no Registro.br (domínio "Active")
- [ ] Registro A `@`/`www` → IP do VPS, proxied; SSL/TLS = Full (strict)
- [ ] Firewall: só 22/80/443 abertos
- [ ] Docker rodando o SQL Server com volume persistente
- [ ] Schema + migrações + seeds + `fullgas_app` aplicados
- [ ] `.env` da API preenchido (banco local, JWT, CORS = seu domínio)
- [ ] `fullgas-api` como serviço systemd, `/api/health` responde
- [ ] `config.js` com `API_PRODUCAO = '/api'`
- [ ] Nginx servindo front + proxy `/api` e `/uploads`, `client_max_body_size 64M`
- [ ] Certificado de origem instalado, HTTPS com cadeado
- [ ] Rotina de backup do banco definida
