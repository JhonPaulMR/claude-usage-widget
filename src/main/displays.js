// Regras puras de multi-monitor (sem Electron).
// Preferência `displays`: { [idDoMonitor]: { enabled, top } }, com top relativo ao topo da área
// útil daquele monitor (null = centralizado).

// Versões antigas guardavam um monitor só (`displayId`, null = principal) e `top` absoluto na tela
// virtual. list: [{ id, workArea }]. Devolve a preferência nova, ou null se já está no formato novo.
function migrate(old, list, primaryId) {
  if (old.displays && typeof old.displays === 'object') return null;
  const target = list.find((d) => d.id === old.displayId) || list.find((d) => d.id === primaryId) || list[0];
  if (!target) return {};
  const top = Number.isFinite(old.top) ? Math.max(0, Math.round(old.top - target.workArea.y)) : null;
  return { [target.id]: { enabled: true, top } };
}

// Monitores em que o widget aparece agora. Se nenhum dos marcados está ligado (cabo solto,
// notebook fora da base), cai no principal sem mexer na preferência.
function resolveEnabled(cfg, ids, primaryId) {
  const on = ids.filter((id) => cfg && cfg[id] && cfg[id].enabled);
  if (on.length) return on;
  return ids.includes(primaryId) ? [primaryId] : ids.slice(0, 1);
}

// Marca ou desmarca um monitor. Devolve a preferência nova, ou null se a mudança deixaria o
// widget sem nenhum monitor ligado.
function setEnabled(cfg, id, enabled, ids, primaryId) {
  if (!ids.includes(id)) return null;
  const next = { ...(cfg || {}) };
  // O que está valendo agora (inclusive o principal usado como reserva) vira preferência explícita.
  for (const cur of resolveEnabled(cfg, ids, primaryId)) next[cur] = { top: null, ...next[cur], enabled: true };
  next[id] = { top: null, ...next[id], enabled: !!enabled };
  if (!ids.some((x) => next[x] && next[x].enabled)) return null;
  return next;
}

function setTop(cfg, id, top) {
  return { ...(cfg || {}), [id]: { enabled: true, ...(cfg && cfg[id]), top } };
}

function clearTops(cfg) {
  const next = {};
  for (const [id, v] of Object.entries(cfg || {})) next[id] = { ...v, top: null };
  return next;
}

// Mantém a parte visível (aba de altura visibleH) dentro da área útil.
function clampTop(top, area, visibleH) {
  return Math.round(Math.max(area.y, Math.min(top, area.y + area.height - visibleH)));
}

// Posição da janela num monitor: canto direito da área útil, na altura salva ou centralizada.
function bounds(area, savedTop, winW, winH, visibleH) {
  const top = savedTop == null ? area.y + (area.height - winH) / 2 : area.y + savedTop;
  return { x: area.x + area.width - winW, y: clampTop(top, area, visibleH), width: winW, height: winH };
}

module.exports = { migrate, resolveEnabled, setEnabled, setTop, clearTops, clampTop, bounds };
