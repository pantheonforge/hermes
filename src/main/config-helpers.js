const { DEFAULTS, MCP_PORT } = require('../shared/constants');

const MAX_LAYOUT_TERMINALS = 6;

function makeLayoutId() {
  return `layout-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function sanitizeLayoutTerminal(input) {
  return {
    cwd: String(input?.cwd || '').trim(),
    startupCommand: String(input?.startupCommand || '').trim(),
  };
}

function sanitizeLayoutPreset(input, fallbackName) {
  const terminalsRaw = Array.isArray(input?.terminals) ? input.terminals : [];
  const terminals = terminalsRaw
    .slice(0, MAX_LAYOUT_TERMINALS)
    .map(sanitizeLayoutTerminal);
  const safeTerminals = terminals.length > 0 ? terminals : [{ cwd: '', startupCommand: '' }];
  return {
    id: String(input?.id || makeLayoutId()),
    name: String(input?.name || fallbackName || 'Layout').trim() || 'Layout',
    terminals: safeTerminals,
  };
}

function normalizeLayoutConfig(storeValues) {
  const rawLayouts = Array.isArray(storeValues?.layouts) ? storeValues.layouts : [];
  const legacyStartup = Array.isArray(storeValues?.startupLayout) ? storeValues.startupLayout : [];
  let layouts = rawLayouts
    .map((layout, i) => sanitizeLayoutPreset(layout, `Layout ${i + 1}`))
    .slice(0, 40);

  if (layouts.length === 0 && legacyStartup.length > 0) {
    layouts = [
      sanitizeLayoutPreset(
        {
          id: 'layout-default',
          name: 'Default',
          terminals: legacyStartup.map((entry) => ({
            cwd: String(entry?.cwd || '').trim(),
            startupCommand: '',
          })),
        },
        'Default'
      ),
    ];
  }

  if (layouts.length === 0) {
    layouts = [sanitizeLayoutPreset(DEFAULTS.layouts[0], 'Default')];
  }

  const layoutIds = new Set();
  layouts = layouts.map((layout) => {
    let id = String(layout.id || '').trim();
    if (!id) id = makeLayoutId();
    while (layoutIds.has(id)) id = makeLayoutId();
    layoutIds.add(id);
    return { ...layout, id };
  });

  let defaultLayoutId = String(storeValues?.defaultLayoutId || '').trim();
  if (!layoutIds.has(defaultLayoutId)) defaultLayoutId = layouts[0].id;

  let lastUsedLayoutId = String(storeValues?.lastUsedLayoutId || '').trim();
  if (!layoutIds.has(lastUsedLayoutId)) lastUsedLayoutId = defaultLayoutId;

  return { layouts, defaultLayoutId, lastUsedLayoutId };
}

function readNormalizedConfig(store, overrideMcpPort, mcpConfigPath) {
  const normalized = normalizeLayoutConfig(store.store);
  const needsWrite =
    JSON.stringify(store.get('layouts')) !== JSON.stringify(normalized.layouts)
    || store.get('defaultLayoutId') !== normalized.defaultLayoutId
    || store.get('lastUsedLayoutId') !== normalized.lastUsedLayoutId;
  if (needsWrite) {
    store.set('layouts', normalized.layouts);
    store.set('defaultLayoutId', normalized.defaultLayoutId);
    store.set('lastUsedLayoutId', normalized.lastUsedLayoutId);
  }
  const storedPort = Number.parseInt(String(store.get('mcpPort', MCP_PORT)), 10);
  const safeStoredPort = Number.isInteger(storedPort) && storedPort > 0 && storedPort <= 65535
    ? storedPort
    : MCP_PORT;
  const effectiveMcpPort = overrideMcpPort || safeStoredPort;
  return { ...store.store, ...normalized, mcpPort: effectiveMcpPort, mcpConfigPath };
}

module.exports = { normalizeLayoutConfig, readNormalizedConfig, makeLayoutId, sanitizeLayoutTerminal, sanitizeLayoutPreset };
