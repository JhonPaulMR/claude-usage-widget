// Persistência simples em JSON (userData). Nunca guarda token.
const fs = require('fs');
const path = require('path');

const DEFAULTS = {
  intervalSec: 60,
  alert80: true,
  alert90: true,
  alertLow: 80, // valor do primeiro limiar (ligado por alert80)
  alertHigh: 90, // valor do segundo limiar (ligado por alert90)
  alertForecast: true, // avisa quando a previsão de acabar for menor que 15 min
  autostart: false,
  autostartInit: false, // true depois de aplicar o padrão da primeira execução instalada
  visible: true,
  theme: 'dark',
  displays: null, // { [idDoMonitor]: { enabled, top } }; top relativo à área útil do monitor (null = centralizado)
  demo: false,
  chartMode: 'separate', // separate | combined | session | weekly
  chartRange: '5h', // janela visível no modo combinado: 1h | 5h | 24h | 7d
  compactSession: true, // itens visíveis na aba recolhida
  compactWeekly: true,
  compactForecast: false,
  compactReset: false,
  compactChart: false,
  autoRenew: true, // token vencido: pede ao Claude Code para renovar
  autoRenewPaid: true, // permite a requisição mínima (Haiku) se o comando gratuito não renovar
  paidFallback: false, // plano B via /v1/messages quando o formato do endpoint mudar
  last: null, // { data, fetchedAt }
};

function createStore(dir) {
  const file = path.join(dir, 'settings.json');
  let data = { ...DEFAULTS };
  try {
    data = { ...DEFAULTS, ...JSON.parse(fs.readFileSync(file, 'utf8')) };
  } catch {
    /* primeira execução ou arquivo corrompido: usa padrões */
  }

  let timer = null;
  function flush() {
    try {
      fs.mkdirSync(dir, { recursive: true });
      const tmp = `${file}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(data));
      fs.renameSync(tmp, file);
    } catch {
      /* disco indisponível: ignora, é só cache */
    }
  }

  return {
    get: (k) => data[k],
    all: () => data,
    set(k, v) {
      data[k] = v;
      clearTimeout(timer);
      timer = setTimeout(flush, 300);
    },
    flush,
  };
}

module.exports = { createStore, DEFAULTS };
