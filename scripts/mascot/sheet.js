/* global mascot */
// Desenha todas as poses de mascotSprites.js. Página de desenvolvimento; não entra no instalador.
// mascotSprites.js é um script clássico: as constantes dele já são globais nesta página.

const INFO = {
  neutro: ['Neutro', 'Forma original, parado. Base das outras poses.'],
  feliz: ['Feliz', 'Ritmo tranquilo. Olhos em arco, braços para cima.'],
  cansado: ['Cansado', 'Semanal acima de 50%. Olhos semicerrados, braços caídos, "z z".'],
  preocupado: ['Preocupado', 'A previsão pessimista acaba antes do reset. Sobrancelhas e gota de suor.'],
  confuso: ['Confuso', 'Sem dados (sem conexão, token expirado, limite de consultas). Olhos desiguais e "?".'],
  morto: ['Morto', 'Limite atingido antes do reset. De pernas para o ar, cinza, olhos em X.'],
  andando: ['Andando', 'Modo passeio. Quatro quadros; para a esquerda usa o espelho.'],
  caindo: ['Caindo', 'Solto no ar ou pulando para um chão mais baixo.'],
  falando: ['Falando', 'Alerta virando fala. Gesticula com um braço; o texto vai no balão.'],
};

function draw(frame, scale, theme) {
  const c = document.createElement('canvas');
  c.width = MASCOT_W * scale;
  c.height = MASCOT_H * scale;
  c.className = theme;
  const ctx = c.getContext('2d');
  frame.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const color = MASCOT_COLORS[row[x]];
      if (!color) continue;
      // símbolos brancos somem no fundo claro: lá viram escuros
      ctx.fillStyle = row[x] === 'w' && theme === 'light' ? '#1f1e1d' : color;
      ctx.fillRect(x * scale, y * scale, scale, scale);
    }
  });
  return c;
}

function figure(canvas, caption) {
  const f = document.createElement('figure');
  const cap = document.createElement('figcaption');
  cap.textContent = caption;
  f.append(canvas, cap);
  return f;
}

const sheet = document.getElementById('sheet');
for (const [name, frames] of Object.entries(MASCOT_POSES)) {
  const [title, text] = INFO[name];
  const box = document.createElement('section');
  box.className = 'pose';
  const h = document.createElement('h2');
  h.textContent = title;
  const p = document.createElement('p');
  p.textContent = text;
  const row = document.createElement('div');
  row.className = 'frames';
  frames.forEach((frame, i) => {
    const label = frames.length > 1 ? `quadro ${i + 1}` : 'ampliado';
    row.append(figure(draw(frame, 7, 'dark'), label));
  });
  if (name === 'andando') row.append(figure(draw(mirrorFrame(frames[0]), 7, 'dark'), 'espelho'));
  row.append(figure(draw(frames[0], 7, 'light'), 'fundo claro'));
  row.append(figure(draw(frames[0], 3, 'dark'), 'tamanho de uso'));
  box.append(h, p, row);
  sheet.append(box);
}
