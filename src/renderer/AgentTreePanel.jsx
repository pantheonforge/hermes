import React, { useMemo, useState } from 'react';

function pct(v) {
  const n = Number(v || 0);
  return Math.max(0, Math.min(100, Math.round(n)));
}

function buildTree(nodes) {
  const byId = new Map();
  const roots = [];
  for (const n of nodes) byId.set(n.id, { ...n, children: [] });
  for (const n of byId.values()) {
    if (n.parent_id && byId.has(n.parent_id)) byId.get(n.parent_id).children.push(n);
    else roots.push(n);
  }
  return roots;
}

function NodeRow({ node, depth, selectedAgentId, onSelectAgent, logs }) {
  const [expanded, setExpanded] = useState(true);
  const selected = selectedAgentId === node.id;
  return (
    <div className="agent-tree-node">
      <div className={`agent-tree-head${selected ? ' active' : ''}`} style={{ paddingLeft: `${8 + depth * 12}px` }} onClick={() => onSelectAgent?.(node.id)}>
        <button className="agent-tree-toggle" onClick={(e) => { e.stopPropagation(); setExpanded((v) => !v); }}>{expanded ? '▾' : '▸'}</button>
        <span className={`agent-status-dot ${node.status || 'idle'}`} />
        <span className="agent-tree-id">{node.id}</span>
        <span className="agent-tree-role">{node.role || 'agent'}</span>
      </div>
      <div className="agent-tree-meta" style={{ marginLeft: `${26 + depth * 12}px` }}>
        <span>{node.model || 'model:n/a'}</span>
        <span>tokens {Number(node.token_burn || 0)}</span>
        <span>{node.status || 'pending'}</span>
      </div>
      <div className="agent-tree-progress" style={{ marginLeft: `${26 + depth * 12}px` }}>
        <div className="agent-tree-progress-bar" style={{ width: `${pct(node.progress)}%` }} />
      </div>
      <div className="agent-tree-logs" style={{ marginLeft: `${26 + depth * 12}px` }}>
        {(logs || []).slice(-5).map((l, idx) => <div key={`${node.id}-${idx}`} className="agent-log-line">{l.message}</div>)}
      </div>
      {expanded && node.children?.map((c) => (
        <NodeRow key={c.id} node={c} depth={depth + 1} selectedAgentId={selectedAgentId} onSelectAgent={onSelectAgent} logs={logs} />
      ))}
    </div>
  );
}

export default function AgentTreePanel({
  visible,
  nodes,
  activities,
  selectedAgentId,
  onSelectAgent,
  onSpawn,
  onHide,
  onFocus,
}) {
  const [role, setRole] = useState('Coder');
  const [model, setModel] = useState('claude-sonnet');
  const [cmd, setCmd] = useState('');
  const tree = useMemo(() => buildTree(nodes || []), [nodes]);

  if (!visible) return <div className="manager-sidebar hidden" />;

  return (
    <div className="manager-sidebar sidepane-tree" onClick={onFocus}>
      <div className="manager-header">
        <span className="manager-title">Sub-Agent Spawning</span>
        <button className="manager-hide-btn" onClick={(e) => { e.stopPropagation(); onHide?.(); }} title="Hide">‹</button>
      </div>
      <div className="sidepane-toolbar form-col">
        <input className="field-input" value={role} onChange={(e) => setRole(e.target.value)} placeholder="Role" />
        <input className="field-input" value={model} onChange={(e) => setModel(e.target.value)} placeholder="Model" />
        <input className="field-input" value={cmd} onChange={(e) => setCmd(e.target.value)} placeholder="Spawn command (optional)" />
        <button className="btn" onClick={() => onSpawn?.({ role, model, command: cmd, parentId: selectedAgentId || null })}>Spawn Agent</button>
      </div>
      <div className="manager-body">
        {tree.length === 0 && <div className="state-empty">No agents yet.</div>}
        {tree.map((n) => (
          <NodeRow
            key={n.id}
            node={n}
            depth={0}
            selectedAgentId={selectedAgentId}
            onSelectAgent={onSelectAgent}
            logs={activities?.[n.id] || []}
          />
        ))}
      </div>
    </div>
  );
}
