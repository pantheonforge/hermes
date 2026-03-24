import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../renderer/TerminalGrid.jsx', () => {
  function collectLeafIds(node) {
    if (node.type === 'leaf') return [node.id];
    return [...collectLeafIds(node.a), ...collectLeafIds(node.b)];
  }
  return { collectLeafIds };
});

import {
  detectTool,
  createSessionLabel,
  buildToolCommand,
  updateLeafCwd,
  normalizeFilePathForProject,
  sanitizeLayout,
  sanitizeLayouts,
  pickLayout,
  buildPaneTreeFromTerminals,
  clampRatio,
  sanitizePaneTree,
  sanitizeWorkspaceSnapshot,
  sanitizeDraftSegment,
  buildPromptDraftFilename,
  parseDraftFile,
  formatSummaryUsage,
  makeTab,
  makeUniqueTermId,
} from '../../renderer/app-utils.js';

// ─── detectTool ───────────────────────────────────────────────────────────────

describe('detectTool', () => {
  it('detects claude', () => expect(detectTool('claude')).toBe('claude'));
  it('detects codex', () => expect(detectTool('codex')).toBe('codex'));
  it('detects claude case-insensitively', () => expect(detectTool('Claude')).toBe('claude'));
  it('returns other for unknown', () => expect(detectTool('vim')).toBe('other'));
  it('returns other for empty', () => expect(detectTool('')).toBe('other'));
  it('returns other for null', () => expect(detectTool(null)).toBe('other'));
});

// ─── createSessionLabel ───────────────────────────────────────────────────────

describe('createSessionLabel', () => {
  it('formats claude label', () => expect(createSessionLabel('claude', '/home/user/project')).toBe('Claude @ project'));
  it('formats codex label', () => expect(createSessionLabel('codex', '/home/user/project')).toBe('Codex @ project'));
  it('uses workspace when cwd is empty', () => expect(createSessionLabel('claude', '')).toBe('Claude @ workspace'));
  it('uses unknown tool label', () => expect(createSessionLabel('other', '/foo/bar')).toBe('Tool @ bar'));
  it('handles Windows paths', () => expect(createSessionLabel('claude', 'C:\\Users\\user\\project')).toBe('Claude @ project'));
});

// ─── buildToolCommand ─────────────────────────────────────────────────────────

describe('buildToolCommand', () => {
  it('returns plain claude command when no mcpConfigPath', () => {
    expect(buildToolCommand({ claudeCmd: 'claude' }, 'claude')).toBe('claude');
  });

  it('appends mcp-config flag when mcpConfigPath is set', () => {
    const result = buildToolCommand({ claudeCmd: 'claude', mcpConfigPath: '/tmp/hermes-mcp.json' }, 'claude');
    expect(result).toBe('claude --mcp-config "/tmp/hermes-mcp.json"');
  });

  it('builds codex command without port when port is 0', () => {
    expect(buildToolCommand({ codexCmd: 'codex', mcpPort: 0 }, 'codex')).toBe('codex');
  });

  it('builds codex command with MCP flags when port is set', () => {
    const result = buildToolCommand({ codexCmd: 'codex', mcpPort: 2337 }, 'codex');
    expect(result).toContain('codex');
    expect(result).toContain('2337');
    expect(result).toContain('streamable_http');
  });

  it('uses default commands when config is empty', () => {
    expect(buildToolCommand({}, 'claude')).toBe('claude');
    expect(buildToolCommand({}, 'codex')).toBe('codex');
  });
});

// ─── updateLeafCwd ────────────────────────────────────────────────────────────

