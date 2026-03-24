import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';

function relativeTime(ms) {
  const diff = Date.now() - ms;
  if (diff < 60000) return 'just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return `${Math.floor(diff / 86400000)}d ago`;
}

// --- Semantic search pane ---

const SCOPES = [
  { value: 'code', label: 'Code' },
  { value: 'events', label: 'Events' },
  { value: 'all', label: 'All' },
];

function ResultItem({ item, onOpen, onHighlight }) {
  if (item.kind === 'event') {
    const date = item.timestamp ? new Date(item.timestamp).toLocaleString() : '';
    return (
      <div className="artifact-item">
        <div className="artifact-meta">
          <div className="artifact-name">
            [{item.eventType}] {item.agentId || 'unknown'}
            {item.channel ? ` · #${item.channel}` : ''}
          </div>
          <div className="artifact-submeta">
            score {Number(item.score || 0).toFixed(4)}
            {date ? ` · ${date}` : ''}
          </div>
        </div>
        <pre className="artifact-body">{item.excerpt || ''}</pre>
      </div>
    );
  }
  return (
    <div className="artifact-item" onClick={() => onHighlight?.(item.filePath)} style={{ cursor: 'pointer' }}>
      <div className="artifact-meta">
        <div className="artifact-name">{item.filePath}</div>
        <div className="artifact-submeta">score {Number(item.score || 0).toFixed(4)}</div>
      </div>
      <div className="artifact-actions">
        <button className="manager-icon-btn" onClick={(e) => { e.stopPropagation(); onOpen?.(item); }}>Open</button>
      </div>
      <pre className="artifact-body">{item.excerpt || ''}</pre>
    </div>
  );
}

function SearchPane({ onHighlight, onOpenResult }) {
  const [query, setQuery] = useState('');
  const [scope, setScope] = useState('code');
  const [threshold, setThreshold] = useState(0.3);
  const [busy, setBusy] = useState(false);
  const [needsIndex, setNeedsIndex] = useState(false);
  const [embedDisabled, setEmbedDisabled] = useState(false);
  const [results, setResults] = useState([]);
  const [error, setError] = useState('');
  const [embedder, setEmbedder] = useState('');

  useEffect(() => {
    window.electron.memory.getSnapshot().then((snap) => {
      if (snap?.embedder) setEmbedder(snap.embedder);
    }).catch(() => {});
  }, []);

  const runSearch = useCallback(async () => {
    const q = String(query || '').trim();
    if (!q || busy) return;
    setBusy(true);
    setError('');
    setEmbedDisabled(false);
    try {
      const res = await window.electron.memory.semanticSearch(q, 50, scope);
      if (!res?.ok) {
        if (res?.embedDisabled) { setEmbedDisabled(true); setResults([]); setNeedsIndex(false); }
        else { setError(res?.error || 'Search failed'); setResults([]); setNeedsIndex(false); }
      } else {
        setResults((Array.isArray(res.results) ? res.results : []).filter((r) => r.score >= threshold));
        setNeedsIndex(Boolean(res.needsIndex));
      }
      if (res?.embedder) setEmbedder(res.embedder);
    } catch {
      setError('Search failed'); setResults([]); setNeedsIndex(false);
    } finally {
      setBusy(false);
    }
  }, [query, scope, threshold, busy]);

  const statusLabel = embedder === 'fastembed' ? 'fastembed' : embedder === 'disabled' ? 'embedder unavailable' : embedder || '…';

  return (
    <div className="codebase-search-pane">
      <div className="sidepane-toolbar" style={{ flexDirection: 'column', gap: 6 }}>
        <input
          className="field-input"
          value={query}
          placeholder="Find related code or messages…"
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); runSearch().catch(() => {}); } }}
        />
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <div style={{ display: 'flex', gap: 2 }}>
            {SCOPES.map((s) => (
              <button key={s.value} className={`manager-icon-btn${scope === s.value ? ' active' : ''}`}
                style={{ padding: '2px 8px', opacity: scope === s.value ? 1 : 0.55 }}
                onClick={() => setScope(s.value)}>{s.label}</button>
            ))}
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--text-muted)', marginLeft: 'auto' }}>
            min
            <input type="range" min={0} max={1} step={0.05} value={threshold}
              onChange={(e) => setThreshold(Number(e.target.value))} style={{ width: 60 }} />
            {threshold.toFixed(2)}
          </label>
        </div>
        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          <button className="manager-icon-btn" onClick={() => runSearch().catch(() => {})} disabled={busy}>
            {busy ? '…' : 'Search'}
          </button>
          <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{statusLabel}</span>
        </div>
      </div>
      {error && <div className="state-empty">{error}</div>}
      {embedDisabled && <div className="state-empty">Embedding model unavailable.</div>}
      {needsIndex && <div className="state-empty">No index found. Run scan first.</div>}
      {!busy && !error && !embedDisabled && !needsIndex && results.length === 0 && (
        <div className="state-empty">Run a query to see top semantic matches.</div>
      )}
      <div className="artifact-list" style={{ flex: 1, overflow: 'auto' }}>
        {results.map((item, idx) => (
          <ResultItem key={`${item.kind}-${item.filePath}-${item.chunkIndex}-${idx}`}
            item={item} onOpen={onOpenResult} onHighlight={onHighlight} />
        ))}
      </div>
    </div>
  );
}

