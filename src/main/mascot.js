// Modo mascote: uma janela pequena e transparente que anda pela tela, mais o balão com o painel.
// As regras (emoção, física, passeio) estão em mascotLogic.js; aqui ficam as janelas e os relógios.
const { BrowserWindow, screen } = require('electron');
const { execFile } = require('child_process');
const path = require('path');
const logic = require('./mascotLogic');

const WIN_W = 540; // sobra dos lados e em cima para o balão de fala, que desliza perto das bordas
const WIN_H = 170;
const SPRITE_W = 64;
const SPRITE_H = 60;
const PANEL_W = 236;
const PANEL_WIN = { width: 308, height: 520 }; // mesma janela do painel clássico
const TICK_MS = 1000 / 60;
const SPEECH_MS = 7000;
const BALLOON_LEAVE_MS = 3000;
const BALLOON_IDLE_MS = 12000;

// Classe e retângulo da janela em primeiro plano (para não passear por cima de tela cheia).
const FOREGROUND_PS = `
Add-Type @"
using System; using System.Text; using System.Runtime.InteropServices;
public class Fg {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  public struct RECT { public int L, T, R, B; }
}
"@
$h = [Fg]::GetForegroundWindow(); $r = New-Object Fg+RECT; [void][Fg]::GetWindowRect($h, [ref]$r)
$s = New-Object Text.StringBuilder 256; [void][Fg]::GetClassName($h, $s, 256)
"$($r.L),$($r.T),$($r.R),$($r.B),$($s.ToString())"
`;

function foregroundIsFullscreen() {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') return resolve(false);
    const encoded = Buffer.from(FOREGROUND_PS, 'utf16le').toString('base64');
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], { windowsHide: true, timeout: 5000 }, (err, stdout) => {
      if (err) return resolve(false); // sem resposta: segue como se não houvesse tela cheia
      const rects = screen.getAllDisplays().map((d) => screen.dipToScreenRect(null, d.bounds));
      resolve(logic.isFullscreen(logic.parseForeground(stdout), rects));
    });
  });
}