describe('updateLeafCwd', () => {
  const leaf = (id, cwd = '') => ({ type: 'leaf', id, cwd });

  it('updates matching leaf cwd', () => {
    const result = updateLeafCwd(leaf('t1', '/old'), 't1', '/new');
    expect(result.cwd).toBe('/new');
  });

  it('returns same reference when cwd unchanged', () => {
    const node = leaf('t1', '/same');
    expect(updateLeafCwd(node, 't1', '/same')).toBe(node);
  });

  it('returns same reference when id does not match', () => {
    const node = leaf('t1', '/old');
    expect(updateLeafCwd(node, 't2', '/new')).toBe(node);
  });

  it('updates nested leaf', () => {
    const tree = { type: 'split', dir: 'v', ratio: 0.5, a: leaf('t1', '/a'), b: leaf('t2', '/b') };
    const result = updateLeafCwd(tree, 't2', '/updated');
    expect(result.b.cwd).toBe('/updated');
    expect(result.a.cwd).toBe('/a');
  });

  it('returns same reference when no change in split', () => {
    const tree = { type: 'split', dir: 'v', ratio: 0.5, a: leaf('t1', '/a'), b: leaf('t2', '/b') };
    expect(updateLeafCwd(tree, 't99', '/x')).toBe(tree);
  });
});

// ─── normalizeFilePathForProject ──────────────────────────────────────────────

describe('normalizeFilePathForProject', () => {
  it('returns relative path when file is under project root', () => {
    expect(normalizeFilePathForProject('/project/src/foo.js', '/project')).toBe('src/foo.js');
  });

  it('returns "." when path equals root', () => {
    expect(normalizeFilePathForProject('/project', '/project')).toBe('.');
  });

  it('returns raw path when not under root', () => {
    expect(normalizeFilePathForProject('/other/foo.js', '/project')).toBe('/other/foo.js');
  });

  it('normalizes backslashes', () => {
    expect(normalizeFilePathForProject('C:\\project\\src\\foo.js', 'C:\\project')).toBe('src/foo.js');
  });

  it('returns empty string for empty filePath', () => {
    expect(normalizeFilePathForProject('', '/project')).toBe('');
  });

  it('returns raw path when projectPath is empty', () => {
    expect(normalizeFilePathForProject('/foo/bar.js', '')).toBe('/foo/bar.js');
  });

  it('is case-insensitive', () => {
    expect(normalizeFilePathForProject('/Project/src/foo.js', '/project')).toBe('src/foo.js');
  });
});

// ─── sanitizeLayout ───────────────────────────────────────────────────────────

describe('sanitizeLayout', () => {
  it('preserves valid layout', () => {
    const layout = { id: 'l1', name: 'Dev', terminals: [{ cwd: '/home', startupCommand: 'claude' }] };
    const result = sanitizeLayout(layout);
    expect(result.id).toBe('l1');
    expect(result.name).toBe('Dev');
    expect(result.terminals[0].cwd).toBe('/home');
  });

  it('caps terminals at 4', () => {
    const terminals = Array(6).fill({ cwd: '/x', startupCommand: '' });
    expect(sanitizeLayout({ id: 'l1', name: 'L', terminals }).terminals).toHaveLength(4);
  });

  it('provides default terminal when empty', () => {
    const result = sanitizeLayout({ id: 'l1', name: 'L', terminals: [] });
    expect(result.terminals).toHaveLength(1);
    expect(result.terminals[0]).toEqual({ cwd: '', startupCommand: '' });
  });

  it('falls back to "Layout" when name is empty', () => {
    expect(sanitizeLayout({ id: 'l1', name: '' }).name).toBe('Layout');
  });
});

// ─── sanitizeLayouts ──────────────────────────────────────────────────────────

describe('sanitizeLayouts', () => {
  it('filters out layouts without id', () => {
    const result = sanitizeLayouts([{ id: 'l1', name: 'A' }, { name: 'B' }]);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('l1');
  });

  it('returns default layout for empty array', () => {
    const result = sanitizeLayouts([]);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('layout-default');
  });

  it('returns default layout for non-array', () => {
    expect(sanitizeLayouts(null)).toHaveLength(1);
    expect(sanitizeLayouts(undefined)).toHaveLength(1);
  });
});

// ─── pickLayout ───────────────────────────────────────────────────────────────