// --- Force-directed graph ---

function strHue(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  return h % 360;
}

function dirOf(fp) {
  const p = fp.split('/');
  return p.length > 1 ? p.slice(0, -1).join('/') : '';
}

function topDir(fp) { return fp.split('/')[0] || ''; }

// Place nodes pre-clustered by directory on a circle of circles
function buildInitialPositions(nodes, W, H) {
  const byDir = new Map();
  for (const n of nodes) {
    const d = dirOf(n.filePath);
    if (!byDir.has(d)) byDir.set(d, []);
    byDir.get(d).push(n.filePath);
  }
  const dirs = Array.from(byDir.keys());
  const nDirs = Math.max(1, dirs.length);
  const cx = W / 2, cy = H / 2;
  const outerR = Math.min(W, H) * 0.36;
  const pos = new Map();
  dirs.forEach((dir, di) => {
    const files = byDir.get(dir);
    const dirAngle = (2 * Math.PI * di) / nDirs - Math.PI / 2;
    const dcx = nDirs === 1 ? cx : cx + outerR * Math.cos(dirAngle);
    const dcy = nDirs === 1 ? cy : cy + outerR * Math.sin(dirAngle);
    const spread = Math.max(15, Math.min(55, Math.sqrt(files.length) * 16));
    files.forEach((fp, fi) => {
      const a = files.length === 1 ? 0 : (2 * Math.PI * fi) / files.length;
      pos.set(fp, {
        x: dcx + spread * Math.cos(a) + (Math.random() - 0.5) * 8,
        y: dcy + spread * Math.sin(a) + (Math.random() - 0.5) * 8,
      });
    });
  });
  return pos;
}

