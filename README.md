# Claude Usage Widget

Widget para Windows que mostra, em tempo real, quanto você já usou dos limites do Claude: a **sessão de 5 horas** e o **limite semanal**. Fica na borda direita da tela ou, no modo mascote, anda sobre a barra de tarefas.

## Requisitos
- Windows 10 ou 11
- Claude Code instalado e com login feito (o widget lê o login dele; não pede senha)

## Instalar
1. Gere o instalador com `npm install` e `npm run dist`.
2. Execute **`dist/Claude Usage Widget Setup 0.2.0.exe`**. A instalação é automática e o widget abre sozinho.
3. Na primeira execução ele já fica configurado para **iniciar com o Windows**.

> O Windows pode mostrar o aviso "SmartScreen" porque o instalador não é assinado. Clique em *Mais informações* → *Executar assim mesmo*.

## De onde vêm os dados
O widget lê o login do Claude Code (`~/.claude/.credentials.json`) a cada consulta e pergunta à Anthropic o seu uso atual. Isso **não gasta cota**. O token nunca é gravado, registrado em log nem enviado a terceiros.

- **Token vencido:** o widget pede ao Claude Code para renovar, escondido, e volta sozinho. Primeiro tenta `claude auth status`, que não faz requisição ao modelo; se não bastar, faz uma requisição mínima, que gasta um pouco de uso e pode ser desligada nas configurações.
- **Limite de consultas ou servidor fora:** o estado aparece no painel ("limitado", "servidor fora", "sem conexão") com a contagem para a próxima tentativa.
- O endpoint de uso não é documentado oficialmente e pode mudar. Se aparecer **"formato inesperado"**, o ajuste fica em `src/main/usageProvider.js`.

## Modo clássico

### Aba recolhida
Dois medidores na borda direita: **5H USAGE** e **WEEK USAGE**, com a porcentagem usada. A cor do anel indica o nível:

| Cor | Uso |
|---|---|
| Verde | abaixo de 60% |
| Âmbar | de 60% a 85% |
| Vermelho | acima de 85% (pulsa acima de 90%) |
| Cinza | sem conexão, sessão expirada ou erro (mostra o último valor) |

Nas configurações dá para escolher o que aparece na aba: sessão, semanal, contagem do reset, previsão e um gráfico pequeno.

### Interações
- **Passar o mouse:** o painel abre com os detalhes e recolhe ao tirar o mouse.
- **Clicar:** fixa o painel aberto (um ponto laranja aparece). Clique de novo para soltar.
- **Arrastar para cima ou para baixo:** muda a posição vertical, salva por monitor.
- **Botão direito:** abre o menu.
- **Atalho `Ctrl+Alt+U`:** oculta ou mostra o widget.

### Painel aberto
Para cada limite:
- porcentagem e barra de progresso;
- **tempo até o reset** (contagem ao vivo) e o horário do reset;
- **previsão em faixa**, por exemplo "acaba entre **14:20** e 15:10" ou "não deve acabar nesta sessão". A hora em destaque é a pessimista (ritmo dos últimos 20 minutos de uso); a outra é a otimista (média da janela). Depois de 7 dias de histórico, a pessimista também considera os seus horários de uso forte;
- **gráfico** do uso na janela atual, com uma linha pontilhada projetando a previsão;
- limites por modelo, quando o seu plano tiver.

## Modo mascote
Troque em **Configurações → Modo de exibição** ou no menu. As abas da borda somem e um mascote em pixel art passa a mostrar o estado do uso:

| Emoção | Quando |
|---|---|
| Feliz | ritmo tranquilo |
| Cansado | semanal acima de 50% |
| Preocupado | a previsão pessimista acaba antes do reset |
| Confuso | sem dados (sem conexão, token expirado, limite de consultas longo) |
| Morto | limite atingido; revive no reset |

- **Passeio:** anda um trecho curto de tempos em tempos sobre a barra de tarefas, atravessa para os monitores marcados e cai com gravidade se for solto no ar. Fica parado com aplicativo em tela cheia.
- **Fixo:** fica onde for solto.
- **Passar o mouse:** mostra um resumo ("Sessão 62%, reset em 1h40").
- **Clicar:** abre o painel completo em um balão ao lado dele.
- **Arrastar:** leva o mascote para outro lugar.
- **Alertas:** viram fala do mascote; a notificação do Windows continua, a menos que seja desligada.

## Configurações
Botão direito no widget, no mascote ou no ícone da bandeja → **Configurações**. Cada opção vale na hora.

- **Atualização:** intervalo de 30 s, 1, 2 ou 5 min. Cada ponto do gráfico é uma consulta.
- **Modo de exibição:** clássico ou mascote; movimento e frequência do passeio.
- **Gráficos:** separados, combinados (com janela de 1 h, 5 h, 24 h ou 7 dias), só sessão ou só semanal.
- **Modo compacto:** itens da aba recolhida.
- **Alertas:** dois limiares de porcentagem editáveis e o aviso de previsão menor que 15 minutos.
- **Token e consumo:** renovação automática do token e o plano B.
- **Aparência e sistema:** tema, monitores em que o widget aparece, centralizar, iniciar com o Windows e dados de demonstração.

O menu (botão direito ou bandeja) tem só **Atualizar agora**, **Mostrar/Ocultar**, **Modo mascote**, **Configurações** e **Sair**. O ícone da bandeja pode estar escondido sob a seta `^` perto do relógio.

## Desinstalar
*Configurações do Windows → Aplicativos → Claude Usage Widget → Desinstalar.*

## Desenvolvimento
```bash
npm install
npm start             # abre com dados reais
npm run demo          # abre com dados simulados
npm run probe         # mostra a estrutura da resposta do endpoint de uso (sem imprimir o token)
npm test              # testes unitários
npm run mascot:sheet  # gera docs/mascote-poses.png
npm run dist          # gera o instalador em dist/
```

Opções de desenvolvimento do `electron .`: `--perf` (mede a animação), `--settings` (abre as configurações ao iniciar) e `--split-display[=40]` (divide a tela em dois monitores falsos; o número deixa o chão do segundo mais alto).

Estrutura: `src/main` (janelas, bandeja, consulta, histórico, previsão, mascote e alertas), `src/renderer` (interfaces) e `src/shared` (cálculos, formatação e desenhos puros). Toda a comunicação com a rede fica em `src/main/usageProvider.js`. As decisões e o histórico das etapas estão em [PLANO.md](PLANO.md).

## Limitações conhecidas
- O widget pode ficar escondido atrás de apps em tela cheia (jogos, vídeos).
- O endpoint de uso é não documentado. Confira os termos de uso da Anthropic antes de depender dele no dia a dia.
- O histórico fica na pasta de dados de cada PC; em outro PC a previsão começa do zero.
- O desenho do mascote segue o mascote do Claude Code e é para uso pessoal.