describe('pickLayout', () => {
  const layouts = [
    { id: 'l1', name: 'A', terminals: [{ cwd: '', startupCommand: '' }] },
    { id: 'l2', name: 'B', terminals: [{ cwd: '', startupCommand: '' }] },
  ];

  it('returns layout matching first preferred id', () => {
    expect(pickLayout(layouts, ['l2', 'l1']).id).toBe('l2');
  });

  it('skips ids not in layouts', () => {
    expect(pickLayout(layouts, ['missing', 'l2']).id).toBe('l2');
  });

  it('returns first layout when no preferred ids match', () => {
    expect(pickLayout(layouts, ['nope']).id).toBe('l1');
  });

  it('skips null/empty preferred ids', () => {
    expect(pickLayout(layouts, [null, '', 'l2']).id).toBe('l2');
  });
});

// ─── buildPaneTreeFromTerminals ───────────────────────────────────────────────

describe('buildPaneTreeFromTerminals', () => {
  let n = 0;
  const makeId = () => `t${++n}`;
  beforeEach(() => { n = 0; });

  it('builds single leaf for 1 terminal', () => {
    const { tree, count } = buildPaneTreeFromTerminals([{ cwd: '/a', startupCommand: '' }], makeId);
    expect(tree.type).toBe('leaf');
    expect(count).toBe(1);
  });

  it('builds vertical split for 2 terminals', () => {
    const { tree, count } = buildPaneTreeFromTerminals(
      [{ cwd: '/a', startupCommand: '' }, { cwd: '/b', startupCommand: '' }], makeId
    );
    expect(tree.type).toBe('split');
    expect(tree.dir).toBe('v');
    expect(count).toBe(2);
  });

  it('produces correct count for 3 through 6 terminals', () => {
    for (let len = 3; len <= 6; len++) {
      n = 0;
      const terminals = Array.from({ length: len }, (_, i) => ({ cwd: `/p${i}`, startupCommand: '' }));
      const { count } = buildPaneTreeFromTerminals(terminals, makeId);
      expect(count).toBe(len);
    }
  });

  it('caps at 6 terminals', () => {
    n = 0;
    const terminals = Array(8).fill({ cwd: '/x', startupCommand: '' });
    const { count } = buildPaneTreeFromTerminals(terminals, makeId);
    expect(count).toBe(6);
  });

  it('creates a leaf for empty input', () => {
    n = 0;
    const { tree, count } = buildPaneTreeFromTerminals([], makeId);
    expect(tree.type).toBe('leaf');
    expect(count).toBe(1);
  });
});

// ─── clampRatio ───────────────────────────────────────────────────────────────

describe('clampRatio', () => {
  it('clamps below min to 0.15', () => expect(clampRatio(0)).toBe(0.15));
  it('clamps above max to 0.85', () => expect(clampRatio(1)).toBe(0.85));
  it('passes through midpoint', () => expect(clampRatio(0.5)).toBe(0.5));
  it('defaults to 0.5 for NaN', () => expect(clampRatio('bad')).toBe(0.5));
  it('defaults to 0.5 for undefined', () => expect(clampRatio(undefined)).toBe(0.5));
});

// ─── sanitizePaneTree ─────────────────────────────────────────────────────────

