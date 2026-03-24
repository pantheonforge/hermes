import React, {
  useState, useEffect, useRef, useCallback, useImperativeHandle, forwardRef,
} from 'react';
import { Terminal as XTerm } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';

const MAX_HINT_HISTORY = 200;

function normalizeHistoryEntry(value) {
  return String(value || '').trim();
}

function splitSubmittedCommands(value) {
  return String(value || '')
    .split(/\r\n|\r|\n/g)
    .map(normalizeHistoryEntry)
    .filter(Boolean);
}

function pickPrediction(history, prefix) {
  const normalizedPrefix = String(prefix || '');
  const lowerPrefix = normalizedPrefix.toLowerCase();
  if (!lowerPrefix.trim()) return null;
  for (let i = history.length - 1; i >= 0; i -= 1) {
    const candidate = history[i];
    if (!candidate) continue;
    const lowerCandidate = candidate.toLowerCase();
    if (!lowerCandidate.startsWith(lowerPrefix)) continue;
    if (lowerCandidate === lowerPrefix) continue;
    return candidate;
  }
  return null;
}

function isPrintableChar(ch) {
  if (!ch || ch.length !== 1) return false;
  const code = ch.charCodeAt(0);
  return code >= 32 && code !== 127;
}

function stripAnsi(input) {
  return String(input || '')
    .replace(/\x1B\][^\x07]*(\x07|\x1B\\)/g, '')
    .replace(/\x1B\[[0-9;?]*[ -/]*[@-~]/g, '')
    .replace(/\x1B[@-_]/g, '');
}

