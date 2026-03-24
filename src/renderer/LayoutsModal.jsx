import React, { useEffect, useMemo, useState } from 'react';

const MAX_TERMINALS = 6;

function makeLayoutId() {
  return `layout-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function makeLeaf(overrides = {}) {
  return { type: 'leaf', cwd: '', startupCommand: '', ...overrides };
}

function makeSplit(dir, a, b, ratio = 0.5) {
  return { type: 'split', dir, ratio, a, b };
}

function countLeaves(node) {
  if (!node) return 0;
  if (node.type === 'leaf') return 1;
  return countLeaves(node.a) + countLeaves(node.b);
}

function collectLeaves(node, path = []) {
  if (!node) return [];
  if (node.type === 'leaf') return [{ node, path }];
  return [
    ...collectLeaves(node.a, [...path, 'a']),
    ...collectLeaves(node.b, [...path, 'b']),
  ];
}

function getNode(tree, path) {
  return path.reduce((n, key) => n?.[key], tree);
}

function setNode(tree, path, value) {
  if (path.length === 0) return value;
  const [head, ...rest] = path;
  return { ...tree, [head]: setNode(tree[head], rest, value) };
}

function removeLeaf(tree, path) {
  if (path.length === 0) return null;
  const parentPath = path.slice(0, -1);
  const key = path[path.length - 1];
  const sibling = key === 'a' ? 'b' : 'a';
  const parent = getNode(tree, parentPath);
  const siblingNode = parent[sibling];
  if (parentPath.length === 0) return siblingNode;
  return setNode(tree, parentPath, siblingNode);
}

function splitLeaf(tree, path, dir) {
  const leaf = getNode(tree, path);
  const newSplit = makeSplit(dir, { ...leaf }, makeLeaf({ cwd: leaf.cwd }));
  return setNode(tree, path, newSplit);
}

function paneTreeFromTerminals(terminals) {
  const ts = (terminals || []).slice(0, MAX_TERMINALS);
  if (ts.length === 0) return makeLeaf();
  const leaf = (i) => makeLeaf({ cwd: ts[i]?.cwd || '', startupCommand: ts[i]?.startupCommand || '' });
  if (ts.length === 1) return leaf(0);
  if (ts.length === 2) return makeSplit('v', leaf(0), leaf(1));
  if (ts.length === 3) return makeSplit('v', leaf(0), makeSplit('h', leaf(1), leaf(2)));
  if (ts.length === 4) return makeSplit('v', makeSplit('h', leaf(0), leaf(1)), makeSplit('h', leaf(2), leaf(3)));
  if (ts.length === 5) return makeSplit('v', makeSplit('h', leaf(0), leaf(1)), makeSplit('h', leaf(2), makeSplit('h', leaf(3), leaf(4))));
  return makeSplit('v',
    makeSplit('h', leaf(0), makeSplit('h', leaf(1), leaf(2))),
    makeSplit('h', leaf(3), makeSplit('h', leaf(4), leaf(5))),
  );
}

function terminalsFromPaneTree(tree) {
  return collectLeaves(tree).map(({ node }) => ({
    cwd: node.cwd || '',
    startupCommand: node.startupCommand || '',
  }));
}

function sanitizeLayouts(layouts) {
  const raw = Array.isArray(layouts) ? layouts : [];
  const safe = raw.map((layout, index) => {
    const id = String(layout?.id || makeLayoutId());
    const name = String(layout?.name || `Layout ${index + 1}`).trim() || `Layout ${index + 1}`;
    let paneTree = layout?.paneTree || null;
    if (!paneTree) {
      const terminals = (Array.isArray(layout?.terminals) ? layout.terminals : []).slice(0, MAX_TERMINALS);
      paneTree = paneTreeFromTerminals(terminals.length > 0 ? terminals : [{ cwd: '', startupCommand: '' }]);
    }
    return { id, name, paneTree };
  }).filter((l) => l.paneTree);
  return safe.length > 0
    ? safe
    : [{ id: 'layout-default', name: 'Default', paneTree: makeLeaf() }];
}

function ensureSelection(layouts, selectedId) {
  if (layouts.some((l) => l.id === selectedId)) return selectedId;
  return layouts[0]?.id || '';
}

function LayoutPreview({ tree, selectedPath, onSelect, onSplitV, onSplitH, onRemove, totalLeaves }) {
  function renderNode(node, path, x, y, w, h) {
    if (!node) return null;
    if (node.type === 'leaf') {
      const leaves = collectLeaves(tree);
      const idx = leaves.findIndex((l) => l.path.join(',') === path.join(','));
      const isSelected = path.join(',') === (selectedPath || []).join(',');
      return (
        <div
          key={path.join('-') || 'root'}
          className={`layout-pane${isSelected ? ' selected' : ''}`}
          style={{ left: `${x * 100}%`, top: `${y * 100}%`, width: `${w * 100}%`, height: `${h * 100}%` }}
          onClick={(e) => { e.stopPropagation(); onSelect(path); }}
          title={`T${idx + 1}${node.cwd ? ` — ${node.cwd}` : ''}`}
        >
          <span className="layout-pane-label">T{idx + 1}</span>
          {isSelected && (
            <div className="layout-pane-actions" onClick={(e) => e.stopPropagation()}>
              {totalLeaves < MAX_TERMINALS && (
                <>
                  <button onClick={() => onSplitV(path)} title="Split vertical">⊞V</button>
                  <button onClick={() => onSplitH(path)} title="Split horizontal">⊞H</button>
                </>
              )}
              {totalLeaves > 1 && (
                <button className="danger" onClick={() => onRemove(path)} title="Remove pane">✕</button>
              )}
            </div>
          )}
        </div>
      );
    }
    const ratio = node.ratio ?? 0.5;
    if (node.dir === 'v') {
      return (
        <React.Fragment key={path.join('-') || 'root'}>
          {renderNode(node.a, [...path, 'a'], x, y, w * ratio, h)}
          {renderNode(node.b, [...path, 'b'], x + w * ratio, y, w * (1 - ratio), h)}
        </React.Fragment>
      );
    }
    return (
      <React.Fragment key={path.join('-') || 'root'}>
        {renderNode(node.a, [...path, 'a'], x, y, w, h * ratio)}
        {renderNode(node.b, [...path, 'b'], x, y + h * ratio, w, h * (1 - ratio))}
      </React.Fragment>
    );
  }

  return (
    <div className="layout-preview" onClick={() => onSelect([])}>
      {renderNode(tree, [], 0, 0, 1, 1)}
    </div>
  );
}

export default function LayoutsModal({ visible, config, onSave, onClose }) {
  const [layouts, setLayouts] = useState(() => sanitizeLayouts(config?.layouts));
  const [defaultLayoutId, setDefaultLayoutId] = useState(config?.defaultLayoutId || '');
  const [selectedId, setSelectedId] = useState('');
  const [selectedPath, setSelectedPath] = useState([]);

  useEffect(() => {
    if (!visible) return;
    const safeLayouts = sanitizeLayouts(config?.layouts);
    setLayouts(safeLayouts);
    const ids = new Set(safeLayouts.map((l) => l.id));
    const safeDefault = ids.has(config?.defaultLayoutId) ? config.defaultLayoutId : safeLayouts[0].id;
    setDefaultLayoutId(safeDefault);
    setSelectedId(ensureSelection(safeLayouts, safeDefault));
    setSelectedPath([]);
  }, [visible, config?.layouts, config?.defaultLayoutId]);

  const selected = useMemo(() => layouts.find((l) => l.id === selectedId) || layouts[0], [layouts, selectedId]);

  if (!visible) return null;

  const updateTree = (updater) => {
    setLayouts((prev) => prev.map((l) => (l.id === selected.id ? { ...l, paneTree: updater(l.paneTree) } : l)));
  };

  const addLayout = () => {
    const next = { id: makeLayoutId(), name: `Layout ${layouts.length + 1}`, paneTree: makeLeaf() };
    setLayouts((prev) => [...prev, next]);
    setSelectedId(next.id);
    setSelectedPath([]);
  };

  const removeLayout = (id) => {
    if (layouts.length <= 1) return;
    const next = layouts.filter((l) => l.id !== id);
    setLayouts(next);
    setSelectedId(ensureSelection(next, selectedId));
    if (defaultLayoutId === id) setDefaultLayoutId(next[0]?.id || '');
    setSelectedPath([]);
  };

  const handleSplitV = (path) => {
    updateTree((tree) => splitLeaf(tree, path, 'v'));
    setSelectedPath([...path, 'a']);
  };

  const handleSplitH = (path) => {
    updateTree((tree) => splitLeaf(tree, path, 'h'));
    setSelectedPath([...path, 'a']);
  };

  const handleRemove = (path) => {
    updateTree((tree) => removeLeaf(tree, path));
    setSelectedPath(path.slice(0, -1));
  };

  const handleAddPane = () => {
    const path = selectedPath.length > 0 ? selectedPath : (collectLeaves(selected?.paneTree || makeLeaf())[0]?.path || []);
    handleSplitV(path);
  };

  const selectedLeaf = selected ? getNode(selected.paneTree, selectedPath) : null;
  const isLeafSelected = selectedLeaf?.type === 'leaf';
  const totalLeaves = selected ? countLeaves(selected.paneTree) : 0;

  const setLeafField = (key, value) => {
    updateTree((tree) => setNode(tree, selectedPath, { ...getNode(tree, selectedPath), [key]: value }));
  };

  const save = () => {
    const safeLayouts = sanitizeLayouts(layouts);
    const safeDefault = safeLayouts.some((l) => l.id === defaultLayoutId) ? defaultLayoutId : safeLayouts[0].id;
    const safeLastUsed = safeLayouts.some((l) => l.id === config?.lastUsedLayoutId)
      ? config.lastUsedLayoutId
      : safeDefault;
    onSave?.({
      layouts: safeLayouts.map((l) => ({
        ...l,
        terminals: terminalsFromPaneTree(l.paneTree),
      })),
      defaultLayoutId: safeDefault,
      lastUsedLayoutId: safeLastUsed,
    });
  };

  const onKeyDown = (e) => {
    if (e.key === 'Escape') onClose?.();
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) save();
  };

  return (
    <div className="config-overlay" onClick={onClose} onKeyDown={onKeyDown}>
      <div className="config-panel layouts-panel" onClick={(e) => e.stopPropagation()}>
        <div className="config-header">
          <span className="config-title">Layouts</span>
          <button className="config-close" onClick={onClose}>x</button>
        </div>
        <div className="config-body layouts-body">
          <div className="layouts-sidebar">
            <div className="field-group">
              <label className="field-label">Saved layouts</label>
              <div className="layout-list">
                {layouts.map((layout) => (
                  <button
                    key={layout.id}
                    className={`layout-list-item${layout.id === selected?.id ? ' active' : ''}`}
                    onClick={() => { setSelectedId(layout.id); setSelectedPath([]); }}
                  >
                    <span>{layout.name}</span>
                    <span className="layout-list-meta">{countLeaves(layout.paneTree)}</span>
                  </button>
                ))}
              </div>
            </div>
            <button className="btn" onClick={addLayout}>+ Layout</button>
          </div>

          <div className="layouts-editor">
            <div className="field-group">
              <label className="field-label">Layout name</label>
              <input
                className="field-input"
                value={selected?.name || ''}
                onChange={(e) => setLayouts((prev) => prev.map((l) => (l.id === selected.id ? { ...l, name: e.target.value } : l)))}
                placeholder="Layout name"
              />
            </div>
            <div className="field-group">
              <label className="field-label">Default layout</label>
              <select
                className="field-input"
                value={defaultLayoutId}
                onChange={(e) => setDefaultLayoutId(e.target.value)}
              >
                {layouts.map((l) => (
                  <option key={l.id} value={l.id}>{l.name}</option>
                ))}
              </select>
            </div>

            <div className="field-group">
              <div className="layout-preview-toolbar">
                <label className="field-label" style={{ flex: 1 }}>
                  Panes — {totalLeaves} / {MAX_TERMINALS}
                  {isLeafSelected && selectedPath.length > 0 && ` · T${collectLeaves(selected.paneTree).findIndex((l) => l.path.join(',') === selectedPath.join(',')) + 1} selected`}
                </label>
                <button
                  className="btn"
                  onClick={handleAddPane}
                  disabled={totalLeaves >= MAX_TERMINALS}
                  title="Split selected pane vertically"
                >+ Pane</button>
              </div>
              {selected && (
                <LayoutPreview
                  tree={selected.paneTree}
                  selectedPath={selectedPath}
                  onSelect={setSelectedPath}
                  onSplitV={handleSplitV}
                  onSplitH={handleSplitH}
                  onRemove={handleRemove}
                  totalLeaves={totalLeaves}
                />
              )}
            </div>

            {isLeafSelected && (
              <div className="field-group layout-pane-form">
                <label className="field-label">Selected pane settings</label>
                <input
                  className="field-input"
                  value={selectedLeaf.cwd || ''}
                  onChange={(e) => setLeafField('cwd', e.target.value)}
                  placeholder="Startup directory (optional)"
                />
                <input
                  className="field-input"
                  value={selectedLeaf.startupCommand || ''}
                  onChange={(e) => setLeafField('startupCommand', e.target.value)}
                  placeholder="Startup command (optional)"
                />
              </div>
            )}

            {layouts.length > 1 && (
              <button className="btn danger" onClick={() => removeLayout(selected.id)}>Delete Layout</button>
            )}
          </div>
        </div>
        <div className="config-footer">
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={save}>Save Layouts</button>
        </div>
      </div>
    </div>
  );
}
