import React, { useMemo, useState, useCallback, useRef } from 'react';

const STORAGE_KEY = 'hermes:prompt-drafts';

function formatDate(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
    + ' ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

export { STORAGE_KEY as DRAFTS_STORAGE_KEY };

function DraftItem({ d, onOpen, onDelete, onRename }) {
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState('');
  const inputRef = useRef(null);

  const startRename = (e) => {
    e.stopPropagation();
    setRenameValue(d.name);
    setRenaming(true);
    setTimeout(() => inputRef.current?.select(), 0);
  };

  const confirmRename = () => {
    const trimmed = renameValue.trim();
    if (trimmed && trimmed !== d.name) onRename?.(d.id, trimmed);
    setRenaming(false);
  };

  const onKeyDown = (e) => {
    if (e.key === 'Enter') confirmRename();
    if (e.key === 'Escape') setRenaming(false);
    e.stopPropagation();
  };

  return (
    <div className="pd-item" onClick={() => !renaming && onOpen?.(d)}>
      {renaming ? (
        <input
          ref={inputRef}
          className="pd-rename-input"
          value={renameValue}
          onChange={(e) => setRenameValue(e.target.value)}
          onBlur={confirmRename}
          onKeyDown={onKeyDown}
          autoFocus
          onClick={(e) => e.stopPropagation()}
        />
      ) : (
        <span className="pd-item-name" title={d.name}>{d.name}</span>
      )}
      <div className="pd-item-meta">
        <span className="pd-date">{formatDate(d.updatedAt)}</span>
        <button
          className="pd-delete-btn"
          onClick={startRename}
          title="Rename"
        >✎</button>
        <button
          className="pd-delete-btn"
          onClick={(e) => { e.stopPropagation(); onDelete?.(d.id); }}
          title="Delete"
        >x</button>
      </div>
    </div>
  );
}

export default function PromptDraftsPanel({ onHide, onFocus, onOpen, onDelete, onRename, drafts = [] }) {
  const [search, setSearch] = useState('');
  const [projectFilter, setProjectFilter] = useState('all');
  const [groupByProject, setGroupByProject] = useState(true);

  const projects = useMemo(() => {
    const set = new Set();
    for (const draft of drafts) {
      const project = String(draft?.project || '').trim();
      if (project) set.add(project);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [drafts]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return drafts.filter((draft) => {
      if (projectFilter !== 'all' && (draft.project || '') !== projectFilter) return false;
      if (!q) return true;
      return String(draft.name || '').toLowerCase().includes(q)
        || String(draft.project || '').toLowerCase().includes(q)
        || String(draft.content || '').toLowerCase().includes(q);
    });
  }, [drafts, projectFilter, search]);

  const grouped = useMemo(() => {
    const map = new Map();
    for (const draft of filtered) {
      const key = String(draft.project || '').trim() || 'Unassigned';
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(draft);
    }
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [filtered]);

  const renderItem = useCallback((d) => (
    <DraftItem key={d.id} d={d} onOpen={onOpen} onDelete={onDelete} onRename={onRename} />
  ), [onOpen, onDelete, onRename]);

  return (
    <div className="pd-panel" onClick={onFocus}>
      <div className="pd-header">
        <button className="monitor-hide-btn" onClick={onHide} title="Hide panel">‹</button>
        <span className="title">Prompt Drafts</span>
      </div>
      <div className="pd-body">
        <div className="pd-toolbar">
          <span className="pd-toolbar-title">Drafts ({filtered.length})</span>
          <button className={`btn-mini${groupByProject ? ' active' : ''}`} onClick={() => setGroupByProject((v) => !v)}>
            Group
          </button>
        </div>
        <div className="pd-filters">
          <input
            className="pd-filter-input"
            placeholder="Search drafts or project..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <select className="pd-filter-select" value={projectFilter} onChange={(e) => setProjectFilter(e.target.value)}>
            <option value="all">All projects</option>
            {projects.map((project) => (
              <option key={project} value={project}>{project}</option>
            ))}
          </select>
        </div>
        <div className="pd-list">
          {filtered.length === 0 && (
            <div className="pd-empty">No drafts yet. Save from the editor.</div>
          )}
          {!groupByProject && filtered.map(renderItem)}
          {groupByProject && grouped.map(([project, items]) => (
            <div key={project}>
              <div className="pd-group-title">{project}</div>
              {items.map(renderItem)}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
