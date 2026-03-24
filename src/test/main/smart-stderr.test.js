import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createSmartStderrCollector } from '../../main/smart-stderr.js';

describe('createSmartStderrCollector', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('ignores non-error chunks', () => {
    const onEntry = vi.fn();
    const { handleOutput } = createSmartStderrCollector({ onEntry, inactivityMs: 100 });
    handleOutput('t1', 'normal output text', '/cwd');
    vi.advanceTimersByTime(200);
    expect(onEntry).not.toHaveBeenCalled();
  });

  it('collects error chunk and flushes after inactivity', () => {
    const onEntry = vi.fn();
    const { handleOutput } = createSmartStderrCollector({ onEntry, inactivityMs: 100 });
    handleOutput('t1', 'TypeError: cannot read property', '/cwd');
    vi.advanceTimersByTime(150);
    expect(onEntry).toHaveBeenCalledOnce();
    const entry = onEntry.mock.calls[0][0];
    expect(entry.terminalId).toBe('t1');
    expect(entry.type).toBe('TYPE_ERROR');
    expect(entry.cwd).toBe('/cwd');
    expect(typeof entry.id).toBe('string');
    expect(typeof entry.timestamp).toBe('number');
  });

  it('classifies MODULE_NOT_FOUND', () => {
    const onEntry = vi.fn();
    const { handleOutput } = createSmartStderrCollector({ onEntry, inactivityMs: 50 });
    handleOutput('t1', "Error: Cannot find module 'foo'", '/cwd');
    vi.advanceTimersByTime(100);
    expect(onEntry.mock.calls[0][0].type).toBe('MODULE_NOT_FOUND');
  });

  it('classifies PORT_IN_USE', () => {
    const onEntry = vi.fn();
    const { handleOutput } = createSmartStderrCollector({ onEntry, inactivityMs: 50 });
    handleOutput('t1', 'Error: listen EADDRINUSE :::3000', '/cwd');
    vi.advanceTimersByTime(100);
    expect(onEntry.mock.calls[0][0].type).toBe('PORT_IN_USE');
  });

  it('classifies PERMISSION_DENIED', () => {
    const onEntry = vi.fn();
    const { handleOutput } = createSmartStderrCollector({ onEntry, inactivityMs: 50 });
    handleOutput('t1', 'Error: EACCES: permission denied', '/cwd');
    vi.advanceTimersByTime(100);
    expect(onEntry.mock.calls[0][0].type).toBe('PERMISSION_DENIED');
  });

  it('classifies SYNTAX_ERROR', () => {
    const onEntry = vi.fn();
    const { handleOutput } = createSmartStderrCollector({ onEntry, inactivityMs: 50 });
    handleOutput('t1', 'SyntaxError: Unexpected token at /app/index.js:5:1', '/cwd');
    vi.advanceTimersByTime(100);
    expect(onEntry.mock.calls[0][0].type).toBe('SYNTAX_ERROR');
  });

  it('classifies TEST_FAILURE', () => {
    const onEntry = vi.fn();
    const { handleOutput } = createSmartStderrCollector({ onEntry, inactivityMs: 50 });
    handleOutput('t1', '  ✗ test failed: expected 1 to equal 2', '/cwd');
    vi.advanceTimersByTime(100);
    expect(onEntry.mock.calls[0][0].type).toBe('TEST_FAILURE');
  });

  it('classifies unrecognised errors as UNKNOWN', () => {
    const onEntry = vi.fn();
    const { handleOutput } = createSmartStderrCollector({ onEntry, inactivityMs: 50 });
    // 'error' at word boundary triggers isLikelyErrorChunk; no known pattern matches → UNKNOWN
    handleOutput('t1', 'Error: something unexpected happened', '/cwd');
    vi.advanceTimersByTime(100);
    expect(onEntry.mock.calls[0][0].type).toBe('UNKNOWN');
  });

  it('strips ANSI before classification', () => {
    const onEntry = vi.fn();
    const { handleOutput } = createSmartStderrCollector({ onEntry, inactivityMs: 50 });
    // 'cannot' ensures isLikelyErrorChunk fires after ANSI is stripped
    handleOutput('t1', '\x1b[31mTypeError: cannot read value\x1b[0m', '/cwd');
    vi.advanceTimersByTime(100);
    expect(onEntry).toHaveBeenCalledOnce();
    expect(onEntry.mock.calls[0][0].type).toBe('TYPE_ERROR');
  });

  it('clearTerminal cancels pending flush', () => {
    const onEntry = vi.fn();
    const { handleOutput, clearTerminal } = createSmartStderrCollector({ onEntry, inactivityMs: 100 });
    handleOutput('t1', 'TypeError: bad', '/cwd');
    clearTerminal('t1');
    vi.advanceTimersByTime(200);
    expect(onEntry).not.toHaveBeenCalled();
  });

  it('clearAll cancels all pending flushes', () => {
    const onEntry = vi.fn();
    const { handleOutput, clearAll } = createSmartStderrCollector({ onEntry, inactivityMs: 100 });
    handleOutput('t1', 'TypeError: bad', '/cwd');
    handleOutput('t2', 'Error: denied', '/cwd');
    clearAll();
    vi.advanceTimersByTime(200);
    expect(onEntry).not.toHaveBeenCalled();
  });

  it('isolates state per terminal', () => {
    const onEntry = vi.fn();
    const { handleOutput } = createSmartStderrCollector({ onEntry, inactivityMs: 50 });
    handleOutput('t1', 'TypeError: cannot read x', '/cwd');
    handleOutput('t2', 'Error: EACCES', '/cwd');
    vi.advanceTimersByTime(100);
    expect(onEntry).toHaveBeenCalledTimes(2);
    const types = onEntry.mock.calls.map((c) => c[0].type);
    expect(types).toContain('TYPE_ERROR');
    expect(types).toContain('PERMISSION_DENIED');
  });

  it('entry includes stack frames from file:line:col pattern', () => {
    const onEntry = vi.fn();
    const { handleOutput } = createSmartStderrCollector({ onEntry, inactivityMs: 50 });
    handleOutput('t1', 'Error\n    at /app/src/index.js:10:5', '/cwd');
    vi.advanceTimersByTime(100);
    const frames = onEntry.mock.calls[0][0].stackFrames;
    expect(frames.length).toBeGreaterThan(0);
    expect(frames[0].line).toBe(10);
    expect(frames[0].column).toBe(5);
  });

  it('firstLine is truncated to 300 chars', () => {
    const onEntry = vi.fn();
    const { handleOutput } = createSmartStderrCollector({ onEntry, inactivityMs: 50 });
    const long = 'Error: ' + 'x'.repeat(400);
    handleOutput('t1', long, '/cwd');
    vi.advanceTimersByTime(100);
    expect(onEntry.mock.calls[0][0].firstLine.length).toBeLessThanOrEqual(300);
  });
});
