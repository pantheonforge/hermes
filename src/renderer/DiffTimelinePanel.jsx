import React, { useState, useEffect, useRef, useCallback } from 'react';

function formatTime(ts) {
  return new Date(ts).toLocaleTimeString('en', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function formatDateTime(ts) {
  return new Date(ts).toLocaleString('en', {
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

export default function DiffTimelinePanel({ visible, port, token, onHide, onFocus }) {
  const [diffTimeline, setDiffTimeline] = useState([]);
  const [activeDiffId, setActiveDiffId] = useState(null);
  const [connected, setConnected] = useState(false);
  const esRef = useRef(null);

  const connect = useCallback(() => {
    if (esRef.current) esRef.current.close();
    const es = new EventSource(`http://localhost:${port}/events?token=${encodeURIComponent(token || '')}`);
    esRef.current = es;

    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false);
    es.onmessage = (e) => {
      try {
        const payload = JSON.parse(e.data);
        const { type, data } = payload;
        if (type === 'snapshot') {
          const timeline = Array.isArray(data.diffTimeline) ? data.diffTimeline : [];
          const newest = timeline.length > 0 ? timeline[timeline.length - 1].id : null;
          setDiffTimeline([...timeline].reverse());
          setActiveDiffId((prev) => prev || newest);
          return;
        }
        if (type === 'diff_timeline') {
          setDiffTimeline((prev) => [data, ...prev].slice(0, 1000));
          setActiveDiffId((prev) => prev || data.id);
        }
      } catch { }
    };
  }, [port]);

  useEffect(() => {
    connect();
    return () => esRef.current?.close();
  }, [connect]);

  if (!visible) return <div className="monitor-panel hidden" />;

  const activeDiff = diffTimeline.find((entry) => entry.id === activeDiffId) || diffTimeline[0] || null;

  return (
    <div className="monitor-panel" onClick={onFocus}>
      <div className="monitor-header">
        <div className="monitor-dot" style={!connected ? { background: 'var(--red)', boxShadow: '0 0 4px var(--red)' } : {}} />
        <span className="title">Diff Timeline</span>
        <span style={{ fontSize: 9, color: 'var(--text-dim)' }}>:{port}</span>
        <button className="monitor-hide-btn" onClick={(e) => { e.stopPropagation(); onHide?.(); }} title="Hide panel">‹</button>
      </div>

      <div className="diff-body">
        <div className="diff-timeline-rail">
          {diffTimeline.length === 0 && <div className="state-empty">No write diffs in this session</div>}
          {diffTimeline.map((entry) => {
            const selected = entry.id === (activeDiff?.id || '');
            return (
              <button
                key={entry.id}
                className={`diff-timeline-item${selected ? ' active' : ''}`}
                onClick={() => setActiveDiffId(entry.id)}
                title={entry.file_path}
              >
                <div className="diff-timeline-dot" />
                <div className="diff-timeline-main">
                  <div className="diff-timeline-file">{entry.file_path}</div>
                  <div className="diff-timeline-meta">
                    <span>{entry.agent_id || 'unknown'}</span>
                    <span>{formatTime(entry.timestamp)}</span>
                    <span className="diff-plus">+{entry.lines_added || 0}</span>
                    <span className="diff-minus">-{entry.lines_removed || 0}</span>
                  </div>
                </div>
              </button>
            );
          })}
        </div>

        <div className="diff-detail">
          {!activeDiff && <div className="state-empty">Select a change to inspect</div>}
          {activeDiff && (
            <>
              <div className="diff-detail-header">
                <div className="diff-detail-file">{activeDiff.file_path}</div>
                <div className="diff-detail-meta">
                  <span>{activeDiff.agent_id || 'unknown'}</span>
                  <span>{formatDateTime(activeDiff.timestamp)}</span>
                  <span>{activeDiff.tool_name || activeDiff.op || 'write'}</span>
                  <span className="diff-plus">+{activeDiff.lines_added || 0}</span>
                  <span className="diff-minus">-{activeDiff.lines_removed || 0}</span>
                </div>
              </div>
              <div className="diff-reasoning">
                <div className="diff-section-title">Reasoning</div>
                <pre>{activeDiff.reasoning || 'No reasoning attached.'}</pre>
              </div>
              <div className="diff-lines">
                <div className="diff-section-title">Diff</div>
                {Array.isArray(activeDiff.diff_lines) && activeDiff.diff_lines.length > 0 ? (
                  <div className="diff-lines-list">
                    {activeDiff.diff_lines.map((line, idx) => (
                      <div key={`${activeDiff.id}:${idx}`} className={`diff-line ${line.type === 'add' ? 'add' : 'remove'}`}>
                        <span className="diff-line-prefix">{line.type === 'add' ? '+' : '-'}</span>
                        <span className="diff-line-number">{line.line || ''}</span>
                        <code>{line.text}</code>
                      </div>
                    ))}
                    {activeDiff.truncated && <div className="state-empty">Diff truncated for very large edits.</div>}
                  </div>
                ) : (
                  <div className="state-empty">No line-level diff provided.</div>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {!connected && (
        <div className="monitor-controls">
          <button className="btn" onClick={connect}>Reconnect</button>
        </div>
      )}
    </div>
  );
}
