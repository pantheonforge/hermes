const express = require('express');
const cors = require('cors');
const { EventEmitter } = require('events');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { version: PKG_VERSION } = require('../../package.json');

const SUMMARIZE_TIMEOUT_MS = 60_000;

const TOOLS = [
  {
    name: 'post_message',
    description: 'Publish a message to a named channel visible to all agents. Use for task handoffs, status broadcasts, and coordination. Use channel names like "#general", "#tasks", or "#results". Prefer this over signal_agent when the message is relevant to more than one agent.',
    inputSchema: {
      type: 'object',
      properties: {
        channel: { type: 'string', description: 'Channel name' },
        content: { type: 'string', description: 'Message content' },
      },
      required: ['channel', 'content'],
    },
  },
  {
    name: 'read_messages',
    description: 'Read messages from a named channel. Poll "#inbox-{your_agent_id}" to receive signals and task assignments sent directly to you. Pass the timestamp of the last message you saw as `since` to avoid reprocessing old messages.',
    inputSchema: {
      type: 'object',
      properties: {
        channel: { type: 'string' },
        since: { type: 'number', description: 'Unix timestamp in ms; return only messages after this' },
      },
      required: ['channel'],
    },
  },
  {
    name: 'set_shared_state',
    description: 'Write a value to the shared key-value store visible to all agents and the UI. Use for cross-agent coordination: task assignments, flags, results, and shared config. Displayed live in the monitor panel. Prefer structured JSON values over plain strings.',
    inputSchema: {
      type: 'object',
      properties: {
        key: { type: 'string' },
        value: { description: 'Any JSON-serializable value' },
      },
      required: ['key', 'value'],
    },
  },
  {
    name: 'get_shared_state',
    description: 'Read a value from the shared key-value store. Use at session start to discover existing task assignments, agent roles, or shared config set by the coordinator or other agents.',
    inputSchema: {
      type: 'object',
      properties: { key: { type: 'string' } },
      required: ['key'],
    },
  },
  {
    name: 'list_agents',
    description: 'List all active agent sessions with their IDs, labels, and status. Call this to discover which agents are available before using signal_agent, or to check if a coordinator or specialist agent is already running.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'register_agent',
    description: 'REQUIRED on session start. Register this agent with the Hermes UI so it appears in the monitor panel. Call this before any other tool. Choose a stable `id` (e.g. "agent-1") and a descriptive `label` (e.g. "Backend Refactor Agent"). Without registration, your activity will not appear in the UI.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Unique agent identifier' },
        label: { type: 'string', description: 'Human-readable label' },
        terminal_id: { type: 'string', description: 'Value of HERMES_TERMINAL_ID env var — links this agent ID to your terminal so signal_agent delivers banners correctly' },
      },
      required: ['id', 'label'],
    },
  },
  {
    name: 'signal_agent',
    description: 'Send a direct message to a specific agent. Displays a visual banner in their terminal and stores the message in their inbox. Use for task handoffs ("I finished X, you can start Y"), blocking requests, or alerting another agent to a problem. Get valid agent IDs from list_agents first.',
    inputSchema: {
      type: 'object',
      properties: {
        agent_id: { type: 'string' },
        message: { type: 'string' },
      },
      required: ['agent_id', 'message'],
    },
  },
  {
    name: 'submit_artifact',
    description: 'Submit a file or deliverable to the Hermes artifact panel, where a human can review, copy, or download it. Use for any output worth surfacing: generated code, reports, configs, scripts, summaries. Set mime_type (e.g. "text/plain", "application/json", "text/markdown") for correct rendering.',
    inputSchema: {
      type: 'object',
      properties: {
        agent_id: { type: 'string' },
        filename: { type: 'string' },
        content: { type: 'string' },
        mime_type: { type: 'string' },
      },
      required: ['agent_id', 'filename', 'content'],
    },
  },
  {
    name: 'summarize_terminal_output',
    description: 'Ask Claude to summarize a block of terminal output and stream the result to the UI. Use after long-running commands (builds, tests, installs) to surface a human-readable summary. Provide the raw terminal text in output_text; optionally customise the summary angle with prompt.',
    inputSchema: {
      type: 'object',
      properties: {
        terminal_id: { type: 'string' },
        output_text: { type: 'string' },
        prompt: { type: 'string' },
      },
      required: ['terminal_id', 'output_text'],
    },
  },
  {
    name: 'report_tool_call',
    description: 'CALL THIS after every file read, write, edit, or delete. Populates the live diff timeline and file activity panel visible to the human supervisor. For write/edit ops, always include `diff` (unified diff), `reasoning` (why you made the change), `lines_added`, and `lines_removed` — this is what makes the diff panel useful. Omitting these fields leaves the panel empty.',
    inputSchema: {
      type: 'object',
      properties: {
        agent_id: { type: 'string' },
        tool_name: { type: 'string' },
        file_path: { type: 'string' },
        op: { type: 'string', description: 'Operation type: "read", "write", "edit", or "delete"' },
        timestamp: { type: 'number', description: 'Unix ms timestamp; defaults to now if omitted' },
        reasoning: { type: 'string', description: 'Why you made this change — shown in the diff timeline. Required for write/edit to populate the diff panel meaningfully.' },
        before: { type: 'string', description: 'File content before the edit (for context)' },
        after: { type: 'string', description: 'File content after the edit (for context)' },
        diff: { type: 'string', description: 'Unified diff text (e.g. output of `diff -u`). Required for write/edit ops to display in the live diff timeline.' },
        lines_added: { type: 'number', description: 'Number of lines added; shown in the diff panel summary' },
        lines_removed: { type: 'number', description: 'Number of lines removed; shown in the diff panel summary' },
      },
      required: ['agent_id', 'tool_name'],
    },
  },
  {
    name: 'upsert_agent_node',
    description: 'Register or update your node in the agent orchestration tree shown in the UI. Call once at startup with status "running", then update progress (0–100) as you work, and set status "done" or "error" when finished. If you are a sub-agent spawned by another agent, set parent_id to that agent\'s ID so the tree renders correctly.',
    inputSchema: {
      type: 'object',
      properties: {
        agent_id: { type: 'string' },
        parent_id: { type: 'string' },
        role: { type: 'string', description: 'Human-readable role description, e.g. "Frontend Refactor", "Test Runner", "Coordinator"' },
        status: { type: 'string', description: '"pending", "running", "done", or "error"' },
        progress: { type: 'number', description: 'Completion percentage 0–100; update this as you work so the UI shows a live progress bar' },
        model: { type: 'string', description: 'Model name, e.g. "claude-sonnet-4-6"' },
        token_burn: { type: 'number', description: 'Cumulative tokens used so far' },
      },
      required: ['agent_id', 'role', 'status'],
    },
  },
  {
    name: 'append_agent_activity',
    description: 'Append a log entry to your agent\'s activity feed in the UI. Use throughout your session to narrate what you are doing: task started, decision made, file changed, error encountered. Use level "info" for normal progress, "warn" for recoverable issues, "error" for failures. Frequent entries give the human supervisor live visibility into your work.',
    inputSchema: {
      type: 'object',
      properties: {
        agent_id: { type: 'string' },
        message: { type: 'string' },
        level: { type: 'string', description: '"info" (default), "warn", or "error"' },
      },
      required: ['agent_id', 'message'],
    },
  },
  {
    name: 'semantic_search',
    description: 'Semantic vector search over the indexed codebase and/or MCP event history. Use instead of grep when you need conceptual matches (e.g. "authentication logic", "error handling patterns"). Use scope "events" to search past agent messages, artifacts, and activity logs. Rate-limited to 5 calls per 10 seconds per agent.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Natural language search query' },
        limit: { type: 'number', description: 'Max results to return (default 10, max 50)' },
        scope: { type: 'string', description: 'Search scope: "code" (default), "events", or "all"' },
      },
      required: ['query'],
    },
  },
];

