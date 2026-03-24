const path = require('path');
const fs = require('fs');
const os = require('os');
const { dialog, ipcMain, clipboard } = require('electron');
const { IPC, DEFAULTS } = require('../shared/constants');

const BACKUP_VERSION = 1;
const AGENT_MEM_FILENAMES = ['CLAUDE.md', 'GEMINI.md', 'AGENTS.md'];
const PROJECT_MEMORY_OPTIONAL_FILENAMES = ['README.md'];
const WORKFLOW_FILENAMES = ['todo.md', 'lessons.md'];
const PROJECT_MEMORY_FILENAMES = [...AGENT_MEM_FILENAMES, ...PROJECT_MEMORY_OPTIONAL_FILENAMES, ...WORKFLOW_FILENAMES];
const AGENT_USER_DIRS = [
  { dir: '.claude', name: 'CLAUDE.md' },
  { dir: '.gemini', name: 'GEMINI.md' },
  { dir: '.codex', name: 'AGENTS.md' },
];
const EXPLORER_IGNORE = new Set(['.git', 'node_modules', '__pycache__', '.next', 'dist', 'build', '.cache', 'target', 'venv', '.venv']);

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isContainedIn(parent, child) {
  const rel = path.relative(parent, child);
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

function resolveDraftFilePath(folder, filename) {
  const baseFolder = String(folder || '').trim();
  const safeName = path.basename(String(filename || '').trim());
  if (!baseFolder || !safeName) return null;
  const folderResolved = path.resolve(baseFolder);
  const fileResolved = path.resolve(folderResolved, safeName);
  if (!isContainedIn(folderResolved, fileResolved)) return null;
  return fileResolved;
}

function resolveProjectFilePath(projectPath, targetPath) {
  const root = String(projectPath || '').trim();
  const raw = String(targetPath || '').trim();
  if (!root || !raw) return null;
  const rootResolved = path.resolve(root);
  const candidate = path.isAbsolute(raw)
    ? path.resolve(raw)
    : path.resolve(rootResolved, raw);
  if (!isContainedIn(rootResolved, candidate)) return null;
  return candidate;
}

function readMemFile(filePath) {
  try { return fs.readFileSync(filePath, 'utf8'); } catch { return null; }
}

function estimateTokens(val) {
  if (!val) return 0;
  const text = typeof val === 'string' ? val : JSON.stringify(val);
  return Math.ceil(text.length / 4);
}

function peekSession(filePath) {
  let cwd = null;
  let firstUserText = null;
  try {
    const fd = fs.openSync(filePath, 'r');
    const buf = Buffer.alloc(8192);
    const bytesRead = fs.readSync(fd, buf, 0, 8192, 0);
    fs.closeSync(fd);
    const head = buf.slice(0, bytesRead).toString('utf8');
    for (const line of head.split('\n')) {
      if (!line.trim()) continue;
      let entry;
      try { entry = JSON.parse(line); } catch { continue; }
      if (!cwd && entry.cwd) cwd = entry.cwd;
      if (!firstUserText && entry.type === 'user') {
        const content = entry.message?.content;
        const blocks = Array.isArray(content) ? content : (typeof content === 'string' ? [{ type: 'text', text: content }] : []);
        const textBlock = blocks.find((b) => b.type === 'text' && b.text);
        if (textBlock) firstUserText = String(textBlock.text).trim().replace(/\s+/g, ' ').slice(0, 80);
      }
      if (cwd && firstUserText) break;
    }
  } catch {}
  return { cwd, firstUserText };
}

function findFilesRecursively(dir, filenames, maxDepth = 5, depth = 0) {
  const found = [];
  if (depth > maxDepth) return found;
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return found; }
  for (const entry of entries) {
    if (EXPLORER_IGNORE.has(entry.name)) continue;
    if (entry.isDirectory()) {
      found.push(...findFilesRecursively(path.join(dir, entry.name), filenames, maxDepth, depth + 1));
    } else if (filenames.includes(entry.name.toLowerCase())) {
      found.push(path.join(dir, entry.name));
    }
  }
  return found;
}

