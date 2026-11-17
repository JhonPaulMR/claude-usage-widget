// Poses do mascote como matrizes de pixels (16 x 15), desenhadas à mão, sem imagem externa.
// Uso pessoal e interno: o desenho segue o mascote do Claude Code e não é para distribuição.
//
// Cada linha tem 16 caracteres. As 5 primeiras linhas são o espaço acima da cabeça (símbolos);
// as 10 seguintes são o corpo. Legenda:
//   .  transparente        o  corpo (laranja)       g  corpo sem vida (cinza)
//   k  olho, boca (escuro) w  símbolo (branco)      b  gota de suor (azul)
// Quem anda para a esquerda usa o quadro espelhado na hora de desenhar.

const MASCOT_W = 16;
const MASCOT_H = 15;
const MASCOT_COLORS = { o: '#d97757', g: '#8d8d92', k: '#1f1e1d', w: '#f4f4f2', b: '#60a5fa' };

const BLANK = '................';
const NO_SYMBOL = [BLANK, BLANK, BLANK, BLANK, BLANK];

const BODY = '..oooooooooooo..';
const BODY_ARMS = 'oooooooooooooooo';
const EYES = '..ookooooookoo..'; // olhos verticais de 1 px, como no original
const LEGS = '...o.o....o.o...';
const MOUTH = '..oooookkooooo..';

const MASCOT_POSES = {
  // Parado, sem emoção: a forma original.
  neutro: [[
    ...NO_SYMBOL,
    BODY,
    BODY,
    EYES,
    EYES,
    BODY_ARMS,
    BODY_ARMS,
    BODY,
    BODY,
    LEGS,
    LEGS,
  ]],

  // Ritmo tranquilo: olhos em arco e braços para cima.
  feliz: [[
    ...NO_SYMBOL,
    BODY,
    BODY,
    'ooookooooookoooo',
    'oookokooookokooo',
    BODY,
    BODY,
    BODY,
    BODY,
    LEGS,
    LEGS,
  ]],

  // Semanal acima de 50%: olhos semicerrados, braços caídos e "z z".
  cansado: [[
    '...........www..',
    '............w...',
    '...........www..',
    '........ww......',
    BLANK,
    BODY,
    BODY,
    BODY,
    '..okkooooookko..',
    BODY,
    BODY_ARMS,
    BODY_ARMS,
    BODY,
    LEGS,
    LEGS,
  ]],

  // A previsão pessimista acaba antes do reset: sobrancelhas erguidas no meio, boca e gota de suor.
  preocupado: [[
    ...NO_SYMBOL,
    '..oookooookooo.b',
    '..okkooooookko.b',
    BODY,
    EYES,
    'ooookooooookoooo',
    BODY_ARMS,
    MOUTH,
    BODY,
    LEGS,
    LEGS,
  ]],

  // Sem dados: um olho maior que o outro, um braço levantado e "?".
  confuso: [[
    '.......ww.......',
    '.........w......',
    '........w.......',
    BLANK,
    '........w.......',
    BODY,
    BODY,
    'ooookooooookko..',
    'ooookooooookko..',
    '..oooooooooooooo',
    '..oooooooooooooo',
    BODY,
    BODY,
    LEGS,
    LEGS,
  ]],

  // Limite atingido: de pernas para o ar, cinza, olhos em X. Revive no reset.
  morto: [[
    ...NO_SYMBOL,
    '...g.g....g.g...',
    '...g.g....g.g...',
    '..gggggggggggg..',
    '..gggggggggggg..',
    'gggggggggggggggg',
    'gggkgkggggkgkggg',
    '..ggkggggggkgg..',
    '..gkgkggggkgkg..',
    '..gggggggggggg..',
    '..gggggggggggg..',
  ]],

  // Andando para a direita: olhos deslocados e pernas alternando.
  andando: [
    [
      ...NO_SYMBOL,
      BODY,
      BODY,
      '..oookooooooko..',
      '..oookooooooko..',
      BODY_ARMS,
      BODY_ARMS,
      BODY,
      BODY,
      LEGS,
      '...o......o.....',
    ],
    [
      ...NO_SYMBOL,
      BODY,
      BODY,
      '..oookooooooko..',
      '..oookooooooko..',
      BODY_ARMS,
      BODY_ARMS,
      BODY,
      BODY,
      LEGS,
      '.....o......o...',
    ],
  ],

  // Solto no ar: braços para cima, olhos arregalados, boca aberta, pernas abertas.
  caindo: [[
    BLANK,
    BLANK,
    BLANK,
    '....w......w....',
    '....w......w....',
    BODY_ARMS,
    BODY_ARMS,
    '..okkooooookko..',
    '..okkooooookko..',
    BODY,
    MOUTH,
    MOUTH,
    BODY,
    '..o..o....o..o..',
    '.o...o....o...o.',
  ]],

  // Dando um alerta: boca abrindo e fechando.
  falando: [
    [
      ...NO_SYMBOL,
      BODY,
      BODY,
      EYES,
      EYES,
      BODY_ARMS,
      BODY_ARMS,
      MOUTH,
      BODY,
      LEGS,
      LEGS,
    ],
    [
      ...NO_SYMBOL,
      BODY,
      BODY,
      EYES,
      EYES,
      BODY_ARMS,
      'oooooookkooooooo',
      MOUTH,
      BODY,
      LEGS,
      LEGS,
    ],
  ],
};

// Espelha um quadro na horizontal (andar para a esquerda).
function mirrorFrame(frame) {
  return frame.map((row) => row.split('').reverse().join(''));
}

// Scripts clássicos dividem o escopo global: um nome só para o que sai daqui.
const mascotApi = { MASCOT_W, MASCOT_H, MASCOT_COLORS, MASCOT_POSES, mirrorFrame };

if (typeof module !== 'undefined' && module.exports) module.exports = mascotApi;
else window.mascot = mascotApi;
