const { app, BrowserWindow, ipcMain, Menu, clipboard, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const Store = require('electron-store');
const { createMcpServer } = require('./mcp-server');
const { PtyManager } = require('./pty-manager');
const { PtyParser } = require('./pty-parser');
const { MemoryIndexService } = require('./memory-index-service');
const { createSmartStderrCollector } = require('./smart-stderr');
const { IPC, DEFAULTS, MCP_PORT, detectTool } = require('../shared/constants');
const { readNormalizedConfig: _readNormalizedConfig } = require('./config-helpers');
const { UsageWatcher } = require('./usage-watcher');

const store = new Store({
  defaults: {
    shell: DEFAULTS.shell,
    claudeCmd: DEFAULTS.claudeCmd,
    codexCmd: DEFAULTS.codexCmd,
    cwd: DEFAULTS.cwd,
    mcpPort: DEFAULTS.mcpPort,
    fontSize: DEFAULTS.fontSize,
    fontFamily: DEFAULTS.fontFamily,
    theme: DEFAULTS.theme,
    agentLabels: DEFAULTS.agentLabels,
    layouts: DEFAULTS.layouts,
    defaultLayoutId: DEFAULTS.defaultLayoutId,
    lastUsedLayoutId: DEFAULTS.lastUsedLayoutId,
    memoryProjectPath: DEFAULTS.memoryProjectPath,
    promptDraftsFolder: DEFAULTS.promptDraftsFolder,
    memoryAutoScan: DEFAULTS.memoryAutoScan,
    memoryIgnoreGlobs: DEFAULTS.memoryIgnoreGlobs,
    sessionRefs: [],
    workspaceSnapshot: DEFAULTS.workspaceSnapshot,
    usagePollingEnabled: DEFAULTS.usagePollingEnabled,
    claudeAutoMode: DEFAULTS.claudeAutoMode,
  },
});

let win = null;
const winRef = { win: null };
const ptyManager = new PtyManager();
let mcpServer = null;
let mcpSessionToken = null;
let memoryIndex = null;
let usageWatcher = null;
const memoryDeps = { memoryIndex: null, store };
let mcpConfigPath = null;
let appLogPath = null;
const smartStderr = createSmartStderrCollector({
  onEntry: (entry) => send(IPC.PTY_SMART_STDERR, entry),
});
const ENV_MCP_PORT = Number.parseInt(String(process.env.HERMES_MCP_PORT || '').trim(), 10);
const OVERRIDE_MCP_PORT = Number.isInteger(ENV_MCP_PORT) && ENV_MCP_PORT > 0 && ENV_MCP_PORT <= 65535
  ? ENV_MCP_PORT
  : null;

function logAppEvent(message, detail) {
  const line = `[${new Date().toISOString()}] ${String(message || '').trim()}${detail ? ` ${String(detail)}` : ''}\n`;
  try {
    if (appLogPath) fs.appendFileSync(appLogPath, line, 'utf8');
  } catch {}
  try {
    console.error(line.trim());
  } catch {}
}

function readNormalizedConfig() {
  const cfg = _readNormalizedConfig(store, OVERRIDE_MCP_PORT, mcpConfigPath);
  return mcpSessionToken ? { ...cfg, mcpSessionToken } : cfg;
}

function getCdHintSuffix(cwd, line) {
  const text = String(line || '');
  const match = text.match(/^\s*cd(?:\s+(.*))?$/);
  if (!match) return '';
  const rawArg = String(match[1] || '');
  if (rawArg.includes('&&') || rawArg.includes('||') || rawArg.includes(';')) return '';
  if (rawArg === '-' || rawArg.startsWith('-')) return '';

  const quote = rawArg.startsWith('"') ? '"' : (rawArg.startsWith("'") ? "'" : '');
  if (quote && rawArg.slice(1).includes(quote)) return '';
  const typed = quote ? rawArg.slice(1) : rawArg;
  const typedFs = typed.replace(/[\\/]/g, path.sep);
  const sepIdx = Math.max(typedFs.lastIndexOf('/'), typedFs.lastIndexOf('\\'));
  const parentPart = sepIdx >= 0 ? typedFs.slice(0, sepIdx + 1) : '';
  const namePrefix = sepIdx >= 0 ? typedFs.slice(sepIdx + 1) : typedFs;

  let baseDir = '';
  if (!typedFs) {
    baseDir = String(cwd || process.cwd() || '').trim() || process.cwd();
  } else if (path.isAbsolute(typedFs)) {
    if (parentPart) baseDir = parentPart;
    else baseDir = path.dirname(typedFs);
  } else {
    const root = String(cwd || process.cwd() || '').trim() || process.cwd();
    baseDir = path.resolve(root, parentPart || '.');
  }

  let entries = [];
  try {
    entries = fs.readdirSync(baseDir, { withFileTypes: true });
  } catch {
    return '';
  }
  const dirs = entries
    .filter((entry) => entry?.isDirectory?.())
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));
  if (dirs.length === 0) return '';

  const lowerPrefix = String(namePrefix || '').toLowerCase();
  const matches = dirs.filter((name) => name.toLowerCase().startsWith(lowerPrefix));
  if (matches.length === 0) return '';

  const best = matches[0];
  const bestLower = best.toLowerCase();
  if (matches.length === 1) {
    if (bestLower === lowerPrefix) {
      return typedFs.endsWith(path.sep) ? '' : path.sep;
    }
    return `${best.slice(namePrefix.length)}${path.sep}`;
  }
  if (bestLower === lowerPrefix) return '';
  return best.slice(namePrefix.length);
}