function setup({ store, winRef, readNormalizedConfig }) {
  function send(channel, ...args) {
    const win = winRef.win;
    if (win && !win.isDestroyed()) win.webContents.send(channel, ...args);
  }

  let agentMemWatcher = null;
  let agentMemWatchTimer = null;

  ipcMain.handle(IPC.FILE_READ_TEXT, (_e, filePath) => {
    const projectPath = String(store.get('memoryProjectPath') || '').trim();
    const fullPath = resolveProjectFilePath(projectPath, filePath);
    if (!fullPath) return { ok: false, error: 'Invalid file path' };
    try {
      const content = fs.readFileSync(fullPath, 'utf8');
      return { ok: true, filePath: fullPath, content };
    } catch (err) {
      return { ok: false, error: err.message || 'Failed to read file' };
    }
  });
  ipcMain.handle(IPC.FILE_WRITE_TEXT, (_e, filePath, content) => {
    const projectPath = String(store.get('memoryProjectPath') || '').trim();
    const fullPath = resolveProjectFilePath(projectPath, filePath);
    if (!fullPath) return { ok: false, error: 'Invalid file path' };
    try {
      fs.writeFileSync(fullPath, String(content ?? ''), 'utf8');
      return { ok: true, filePath: fullPath };
    } catch (err) {
      return { ok: false, error: err.message || 'Failed to write file' };
    }
  });

  ipcMain.handle(IPC.EXPLORER_LIST_DIR, (_e, dirPath) => {
    try {
      const dir = String(dirPath || '').trim();
      if (!dir) return { ok: false, error: 'No directory specified' };
      const projectPath = String(store.get('memoryProjectPath') || '').trim();
      if (projectPath) {
        const resolved = path.resolve(dir);
        const root = path.resolve(projectPath);
        if (resolved !== root && !isContainedIn(root, resolved)) {
          return { ok: false, error: 'Path outside project directory' };
        }
      }
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      const result = entries
        .filter((e) => !EXPLORER_IGNORE.has(e.name))
        .map((e) => ({ name: e.name, path: path.join(dir, e.name), type: e.isDirectory() ? 'dir' : 'file' }))
        .sort((a, b) => {
          if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
          return a.name.localeCompare(b.name);
        });
      return { ok: true, entries: result };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });
  ipcMain.handle(IPC.EXPLORER_READ_FILE, (_e, filePath) => {
    try {
      const p = String(filePath || '').trim();
      if (!p) return { ok: false, error: 'No file path specified' };
      const projectPath = String(store.get('memoryProjectPath') || '').trim();
      if (projectPath) {
        const resolved = path.resolve(p);
        const root = path.resolve(projectPath);
        if (!isContainedIn(root, resolved)) {
          return { ok: false, error: 'Path outside project directory' };
        }
      }
      const stat = fs.statSync(p);
      if (stat.size > 2 * 1024 * 1024) return { ok: false, error: 'File too large (>2 MB)' };
      const content = fs.readFileSync(p, 'utf8');
      return { ok: true, content, path: p };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle(IPC.AGENT_MEMORY_SCAN, (_e, cwd) => {
    const dir = String(cwd || '').trim();
    if (agentMemWatcher) { try { agentMemWatcher.close(); } catch {} agentMemWatcher = null; }
    let projectFiles = [];
    if (dir) {
      projectFiles = AGENT_MEM_FILENAMES.map((name) => {
        const fullPath = path.join(dir, name);
        const exists = fs.existsSync(fullPath);
        return { name, fullPath, exists, content: exists ? readMemFile(fullPath) : null };
      });
      for (const name of PROJECT_MEMORY_OPTIONAL_FILENAMES) {
        const fullPath = path.join(dir, name);
        if (!fs.existsSync(fullPath)) continue;
        projectFiles.push({ name, fullPath, exists: true, content: readMemFile(fullPath) });
      }
      const workflowPaths = findFilesRecursively(dir, WORKFLOW_FILENAMES);
      for (const fullPath of workflowPaths) {
        const name = path.basename(fullPath);
        const relPath = path.relative(dir, fullPath);
        projectFiles.push({ name, fullPath, relPath, exists: true, content: readMemFile(fullPath), isWorkflow: true });
      }
      const watchSet = new Set(PROJECT_MEMORY_FILENAMES.map((n) => n.toLowerCase()));
      try {
        agentMemWatcher = fs.watch(dir, { recursive: true }, (_, filename) => {
          if (!filename || !watchSet.has(path.basename(filename).toLowerCase())) return;
          clearTimeout(agentMemWatchTimer);
          agentMemWatchTimer = setTimeout(() => send(IPC.AGENT_MEMORY_CHANGED, dir), 200);
        });
      } catch {}
    }
    const home = os.homedir();
    const userFiles = AGENT_USER_DIRS.map(({ dir: d, name }) => {
      const fullPath = path.join(home, d, name);
      const exists = fs.existsSync(fullPath);
      return { name, location: d, fullPath, exists, content: exists ? readMemFile(fullPath) : null };
    });
    return { cwd: dir, projectFiles, userFiles };
  });

  ipcMain.handle(IPC.AGENT_MEMORY_SAVE, (_e, fullPath, content) => {
    const p = String(fullPath || '').trim();
    if (!p || !PROJECT_MEMORY_FILENAMES.includes(path.basename(p))) return { ok: false };
    const resolved = path.resolve(p);
    const projectPath = String(store.get('memoryProjectPath') || '').trim();
    const home = os.homedir();
    const allowedRoots = [
      projectPath ? path.resolve(projectPath) : null,
      path.join(home, '.claude'),
      path.join(home, '.gemini'),
      path.join(home, '.codex'),
    ].filter(Boolean);
    const allowed = allowedRoots.some((root) => {
      const rel = path.relative(root, resolved);
      return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
    });
    if (!allowed) return { ok: false, error: 'Path outside allowed directories' };
    try {
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, String(content ?? ''), 'utf8');
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle(IPC.PROMPT_DRAFT_WRITE_FILE, (_e, payload) => {
    const folder = String(payload?.folder || '').trim();
    const filename = String(payload?.filename || '').trim();
    const content = String(payload?.content ?? '');
    const filePath = resolveDraftFilePath(folder, filename);
    if (!filePath) return { ok: false, error: 'Invalid folder or filename' };
    try {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, content, 'utf8');
      return { ok: true, filePath };
    } catch (err) {
      return { ok: false, error: err.message || 'Failed to write draft file' };
    }
  });
  ipcMain.handle(IPC.PROMPT_DRAFT_DELETE_FILE, (_e, payload) => {
    const folder = String(payload?.folder || '').trim();
    const filename = String(payload?.filename || '').trim();
    const filePath = resolveDraftFilePath(folder, filename);
    if (!filePath) return { ok: false, error: 'Invalid folder or filename' };
    try {
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message || 'Failed to delete draft file' };
    }
  });
  ipcMain.handle(IPC.PROMPT_DRAFT_READ_FOLDER, (_e, payload) => {
    const folder = String(payload?.folder || '').trim();
    if (!folder) return { ok: true, files: [] };
    try {
      const entries = fs.readdirSync(folder).filter((f) => f.startsWith('hermes_') && f.endsWith('.md'));
      const files = [];
      for (const filename of entries) {
        const filePath = path.join(folder, filename);
        try {
          files.push({ filename, content: fs.readFileSync(filePath, 'utf8') });
        } catch {}
      }
      return { ok: true, files };
    } catch (err) {
      return { ok: false, error: err.message || 'Failed to read drafts folder', files: [] };
    }
  });

  function resolveTodoFilePath(folder, filename) {
    const baseFolder = String(folder || '').trim();
    const safeName = path.basename(String(filename || '').trim());
    if (!baseFolder || !safeName) return null;
    const todoDir = path.resolve(baseFolder, 'todo');
    const fileResolved = path.resolve(todoDir, safeName);
    if (!isContainedIn(todoDir, fileResolved)) return null;
    return fileResolved;
  }

  ipcMain.handle(IPC.TODO_WRITE_FILE, (_e, payload) => {
    const folder = String(payload?.folder || '').trim();
    const filename = String(payload?.filename || '').trim();
    const content = String(payload?.content ?? '');
    const filePath = resolveTodoFilePath(folder, filename);
    if (!filePath) return { ok: false, error: 'Invalid folder or filename' };
    try {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, content, 'utf8');
      return { ok: true, filePath };
    } catch (err) {
      return { ok: false, error: err.message || 'Failed to write todo file' };
    }
  });

  ipcMain.handle(IPC.TODO_DELETE_FILE, (_e, payload) => {
    const folder = String(payload?.folder || '').trim();
    const filename = String(payload?.filename || '').trim();
    const filePath = resolveTodoFilePath(folder, filename);
    if (!filePath) return { ok: false, error: 'Invalid folder or filename' };
    try {
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message || 'Failed to delete todo file' };
    }
  });

  ipcMain.handle(IPC.TODO_READ_FOLDER, (_e, payload) => {
    const folder = String(payload?.folder || '').trim();
    if (!folder) return { ok: true, files: [] };
    const todoDir = path.resolve(folder, 'todo');
    try {
      if (!fs.existsSync(todoDir)) return { ok: true, files: [] };
      const entries = fs.readdirSync(todoDir).filter((f) => f.startsWith('todo_') && f.endsWith('.md'));
      const files = [];
      for (const filename of entries) {
        const filePath = path.join(todoDir, filename);
        try {
          files.push({ filename, content: fs.readFileSync(filePath, 'utf8') });
        } catch {}
      }
      return { ok: true, files };
    } catch (err) {
      return { ok: false, error: err.message || 'Failed to read todo folder', files: [] };
    }
  });

  ipcMain.handle(IPC.ARTIFACT_COPY, (_e, content) => {
    clipboard.writeText(String(content ?? ''));
    return { ok: true };
  });
  ipcMain.handle(IPC.ARTIFACT_SAVE_AS, async (_e, artifact) => {
    const win = winRef.win;
    if (!win || win.isDestroyed()) return { ok: false, canceled: true };
    const suggestedName = String(artifact?.filename || 'artifact.txt').trim() || 'artifact.txt';
    const payload = String(artifact?.content ?? '');
    const result = await dialog.showSaveDialog(win, {
      title: 'Save Artifact',
      defaultPath: suggestedName,
    });
    if (result.canceled || !result.filePath) return { ok: false, canceled: true };
    fs.writeFileSync(result.filePath, payload, 'utf8');
    return { ok: true, canceled: false, filePath: result.filePath };
  });

  ipcMain.handle(IPC.BACKUP_EXPORT, async (_e, payload) => {
    const win = winRef.win;
    if (!win || win.isDestroyed()) return { ok: false, canceled: true };
    const suggestedName = `hermes-backup-${new Date().toISOString().slice(0, 10)}.json`;
    const result = await dialog.showSaveDialog(win, {
      title: 'Export Hermes Backup',
      defaultPath: suggestedName,
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    if (result.canceled || !result.filePath) return { ok: false, canceled: true };
    const backup = {
      version: BACKUP_VERSION,
      exportedAt: Date.now(),
      config: store.store,
      localData: isPlainObject(payload?.localData) ? payload.localData : {},
    };
    fs.writeFileSync(result.filePath, JSON.stringify(backup, null, 2), 'utf8');
    return { ok: true, canceled: false, filePath: result.filePath };
  });
  ipcMain.handle(IPC.BACKUP_IMPORT_PICK, async () => {
    const win = winRef.win;
    if (!win || win.isDestroyed()) return { ok: false, canceled: true };
    const result = await dialog.showOpenDialog(win, {
      title: 'Import Hermes Backup',
      properties: ['openFile'],
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    if (result.canceled || !result.filePaths?.[0]) return { ok: false, canceled: true };
    const filePath = result.filePaths[0];
    try {
      const raw = fs.readFileSync(filePath, 'utf8');
      const parsed = JSON.parse(raw);
      if (!isPlainObject(parsed) || !isPlainObject(parsed.config)) {
        return { ok: false, canceled: false, error: 'Invalid backup format' };
      }
      return {
        ok: true,
        canceled: false,
        filePath,
        data: {
          version: Number(parsed.version || 0),
          exportedAt: Number(parsed.exportedAt || 0),
          config: parsed.config,
          localData: isPlainObject(parsed.localData) ? parsed.localData : {},
        },
      };
    } catch (err) {
      return { ok: false, canceled: false, error: err.message || 'Failed to read backup' };
    }
  });
  ipcMain.handle(IPC.BACKUP_IMPORT_APPLY_CONFIG, (_e, importedConfig) => {
    if (!isPlainObject(importedConfig)) return { ok: false, error: 'Invalid config payload' };
    const KNOWN_KEYS = new Set([...Object.keys(DEFAULTS), 'sessionRefs']);
    const unknownKeys = Object.keys(importedConfig).filter((k) => !KNOWN_KEYS.has(k));
    if (unknownKeys.length > 0) return { ok: false, error: `Unrecognised config keys: ${unknownKeys.join(', ')}` };
    const merged = { ...DEFAULTS, sessionRefs: [], ...importedConfig };
    store.clear();
    store.set(merged);
    return { ok: true, config: readNormalizedConfig() };
  });

  ipcMain.handle(IPC.CONTEXT_LIST_SESSIONS, () => {
    try {
      const projectsDir = path.join(os.homedir(), '.claude', 'projects');
      if (!fs.existsSync(projectsDir)) return { ok: true, sessions: [] };
      const sessions = [];
      for (const projDir of fs.readdirSync(projectsDir)) {
        const projPath = path.join(projectsDir, projDir);
        try {
          if (!fs.statSync(projPath).isDirectory()) continue;
          for (const file of fs.readdirSync(projPath)) {
            if (!file.endsWith('.jsonl')) continue;
            const filePath = path.join(projPath, file);
            const fstat = fs.statSync(filePath);
            sessions.push({ filePath, projectDir: projDir, fileName: file, mtime: fstat.mtimeMs, size: fstat.size });
          }
        } catch {}
      }
      sessions.sort((a, b) => b.mtime - a.mtime);
      const top = sessions.slice(0, 20);
      for (const s of top) {
        const { cwd, firstUserText } = peekSession(s.filePath);
        s.cwd = cwd;
        s.firstUserText = firstUserText;
      }
      return { ok: true, sessions: top };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle(IPC.CONTEXT_LOAD_SESSION, (_e, filePath) => {
    try {
      const p = String(filePath || '').trim();
      const allowedRoot = path.join(os.homedir(), '.claude', 'projects');
      const resolved = path.resolve(p);
      if (!isContainedIn(allowedRoot, resolved)) return { ok: false, error: 'Path outside allowed directory' };
      const raw = fs.readFileSync(resolved, 'utf8');
      const lines = raw.split('\n').filter(Boolean);
      const chunks = [];
      let toolBatch = [];

      const flushToolBatch = () => {
        if (!toolBatch.length) return;
        const tokens = toolBatch.reduce((s, t) => s + t.tokens, 0);
        const names = [...new Set(toolBatch.map((t) => t.name))];
        const allFileRead = toolBatch.every((t) => /^(Read|Glob|Grep|WebFetch|WebSearch|View|LS)$/i.test(t.name));
        chunks.push({
          type: allFileRead ? 'file_read' : 'tool_use',
          label: names.length === 1 ? names[0] : `${toolBatch.length} tool calls`,
          tokens,
          count: toolBatch.length,
          preview: toolBatch.map((t) => `${t.name}: ${t.preview}`).join('\n'),
        });
        toolBatch = [];
      };

      for (const line of lines) {
        let entry;
        try { entry = JSON.parse(line); } catch { continue; }

        if (entry.type === 'summary') {
          flushToolBatch();
          const text = entry.summary || '';
          chunks.push({ type: 'summary', label: 'Compacted summary', tokens: estimateTokens(text), count: 1, preview: text.slice(0, 300) });
          continue;
        }

        const msg = entry.message;
        if (!msg) continue;
        const content = Array.isArray(msg.content) ? msg.content : (msg.content ? [{ type: 'text', text: String(msg.content) }] : []);

        for (const block of content) {
          if (block.type === 'tool_use') {
            toolBatch.push({
              name: block.name || 'tool',
              tokens: estimateTokens(block.input) + estimateTokens(block.name),
              preview: JSON.stringify(block.input || {}).slice(0, 120),
            });
          } else if (block.type === 'tool_result') {
            flushToolBatch();
            const resultText = Array.isArray(block.content)
              ? block.content.map((c) => c.text || '').join('')
              : String(block.content || '');
            chunks.push({ type: 'tool_result', label: 'Tool result', tokens: estimateTokens(resultText), count: 1, preview: resultText.slice(0, 300) });
          } else if (block.type === 'text' && block.text) {
            flushToolBatch();
            const role = msg.role === 'user' ? 'user_text' : 'assistant_text';
            chunks.push({ type: role, label: msg.role === 'user' ? 'User' : 'Assistant', tokens: estimateTokens(block.text), count: 1, preview: block.text.slice(0, 300) });
          }
        }
      }
      flushToolBatch();

      const totalTokens = chunks.reduce((s, c) => s + c.tokens, 0);
      return { ok: true, chunks, totalTokens };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });
}

module.exports = { setup };
