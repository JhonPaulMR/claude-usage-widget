# Plano de melhorias do Claude Usage Widget

Atualizado em 16/11/2026. Este arquivo registra as decisões tomadas, o que já foi feito e o que falta, para retomar o trabalho em qualquer sessão.

## Onde paramos

| Etapa | Assunto | Situação | Branch |
|---|---|---|---|
| 1 | Atualização (429, 5xx, token) | Implementada, aguardando teste do usuário | `etapa-1-atualizacao` |
| 2 | Animação de abrir e fechar | Testada pelo usuário no notebook (fluida) | `etapa-2-animacao` |
| 3 | Histórico e previsão | Implementada, aguardando teste do usuário | `etapa-3-historico` |
| 4 | Gráficos e tela de configurações | Implementada, aguardando teste do usuário | `etapa-4-graficos-config` |
| 5 | Multi-monitor | Implementada, aguardando teste do usuário | `etapa-5-multi-monitor` |
| 6 | Mascote | A fazer | |

**Próximo passo:** instalar `dist/Claude Usage Widget Setup 0.1.0.exe` (gerado por `npm run dist` na branch `etapa-5-multi-monitor`, que contém as etapas 1 a 4), usar por alguns dias e conferir "Como testar" das etapas 1, 3, 4 e 5. A etapa 6 começa pela folha de poses, que precisa de aprovação.

Cada branch parte da anterior (`etapa-1-atualizacao` → `etapa-2-animacao` → `etapa-3-historico` → `etapa-4-graficos-config` → `etapa-5-multi-monitor`), porque as etapas foram iniciadas a pedido do usuário antes do teste de um dia da etapa 1. Nada foi mesclado na `main`.

### Para continuar em outro PC

```bash
git clone https://github.com/JhonPaulMR/claude-usage-widget.git
cd claude-usage-widget
git checkout etapa-5-multi-monitor
npm install
npm test
npm run dist
```

O instalador (`dist/`) e os ícones (`build/`) não vão para o repositório; `npm run dist` gera os dois. O histórico (`history.jsonl`) fica na pasta de dados de cada PC e não acompanha o repositório: em outro PC a previsão começa do zero.

Regra de entrega: uma etapa por branch, um commit por etapa, lógica pura com testes em `node --test`, instalador ao fim de cada etapa, e só se avança depois do teste do usuário. O README é atualizado no final.

## Etapa 1: atualização (feita)

### Problemas encontrados

- **Atraso de 2 minutos:** ao receber um 429 (limite de consultas), o intervalo de 60 s dobrava para 120 s, depois 240, 480 e 600 s, e a interface continuava mostrando "ao vivo". Não existia nenhuma regra de "pular se não mudou".
- **Plano B gastando uso:** qualquer erro 5xx do endpoint disparava um POST real em `/v1/messages`.
- **Token expirado:** o widget ficava parado até alguém abrir o Claude Code no terminal.

### O que mudou

- `src/main/schedule.js` (novo): regras puras de agendamento. Backoff de 1,5x com teto de 5 min, `Retry-After` respeitado, esperas por estado (sem conexão 15 s, servidor fora 30 s, sessão expirada 60 s).
- `src/main/usageProvider.js`: 5xx e 408 viram erro `server` (transitório, sem plano B); 429 carrega o `Retry-After`; o plano B só roda com `paidFallback` ligado; token vencido é marcado como `expired`.
- `src/main/tokenRefresher.js` (novo): renova o token chamando o Claude Code oficial, escondido e pontual, em dois degraus:
  1. `claude auth status` (sem requisição ao modelo).
  2. `claude -p ok --model haiku` (requisição mínima), só se o degrau 1 não renovou, a opção estiver ligada e não houver outro Claude Code aberto.
  Após falha, espera 10 min antes de tentar de novo.
- `src/main/main.js`: observa `~/.claude/.credentials.json` e consulta assim que o arquivo é regravado; envia `nextAt` (hora da próxima tentativa) para a interface; novo submenu **Token e consumo** com três interruptores e o resultado da última renovação.
- `src/renderer/renderer.js`: estados visíveis `limitado · 1:40`, `servidor fora · 0:20`, `sem conexão · 0:10`, `renovando token`, com contagem regressiva.
- Novas preferências em `settings.json`: `autoRenew` (ligado), `autoRenewPaid` (ligado), `paidFallback` (desligado).

### Fatos verificados

