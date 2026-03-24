import React, { useMemo, useState } from 'react';

function fmtTime(ts) {
  if (!ts) return '';
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
}

export default function SmartStderrPanel({
  visible,
  onHide,
  onFocus,
  entriesByTerminal,
  onDraftPrompt,
  onSummarizeOutput,
  terminalSummaries,
}) {
  const [expanded, setExpanded] = useState(() => new Set());

  const grouped = useMemo(() => {
    const map = entriesByTerminal && typeof entriesByTerminal === 'object' ? entriesByTerminal : {};
    return Object.entries(map)
      .map(([terminalId, items]) => ({
        terminalId,
        items: Array.isArray(items) ? items.slice().sort((a, b) => Number(b.timestamp || 0) - Number(a.timestamp || 0)) : [],
      }))
      .filter((group) => group.items.length > 0)
      .sort((a, b) => Number(b.items[0]?.timestamp || 0) - Number(a.items[0]?.timestamp || 0));
  }, [entriesByTerminal]);

  const toggleExpanded = (id) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  if (!visible) return <div className="manager-sidebar hidden" />;

  return (
    <div className="manager-sidebar sidepane-stderr" onClick={onFocus}>
      <div className="manager-header">
        <span className="manager-title">Smart Stderr</span>
        <button className="manager-hide-btn" onClick={(e) => { e.stopPropagation(); onHide?.(); }} title="Hide">‹</button>
      </div>
      <div className="stderr-list">
        {grouped.length === 0 && <div className="state-empty">No classified stderr entries yet.</div>}
        {grouped.map((group) => (
          <div key={group.terminalId} className="stderr-group">
            <div className="stderr-group-title">Terminal {group.terminalId}</div>
            {group.items.map((entry) => {
              const isOpen = expanded.has(entry.id);
              return (
                <div key={entry.id} className={`stderr-item${isOpen ? ' open' : ''}`}>
                  <div className="stderr-item-head-row">
                    <button className="stderr-item-head" onClick={() => toggleExpanded(entry.id)}>
                      <span className={`stderr-badge stderr-${String(entry.type || 'UNKNOWN').toLowerCase()}`}>{entry.type || 'UNKNOWN'}</span>
                      <span className="stderr-first-line" title={entry.firstLine || ''}>{entry.firstLine || '(empty stderr chunk)'}</span>
                      <span className="stderr-ts">{fmtTime(entry.timestamp)}</span>
                    </button>
                    {onSummarizeOutput && (
                      <button
                        className="stderr-summarize-btn"
                        title="Summarise this error"
                        disabled={terminalSummaries?.[entry.terminalId]?.status === 'running'}
                        onClick={(e) => { e.stopPropagation(); onSummarizeOutput(entry.terminalId, entry.raw); }}
                      >
                        {terminalSummaries?.[entry.terminalId]?.status === 'running' ? '…' : '∑'}
                      </button>
                    )}
                  </div>
                  {isOpen && (
                    <div className="stderr-body">
                      <div className="stderr-meta">
                        <span>cwd: {entry.cwd || '-'}</span>
                        <button className="manager-icon-btn" onClick={() => onDraftPrompt?.(entry)}>Draft fix prompt ↵</button>
                      </div>
                      <div className="stderr-kv"><span>Likely cause</span><span>{entry.cause || '-'}</span></div>
                      <div className="stderr-kv"><span>Suggested fix</span><span>{entry.fix || '-'}</span></div>
                      {Array.isArray(entry.stackFrames) && entry.stackFrames.length > 0 && (
                        <div className="stderr-frames">
                          {entry.stackFrames.map((frame, idx) => (
                            <div key={`${entry.id}-frame-${idx}`} className="stderr-frame">
                              {frame.file}:{frame.line}{frame.column ? `:${frame.column}` : ''}{frame.method ? ` (${frame.method})` : ''}
                            </div>
                          ))}
                        </div>
                      )}
                      <pre className="stderr-raw">{entry.raw || ''}</pre>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
