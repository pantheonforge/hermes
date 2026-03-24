import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PtyParser } from '../../main/pty-parser.js';

function makeMcp() {
  return {
    recordAutoToolCall: vi.fn(),
    updateAgentStatus: vi.fn(),
    recordAgentCost: vi.fn(),
  };
}

describe('PtyParser._strip', () => {
  const parser = new PtyParser();

  it('removes SGR ANSI sequences', () => {
    expect(parser._strip('\x1b[32mhello\x1b[0m')).toBe('hello');
  });

  it('removes OSC sequences', () => {
    expect(parser._strip('\x1b]0;title\x07text')).toBe('text');
  });

  it('leaves plain text unchanged', () => {
    expect(parser._strip('hello world')).toBe('hello world');
  });

  it('handles empty string', () => {
    expect(parser._strip('')).toBe('');
  });
});

describe('PtyParser tool detection', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('detects Read tool and sets op=read', () => {
    const mcp = makeMcp();
    const parser = new PtyParser();
    parser._mcpServer = mcp;
    parser._parseLine('t1', '⏺ Read("/path/to/file.js")');
    expect(mcp.recordAutoToolCall).toHaveBeenCalledWith('t1', 'Read', '/path/to/file.js', 'read');
    expect(mcp.updateAgentStatus).toHaveBeenCalledWith('t1', 'working');
  });

  it('detects Write tool and sets op=write', () => {
    const mcp = makeMcp();
    const parser = new PtyParser();
    parser._mcpServer = mcp;
    parser._parseLine('t1', '● Write("/output/file.ts", content)');
    expect(mcp.recordAutoToolCall).toHaveBeenCalledWith('t1', 'Write', '/output/file.ts', 'write');
  });

  it('detects Edit tool and sets op=write', () => {
    const mcp = makeMcp();
    const parser = new PtyParser();
    parser._mcpServer = mcp;
    parser._parseLine('t1', '⏺ Edit("/src/foo.js", ...)');
    expect(mcp.recordAutoToolCall).toHaveBeenCalledWith('t1', 'Edit', '/src/foo.js', 'write');
  });

  it('detects Bash tool with no file path', () => {
    const mcp = makeMcp();
    const parser = new PtyParser();
    parser._mcpServer = mcp;
    parser._parseLine('t1', '⏺ Bash(npm install)');
    expect(mcp.recordAutoToolCall).toHaveBeenCalledWith('t1', 'Bash', '', '');
  });

  it('strips quotes from file path arg', () => {
    const mcp = makeMcp();
    const parser = new PtyParser();
    parser._mcpServer = mcp;
    parser._parseLine('t1', "⏺ Read('src/index.js')");
    expect(mcp.recordAutoToolCall).toHaveBeenCalledWith('t1', 'Read', 'src/index.js', 'read');
  });

  it('ignores lines without tool markers', () => {
    const mcp = makeMcp();
    const parser = new PtyParser();
    parser._mcpServer = mcp;
    parser._parseLine('t1', 'Read("/some/file.js") without bullet');
    expect(mcp.recordAutoToolCall).not.toHaveBeenCalled();
  });
});

describe('PtyParser cost parsing', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('parses "tokens · $" format', () => {
    const mcp = makeMcp();
    const parser = new PtyParser();
    parser._mcpServer = mcp;
    parser._parseLine('t1', '1,234 tokens · $0.04');
    expect(mcp.recordAgentCost).toHaveBeenCalledWith('t1', 1234, 0.04);
  });

  it('parses "$ (tokens)" format', () => {
    const mcp = makeMcp();
    const parser = new PtyParser();
    parser._mcpServer = mcp;
    parser._parseLine('t1', '$0.04 (1,234 tokens)');
    expect(mcp.recordAgentCost).toHaveBeenCalledWith('t1', 1234, 0.04);
  });

  it('ignores lines without cost info', () => {
    const mcp = makeMcp();
    const parser = new PtyParser();
    parser._mcpServer = mcp;
    parser._parseLine('t1', 'some normal output');
    expect(mcp.recordAgentCost).not.toHaveBeenCalled();
  });

  it('handles large token counts', () => {
    const mcp = makeMcp();
    const parser = new PtyParser();
    parser._mcpServer = mcp;
    parser._parseLine('t1', '123,456,789 tokens · $12.34');
    expect(mcp.recordAgentCost).toHaveBeenCalledWith('t1', 123456789, 12.34);
  });
});

describe('PtyParser line buffering', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('processes complete lines from _onOutput', () => {
    const mcp = makeMcp();
    const parser = new PtyParser();
    parser._mcpServer = mcp;
    parser._onOutput('t1', '⏺ Read("/a.js")\n');
    expect(mcp.recordAutoToolCall).toHaveBeenCalledOnce();
  });

  it('buffers partial lines until newline arrives', () => {
    const mcp = makeMcp();
    const parser = new PtyParser();
    parser._mcpServer = mcp;
    parser._onOutput('t1', '⏺ Read("/a');
    expect(mcp.recordAutoToolCall).not.toHaveBeenCalled();
    parser._onOutput('t1', '.js")\n');
    expect(mcp.recordAutoToolCall).toHaveBeenCalledOnce();
  });
});
