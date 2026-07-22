# Guia de Deploy — VPS Linux (Ubuntu) com SQL Server no próprio servidor

Cenário deste guia:
- **VPS Ubuntu/Debian** (recomendado Ubuntu 22.04 ou 24.04).
- **Banco Microsoft SQL Server rodando no próprio VPS** (via Docker).
- **Domínio .br (Registro.br)** apontado pela **Cloudflare**.
- **Nginx** como porta de entrada: serve o front estático e faz proxy do `/api`
  para a API Node (localhost:3000). Front e API no mesmo domínio → sem dor de
  cabeça com CORS.

## Servidor de destino (HostGator — VPS OCI NVMe 4)

| Item | Valor |
|---|---|
| IP | `143.95.221.45` (São Paulo) |
| SSH | usuário `root`, **porta 22022** (não é a 22 padrão) |
| CPU / RAM | 2 vCPU / **4 GB** |
| Disco | 100 GB NVMe |
| Sistema | Ubuntu 22.04 |

> **Sobre os 4 GB:** é exatamente o mínimo. Por isso este guia usa a edição
> **Express** do SQL Server, que se limita sozinha a ~1,4 GB de buffer — o que
> aqui é uma vantagem — e manda criar **swap** como rede de segurança. Sem esses
> dois cuidados o servidor fica sujeito a travar sob carga.
>
> A Express também é a edição **legalmente correta** para produção: a Developer
> Edition usada na máquina de desenvolvimento é gratuita mas proibida fora de
> teste. O limite da Express é 10 GB por banco — o banco atual tem 144 MB.

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
1. No painel Cloudflare → **Add a site** → digite seu domínio (ex.: `fullgas.app.br`).
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
| A | `@`   | 143.95.221.45 | Proxied (nuvem laranja) |
| A | `www` | 143.95.221.45 | Proxied (nuvem laranja) |

- `@` = domínio raiz (`fullgas.app.br`). Se preferir um subdomínio (ex.:
  `portal.fullgas.app.br`), crie um A com Name = `portal`.
- **Proxy ON (laranja)** = a Cloudflare cuida do HTTPS público e esconde o IP.

### 1.4 SSL/TLS na Cloudflare
Aba **SSL/TLS** → **Overview** → modo **Full (strict)**.
(Vamos instalar um certificado de origem no Nginx na Parte 6 pra esse modo funcionar.)

---

## Parte 2 — Preparar o VPS

Conecte via SSH — **a porta é 22022**, não a 22:

```bash
ssh -p 22022 root@143.95.221.45
```

### 2.0 Conferir o terreno antes de instalar qualquer coisa
```bash
free -h                 # RAM disponível
nproc                   # núcleos
df -h /                 # disco
lsb_release -a          # deve dizer Ubuntu 22.04
systemd-detect-virt     # 'kvm' = Docker roda liso; 'openvz'/'lxc' = me avise
```

### 2.1 Atualizar e criar um usuário (não use root pra tudo)
```bash
apt update && apt upgrade -y
adduser fullgas            # crie uma senha
usermod -aG sudo fullgas
# opcional: copie sua chave SSH para o novo usuário e passe a usar ele
```

### 2.2 Swap — obrigatório neste VPS (4 GB de RAM)
Com SQL Server + Node + Nginx em 4 GB, um pico de uso sem swap resulta no
kernel **matando** o processo que mais consome memória — normalmente o banco.
2 GB de swap custam disco (sobram 100 GB) e evitam isso:

```bash
fallocate -l 2G /swapfile
chmod 600 /swapfile
mkswap /swapfile
swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab   # sobrevive ao reboot
free -h                                            # confira a linha "Swap"
```

### 2.3 Firewall
```bash
apt install -y ufw
ufw allow 22022/tcp        # ATENÇÃO: a porta do SSH aqui é 22022
ufw allow 80/tcp
ufw allow 443/tcp
ufw enable
```
> **Cuidado:** liberar `OpenSSH` (porta 22) em vez de `22022` te tranca para
> fora do servidor. Confira com `ufw status` **antes** de encerrar a sessão, e
> mantenha uma segunda janela SSH aberta enquanto testa.
>
> Repare que **não** liberamos a porta 1433 (banco) nem a 3000 (API). Elas ficam
> só no localhost — ninguém acessa de fora. Só o Nginx (80/443) fica exposto.

### 2.4 Instalar Docker (para o SQL Server)
```bash
apt install -y docker.io docker-compose-plugin
systemctl enable --now docker
```

### 2.5 Instalar Node.js 20+
```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo bash -
apt install -y nodejs
node --version   # deve mostrar v20.x ou superior
```

### 2.6 Instalar Nginx e Git
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
  -e "MSSQL_PID=Express" \
  -e "MSSQL_SA_PASSWORD=SUA_SENHA_SA_FORTE" \
  -e "MSSQL_MEMORY_LIMIT_MB=2048" \
  -p 127.0.0.1:1433:1433 \
  -v fullgas-sqldata:/var/opt/mssql \
  mcr.microsoft.com/mssql/server:2022-latest
