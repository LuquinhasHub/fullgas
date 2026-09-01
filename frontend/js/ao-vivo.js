/* =========================================================
   FULLGAS B2B — O batimento que deixa o portal "ao vivo"
   ---------------------------------------------------------
   O PROBLEMA QUE ISTO RESOLVE: até aqui, as telas eram desenhadas uma vez e
   ficavam paradas. O suporte respondia um chamado e o revendedor só descobria
   ao recarregar a página — a carta ✉️ do topo continuava apagada, o badge 🎧
   do pop-up só conferia de 3 em 3 minutos, e a conversa aberta na tela não
   ganhava a mensagem nova nunca.

   O QUE ISTO É: um relógio. De 10 em 10 segundos ele pergunta ao servidor
   (GET /api/pulso) quatro números — quantas notificações não lidas, quantos
   chamados abertos, quantas mensagens não vistas e qual o id da última
   mensagem. Compara com os números da volta anterior e, SE algo mudou,
   dispara o evento `fg-pulso` na janela.

   O QUE ISTO NÃO É: não desenha nada e não sabe o que existe na tela. Quem
   ouve o evento decide o que fazer com ele (portal.js acende a carta e
   completa a conversa; admin.js acende o contador da barra lateral;
   suporte.js pinta o badge do pop-up). Isso é de propósito: o relógio existe
   uma vez só, mesmo com três telas diferentes o usando.

   POR QUE PERGUNTAR EM VEZ DE O SERVIDOR AVISAR: um servidor que empurra
   (WebSocket, SSE) precisa de conexão aberta por aba, de configuração no
   Nginx e de a Cloudflare não cortar o fio no meio. Perguntar quatro números
   a cada 10s custa quase nada e não depende de nenhuma dessas peças — se a
   rede falhar, o batimento seguinte conserta sozinho.

   Inclua DEPOIS de js/api-adapter.js:
     <script src="js/api-adapter.js"></script>
     <script src="js/ao-vivo.js"></script>
   ========================================================= */
(function () {
  'use strict';

  if (!window.FG || !FG.pulso || !FG.session || !FG.session()) return;

  // 10 segundos: rápido o bastante para o revendedor sentir como "chegou
  // agora", devagar o bastante para o servidor nem perceber. Cada batida é
  // uma consulta só no banco e ~80 bytes de resposta.
  var INTERVALO = 10 * 1000;

  var anterior = null;    // último pulso conhecido (null = ainda não bateu)
  var emVoo = false;      // já existe uma pergunta sem resposta?

  function bater() {
    // Aba escondida não pergunta nada: computador esquecido aberto a noite
    // inteira não precisa conversar com o servidor. Ao voltar para a aba, o
    // 'visibilitychange' lá embaixo bate NA HORA — quem volta vê o estado
    // certo imediatamente, sem esperar os 10 segundos.
    if (document.visibilityState !== 'visible') return;

    // Uma resposta lenta não pode virar uma fila de perguntas empilhadas.
    if (emVoo) return;
    emVoo = true;

    FG.pulso().then(function (p) {
      emVoo = false;
      if (!p) return;                       // falha de rede: tenta na próxima

      var antes = anterior;
      anterior = p;

      // Primeira batida: não há "antes" para comparar. A tela acabou de ser
      // desenhada com estes mesmos números, então não há novidade a anunciar
      // — avisar aqui faria toda página piscar um alerta ao abrir.
      if (!antes) return;

      var mudou = {
        notificacoes: p.notificacoes !== antes.notificacoes,
        // "suporte" é qualquer sinal de que a conversa andou: contadores que
        // mexeram OU uma mensagem nova (mudança de status e mensagem que o
        // próprio usuário enviou de outra aba não mexem contador nenhum, mas
        // mudam o fio).
        suporte: p.suporteNaoLidas !== antes.suporteNaoLidas ||
                 p.suporteAbertos !== antes.suporteAbertos ||
                 p.ultimaMensagem !== antes.ultimaMensagem,
        // Subiu (chegou algo) x desceu (o usuário leu, talvez em outra aba).
        // Quem quiser tocar um som ou piscar um ícone só deve fazê-lo quando
        // SOBE — piscar porque o número caiu seria alarme ao contrário.
        chegouNotificacao: p.notificacoes > antes.notificacoes,
        chegouMensagem: p.ultimaMensagem > antes.ultimaMensagem
      };

      if (!mudou.notificacoes && !mudou.suporte) return;

      window.dispatchEvent(new CustomEvent('fg-pulso', {
        detail: { pulso: p, antes: antes, mudou: mudou }
      }));
    }, function () {
      emVoo = false;                        // apiGet não rejeita, mas garantimos
    });
  }

  /* Força uma batida imediata. As telas chamam isto DEPOIS de uma ação que
     muda os números (enviar resposta, abrir um chamado), para o resto da
     interface acompanhar sem esperar o próximo ciclo. */
  function agora() {
    emVoo = false;
    bater();
  }

  /* O snapshot mais recente, para quem abre a tela no meio do caminho. */
  function ultimo() { return anterior; }

  FG.aoVivo = { agora: agora, ultimo: ultimo, intervalo: INTERVALO };

  // Primeira batida imediata: ela não anuncia nada (não há "antes"), serve só
  // para estabelecer a linha de base contra a qual as próximas comparam.
  bater();
  setInterval(bater, INTERVALO);

  // Voltar para a aba depois de um tempo fora é justamente quando há mais
  // chance de ter novidade acumulada. Não faz sentido esperar o relógio.
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible') bater();
  });
})();