- O token vale 8 horas. Em 16/11 foi renovado 8 segundos depois de abrir o Claude Code no terminal; o aplicativo desktop do Claude, já aberto, não renovou o arquivo.
- O CLI fica em `~/.local/bin/claude.exe` (versão 2.1.325).
- A consulta ao endpoint funciona dentro do Electron (cerca de 400 ms).

### Ainda não verificado

- **Se `claude auth status` renova um token vencido.** Não deu para testar porque o token estava válido. O widget tenta o degrau 1 e, se não renovar, o degrau 2; o resultado aparece em **Token e consumo** no menu ("sem custo" ou "requisição mínima"). Se o degrau 1 nunca funcionar, pode ser removido.
- O comportamento real num 429 (depende de o servidor limitar).

### Como testar a etapa 1

1. Ligar o PC sem abrir o Claude Code: o widget deve mostrar "renovando token" e voltar a "ao vivo" sozinho. Conferir no menu qual degrau renovou.
2. Em uso normal: nunca ficar parado mostrando "ao vivo" com horário antigo. Se houver limite de consultas, aparece "limitado" com a contagem.
3. Desligar a rede por um minuto: "sem conexão" com contagem, e volta sozinho.

## Etapa 2: animação (feita)

**Causa:** a abertura anima `clip-path` com cantos arredondados, o que repinta o painel inteiro a cada quadro numa janela transparente. Há ainda `drop-shadow` nos anéis, leituras de layout a cada `mousemove` e o relógio de 1 s escrevendo durante a transição.

**Decisão:**
- Trocar `clip-path` por animação só de `transform` e `opacity` (painel deslizando dentro de um contêiner recortado).
- Suspender relógio, re-render e sombras durante a transição.
- Remover o "aquecimento" da inicialização.
- Critério de aceite: `electron . --perf` no PC do usuário, nenhum quadro acima de 20 ms, comparado à medição de antes.
- Se ainda travar, o gargalo é a janela transparente; aí se decide reduzir a área da janela, com a medição em mãos.

**Defeito encontrado para corrigir junto:** a política de segurança da página (`style-src 'self'`) bloqueia o `style="width:…"` das barras em `cardHtml` (`renderer.js`), então as barras de progresso do painel não recebem largura. Corrigir aplicando a largura por JavaScript (`el.style.width`) depois de montar o HTML.

### O que mudou

- `index.html` e `styles.css`: o widget ganhou duas camadas internas (`.clip-y` e `.surface`). `.widget` recorta na horizontal e `.clip-y` na vertical, ambos com `overflow: hidden` fixo e animados só por `transform`; a `.surface` recebe o deslocamento inverso, então o conteúdo fica parado e a aparência é a mesma de antes. O `clip-path` saiu.
- `renderer.js`: `setOpen()` centraliza abrir e recolher e marca a classe `moving` por 480 ms. Nesse período o relógio de 1 s pula a vez, o re-render fica pendente e os anéis ficam sem sombra e com o pulso parado.
- O `mousemove` não lê mais layout: largura e altura ficam guardadas em `syncHeight()`.
- O "aquecimento" da inicialização foi removido.
- As barras de progresso recebem a largura por JavaScript (antes ficavam sempre vazias).

### Medição (`electron . --perf --demo`, monitor de 144 Hz, 16/11/2026)

| | Primeira abertura: pior quadro | Quadros acima de 20 ms | Demais execuções: pior quadro |
|---|---|---|---|
| Antes (com aquecimento) | 111,3 ms | 4 | 7,4 a 9,2 ms |
| Depois, 1ª medição | 20,9 ms | 1 | 7,4 a 8,1 ms |
| Depois, 2ª medição | 7,5 ms | 0 | 7,6 a 9,2 ms |

A medição conta o intervalo entre quadros na thread principal; não enxerga engasgo que aconteça só no compositor. Por isso o teste visual abaixo continua valendo.

### Como testar a etapa 2

1. Logo depois de iniciar o widget, passar o mouse na aba: a primeira abertura deve ser fluida.
2. Abrir e recolher várias vezes, com a sessão acima de 90% (anel pulsando) se possível.
3. Conferir que as barras de progresso dos cartões aparecem preenchidas.
4. Se ainda travar, rodar `npx electron . --perf --demo` com o instalado fechado e anotar os números; o próximo suspeito é a janela transparente.

## Etapa 3: histórico e previsão (feita)

**Causa da previsão otimista:** extrapolação linear da média desde o início da janela, incluindo o tempo ocioso (`format.js`, `paceProjection`).

