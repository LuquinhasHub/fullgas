# Suporte Técnico — helpdesk por chamados

> **Audiência**: quem for mexer nesta parte depois (humano ou Claude Code).
> Feature entregue no branch `feat/suporte-tecnico`.

## O que é

Canal de atendimento entre o revendedor e a Fullgas **dentro do portal**, em
formato de **chamado** (ticket) — não de chat ao vivo. O revendedor escreve, o
chamado ganha um número, e a resposta chega quando o suporte responder. Nada
depende de ter alguém do outro lado no mesmo instante, e a conversa inteira
fica guardada.

Duas portas para os mesmos dados:

| Onde | O que faz |
| --- | --- |
| **Pop-up flutuante** (🎧, canto inferior direito) | Abre chamado de qualquer tela e avisa quando há resposta. Presente em portal, loja, Parts Finder e finder de uso. |
| **Aba "Suporte Técnico"** (portal, ao lado de "Conta financeira") | Lista todos os chamados e é onde a conversa acontece. |
| **Barra lateral do painel admin** ("Suporte") | A fila do atendente: filtros, resposta e mudança de status. |

O botão "Abrir chamado" da aba do portal **chama o pop-up** (`FG.suporteWidget
.abrirFormulario()`). O formulário existe em um lugar só, de propósito.

## Categorias de ajuda

Espelham as **áreas do portal** — é assim que o revendedor pensa o problema
("minha conta financeira", e não "erro na rota de faturas"). Ficam em
`api/src/utils/suporte.js`, **não** em tabela: mudam junto com o portal, com o
deploy, e o banco guarda só o `codigo`. Área nova no portal → categoria nova
ali, sem migração.

## Ciclo de vida do chamado

```
Aberto ─────────────► Em atendimento ◄──────► Aguardando cliente
   │                        │                        │
   └────────────────────────┴────────► Resolvido ────┘
                                           │
                                           ▼
                                       Fechado   (não recebe mais mensagem)
```

- **Quem falou por último perde a bola**: resposta do suporte → `Aguardando
  cliente`; resposta do revendedor → `Em atendimento` (ou continua `Aberto`, se
  ninguém tinha tocado no chamado ainda).
- **Responder em `Resolvido` reabre** o chamado. É o caso que existe para
  valer: o suporte considerou encerrado e o revendedor discorda — sem isso o
  chamado morreria como resolvido com uma pergunta pendente dentro.
- **`Fechado` recusa mensagem** (409). O revendedor reabre pela tela.
- O revendedor só move para `Fechado` e `Aberto`; o resto é do suporte
  (`clientePodeMudarStatus`). Toda mudança de status vira uma mensagem de autor
  `sistema` no fio da conversa.

As regras acima são funções puras em `api/src/utils/suporte.js`, cobertas por
`api/tests/suporte.test.js` (`npm test` na pasta `api`).

## Estrutura

**Banco** (migrações `035_suporte_chamados.sql` e `036_notificacao_suporte.sql`,
idempotentes e 100% ASCII nos
literais — o laço de migrations do `deploy.sh` roda `sqlcmd <` sem `-f 65001`):

- `dbo.SuporteChamado` — empresa, autor, categoria, assunto, prioridade,
  status, atendente, carimbos.
- `dbo.SuporteMensagem` — a conversa. `Autor` é `cliente` | `admin` |
  `sistema`; anexo opcional; `LidaClienteEm` / `LidaAdminEm` marcam a leitura
  **por lado** (é o que alimenta os contadores).

Não há sequência nova: o número mostrado (`CH-000123`) é derivado do
`ChamadoId` por `numeroChamado()`. Sequência exigiria `GRANT UPDATE` para o
`fullgas_app`; tabela nova o `db_datawriter` já cobre.

**API** (`api/src/routes/suporte.routes.js`, montada em `/api`):

| Rota | Quem | O que faz |
| --- | --- | --- |
| `GET /suporte/categorias` | autenticado | lista de categorias |
| `GET /suporte/resumo` | autenticado | `{ abertos, naoLidas }` do badge |
| `GET /suporte/chamados[?status=]` | cliente: da sua empresa; admin: todas | lista |
| `POST /suporte/chamados` | **só cliente** | abre (multipart, anexo opcional) |
| `GET /suporte/chamados/:id` | escopo de empresa | detalhe + conversa, e **marca como lidas** as mensagens do outro lado |
| `POST /suporte/chamados/:id/mensagens` | ambos | responde (multipart) |
| `PATCH /suporte/chamados/:id` | ambos, com regras | muda o status |

