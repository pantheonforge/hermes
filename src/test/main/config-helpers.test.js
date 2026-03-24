import { describe, it, expect } from 'vitest';
import {
  sanitizeLayoutTerminal,
  sanitizeLayoutPreset,
  normalizeLayoutConfig,
  makeLayoutId,
} from '../../main/config-helpers.js';

describe('makeLayoutId', () => {
  it('returns a non-empty string', () => {
    expect(typeof makeLayoutId()).toBe('string');
    expect(makeLayoutId().length).toBeGreaterThan(0);
  });

  it('generates unique IDs', () => {
    const ids = new Set(Array.from({ length: 20 }, makeLayoutId));
    expect(ids.size).toBe(20);
  });
});

describe('sanitizeLayoutTerminal', () => {
  it('extracts cwd and startupCommand', () => {
    expect(sanitizeLayoutTerminal({ cwd: '/home/user', startupCommand: 'claude' }))
      .toEqual({ cwd: '/home/user', startupCommand: 'claude' });
  });

  it('defaults to empty strings', () => {
    expect(sanitizeLayoutTerminal({})).toEqual({ cwd: '', startupCommand: '' });
    expect(sanitizeLayoutTerminal(null)).toEqual({ cwd: '', startupCommand: '' });
  });

  it('trims whitespace', () => {
    const result = sanitizeLayoutTerminal({ cwd: '  /home  ', startupCommand: '  claude  ' });
    expect(result.cwd).toBe('/home');
    expect(result.startupCommand).toBe('claude');
  });

  it('coerces non-string values to string', () => {
    const result = sanitizeLayoutTerminal({ cwd: 42, startupCommand: true });
    expect(result.cwd).toBe('42');
    expect(result.startupCommand).toBe('true');
  });
});

describe('sanitizeLayoutPreset', () => {
  it('preserves valid preset fields', () => {
    const input = {
      id: 'layout-1',
      name: 'My Layout',
      terminals: [{ cwd: '/home', startupCommand: 'claude' }],
    };
    const result = sanitizeLayoutPreset(input, 'Fallback');
    expect(result.id).toBe('layout-1');
    expect(result.name).toBe('My Layout');
    expect(result.terminals).toHaveLength(1);
    expect(result.terminals[0].cwd).toBe('/home');
  });

  it('caps terminals at 6', () => {
    const terminals = Array(10).fill({ cwd: '/x', startupCommand: '' });
    const result = sanitizeLayoutPreset({ id: 'l1', name: 'L', terminals }, 'L');
    expect(result.terminals).toHaveLength(6);
  });

  it('ensures at least one terminal when terminals is empty', () => {
    const result = sanitizeLayoutPreset({ id: 'l1', name: 'L', terminals: [] }, 'L');
    expect(result.terminals).toHaveLength(1);
    expect(result.terminals[0]).toEqual({ cwd: '', startupCommand: '' });
  });

  it('uses fallback name when name is empty string', () => {
    expect(sanitizeLayoutPreset({ id: 'l1', name: '' }, 'Fallback').name).toBe('Fallback');
  });

  it('uses hardcoded Layout when name is whitespace-only', () => {
    // '   ' is truthy so fallbackName is never reached; trim() → '' → 'Layout'
    expect(sanitizeLayoutPreset({ id: 'l1', name: '   ' }, 'Fallback').name).toBe('Layout');
  });

  it('generates an id when none provided', () => {
    const result = sanitizeLayoutPreset({ name: 'L', terminals: [] }, 'L');
    expect(typeof result.id).toBe('string');
    expect(result.id.length).toBeGreaterThan(0);
  });
});

describe('normalizeLayoutConfig', () => {
  it('returns valid structure from well-formed input', () => {
    const input = {
      layouts: [{ id: 'l1', name: 'Dev', terminals: [{ cwd: '/home', startupCommand: '' }] }],
      defaultLayoutId: 'l1',
      lastUsedLayoutId: 'l1',
    };
    const result = normalizeLayoutConfig(input);
    expect(result.layouts).toHaveLength(1);
    expect(result.defaultLayoutId).toBe('l1');
    expect(result.lastUsedLayoutId).toBe('l1');
  });

  it('falls back to default layout when layouts is empty', () => {
    const result = normalizeLayoutConfig({});
    expect(result.layouts).toHaveLength(1);
    expect(result.layouts[0].name).toBe('Default');
  });

  it('migrates legacy startupLayout format', () => {
    const result = normalizeLayoutConfig({
      layouts: [],
      startupLayout: [{ cwd: '/legacy' }, { cwd: '/second' }],
    });
    expect(result.layouts).toHaveLength(1);
    expect(result.layouts[0].terminals).toHaveLength(2);
    expect(result.layouts[0].terminals[0].cwd).toBe('/legacy');
  });

  it('resets defaultLayoutId when not found in layouts', () => {
    const result = normalizeLayoutConfig({
      layouts: [{ id: 'l1', name: 'L1', terminals: [] }],
      defaultLayoutId: 'does-not-exist',
    });
    expect(result.defaultLayoutId).toBe('l1');
  });

  it('resets lastUsedLayoutId when not found in layouts', () => {
    const result = normalizeLayoutConfig({
      layouts: [{ id: 'l1', name: 'L1', terminals: [] }],
      defaultLayoutId: 'l1',
      lastUsedLayoutId: 'does-not-exist',
    });
    expect(result.lastUsedLayoutId).toBe('l1');
  });

  it('deduplicates layout IDs', () => {
    const layouts = [
      { id: 'same', name: 'A', terminals: [] },
      { id: 'same', name: 'B', terminals: [] },
    ];
    const result = normalizeLayoutConfig({ layouts });
    const ids = result.layouts.map((l) => l.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('caps at 40 layouts', () => {
    const layouts = Array.from({ length: 50 }, (_, i) => ({
      id: `l${i}`,
      name: `Layout ${i}`,
      terminals: [],
    }));
    expect(normalizeLayoutConfig({ layouts }).layouts).toHaveLength(40);
  });

  it('handles non-array layouts gracefully', () => {
    const result = normalizeLayoutConfig({ layouts: 'bad' });
    expect(result.layouts).toHaveLength(1);
  });
});