```

Explicando o importante:
- `MSSQL_PID=Express` → edição **gratuita e liberada para produção** (limite de
  10 GB por banco; o nosso tem 144 MB). Sem esta linha o container sobe como
  Developer/Evaluation, que **não pode** ser usado em produção.
- `MSSQL_MEMORY_LIMIT_MB=2048` → teto de memória. Em um VPS de 4 GB, deixar o
  SQL Server à vontade faz ele engolir a RAM e sufocar a API.
- `-p 127.0.0.1:1433:1433` → o banco só aceita conexão **de dentro do VPS**.
- `-v fullgas-sqldata:/var/opt/mssql` → volume persistente: os dados sobrevivem
  a reinícios e updates do container.
- `--restart unless-stopped` → sobe sozinho quando o VPS reinicia.

Confirme a edição depois que subir:
```bash
docker exec -i fullgas-sql /opt/mssql-tools18/bin/sqlcmd \
  -S localhost -U SA -P "SUA_SENHA_SA_FORTE" -C \
  -Q "SELECT SERVERPROPERTY('Edition')"      # deve dizer "Express Edition"
```

Confira que subiu:
```bash
docker ps                       # deve listar fullgas-sql "Up"
docker logs fullgas-sql | tail  # procure "SQL Server is now ready"
```

### 3.2 Ter o `sqlcmd` à mão
A forma mais simples é usar o `sqlcmd` que já vem dentro do container:
```bash
# um "atalho" pra rodar sqlcmd sem digitar tudo toda vez.
# O -f 65001 NÃO é opcional — veja o aviso no passo 3.4.
alias fgsql='docker exec -i fullgas-sql /opt/mssql-tools18/bin/sqlcmd -S localhost -U SA -P "SUA_SENHA_SA_FORTE" -C -f 65001'
fgsql -Q "SELECT @@VERSION"
```
> `-C` confia no certificado autoassinado do container. Se a imagem for antiga e
> não tiver `mssql-tools18`, troque por `/opt/mssql-tools/bin/sqlcmd` (sem `-C`).

> ### ⚠️ Arquivo vai por `<`, nunca por `-i`
>
> O `fgsql` executa o sqlcmd **dentro do container**, e o container não enxerga
> o disco do servidor. Passar `-i /var/www/.../arquivo.sql` faz o sqlcmd
> procurar esse caminho no sistema de arquivos **dele**, que não existe:
>
> ```
> Sqlcmd: 'fullgas_schema_sqlserver.sql': Invalid filename.
> ```
>
> O jeito certo é mandar o conteúdo pela entrada padrão — o `docker exec -i`
> repassa o stdin e o sqlcmd lê comandos dali quando não recebe `-i`:
>
> ```bash
> fgsql < arquivo.sql            # ✅
> fgsql -i arquivo.sql           # ❌ Invalid filename
> ```

### 3.3 Ter os scripts no servidor
Eles vêm junto no `git clone` da Parte 4 — a pasta é
`/var/www/fullgas-app/database`. Se preferir adiantar o banco antes de clonar,
copie só ela, do **seu PC**:
```bash
scp -P 22022 -r database fullgas@143.95.221.45:/home/fullgas/database
```

### 3.4 Criar o banco, tabelas, seeds e o usuário da aplicação
> ### ⚠️ Encoding — leia antes de rodar
>
> O `sqlcmd` lê os arquivos **como ANSI** por padrão e **corrompe os acentos**:
> `'Nota de crédito'` vira `'Nota de crǸdito'`. O efeito não é estético — as
> `CHECK constraints` nascem com o texto errado, ou o `ALTER TABLE` falha
> dizendo que os dados violam a regra, deixando a tabela **sem** a constraint.
>
> Isto foi reproduzido e medido: sem `-f 65001`, 7 arquivos falham; com ele,
> zero. O `-f 65001` já está no atalho `fgsql` do passo 3.2 — **não remova**.
>
> Como conferir depois que rodar (o acento tem que aparecer certo):
> ```bash
> fgsql -d FullgasB2B -Q "SELECT definition FROM sys.check_constraints WHERE name='CK_Fatura_Tipo'"
> # esperado:  ([Tipo]='Nota de crédito' OR [Tipo]='Fatura')
> ```

No VPS, rode **nesta ordem** (usando o `fgsql` do passo 3.2):
```bash
cd /var/www/fullgas-app/database
fgsql < fullgas_schema_sqlserver.sql