O administrador **não abre** chamado (403): quem abre é a concessionária, ele
responde pelo painel.

**Anexos**: gravados em `api/uploads/suporte/`, servidos por
`/api/arquivos/suporte/:nome`, que confere no banco de que empresa é o chamado
— nunca pelo estático de `/uploads`. No front, o HTML marca esses elementos com
`data-arquivo` e `FG.carregarArquivos()` os busca com a sessão.

**Front**: `frontend/js/suporte.js` (pop-up), seção *Suporte Técnico* em
`portal.js` e em `admin.js`, funções `FG.suporte*` em `api-adapter.js`, estilos
no fim de `frontend/css/styles.css`.

Os chamados **não entram no cache do `FG`** que carrega junto com a página: são
buscados na hora. Conversa envelhece rápido demais — resposta do suporte em
cache seria resposta que o revendedor só vê ao recarregar.

## Ligação com as notificações (o ícone de carta)

Toda mensagem de chamado vira uma notificação **para o lado oposto** ao de quem
falou — ninguém é avisado da própria mensagem:

| Aconteceu | Quem recebe | Título |
| --- | --- | --- |
| Revendedor abre o chamado | suporte | `Nova mensagem no chamado CH-000012` |
| Revendedor responde | suporte | idem |
| Suporte responde | a concessionária do chamado | `Resposta do suporte no chamado CH-000012` |

Mudança de status **não** gera notificação (ela já aparece como linha do
`sistema` dentro da conversa) — foi uma escolha, para a carta não virar log.

A migração **036** deu três colunas a `dbo.Notificacao`, e elas resolvem um
problema que só existe agora que a caixa tem dois sentidos:

- `Publico` — **para quem é**: `cliente` ou `admin`. Sem isto não há como
  avisar o administrador: `EmpresaId IS NULL` já quer dizer "todas as
  concessionárias", e ele enxerga tudo o que é delas.
- `Origem` — **quem gerou**: `admin` (escrita à mão no painel) ou `suporte`
  (automática). É o que mantém a tabela "Enviadas" do painel sendo a caixa de
  **saída** do administrador (`admin.js` filtra `origem !== 'suporte'`).
- `ChamadoId` — dá o link "Abrir chamado" na notificação e permite marcá-la
  como lida quando o usuário abre o chamado.

Os `DEFAULT` (`cliente` + `admin`) descrevem exatamente as linhas que já
existiam, então o `POST /notificacoes` manual continua igual, sem tocar em nada.

**Quem vê o quê** (constante `VISIVEL_PARA` em `notificacoes.routes.js`, usada
pelo `GET` e pelo `PATCH .../lida` — uma cópia divergente deixaria alguém
marcando como lida uma notificação que não pode nem ver):

```
cliente → Publico='cliente' E (EmpresaId IS NULL OU EmpresaId = a sua)
admin   → Publico='admin' OU Origem='admin'   (o que é para o suporte + o que ele mandou)
```

**Os dois contadores zeram juntos.** Abrir o chamado marca como lidas, no mesmo
gesto, as mensagens (badge 🎧) e as notificações daquele chamado (carta ✉️) —
`marcarNotificacoesDoChamadoLidas` em `api/src/notificacoes.js`. No front,
`supMudou()` recarrega os dois. Sem isso a carta ficaria acesa apontando para
uma conversa que o usuário acabou de ler.

Notificar **nunca derruba** a mensagem que está sendo notificada: as funções de
`api/src/notificacoes.js` engolem o próprio erro e devolvem `true`/`false` — a
mesma regra do histórico do veículo (`registrarEvento`).

O administrador lê essa caixa **no portal** (ícone ✉️); no painel ele tem o
contador do item "Suporte" na barra lateral. O painel não tem caixa de entrada
própria.

## Eventos entre as telas

Dois eventos de janela, e a diferença importa:

