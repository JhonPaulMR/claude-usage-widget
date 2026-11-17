// Histórico das consultas em arquivo próprio (userData/history.jsonl), 30 dias, um ponto por consulta.
// Cada linha é [t, sessão %, semanal %]. Só acrescenta ao final; a limpeza reescreve o arquivo.
const fs = require('fs');
const path = require('path');

const KEEP_MS = 30 * 24 * 60 * 60 * 1000;
const COMPACT_AFTER = 2000; // pontos vencidos acumulados antes de reescrever o arquivo

function validRow(r) {
  return Array.isArray(r) && Number.isFinite(r[0]) && r.length >= 3;
}

// Texto do arquivo -> linhas válidas dentro dos 30 dias, em ordem de tempo. Linhas quebradas são ignoradas.
function parseHistory(text, now = Date.now()) {
  const rows = [];
  for (const line of String(text || '').split('\n')) {
    if (!line.trim()) continue;
    try {
      const r = JSON.parse(line);
      if (validRow(r) && r[0] >= now - KEEP_MS && r[0] <= now + 60000) rows.push(r);
    } catch {
      /* linha cortada por queda de energia: ignora */
    }
  }
  return rows.sort((a, b) => a[0] - b[0]);
}

function toRow(t, data) {
  const num = (x) => (x && typeof x.pct === 'number' ? x.pct : null);
  return [t, num(data && data.session), num(data && data.weekly)];
}

// persist=false mantém tudo só na memória (modo demonstração).
function createHistory(dir, { persist = true, seed = [], now = Date.now() } = {}) {
  const file = path.join(dir, 'history.jsonl');
  let rows = [];
  let stale = 0;

  function rewrite() {
    if (!persist) return;
    try {
      fs.mkdirSync(dir, { recursive: true });
      const tmp = `${file}.tmp`;
      fs.writeFileSync(tmp, rows.map((r) => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : ''));
      fs.renameSync(tmp, file);
      stale = 0;
    } catch {
      /* disco indisponível: o histórico segue na memória */
    }
  }

  if (persist) {
    let text = null;
    try {
      text = fs.readFileSync(file, 'utf8');
    } catch {
      /* primeira execução */
    }
    if (text == null) {
      // Migração: aproveita as amostras que a versão anterior guardava no settings.json.
      rows = seed.filter((h) => h && Number.isFinite(h.t)).map((h) => [h.t, h.s ?? null, h.w ?? null]).filter((r) => r[0] >= now - KEEP_MS);
      if (rows.length) rewrite();
    } else {
      rows = parseHistory(text, now);
      if (rows.length !== text.split('\n').filter((l) => l.trim()).length) rewrite();
    }
  }

  return {
    all: () => rows,
    add(t, data) {
      const row = toRow(t, data);
      rows.push(row);
      const limit = t - KEEP_MS;
      let drop = 0;
      while (drop < rows.length && rows[drop][0] < limit) drop++;
      if (drop) { rows.splice(0, drop); stale += drop; }
      if (!persist) return;
      if (stale >= COMPACT_AFTER) rewrite();
      else fs.appendFile(file, JSON.stringify(row) + '\n', () => {});
    },
  };
}

module.exports = { createHistory, parseHistory, toRow, KEEP_MS };
