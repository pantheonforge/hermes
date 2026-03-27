const IPC = {
  // PTY
  PTY_CREATE: 'pty:create',
  PTY_INPUT: 'pty:input',
  PTY_OUTPUT: 'pty:output',
  PTY_SMART_STDERR: 'pty:smart-stderr',
  PTY_RESIZE: 'pty:resize',
  PTY_KILL: 'pty:kill',
  PTY_EXIT: 'pty:exit',
  PTY_CWD: 'pty:cwd',
  PTY_CD_HINT: 'pty:cd-hint',
  PTY_RESOLVE_CD: 'pty:resolve-cd',
  PTY_GET_CWD: 'pty:get-cwd',
  CLIPBOARD_READ_TEXT: 'clipboard:read-text',
  CLIPBOARD_WRITE_TEXT: 'clipboard:write-text',

  // Config
  CONFIG_GET: 'config:get',
  CONFIG_SET: 'config:set',
  WORKSPACE_GET: 'workspace:get',
  WORKSPACE_SET: 'workspace:set',
  WORKSPACE_CLEAR: 'workspace:clear',

  // App actions (main → renderer)
  FOCUS_TERMINAL: 'app:focus-terminal',
  LAUNCH_CLAUDE: 'app:launch-claude',
  LAUNCH_CODEX: 'app:launch-codex',
  CLEAR_TERMINAL: 'app:clear-terminal',
  RESTART_CLAUDE: 'app:restart-claude',
  RESTART_CODEX: 'app:restart-codex',
  TOGGLE_MONITOR: 'app:toggle-monitor',
  OPEN_CONFIG: 'app:open-config',
  COPY_STATE: 'app:copy-state',
  SPLIT_V: 'app:split-v',
  SPLIT_H: 'app:split-h',
  CLOSE_PANE: 'app:close-pane',
  NEXT_PANE: 'app:next-pane',
  PREV_PANE: 'app:prev-pane',
  SHOW_HELP: 'app:show-help',
  TOGGLE_MANAGER: 'app:toggle-manager',
  NEW_TAB: 'app:new-tab',
  TOGGLE_SESSIONS: 'app:toggle-sessions',
  OPEN_INLINE_EDITOR: 'app:open-inline-editor',
  TOGGLE_MEMORY_MAP: 'app:toggle-memory-map',
  TOGGLE_SEMANTIC_SEARCH: 'app:toggle-semantic-search',
  TOGGLE_DEP_GRAPH: 'app:toggle-dep-graph',
  TOGGLE_AGENT_TREE: 'app:toggle-agent-tree',
  COLLAPSE_ALL: 'app:collapse-all',

  // MCP controls (renderer → main)
  MCP_CLEAR_MESSAGES: 'mcp:clear-messages',
  MCP_RESET_STATE: 'mcp:reset-state',
  MCP_GET_STATE: 'mcp:get-state',
  MCP_REGISTER_AGENT: 'mcp:register-agent',

  // Session references (renderer → main)
  SESSION_LIST: 'session:list',
  SESSION_UPSERT: 'session:upsert',
  SESSION_REMOVE: 'session:remove',
  SESSION_PIN: 'session:pin',
  SESSION_TOUCH: 'session:touch',
  SESSION_RENAME: 'session:rename',
  SESSION_TOGGLE_MCP: 'session:toggle-mcp',

  // Artifact actions (renderer → main)
  ARTIFACT_SAVE_AS: 'artifact:save-as',
  ARTIFACT_COPY: 'artifact:copy',

  // Backup import/export (renderer -> main)
  BACKUP_EXPORT: 'backup:export',
  BACKUP_IMPORT_PICK: 'backup:import-pick',
  BACKUP_IMPORT_APPLY_CONFIG: 'backup:import-apply-config',

  // Prompt draft filesystem sync
  PROMPT_DRAFT_WRITE_FILE: 'prompt-draft:write-file',
  PROMPT_DRAFT_DELETE_FILE: 'prompt-draft:delete-file',
  PROMPT_DRAFT_READ_FOLDER: 'prompt-draft:read-folder',

  // Todo filesystem sync
  TODO_WRITE_FILE: 'todo:write-file',
  TODO_DELETE_FILE: 'todo:delete-file',
  TODO_READ_FOLDER: 'todo:read-folder',

  // Voice input
  VOICE_START: 'voice:start',
  VOICE_STOP: 'voice:stop',
  VOICE_TRANSCRIBE: 'voice:transcribe',

  // Memory index (renderer -> main)
  MEMORY_GET_SNAPSHOT: 'memory:get-snapshot',
  MEMORY_RESCAN: 'memory:rescan',
  MEMORY_SET_PROJECT_PATH: 'memory:set-project-path',
  MEMORY_GET_FILE_DETAILS: 'memory:get-file-details',
  MEMORY_SEMANTIC_SEARCH: 'memory:semantic-search',
  MEMORY_GET_GRAPH_EDGES: 'memory:get-graph-edges',
  MEMORY_GET_PATH_SCAN_INFO: 'memory:get-path-scan-info',

  // File editor access (renderer -> main)
  FILE_READ_TEXT: 'file:read-text',
  FILE_WRITE_TEXT: 'file:write-text',

  // Agent memory panel (renderer <-> main)
  AGENT_MEMORY_SCAN: 'agent-memory:scan',
  AGENT_MEMORY_SAVE: 'agent-memory:save',
  AGENT_MEMORY_CHANGED: 'agent-memory:changed',

  // File explorer (renderer -> main)
  EXPLORER_LIST_DIR: 'explorer:list-dir',
  EXPLORER_READ_FILE: 'explorer:read-file',

  // Git workflow (renderer -> main)
  GIT_STATUS: 'git:status',
  GIT_DIFF: 'git:diff',
  GIT_STAGE: 'git:stage',
  GIT_UNSTAGE: 'git:unstage',
  GIT_COMMIT: 'git:commit',
  GIT_DISCARD: 'git:discard',
  GIT_LOG: 'git:log',
  GIT_SHOW: 'git:show',
  GIT_PUSH: 'git:push',
  GIT_BRANCH: 'git:branch',
  GIT_GITIGNORE: 'git:gitignore',
  SHELL_SHOW_IN_FOLDER: 'shell:show-in-folder',

  TOGGLE_PALETTE: 'app:toggle-palette',

  // Context Surgeon (renderer -> main)
  CONTEXT_LIST_SESSIONS: 'context:list-sessions',
  CONTEXT_LOAD_SESSION: 'context:load-session',

  // Usage watcher (main -> renderer / renderer -> main)
  USAGE_UPDATE: 'usage:update',
  USAGE_GET: 'usage:get',
};