describe('sanitizePaneTree', () => {
  it('sanitizes a valid leaf', () => {
    const result = sanitizePaneTree({ type: 'leaf', id: 't1', cwd: '/home', startupCommand: 'claude' });
    expect(result).toEqual({ type: 'leaf', id: 't1', cwd: '/home', startupCommand: 'claude' });
  });

  it('returns null for leaf with empty id', () => {
    expect(sanitizePaneTree({ type: 'leaf', id: '', cwd: '/' })).toBeNull();
  });

  it('sanitizes a valid split', () => {
    const tree = {
      type: 'split', dir: 'v', ratio: 0.5,
      a: { type: 'leaf', id: 't1', cwd: '', startupCommand: '' },
      b: { type: 'leaf', id: 't2', cwd: '', startupCommand: '' },
    };
    const result = sanitizePaneTree(tree);
    expect(result.type).toBe('split');
    expect(result.dir).toBe('v');
    expect(result.a.id).toBe('t1');
    expect(result.b.id).toBe('t2');
  });

  it('returns null when a child leaf is invalid', () => {
    const tree = {
      type: 'split', dir: 'v', ratio: 0.5,
      a: { type: 'leaf', id: '', cwd: '' },
      b: { type: 'leaf', id: 't2', cwd: '' },
    };
    expect(sanitizePaneTree(tree)).toBeNull();
  });

  it('normalises dir to "v" for unknown value', () => {
    const tree = {
      type: 'split', dir: 'x', ratio: 0.5,
      a: { type: 'leaf', id: 't1', cwd: '', startupCommand: '' },
      b: { type: 'leaf', id: 't2', cwd: '', startupCommand: '' },
    };
    expect(sanitizePaneTree(tree).dir).toBe('v');
  });

  it('returns null for null input', () => expect(sanitizePaneTree(null)).toBeNull());
  it('returns null for unknown type', () => expect(sanitizePaneTree({ type: 'bad' })).toBeNull());
});

// ─── sanitizeWorkspaceSnapshot ────────────────────────────────────────────────

describe('sanitizeWorkspaceSnapshot', () => {
  const makeSnapshot = (overrides = {}) => ({
    tabs: [{
      id: 'tab-1',
      title: 'Tab 1',
      paneTree: { type: 'leaf', id: 'term-1', cwd: '', startupCommand: '' },
      focusedPaneId: 'term-1',
    }],
    activeTabId: 'tab-1',
    nextTabId: 2,
    nextTermId: 1,
    ...overrides,
  });

  it('returns valid snapshot unchanged', () => {
    const result = sanitizeWorkspaceSnapshot(makeSnapshot());
    expect(result.tabs).toHaveLength(1);
    expect(result.activeTabId).toBe('tab-1');
  });

  it('returns null for null input', () => expect(sanitizeWorkspaceSnapshot(null)).toBeNull());
  it('returns null when tabs is empty', () => expect(sanitizeWorkspaceSnapshot({ tabs: [] })).toBeNull());

  it('filters out tabs with invalid pane trees', () => {
    const snap = makeSnapshot({
      tabs: [
        { id: 'tab-1', paneTree: { type: 'leaf', id: 'term-1', cwd: '' }, focusedPaneId: 'term-1' },
        { id: 'tab-2', paneTree: { type: 'leaf', id: '', cwd: '' }, focusedPaneId: '' },
      ],
    });
    const result = sanitizeWorkspaceSnapshot(snap);
    expect(result.tabs).toHaveLength(1);
    expect(result.tabs[0].id).toBe('tab-1');
  });

  it('falls back activeTabId to first tab when not found', () => {
    const result = sanitizeWorkspaceSnapshot(makeSnapshot({ activeTabId: 'missing' }));
    expect(result.activeTabId).toBe('tab-1');
  });

  it('falls back focusedPaneId to first leaf when not found', () => {
    const snap = makeSnapshot();
    snap.tabs[0].focusedPaneId = 'not-a-leaf';
    const result = sanitizeWorkspaceSnapshot(snap);
    expect(result.tabs[0].focusedPaneId).toBe('term-1');
  });

  it('caps at 20 tabs', () => {
    const tabs = Array.from({ length: 25 }, (_, i) => ({
      id: `tab-${i + 1}`,
      paneTree: { type: 'leaf', id: `term-${i + 1}`, cwd: '' },
      focusedPaneId: `term-${i + 1}`,
    }));
    const result = sanitizeWorkspaceSnapshot({ tabs, activeTabId: 'tab-1' });
    expect(result.tabs).toHaveLength(20);
  });
});

// ─── sanitizeDraftSegment ─────────────────────────────────────────────────────

