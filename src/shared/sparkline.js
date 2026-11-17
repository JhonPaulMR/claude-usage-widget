// Geometria dos gráficos de linha (funções puras; o renderer monta o SVG com o resultado).

const SPARK_GAP_MIN_MS = 20 * 60 * 1000;

// points: [[t, pct]] em ordem de tempo. Devolve trechos [[x, y]] em pixels num quadro w x h.
// Abre um trecho novo quando a porcentagem cai (reset) ou quando há um buraco nas amostras.
function segments(points, from, to, w, h) {
  const span = to - from;
  if (!(span > 0)) return [];
  const gap = Math.max(SPARK_GAP_MIN_MS, (span / 120) * 3);
  const r1 = (n) => Math.round(n * 10) / 10;
  const out = [];
  let cur = null;
  let prev = null;
  for (const [t, p] of points) {
    if (!prev || p < prev[1] || t - prev[0] > gap) { cur = []; out.push(cur); }
    cur.push([r1(((t - from) / span) * w), r1(toY(p, h))]);
    prev = [t, p];
  }
  return out;
}

// 0% fica 1 px acima da base e 100% 1 px abaixo do topo, para o traço não ser cortado.
function toY(pct, h) {
  const p = Math.max(0, Math.min(100, pct));
  return 1 + (1 - p / 100) * (h - 2);
}

function linePath(segs) {
  return segs
    .map((s) => (s.length === 1 ? `M${s[0][0]} ${s[0][1]}h0.5` : 'M' + s.map(([x, y]) => `${x} ${y}`).join('L')))
    .join('');
}

function areaPath(segs, h) {
  return segs
    .filter((s) => s.length > 1)
    .map((s) => `M${s[0][0]} ${h}L` + s.map(([x, y]) => `${x} ${y}`).join('L') + `L${s[s.length - 1][0]} ${h}Z`)
    .join('');
}

// Linha de projeção (pessimista) a partir do último dado, em coordenadas de dados [[t, pct], [t, pct]].
// Vai até o limite (previsão 'range') ou até o reset ('safe'); é cortada no fim do eixo. null: sem projeção.
function projection(item, fc, t0, axisTo) {
  if (!item || typeof item.pct !== 'number' || !fc || !t0 || t0 >= axisTo) return null;
  let end = null;
  if (fc.status === 'range' && fc.earliest > t0) end = [fc.earliest, 100];
  else if (fc.status === 'safe' && fc.rate > 0 && item.resetsAt > t0) end = [item.resetsAt, Math.min(100, item.pct + fc.rate * (item.resetsAt - t0))];
  if (!end) return null;
  if (end[0] > axisTo) {
    const k = (axisTo - t0) / (end[0] - t0);
    end = [axisTo, item.pct + (end[1] - item.pct) * k];
  }
  return [[t0, item.pct], end];
}

// Scripts clássicos dividem o escopo global com format.js: nada de constante solta aqui.
const sparkApi = { segments, toY, linePath, areaPath, projection };

if (typeof module !== 'undefined' && module.exports) module.exports = sparkApi;
else window.spark = sparkApi;