const Terminal = forwardRef(function Terminal(
  { id, config, cwd, startupCommand, focused, onFocus, onCwd, onClearSummary },
  ref
) {
  const containerRef = useRef(null);
  const xtermRef = useRef(null);
  const fitRef = useRef(null);
  const [status, setStatus] = useState('idle');
  const [error, setError] = useState(null);
  const [ptyReady, setPtyReady] = useState(false);
  const [ptyKey, setPtyKey] = useState(0);
  const [hintSuffix, setHintSuffix] = useState('');
  const [hintPos, setHintPos] = useState(null);
  const [outputBlockText, setOutputBlockText] = useState('');
  const currentCwdRef = useRef(cwd || config.cwd || '');
  const commandHistoryRef = useRef([]);
  const inputBufferRef = useRef('');
  const hintRequestRef = useRef(0);
  const startupRunRef = useRef(false);
  const expectedCursorRowRef = useRef(null);
  // Escape sequence parser state: 0=normal, 1=after ESC, 2=in CSI, 3=in OSC, 4=OSC+ESC
  const escStateRef = useRef(0);

  useEffect(() => {
    currentCwdRef.current = cwd || currentCwdRef.current || config.cwd || '';
  }, [cwd, config.cwd]);

  const addHistoryEntries = useCallback((values) => {
    if (!Array.isArray(values) || values.length === 0) return;
    const next = [...commandHistoryRef.current];
    for (const value of values) {
      const entry = normalizeHistoryEntry(value);
      if (!entry) continue;
      if (next[next.length - 1] === entry) continue;
      next.push(entry);
      if (next.length > MAX_HINT_HISTORY) next.splice(0, next.length - MAX_HINT_HISTORY);
    }
    commandHistoryRef.current = next;
  }, []);

  const refreshHint = useCallback(async () => {
    const requestId = ++hintRequestRef.current;
    const buffer = inputBufferRef.current;
    const looksLikeCd = /^\s*cd(?:\s+.*)?$/.test(buffer);
    if (looksLikeCd) {
      try {
        const cdSuffix = await window.electron.pty.getCdHint(currentCwdRef.current, buffer);
        if (hintRequestRef.current !== requestId) return;
        if (cdSuffix) {
          setHintSuffix(String(cdSuffix));
          return;
        }
      } catch {
        if (hintRequestRef.current !== requestId) return;
      }
    }
    const prediction = pickPrediction(commandHistoryRef.current, buffer);
    if (!prediction) {
      if (hintRequestRef.current === requestId) {
        setHintSuffix('');
      }
      return;
    }
    if (hintRequestRef.current === requestId) setHintSuffix(prediction.slice(buffer.length));
  }, []);

  const updateHintPosition = useCallback(() => {
    if (!containerRef.current) return;
    const term = xtermRef.current;
    if (!term) return;
    const currentRow = term.buffer.active.cursorY;
    if (expectedCursorRowRef.current !== null && currentRow !== expectedCursorRowRef.current) {
      setHintSuffix('');
      setHintPos(null);
      return;
    }
    const helper = containerRef.current.querySelector('.xterm-helper-textarea');
    if (!helper) return;
    const bodyRect = containerRef.current.getBoundingClientRect();
    const helperRect = helper.getBoundingClientRect();
    const left = Math.max(6, (helperRect.left - bodyRect.left) + 2);
    const top = Math.max(4, (helperRect.top - bodyRect.top) - 1);
    setHintPos((prev) => {
      if (prev && Math.abs(prev.left - left) < 1 && Math.abs(prev.top - top) < 1) return prev;
      return { left, top };
    });
  }, []);

  // Init xterm
  useEffect(() => {
    if (!containerRef.current) return;

    const term = new XTerm({
      scrollback: 5000,
      fontSize: config.fontSize || 13,
      fontFamily: config.fontFamily || 'monospace',

      theme: {
        background: '#0d1117',
        foreground: '#c9d1d9',
        cursor: '#3fb950',
        cursorAccent: '#0d1117',
        selectionBackground: 'rgba(63,185,80,0.2)',
        black: '#484f58',
        red: '#ff7b72',
        green: '#3fb950',
        yellow: '#d29922',
        blue: '#3fb950',
        magenta: '#bc8cff',
        cyan: '#76e3ea',
        white: '#b1bac4',
        brightBlack: '#6e7681',
        brightRed: '#ffa198',
        brightGreen: '#56d364',
        brightYellow: '#e3b341',
        brightBlue: '#7ee787',
        brightMagenta: '#d2a8ff',
        brightCyan: '#b3f0ff',
        brightWhite: '#f0f6fc',
      },
      allowProposedApi: true,
    });

    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(containerRef.current);

    xtermRef.current = term;
    fitRef.current = fit;

    try { fit.fit(); } catch { }

    return () => {
      term.dispose();
      xtermRef.current = null;
      fitRef.current = null;
    };
  }, []);

  // Spawn PTY - re-runs when ptyKey increments (restart)
  useEffect(() => {
    let cancelled = false;

    window.electron.pty
      .create(id, {
        cwd: currentCwdRef.current || config.cwd,
        cols: xtermRef.current?.cols || 80,
        rows: xtermRef.current?.rows || 24,
      })
      .then(() => {
        if (!cancelled) {
          setPtyReady(true);
          setStatus('running');
          setError(null);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(`Failed to start PTY: ${err.message}`);
          setStatus('error');
        }
      });

    return () => {
      cancelled = true;
      window.electron.pty.kill(id);
    };
  }, [id, ptyKey, config.cwd]);

  useEffect(() => {
    if (!ptyReady || startupRunRef.current) return;
    const command = String(startupCommand || '').trim();
    if (!command) {
      startupRunRef.current = true;
      return;
    }
    addHistoryEntries([command]);
    window.electron.pty.input(id, `${command}\r`);
    inputBufferRef.current = '';
    setHintSuffix('');
    startupRunRef.current = true;
  }, [id, ptyReady, startupCommand, addHistoryEntries]);

  // Wire PTY output -> xterm
  useEffect(() => {
    const cleanup = window.electron.pty.onOutput((ptId, data) => {
      if (ptId !== id || !xtermRef.current) return;
      xtermRef.current.write(data);
      setOutputBlockText((prev) => `${prev}${stripAnsi(data)}`.slice(-20000));
    });
    return cleanup;
  }, [id]);

  // PTY exit
  useEffect(() => {
    const cleanup = window.electron.pty.onExit((ptId, code) => {
      if (ptId !== id) return;
      setStatus('idle');
      if (xtermRef.current) {
        xtermRef.current.write(`\r\n\x1b[2m[process exited with code ${code}]\x1b[0m\r\n`);
      }
    });
    return cleanup;
  }, [id]);

  // PTY cwd
  useEffect(() => {
    const cleanup = window.electron.pty.onCwd((ptId, nextCwd) => {
      if (ptId !== id) return;
      currentCwdRef.current = nextCwd || currentCwdRef.current;
      onCwd?.(nextCwd);
    });
    return cleanup;
  }, [id, onCwd]);

  // Xterm -> PTY input
  useEffect(() => {
    if (!xtermRef.current) return;
    const disposable = xtermRef.current.onData((data) => {
      if (!ptyReady || !focused) return;

      if (data === '\t' && hintSuffix) {
        window.electron.pty.input(id, hintSuffix);
        inputBufferRef.current += hintSuffix;
        expectedCursorRowRef.current = xtermRef.current?.buffer.active.cursorY ?? null;
        setHintSuffix('');
        refreshHint().catch(() => {});
        updateHintPosition();
        return;
      }

      for (const ch of data) {
        // Skip characters that are part of an escape sequence (arrow keys, OSC, etc.)
        // so they don't corrupt the input buffer or trigger spurious clears.
        const esc = escStateRef.current;
        if (esc !== 0 && ch !== '\r' && ch !== '\x03') {
          if (esc === 1) {
            escStateRef.current = ch === '[' ? 2 : ch === ']' ? 3 : 0;
          } else if (esc === 2) {
            if (ch >= '@' && ch <= '~') escStateRef.current = 0; // end of CSI
          } else if (esc === 3) {
            if (ch === '\x07') escStateRef.current = 0; // BEL ends OSC
            else if (ch === '\x1b') escStateRef.current = 4; // ST first byte
          } else {
            escStateRef.current = 0; // ST second byte or other two-char seq done
          }
          continue;
        }
        escStateRef.current = 0;

        if (ch === '\r') {
          const submitted = inputBufferRef.current;
          addHistoryEntries([inputBufferRef.current]);
          inputBufferRef.current = '';
          expectedCursorRowRef.current = null;
          setHintSuffix('');
          setOutputBlockText('');
          onClearSummary?.(id);
          if (/^\s*cd(?:\s+.*)?$/.test(submitted)) {
            window.electron.pty.resolveCd(currentCwdRef.current, submitted)
              .then((nextCwd) => {
                if (!nextCwd) return;
                currentCwdRef.current = nextCwd;
                onCwd?.(nextCwd);
              })
              .catch(() => {});
          }
          // After any Enter, poll the PTY's stored cwd (updated by PROMPT_COMMAND
          // OSC 7 emission in new sessions) to catch changes the input tracking missed.
          setTimeout(() => {
            window.electron.pty.getCwd(id).then((freshCwd) => {
              if (freshCwd && freshCwd !== currentCwdRef.current) {
                currentCwdRef.current = freshCwd;
                onCwd?.(freshCwd);
              }
            }).catch(() => {});
          }, 400);
        } else if (ch === '\x7F') {
          inputBufferRef.current = inputBufferRef.current.slice(0, -1);
          if (inputBufferRef.current.length === 0) expectedCursorRowRef.current = null;
        } else if (ch === '\x03') {
          inputBufferRef.current = '';
          expectedCursorRowRef.current = null;
          setHintSuffix('');
        } else if (ch === '\x1b') {
          // Start of escape sequence — clear hint but preserve buffer
          escStateRef.current = 1;
          setHintSuffix('');
        } else if (isPrintableChar(ch)) {
          inputBufferRef.current += ch;
          expectedCursorRowRef.current = xtermRef.current?.buffer.active.cursorY ?? null;
        }
      }

      window.electron.pty.input(id, data);
      refreshHint().catch(() => {});
      if (hintSuffix) updateHintPosition();
    });
    return () => disposable.dispose();
  }, [id, ptyReady, focused, hintSuffix, addHistoryEntries, refreshHint, updateHintPosition, onCwd]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;
    const onKeyDown = async (event) => {
      if (!focused || !ptyReady) return;
      const key = String(event.key || '').toLowerCase();
      const isMac = navigator.platform.toUpperCase().includes('MAC');
      const mod = isMac ? event.metaKey : event.ctrlKey;
      if (!mod) return;
      if (event.altKey) return;
      if (key === 'c') {
        const selection = xtermRef.current?.getSelection?.() || '';
        if (!selection) return;
        event.preventDefault();
        await window.electron.clipboard.writeText(selection).catch(() => {});
        return;
      }
      const canPaste = key === 'v';
      if (!canPaste) return;
      event.preventDefault();
      const pasted = await window.electron.clipboard.readText().catch(() => '');
      if (!pasted) return;
      xtermRef.current?.paste(pasted);
    };
    container.addEventListener('keydown', onKeyDown, true);
    return () => container.removeEventListener('keydown', onKeyDown, true);
  }, [focused, ptyReady]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;
    const onContextMenu = async (event) => {
      const selection = xtermRef.current?.getSelection?.() || '';
      if (!selection) return;
      event.preventDefault();
      await window.electron.clipboard.writeText(selection).catch(() => {});
    };
    container.addEventListener('contextmenu', onContextMenu, true);
    return () => container.removeEventListener('contextmenu', onContextMenu, true);
  }, []);

  // Focus handling
  useEffect(() => {
    if (!xtermRef.current) return;
    if (focused) xtermRef.current.focus();
    else xtermRef.current.blur();
  }, [focused]);

  useEffect(() => {
    if (!focused) {
      setHintSuffix('');
      setHintPos(null);
      return;
    }
    refreshHint().catch(() => {});
  }, [focused, refreshHint]);

  useEffect(() => {
    if (!focused || !hintSuffix) return undefined;
    const raf = window.requestAnimationFrame(updateHintPosition);
    return () => window.cancelAnimationFrame(raf);
  }, [focused, hintSuffix, updateHintPosition]);

  // Resize observer
  useEffect(() => {
    if (!containerRef.current) return;
    let raf = 0;
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        if (!fitRef.current || !xtermRef.current) return;
        try {
          fitRef.current.fit();
          window.electron.pty.resize(id, xtermRef.current.cols, xtermRef.current.rows);
        } catch { }
      });
    });
    ro.observe(containerRef.current);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); };
  }, [id]);

  const launchTool = useCallback(async (tool) => {
    if (!ptyReady) return;
    const cmd = tool === 'codex' ? (config.codexCmd || 'codex') : (config.claudeCmd || 'claude');
    const mcpFlag = tool === 'codex'
      ? (() => {
        const port = Number(config.mcpPort || 0);
        if (!(port > 0)) return '';
        return ` -c 'mcp_servers.hermes.url="http://localhost:${port}"' -c 'mcp_servers.hermes.transport="streamable_http"' -c 'mcp_servers.hermes.enabled=true'`;
      })()
      : (config.mcpConfigPath ? ` --mcp-config "${config.mcpConfigPath}"` : '');
    if (Number(config.mcpPort || 0) > 0) {
      try {
        await window.electron.mcp.registerAgent({
          tool,
          terminalId: id,
          cwd: currentCwdRef.current || config.cwd || '',
        });
      } catch { }
    }
    const command = `${cmd}${mcpFlag}`;
    addHistoryEntries([command]);
    window.electron.pty.input(id, `${command}\r`);
    inputBufferRef.current = '';
    setHintSuffix('');
  }, [id, ptyReady, config.claudeCmd, config.codexCmd, config.cwd, config.mcpConfigPath, config.mcpPort, addHistoryEntries]);

  const launchClaude = useCallback(() => {
    launchTool('claude');
  }, [launchTool]);

  const launchCodex = useCallback(() => {
    launchTool('codex');
  }, [launchTool]);

  const clear = useCallback(() => {
    if (ptyReady) {
      window.electron.pty.input(id, '\x0c');
    }
    xtermRef.current?.clear();
    inputBufferRef.current = '';
    expectedCursorRowRef.current = null;
    setHintSuffix('');
    setHintPos(null);
  }, [id, ptyReady]);

  const restartTool = useCallback((tool) => {
    if (!ptyReady) return;
    window.electron.pty.input(id, '\x03');
    setTimeout(() => launchTool(tool), 300);
  }, [id, ptyReady, launchTool]);

  const restartClaude = useCallback(() => {
    restartTool('claude');
  }, [restartTool]);

  const restartCodex = useCallback(() => {
    restartTool('codex');
  }, [restartTool]);

  const restartShell = useCallback(() => {
    setPtyKey((k) => k + 1);
    inputBufferRef.current = '';
    expectedCursorRowRef.current = null;
    setHintSuffix('');
    setHintPos(null);
  }, []);

  const runCommand = useCallback((command) => {
    if (!ptyReady || !command) return;
    addHistoryEntries(splitSubmittedCommands(command));
    window.electron.pty.input(id, String(command));
    if (/\r|\n/.test(String(command))) {
      inputBufferRef.current = '';
      setHintSuffix('');
    } else {
      inputBufferRef.current += String(command);
      refreshHint().catch(() => {});
    }
  }, [id, ptyReady, addHistoryEntries, refreshHint]);

  const focus = useCallback(() => {
    xtermRef.current?.focus();
  }, []);

  useImperativeHandle(ref, () => ({
    focus,
    launchClaude,
    launchCodex,
    clear,
    restartClaude,
    restartCodex,
    restartShell,
    runCommand,
  }), [
    focus,
    launchClaude,
    launchCodex,
    clear,
    restartClaude,
    restartCodex,
    restartShell,
    runCommand,
  ]);

  return (
    <div
      className={`terminal-pane${focused ? ' focused' : ''}`}
      onClick={onFocus}
      onMouseDown={() => { if (!focused) onFocus?.(); }}
    >
      {error && <div className="terminal-error-banner">{error}</div>}
      <div className="terminal-body" ref={containerRef} />
      {focused && hintSuffix && hintPos && (
        <div
          className="terminal-hint-inline"
          style={{ left: `${hintPos.left}px`, top: `${hintPos.top}px` }}
        >
          {hintSuffix}
        </div>
      )}
      {status === 'idle' && (
        <button
          className="restart-btn"
          onClick={(e) => { e.stopPropagation(); restartShell(); }}
          title="Restart terminal"
        >
          ↺
        </button>
      )}
    </div>
  );
});

export default Terminal;
