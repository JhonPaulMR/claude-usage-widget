// Dispara cada limiar (80/90) e o aviso de previsão curta uma única vez por janela de reset.
const NEW_WINDOW_GAP_MS = 10 * 60 * 1000;
const FORECAST_ALERT_MS = 15 * 60 * 1000;
const LABELS = { session: 'Sessão de 5h', weekly: 'Limite semanal' };

function createAlerter(notify) {
  const state = {}; // name -> { resetsAt, fired:Set }

  // opts.forecast: { session, weekly } de forecast.js (null desliga o aviso de previsão); opts.now: hora da consulta.
  return function check(data, thresholds, opts = {}) {
    const now = opts.now == null ? Date.now() : opts.now;
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
        continue; // um aviso por consulta; a previsão fica para a próxima
      }
      // Previsão pelo uso de agora (não vale o ritmo habitual com a pessoa parada).
      const fc = opts.forecast && opts.forecast[name];
      const endsAt = fc && fc.status === 'range' ? fc.activeEndsAt : null;
      if (endsAt != null && endsAt - now < FORECAST_ALERT_MS && !s.forecastFired) {
        s.forecastFired = true;
        const min = Math.max(1, Math.round((endsAt - now) / 60000));
        notify(`${LABELS[name]}: acaba em ~${min} min`, 'No ritmo de agora o limite acaba antes do reset.');
      }
    }
  };
}

module.exports = { createAlerter };