const DEFAULTS = {
  shell: process.platform === 'win32' ? 'powershell.exe' : (process.env.SHELL || '/bin/bash'),
  claudeCmd: 'claude',
  codexCmd: 'codex',
  cwd: process.env.HOME || process.env.USERPROFILE || '/',
  mcpPort: 2337,
  fontSize: 13,
  fontFamily: "'Cascadia Code', 'JetBrains Mono', 'Fira Code', monospace",
  theme: 'dark',
  agentLabels: ['Agent 1', 'Agent 2', 'Agent 3', 'Agent 4'],
  layouts: [
    {
      id: 'layout-default',
      name: 'Default',
      terminals: [{ cwd: '', startupCommand: '' }],
    },
  ],
  defaultLayoutId: 'layout-default',
  lastUsedLayoutId: 'layout-default',
  startupLayout: [{ cwd: '' }],
  memoryProjectPath: '',
  promptDraftsFolder: '',
  memoryAutoScan: false,
  memoryIgnoreGlobs: ['.git', 'node_modules', 'dist', 'build', '.next', '.cache'],
  workspaceSnapshot: null,
  usagePollingEnabled: false,
  claudeAutoMode: false,
};

const MCP_PORT = 2337;

function detectTool(command) {
  const cmd = String(command || '').toLowerCase();
  if (cmd.includes('codex')) return 'codex';
  if (cmd.includes('claude')) return 'claude';
  return 'other';
}

module.exports = { IPC, DEFAULTS, MCP_PORT, detectTool };