function resolveCdTarget(cwd, line) {
  const text = String(line || '');
  const match = text.match(/^\s*cd(?:\s+(.*))?$/);
  if (!match) return null;
  const rawArg = String(match[1] || '').trim();
  if (rawArg.includes('&&') || rawArg.includes('||') || rawArg.includes(';')) return null;
  if (rawArg === '-' || rawArg.startsWith('-')) return null;

  const root = String(cwd || process.cwd() || '').trim() || process.cwd();
  const home = String(process.env.HOME || process.env.USERPROFILE || root).trim() || root;
  if (!rawArg) return home;

  let arg = rawArg;
  if (
    (arg.startsWith('"') && arg.endsWith('"') && arg.length >= 2)
    || (arg.startsWith("'") && arg.endsWith("'") && arg.length >= 2)
  ) {
    arg = arg.slice(1, -1);
  }
  if (!arg) return root;
  if (arg === '~') arg = home;
  else if (arg.startsWith('~/') || arg.startsWith('~\\')) arg = path.join(home, arg.slice(2));

  // Convert git-bash/MSYS POSIX drive paths on Windows: /c/foo → C:\foo
  if (process.platform === 'win32') {
    const m = arg.match(/^\/([a-zA-Z])(\/.*|$)/);
    if (m) arg = m[1].toUpperCase() + ':' + (m[2] || '/').replace(/\//g, '\\');
  }

  const normalized = arg.replace(/[\\/]/g, path.sep);
  const target = path.isAbsolute(normalized)
    ? path.normalize(normalized)
    : path.resolve(root, normalized);
  try {
    if (!fs.statSync(target).isDirectory()) return null;
    return target;
  } catch {
    return null;
  }
}

async function createWindow() {
  const iconFile = process.platform === 'win32' ? 'icon.ico' : 'icon.png';
  const iconPath = path.join(__dirname, `../../assets/${iconFile}`);
  const icon = nativeImage.createFromPath(iconPath);

  win = winRef.win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#0d1117',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    autoHideMenuBar: process.platform !== 'darwin',
    icon,
    webPreferences: {
      preload: path.join(__dirname, '../../preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  win.maximize();

  if (!app.isPackaged) {
    for (let i = 0; i < 20; i++) {
      try {
        await win.loadURL('http://localhost:5173');
        break;
      } catch {
        await new Promise((r) => setTimeout(r, 500));
      }
    }
  } else {
    await win.loadFile(path.join(__dirname, '../../dist/renderer/index.html'));
  }

  win.on('closed', () => { win = null; winRef.win = null; });

  win.webContents.on('will-navigate', (event, url) => {
    const allowed = url.startsWith('http://localhost:5173') || url.startsWith('file://');
    if (!allowed) event.preventDefault();
  });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  win.on('unresponsive', () => {
    logAppEvent('window-unresponsive');
  });
  win.webContents.on('render-process-gone', (_event, details) => {
    logAppEvent('render-process-gone', JSON.stringify(details || {}));
  });
  win.webContents.on('child-process-gone', (_event, details) => {
    logAppEvent('child-process-gone', JSON.stringify(details || {}));
  });
  if (process.platform !== 'darwin') {
    win.setMenuBarVisibility(false);
  }
}

function send(channel, ...args) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, ...args);
}

function setupKeybindings() {
  if (!win || win.isDestroyed()) return;

  const isMac = process.platform === 'darwin';
  win.webContents.on('before-input-event', (event, input) => {
    const mod = isMac ? input.meta : input.control;
    const key = (input.key || '').toLowerCase();

    if (mod && input.shift && key === 'n') {
      event.preventDefault();
      send(IPC.NEXT_PANE);
      return;
    }
    if (mod && input.shift && !input.alt && key === 'p') {
      event.preventDefault();
      send(IPC.PREV_PANE);
      return;
    }
    if (mod && input.alt && !input.shift && key === 'p') {
      event.preventDefault();
      send(IPC.TOGGLE_PALETTE);
      return;
    }
    if (mod && input.shift && key === 'enter') {
      event.preventDefault();
      send(IPC.LAUNCH_CODEX);
      return;
    }
    if (mod && key === 'enter') {
      event.preventDefault();
      send(IPC.LAUNCH_CLAUDE);
      return;
    }
    if (mod && input.shift && key === 'k') {
      event.preventDefault();
      send(IPC.CLEAR_TERMINAL);
      return;
    }
    if (mod && input.alt && input.shift && key === 'r') {
      event.preventDefault();
      send(IPC.RESTART_CODEX);
      return;
    }
    if (mod && input.alt && key === 'r') {
      event.preventDefault();
      send(IPC.RESTART_CLAUDE);
      return;
    }
    if (mod && input.shift && key === 'd') {
      event.preventDefault();
      send(IPC.SPLIT_V);
      return;
    }
    if (mod && input.shift && key === 'e') {
      event.preventDefault();
      send(IPC.SPLIT_H);
      return;
    }
    if (mod && input.shift && key === 'w') {
      event.preventDefault();
      send(IPC.COLLAPSE_ALL);
      return;
    }
    if (mod && !input.shift && !input.alt && key === 'w') {
      event.preventDefault();
      send(IPC.CLOSE_PANE);
      return;
    }
    if (mod && !input.shift && !input.alt && key === '1') {
      event.preventDefault();
      send(IPC.FOCUS_TERMINAL, 0);
      return;
    }
    if (mod && !input.shift && !input.alt && key === '2') {
      event.preventDefault();
      send(IPC.FOCUS_TERMINAL, 1);
      return;
    }
    if (mod && input.alt && key === 'b') {
      event.preventDefault();
      send(IPC.TOGGLE_MONITOR);
      return;
    }
    if (mod && input.alt && key === 's') {
      event.preventDefault();
      const state = mcpServer?.getSharedState() || {};
      clipboard.writeText(JSON.stringify(state, null, 2));
      send(IPC.COPY_STATE);
      return;
    }
    if (input.key === 'F1' || (mod && (key === '/' || input.code === 'Slash'))) {
      event.preventDefault();
      send(IPC.SHOW_HELP);
      return;
    }
    if (mod && !input.shift && !input.alt && (key === ',' || input.code === 'Comma')) {
      event.preventDefault();
      send(IPC.OPEN_CONFIG);
      return;
    }
    if (mod && input.alt && key === 't') {
      event.preventDefault();
      send(IPC.TOGGLE_MANAGER);
      return;
    }
    if (mod && input.alt && key === 'y') {
      event.preventDefault();
      send(IPC.TOGGLE_SESSIONS);
      return;
    }
    if (mod && input.alt && key === 'm') {
      event.preventDefault();
      send(IPC.TOGGLE_MEMORY_MAP);
      return;
    }
    if (mod && input.alt && key === 'g') {
      event.preventDefault();
      send(IPC.TOGGLE_DEP_GRAPH);
      return;
    }
    if (mod && input.alt && key === 'j') {
      event.preventDefault();
      send(IPC.TOGGLE_AGENT_TREE);
      return;
    }
    if (mod && !input.shift && !input.alt && key === 't') {
      event.preventDefault();
      send(IPC.NEW_TAB);
      return;
    }
    if (mod && input.shift && key === 'i') {
      event.preventDefault();
      send(IPC.OPEN_INLINE_EDITOR);
      return;
    }
    if (mod && input.shift && key === 'f') {
      event.preventDefault();
      send(IPC.TOGGLE_SEMANTIC_SEARCH);
    }
  });
}

function setupIPC() {
  // PTY
  ipcMain.handle(IPC.PTY_CREATE, (_e, id, options) => {
    const config = store.store;
    return ptyManager.create(id, {
      shell: options?.shell || config.shell,
      cwd: options?.cwd || config.cwd,
      cols: options?.cols || 80,
      rows: options?.rows || 24,
      env: { HERMES_TERMINAL_ID: id },
    });
  });

  ipcMain.on(IPC.PTY_INPUT, (_e, id, data) => ptyManager.input(id, data));
  ipcMain.on(IPC.PTY_RESIZE, (_e, id, cols, rows) => ptyManager.resize(id, cols, rows));
  ipcMain.on(IPC.PTY_KILL, (_e, id) => ptyManager.kill(id));
  ipcMain.handle(IPC.PTY_CD_HINT, (_e, cwd, line) => getCdHintSuffix(cwd, line));
  ipcMain.handle(IPC.PTY_RESOLVE_CD, (_e, cwd, line) => resolveCdTarget(cwd, line));
  ipcMain.handle(IPC.PTY_GET_CWD, (_e, id) => ptyManager.getCwd(id));
  ipcMain.handle(IPC.CLIPBOARD_READ_TEXT, () => clipboard.readText());
  ipcMain.handle(IPC.CLIPBOARD_WRITE_TEXT, (_e, text) => {
    clipboard.writeText(String(text ?? ''));
    return { ok: true };
  });

  // Config
  ipcMain.handle(IPC.CONFIG_GET, () => readNormalizedConfig());
  const CONFIG_KEYS = new Set([...Object.keys(DEFAULTS), 'sessionRefs']);
  ipcMain.handle(IPC.CONFIG_SET, (_e, key, value) => {
    if (!CONFIG_KEYS.has(key)) return readNormalizedConfig();
    store.set(key, value);
    return readNormalizedConfig();
  });
  ipcMain.handle(IPC.WORKSPACE_GET, () => store.get('workspaceSnapshot', null));
  ipcMain.handle(IPC.WORKSPACE_SET, (_e, snapshot) => {
    store.set('workspaceSnapshot', snapshot || null);
    return { ok: true };
  });
  ipcMain.handle(IPC.WORKSPACE_CLEAR, () => {
    store.delete('workspaceSnapshot');
    return { ok: true };
  });

  require('./ipc-sessions').setup({ store, detectTool });

  // MCP controls
  ipcMain.on(IPC.MCP_CLEAR_MESSAGES, () => mcpServer?.clearMessages());
  ipcMain.on(IPC.MCP_RESET_STATE, () => mcpServer?.resetState());
  ipcMain.handle(IPC.MCP_GET_STATE, () => mcpServer?.getSharedState() || {});
  ipcMain.handle(IPC.MCP_REGISTER_AGENT, (_e, payload) => {
    const tool = String(payload?.tool || 'agent').trim().toLowerCase() || 'agent';
    const terminalId = String(payload?.terminalId || '').trim() || 'terminal';
    const cwd = String(payload?.cwd || '').trim();
    const labelSuffix = cwd ? ` @ ${path.basename(cwd) || cwd}` : '';
    const agentId = `${tool}-${terminalId}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const label = `${tool.toUpperCase()} ${terminalId}${labelSuffix}`;
    try {
      mcpServer?.registerAgent?.(agentId, label);
      mcpServer?.mapTerminal?.(terminalId, agentId);
      return { ok: true, agentId, label };
    } catch (err) {
      return { ok: false, error: err?.message || 'Failed to register agent' };
    }
  });

  require('./ipc-voice').setup({ app });
  require('./ipc-memory').setup(memoryDeps);
  require('./ipc-git').setup();
  require('./ipc-files').setup({ store, winRef, readNormalizedConfig });

  ipcMain.handle(IPC.USAGE_GET, () => usageWatcher ? usageWatcher.current() : { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 });
}

function setupPtyEvents() {
  ptyManager.on('output', (id, data) => {
    send(IPC.PTY_OUTPUT, id, data);
    smartStderr.handleOutput(id, data, ptyManager.getCwd(id));
  });
  ptyManager.on('exit', (id, code) => {
    smartStderr.clearTerminal(id);
    send(IPC.PTY_EXIT, id, code);
  });
  ptyManager.on('cwd', (id, cwd) => send(IPC.PTY_CWD, id, cwd));
}

function setupMcpEvents() {
  if (!mcpServer) return;
  mcpServer.on('signal', ({ agent_id, message }) => {
    const terminalId = mcpServer.getTerminalForAgent(agent_id);
    if (terminalId) ptyManager.writeSignal(terminalId, message);
  });
  mcpServer.on('event', (payload) => {
    if (!payload || !memoryIndex) return;
    const { type, data } = payload;
    if (type === 'tool_call') {
      const op = String(data?.op || '').toLowerCase();
      if (data?.file_path && (op === 'write' || op === 'edit' || op === 'delete' || op === 'read')) {
        memoryIndex.markTouched(data.file_path, data.timestamp || Date.now());
      }
    }
    if (type === 'message' && data?.content) {
      memoryIndex.ingestMcpEvent('message', data.sender || '', data.channel || '', data.content, data.timestamp);
    }
    if (type === 'artifact' && data?.content) {
      memoryIndex.ingestMcpEvent('artifact', data.agent_id || '', '', `${data.filename || ''}: ${data.content}`, data.timestamp);
    }
    if (type === 'agent_activity' && data?.message) {
      memoryIndex.ingestMcpEvent('agent_activity', data.agent_id || '', '', data.message, data.timestamp);
    }
  });
}

function buildMenu() {
  const template = [
    {
      label: 'Hermes',
      submenu: [
        { label: 'Settings', accelerator: 'CmdOrCtrl+,', click: () => send(IPC.OPEN_CONFIG) },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { label: 'Toggle MCP Monitor', accelerator: 'CmdOrCtrl+Alt+B', click: () => send(IPC.TOGGLE_MONITOR) },
        { type: 'separator' },
        { label: 'Focus Pane 1', accelerator: 'CmdOrCtrl+1', click: () => send(IPC.FOCUS_TERMINAL, 0) },
        { label: 'Focus Pane 2', accelerator: 'CmdOrCtrl+2', click: () => send(IPC.FOCUS_TERMINAL, 1) },
        { type: 'separator' },
        { label: 'Split Vertical', accelerator: 'CmdOrCtrl+Shift+D', click: () => send(IPC.SPLIT_V) },
        { label: 'Split Horizontal', accelerator: 'CmdOrCtrl+Shift+E', click: () => send(IPC.SPLIT_H) },
        { label: 'Close Pane', accelerator: 'CmdOrCtrl+W', click: () => send(IPC.CLOSE_PANE) },
        { type: 'separator' },
        { label: 'Next Pane', accelerator: 'CmdOrCtrl+Shift+N', click: () => send(IPC.NEXT_PANE) },
        { label: 'Previous Pane', accelerator: 'CmdOrCtrl+Shift+P', click: () => send(IPC.PREV_PANE) },
        { type: 'separator' },
        { label: 'Command Palette', accelerator: 'CmdOrCtrl+Alt+P', click: () => send(IPC.TOGGLE_PALETTE) },
        { type: 'separator' },
        { label: 'Close All Side Panels', accelerator: 'CmdOrCtrl+Shift+W', click: () => send(IPC.COLLAPSE_ALL) },
        { type: 'separator' },
        { label: 'New Tab', accelerator: 'CmdOrCtrl+T', click: () => send(IPC.NEW_TAB) },
        { type: 'separator' },
        { label: 'Toggle Terminal Manager', accelerator: 'CmdOrCtrl+Alt+T', click: () => send(IPC.TOGGLE_MANAGER) },
        { label: 'Toggle Session Manager', accelerator: 'CmdOrCtrl+Alt+Y', click: () => send(IPC.TOGGLE_SESSIONS) },
        { label: 'Toggle Memory Map', accelerator: 'CmdOrCtrl+Alt+M', click: () => send(IPC.TOGGLE_MEMORY_MAP) },
        { label: 'Toggle Semantic Search', accelerator: 'CmdOrCtrl+Shift+F', click: () => send(IPC.TOGGLE_SEMANTIC_SEARCH) },
        { label: 'Toggle Live Dependency Graph', accelerator: 'CmdOrCtrl+Alt+G', click: () => send(IPC.TOGGLE_DEP_GRAPH) },
        { label: 'Toggle Sub-Agent Tree', accelerator: 'CmdOrCtrl+Alt+J', click: () => send(IPC.TOGGLE_AGENT_TREE) },
      ],
    },
    {
      label: 'Terminal',
      submenu: [
        { label: 'Launch Claude Code', accelerator: 'CmdOrCtrl+Return', click: () => send(IPC.LAUNCH_CLAUDE) },
        { label: 'Launch OpenAI Codex', accelerator: 'CmdOrCtrl+Shift+Return', click: () => send(IPC.LAUNCH_CODEX) },
        { label: 'Open Inline Editor', accelerator: 'CmdOrCtrl+Shift+I', click: () => send(IPC.OPEN_INLINE_EDITOR) },
        { label: 'Clear Terminal', accelerator: 'CmdOrCtrl+Shift+K', click: () => send(IPC.CLEAR_TERMINAL) },
        { label: 'Restart Claude Code', accelerator: 'CmdOrCtrl+Alt+R', click: () => send(IPC.RESTART_CLAUDE) },
        { label: 'Restart OpenAI Codex', accelerator: 'CmdOrCtrl+Alt+Shift+R', click: () => send(IPC.RESTART_CODEX) },
      ],
    },
    {
      label: 'MCP',
      submenu: [
        {
          label: 'Copy Shared State',
          accelerator: 'CmdOrCtrl+Alt+S',
          click: () => {
            const state = mcpServer?.getSharedState() || {};
            clipboard.writeText(JSON.stringify(state, null, 2));
            send(IPC.COPY_STATE);
          },
        },
      ],
    },
    {
      label: 'Help',
      submenu: [
        { label: 'Keyboard Shortcuts', accelerator: 'F1', click: () => send(IPC.SHOW_HELP) },
        { type: 'separator' },
        { label: 'Open Dev Tools', click: () => win?.webContents.openDevTools({ mode: 'detach' }) },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function setupApplicationMenu() {
  if (process.platform === 'darwin') {
    buildMenu();
  } else {
    Menu.setApplicationMenu(null);
  }
}

app.whenReady().then(async () => {
  if (process.platform === 'win32') {
    app.setAppUserModelId('com.hermes.app');
  }
  appLogPath = path.join(app.getPath('userData'), 'hermes.log');
  logAppEvent('app-start', `pid=${process.pid}`);

  const configPort = Number.parseInt(String(store.get('mcpPort', MCP_PORT)), 10);
  const safeConfigPort = Number.isInteger(configPort) && configPort > 0 && configPort <= 65535
    ? configPort
    : MCP_PORT;
  const port = OVERRIDE_MCP_PORT || safeConfigPort;
  memoryIndex = new MemoryIndexService({ app, store });
  memoryDeps.memoryIndex = memoryIndex;
  const sessionId = `session-${Date.now()}`;
  const artifactsPath = path.join(app.getPath('userData'), `artifacts-${sessionId}.json`);
  try {
    const userData = app.getPath('userData');
    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    for (const name of fs.readdirSync(userData)) {
      if (!name.startsWith('artifacts-session-') || !name.endsWith('.json')) continue;
      const full = path.join(userData, name);
      try {
        const stat = fs.statSync(full);
        if (stat.mtimeMs < sevenDaysAgo) fs.unlinkSync(full);
      } catch { /* ignore */ }
    }
  } catch { /* ignore */ }
  mcpServer = createMcpServer(port, { memoryIndex, artifactsPath });
  mcpSessionToken = mcpServer.sessionToken;

  // Write MCP config file so agents can connect automatically
  mcpConfigPath = path.join(app.getPath('userData'), 'hermes-mcp.json');
  try {
    fs.writeFileSync(mcpConfigPath, JSON.stringify({
      mcpServers: {
        hermes: {
          type: 'http',
          url: `http://localhost:${port}`,
          headers: { 'x-hermes-token': mcpSessionToken },
        },
      },
    }, null, 2));
  } catch (err) {
    console.error('[hermes] Failed to write MCP config:', err);
    mcpConfigPath = null;
  }

  setupIPC();
  setupPtyEvents();
  setupMcpEvents();
  new PtyParser().attach(ptyManager, mcpServer);
  setupApplicationMenu();

  await createWindow();
  setupKeybindings();

  usageWatcher = new UsageWatcher(
    (usage) => send(IPC.USAGE_UPDATE, usage),
    () => store.get('usagePollingEnabled', false),
  );
  usageWatcher.start();

  memoryIndex.init().catch((err) => {
    console.error('[memory] init failed:', err?.message || err);
  });
});

app.on('window-all-closed', () => {
  ptyManager.killAll();
  smartStderr.clearAll();
  mcpServer?.close();
  usageWatcher?.stop();
  memoryIndex?.destroy();
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (!win) createWindow();
});

app.on('before-quit', () => {
  logAppEvent('before-quit');
  ptyManager.killAll();
  smartStderr.clearAll();
  mcpServer?.close();
  usageWatcher?.stop();
  memoryIndex?.destroy();
});

process.on('uncaughtException', (err) => {
  logAppEvent('uncaught-exception', err?.stack || err?.message || String(err));
});

process.on('unhandledRejection', (reason) => {
  const text = reason && typeof reason === 'object' && reason.stack ? reason.stack : String(reason);
  logAppEvent('unhandled-rejection', text);
});
