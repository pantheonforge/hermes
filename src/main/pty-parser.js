const ANSI_RE = /\x1b(?:\[[0-9;]*[mGKHFABCDEJsu]|\][^\x07]*\x07|[()][0-9A-Za-z]|[=>])/g;

// Claude Code tool call lines: ⏺ ToolName(args) or ● ToolName(args)
const TOOL_RE = /[⏺●]\s*(Read|Write|Edit|Bash|Glob|Grep|Task|WebFetch|WebSearch|MultiEdit|NotebookEdit|TodoWrite|TodoRead)\(([^)]*)\)/;

// Cost patterns: "1,234 tokens · $0.04" or "$0.04 (1,234 tokens)"
const COST_RE = /(\d[\d,]*)\s*tokens[^$]*\$\s*([\d.]+)/i;
const COST_RE2 = /\$\s*([\d.]+)[^(]*\(\s*(\d[\d,]*)\s*tokens/i;

const FILE_TOOLS = new Set(['Read', 'Write', 'Edit', 'Glob', 'MultiEdit', 'NotebookEdit']);
const WRITE_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);

class PtyParser {
  constructor() {
    this._bufs = new Map();
    this._idleTimers = new Map();
    this._mcpServer = null;
  }

  attach(ptyManager, mcpServer) {
    this._mcpServer = mcpServer;
    ptyManager.on('output', (id, data) => this._onOutput(id, data));
    ptyManager.on('exit', (id) => {
      this._bufs.delete(id);
      clearTimeout(this._idleTimers.get(id));
      this._idleTimers.delete(id);
    });
  }

  _strip(str) {
    return str.replace(ANSI_RE, '');
  }

  _resetIdleTimer(id) {
    clearTimeout(this._idleTimers.get(id));
    const t = setTimeout(() => {
      this._mcpServer?.updateAgentStatus(id, 'idle');
    }, 3000);
    this._idleTimers.set(id, t);
  }

  _onOutput(id, data) {
    const buf = (this._bufs.get(id) || '') + data;
    const lines = buf.split(/\r?\n/);
    const partial = lines.pop() || '';
    this._bufs.set(id, partial.length > 2048 ? partial.slice(-2048) : partial);
    for (const raw of lines) {
      const line = this._strip(raw).trim();
      if (line) this._parseLine(id, line);
    }
  }

  _parseLine(terminalId, line) {
    const toolMatch = line.match(TOOL_RE);
    if (toolMatch) {
      const toolName = toolMatch[1];
      const args = toolMatch[2];
      let filePath = '';
      if (FILE_TOOLS.has(toolName)) {
        filePath = args.split(',')[0].trim().replace(/^["']|["']$/g, '');
      }
      const op = toolName === 'Read' ? 'read' : WRITE_TOOLS.has(toolName) ? 'write' : '';
      this._mcpServer?.recordAutoToolCall(terminalId, toolName, filePath, op);
      this._mcpServer?.updateAgentStatus(terminalId, 'working');
      this._resetIdleTimer(terminalId);
      return;
    }

    const m1 = line.match(COST_RE);
    if (m1) {
      this._mcpServer?.recordAgentCost(terminalId, parseInt(m1[1].replace(/,/g, ''), 10), parseFloat(m1[2]));
      return;
    }
    const m2 = line.match(COST_RE2);
    if (m2) {
      this._mcpServer?.recordAgentCost(terminalId, parseInt(m2[2].replace(/,/g, ''), 10), parseFloat(m2[1]));
    }
  }
}

module.exports = { PtyParser };
