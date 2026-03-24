const { contextBridge, ipcRenderer } = require('electron');
const { IPC } = require('./src/shared/constants');

contextBridge.exposeInMainWorld('electron', {
  IPC,
  pty: {
    create: (id, options) => ipcRenderer.invoke(IPC.PTY_CREATE, id, options),
    input: (id, data) => ipcRenderer.send(IPC.PTY_INPUT, id, data),
    resize: (id, cols, rows) => ipcRenderer.send(IPC.PTY_RESIZE, id, cols, rows),
    kill: (id) => ipcRenderer.send(IPC.PTY_KILL, id),
    getCdHint: (cwd, line) => ipcRenderer.invoke(IPC.PTY_CD_HINT, cwd, line),
    resolveCd: (cwd, line) => ipcRenderer.invoke(IPC.PTY_RESOLVE_CD, cwd, line),
    getCwd: (id) => ipcRenderer.invoke(IPC.PTY_GET_CWD, id),
    onOutput: (callback) => {
      const handler = (_e, id, data) => callback(id, data);
      ipcRenderer.on(IPC.PTY_OUTPUT, handler);
      return () => ipcRenderer.removeListener(IPC.PTY_OUTPUT, handler);
    },
    onSmartStderr: (callback) => {
      const handler = (_e, entry) => callback(entry);
      ipcRenderer.on(IPC.PTY_SMART_STDERR, handler);
      return () => ipcRenderer.removeListener(IPC.PTY_SMART_STDERR, handler);
    },
    onExit: (callback) => {
      const handler = (_e, id, code) => callback(id, code);
      ipcRenderer.on(IPC.PTY_EXIT, handler);
      return () => ipcRenderer.removeListener(IPC.PTY_EXIT, handler);
    },
    onCwd: (callback) => {
      const handler = (_e, id, cwd) => callback(id, cwd);
      ipcRenderer.on(IPC.PTY_CWD, handler);
      return () => ipcRenderer.removeListener(IPC.PTY_CWD, handler);
    },
  },

  config: {
    get: () => ipcRenderer.invoke(IPC.CONFIG_GET),
    set: (key, value) => ipcRenderer.invoke(IPC.CONFIG_SET, key, value),
  },

  clipboard: {
    readText: () => ipcRenderer.invoke(IPC.CLIPBOARD_READ_TEXT),
    writeText: (text) => ipcRenderer.invoke(IPC.CLIPBOARD_WRITE_TEXT, text),
  },

  workspace: {
    get: () => ipcRenderer.invoke(IPC.WORKSPACE_GET),
    set: (snapshot) => ipcRenderer.invoke(IPC.WORKSPACE_SET, snapshot),
    clear: () => ipcRenderer.invoke(IPC.WORKSPACE_CLEAR),
  },

  mcp: {
    clearMessages: () => ipcRenderer.send(IPC.MCP_CLEAR_MESSAGES),
    resetState: () => ipcRenderer.send(IPC.MCP_RESET_STATE),
    getState: () => ipcRenderer.invoke(IPC.MCP_GET_STATE),
    registerAgent: (payload) => ipcRenderer.invoke(IPC.MCP_REGISTER_AGENT, payload),
  },

  sessions: {
    list: () => ipcRenderer.invoke(IPC.SESSION_LIST),
    upsert: (session) => ipcRenderer.invoke(IPC.SESSION_UPSERT, session),
    remove: (id) => ipcRenderer.invoke(IPC.SESSION_REMOVE, id),
    pin: (id, pinned) => ipcRenderer.invoke(IPC.SESSION_PIN, id, pinned),
    touch: (id) => ipcRenderer.invoke(IPC.SESSION_TOUCH, id),
    rename: (id, label) => ipcRenderer.invoke(IPC.SESSION_RENAME, id, label),
    toggleMcp: (id) => ipcRenderer.invoke(IPC.SESSION_TOGGLE_MCP, id),
  },

  artifacts: {
    saveAs: (artifact) => ipcRenderer.invoke(IPC.ARTIFACT_SAVE_AS, artifact),
    copy: (content) => ipcRenderer.invoke(IPC.ARTIFACT_COPY, content),
  },

  backup: {
    export: (payload) => ipcRenderer.invoke(IPC.BACKUP_EXPORT, payload),
    importPick: () => ipcRenderer.invoke(IPC.BACKUP_IMPORT_PICK),
    importApplyConfig: (config) => ipcRenderer.invoke(IPC.BACKUP_IMPORT_APPLY_CONFIG, config),
  },

  promptDrafts: {
    writeFile: (payload) => ipcRenderer.invoke(IPC.PROMPT_DRAFT_WRITE_FILE, payload),
    deleteFile: (payload) => ipcRenderer.invoke(IPC.PROMPT_DRAFT_DELETE_FILE, payload),
    readFolder: (payload) => ipcRenderer.invoke(IPC.PROMPT_DRAFT_READ_FOLDER, payload),
  },

  todo: {
    writeFile: (payload) => ipcRenderer.invoke(IPC.TODO_WRITE_FILE, payload),
    deleteFile: (payload) => ipcRenderer.invoke(IPC.TODO_DELETE_FILE, payload),
    readFolder: (payload) => ipcRenderer.invoke(IPC.TODO_READ_FOLDER, payload),
  },

  memory: {
    getSnapshot: () => ipcRenderer.invoke(IPC.MEMORY_GET_SNAPSHOT),
    rescan: () => ipcRenderer.invoke(IPC.MEMORY_RESCAN),
    setProjectPath: (projectPath) => ipcRenderer.invoke(IPC.MEMORY_SET_PROJECT_PATH, projectPath),
    getFileDetails: (filePath) => ipcRenderer.invoke(IPC.MEMORY_GET_FILE_DETAILS, filePath),
    semanticSearch: (query, limit, scope) => ipcRenderer.invoke(IPC.MEMORY_SEMANTIC_SEARCH, query, limit, scope),
    getGraphEdges: () => ipcRenderer.invoke(IPC.MEMORY_GET_GRAPH_EDGES),
    getPathScanInfo: (projectPath) => ipcRenderer.invoke(IPC.MEMORY_GET_PATH_SCAN_INFO, projectPath),
  },

  files: {
    readText: (filePath) => ipcRenderer.invoke(IPC.FILE_READ_TEXT, filePath),
    writeText: (filePath, content) => ipcRenderer.invoke(IPC.FILE_WRITE_TEXT, filePath, content),
  },

  voice: {
    transcribe: (buffer) => ipcRenderer.invoke(IPC.VOICE_TRANSCRIBE, buffer),
  },

  agentMemory: {
    scan: (cwd) => ipcRenderer.invoke(IPC.AGENT_MEMORY_SCAN, cwd),
    save: (fullPath, content) => ipcRenderer.invoke(IPC.AGENT_MEMORY_SAVE, fullPath, content),
    onChange: (callback) => {
      const handler = (_e, cwd) => callback(cwd);
      ipcRenderer.on(IPC.AGENT_MEMORY_CHANGED, handler);
      return () => ipcRenderer.removeListener(IPC.AGENT_MEMORY_CHANGED, handler);
    },
  },

  explorer: {
    listDir: (dirPath) => ipcRenderer.invoke(IPC.EXPLORER_LIST_DIR, dirPath),
    readFile: (filePath) => ipcRenderer.invoke(IPC.EXPLORER_READ_FILE, filePath),
  },

  git: {
    status: (cwd) => ipcRenderer.invoke(IPC.GIT_STATUS, cwd),
    diff: (cwd, file, staged) => ipcRenderer.invoke(IPC.GIT_DIFF, cwd, file, staged),
    stage: (cwd, file) => ipcRenderer.invoke(IPC.GIT_STAGE, cwd, file),
    unstage: (cwd, file) => ipcRenderer.invoke(IPC.GIT_UNSTAGE, cwd, file),
    commit: (cwd, message) => ipcRenderer.invoke(IPC.GIT_COMMIT, cwd, message),
    discard: (cwd, file) => ipcRenderer.invoke(IPC.GIT_DISCARD, cwd, file),
    log: (cwd, filePath, limit) => ipcRenderer.invoke(IPC.GIT_LOG, cwd, filePath, limit),
    show: (cwd, hash) => ipcRenderer.invoke(IPC.GIT_SHOW, cwd, hash),
    push: (cwd) => ipcRenderer.invoke(IPC.GIT_PUSH, cwd),
  },

  context: {
    listSessions: () => ipcRenderer.invoke(IPC.CONTEXT_LIST_SESSIONS),
    loadSession: (filePath) => ipcRenderer.invoke(IPC.CONTEXT_LOAD_SESSION, filePath),
  },

  usage: {
    get: () => ipcRenderer.invoke(IPC.USAGE_GET),
    onUpdate: (callback) => {
      const handler = (_e, data) => callback(data);
      ipcRenderer.on(IPC.USAGE_UPDATE, handler);
      return () => ipcRenderer.removeListener(IPC.USAGE_UPDATE, handler);
    },
  },

  onAction: (callback) => {
    const actions = [
      IPC.FOCUS_TERMINAL,
      IPC.LAUNCH_CLAUDE,
      IPC.LAUNCH_CODEX,
      IPC.CLEAR_TERMINAL,
      IPC.RESTART_CLAUDE,
      IPC.RESTART_CODEX,
      IPC.TOGGLE_MONITOR,
      IPC.OPEN_CONFIG,
      IPC.COPY_STATE,
      IPC.SPLIT_V,
      IPC.SPLIT_H,
      IPC.CLOSE_PANE,
      IPC.NEXT_PANE,
      IPC.PREV_PANE,
      IPC.COLLAPSE_ALL,
      IPC.SHOW_HELP,
      IPC.TOGGLE_MANAGER,
      IPC.NEW_TAB,
      IPC.TOGGLE_SESSIONS,
      IPC.OPEN_INLINE_EDITOR,
      IPC.TOGGLE_MEMORY_MAP,
      IPC.TOGGLE_SEMANTIC_SEARCH,
      IPC.TOGGLE_DEP_GRAPH,
      IPC.TOGGLE_AGENT_TREE,
      IPC.VOICE_START,
      IPC.VOICE_STOP,
      IPC.TOGGLE_PALETTE,
    ];
    const handlers = actions.map((channel) => {
      const handler = (_e, ...args) => callback(channel, ...args);
      ipcRenderer.on(channel, handler);
      return { channel, handler };
    });
    return () => handlers.forEach(({ channel, handler }) =>
      ipcRenderer.removeListener(channel, handler)
    );
  },
});