function loadArtifacts(artifactsPath) {
  try {
    return JSON.parse(fs.readFileSync(artifactsPath, 'utf8'));
  } catch {
    return [];
  }
}

function persistArtifacts(artifactsPath, artifacts) {
  if (!artifactsPath) return;
  try {
    const capped = artifacts.slice(-500).filter((a) => !a.content || a.content.length <= 2 * 1024 * 1024);
    fs.writeFileSync(artifactsPath, JSON.stringify(capped));
  } catch {
    // ignore
  }
}

function createMcpServer(port, { memoryIndex, artifactsPath } = {}) {
  const emitter = new EventEmitter();
  const app = express();

  // State
  const messages = [];       // { id, channel, content, sender, timestamp }
  const agents = new Map();  // agent_id → { id, label, status, registeredAt }
  const terminalToAgent = new Map(); // terminalId → agentId (populated by PTY parser)
  const agentToTerminal = new Map(); // agentId → terminalId (reverse of terminalToAgent)
  const sharedState = {};    // key → value
  let artifacts = loadArtifacts(artifactsPath);      // { type, agent_id, filename, content, mime_type, timestamp }
  const toolCalls = [];      // { agent_id, tool_name, file_path, op, timestamp }
  const diffTimeline = [];   // { id, agent_id, tool_name, file_path, op, timestamp, reasoning, lines_added, lines_removed, diff_lines }
  const agentNodes = new Map(); // id -> node
  const agentActivities = new Map(); // id -> [{...}]
  const sseClients = new Set();

  let messageIdCounter = 0;
  let diffTimelineCounter = 0;

  // Rate limiting for semantic_search: 5 requests per 10 seconds per agent
  const searchRateMap = new Map(); // agent_id -> { count, resetAt }
  function checkSearchRate(agentId) {
    const now = Date.now();
    let entry = searchRateMap.get(agentId);
    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + 10000 };
      searchRateMap.set(agentId, entry);
    }
    entry.count += 1;
    return entry.count <= 5;
  }

  function splitLines(value) {
    const text = String(value ?? '').replace(/\r\n/g, '\n');
    if (!text) return [];
    return text.split('\n');
  }

  function buildDiffLinesFromBeforeAfter(before, after) {
    const beforeLines = splitLines(before);
    const afterLines = splitLines(after);

    let prefix = 0;
    while (
      prefix < beforeLines.length
      && prefix < afterLines.length
      && beforeLines[prefix] === afterLines[prefix]
    ) {
      prefix += 1;
    }

    let suffix = 0;
    while (
      suffix < (beforeLines.length - prefix)
      && suffix < (afterLines.length - prefix)
      && beforeLines[beforeLines.length - 1 - suffix] === afterLines[afterLines.length - 1 - suffix]
    ) {
      suffix += 1;
    }

    const removed = beforeLines.slice(prefix, beforeLines.length - suffix);
    const added = afterLines.slice(prefix, afterLines.length - suffix);
    const maxLines = 400;
    const diffLines = [];

    for (let i = 0; i < removed.length && diffLines.length < maxLines; i += 1) {
      diffLines.push({ type: 'remove', line: prefix + i + 1, text: removed[i] });
    }
    for (let i = 0; i < added.length && diffLines.length < maxLines; i += 1) {
      diffLines.push({ type: 'add', line: prefix + i + 1, text: added[i] });
    }

    return {
      lines_added: added.length,
      lines_removed: removed.length,
      diff_lines: diffLines,
      truncated: removed.length + added.length > maxLines,
    };
  }

  function buildDiffLinesFromUnified(diffText) {
    const lines = String(diffText ?? '').replace(/\r\n/g, '\n').split('\n');
    const maxLines = 400;
    const diffLines = [];
    let oldLine = 1;
    let newLine = 1;
    let added = 0;
    let removed = 0;

    for (const line of lines) {
      const header = line.match(/^@@\s*-(\d+)(?:,\d+)?\s+\+(\d+)(?:,\d+)?\s*@@/);
      if (header) {
        oldLine = Number(header[1]);
        newLine = Number(header[2]);
        continue;
      }
      if (line.startsWith('+++') || line.startsWith('---') || line.startsWith('diff --')) continue;
      if (line.startsWith('+')) {
        added += 1;
        if (diffLines.length < maxLines) {
          diffLines.push({ type: 'add', line: newLine, text: line.slice(1) });
        }
        newLine += 1;
        continue;
      }
      if (line.startsWith('-')) {
        removed += 1;
        if (diffLines.length < maxLines) {
          diffLines.push({ type: 'remove', line: oldLine, text: line.slice(1) });
        }
        oldLine += 1;
        continue;
      }
      if (line.startsWith(' ')) {
        oldLine += 1;
        newLine += 1;
      }
    }

    return {
      lines_added: added,
      lines_removed: removed,
      diff_lines: diffLines,
      truncated: added + removed > maxLines,
    };
  }

  function maybeBuildDiffTimelineEntry(item) {
    const toolName = String(item?.tool_name || '').toLowerCase();
    const op = String(item?.op || '').toLowerCase();
    const isWriteTool = toolName === 'write_file' || toolName.endsWith('/write_file');
    const isWriteOp = op === 'write' || op === 'edit';
    if (!isWriteTool && !isWriteOp) return null;
    if (!item?.file_path) return null;

    let diffData = {
      lines_added: Math.max(0, Number(item?.lines_added || 0)),
      lines_removed: Math.max(0, Number(item?.lines_removed || 0)),
      diff_lines: [],
      truncated: false,
    };

    if (item?.before !== undefined || item?.after !== undefined) {
      diffData = buildDiffLinesFromBeforeAfter(item.before, item.after);
    } else if (item?.diff) {
      diffData = buildDiffLinesFromUnified(item.diff);
    }

    const hasDiff = diffData.lines_added > 0 || diffData.lines_removed > 0 || diffData.diff_lines.length > 0;
    if (!hasDiff && !item?.reasoning) return null;

    return {
      id: `diff-${Date.now()}-${++diffTimelineCounter}`,
      agent_id: String(item.agent_id || ''),
      tool_name: String(item.tool_name || ''),
      file_path: String(item.file_path || ''),
      op: String(item.op || ''),
      timestamp: Number(item.timestamp || Date.now()),
      reasoning: String(item.reasoning || '').trim(),
      lines_added: diffData.lines_added,
      lines_removed: diffData.lines_removed,
      diff_lines: diffData.diff_lines,
      truncated: Boolean(diffData.truncated),
    };
  }

  function pickUsage(data) {
    if (!data || typeof data !== 'object') return null;
    const usage = data.usage || data.message?.usage || data.result?.usage || null;
    if (!usage || typeof usage !== 'object') return null;
    const inputTokens = Number(usage.input_tokens ?? usage.inputTokens ?? 0);
    const outputTokens = Number(usage.output_tokens ?? usage.outputTokens ?? 0);
    const totalTokens = Number(usage.total_tokens ?? usage.totalTokens ?? (inputTokens + outputTokens));
    const usd = Number(usage.cost_usd ?? usage.usd ?? usage.total_cost_usd ?? 0);
    const out = {
      input_tokens: Math.max(0, inputTokens || 0),
      output_tokens: Math.max(0, outputTokens || 0),
      total_tokens: Math.max(0, totalTokens || 0),
    };
    if (usd > 0) out.usd = usd;
    return out;
  }

  function extractTextChunk(data) {
    if (!data || typeof data !== 'object') return '';
    if (typeof data?.delta?.text === 'string') return data.delta.text;
    if (typeof data?.content?.[0]?.text === 'string') return data.content[0].text;
    if (typeof data?.text === 'string') return data.text;
    if (typeof data?.message?.content?.[0]?.text === 'string') return data.message.content[0].text;
    return '';
  }

  function streamClaudeSummary({ terminalId, outputText, promptText }) {
    const trimmedOutput = String(outputText || '').slice(-24000);
    const prompt = `${String(promptText || '').trim() || 'Summarise this terminal output in 3 lines. Lead with the outcome, then the cause, then the recommended action if any.'}\n\n${trimmedOutput}`;
    const jobId = `sum-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    let summary = '';
    let usage = null;
    let stderrText = '';
    let stdoutBuf = '';
    const spawnEnv = {};
    for (const key of ['PATH', 'Path', 'HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA',
      'TEMP', 'TMP', 'TMPDIR', 'SYSTEMROOT', 'SystemRoot', 'USER', 'USERNAME']) {
      if (process.env[key] !== undefined) spawnEnv[key] = process.env[key];
    }
    const proc = spawn('claude', ['--print', '--verbose', '--output-format', 'stream-json', '-'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: false,
      env: spawnEnv,
    });
    const killTimer = setTimeout(() => proc.kill(), SUMMARIZE_TIMEOUT_MS);
    proc.stdin.write(prompt);
    proc.stdin.end();

    const flushLines = () => {
      const lines = stdoutBuf.split(/\r?\n/);
      stdoutBuf = lines.pop() || '';
      for (const line of lines) {
        const trimmed = String(line || '').trim();
        if (!trimmed) continue;
        let parsed = null;
        try {
          parsed = JSON.parse(trimmed);
        } catch {
          continue;
        }
        const chunk = extractTextChunk(parsed);
        if (chunk) {
          summary += chunk;
          broadcast('terminal_summary_chunk', {
            terminal_id: terminalId,
            job_id: jobId,
            chunk,
          });
        }
        const picked = pickUsage(parsed);
        if (picked) usage = picked;
      }
    };

    proc.stdout.on('data', (buf) => {
      stdoutBuf += String(buf || '');
      flushLines();
    });

    proc.stderr.on('data', (buf) => {
      stderrText += String(buf || '');
    });

    proc.on('error', (err) => {
      clearTimeout(killTimer);
      broadcast('terminal_summary_done', {
        terminal_id: terminalId,
        job_id: jobId,
        summary: '',
        usage: null,
        error: err?.message || 'Failed to start Claude',
      });
    });

    proc.on('close', () => {
      clearTimeout(killTimer);
      flushLines();
      const error = stderrText.trim();
      broadcast('terminal_summary_done', {
        terminal_id: terminalId,
        job_id: jobId,
        summary: summary.trim(),
        usage,
        error: error || '',
      });
    });

    return jobId;
  }

  function broadcast(type, data, opts = {}) {
    const body = opts.raw ? data : { type, data, ts: Date.now() };
    const payload = `data: ${JSON.stringify(body)}\n\n`;
    for (const res of sseClients) {
      try { res.write(payload); } catch { try { res.end(); } catch { /* ignore */ } sseClients.delete(res); }
    }
    emitter.emit('event', body);
  }

  function text(str) {
    return { content: [{ type: 'text', text: String(str) }] };
  }

  function jsonText(obj) {
    return { content: [{ type: 'text', text: JSON.stringify(obj, null, 2) }] };
  }

  async function handleTool(name, args) {
    switch (name) {
      case 'post_message': {
        const { channel, content } = args;
        const msg = {
          id: ++messageIdCounter,
          channel,
          content,
          sender: args._sender || 'unknown',
          timestamp: Date.now(),
        };
        messages.push(msg);
        if (messages.length > 1000) messages.splice(0, messages.length - 1000);
        broadcast('message', msg);
        return text(`Message posted to #${channel}`);
      }

      case 'read_messages': {
        const { channel, since } = args;
        const filtered = messages.filter(
          (m) => m.channel === channel && (!since || m.timestamp > since)
        );
        return jsonText(filtered);
      }

      case 'set_shared_state': {
        const { key, value } = args;
        sharedState[key] = value;
        broadcast('state', { key, value });
        return text(`State[${key}] set`);
      }

      case 'get_shared_state': {
        const { key } = args;
        return jsonText({ key, value: sharedState[key] ?? null });
      }

      case 'list_agents': {
        return jsonText([...agents.values()]);
      }

      case 'register_agent': {
        const { id, label } = args;
        emitter.registerAgent(id, label);
        if (args.terminal_id) emitter.mapTerminal(String(args.terminal_id), id);
        return jsonText({ agentId: id, label, inbox_channel: `#inbox-${id}` });
      }

      case 'signal_agent': {
        const { agent_id, message } = args;
        const target = agents.get(agent_id);
        if (!target) return text(`Agent ${agent_id} not found`);
        const from = args._sender || 'unknown';
        const timestamp = Date.now();
        const signal = { agent_id, message, from, timestamp };
        broadcast('signal', signal);
        emitter.emit('signal', signal);
        // Store in inbox channel so target agent can poll read_messages
        const inboxMsg = {
          id: ++messageIdCounter,
          channel: `#inbox-${agent_id}`,
          content: message,
          sender: from,
          timestamp,
        };
        messages.push(inboxMsg);
        if (messages.length > 1000) messages.splice(0, messages.length - 1000);
        return text(`Signal sent to ${agent_id}`);
      }

      case 'submit_artifact': {
        const artifact = {
          type: 'artifact',
          agent_id: String(args.agent_id),
          filename: String(args.filename),
          content: String(args.content),
          mime_type: args.mime_type ? String(args.mime_type) : undefined,
          timestamp: Date.now(),
        };
        artifacts.push(artifact);
        persistArtifacts(artifactsPath, artifacts);
        broadcast('artifact', artifact);
        return text(`Artifact submitted: ${artifact.filename}`);
      }

      case 'report_tool_call': {
        const item = {
          agent_id: String(args.agent_id),
          tool_name: String(args.tool_name),
          file_path: args.file_path ? String(args.file_path) : '',
          op: args.op ? String(args.op) : '',
          timestamp: Number(args.timestamp || Date.now()),
          reasoning: args.reasoning ? String(args.reasoning) : '',
          before: args.before !== undefined ? String(args.before) : undefined,
          after: args.after !== undefined ? String(args.after) : undefined,
          diff: args.diff !== undefined ? String(args.diff) : undefined,
          lines_added: args.lines_added !== undefined ? Number(args.lines_added) : undefined,
          lines_removed: args.lines_removed !== undefined ? Number(args.lines_removed) : undefined,
        };
        toolCalls.push(item);
        if (toolCalls.length > 5000) toolCalls.splice(0, toolCalls.length - 5000);
        broadcast('tool_call', item);
        const diffEntry = maybeBuildDiffTimelineEntry(item);
        if (diffEntry) {
          diffTimeline.push(diffEntry);
          if (diffTimeline.length > 2000) diffTimeline.splice(0, diffTimeline.length - 2000);
          broadcast('diff_timeline', diffEntry);
        }
        return text('Tool call recorded');
      }

      case 'summarize_terminal_output': {
        const terminalId = String(args.terminal_id || '').trim();
        const outputText = String(args.output_text || '');
        if (!terminalId) throw new Error('terminal_id is required');
        if (!outputText.trim()) throw new Error('output_text is required');
        const jobId = streamClaudeSummary({
          terminalId,
          outputText,
          promptText: args.prompt,
        });
        return jsonText({ ok: true, accepted: true, terminal_id: terminalId, job_id: jobId });
      }

      case 'upsert_agent_node': {
        const id = String(args.agent_id);
        const prev = agentNodes.get(id);
        const node = {
          id,
          parent_id: args.parent_id ? String(args.parent_id) : null,
          role: String(args.role),
          status: String(args.status),
          progress: Math.max(0, Math.min(100, Number(args.progress ?? prev?.progress ?? 0))),
          model: args.model ? String(args.model) : (prev?.model || ''),
          token_burn: Math.max(0, Number(args.token_burn ?? prev?.token_burn ?? 0)),
          updatedAt: Date.now(),
          createdAt: prev?.createdAt || Date.now(),
        };
        agentNodes.set(id, node);
        if (!agentActivities.has(id)) agentActivities.set(id, []);
        broadcast('agent_node', node);
        return text(`Agent node upserted: ${id}`);
      }

      case 'append_agent_activity': {
        const id = String(args.agent_id);
        const item = {
          agent_id: id,
          message: String(args.message),
          level: args.level ? String(args.level) : 'info',
          timestamp: Date.now(),
        };
        if (!agentActivities.has(id)) agentActivities.set(id, []);
        const list = agentActivities.get(id);
        list.push(item);
        if (list.length > 500) list.splice(0, list.length - 500);
        broadcast('agent_activity', item);
        return text(`Agent activity appended: ${id}`);
      }

      case 'semantic_search': {
        if (!memoryIndex) return jsonText({ ok: false, error: 'Semantic search not available' });
        const agentId = String(args._sender || args.agent_id || 'unknown');
        if (!checkSearchRate(agentId)) {
          return jsonText({ ok: false, error: 'Rate limit exceeded: max 5 searches per 10s' });
        }
        const query = String(args.query || '').trim();
        const limit = Math.max(1, Math.min(50, Number(args.limit || 10)));
        const scope = ['code', 'events', 'all'].includes(args.scope) ? args.scope : 'code';
        if (!query) return jsonText({ ok: false, error: 'query is required' });
        const result = await memoryIndex.semanticSearch(query, limit, scope);
        return jsonText(result);
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  }

  const SESSION_TOKEN = crypto.randomBytes(32).toString('hex');

  app.use(cors({ origin: /^http:\/\/localhost(:\d+)?$/ }));
  app.use((req, res, next) => {
    if (req.method === 'OPTIONS') return next();
    const token = req.headers['x-hermes-token'] || req.query.token;
    if (token !== SESSION_TOKEN) return res.sendStatus(403);
    next();
  });
  app.use(express.json());

  emitter.sessionToken = SESSION_TOKEN;

  // SSE monitor endpoint
  app.get('/events', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    // Send current snapshot
    res.write(`data: ${JSON.stringify({
      type: 'snapshot',
      data: {
        messages: messages.slice(-200),
        agents: [...agents.values()],
        sharedState,
        artifacts,
        toolCalls: toolCalls.slice(-1000),
        diffTimeline: diffTimeline.slice(-1000),
        agentNodes: [...agentNodes.values()],
        agentActivities: Object.fromEntries([...agentActivities.entries()]),
      },
    })}\n\n`);

    const keepalive = setInterval(() => {
      try { res.write(': ping\n\n'); } catch { clearInterval(keepalive); }
    }, 15000);

    sseClients.add(res);
    req.on('close', () => {
      sseClients.delete(res);
      clearInterval(keepalive);
    });
  });

  // MCP JSON-RPC endpoint
  app.post('/', async (req, res) => {
    const body = req.body;

    // Notification (no id) — return 204
    if (body.id === undefined) {
      res.sendStatus(204);
      return;
    }

    const { method, params, id } = body;

    try {
      switch (method) {
        case 'initialize':
          res.json({
            jsonrpc: '2.0',
            result: {
              protocolVersion: '2024-11-05',
              capabilities: { tools: {} },
              serverInfo: { name: 'hermes', version: PKG_VERSION },
            },
            id,
          });
          break;

        case 'ping':
          res.json({ jsonrpc: '2.0', result: {}, id });
          break;

        case 'tools/list':
          res.json({ jsonrpc: '2.0', result: { tools: TOOLS }, id });
          break;

        case 'tools/call': {
          const { name, arguments: args = {} } = params;
          const result = await handleTool(name, args);
          res.json({ jsonrpc: '2.0', result, id });
          break;
        }

        default:
          res.json({
            jsonrpc: '2.0',
            error: { code: -32601, message: `Method not found: ${method}` },
            id,
          });
      }
    } catch (err) {
      res.json({
        jsonrpc: '2.0',
        error: { code: -32603, message: err.message },
        id,
      });
    }
  });

  // Control endpoints for the renderer
  app.delete('/messages', (req, res) => {
    messages.length = 0;
    broadcast('cleared', { target: 'messages' });
    res.sendStatus(204);
  });

  app.delete('/state', (req, res) => {
    for (const k of Object.keys(sharedState)) delete sharedState[k];
    broadcast('cleared', { target: 'state' });
    res.sendStatus(204);
  });

  app.get('/state', (req, res) => {
    res.json(sharedState);
  });

  const server = app.listen(port, '127.0.0.1', () => {
    console.log(`[MCP] Server listening on http://localhost:${port}`);
  });

  server.on('error', (err) => {
    console.error('[MCP] Server error:', err);
    emitter.emit('error', err);
  });

  emitter.getMessages = () => messages.slice();
  emitter.getAgents = () => [...agents.values()];
  emitter.getSharedState = () => ({ ...sharedState });
  emitter.getArtifacts = () => artifacts.slice();
  emitter.getToolCalls = () => toolCalls.slice();
  emitter.getDiffTimeline = () => diffTimeline.slice();
  emitter.getAgentNodes = () => [...agentNodes.values()];
  emitter.getAgentActivities = () => Object.fromEntries([...agentActivities.entries()]);
  emitter.registerAgent = (id, label) => {
    const agent = {
      id: String(id || ''),
      label: String(label || ''),
      status: 'idle',
      registeredAt: Date.now(),
    };
    if (!agent.id || !agent.label) throw new Error('register_agent requires id and label');
    agents.set(agent.id, agent);
    broadcast('agent', agent);
    return agent;
  };
  emitter.mapTerminal = (terminalId, agentId) => {
    const tid = String(terminalId);
    const aid = String(agentId);
    terminalToAgent.set(tid, aid);
    agentToTerminal.set(aid, tid);
  };
  emitter.getTerminalForAgent = (agentId) => agentToTerminal.get(String(agentId));
  emitter.recordAutoToolCall = (terminalId, toolName, filePath, op) => {
    const agentId = terminalToAgent.get(String(terminalId)) || `terminal-${terminalId}`;
    const item = {
      agent_id: agentId,
      tool_name: String(toolName),
      file_path: String(filePath || ''),
      op: String(op || ''),
      timestamp: Date.now(),
      reasoning: '',
      auto: true,
    };
    toolCalls.push(item);
    if (toolCalls.length > 5000) toolCalls.splice(0, toolCalls.length - 5000);
    broadcast('tool_call', item);
  };
  emitter.updateAgentStatus = (terminalId, status) => {
    const agentId = terminalToAgent.get(String(terminalId));
    if (!agentId) return;
    const agent = agents.get(agentId);
    if (!agent) return;
    agent.status = String(status);
    broadcast('agent', agent);
  };
  emitter.recordAgentCost = (terminalId, tokens, usd) => {
    const agentId = terminalToAgent.get(String(terminalId)) || `terminal-${terminalId}`;
    broadcast('agent_cost', { agent_id: agentId, terminal_id: String(terminalId), tokens, usd });
  };
  emitter.clearMessages = () => {
    messages.length = 0;
    broadcast('cleared', { target: 'messages' });
  };
  emitter.resetState = () => {
    for (const k of Object.keys(sharedState)) delete sharedState[k];
    broadcast('cleared', { target: 'state' });
  };
  emitter.close = () => {
    for (const res of sseClients) {
      try { res.end(); } catch { /* ignore */ }
    }
    sseClients.clear();
    server.close();
  };

  return emitter;
}

module.exports = { createMcpServer };
