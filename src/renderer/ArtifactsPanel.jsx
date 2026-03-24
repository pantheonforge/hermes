import React, { useState, useEffect, useRef, useCallback } from 'react';

const CODE_EXTS = new Set(['js', 'jsx', 'ts', 'tsx', 'py', 'go', 'rs', 'java', 'c', 'cpp', 'h', 'hpp', 'sh', 'ps1', 'rb', 'php', 'swift', 'kt', 'sql', 'yaml', 'yml', 'toml', 'ini', 'css', 'scss', 'html', 'xml']);

function formatTime(ts) {
  return new Date(ts).toLocaleTimeString('en', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function extensionOf(filename) {
  const file = String(filename || '').trim().toLowerCase();
  const i = file.lastIndexOf('.');
  if (i < 0 || i === file.length - 1) return '';
  return file.slice(i + 1);
}

function inferPreviewKind(artifact) {
  const ext = extensionOf(artifact.filename);
  const mime = String(artifact.mime_type || '').toLowerCase();
  if (mime.includes('markdown') || ext === 'md' || ext === 'markdown') return 'markdown';
  if (mime.includes('json') || ext === 'json') return 'json';
  if (mime.startsWith('text/') || CODE_EXTS.has(ext)) return 'code';
  return 'raw';
}

function fileTypeIcon(filename) {
  const ext = extensionOf(filename);
  if (ext === 'md' || ext === 'markdown') return 'M';
  if (ext === 'json') return '{}';
  if (CODE_EXTS.has(ext)) return '</>';
  if (ext === 'txt' || ext === 'log') return 'T';
  return 'F';
}

function escapeHtml(input) {
  return String(input)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

function highlightCode(text) {
  let html = escapeHtml(text);
  html = html.replace(/("(?:[^"\\]|\\.)*")/g, '<span class="tok-str">$1</span>');
  html = html.replace(/('(?:[^'\\]|\\.)*')/g, '<span class="tok-str">$1</span>');
  html = html.replace(/\b(true|false|null|undefined|return|const|let|var|function|class|if|else|for|while|switch|case|break|continue|import|export|async|await|try|catch|throw|new)\b/g, '<span class="tok-kw">$1</span>');
  html = html.replace(/\b(\d+(?:\.\d+)?)\b/g, '<span class="tok-num">$1</span>');
  return html;
}

function MarkdownView({ content }) {
  const lines = String(content || '').split(/\r?\n/);
  return (
    <div className="artifact-markdown">
      {lines.map((line, idx) => {
        if (line.startsWith('### ')) return <h3 key={idx}>{line.slice(4)}</h3>;
        if (line.startsWith('## ')) return <h2 key={idx}>{line.slice(3)}</h2>;
        if (line.startsWith('# ')) return <h1 key={idx}>{line.slice(2)}</h1>;
        if (line.startsWith('- ')) return <li key={idx}>{line.slice(2)}</li>;
        if (!line.trim()) return <div key={idx} style={{ height: 6 }} />;
        return <p key={idx}>{line}</p>;
      })}
    </div>
  );
}

function JsonNode({ value, name, depth }) {
  if (value === null || typeof value !== 'object') {
    return (
      <div className="artifact-json-row">
        {name !== undefined && <span className="artifact-json-key">{name}: </span>}
        <span className="artifact-json-primitive">{JSON.stringify(value)}</span>
      </div>
    );
  }
  const entries = Array.isArray(value)
    ? value.map((v, i) => [String(i), v])
    : Object.entries(value);
  const label = Array.isArray(value) ? `[${entries.length}]` : `{${entries.length}}`;
  return (
    <details className="artifact-json-node" open={depth < 1}>
      <summary>
        {name !== undefined && <span className="artifact-json-key">{name}: </span>}
        <span className="artifact-json-branch">{label}</span>
      </summary>
      <div className="artifact-json-children">
        {entries.map(([k, v]) => <JsonNode key={k} value={v} name={k} depth={depth + 1} />)}
      </div>
    </details>
  );
}

export default function ArtifactsPanel({ visible, port, token, onHide, onFocus }) {
  const [artifacts, setArtifacts] = useState([]);
  const [activeArtifactId, setActiveArtifactId] = useState(null);
  const [connected, setConnected] = useState(false);
  const esRef = useRef(null);

  const connect = useCallback(() => {
    if (esRef.current) esRef.current.close();
    const es = new EventSource(`http://localhost:${port}/events?token=${encodeURIComponent(token || '')}`);
    esRef.current = es;

    es.onopen = () => setConnected(true);
    es.onerror = () => { es.close(); setConnected(false); setTimeout(() => connect(), 3000); };
    es.onmessage = (e) => {
      try {
        const payload = JSON.parse(e.data);
        if (payload?.type === 'artifact' && payload?.data?.agent_id !== undefined) {
          const artifact = payload.data;
          setArtifacts((prev) => [artifact, ...prev].slice(0, 1000));
          setActiveArtifactId((prev) => prev || `${artifact.timestamp}:${artifact.agent_id}:${artifact.filename}`);
          return;
        }
        if (payload?.type === 'snapshot') {
          const next = Array.isArray(payload?.data?.artifacts) ? payload.data.artifacts : [];
          const ordered = [...next].sort((a, b) => Number(b.timestamp || 0) - Number(a.timestamp || 0));
          setArtifacts(ordered);
          if (ordered.length > 0) {
            const top = ordered[0];
            setActiveArtifactId((prev) => prev || `${top.timestamp}:${top.agent_id}:${top.filename}`);
          } else {
            setActiveArtifactId(null);
          }
        }
      } catch { }
    };
  }, [port, token]);

  useEffect(() => {
    connect();
    return () => esRef.current?.close();
  }, [connect]);

  const copyArtifact = useCallback(async (artifact) => {
    if (!artifact) return;
    await window.electron.artifacts.copy(artifact.content);
  }, []);

  const saveArtifact = useCallback(async (artifact) => {
    if (!artifact) return;
    await window.electron.artifacts.saveAs(artifact);
  }, []);

  if (!visible) return <div className="monitor-panel hidden" />;

  const activeArtifact = artifacts.find((a) => `${a.timestamp}:${a.agent_id}:${a.filename}` === activeArtifactId) || artifacts[0] || null;
  const activeKind = activeArtifact ? inferPreviewKind(activeArtifact) : 'raw';

  return (
    <div className="monitor-panel" onClick={onFocus}>
      <div className="monitor-header">
        <div className="monitor-dot" style={!connected ? { background: 'var(--red)', boxShadow: '0 0 4px var(--red)' } : {}} />
        <span className="title">Artifacts</span>
        <span style={{ fontSize: 9, color: 'var(--text-dim)' }}>:{port}</span>
        <button className="monitor-hide-btn" onClick={(e) => { e.stopPropagation(); onHide?.(); }} title="Hide panel">‹</button>
      </div>

      <div className="artifact-body">
        <div className="artifact-list">
          {artifacts.length === 0 && <div className="state-empty">No artifacts submitted</div>}
          {artifacts.map((artifact) => {
            const id = `${artifact.timestamp}:${artifact.agent_id}:${artifact.filename}`;
            const selected = id === (activeArtifact ? `${activeArtifact.timestamp}:${activeArtifact.agent_id}:${activeArtifact.filename}` : '');
            return (
              <div key={id} className={`artifact-row${selected ? ' active' : ''}`}>
                <div className="artifact-row-main">
                  <div className="artifact-titleline">
                    <span className="artifact-icon">{fileTypeIcon(artifact.filename)}</span>
                    <span className="artifact-filename" title={artifact.filename}>{artifact.filename}</span>
                  </div>
                  <div className="artifact-meta">
                    <span>{artifact.agent_id}</span>
                    <span>{formatTime(artifact.timestamp)}</span>
                    {artifact.mime_type && <span>{artifact.mime_type}</span>}
                  </div>
                </div>
                <div className="artifact-actions">
                  <button className="manager-icon-btn" onClick={() => setActiveArtifactId(id)}>Preview</button>
                  <button className="manager-icon-btn" onClick={() => copyArtifact(artifact)}>Copy</button>
                  <button className="manager-icon-btn" onClick={() => saveArtifact(artifact)}>Save</button>
                </div>
              </div>
            );
          })}
        </div>

        <div className="artifact-preview">
          {!activeArtifact && <div className="state-empty">Select an artifact to preview</div>}
          {activeArtifact && activeKind === 'markdown' && <MarkdownView content={activeArtifact.content} />}
          {activeArtifact && activeKind === 'json' && (() => {
            try {
              return <div className="artifact-json"><JsonNode value={JSON.parse(activeArtifact.content)} depth={0} /></div>;
            } catch {
              return <pre className="artifact-raw">{activeArtifact.content}</pre>;
            }
          })()}
          {activeArtifact && activeKind === 'code' && (
            <pre className="artifact-code" dangerouslySetInnerHTML={{ __html: highlightCode(activeArtifact.content) }} />
          )}
          {activeArtifact && activeKind === 'raw' && <pre className="artifact-raw">{activeArtifact.content}</pre>}
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
