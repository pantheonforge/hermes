const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const { ipcMain, shell } = require('electron');
const { IPC } = require('../shared/constants');

function gitRun(cwd, args) {
  return new Promise((resolve, reject) => {
    execFile('git', args, { cwd, maxBuffer: 5 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) reject(new Error(String(stderr || err.message || 'git error').trim()));
      else resolve(stdout);
    });
  });
}

function validateHash(hash) {
  if (typeof hash !== 'string' || !/^[0-9a-f]{4,40}$/i.test(hash.trim())) {
    throw new Error('Invalid git hash');
  }
  return hash.trim();
}

function validatePath(file) {
  const f = String(file || '').trim();
  if (f.startsWith('-')) throw new Error('Invalid file path');
  return f;
}

function parseGitStatus(output) {
  const staged = [], unstaged = [];
  for (const line of output.split('\n')) {
    if (line.length < 4) continue;
    const x = line[0];
    const y = line[1];
    const file = line.slice(3).trim();
    if (!file) continue;
    if (x !== ' ' && x !== '?') staged.push({ file, status: x });
    if (y !== ' ') {
      if (y === '?') {
        if (x === '?') unstaged.push({ file, status: '??' });
      } else {
        unstaged.push({ file, status: y });
      }
    }
  }
  return { staged, unstaged };
}

function setup() {
  ipcMain.handle(IPC.GIT_STATUS, async (_e, cwd) => {
    try {
      const out = await gitRun(String(cwd || '').trim() || undefined, ['status', '--porcelain', '-uall']);
      return { ok: true, ...parseGitStatus(out) };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });
  ipcMain.handle(IPC.GIT_DIFF, async (_e, cwd, file, staged) => {
    try {
      const safeFile = validatePath(file);
      const args = staged
        ? ['diff', '--cached', '--', safeFile]
        : ['diff', '--', safeFile];
      const out = await gitRun(String(cwd || '').trim() || undefined, args);
      return { ok: true, diff: out };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });
  ipcMain.handle(IPC.GIT_STAGE, async (_e, cwd, file) => {
    try {
      await gitRun(String(cwd || '').trim() || undefined, ['add', '--', validatePath(file)]);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });
  ipcMain.handle(IPC.GIT_UNSTAGE, async (_e, cwd, file) => {
    try {
      await gitRun(String(cwd || '').trim() || undefined, ['reset', 'HEAD', '--', validatePath(file)]);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });
  ipcMain.handle(IPC.GIT_COMMIT, async (_e, cwd, message) => {
    try {
      const msg = String(message || '').trim();
      if (!msg) return { ok: false, error: 'Commit message required' };
      await gitRun(String(cwd || '').trim() || undefined, ['commit', '-m', msg]);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });
  ipcMain.handle(IPC.GIT_DISCARD, async (_e, cwd, file) => {
    try {
      await gitRun(String(cwd || '').trim() || undefined, ['checkout', '--', validatePath(file)]);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });
  ipcMain.handle(IPC.GIT_LOG, async (_e, cwd, filePath, limit) => {
    try {
      const args = [
        'log',
        `--pretty=format:%H\x1f%h\x1f%s\x1f%an\x1f%aI\x1f%ar`,
        '-n', String(limit || 200),
        '--',
        ...(filePath ? [validatePath(filePath)] : []),
      ];
      const out = await gitRun(String(cwd || '').trim() || undefined, args);
      const commits = out.split('\n').filter(Boolean).map((line) => {
        const [hash, shortHash, subject, author, date, relativeDate] = line.split('\x1f');
        return { hash, shortHash, subject, author, date, relativeDate };
      });
      return { ok: true, commits };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });
  ipcMain.handle(IPC.GIT_SHOW, async (_e, cwd, hash) => {
    try {
      const out = await gitRun(String(cwd || '').trim() || undefined, ['show', validateHash(hash)]);
      return { ok: true, diff: out };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });
  ipcMain.handle(IPC.GIT_PUSH, async (_e, cwd) => {
    try {
      await gitRun(String(cwd || '').trim() || undefined, ['push']);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });
  ipcMain.handle(IPC.GIT_BRANCH, async (_e, cwd) => {
    try {
      const out = await gitRun(String(cwd || '').trim() || undefined, ['rev-parse', '--abbrev-ref', 'HEAD']);
      return { ok: true, branch: out.trim() };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });
  ipcMain.handle(IPC.GIT_GITIGNORE, async (_e, cwd, file) => {
    try {
      const safeCwd = String(cwd || '').trim();
      const safeFile = validatePath(file);
      const giPath = path.join(safeCwd, '.gitignore');
      let existing = '';
      try { existing = fs.readFileSync(giPath, 'utf8'); } catch { /* file doesn't exist yet */ }
      const lines = existing.split('\n').map((l) => l.trim());
      if (lines.includes(safeFile)) return { ok: true, already: true };
      const append = (existing.length > 0 && !existing.endsWith('\n') ? '\n' : '') + safeFile + '\n';
      fs.writeFileSync(giPath, existing + append, 'utf8');
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });
  ipcMain.handle(IPC.SHELL_SHOW_IN_FOLDER, async (_e, fullPath) => {
    try {
      shell.showItemInFolder(String(fullPath || ''));
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });
}

module.exports = { setup };
