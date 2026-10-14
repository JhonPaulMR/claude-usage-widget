# Claude Usage Widget

Widget fixo na borda direita da tela (Windows) que mostra, em tempo real, quanto você já usou dos limites do Claude: a **sessão de 5 horas** e o **limite semanal**.

  <img width="177" height="400" alt="image" src="https://github.com/user-attachments/assets/19a2943c-7ed8-4f82-944b-27a2db5d14b0" />
  <img width="362" height="400" alt="image" src="https://github.com/user-attachments/assets/ae8e78c1-ae76-4951-a8ca-0551b6cf3935" />




## Requisitos
- Windows 10 ou 11
- Claude Code instalado e com login feito (o widget lê o login dele; não pede senha)

## Instalar
1. Vá em releases e instale a versão mais recente **`Claude Usage Widget Setup x.x.x.exe`**.
2. A instalação é automática, sem assistentes. O widget abre sozinho na lateral direita.
3. Na primeira execução ele já fica configurado para **iniciar com o Windows**.

> O Windows pode mostrar o aviso "SmartScreen" porque o instalador não é assinado. Clique em *Mais informações* → *Executar assim mesmo*.

Para gerar o instalador a partir do código: `npm install` e depois `npm run dist`.

## De onde vêm os dados
O widget lê o login do Claude Code (`~/.claude/.credentials.json`) a cada consulta e pergunta à Anthropic o seu uso atual. Isso **não gasta cota**. O token nunca é gravado, registrado em log nem enviado a terceiros.

- O Claude Code renova o login sozinho quando você o usa. Se o widget mostrar **"sessão expirada"**, abra o Claude Code (ou rode `claude` e faça `/login`). O widget volta ao normal na próxima atualização, sem reiniciar.
- Esse endpoint de uso não é documentado oficialmente e pode mudar. Se aparecer **"formato inesperado"**, o ajuste fica em `src/main/usageProvider.js`.

## Como usar

### Widget recolhido
Dois medidores na borda direita: **5H USAGE** (em cima) e **WEEK USAGE** (embaixo), cada um com o logo do Claude e a porcentagem usada. A cor do anel indica o nível:

| Cor | Uso |
|---|---|
| Verde | abaixo de 60% |
| Âmbar | de 60% a 85% |
| Vermelho | acima de 85% (pulsa acima de 90%) |
| Cinza | sem conexão, sessão expirada ou erro (mostra o último valor) |

### Interações
- **Passar o mouse:** o painel abre com os detalhes e recolhe ao tirar o mouse.
- **Clicar:** fixa o painel aberto (um ponto laranja aparece). Clique de novo para soltar.
- **Arrastar para cima/baixo:** muda a posição vertical. Ela fica salva.
- **Botão direito:** abre o menu.
- **Atalho `Ctrl+Alt+U`:** oculta ou mostra o widget.

### Painel aberto
Para cada limite:
- porcentagem exata e barra de progresso;
- **tempo até o reset** (contagem regressiva ao vivo) e o horário/dia do reset;
- **ritmo de consumo**, por exemplo "no ritmo de acabar em ~1h 45m" ou "ritmo confortável";
- limites por modelo (Opus, Sonnet etc.), quando o seu plano tiver;
- horário da última atualização e o botão **↻** para atualizar na hora.

### Menu (botão direito no widget ou no ícone da bandeja)
- **Atualizar agora**
- **Intervalo de atualização:** 30 s, 1, 2, 3 ou 5 min (padrão: 1 min)
- **Ocultar / Mostrar widget** (também pelo clique esquerdo no ícone da bandeja)
- **Alertas:** notificação do Windows ao passar de 80% e de 90% (uma vez por janela de reset)
- **Tema:** escuro ou claro
- **Monitor:** escolhe em qual tela o widget fica; **Centralizar verticalmente** volta à posição padrão
- **Iniciar com o Windows:** liga ou desliga
- **Dados de demonstração:** valores simulados, só para testar o visual
- **Sair**

O ícone da bandeja pode estar escondido sob a seta `^` perto do relógio.

## Desinstalar
*Configurações do Windows → Aplicativos → Claude Usage Widget → Desinstalar.*

## Desenvolvimento
```bash
npm install
npm start        # abre com dados reais
npm run demo     # abre com dados simulados
npm run probe    # mostra a estrutura da resposta do endpoint de uso (sem imprimir o token)
npm test         # testes unitários
npm run dist     # gera o instalador em dist/
```

Estrutura: `src/main` (janela, bandeja, consulta e alertas), `src/renderer` (interface), `src/shared/format.js` (cálculos e formatação puros). Toda a comunicação com a rede fica isolada em `src/main/usageProvider.js`.

## Limitações conhecidas
- O widget pode ficar escondido atrás de apps em tela cheia (jogos, vídeos).
- O endpoint de uso é não documentado. Confira os termos de uso da Anthropic antes de depender dele no dia a dia.
- O widget não renova o login por conta própria, de propósito: isso poderia deslogar o Claude Code.