# TODAS as migrações, em ordem numérica, parando no primeiro erro:
for f in $(ls migrations/*.sql | sort); do
  echo ">> $f"
  fgsql -b < "$f" || { echo "FALHOU em $f — pare e investigue"; break; }
done

fgsql < criar_usuario_app.sql        # cria o usuário fullgas_app

# Parts Finder: modelos e seções (estrutura + diagramas), sem os produtos.
fgsql -d FullgasB2B < seed_partsfinder.sql
```

> **Seeds:** `fullgas_seeds.sql` traz dados de demonstração (empresas e
> reivindicações de exemplo). Em produção, **pule** — o admin inicial é criado
> no passo 4.4, sem lixo junto.

### 3.5 Copiar os diagramas do Parts Finder
O `seed_partsfinder.sql` grava o **caminho** das imagens, não as imagens. Sem os
arquivos, as seções aparecem sem diagrama. Do **seu PC**:

```bash
scp -P 22022 -r api/uploads/finder fullgas@143.95.221.45:/var/www/fullgas-app/api/uploads/
```

> São ~3,6 MB (19 arquivos). As outras pastas de `uploads/` (reivindicações,
> produtos, notificações) são dados de teste — **não** precisam ir.
>
> Confira depois: `ls /var/www/fullgas-app/api/uploads/finder | wc -l` → 19.

> **`|| break`:** sem isso o laço segue adiante depois de uma falha e você
> termina com um banco pela metade sem perceber. As migrações são idempotentes,
> então é seguro corrigir o problema e rodar o laço de novo do começo.

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
git clone https://github.com/LuquinhasHub/fullgas.git fullgas-app
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
CORS_ORIGIN=https://fullgas.app.br           # ex.: https://fullgas.app.br
JWT_SECRET=COLE_UMA_CHAVE_LONGA_AQUI
JWT_EXPIRES=8h

# Tiny ERP (se usar a integração; senão deixe em branco)
TINY_TOKEN=
TINY_SYNC_INTERVALO_MIN=30
TINY_EXPORTAR_PEDIDOS=true
TINY_SINCRONIZAR_CLIENTES=true

# E-mail (recuperação de senha). Gmail: senha de APP, não a senha da conta.
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=
SMTP_USER=fullgasbrasil.oficial@gmail.com
SMTP_PASS=SENHA_DE_APP_DO_GMAIL
SMTP_FROM=Fullgas B2B <fullgasbrasil.oficial@gmail.com>

# OBRIGATÓRIO em produção: é a base do link enviado por e-mail.
# Deixar vazio aqui faz o link seguir a origem da requisição — aceitável em
# desenvolvimento, mas em produção o valor tem de ser fixo e explícito.
APP_URL=https://fullgas.app.br
```

> **Sem `SMTP_HOST` a API não envia nada** — ela imprime o e-mail no log e
> segue. O cliente pede "esqueci minha senha" e nunca recebe. Confira depois de
> subir:
> ```bash
> journalctl -u fullgas-api | grep -i "E-MAIL NÃO ENVIADO"   # não deve achar nada
> ```

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

### 4.4 Criar o primeiro administrador — **não pule**
Banco novo (sem os seeds) não tem usuário **nenhum**. E o cadastro pela tela
nasce como `pendente`, esperando aprovação de um admin — que também não existe.
Sem este passo o portal fica trancado por fora.

```bash
cd /var/www/fullgas-app/api
node scripts/criar-admin.mjs "Seu Nome" "voce@fullgas.com.br" "UmaSenhaForte123"
```

O script cria a empresa matriz se ela ainda não existir, grava o hash bcrypt da
senha (a senha em si não fica em lugar nenhum) e já marca a conta como
`admin` + `aprovado`. Rodar de novo com o mesmo e-mail **atualiza a senha** em
vez de duplicar — serve como "esqueci a senha do admin".

> A senha vai como argumento e fica no histórico do shell. Para apagar:
> ```bash
> history -d $(history 1)
> ```
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
    server_name fullgas.app.br www.fullgas.app.br;   # ex.: fullgas.app.br

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

Neste ponto, acessando `http://fullgas.app.br` já deve abrir o site (a Cloudflare
força HTTPS na frente). Falta o certificado de origem pro modo Full (strict).

---

## Parte 6 — HTTPS (certificado de origem da Cloudflare)

Como o domínio está **proxied** na Cloudflare, o jeito mais simples é usar um
**Origin Certificate** da própria Cloudflare (vale 15 anos, sem renovação).

1. Cloudflare → **SSL/TLS** → **Origin Server** → **Create Certificate**.
2. Deixe o padrão (RSA, `*.fullgas.app.br` e `fullgas.app.br`) → **Create**.
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
    server_name fullgas.app.br www.fullgas.app.br;
    return 301 https://$host$request_uri;      # tudo vai pra HTTPS
}

server {
    listen 443 ssl;
    server_name fullgas.app.br www.fullgas.app.br;

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

Pronto: `https://fullgas.app.br` abre com cadeado. Login inicial:
o e-mail e a senha que você definiu no passo 4.4.

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
rode com o `fgsql < migrations/0XX_....sql` (nunca edite o schema original).

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