function useForceSimulation(nodes, edges) {
  const prevPosRef = useRef(new Map());
  const [result, setResult] = useState(() => ({ positions: new Map(), bbox: null }));
  const rafRef = useRef(null);

  useEffect(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);

    if (!nodes.length) {
      setResult({ positions: new Map(), bbox: null });
      return;
    }

    const n = nodes.length;
    // Virtual canvas scales with node count but we DON'T clamp to it — it's just for force scaling
    const W = Math.max(800, Math.ceil(Math.sqrt(n) * 130));
    const H = Math.max(600, Math.ceil(Math.sqrt(n) * 100));
    const k = Math.sqrt((W * H) / n) * 1.15;
    const cx = W / 2, cy = H / 2;
    const ids = nodes.map((nd) => nd.filePath);
    const idxMap = new Map(ids.map((id, i) => [id, i]));

    const initPos = buildInitialPositions(nodes, W, H);
    const pos = new Map();
    for (const nd of nodes) {
      const prev = prevPosRef.current.get(nd.filePath);
      pos.set(nd.filePath, prev ? { x: prev.x, y: prev.y } : initPos.get(nd.filePath));
    }

    // Show initial layout immediately
    setResult({ positions: new Map(pos), bbox: computeBbox(pos, ids) });

    let temp = k * 2.0;
    const cooling = 0.93;
    let frame = 0;

    function tick() {
      frame++;
      const dfx = new Float64Array(n);
      const dfy = new Float64Array(n);

      // Repulsion — k² / d (no cap)
      for (let i = 0; i < n; i++) {
        const a = pos.get(ids[i]);
        for (let j = i + 1; j < n; j++) {
          const b = pos.get(ids[j]);
          let dx = a.x - b.x, dy = a.y - b.y;
          if (dx === 0 && dy === 0) { dx = Math.random() - 0.5; dy = Math.random() - 0.5; }
          const dist = Math.sqrt(dx * dx + dy * dy) || 0.01;
          const f = (k * k) / dist;
          dfx[i] += (dx / dist) * f; dfy[i] += (dy / dist) * f;
          dfx[j] -= (dx / dist) * f; dfy[j] -= (dy / dist) * f;
        }
      }

      // Attraction — d² / k along edges
      for (const e of edges) {
        const ai = idxMap.get(e.from), bi = idxMap.get(e.to);
        if (ai === undefined || bi === undefined) continue;
        const a = pos.get(e.from), b = pos.get(e.to);
        const dx = b.x - a.x, dy = b.y - a.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 0.01;
        // Semantic edges are weaker attractors than import edges
        const strength = e.type === 'semantic' ? 0.5 : 1.0;
        const f = ((dist * dist) / k) * strength;
        dfx[ai] += (dx / dist) * f; dfy[ai] += (dy / dist) * f;
        dfx[bi] -= (dx / dist) * f; dfy[bi] -= (dy / dist) * f;
      }

      // Soft radial centering — grows with distance from center
      for (let i = 0; i < n; i++) {
        const p = pos.get(ids[i]);
        const ddx = cx - p.x, ddy = cy - p.y;
        const dist = Math.sqrt(ddx * ddx + ddy * ddy) || 1;
        // Quadratic gravity: stronger further out, very gentle near center
        const grav = (dist / (k * 4)) * 0.012 * k;
        dfx[i] += (ddx / dist) * grav;
        dfy[i] += (ddy / dist) * grav;
      }

      // Integrate with temperature cap — NO hard boundary clamping
      let maxDisp = 0;
      for (let i = 0; i < n; i++) {
        const p = pos.get(ids[i]);
        const mag = Math.sqrt(dfx[i] * dfx[i] + dfy[i] * dfy[i]) || 0.01;
        const scale = Math.min(mag, temp) / mag;
        const vx = dfx[i] * scale, vy = dfy[i] * scale;
        p.x += vx;
        p.y += vy;
        maxDisp = Math.max(maxDisp, Math.abs(vx) + Math.abs(vy));
      }

      temp = Math.max(0.05, temp * cooling);

      if (frame % 4 === 0) {
        setResult({ positions: new Map(pos), bbox: computeBbox(pos, ids) });
      }

      if (frame < 500 && maxDisp > 0.3) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        const finalPos = new Map(pos);
        setResult({ positions: finalPos, bbox: computeBbox(finalPos, ids) });
        prevPosRef.current = finalPos;
      }
    }

    rafRef.current = requestAnimationFrame(tick);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [nodes, edges]);

  return result;
}

function computeBbox(pos, ids) {
  if (!ids.length) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const id of ids) {
    const p = pos.get(id);
    if (!p) continue;
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY };
}

function fmtTime(ts) {
  if (!ts) return 'never';
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
}

function edgePath(x1, y1, x2, y2) {
  const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
  const dx = x2 - x1, dy = y2 - y1;
  const len = Math.sqrt(dx * dx + dy * dy) || 1;
  const curve = Math.min(len * 0.12, 25);
  return `M ${x1} ${y1} Q ${mx - (dy / len) * curve} ${my + (dx / len) * curve} ${x2} ${y2}`;
}

// Edge legend item
function LegendDot({ color, label }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, color: 'var(--text-muted)' }}>
      <svg width="20" height="8">
        <line x1="0" y1="4" x2="20" y2="4" stroke={color} strokeWidth="1.5" />
      </svg>
      {label}
    </div>
  );
}

