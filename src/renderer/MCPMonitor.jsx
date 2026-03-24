import React, { useState, useEffect, useRef, useCallback } from 'react';

const CHANNEL_CLASSES = ['ch-0', 'ch-1', 'ch-2', 'ch-3', 'ch-4'];
const channelCache = new Map();

function channelClass(name) {
  if (!channelCache.has(name)) {
    channelCache.set(name, CHANNEL_CLASSES[channelCache.size % CHANNEL_CLASSES.length]);
  }
  return channelCache.get(name);
}

function formatTime(ts) {
  return new Date(ts).toLocaleTimeString('en', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function formatVal(val) {
  if (val === null || val === undefined) return 'null';
  if (typeof val === 'object') {
    try { return JSON.stringify(val); } catch { return String(val); }
  }
  return String(val);
}

export default function MCPMonitor({ visible, port, token, onHide, onFocus }) {
  const [agents, setAgents] = useState([]);
  const [messages, setMessages] = useState([]);
  const [sharedState, setSharedState] = useState({});
  const [agentCosts, setAgentCosts] = useState({});
  const [connected, setConnected] = useState(false);
  const [collapsed, setCollapsed] = useState({ agents: false, messages: false, state: false });
  const feedRef = useRef(null);
  const autoScrollRef = useRef(true);
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
        const { type, data } = payload;
        switch (type) {
          case 'snapshot':
            setAgents(data.agents || []);
            setMessages(data.messages || []);
            setSharedState(data.sharedState || {});
            break;
          case 'agent':
            setAgents((prev) => {
              const idx = prev.findIndex((a) => a.id === data.id);
              if (idx >= 0) {
                const next = [...prev];
                next[idx] = data;
                return next;
              }
              return [...prev, data];
            });
            break;
          case 'message':
            setMessages((prev) => [...prev.slice(-499), data]);
            break;
          case 'state':
            setSharedState((prev) => ({ ...prev, [data.key]: data.value }));
            break;
          case 'signal':
            setMessages((prev) => [
              ...prev.slice(-499),
              {
                id: Date.now(),
                channel: `signal→${data.agent_id}`,
                content: data.message,
                sender: data.from,
                timestamp: data.timestamp,
              },
            ]);
            break;
          case 'agent_cost':
            setAgentCosts((prev) => ({ ...prev, [data.agent_id]: { tokens: data.tokens, usd: data.usd } }));
            break;
          case 'cleared':
            if (data.target === 'messages') setMessages([]);
            if (data.target === 'state') setSharedState({});
            break;
        }
      } catch { }
    };
  }, [port, token]);

  useEffect(() => {
    connect();
    return () => esRef.current?.close();
  }, [connect]);

  useEffect(() => {
    if (autoScrollRef.current && feedRef.current) {
      feedRef.current.scrollTop = feedRef.current.scrollHeight;
    }
  }, [messages]);

  const handleFeedScroll = () => {
    if (!feedRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = feedRef.current;
    autoScrollRef.current = scrollHeight - scrollTop - clientHeight < 30;
  };

  const toggleSection = (key) =>
    setCollapsed((prev) => ({ ...prev, [key]: !prev[key] }));

  if (!visible) return <div className="monitor-panel hidden" />;

  const stateEntries = Object.entries(sharedState);

  return (
    <div className="monitor-panel" onClick={onFocus}>
      <div className="monitor-header">
        <div className="monitor-dot" style={!connected ? { background: 'var(--red)', boxShadow: '0 0 4px var(--red)' } : {}} />
        <span className="title">MCP Monitor</span>
        <span style={{ fontSize: 9, color: 'var(--text-dim)' }}>:{port}</span>
        <button className="monitor-hide-btn" onClick={(e) => { e.stopPropagation(); onHide?.(); }} title="Hide panel">‹</button>
      </div>

      <div className="monitor-body">
        <div className="monitor-section">
          <div className="monitor-section-header" onClick={() => toggleSection('agents')}>
            <span>Agents ({agents.length})</span>
            <span className="section-toggle">{collapsed.agents ? '▶' : '▼'}</span>
          </div>
          {!collapsed.agents && (
            <div className="agent-list">
              {agents.length === 0 && (
                <div className="state-empty">No agents registered</div>
              )}
              {agents.map((a) => {
                const cost = agentCosts[a.id];
                return (
                  <div key={a.id} className="agent-item">
                    <div className={`agent-status-dot ${a.status || 'idle'}`} />
                    <span className="agent-label">{a.label}</span>
                    <span className="agent-id">{a.id}</span>
                    {cost && (
                      <span style={{ fontSize: 9, color: 'var(--text-dim)', marginLeft: 'auto' }}>
                        ${cost.usd.toFixed(4)}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="monitor-section" style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div className="monitor-section-header" onClick={() => toggleSection('messages')}>
            <span>Messages ({messages.length})</span>
            <span className="section-toggle">{collapsed.messages ? '▶' : '▼'}</span>
          </div>
          {!collapsed.messages && (
            <div
              className="message-feed"
              ref={feedRef}
              onScroll={handleFeedScroll}
              style={{ flex: 1, maxHeight: 'none' }}
            >
              {messages.length === 0 && (
                <div className="state-empty">No messages yet</div>
              )}
              {messages.map((m) => {
                const cls = channelClass(m.channel);
                return (
                  <div key={m.id} className={`message-item ${cls}`}>
                    <div className="message-meta">
                      <span className={`message-channel ${cls}`}>#{m.channel}</span>
                      {m.sender && m.sender !== 'unknown' && (
                        <span style={{ fontSize: 9, color: 'var(--text-dim)' }}>{m.sender}</span>
                      )}
                      <span className="message-ts">{formatTime(m.timestamp)}</span>
                    </div>
                    <div className="message-content">{m.content}</div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="monitor-section">
          <div className="monitor-section-header" onClick={() => toggleSection('state')}>
            <span>Shared State ({stateEntries.length})</span>
            <span className="section-toggle">{collapsed.state ? '▶' : '▼'}</span>
          </div>
          {!collapsed.state && (
            <div className="state-grid">
              {stateEntries.length === 0 && (
                <div className="state-empty">Empty</div>
              )}
              {stateEntries.map(([k, v]) => (
                <div key={k} className="state-row">
                  <span className="state-key">{k}</span>
                  <span className="state-sep">=</span>
                  <span className="state-val" title={formatVal(v)}>{formatVal(v)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="monitor-controls">
        <button className="btn danger" onClick={() => window.electron.mcp.clearMessages()}>
          Clear messages
        </button>
        <button className="btn danger" onClick={() => window.electron.mcp.resetState()}>
          Reset state
        </button>
        <button
          className="btn"
          onClick={async () => {
            const state = await window.electron.mcp.getState();
            navigator.clipboard.writeText(JSON.stringify(state, null, 2));
          }}
        >
          Copy state
        </button>
        {!connected && (
          <button className="btn" onClick={connect}>Reconnect</button>
        )}
      </div>
    </div>
  );
}
