// Renova o token expirado pedindo ao próprio Claude Code (CLI oficial), escondido e pontual.
// O widget nunca fala com o endpoint de OAuth nem escreve no arquivo de credenciais.
//
// Degrau 1: `claude auth status` — comando curto, sem requisição ao modelo. Pode renovar de graça.
// Degrau 2: `claude -p ok --model haiku` — requisição mínima (gasta um pouco de uso). Só roda se o
//           degrau 1 não renovou, o usuário permitir e não houver outro Claude Code aberto.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');

const COOLDOWN_MS = 10 * 60 * 1000; // depois de uma falha, só tenta de novo em 10 min
const FREE_ARGS = ['auth', 'status'];
const PAID_ARGS = ['-p', 'ok', '--model', 'haiku', '--no-session-persistence', '--output-format', 'json', '--strict-mcp-config'];

function findClaudeExe() {
  const candidates = [
    path.join(os.homedir(), '.local', 'bin', 'claude.exe'),
    path.join(process.env.APPDATA || '', 'npm', 'claude.cmd'),
  ];
  return candidates.find((p) => p && fs.existsSync(p)) || null;
}

function runHidden(exe, args, timeoutMs) {
  return new Promise((resolve) => {
    const isCmd = /\.cmd$/i.test(exe);
    const child = execFile(exe, args, { windowsHide: true, timeout: timeoutMs, cwd: os.tmpdir(), shell: isCmd }, (err) => resolve(!err));
    if (child.stdin) child.stdin.end();
  });
}

// Quantos Claude Code (CLI) estão rodando. O aplicativo desktop (WindowsApps) não conta.
function countClaudeCli() {
  return new Promise((resolve) => {
    const ps = "(Get-CimInstance Win32_Process -Filter \"Name='claude.exe'\" | Where-Object { $_.ExecutablePath -and $_.ExecutablePath -notmatch 'WindowsApps' } | Measure-Object).Count";
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { windowsHide: true, timeout: 15000 }, (err, stdout) => {
      const n = parseInt(String(stdout).trim(), 10);
      resolve(err || Number.isNaN(n) ? 0 : n);
    });
  });
}

// deps injetáveis para teste: { findExe, run, countCli, readExpiry, now, log }
function createTokenRefresher(deps) {
  const d = { findExe: findClaudeExe, run: runHidden, countCli: countClaudeCli, now: Date.now, log: () => {}, ...deps };
  let running = null;
  let lastFailAt = 0;

  const isFresh = () => {
    const exp = d.readExpiry();
    return exp != null && exp > d.now();
  };

  async function attempt(allowPaid) {
    if (isFresh()) return { ok: true, tier: 'none' };
    const exe = d.findExe();
    if (!exe) return { ok: false, reason: 'no-cli' };

    await d.run(exe, FREE_ARGS, 30000);
    if (isFresh()) return { ok: true, tier: 'free' };

    if (!allowPaid) return { ok: false, reason: 'paid-disabled' };
    // Outro Claude Code aberto renova sozinho no próximo uso: não abre um segundo.
    if ((await d.countCli()) > 0) return { ok: false, reason: 'cli-open' };

    await d.run(exe, PAID_ARGS, 90000);
    if (isFresh()) return { ok: true, tier: 'paid' };
    return { ok: false, reason: 'not-renewed' };
  }

  return {
    // Uma tentativa por vez; após falha, espera o cooldown (o observador do arquivo cobre o resto).
    refresh({ allowPaid = false } = {}) {
      if (running) return running;
      if (lastFailAt && d.now() - lastFailAt < COOLDOWN_MS) return Promise.resolve({ ok: false, reason: 'cooldown' });
      running = attempt(allowPaid)
        .catch(() => ({ ok: false, reason: 'error' }))
        .then((r) => {
          running = null;
          lastFailAt = r.ok ? 0 : d.now();
          d.log(r);
          return r;
        });
      return running;
    },
    isRunning: () => !!running,
  };
}

module.exports = { createTokenRefresher, COOLDOWN_MS, FREE_ARGS, PAID_ARGS };