describe('sanitizeDraftSegment', () => {
  it('lowercases and replaces spaces with underscores', () => {
    expect(sanitizeDraftSegment('My Project', 'fallback')).toBe('my_project');
  });

  it('strips leading/trailing underscores', () => {
    expect(sanitizeDraftSegment('  hello  ', 'f')).toBe('hello');
  });

  it('collapses repeated special chars into a single underscore', () => {
    expect(sanitizeDraftSegment('a!!b', 'f')).toBe('a_b');
  });

  it('uses fallback for empty result', () => {
    expect(sanitizeDraftSegment('!!!', 'fallback')).toBe('fallback');
  });

  it('uses fallback for empty input', () => {
    expect(sanitizeDraftSegment('', 'fb')).toBe('fb');
  });
});

// ─── buildPromptDraftFilename ─────────────────────────────────────────────────

describe('buildPromptDraftFilename', () => {
  it('builds filename from project and name', () => {
    expect(buildPromptDraftFilename('My Project', 'Fix Auth')).toBe('hermes_my_project_fix_auth.md');
  });

  it('uses fallbacks for empty inputs', () => {
    expect(buildPromptDraftFilename('', '')).toBe('hermes_unassigned_draft.md');
  });
});

// ─── parseDraftFile ───────────────────────────────────────────────────────────

describe('parseDraftFile', () => {
  it('parses name from h1 heading', () => {
    const result = parseDraftFile('hermes_p_n.md', '# My Draft\n\nContent here');
    expect(result.name).toBe('My Draft');
    expect(result.content).toBe('Content here');
  });

  it('parses project from Project: line', () => {
    const result = parseDraftFile('hermes_p_n.md', '# My Draft\nProject: Hermes\n\nContent');
    expect(result.project).toBe('Hermes');
    expect(result.content).toBe('Content');
  });

  it('treats Unassigned project as empty string', () => {
    const result = parseDraftFile('hermes_p_n.md', '# Title\nProject: Unassigned\n\nBody');
    expect(result.project).toBe('');
  });

  it('falls back to filename-derived name when no heading', () => {
    const result = parseDraftFile('hermes_my_project_fix_auth.md', 'just content');
    expect(result.name).toContain('my');
  });

  it('handles empty content', () => {
    const result = parseDraftFile('hermes_p_n.md', '');
    expect(result.content).toBe('');
  });
});

// ─── formatSummaryUsage ───────────────────────────────────────────────────────

describe('formatSummaryUsage', () => {
  it('formats USD when present', () => {
    expect(formatSummaryUsage({ usd: 0.001234 })).toBe('$0.001234');
  });

  it('formats total token count', () => {
    expect(formatSummaryUsage({ input_tokens: 100, output_tokens: 50 })).toBe('150 tokens');
  });

  it('uses total_tokens when present', () => {
    expect(formatSummaryUsage({ total_tokens: 200, input_tokens: 100 })).toBe('200 tokens');
  });

  it('returns empty string for zero tokens', () => {
    expect(formatSummaryUsage({ input_tokens: 0, output_tokens: 0 })).toBe('');
  });

  it('returns empty string for null', () => expect(formatSummaryUsage(null)).toBe(''));
  it('returns empty string for non-object', () => expect(formatSummaryUsage('bad')).toBe(''));
});

// ─── makeTab / makeUniqueTermId ───────────────────────────────────────────────

describe('makeTab', () => {
  it('returns an object with all four fields', () => {
    const tab = makeTab('tab-1', 'My Tab', { type: 'leaf', id: 't1' }, 't1');
    expect(tab).toEqual({ id: 'tab-1', title: 'My Tab', paneTree: { type: 'leaf', id: 't1' }, focusedPaneId: 't1' });
  });
});

describe('makeUniqueTermId', () => {
  it('returns a non-empty string', () => {
    expect(typeof makeUniqueTermId()).toBe('string');
    expect(makeUniqueTermId().length).toBeGreaterThan(0);
  });

  it('generates unique IDs', () => {
    const ids = new Set(Array.from({ length: 50 }, makeUniqueTermId));
    expect(ids.size).toBe(50);
  });
});
