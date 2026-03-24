import React, { useMemo, useState } from 'react';

function layout(nodes) {
  return nodes.map((n, i) => {
    const angle = (i / Math.max(1, nodes.length)) * Math.PI * 2;
    const radius = 90 + (i % 5) * 16;
    return { ...n, x: 190 + Math.cos(angle) * radius, y: 150 + Math.sin(angle) * radius };
  });
}

export default function LiveDependencyGraph({
  visible,
  selectedAgentId,
  agents,
  touchedFilesByAgent,
  memoryEdges,
  hotFiles,
  onSelectAgent,
  onSelectFile,
  onHide,
  onFocus,
}) {
  const [hovered, setHovered] = useState(null);
  if (!visible) return <div className="manager-sidebar hidden" />;
  const files = Array.from(touchedFilesByAgent?.[selectedAgentId] || []);
  const nodes = layout(files.map((filePath) => ({ filePath, module: filePath.split('/')[0] || 'root' })));
  const idSet = new Set(nodes.map((n) => n.filePath));
  const edges = (memoryEdges || []).filter((e) => idSet.has(e.from) && idSet.has(e.to)).slice(0, 800);
  const direct = new Set();
  if (hovered) {
    direct.add(hovered);
    for (const e of edges) {
      if (e.from === hovered) direct.add(e.to);
      if (e.to === hovered) direct.add(e.from);
    }
  }

  const agentList = useMemo(() => {
    const values = agents || [];
    return values.sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0));
  }, [agents]);

  return (
    <div className="manager-sidebar sidepane-graph" onClick={onFocus}>
      <div className="manager-header">
        <span className="manager-title">Live Dependency Graph</span>
        <button className="manager-hide-btn" onClick={(e) => { e.stopPropagation(); onHide?.(); }} title="Hide">‹</button>
      </div>
      <div className="sidepane-toolbar">
        <select className="field-input" value={selectedAgentId || ''} onChange={(e) => onSelectAgent?.(e.target.value)}>
          {agentList.length === 0 && <option value="">No agents</option>}
          {agentList.map((a) => <option key={a.id} value={a.id}>{a.id} · {a.role || a.label || 'agent'}</option>)}
        </select>
        <span className="sidepane-meta">{files.length} files</span>
      </div>
      <div className="sidepane-graph-canvas-wrap">
        <svg className="sidepane-graph-canvas" viewBox="0 0 380 300">
          {edges.map((e, i) => {
            const from = nodes.find((n) => n.filePath === e.from);
            const to = nodes.find((n) => n.filePath === e.to);
            if (!from || !to) return null;
            const faded = hovered && !direct.has(e.from) && !direct.has(e.to);
            return <line key={`${e.from}-${e.to}-${i}`} x1={from.x} y1={from.y} x2={to.x} y2={to.y} className={`dep-edge${faded ? ' faded' : ''}`} />;
          })}
          {nodes.map((n) => {
            const faded = hovered && !direct.has(n.filePath);
            const hot = hotFiles?.has(n.filePath);
            return (
              <g
                key={n.filePath}
                onMouseEnter={() => setHovered(n.filePath)}
                onMouseLeave={() => setHovered(null)}
                onClick={() => onSelectFile?.(n.filePath)}
              >
                <circle className={`dep-node module-${(n.module || 'root').replace(/[^a-z0-9]/gi, '').toLowerCase()}${faded ? ' faded' : ''}${hot ? ' hot' : ''}`} cx={n.x} cy={n.y} r="10" />
                <text className={`dep-label${faded ? ' faded' : ''}`} x={n.x + 13} y={n.y + 4}>{n.filePath.split('/').pop()}</text>
              </g>
            );
          })}
        </svg>
      </div>
      <div className="sidepane-details">
        <div className="sidepane-kv"><span>Hint</span><span>Hover a file to focus direct deps.</span></div>
      </div>
    </div>
  );
}
