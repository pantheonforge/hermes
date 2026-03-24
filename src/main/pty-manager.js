const pty = require('@homebridge/node-pty-prebuilt-multiarch');
const { EventEmitter } = require('events');
const path = require('path');

class PtyManager extends EventEmitter {
  constructor() {
    super();
    this._sessions = new Map(); // id → { pty, cwd }
  }

  create(id, { shell, cwd, env, cols = 80, rows = 24 } = {}) {
    if (this._sessions.has(id)) this.kill(id);

    const mergedEnv = { ...process.env, ...env };
    const shellName = path.basename(shell || '').replace(/\.exe$/i, '').toLowerCase();
    if (shellName === 'bash') {
      // Emit OSC 7 (file URI cwd) on every prompt, terminated with BEL (\007)
      const osc7 = `printf '\\033]7;file://localhost%s\\007' "$(pwd -P 2>/dev/null || pwd)"`;
      const prev = mergedEnv.PROMPT_COMMAND ? `;${mergedEnv.PROMPT_COMMAND}` : '';
      mergedEnv.PROMPT_COMMAND = osc7 + prev;
    }

    const spawnOptions = {
      name: 'xterm-256color',
      cols,
      rows,
      cwd,
      env: mergedEnv,
    };


    const proc = pty.spawn(shell, [], spawnOptions);

    const session = { pty: proc, cwd: cwd || process.env.HOME || '/', osc7: false };
    this._sessions.set(id, session);

    proc.onData((data) => {
      this.emit('output', id, data);
      // Try to extract cwd from OSC 7 (file URI) sequences emitted by shells
      // Handles both BEL (\x07) and ST (\x1b\) terminators
      const osc7 = data.match(/\x1b\]7;file:\/\/[^\x07\x1b/]*([^\x07\x1b]*)(?:\x07|\x1b\\)/);
      if (osc7) {
        let cwdPath = decodeURIComponent(osc7[1]);
        // Convert POSIX-style drive paths from git-bash/MSYS on Windows: /c/foo → C:\foo
        if (process.platform === 'win32') {
          const m = cwdPath.match(/^\/([a-zA-Z])(\/.*|$)/);
          if (m) cwdPath = m[1].toUpperCase() + ':' + (m[2] || '').replace(/\//g, '\\');
        }
        session.cwd = cwdPath;
        session.osc7 = true;
        this.emit('cwd', id, session.cwd);
      }
    });

    proc.onExit(({ exitCode }) => {
      this._sessions.delete(id);
      this.emit('exit', id, exitCode);
    });

    return { pid: proc.pid, cols, rows };
  }

  input(id, data) {
    const s = this._sessions.get(id);
    if (s) s.pty.write(data);
  }

  resize(id, cols, rows) {
    const s = this._sessions.get(id);
    if (s) {
      try { s.pty.resize(cols, rows); } catch { /* ignore if already dead */ }
    }
  }

  kill(id) {
    const s = this._sessions.get(id);
    if (!s) return;
    try {
      if (process.platform === 'win32') {
        // node-pty's kill() spawns conpty_console_list_agent.js which fails with
        // AttachConsole during app shutdown; kill the process tree directly instead.
        require('child_process').execSync(`taskkill /F /T /PID ${s.pty.pid}`, { stdio: 'ignore' });
      } else {
        s.pty.kill();
      }
    } catch { /* ignore */ }
    this._sessions.delete(id);
  }

  getCwd(id) {
    const s = this._sessions.get(id);
    if (!s || !s.osc7) return null; // only return if OSC 7 has actually fired
    return s.cwd;
  }

  writeSignal(id, message) {
    const s = this._sessions.get(id);
    if (!s) return;
    const safe = String(message || '').replace(/[\x00-\x08\x0b-\x0c\x0e-\x1f\x7f]/g, '');
    s.pty.write(`\r\n\x1b[33m[HERMES SIGNAL]: ${safe}\x1b[0m\r\n`);
  }

  killAll() {
    for (const id of this._sessions.keys()) this.kill(id);
  }
}

module.exports = { PtyManager };
