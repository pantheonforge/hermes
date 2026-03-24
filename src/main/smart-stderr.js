const ANSI_RE = /\x1B\][^\x07]*(\x07|\x1B\\)|\x1B\[[0-9;?]*[ -/]*[@-~]|\x1B[@-_]/g;

const patterns = [
  {
    pattern: /\b(module not found|cannot find module)\b/i,
    type: 'MODULE_NOT_FOUND',
    causeTemplate: 'A required package or file import is missing or the path is wrong.',
    fixTemplate: 'Install the missing dependency or correct the import/require path and extension.',
  },
  {
    pattern: /\btypeerror\b/i,
    type: 'TYPE_ERROR',
    causeTemplate: 'A value is being used with the wrong type at runtime.',
    fixTemplate: 'Inspect the failing call site and add guards/conversions for null/undefined or wrong types.',
  },
  {
    pattern: /\bsyntaxerror\b/i,
    type: 'SYNTAX_ERROR',
    causeTemplate: 'There is invalid language syntax in the source file.',
    fixTemplate: 'Open the referenced file/line and fix the parser error (missing bracket, quote, comma, or token).',
  },
  {
    pattern: /\b(eacces|eperm|permission denied|operation not permitted)\b/i,
    type: 'PERMISSION_DENIED',
    causeTemplate: 'The process does not have permission for the requested file, path, or operation.',
    fixTemplate: 'Adjust file permissions or run from an allowed directory/context with required access.',
  },
  {
    pattern: /\b(eaddrinuse|address already in use|port .*in use)\b/i,
    type: 'PORT_IN_USE',
    causeTemplate: 'Another process is already listening on the target port.',
    fixTemplate: 'Stop the conflicting process or configure this app/tool to use a different port.',
  },
  {
    pattern: /\b(test failed|failing tests|failed:|assert(?:ion)?error|expect\(.*\)\.to)/i,
    type: 'TEST_FAILURE',
    causeTemplate: 'One or more test assertions failed or the test runtime reported a failure.',
    fixTemplate: 'Review the failing test output and update implementation or test expectations accordingly.',
  },
];

function stripAnsi(input) {
  return String(input || '').replace(ANSI_RE, '');
}

function firstNonEmptyLine(input) {
  const lines = String(input || '').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed) return trimmed;
  }
  return '';
}

function isLikelyErrorChunk(input) {
  const text = stripAnsi(input);
  if (!text.trim()) return false;
  if (/\b[A-Za-z]*[Ee]rror\b/.test(text)) return true;
  if (/\b(exception|traceback|fatal|failed|eaddrinuse|eacces|eperm|enoent)\b/i.test(text)) return true;
  if (/\b(command not found|module not found|no such file|file not found|permission denied)\b/i.test(text)) return true;
  if (/\bat\s+.+\(.+:\d+:\d+\)/.test(text)) return true;
  if (/[A-Za-z0-9_./\\-]+:\d+:\d+/.test(text)) return true;
  return false;
}

function classify(raw) {
  for (const entry of patterns) {
    try {
      if (entry.pattern.test(raw)) {
        return {
          type: entry.type,
          cause: entry.causeTemplate,
          fix: entry.fixTemplate,
        };
      }
    } catch {}
  }
  return {
    type: 'UNKNOWN',
    cause: 'Could not match this error to a known local pattern.',
    fix: 'Inspect stack frames and nearby command output, then apply a targeted fix.',
  };
}

function parseFramesFallback(raw) {
  const out = [];
  const lines = String(raw || '').split(/\r?\n/);
  for (const line of lines) {
    const m = line.match(/(?:at\s+.+\(|\s*)([A-Za-z]:\\[^:\n]+|\/[^:\n]+):(\d+):(\d+)\)?/);
    if (!m) continue;
    out.push({
      file: String(m[1] || ''),
      line: Number(m[2] || 0),
      column: Number(m[3] || 0),
      method: '',
    });
  }
  return out.slice(0, 20);
}

function createSmartStderrCollector({ onEntry, inactivityMs = 900 } = {}) {
  const states = new Map();
  const timers = new Map();

  const clearTimer = (terminalId) => {
    const timer = timers.get(terminalId);
    if (timer) clearTimeout(timer);
    timers.delete(terminalId);
  };

  const flush = (terminalId) => {
    const state = states.get(terminalId);
    if (!state || !state.raw.trim()) return;
    states.delete(terminalId);
    clearTimer(terminalId);
    const raw = state.raw.slice(0, 50000);
    const info = classify(raw);
    const frames = parseFramesFallback(raw);
    onEntry?.({
      id: `stderr-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      terminalId,
      cwd: state.cwd || '',
      timestamp: Date.now(),
      firstLine: firstNonEmptyLine(raw).slice(0, 300),
      raw,
      type: info.type,
      cause: info.cause,
      fix: info.fix,
      stackFrames: frames,
    });
  };

  const scheduleFlush = (terminalId) => {
    clearTimer(terminalId);
    const timer = setTimeout(() => {
      flush(terminalId);
    }, inactivityMs);
    timers.set(terminalId, timer);
  };

  const handleOutput = (terminalId, data, cwd) => {
    const chunk = stripAnsi(data);
    if (!chunk) return;
    const now = Date.now();
    const state = states.get(terminalId);
    const isError = isLikelyErrorChunk(chunk);

    if (!state) {
      if (!isError) return;
      states.set(terminalId, {
        raw: chunk,
        cwd: String(cwd || '').trim(),
        startedAt: now,
        lastAt: now,
      });
      scheduleFlush(terminalId);
      return;
    }

    const gap = now - Number(state.lastAt || now);
    if (gap > inactivityMs * 2 && !isError) {
      flush(terminalId);
      return;
    }

    state.raw += chunk;
    state.lastAt = now;
    if (cwd) state.cwd = String(cwd || '').trim();
    states.set(terminalId, state);
    if (state.raw.length >= 50000 || state.raw.split(/\r?\n/).length >= 220) {
      flush(terminalId);
      return;
    }
    scheduleFlush(terminalId);
  };

  const clearTerminal = (terminalId) => {
    states.delete(terminalId);
    clearTimer(terminalId);
  };

  const clearAll = () => {
    states.clear();
    for (const timer of timers.values()) clearTimeout(timer);
    timers.clear();
  };

  return {
    handleOutput,
    clearTerminal,
    clearAll,
  };
}

module.exports = { createSmartStderrCollector };