// opts: store, getDisplays() -> monitores marcados [{ id, bounds, workArea }], onMenu(win), theme()
function createMascot(opts) {
  const { store } = opts;
  let win = null;
  let balloon = null;
  let balloonHeight = 430;
  let balloonTimer = null;
  let destroyed = false;

  // posição dos pés e estado do movimento
  let pos = null; // { cx, foot }
  let cur = null; // monitor em que ele está
  let mode = 'idle'; // idle | walk | air | drag
  let dir = 1;
  let left = 0; // px que faltam no trecho de passeio
  let vel = { vx: 0, vy: 0 };
  let resumeLeft = 0; // trecho a retomar depois de um pulo ou queda entre monitores
  let ticker = null;
  let lastTick = 0;
  let walkTimer = null;
  let dragOrigin = null;

  // o que ele mostra
  let emotion = 'feliz';
  let summary = '';
  let speech = null;
  let speechTimer = null;

  const walking = () => store.get('mascotMove') === 'walk';
  const displays = () => {
    const list = opts.getDisplays();
    return list.length ? list : screen.getAllDisplays();
  };
  const everyDisplay = () => (walking() ? displays() : screen.getAllDisplays());

  function defaultPos() {
    const d = displays()[0];
    return { cx: d.workArea.x + d.workArea.width - 160, foot: logic.groundOf(d) };
  }

  function loadPos() {
    const saved = store.get('mascotPos');
    const okNum = saved && Number.isFinite(saved.cx) && Number.isFinite(saved.foot);
    pos = okNum ? { cx: saved.cx, foot: saved.foot } : defaultPos();
    cur = logic.displayAt(everyDisplay(), pos.cx, pos.foot - 1);
    // fora de qualquer monitor (monitor desligado): volta para um lugar visível
    const b = cur.bounds;
    if (pos.cx < b.x || pos.cx > b.x + b.width || pos.foot < b.y + SPRITE_H || pos.foot > b.y + b.height) pos = defaultPos();
    cur = logic.displayAt(everyDisplay(), pos.cx, pos.foot - 1);
  }

  function savePos() {
    store.set('mascotPos', { cx: Math.round(pos.cx), foot: Math.round(pos.foot) });
  }

  function place() {
    if (!win || win.isDestroyed()) return;
    win.setBounds({ x: Math.round(pos.cx - WIN_W / 2), y: Math.round(pos.foot - WIN_H), width: WIN_W, height: WIN_H });
  }

  // Espaço livre de cada lado até a borda do monitor; a interface desloca o balão de fala para caber.
  function bubbleRoom() {
    const b = cur.bounds;
    return { left: Math.round(pos.cx - b.x), right: Math.round(b.x + b.width - pos.cx) };
  }

  function pose() {
    if (mode === 'drag') return 'drag';
    if (mode === 'air') return 'air';
    if (mode === 'walk') return 'walk';
    return speech ? 'talk' : 'idle';
  }

  function push() {
    if (!win || win.isDestroyed()) return;
    win.webContents.send('mascot:state', { pose: pose(), dir, emotion, speech, summary, room: bubbleRoom(), theme: store.get('theme') });
  }

  // ---------- relógio de movimento: só roda enquanto ele anda ou está no ar ----------
  function startTicker() {
    if (ticker) return;
    lastTick = Date.now();
    ticker = setInterval(tick, TICK_MS);
  }
  function stopTicker() {
    clearInterval(ticker);
    ticker = null;
  }

  function settle() {
    mode = 'idle';
    stopTicker();
    savePos();
    push();
    scheduleWalk();
  }

  function tick() {
    const now = Date.now();
    const dt = Math.min(0.05, (now - lastTick) / 1000);
    lastTick = now;
    if (mode === 'walk') {
      const r = logic.stepWalk({ cx: pos.cx, dir, left }, dt, cur, displays());
      pos.cx = r.cx;
      if (r.type === 'walk') {
        if (r.dir !== dir) { dir = r.dir; push(); }
        left = r.left;
      } else if (r.type === 'cross') {
        cur = r.to;
        left = r.left;
        if (left <= 0) return settle();
      } else if (r.type === 'fall' || r.type === 'jump') {
        resumeLeft = Math.max(60, left);
        if (r.type === 'fall') cur = r.to;
        vel = { vx: r.vx, vy: r.vy || 0, to: r.to };
        mode = 'air';
        push();
      } else {
        place();
        return settle();
      }
    } else if (mode === 'air') {
      // num pulo, o chão passa a ser o do vizinho quando o centro cruza a divisa
      if (vel.to && cur.id !== vel.to.id) {
        const b = vel.to.bounds;
        if (pos.cx >= b.x && pos.cx < b.x + b.width) cur = vel.to;
      }
      const r = logic.stepAir({ cx: pos.cx, foot: pos.foot, vx: vel.vx, vy: vel.vy }, dt, logic.groundOf(cur));
      pos.cx = r.cx;
      pos.foot = r.foot;
      vel.vy = r.vy;
      if (r.landed) {
        // pousou: segue o trecho que estava fazendo, ou para
        if (resumeLeft > 0 && walking() && emotion !== 'morto') {
          left = resumeLeft;
          resumeLeft = 0;
          mode = 'walk';
          push();
        } else {
          resumeLeft = 0;
          place();
          return settle();
        }
      }
    }
    place();
  }

  // ---------- passeio ----------
  function scheduleWalk() {
    clearTimeout(walkTimer);
    if (destroyed || !walking()) return;
    walkTimer = setTimeout(tryWalk, logic.nextWalkDelayMs(store.get('mascotFreq')));
  }

  async function tryWalk() {
    if (destroyed) return;
    const busy = () => mode !== 'idle' || emotion === 'morto' || speech || balloonOpen() || !win || !win.isVisible();
    if (!walking() || busy()) return scheduleWalk();
    if (await foregroundIsFullscreen()) return scheduleWalk();
    if (destroyed || busy()) return scheduleWalk();
    const plan = logic.planWalk();
    dir = plan.dir;
    left = plan.distance;
    mode = 'walk';
    push();
    startTicker();
  }

  // Para onde estiver e fica parado (painel aberto, morreu, vai falar).
  function halt() {
    if (mode !== 'walk') return;
    mode = 'idle';
    stopTicker();
    savePos();
    scheduleWalk();
  }

  // Solto no ar no modo passeio: cai até o chão do monitor onde está.
  function dropToGround() {
    cur = logic.displayAt(displays(), pos.cx, pos.foot - 1);
    const b = cur.bounds;
    pos.cx = Math.max(b.x + logic.HALF_W, Math.min(b.x + b.width - logic.HALF_W, pos.cx));
    const ground = logic.groundOf(cur);
    if (pos.foot >= ground) {
      pos.foot = ground;
      place();
      return settle();
    }
    vel = { vx: 0, vy: 0 };
    resumeLeft = 0;
    mode = 'air';
    push();
    startTicker();
  }

  // ---------- balão com o painel clássico ----------
  const balloonOpen = () => !!(balloon && !balloon.isDestroyed() && balloon.isVisible());

  function createBalloon() {
    balloon = new BrowserWindow({
      ...PANEL_WIN,
      frame: false,
      transparent: true,
      resizable: false,
      movable: false,
      maximizable: false,
      minimizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      focusable: false,
      hasShadow: false,
      show: false,
      webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true },
    });
    balloon.setAlwaysOnTop(true, 'screen-saver');
    balloon.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'), { query: { balloon: '1' } });
  }

  function placeBalloon() {
    if (!balloon || balloon.isDestroyed()) return;
    const sprite = { x: pos.cx - SPRITE_W / 2, y: pos.foot - SPRITE_H, width: SPRITE_W, height: SPRITE_H };
    const at = logic.balloonPosition(sprite, { width: PANEL_W, height: balloonHeight }, PANEL_WIN, cur.workArea);
    balloon.setBounds({ ...at, ...PANEL_WIN });
  }

  function closeBalloon() {
    clearTimeout(balloonTimer);
    if (balloonOpen()) balloon.hide();
    scheduleWalk();
  }

  function toggleBalloon() {
    if (!balloon || balloon.isDestroyed()) return;
    if (balloonOpen()) return closeBalloon();
    halt();
    push();
    placeBalloon();
    balloon.showInactive();
    clearTimeout(balloonTimer);
    balloonTimer = setTimeout(closeBalloon, BALLOON_IDLE_MS);
  }

  // ---------- janela ----------
  function create() {
    loadPos();
    win = new BrowserWindow({
      width: WIN_W,
      height: WIN_H,
      frame: false,
      transparent: true,
      resizable: false,
      movable: false,
      maximizable: false,
      minimizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      focusable: false,
      hasShadow: false,
      show: false,
      webPreferences: { preload: path.join(__dirname, 'mascotPreload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true },
    });
    win.setAlwaysOnTop(true, 'screen-saver');
    win.setIgnoreMouseEvents(true, { forward: true });
    win.loadFile(path.join(__dirname, '..', 'renderer', 'mascot.html'));
    win.webContents.once('did-finish-load', () => {
      if (destroyed || win.isDestroyed()) return;
      place();
      if (store.get('visible')) win.showInactive();
      if (walking()) dropToGround();
      else scheduleWalk();
    });
    createBalloon();
  }

  // Monitor ligado, desligado ou desmarcado: garante que ele continua num lugar visível.
  function onDisplaysChanged() {
    if (destroyed || !pos || mode === 'drag') return;
    const list = everyDisplay();
    cur = logic.displayAt(list, pos.cx, pos.foot - 1);
    const b = cur.bounds;
    const outside = pos.cx < b.x || pos.cx > b.x + b.width || pos.foot < b.y || pos.foot > b.y + b.height;
    if (outside) {
      pos.cx = Math.max(b.x + logic.HALF_W, Math.min(b.x + b.width - logic.HALF_W, pos.cx));
      pos.foot = logic.groundOf(cur);
    }
    if (walking()) dropToGround();
    else { place(); savePos(); push(); }
  }

  create();

  const isMascot = (wc) => !!(win && !win.isDestroyed() && wc === win.webContents);
  const isBalloon = (wc) => !!(balloon && !balloon.isDestroyed() && wc === balloon.webContents);

  return {
    isMascot,
    isBalloon,
    onDisplaysChanged,
    // Dados novos: recalcula emoção e resumo. Morto não anda.
    update(payload) {
      emotion = logic.emotion(payload);
      summary = logic.summary(payload);
      if (emotion === 'morto') halt();
      push();
    },
    // Alerta virando fala.
    say(text) {
      speech = String(text || '').slice(0, 140);
      halt();
      push();
      clearTimeout(speechTimer);
      speechTimer = setTimeout(() => { speech = null; push(); scheduleWalk(); }, SPEECH_MS);
    },
    // Preferência de movimento ou de frequência mudou.
    refreshPrefs() {
      push();
      if (mode === 'drag') return;
      if (walking()) {
        if (mode === 'idle') dropToGround();
      } else if (mode !== 'idle') {
        mode = 'idle';
        stopTicker();
        savePos();
        push();
      }
      scheduleWalk();
    },
    setVisible(show) {
      if (!win || win.isDestroyed()) return;
      if (show) win.showInactive();
      else { win.hide(); closeBalloon(); }
    },
    toBalloon(channel, payload) {
      if (balloon && !balloon.isDestroyed()) balloon.webContents.send(channel, payload);
    },
    setBalloonHeight(h) {
      if (!Number.isFinite(h) || h < 100 || h > PANEL_WIN.height) return;
      balloonHeight = Math.round(h);
      if (balloonOpen()) placeBalloon();
    },
    setBalloonIgnore(ignore) {
      if (balloon && !balloon.isDestroyed()) balloon.setIgnoreMouseEvents(!!ignore, { forward: true });
    },
    // O painel fecha sozinho um pouco depois de o mouse sair dele.
    balloonHover(inside) {
      if (!balloonOpen()) return;
      clearTimeout(balloonTimer);
      if (!inside) balloonTimer = setTimeout(closeBalloon, BALLOON_LEAVE_MS);
    },
    // ---- vindo da janela do mascote ----
    setIgnore(ignore) {
      if (win && !win.isDestroyed() && mode !== 'drag') win.setIgnoreMouseEvents(!!ignore, { forward: true });
    },
    click: toggleBalloon,
    menu() {
      if (win && !win.isDestroyed()) opts.onMenu(win);
    },
    dragStart() {
      closeBalloon();
      clearTimeout(walkTimer);
      stopTicker();
      mode = 'drag';
      resumeLeft = 0;
      dragOrigin = { ...pos };
      win.setIgnoreMouseEvents(false);
      push();
    },
    dragMove(dx, dy) {
      if (mode !== 'drag' || !Number.isFinite(dx) || !Number.isFinite(dy)) return;
      pos = { cx: dragOrigin.cx + dx, foot: dragOrigin.foot + dy };
      place();
    },
    dragEnd() {
      if (mode !== 'drag') return;
      mode = 'idle';
      // no modo fixo ele fica onde foi solto, em qualquer monitor; no passeio, cai até o chão
      cur = logic.displayAt(everyDisplay(), pos.cx, pos.foot - 1);
      if (walking()) return dropToGround();
      savePos();
      push();
    },
    destroy() {
      destroyed = true;
      stopTicker();
      clearTimeout(walkTimer);
      clearTimeout(speechTimer);
      clearTimeout(balloonTimer);
      if (pos) savePos();
      if (win && !win.isDestroyed()) win.destroy();
      if (balloon && !balloon.isDestroyed()) balloon.destroy();
    },
    // usado nos testes manuais: força um trecho de passeio agora
    debugWalk(d, distance) {
      if (mode !== 'idle') return;
      dir = d;
      left = distance;
      mode = 'walk';
      push();
      startTicker();
    },
    debugState: () => ({ mode, dir, pos: pos && { ...pos }, cur: cur && cur.id, emotion, speech, balloon: balloonOpen() }),
  };
}

module.exports = { createMascot };
