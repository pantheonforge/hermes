import { collectLeafIds } from './TerminalGrid';

export function detectTool(command) {
  const cmd = String(command || '').toLowerCase();
  if (cmd.includes('codex')) return 'codex';
  if (cmd.includes('claude')) return 'claude';
  return 'other';
}

export function createSessionLabel(tool, cwd) {
  const folder = String(cwd || '').split(/[\\/]/).filter(Boolean).pop() || 'workspace';
  const title = tool === 'claude' ? 'Claude' : tool === 'codex' ? 'Codex' : 'Tool';
  return `${title} @ ${folder}`;
}

export function buildToolCommand(config, tool) {
  const base = tool === 'codex' ? (config?.codexCmd || 'codex') : (config?.claudeCmd || 'claude');
  if (tool === 'codex') {
    const port = Number(config?.mcpPort || 0);
    const mcpFlag = port > 0
      ? ` -c 'mcp_servers.hermes.url="http://localhost:${port}"' -c 'mcp_servers.hermes.transport="streamable_http"' -c 'mcp_servers.hermes.enabled=true'`
      : '';
    return `${base}${mcpFlag}`;
  }
  const mcpFlag = config?.mcpConfigPath ? ` --mcp-config "${config.mcpConfigPath}"` : '';
  return `${base}${mcpFlag}`;
}

export function updateLeafCwd(node, targetId, cwd) {
  if (node.type === 'leaf') {
    if (node.id !== targetId) return node;
    if (node.cwd === cwd) return node;
    return { ...node, cwd };
  }
  const nextA = updateLeafCwd(node.a, targetId, cwd);
  const nextB = updateLeafCwd(node.b, targetId, cwd);
  if (nextA === node.a && nextB === node.b) return node;
  return {
    ...node,
    a: nextA,
    b: nextB,
  };
}

export function normalizeFilePathForProject(filePath, projectPath) {
  const raw = String(filePath || '').replace(/\\/g, '/');
  const root = String(projectPath || '').replace(/\\/g, '/').replace(/\/+$/, '');
  if (!raw) return '';
  if (!root) return raw;
  const lowerRaw = raw.toLowerCase();
  const lowerRoot = root.toLowerCase();
  if (lowerRaw === lowerRoot) return '.';
  if (lowerRaw.startsWith(`${lowerRoot}/`)) return raw.slice(root.length + 1);
  return raw;
}

export function sanitizeLayout(layout) {
  const terminals = (Array.isArray(layout?.terminals) ? layout.terminals : [])
    .slice(0, 4)
    .map((terminal) => ({
      cwd: String(terminal?.cwd || '').trim(),
      startupCommand: String(terminal?.startupCommand || '').trim(),
    }));
  const safeTerminals = terminals.length > 0 ? terminals : [{ cwd: '', startupCommand: '' }];
  return {
    id: String(layout?.id || ''),
    name: String(layout?.name || 'Layout').trim() || 'Layout',
    terminals: safeTerminals,
  };
}

export function sanitizeLayouts(layouts) {
  const safe = (Array.isArray(layouts) ? layouts : [])
    .map(sanitizeLayout)
    .filter((layout) => layout.id);
  if (safe.length > 0) return safe;
  return [{ id: 'layout-default', name: 'Default', terminals: [{ cwd: '', startupCommand: '' }] }];
}

export function pickLayout(layouts, preferredIds) {
  const safe = sanitizeLayouts(layouts);
  for (const id of preferredIds) {
    if (!id) continue;
    const match = safe.find((layout) => layout.id === id);
    if (match) return match;
  }
  return safe[0];
}

export function buildPaneTreeFromTerminals(terminals, makeId) {
  const ts = (terminals || []).slice(0, 6);
  if (ts.length === 0) ts.push({ cwd: '', startupCommand: '' });
  const leaf = (i) => ({
    type: 'leaf',
    id: makeId(),
    cwd: ts[i]?.cwd || '',
    startupCommand: ts[i]?.startupCommand || '',
  });
  if (ts.length === 1) return { tree: leaf(0), count: 1 };
  if (ts.length === 2) return { tree: { type: 'split', dir: 'v', ratio: 0.5, a: leaf(0), b: leaf(1) }, count: 2 };
  if (ts.length === 3) return {
    tree: {
      type: 'split',
      dir: 'v',
      ratio: 0.5,
      a: leaf(0),
      b: { type: 'split', dir: 'h', ratio: 0.5, a: leaf(1), b: leaf(2) },
    },
    count: 3,
  };
  if (ts.length === 4) return {
    tree: {
      type: 'split',
      dir: 'v',
      ratio: 0.5,
      a: { type: 'split', dir: 'h', ratio: 0.5, a: leaf(0), b: leaf(1) },
      b: { type: 'split', dir: 'h', ratio: 0.5, a: leaf(2), b: leaf(3) },
    },
    count: 4,
  };
  if (ts.length === 5) return {
    tree: {
      type: 'split',
      dir: 'v',
      ratio: 0.5,
      a: { type: 'split', dir: 'h', ratio: 0.5, a: leaf(0), b: leaf(1) },
      b: {
        type: 'split',
        dir: 'h',
        ratio: 0.33,
        a: leaf(2),
        b: { type: 'split', dir: 'h', ratio: 0.5, a: leaf(3), b: leaf(4) },
      },
    },
    count: 5,
  };
  return {
    tree: {
      type: 'split',
      dir: 'v',
      ratio: 0.5,
      a: {
        type: 'split',
        dir: 'h',
        ratio: 0.33,
        a: leaf(0),
        b: { type: 'split', dir: 'h', ratio: 0.5, a: leaf(1), b: leaf(2) },
      },
      b: {
        type: 'split',
        dir: 'h',
        ratio: 0.33,
        a: leaf(3),
        b: { type: 'split', dir: 'h', ratio: 0.5, a: leaf(4), b: leaf(5) },
      },
    },
    count: 6,
  };
}

