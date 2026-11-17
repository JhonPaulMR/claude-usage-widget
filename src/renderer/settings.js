/* global settings */
// Cada controle com data-key grava a preferência assim que muda; não existe botão de salvar.
const controls = [...document.querySelectorAll('[data-key]')];
let state = null;

function readValue(el) {
  if (el.type === 'checkbox') return el.checked;
  if (el.dataset.type === 'display') return el.value === '' ? null : Number(el.value);
  if (el.dataset.type === 'number') return Number(el.value);
  return el.value;
}

function writeValue(el, value) {
  if (el.type === 'checkbox') el.checked = !!value;
  else if (el.dataset.type === 'display') el.value = value == null ? '' : String(value);
  else if (document.activeElement !== el) el.value = String(value); // não atropela quem está digitando
}

// data-enabled-when="chave" ou "chave=valor": o controle só fica ativo se a outra preferência permitir.
function enabledByRule(el, prefs) {
  const rule = el.dataset.enabledWhen;
  if (!rule) return true;
  const [key, want] = rule.split('=');
  return want === undefined ? !!prefs[key] : String(prefs[key]) === want;
}

function apply(next) {
  if (!next) return;
  state = next;
  document.body.dataset.theme = state.prefs.theme || 'dark';

  const displays = document.getElementById('displays');
  displays.replaceChildren(...state.displays.map((d) => {
    const opt = document.createElement('option');
    opt.value = d.id == null ? '' : String(d.id);
    opt.textContent = d.label;
    return opt;
  }));

  for (const el of controls) {
    writeValue(el, state.prefs[el.dataset.key]);
    el.disabled = !enabledByRule(el, state.prefs);
  }
  document.getElementById('demo').disabled = state.forcedDemo;
  document.getElementById('autostart').disabled = !state.packaged;
  document.getElementById('autostartHint').hidden = state.packaged;
  document.getElementById('renewal').textContent = state.renewal;
  document.getElementById('about').textContent = `Versão ${state.version} · ${state.shortcut} mostra ou oculta o widget`;
}

for (const el of controls) {
  el.addEventListener('change', () => {
    if (el.type === 'number' && !el.checkValidity()) {
      el.value = String(state.prefs[el.dataset.key]); // fora de 1 a 99: volta ao valor gravado
      return;
    }
    settings.set(el.dataset.key, readValue(el));
  });
}
for (const btn of document.querySelectorAll('[data-action]')) {
  btn.addEventListener('click', () => settings.action(btn.dataset.action));
}

settings.onState(apply);
settings.get().then(apply);
