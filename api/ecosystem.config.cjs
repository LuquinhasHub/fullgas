// ============================================================
// Configuração do PM2 — define como a API roda em PRODUÇÃO.
// O PM2 é o "gerente" que mantém a API no ar 24h: reinicia após
// falhas e sobe sozinho quando o servidor é reiniciado.
//
// Uso (na pasta /var/www/fullgas-app/api):
//   pm2 start ecosystem.config.cjs   -> liga a API em produção
//   pm2 restart fullgas-api          -> aplica novas mudanças
//   pm2 logs fullgas-api             -> ver o que a API está fazendo
//
// Obs.: extensão .cjs porque o projeto usa "type": "module".
// ============================================================
module.exports = {
  apps: [
    {
      name: 'fullgas-api',            // nome que aparece no `pm2 list`
      script: 'src/server.js',        // arquivo que inicia a API
      cwd: '/var/www/fullgas-app/api', // pasta onde a API roda (acha o .env)
      exec_mode: 'fork',              // 1 processo (suficiente p/ este porte)
      instances: 1,
      env: {
        NODE_ENV: 'production',       // <== define o MODO PRODUÇÃO
      },
      max_memory_restart: '500M',     // reinicia se passar de 500MB (segurança)
      autorestart: true,              // se travar, sobe de novo automaticamente
      time: true,                     // carimba data/hora nos logs
    },
  ],
};