export function makeTab(id, title, paneTree, focusedPaneId) {
  return { id, title, paneTree, focusedPaneId };
}

export function makeUniqueTermId() {
  return `term-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export const PROMPT_TEMPLATES_STORAGE_KEY = 'hermes:prompt-templates';

export function clampRatio(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0.5;
  return Math.max(0.15, Math.min(0.85, n));
}

export function sanitizePaneTree(node) {
  if (!node || typeof node !== 'object') return null;
  if (node.type === 'leaf') {
    const id = String(node.id || '').trim();
    if (!id) return null;
    return {
      type: 'leaf',
      id,
      cwd: String(node.cwd || '').trim(),
      startupCommand: String(node.startupCommand || '').trim(),
    };
  }
  if (node.type !== 'split') return null;
  const a = sanitizePaneTree(node.a);
  const b = sanitizePaneTree(node.b);
  if (!a || !b) return null;
  return {
    type: 'split',
    dir: node.dir === 'h' ? 'h' : 'v',
    ratio: clampRatio(node.ratio),
    a,
    b,
  };
}

export function sanitizeWorkspaceSnapshot(raw) {
  const tabsRaw = Array.isArray(raw?.tabs) ? raw.tabs : [];
  const tabs = tabsRaw
    .map((entry, index) => {
      const id = String(entry?.id || '').trim();
      const paneTree = sanitizePaneTree(entry?.paneTree);
      if (!id || !paneTree) return null;
      const leaves = collectLeafIds(paneTree);
      if (leaves.length === 0 || new Set(leaves).size !== leaves.length) return null;
      const focusedPaneId = leaves.includes(entry?.focusedPaneId) ? entry.focusedPaneId : leaves[0];
      return {
        id,
        title: String(entry?.title || `Tab ${index + 1}`).trim() || `Tab ${index + 1}`,
        paneTree,
        focusedPaneId,
      };
    })
    .filter(Boolean)
    .slice(0, 20);
  if (tabs.length === 0) return null;

  const ids = new Set(tabs.map((tab) => tab.id));
  const activeTabId = ids.has(raw?.activeTabId) ? raw.activeTabId : tabs[0].id;
  const nextTabId = Math.max(
    2,
    Number(raw?.nextTabId || 0),
    tabs.reduce((maxId, tab) => {
      const match = String(tab.id).match(/^tab-(\d+)$/);
      if (!match) return maxId;
      return Math.max(maxId, Number(match[1]) + 1);
    }, 2)
  );
  const nextTermId = Math.max(1, Number(raw?.nextTermId || 1));

  return { tabs, activeTabId, nextTabId, nextTermId };
}

export function sanitizeDraftSegment(value, fallback) {
  const normalized = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_-]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
  return normalized || fallback;
}

export function buildPromptDraftFilename(project, name) {
  const projectPart = sanitizeDraftSegment(project, 'unassigned');
  const namePart = sanitizeDraftSegment(name, 'draft');
  return `hermes_${projectPart}_${namePart}.md`;
}

export function parseDraftFile(filename, raw) {
  const lines = raw.split('\n');
  let name = filename.replace(/^hermes_/, '').replace(/\.md$/, '').replace(/_+/g, ' ').trim();
  let project = '';
  let contentStart = 0;
  if (lines[0]?.startsWith('# ')) {
    name = lines[0].slice(2).trim() || name;
    contentStart = 1;
  }
  for (let i = contentStart; i < lines.length; i++) {
    if (lines[i].startsWith('Project: ')) {
      const proj = lines[i].slice(9).trim();
      project = proj === 'Unassigned' ? '' : proj;
      contentStart = i + 2;
      break;
    } else if (lines[i].trim() !== '') {
      contentStart = i;
      break;
    } else {
      contentStart = i + 1;
    }
  }
  return { name, project, content: lines.slice(contentStart).join('\n').trim() };
}

export function formatSummaryUsage(usage) {
  if (!usage || typeof usage !== 'object') return '';
  const usd = Number(usage.usd || 0);
  if (usd > 0) return `$${usd.toFixed(6)}`;
  const input = Number(usage.input_tokens || usage.inputTokens || 0);
  const output = Number(usage.output_tokens || usage.outputTokens || 0);
  const total = Number(usage.total_tokens || usage.totalTokens || (input + output) || 0);
  if (total <= 0) return '';
  return `${total} tokens`;
}