**Decisões:**
- Histórico em arquivo próprio (fora do `settings.json`), 30 dias, um ponto por consulta.
- Previsão em faixa ("acaba entre 14:20 e 15:10") ou "não deve acabar nesta sessão"; o número em destaque é o pessimista.
- Pessimista: ritmo dos últimos 20 min de uso ativo, média ponderada com mais peso no recente.
- Otimista: média da janela inteira.
- Depois de 7 dias de histórico: a pessimista passa a ser o maior entre o ritmo recente e o ritmo forte habitual do usuário (percentil 75 das rajadas naquele horário e dia da semana).
- Marcar a previsão como desatualizada quando o último dado tiver mais de 2 intervalos de idade.
- Alerta novo: previsão abaixo de 15 minutos.

### O que mudou

- `src/main/history.js` (novo): histórico em `history.jsonl` na pasta de dados, uma linha `[t, sessão, semanal]` por consulta, 30 dias. Só acrescenta ao final; reescreve o arquivo ao limpar pontos vencidos. As 60 amostras que ficavam no `settings.json` são migradas e a chave some de lá. No modo demonstração o histórico fica só na memória.
- `src/main/forecast.js` (novo): cálculo puro da previsão. Devolve `none`, `limit`, `low`, `safe` ou `range` com a hora pessimista (`earliest`) e a otimista (`latest`).
- `src/shared/format.js`: `paceProjection` saiu; entraram `forecastText` e `forecastIsStale`.
- `src/main/alerts.js`: aviso "acaba em ~N min", uma vez por janela, com o interruptor **Avisar quando a previsão for menor que 15 min** no menu Alertas (`alertForecast`, ligado).
- Painel: a linha do ritmo virou "acaba entre **14:20** e 15:10", "pode acabar a partir de **14:20**" (quando o otimista não chega ao limite), "acaba por volta de **14:20**" (extremos a menos de 5 min) ou "não deve acabar nesta sessão". Com dado velho, fica esmaecida e ganha "· desatualizada".
- A janela passou de 380 para 440 px de altura, para caber a previsão em duas linhas.

### Decisões tomadas na implementação (não estavam no plano)

- **Porcentagens inteiras:** o endpoint só devolve números inteiros, então o ritmo é medido entre "degraus" (momentos em que a porcentagem sobe) e não consulta a consulta. Mais de 15 min sem degrau conta como ocioso.
- **Peso no recente:** meia-vida de 10 min de uso ativo.
- **Semanal:** "20 min de uso ativo" extrapolado por dias daria uma previsão absurda. No semanal o ritmo recente é o das últimas 24 h corridas (com o tempo ocioso), e o otimista continua sendo a média da janela.
- **Ritmo habitual:** rajadas com pelo menos 2 degraus e 5 min, no mesmo dia da semana e horário (±1 h). Com menos de 3 rajadas nesse recorte, vale o mesmo horário em qualquer dia; sem isso, não entra.
- **Alerta de 15 min:** usa só o ritmo de agora (degrau há menos de 15 min). O ritmo habitual sozinho, com a pessoa parada, não dispara aviso.
- **Widget fechado:** a subida observada depois de um buraco nas amostras é descartada, porque não se sabe quanto tempo levou.

### Ainda não verificado

- A qualidade da previsão com uso real: os testes usam séries sintéticas. Os primeiros dias dirão se 15 min de ocioso e 10 min de meia-vida estão bons.
- O ritmo habitual só entra depois de 7 dias de histórico neste PC.

### Como testar a etapa 3

1. Usar o Claude por uns 20 min seguidos e abrir o painel: a sessão deve mostrar uma faixa ou "pode acabar a partir de", com a hora pessimista em destaque.
2. Parar de usar: o texto se mantém (é o ritmo do último uso ativo); depois do reset volta a "consumo baixo" ou "não deve acabar".
3. Desligar a rede por 3 min: a previsão fica esmaecida com "· desatualizada".
4. Conferir que `%APPDATA%\claude-usage-widget\history.jsonl` ganha uma linha por consulta.
5. Depois de 7 dias, ver se a previsão pessimista passou a refletir os horários de uso forte.

## Etapa 4: gráficos e configurações (feita)

