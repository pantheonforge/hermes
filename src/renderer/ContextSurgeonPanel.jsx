import React, { useState, useEffect, useCallback } from 'react';

const CHUNK_COLORS = {
  summary: '#f5a623',
  user_text: '#37d676',
  assistant_text: '#5b9cf6',
  tool_use: '#a78bfa',
  file_read: '#34d399',
  tool_result: '#64748b',
};

const CHUNK_LABELS = {
  summary: 'Summary',
  user_text: 'User',
  assistant_text: 'Assistant',
  tool_use: 'Tool',
  file_read: 'File read',
  tool_result: 'Result',
};

function formatTokens(n) {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

function formatAge(mtime) {
  const diff = Math.floor((Date.now() - mtime) / 60000);
  if (diff < 60) return `${diff}m ago`;
  const h = Math.floor(diff / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function getProjectLabel(session) {
  if (session.firstUserText) return session.firstUserText;
  if (session.cwd) {
    const parts = session.cwd.replace(/\\/g, '/').split('/').filter(Boolean);
    return parts[parts.length - 1] || session.cwd;
  }
  // Fall back to last segment of encoded dir name
  const segs = session.projectDir.split('-').filter(Boolean);
  return segs[segs.length - 1] || session.fileName.replace('.jsonl', '');
}

function getProjectSub(session) {
  if (!session.cwd) return null;
  const parts = session.cwd.replace(/\\/g, '/').split('/').filter(Boolean);
  return parts[parts.length - 1] || null;
}

export default function ContextSurgeonPanel({ onHide, onFocus }) {
  const [sessions, setSessions] = useState([]);
  const [selectedPath, setSelectedPath] = useState(null);
  const [chunks, setChunks] = useState([]);
  const [totalTokens, setTotalTokens] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [expandedIdx, setExpandedIdx] = useState(null);

  useEffect(() => {
    window.electron.context.listSessions().then((result) => {
      if (result.ok && result.sessions.length > 0) {
        setSessions(result.sessions);
        setSelectedPath(result.sessions[0].filePath);
      }
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (!selectedPath) return;
    setLoading(true);
    setError(null);
    setChunks([]);
    setExpandedIdx(null);
    window.electron.context.loadSession(selectedPath).then((result) => {
      setLoading(false);
      if (result.ok) {
        setChunks(result.chunks);
        setTotalTokens(result.totalTokens);
      } else {
        setError(result.error || 'Failed to load session');
      }
    }).catch((err) => {
      setLoading(false);
      setError(String(err?.message || 'Error'));
    });
  }, [selectedPath]);

  const toggleChunk = useCallback((i) => {
    setExpandedIdx((prev) => (prev === i ? null : i));
  }, []);

  return (
    <div className="cs-panel" onClick={onFocus}>
      <div className="cs-header">
        <button className="monitor-hide-btn" onClick={onHide} title="Hide panel">‹</button>
        <span className="title">Context Surgeon</span>
      </div>

      {sessions.length === 0 ? (
        <div className="cs-empty">No sessions found in ~/.claude/projects/</div>
      ) : (
        <>
          <div className="cs-session-list">
            {sessions.map((s) => (
              <button
                key={s.filePath}
                className={`cs-session-btn${selectedPath === s.filePath ? ' active' : ''}`}
                onClick={() => setSelectedPath(s.filePath)}
                title={s.filePath}
              >
                <div className="cs-session-info">
                  <span className="cs-session-name">{getProjectLabel(s)}</span>
                  {s.firstUserText && s.cwd && (
                    <span className="cs-session-sub">{getProjectSub(s)}</span>
                  )}
                </div>
                <span className="cs-session-age">{formatAge(s.mtime)}</span>
              </button>
            ))}
          </div>

          {loading && <div className="cs-loading">Parsing…</div>}
          {error && <div className="cs-error">{error}</div>}

          {!loading && chunks.length > 0 && (
            <>
              <div className="cs-total-bar">
                <span className="cs-total-label">~{formatTokens(totalTokens)} tokens total</span>
                <div className="cs-total-segments">
                  {chunks.map((chunk, i) => (
                    <div
                      key={i}
                      className="cs-segment"
                      style={{
                        width: `${Math.max(0.5, (chunk.tokens / totalTokens) * 100)}%`,
                        background: CHUNK_COLORS[chunk.type] || '#555',
                      }}
                      title={`${CHUNK_LABELS[chunk.type] || chunk.type}: ${formatTokens(chunk.tokens)}`}
                    />
                  ))}
                </div>
              </div>

              {totalTokens > 80000 && (
                <div className="cs-advice">
                  ~{formatTokens(totalTokens)} tokens — run <code>/compact</code> or start a new session.
                </div>
              )}

              <div className="cs-chunk-list">
                {chunks.map((chunk, i) => (
                  <button
                    key={i}
                    className={`cs-chunk-row${expandedIdx === i ? ' expanded' : ''}`}
                    onClick={() => toggleChunk(i)}
                  >
                    <div className="cs-chunk-top">
                      <span
                        className="cs-chunk-badge"
                        style={{ background: CHUNK_COLORS[chunk.type] || '#555' }}
                      >
                        {CHUNK_LABELS[chunk.type] || chunk.type}
                        {chunk.count > 1 ? ` ×${chunk.count}` : ''}
                      </span>
                      <div className="cs-chunk-bar-wrap">
                        <div
                          className="cs-chunk-bar"
                          style={{
                            width: `${Math.max(1, (chunk.tokens / totalTokens) * 100)}%`,
                            background: CHUNK_COLORS[chunk.type] || '#555',
                          }}
                        />
                      </div>
                      <span className="cs-chunk-tokens">{formatTokens(chunk.tokens)}</span>
                    </div>
                    {expandedIdx === i && (
                      <div className="cs-chunk-detail">
                        <pre className="cs-chunk-preview">{chunk.preview}</pre>
                      </div>
                    )}
                  </button>
                ))}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
