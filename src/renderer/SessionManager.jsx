import React, { useMemo, useState, useRef } from 'react';

function timeAgo(ts) {
  if (!ts) return 'unknown';
  const deltaSec = Math.max(1, Math.floor((Date.now() - Number(ts)) / 1000));
  if (deltaSec < 60) return `${deltaSec}s ago`;
  if (deltaSec < 3600) return `${Math.floor(deltaSec / 60)}m ago`;
  if (deltaSec < 86400) return `${Math.floor(deltaSec / 3600)}h ago`;
  return `${Math.floor(deltaSec / 86400)}d ago`;
}

function toolClass(tool) {
  if (tool === 'claude') return 'session-tool claude';
  if (tool === 'codex') return 'session-tool codex';
  return 'session-tool other';
}

function AddSessionPopup({ onAdd, onClose }) {
  const [label, setLabel] = useState('');
  const [tool, setTool] = useState('claude');
  const [sessionId, setSessionId] = useState('');
  const [cwd, setCwd] = useState('');

  const submit = () => {
    const trimLabel = label.trim();
    const trimId = sessionId.trim();
    if (!trimLabel || !trimId) return;
    onAdd({ label: trimLabel, tool, sessionId: trimId, cwd: cwd.trim() });
  };

  const onKeyDown = (e) => {
    if (e.key === 'Enter') submit();
    if (e.key === 'Escape') onClose();
    e.stopPropagation();
  };

  return (
    <div className="session-add-popup" onKeyDown={onKeyDown}>
      <div className="session-add-popup-header">
        <span>Add Session</span>
        <button className="manager-hide-btn" onClick={onClose}>✕</button>
      </div>
      <div className="session-add-popup-body">
        <label className="session-add-label">Name</label>
        <input
          className="session-add-input"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="My Claude session"
          autoFocus
        />
        <label className="session-add-label">Tool</label>
        <select
          className="session-add-input"
          value={tool}
          onChange={(e) => setTool(e.target.value)}
        >
          <option value="claude">claude</option>
          <option value="codex">codex</option>
        </select>
        <label className="session-add-label">Session ID</label>
        <input
          className="session-add-input"
          value={sessionId}
          onChange={(e) => setSessionId(e.target.value)}
          placeholder="abc-def-123 or UUID"
        />
        <label className="session-add-label">Working directory (optional)</label>
        <input
          className="session-add-input"
          value={cwd}
          onChange={(e) => setCwd(e.target.value)}
          placeholder="/path/to/project"
        />
      </div>
      <div className="session-add-popup-footer">
        <button className="manager-hide-btn" onClick={onClose}>Cancel</button>
        <button
          className="manager-add-submit"
          onClick={submit}
          disabled={!label.trim() || !sessionId.trim()}
        >Add</button>
      </div>
    </div>
  );
}

function SessionRow({ session, onOpen, onPinToggle, onRemove, onRename, onToggleMcp }) {
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState('');
  const inputRef = useRef(null);

  const startRename = () => {
    setRenameValue(session.label);
    setRenaming(true);
    setTimeout(() => inputRef.current?.select(), 0);
  };

  const confirmRename = () => {
    const trimmed = renameValue.trim();
    if (trimmed && trimmed !== session.label) onRename?.(session.id, trimmed);
    setRenaming(false);
  };

  const onKeyDown = (e) => {
    if (e.key === 'Enter') confirmRename();
    if (e.key === 'Escape') setRenaming(false);
    e.stopPropagation();
  };

  return (
    <div className="session-row">
      <div className="session-row-main">
        {renaming ? (
          <input
            ref={inputRef}
            className="session-rename-input"
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onBlur={confirmRename}
            onKeyDown={onKeyDown}
            autoFocus
          />
        ) : (
          <button
            className="session-open-btn"
            onClick={() => onOpen(session)}
            title={session.command}
          >
            {session.claudeSessionId && (
              <span className="session-resume-dot" title="Has session ID — will resume">▶</span>
            )}
            {session.label}
          </button>
        )}
        <div className="session-row-meta">
          <span className={toolClass(session.tool)}>{session.tool}</span>
          <span className="session-meta-item">{session.cwd || 'default cwd'}</span>
          <span className="session-meta-item">uses {session.useCount || 1}</span>
          <span className="session-meta-item">{timeAgo(session.lastUsedAt)}</span>
        </div>
      </div>
      <div className="session-row-actions">
        <button className="manager-icon-btn" onClick={() => onOpen(session)} title="Run in focused terminal">Run</button>
        <button
          className={`manager-icon-btn${session.useMcp ? ' active' : ''}`}
          onClick={() => onToggleMcp?.(session)}
          title={session.useMcp ? 'MCP enabled — click to disable' : 'MCP disabled — click to enable'}
        >MCP</button>
        <button className="manager-icon-btn" onClick={startRename} title="Rename session">Ren</button>
        <button className="manager-icon-btn" onClick={() => onPinToggle(session)} title={session.pinned ? 'Unpin' : 'Pin'}>
          {session.pinned ? 'Unpin' : 'Pin'}
        </button>
        <button className="manager-icon-btn danger" onClick={() => onRemove(session)} title="Remove session">Del</button>
      </div>
    </div>
  );
}

export default function SessionManager({
  visible,
  sessions,
  onHide,
  onFocus,
  onOpen,
  onPinToggle,
  onRemove,
  onRename,
  onAdd,
  onToggleMcp,
}) {
  const [showAddPopup, setShowAddPopup] = useState(false);

  const { pinned, recent } = useMemo(() => {
    const pins = sessions.filter((s) => s.pinned);
    const rest = sessions.filter((s) => !s.pinned);
    return { pinned: pins, recent: rest };
  }, [sessions]);

  const handleAdd = (data) => {
    onAdd?.(data);
    setShowAddPopup(false);
  };

  if (!visible) return <div className="session-sidebar hidden" />;

  return (
    <div className="session-sidebar" onClick={onFocus}>
      <div className="session-header">
        <span className="session-title">Session Manager</span>
        <div className="session-header-actions">
          <button
            className="manager-hide-btn"
            onClick={(e) => { e.stopPropagation(); setShowAddPopup((v) => !v); }}
            title="Add session by ID"
          >+</button>
          <button className="manager-hide-btn" onClick={(e) => { e.stopPropagation(); onHide?.(); }} title="Hide session manager">‹</button>
        </div>
      </div>

      {showAddPopup && (
        <AddSessionPopup
          onAdd={handleAdd}
          onClose={() => setShowAddPopup(false)}
        />
      )}

      <div className="session-body">
        {pinned.length > 0 && (
          <div className="manager-group">
            <div className="manager-group-title active">Pinned</div>
            {pinned.map((session) => (
              <SessionRow
                key={session.id}
                session={session}
                onOpen={onOpen}
                onPinToggle={onPinToggle}
                onRemove={onRemove}
                onRename={onRename}
                onToggleMcp={onToggleMcp}
              />
            ))}
          </div>
        )}
        <div className="manager-group">
          <div className="manager-group-title">Recent</div>
          {recent.length === 0 && <div className="state-empty">No session references yet.</div>}
          {recent.map((session) => (
            <SessionRow
              key={session.id}
              session={session}
              onOpen={onOpen}
              onPinToggle={onPinToggle}
              onRemove={onRemove}
              onRename={onRename}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