- Dois gráficos no painel aberto, estilo sparkline: **sessão** (janela de 5 h atual) e **semanal** (7 dias).
- Seletor: separados (padrão), combinados (mesmo eixo de 0 a 100%), só sessão, só semanal.
- Linha pontilhada projetando a previsão até o limite ou o reset.
- O intervalo do gráfico é o intervalo de atualização: 30 s, 1, 2 ou 5 min (padrão 60 s). Não haverá 10 s, porque cada ponto é uma consulta e isso provocaria 429.
- Janela visível no modo combinado: 1 h, 5 h, 24 h ou 7 dias (padrão 5 h).
- Janela de configurações própria. O menu da bandeja fica só com atualizar, mostrar/ocultar, abrir configurações e sair.
- Configurações: itens visíveis no modo compacto (sessão, semanal, previsão, reset, gráfico), contagem do reset sempre visível, limiares de alerta, e os interruptores de token da etapa 1.

### O que mudou

- `src/main/prefs.js` (novo): lista das preferências editáveis e validação. A janela de configurações só grava chave e valor que passam por `sanitize()`.
- `src/main/chart.js` (novo): séries dos gráficos a partir do histórico, no máximo 120 pontos por gráfico.
- `src/shared/sparkline.js` (novo): geometria das linhas, quebra do traço em reset ou buraco de amostras, e a linha de projeção.
- `src/main/settingsWindow.js`, `settingsPreload.js`, `src/renderer/settings.html|js|css` (novos): janela de configurações. Cada controle grava na hora; não há botão de salvar. O IPC `settings:*` só é aceito quando vem dessa janela.
- Painel: um gráfico em cada cartão (sessão em laranja, semanal em azul), eixo de 0 a 100%, do início da janela até o reset. A linha pontilhada é a previsão pessimista até o limite, ou até o reset quando não acaba. No modo combinado, um cartão próprio com as duas linhas e a janela escolhida, com 20% do eixo à frente de "agora" para a projeção.
- Aba recolhida: contagem do reset, previsão (só a hora pessimista) e gráfico pequeno, cada um ligado nas configurações. A altura da aba agora acompanha o conteúdo.
- Menu da bandeja e do botão direito: Atualizar agora, Mostrar/Ocultar, Configurações e Sair.
- Intervalos: 30 s, 1, 2 e 5 min. Quem estava em 3 min passa para 2 min.
- Limiares de alerta editáveis (1 a 99%), em `alertLow` e `alertHigh`; `alert80` e `alert90` continuam sendo os interruptores.
- A janela do widget passou para 520 px de altura.
- `electron . --settings` abre as configurações ao iniciar (atalho de desenvolvimento).

### Decisões tomadas na implementação (não estavam no plano)

- **Seletor do gráfico:** fica na janela de configurações, não no painel.
- **"Contagem do reset sempre visível":** foi entendida como o item "Contagem do reset" do modo compacto (o reset aparece mesmo com o painel fechado). Não há um interruptor separado.
- **Sessão e semanal desmarcados juntos:** a aba mostra a sessão, para nunca ficar vazia.
- **Tema, monitor, iniciar com o Windows e demonstração** saíram do menu e foram para a seção "Aparência e sistema". O monitor continua sendo um só até a etapa 5.

### Medição (`electron . --perf --demo`, 144 Hz)

Painel com gráficos (443 px de altura): em 5 medições, 4 sem nenhum quadro acima de 20 ms (pior quadro de 7,2 a 9 ms) e 1, logo após apagar o perfil, com 2 quadros lentos na primeira abertura (pior de 62,6 ms).

### Como testar a etapa 4

1. Botão direito no widget ou na bandeja: o menu tem só quatro itens. Abrir **Configurações**.
2. Trocar o modo do gráfico entre separados, combinados, só sessão e só semanal, e a janela do combinado: o painel muda na hora.
3. Marcar e desmarcar os itens do modo compacto: a aba cresce e encolhe, e o hover continua pegando a aba inteira.
4. Arrastar a aba até o fim da tela com todos os itens ligados: ela deve parar inteira dentro da tela.
5. Mudar um limiar de alerta para um valor logo acima do uso atual e esperar passar.
6. Depois de algumas horas de uso, ver se os gráficos e a linha pontilhada fazem sentido.
7. Passar o mouse na aba logo após iniciar: a abertura deve continuar fluida com os gráficos.

## Etapa 5: multi-monitor (feita)

- Lista de monitores com caixas de seleção; o widget aparece em todos os marcados.
- Posição salva por monitor; todos mostram os mesmos dados; abrir ou fechar em um não afeta os outros.
- Observação técnica: hoje `top` é um valor absoluto da tela virtual, e precisa virar relativo a cada monitor.

