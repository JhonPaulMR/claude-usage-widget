// Dispara cada limiar (80/90) uma única vez por janela de reset.
const NEW_WINDOW_GAP_MS = 10 * 60 * 1000;
const LABELS = { session: 'Sessão de 5h', weekly: 'Limite semanal' };

function createAlerter(notify) {
  const state = {}; // name -> { resetsAt, fired:Set }

  return function check(data, thresholds) {
    for (const name of ['session', 'weekly']) {
      const item = data && data[name];
      if (!item || typeof item.pct !== 'number') continue;
      let s = state[name];
      if (!s || (item.resetsAt && s.resetsAt && item.resetsAt - s.resetsAt > NEW_WINDOW_GAP_MS)) {
        s = state[name] = { resetsAt: item.resetsAt, fired: new Set() };
      }
      s.resetsAt = item.resetsAt || s.resetsAt;
      const sorted = [...thresholds].sort((a, b) => b - a); // maior primeiro
      const hit = sorted.find((t) => item.pct >= t && !s.fired.has(t));
      if (hit != null) {
        // marca este e os menores como já avisados (evita dois toasts seguidos)
        for (const t of thresholds) if (t <= hit) s.fired.add(t);
        notify(`${LABELS[name]} em ${Math.floor(item.pct)}%`, `Você passou de ${hit}% do limite.`);
      }
    }
  };
}

module.exports = { createAlerter };
