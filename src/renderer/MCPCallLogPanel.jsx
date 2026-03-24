import React, { useState, useEffect, useRef, useCallback } from 'react';

const EVENT_TO_TOOL = {
  agent: 'register_agent',
  agent_node: 'upsert_agent_node',
  agent_activity: 'append_agent_activity',
  tool_call: 'report_tool_call',
  signal: 'signal_agent',
  message: 'post_message',
  state: 'set_shared_state',
  artifact: 'submit_artifact',
  terminal_summary_done: 'summarize_terminal_output',
};

const TOOL_COLORS = {
  register_agent: '#7ec8e3',
  upsert_agent_node: '#a8d8a8',
  append_agent_activity: '#ffe08a',
  report_tool_call: '#c3a6ff',
  signal_agent: '#ff9e64',
  post_message: '#73daca',
  set_shared_state: '#f7768e',
  submit_artifact: '#e0af68',
  summarize_terminal_output: '#9ece6a',
};

function summarize(type, data) {
  try {
    switch (type) {
      case 'agent': return `label="${data.label}" id=${data.id}`;
      case 'agent_node': return `role="${data.role}" status=${data.status}${data.progress != null ? ` ${data.progress}%` : ''}`;
      case 'agent_activity': return `[${data.level}] ${data.message}`;
      case 'tool_call': return `${data.op} ${data.tool_name} → ${data.file_path || ''}`;
      case 'signal': return `→ ${data.agent_id}: ${data.message}`;
      case 'message': return `#${data.channel}: ${typeof data.content === 'object' ? JSON.stringify(data.content) : data.content}`;
      case 'state': return `${data.key} = ${typeof data.value === 'object' ? JSON.stringify(data.value) : String(data.value)}`;
      case 'artifact': return `${data.filename} (${data.mime_type})`;
      case 'terminal_summary_done': return `terminal_id=${data.terminal_id}`;
      default: return JSON.stringify(data).slice(0, 120);
    }
  } catch {
    return '';
  }
}

function agentId(type, data) {
  switch (type) {
    case 'agent': return data.id;
    case 'agent_node': return data.id || data.agent_id;
    case 'agent_activity': return data.agent_id;
    case 'tool_call': return data.agent_id;
    case 'signal': return data.from || data.agent_id;
    case 'message': return data.sender;
    case 'artifact': return data.agent_id;
    default: return null;
  }
}

function formatTime(ts) {
  return new Date(ts).toLocaleTimeString('en', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export default function MCPCallLogPanel({ visible, port, token, onHide, onFocus }) {
  const [entries, setEntries] = useState([]);
  const [connected, setConnected] = useState(false);
  const [filter, setFilter] = useState('all');
  const [agentFilter, setAgentFilter] = useState('');
  const [agentIds, setAgentIds] = useState([]);
  const [expanded, setExpanded] = useState(null);
  const esRef = useRef(null);
  const bodyRef = useRef(null);
  const bottomRef = useRef(null);
  const [autoScroll, setAutoScroll] = useState(true);

  const addEntry = useCallback((type, data) => {
    const tool = EVENT_TO_TOOL[type];
    if (!tool) return;
    const entry = {
      id: `${Date.now()}-${Math.random()}`,
      ts: data.timestamp || Date.now(),
      type,
      tool,
      agent: agentId(type, data),
      summary: summarize(type, data),
      raw: data,
    };
    setEntries((prev) => {
      const next = [...prev.slice(-999), entry];
      return next;
    });
    if (entry.agent) {
      setAgentIds((prev) => prev.includes(entry.agent) ? prev : [...prev, entry.agent]);
    }
  }, []);

  const connect = useCallback(() => {
    esRef.current?.close();
    const es = new EventSource(`http://localhost:${port}/events?token=${encodeURIComponent(token || '')}`);
    esRef.current = es;
    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false);
    es.onmessage = (e) => {
      try {
        const { type, data } = JSON.parse(e.data);
        if (type === 'snapshot') {
          (data.toolCalls || []).forEach((tc) => addEntry('tool_call', tc));
          return;
        }
        addEntry(type, data);
      } catch {}
    };
  }, [port, token, addEntry]);

  useEffect(() => {
    connect();
    return () => esRef.current?.close();
  }, [connect]);

  useEffect(() => {
    if (autoScroll && bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [entries, autoScroll]);

  const handleScroll = useCallback(() => {
    const el = bodyRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    setAutoScroll(atBottom);
  }, []);

  if (!visible) return <div className="monitor-panel hidden" />;

  const tools = ['all', ...Object.values(EVENT_TO_TOOL)];
  const filtered = entries.filter((e) => {
    if (filter !== 'all' && e.tool !== filter) return false;
    if (agentFilter && e.agent !== agentFilter) return false;
    return true;
  });

  return (
    <div className="monitor-panel" onClick={onFocus}>
      <div className="monitor-header">
        <div className="monitor-dot" style={!connected ? { background: 'var(--red)' } : {}} />
        <span className="title">MCP Call Log</span>
        <button
          className="monitor-hide-btn"
          onClick={(e) => { e.stopPropagation(); onHide?.(); }}
          title="Hide panel"
        >‹</button>
      </div>

      <div className="mcp-log-filters">
        <select
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          title="Filter by tool"
        >
          {tools.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <select
          value={agentFilter}
          onChange={(e) => setAgentFilter(e.target.value)}
          title="Filter by agent"
        >
          <option value="">all agents</option>
          {agentIds.map((a) => <option key={a} value={a}>{a}</option>)}
        </select>
        <button
          className="mcp-log-clear"
          onClick={() => { setEntries([]); setExpanded(null); }}
          title="Clear log"
        >clear</button>
      </div>

      <div className="monitor-body mcp-log-body" ref={bodyRef} onScroll={handleScroll}>
        {filtered.length === 0 && (
          <div className="mcp-log-empty">No MCP calls yet.</div>
        )}
        {filtered.map((e) => (
          <div
            key={e.id}
            className={`mcp-log-entry${expanded === e.id ? ' expanded' : ''}`}
            onClick={() => setExpanded((v) => v === e.id ? null : e.id)}
          >
            <div className="mcp-log-row">
              <span className="mcp-log-time">{formatTime(e.ts)}</span>
              <span
                className="mcp-log-tool"
                style={{ color: TOOL_COLORS[e.tool] || 'var(--text-muted)' }}
              >{e.tool}</span>
              {e.agent && <span className="mcp-log-agent">{e.agent}</span>}
            </div>
            <div className="mcp-log-summary">{e.summary}</div>
            {expanded === e.id && (
              <pre className="mcp-log-raw">{JSON.stringify(e.raw, null, 2)}</pre>
            )}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      <div className="monitor-controls" style={{ justifyContent: 'space-between' }}>
        <span className="mcp-log-count">{filtered.length} / {entries.length} entries</span>
        <button
          className="mcp-log-clear"
          style={{ opacity: autoScroll ? 1 : 0.5 }}
          onClick={() => { setAutoScroll(true); bottomRef.current?.scrollIntoView(); }}
          title="Scroll to bottom"
        >↓ tail</button>
      </div>
    </div>
  );
}