### O que mudou

- `src/main/displays.js` (novo): regras puras. Preferência `displays` no formato `{ [idDoMonitor]: { enabled, top } }`, com `top` relativo à área útil do monitor.
- `src/main/window.js`: virou um gerenciador com uma janela por monitor marcado. Cria e fecha janelas quando um monitor é ligado, desligado ou (des)marcado. Cada mensagem da interface (hover, arrastar, menu) vale só para a janela que a enviou.
- Migração: `displayId` e `top` antigos viram a preferência nova na primeira execução, mantendo a posição.
- Configurações: a lista suspensa de monitor virou uma lista com caixas de seleção. A última caixa marcada fica travada, para o widget nunca sumir.
- "Centralizar verticalmente" vale para todos os monitores.
- `electron . --split-display` divide o monitor principal em dois falsos (desenvolvimento).

### Decisões tomadas na implementação (não estavam no plano)

- **Monitor marcado que foi desligado:** se nenhum dos marcados está ligado, o widget aparece no principal, sem alterar a preferência. Quando o monitor volta, o widget volta para ele na posição salva.
- **Monitor novo:** começa desmarcado.
- **Fixar o painel (clique na aba)** também é por monitor.

### Ainda não verificado

- **Dois monitores de verdade.** O PC de desenvolvimento tem uma tela só. O teste foi com `--split-display`, que confere a lógica (janelas independentes, posição por monitor, marcar e desmarcar), mas não monitores com escalas diferentes (125%, 150%), nem o comportamento ao ligar e desligar um cabo com o widget rodando.

### Como testar a etapa 5

1. Com dois monitores, abrir Configurações e marcar o segundo: o widget aparece nos dois.
2. Abrir o painel em um: o outro continua recolhido. Arrastar um: o outro não se mexe.
3. Fechar e abrir o widget: cada monitor retoma a sua posição.
4. Desligar o cabo do segundo monitor e ligar de novo: o widget some dele e volta no mesmo lugar.
5. Se os monitores tiverem escalas diferentes, conferir se o widget fica colado na borda direita nos dois.

## Etapa 6: mascote

- Modos exclusivos, **clássico** (padrão) e **mascote**, trocados nas configurações e no menu. No modo mascote as abas clássicas somem; ao voltar, cada monitor retoma a posição salva.
- **Aparência:** fiel ao mascote do Claude Code, apenas para uso pessoal e interno, sem distribuição. Sprites desenhados como matrizes de pixels no código (como o `logo.js`), sem baixar nada. Primeiro entregável: folha com todas as poses para aprovação.
- **Emoções**, uma por vez, nesta prioridade:
  1. Morto: limite atingido antes do reset (revive no reset).
  2. Confuso: sem dados (sem conexão, token expirado, limite de consultas longo).
  3. Preocupado: a previsão pessimista acaba antes do reset.
  4. Cansado: semanal acima de 50%.
  5. Feliz: ritmo tranquilo.
  Mais as poses andando, caindo e falando.
- **Modo fixo:** fica onde for solto, em qualquer lugar da tela, sem gravidade.
- **Modo passeio:** o chão é o topo da barra de tarefas. Solto no ar, cai com gravidade. Atravessa para o monitor vizinho, pulando ou caindo se o chão tiver outra altura; sem vizinho, dá meia-volta. Existe um mascote só; os monitores marcados na etapa 5 definem por onde ele anda.
- **Ritmo:** um trecho curto a cada 2 a 5 minutos (ajustável: raro, normal, frequente). Parado com aplicativo em tela cheia e quando morto.
- **Interação:** clicar abre o painel clássico em balão ancorado nele, e ele para de andar enquanto o painel estiver aberto. Passar o mouse mostra um resumo ("Sessão 62%, reset em 1h40"). Os alertas viram fala do mascote e continuam como notificação do Windows (desligável).

## Fora do escopo

Temas, exportar CSV, comparação entre semanas, tokens absolutos e custo (o endpoint só fornece porcentagens e horários de reset).

## Notas para quem retomar

- O endpoint `GET /api/oauth/usage` não é documentado e pode mudar; todo o acesso à rede está em `src/main/usageProvider.js`.
- O widget instalado segura a trava de instância única. Para rodar a versão de desenvolvimento ao lado dele, feche o instalado antes de `npm start`.
- Consultar o endpoint em excesso durante testes provoca 429 no próprio widget instalado.
- Nunca imprimir nem registrar o token; para depurar, ler só `expiresAt`.
