// Persistência simples em JSON (userData). Nunca guarda token.
const fs = require('fs');
const path = require('path');

const DEFAULTS = {
  intervalSec: 60,
  alert80: true,
  alert90: true,
  autostart: false,
  autostartInit: false, // true depois de aplicar o padrão da primeira execução instalada
  visible: true,
  theme: 'dark',
  top: null, // posição vertical (px, relativa à tela); null = centralizado
  displayId: null,
  demo: false,
  last: null, // { data, fetchedAt }
  history: [], // últimas amostras { t, session, weekly }
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
