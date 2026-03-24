import { describe, it, expect } from 'vitest';
import { detectTool, IPC, DEFAULTS, MCP_PORT } from '../../shared/constants.js';

describe('detectTool', () => {
  it('detects claude', () => expect(detectTool('claude --mcp')).toBe('claude'));
  it('detects codex', () => expect(detectTool('codex run')).toBe('codex'));
  it('is case-insensitive', () => expect(detectTool('CLAUDE')).toBe('claude'));
  it('returns other for unknown command', () => expect(detectTool('python script.py')).toBe('other'));
  it('returns other for empty string', () => expect(detectTool('')).toBe('other'));
  it('returns other for null', () => expect(detectTool(null)).toBe('other'));
  it('codex takes priority when both present', () => expect(detectTool('codex-claude')).toBe('codex'));
});

describe('constants', () => {
  it('MCP_PORT matches DEFAULTS.mcpPort', () => expect(MCP_PORT).toBe(DEFAULTS.mcpPort));
  it('IPC has PTY channels', () => {
    expect(IPC.PTY_CREATE).toBe('pty:create');
    expect(IPC.PTY_OUTPUT).toBe('pty:output');
    expect(IPC.PTY_EXIT).toBe('pty:exit');
  });
  it('DEFAULTS has required fields', () => {
    expect(typeof DEFAULTS.shell).toBe('string');
    expect(DEFAULTS.fontSize).toBeGreaterThan(0);
    expect(Array.isArray(DEFAULTS.layouts)).toBe(true);
  });
});