- `fg-suporte-mudou` → **só atualiza o badge** do pop-up. Disparado pela aba do
  portal ao abrir/responder/mudar status.
- `fg-suporte-novo` → **manda redesenhar** a lista da aba do portal. Disparado
  pelo pop-up ao criar um chamado, e tratado apenas quando a lista está na tela
  (`location.hash === '#suporte'`) — dentro de um chamado, redesenhar jogaria a
  conversa fora sem o usuário pedir.
- `fg-pulso` → **veio do servidor**, não de outra tela: o batimento de 10 em 10
  segundos avisando que algum número mudou (ver "Ao vivo", abaixo). Os dois
  acima são uma tela falando com a outra dentro da mesma página; este é o
  único que traz notícia de fora.

## Ao vivo (sem recarregar a página)

Até aqui as telas eram desenhadas uma vez e ficavam paradas: o suporte
respondia e o revendedor só descobria dando F5. A carta ✉️ era calculada na
abertura da página, o badge 🎧 conferia de 3 em 3 minutos e a conversa aberta
não recebia mensagem nenhuma.

**O batimento.** `frontend/js/ao-vivo.js` pergunta `GET /api/pulso` a cada
**10 segundos** e dispara o evento de janela `fg-pulso` **só quando algum
número mudou**. Ele não desenha nada — quem ouve decide o efeito.

`GET /api/pulso` (`api/src/routes/pulso.routes.js`) devolve quatro números e
nada mais:

```
notificacoes      não lidas na caixa ✉️ de quem perguntou
suporteAbertos    chamados ainda em andamento
suporteNaoLidas   mensagens do outro lado ainda não vistas (badge 🎧)
ultimaMensagem    maior MensagemId que este usuário alcança
```

O corpo tem ~80 bytes e tudo cabe em **uma** ida ao banco. É a requisição mais
frequente do sistema (uma a cada 10 s por aba aberta): se trouxesse listas, o
portal baixaria o mesmo conteúdo 360 vezes por hora para descobrir que nada
mudou. A lista só é buscada **quando um dos números se mexe**.

`ultimaMensagem` existe porque os contadores não bastam. Uma mudança de status
entra na conversa como mensagem do `sistema`, e uma mensagem que o próprio
usuário enviou de outra aba já nasce lida: nos dois casos nenhum contador mexe,
mas o fio mudou — e a tela aberta precisa saber.

A rota **não reescreve nenhuma regra de visibilidade**: importa `VISIVEL_PARA`
e `escopo` de `notificacoes.routes.js` e `ladosDa` de `suporte.routes.js`. Um
contador que discordasse da tela que ele anuncia seria pior do que não ter
contador — foi por isso que essas três peças passaram a ser exportadas.

**A regra ao reagir, e ela vale para as duas telas:**

> NUNCA REDESENHAR O QUE O USUÁRIO ESTÁ USANDO.

Dentro de um chamado as mensagens novas são **coladas** no fim da conversa
(`supAnexarNovas`, em `portal.js` e `admin.js`). Redesenhar a tela apagaria o
texto meio digitado na caixa de resposta e o arquivo já escolhido no anexo — e
faria isso no meio de uma frase, a cada 10 segundos. Na *lista* de chamados
redesenhar não custa nada, então lá a tela é refeita; a comparação do hash é
**exata** (`=== '#suporte'`), porque um `indexOf(...) === 0` traria
`#suporte/12` para o mesmo ramo e jogaria a fila por cima da conversa.

Os balões novos entram por `appendChild` a partir de um elemento solto, nunca
por `innerHTML +=` no próprio fio: o `+=` recriaria os balões antigos e mataria
junto as URLs de blob dos anexos já resolvidos por `FG.carregarArquivos`.

**O destaque da carta ✉️.** Um número que troca de 2 para 3 num canto da tela
passa despercebido por quem está olhando outra coisa. `piscarPill()` põe a
classe `.novo` no badge (animação em `css/styles.css`) por ~6 segundos e a
retira — e só quando o contador **sobe**: piscar porque o número caiu (o
usuário leu em outra aba) seria alarme ao contrário.