function GraphPane({ snapshot, hotFiles, lastTouchedBy, selectedFilePath, onSelectFile, highlightedPath, projectPath, onProjectPathChange, extraEdges }) {
  const [filter, setFilter] = useState('');
  const [pathScanInfo, setPathScanInfo] = useState(null);
  const svgRef = useRef(null);
  const dragRef = useRef(null);
  const [isDragging, setIsDragging] = useState(false);
  const [viewBox, setViewBox] = useState(null); // null = auto-fit
  const userPannedRef = useRef(false);

  useEffect(() => {
    if (!projectPath?.trim()) { setPathScanInfo(null); return; }
    const t = setTimeout(() => {
      window.electron.memory.getPathScanInfo(projectPath.trim())
        .then((info) => setPathScanInfo(info))
        .catch(() => setPathScanInfo(null));
    }, 400);
    return () => clearTimeout(t);
  }, [projectPath]);

  // Keep pathScanInfo in sync after a scan completes
  useEffect(() => {
    if (!snapshot?.updatedAt || !projectPath?.trim()) return;
    window.electron.memory.getPathScanInfo(projectPath.trim())
      .then((info) => setPathScanInfo(info))
      .catch(() => {});
  }, [snapshot?.updatedAt]);

  const rawNodes = Array.isArray(snapshot?.nodes) ? snapshot.nodes : [];
  const nodes = useMemo(() =>
    rawNodes
      .filter((n) => !filter || n.filePath.toLowerCase().includes(filter.toLowerCase()))
      .sort((a, b) => (b.importance || 0) - (a.importance || 0))
      .slice(0, 250),
    [rawNodes, filter]);

  const nodeSet = useMemo(() => new Set(nodes.map((n) => n.filePath)), [nodes]);

  // Import edges come from snapshot; semantic edges come from extraEdges prop
  // Both filtered to visible nodes
  const edges = useMemo(() => {
    const importEdges = (snapshot?.edges || []).filter((e) => nodeSet.has(e.from) && nodeSet.has(e.to));
    const semEdges = (extraEdges || []).filter((e) => nodeSet.has(e.from) && nodeSet.has(e.to));
    // Deduplicate: import edges take priority over semantic for same pair
    const importSet = new Set(importEdges.map((e) => `${e.from}→${e.to}`));
    const unique = [...importEdges, ...semEdges.filter((e) => !importSet.has(`${e.from}→${e.to}`))];
    return unique.slice(0, 1500);
  }, [snapshot?.edges, extraEdges, nodeSet]);

  const { positions, bbox } = useForceSimulation(nodes, edges);

  // Auto-fit viewBox to bounding box when simulation settles (unless user has panned)
  useEffect(() => {
    if (!bbox || userPannedRef.current) return;
    const pad = 60;
    const w = Math.max(200, bbox.maxX - bbox.minX + pad * 2);
    const h = Math.max(150, bbox.maxY - bbox.minY + pad * 2);
    setViewBox({ x: bbox.minX - pad, y: bbox.minY - pad, w, h });
  }, [bbox]);

  const selectedNode = nodes.find((n) => n.filePath === selectedFilePath) || null;

  const onWheel = useCallback((e) => {
    e.preventDefault();
    userPannedRef.current = true;
    const scale = e.deltaY > 0 ? 1.12 : 0.89;
    setViewBox((vb) => {
      if (!vb) return vb;
      const svg = svgRef.current;
      if (!svg) return vb;
      const rect = svg.getBoundingClientRect();
      const mx = ((e.clientX - rect.left) / rect.width) * vb.w + vb.x;
      const my = ((e.clientY - rect.top) / rect.height) * vb.h + vb.y;
      return { x: mx - (mx - vb.x) * scale, y: my - (my - vb.y) * scale, w: vb.w * scale, h: vb.h * scale };
    });
  }, []);

  const onMouseDown = useCallback((e) => {
    if (e.button !== 0) return;
    dragRef.current = { startX: e.clientX, startY: e.clientY, vb: viewBox };
  }, [viewBox]);

  const onMouseMove = useCallback((e) => {
    if (!dragRef.current || !dragRef.current.vb) return;
    const moved = Math.abs(e.clientX - dragRef.current.startX) > 3 || Math.abs(e.clientY - dragRef.current.startY) > 3;
    if (moved) { setIsDragging(true); userPannedRef.current = true; }
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const { vb } = dragRef.current;
    const dx = ((dragRef.current.startX - e.clientX) / rect.width) * vb.w;
    const dy = ((dragRef.current.startY - e.clientY) / rect.height) * vb.h;
    const next = { ...vb, x: vb.x + dx, y: vb.y + dy };
    setViewBox(next);
    dragRef.current = { startX: e.clientX, startY: e.clientY, vb: next };
  }, []);

  const onMouseUp = useCallback(() => { dragRef.current = null; setIsDragging(false); }, []);

  const importEdgeCount = edges.filter((e) => e.type === 'import').length;
  const semEdgeCount = edges.filter((e) => e.type === 'semantic').length;

  const svgVB = viewBox ? `${viewBox.x} ${viewBox.y} ${viewBox.w} ${viewBox.h}` : '0 0 800 600';
  // Pixels per SVG unit — derived from viewBox width vs element width
  const svgEl = svgRef.current;
  const ppu = svgEl && viewBox ? svgEl.getBoundingClientRect().width / viewBox.w : 1;
  const showLabels = ppu > 0.45;

  return (
    <div className="codebase-graph-pane" style={{ display: 'flex', flexDirection: 'column' }}>
      <div className="sidepane-toolbar" style={{ flexShrink: 0, gap: 6 }}>
        <input className="field-input" value={projectPath}
          onChange={(e) => onProjectPathChange?.(e.target.value)}
          placeholder="Project path…" style={{ flex: 2, minWidth: 0 }} />
        <input className="field-input" value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter files…" style={{ flex: 1, minWidth: 0 }} />
        <span className="sidepane-meta" style={{ whiteSpace: 'nowrap' }}>
          {snapshot?.scanning ? 'Scanning…' : `${nodes.length} nodes`}
        </span>
      </div>
      {/* Path scan status */}
      {projectPath?.trim() && (
        <div style={{ padding: '2px 10px', fontSize: 10, color: 'var(--text-muted)', borderBottom: '1px solid var(--border)', flexShrink: 0, display: 'flex', gap: 8 }}>
          {pathScanInfo
            ? <><span>Last scanned {relativeTime(pathScanInfo.lastScannedAt)}</span><span>·</span><span>{pathScanInfo.fileCount} files</span><span>·</span><span>{pathScanInfo.vectorCount} vectors</span></>
            : <span>Not yet scanned — press R to scan</span>
          }
        </div>
      )}
      {/* Legend */}
      <div style={{ display: 'flex', gap: 12, padding: '3px 10px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
        <LegendDot color="rgba(100,180,255,0.8)" label={`imports (${importEdgeCount})`} />
        <LegendDot color="rgba(180,120,255,0.6)" label={`semantic (${semEdgeCount})`} />
        {!snapshot && !projectPath?.trim() && <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>Enter a project path and press R to scan.</span>}
      </div>
      {!!snapshot?.scanError && <div className="state-empty">{snapshot.scanError}</div>}

      <div style={{ flex: 1, minHeight: 0, position: 'relative' }}>
        <svg
          ref={svgRef}
          style={{ width: '100%', height: '100%', cursor: isDragging ? 'grabbing' : 'grab', display: 'block' }}
          viewBox={svgVB}
          onWheel={onWheel}
          onMouseDown={onMouseDown}
          onMouseMove={onMouseMove}
          onMouseUp={onMouseUp}
          onMouseLeave={onMouseUp}
        >
          <defs>
            <marker id="imp-arr" markerWidth="5" markerHeight="5" refX="4" refY="2.5" orient="auto">
              <path d="M0,0 L5,2.5 L0,5 Z" fill="rgba(100,180,255,0.7)" />
            </marker>
          </defs>

          {/* Edges — drawn before nodes so nodes sit on top */}
          <g>
            {edges.map((edge, i) => {
              const a = positions.get(edge.from), b = positions.get(edge.to);
              if (!a || !b) return null;
              const isActive = selectedFilePath && (edge.from === selectedFilePath || edge.to === selectedFilePath);
              const isImport = edge.type === 'import';
              return (
                <path
                  key={`e-${i}`}
                  d={edgePath(a.x, a.y, b.x, b.y)}
                  fill="none"
                  stroke={isActive ? '#56d364' : isImport ? 'rgba(100,180,255,0.55)' : 'rgba(180,120,255,0.3)'}
                  strokeWidth={isActive ? 1.8 : isImport ? 1.1 : 0.7}
                  strokeDasharray={edge.type === 'semantic' ? '3,3' : undefined}
                  markerEnd={isImport ? 'url(#imp-arr)' : undefined}
                />
              );
            })}
          </g>

          {/* Nodes */}
          <g>
            {nodes.map((node) => {
              const p = positions.get(node.filePath);
              if (!p) return null;
              const isSelected = node.filePath === selectedFilePath;
              const isHighlighted = node.filePath === highlightedPath;
              const isHot = hotFiles?.has(node.filePath);
              const imp = node.importance || 0;
              // Size by importance + importCount
              const r = Math.max(4, Math.min(16, 4 + imp * 0.10 + (node.importCount || 0) * 0.4));
              const hue = strHue(topDir(node.filePath));
              const fill = isSelected ? '#3fb950' : `hsl(${hue},${isHighlighted ? 70 : 52}%,${isHighlighted ? 68 : 44}%)`;
              const strokeCol = isSelected ? '#7ee787' : isHighlighted ? '#f0c040' : `hsl(${hue},60%,64%)`;
              const label = node.filePath.split('/').pop().replace(/\.[^.]+$/, '');

              return (
                <g key={node.filePath}
                  onClick={() => { if (!isDragging) onSelectFile?.(node.filePath); }}
                  style={{ cursor: 'pointer' }}
                >
                  {(isHot || isHighlighted) && (
                    <circle cx={p.x} cy={p.y} r={r + 5}
                      fill="none"
                      stroke={isHot ? 'rgba(240,136,62,0.35)' : 'rgba(240,192,64,0.35)'}
                      strokeWidth={2}
                    />
                  )}
                  <circle
                    cx={p.x} cy={p.y} r={r}
                    fill={fill}
                    stroke={strokeCol}
                    strokeWidth={isSelected ? 2 : 1}
                    className={isHot ? 'dep-node hot' : undefined}
                  />
                  {showLabels && (
                    <text
                      x={p.x} y={p.y + r + 9}
                      textAnchor="middle"
                      fontSize={Math.max(7, Math.min(10, r * 0.9))}
                      fill={isSelected ? '#7ee787' : 'rgba(170,195,220,0.9)'}
                      style={{ pointerEvents: 'none', userSelect: 'none' }}
                    >
                      {label}
                    </text>
                  )}
                </g>
              );
            })}
          </g>
        </svg>

        {selectedNode && (
          <div className="codebase-detail-pane" style={{ position: 'absolute', top: 0, right: 0, bottom: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 6 }}>
              <div className="sidepane-file" style={{ flex: 1, minWidth: 0 }}>{selectedNode.filePath}</div>
              <button className="manager-hide-btn" onClick={() => onSelectFile?.(null)} title="Close">✕</button>
            </div>
            <div className="sidepane-kv"><span>Summary</span><span>{selectedNode.summary || 'No summary'}</span></div>
            <div className="sidepane-kv"><span>Importance</span><span>{(selectedNode.importance || 0).toFixed(1)}</span></div>
            <div className="sidepane-kv"><span>Imports</span><span>{selectedNode.importCount || 0}</span></div>
            <div className="sidepane-kv"><span>Vectors</span><span>{selectedNode.vectorCount || 0}</span></div>
            <div className="sidepane-kv"><span>Last touched</span><span>{fmtTime(snapshot?.touches?.[selectedNode.filePath])}</span></div>
            <div className="sidepane-kv"><span>Last by</span><span>{lastTouchedBy?.[selectedNode.filePath] || 'n/a'}</span></div>
          </div>
        )}
      </div>
    </div>
  );
}

// --- Main panel ---

export default function CodebasePanel({
  snapshot,
  hotFiles,
  lastTouchedBy,
  selectedFilePath,
  onSelectFile,
  onRefresh,
  onHide,
  onOpenResult,
}) {
  const [highlightedPath, setHighlightedPath] = useState(null);
  const [projectPath, setProjectPath] = useState(snapshot?.projectPath || '');
  const [semanticEdges, setSemanticEdges] = useState([]);

  useEffect(() => { setProjectPath(snapshot?.projectPath || ''); }, [snapshot?.projectPath]);

  // Load semantic edges once on mount and after each scan
  useEffect(() => {
    if (!snapshot) return;
    window.electron.memory.getGraphEdges().then((edges) => {
      if (Array.isArray(edges)) setSemanticEdges(edges);
    }).catch(() => {});
  }, [snapshot?.updatedAt]);

  const handleRefresh = useCallback(() => {
    const path = projectPath || snapshot?.projectPath || '';
    if (!String(path).trim()) return;
    onRefresh?.(String(path).trim());
  }, [projectPath, snapshot?.projectPath, onRefresh]);

  return (
    <div className="codebase-panel">
      <div className="codebase-header">
        <span className="codebase-title">Codebase</span>
        <div className="git-header-actions">
          <button className="manager-hide-btn" onClick={handleRefresh}
            title={snapshot?.scanning ? 'Scanning…' : 'Scan / Refresh'}
            disabled={snapshot?.scanning}>
            {snapshot?.scanning ? '…' : 'R'}
          </button>
          <button className="manager-hide-btn" onClick={onHide} title="Close">✕</button>
        </div>
      </div>
      <div className="codebase-body">
        <SearchPane onHighlight={setHighlightedPath} onOpenResult={onOpenResult} />
        <GraphPane
          snapshot={snapshot}
          hotFiles={hotFiles}
          lastTouchedBy={lastTouchedBy}
          selectedFilePath={selectedFilePath}
          onSelectFile={onSelectFile}
          highlightedPath={highlightedPath}
          projectPath={projectPath}
          onProjectPathChange={setProjectPath}
          extraEdges={semanticEdges}
        />
      </div>
    </div>
  );
}
