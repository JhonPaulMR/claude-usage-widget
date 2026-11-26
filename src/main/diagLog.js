// Registro de diagnóstico em userData/widget.log: estado de cada consulta que muda, erros com o motivo
// real, renovações de token e eventos de energia. Nunca grava token nem conteúdo de resposta.
// Ao passar de maxBytes, o arquivo vira widget.log.1 (só uma geração antiga).
const fs = require('fs');
const path = require('path');

const MAX_BYTES = 256 * 1024;

function stamp(t) {
  const d = new Date(t);
  const p = (n, w = 2) => String(n).padStart(w, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

// Uma linha legível: "2026-11-26 13:46:15 [offline] Sem conexão detail=net::ERR_CONNECTION_RESET".
function formatLine(t, tag, msg, extra) {
  const parts = [stamp(t), `[${tag}]`, String(msg || '').replace(/\s+/g, ' ').trim()];
  if (extra) {
    for (const [k, v] of Object.entries(extra)) {
      if (v == null || v === '') continue;
      parts.push(`${k}=${String(v).replace(/\s+/g, ' ').slice(0, 300)}`);
    }
  }
  return parts.filter(Boolean).join(' ');
}

function createDiagLog(dir, { maxBytes = MAX_BYTES, now = Date.now } = {}) {
  const file = path.join(dir, 'widget.log');
  function write(tag, msg, extra) {
    const line = formatLine(now(), tag, msg, extra) + '\n';
    try {
      fs.mkdirSync(dir, { recursive: true });
      let size = 0;
      try { size = fs.statSync(file).size; } catch { /* ainda não existe */ }
      if (size + line.length > maxBytes) fs.renameSync(file, `${file}.1`);
      fs.appendFileSync(file, line);
    } catch {
      /* disco indisponível: o diagnóstico é opcional */
    }
  }
  return { write, file };
}

module.exports = { createDiagLog, formatLine, MAX_BYTES };