**Os laços antigos saíram.** O `setInterval` de 3 minutos de `suporte.js` e o
de `admin.js` viraram escuta de `fg-pulso`; cada um agora só *pinta* o número
que o batimento já trouxe, em vez de fazer a própria pergunta. Os dois ficaram
como rede de segurança sob `if (!FG.aoVivo)`, para a página não voltar a
congelar caso alguém esqueça de incluir o script.

**Depois de qualquer ação que mexa nos contadores** (abrir chamado, responder,
mudar status) as telas chamam `FG.aoVivo.agora()`. Sem isso o ciclo seguinte
compararia os números novos com um retrato anterior à ação e anunciaria como
novidade a resposta que o próprio usuário acabou de enviar.

**Onde o script entra:** `portal.html`, `admin.html`, `loja.html`,
`finder.html` e `finder-uso.html`, sempre **depois** de `js/api-adapter.js`
(ele usa `FG.pulso` e `FG.session`). Sem sessão na página ele não faz nada.

**Por que não WebSocket/SSE:** um servidor que empurra precisa de conexão
aberta por aba, de `proxy_buffering off` e timeout longo no Nginx, e de a
Cloudflare não cortar o fio no meio. Perguntar quatro números a cada 10 s custa
quase nada e não depende de nenhuma dessas peças — se a rede falhar, o
batimento seguinte conserta sozinho. Se um dia o volume justificar o
instantâneo real, o desenho já está pronto para isso: basta trocar o miolo de
`ao-vivo.js` por uma conexão que dispare o mesmo evento `fg-pulso`; nenhuma
tela precisa mudar.

## Deploy

A camada "ao vivo" **não tem migration**: nenhuma tabela ou coluna nova, nenhuma
variável de ambiente, nenhuma dependência de `npm`. Mas ela tem uma pegadinha
própria:

- **Reiniciar a API é obrigatório** — `/api/pulso` é rota nova; sem o restart o
  front pergunta e recebe 404, e tudo volta a depender do F5 (em silêncio: o
  `apiGet` não rejeita, então nada aparece no console do usuário).
- **Os `?v=` do HTML precisam subir junto.** Atrás da Cloudflare, um
  `portal.html` novo apontando para um `js/portal.js?v=` antigo entrega ao
  revendedor a combinação que nunca foi testada: HTML novo com JavaScript
  velho. Esta rodada mexeu em `api-adapter.js`, `portal.js`, `admin.js`,
  `suporte.js`, `styles.css` e criou `ao-vivo.js` — todos com `?v=20260831a`.

Fora isso, o de sempre: `git pull` → **laço de migrations** → reiniciar a API
(ver `docs/09-deploy-vps-linux.md` e o `deploy.sh`). A 035 e a 036 entram
sozinhas no laço, nessa ordem (a 036 depende da tabela criada pela 035). Sem
variável de ambiente nova, sem dependência nova de `npm`.

Confira depois do deploy que `/uploads/suporte/<arquivo>` **não** abre direto no
navegador (só `/api/arquivos/suporte/<arquivo>`, autenticado) — é o mesmo
desenho de reivindicações e notificações.

## O que ficou de fora (candidatos a próxima rodada)

- **Aviso por e-mail** ao revendedor quando o suporte responde (o SMTP já está
  configurado — ver `api/src/mail.js`). Hoje o aviso é o badge 🎧 e a carta ✉️,
  ambos dentro do portal — e só chegam com o portal ABERTO. Quem fechou a aba
  continua sem saber que houve resposta até voltar.
- **Notificação do sistema operacional** (a `Notification` API do navegador),
  para o aviso sair da aba e chegar na barra de tarefas. O batimento já sabe a
  hora exata em que algo chega (`mudou.chegouMensagem`); falta só pedir a
  permissão ao usuário e disparar.
- **Presença** ("o suporte está digitando…") e recibo de leitura. Exigem o
  servidor empurrando de verdade (WebSocket/SSE) — o batimento de 10 s não
  serve para isso.
- **Caixa de entrada no painel admin**: hoje o administrador lê as
  notificações no portal; no painel ele só tem o contador da barra lateral.
- **Anexo múltiplo** por mensagem (hoje é um por mensagem, 60 MB).
- **Busca** dentro da conversa e relatório de tempo de resposta.
