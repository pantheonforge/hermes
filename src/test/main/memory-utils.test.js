import { describe, it, expect } from 'vitest';
import path from 'path';
import {
  normalizePath,
  relPath,
  chunkText,
  parseImports,
  summarizeFile,
  resolveImportTargets,
  cosineSimilarity,
  isIgnoredByGlobs,
} from '../../main/memory-utils.js';

describe('normalizePath', () => {
  it('converts backslashes to forward slashes', () => {
    expect(normalizePath('C:\\Users\\foo\\bar.js')).toBe('C:/Users/foo/bar.js');
  });

  it('handles empty string', () => {
    expect(normalizePath('')).toBe('');
  });

  it('handles null', () => {
    expect(normalizePath(null)).toBe('');
  });

  it('leaves forward slashes unchanged', () => {
    expect(normalizePath('/usr/local/bin')).toBe('/usr/local/bin');
  });
});

describe('relPath', () => {
  it('returns normalized relative path', () => {
    const root = process.cwd();
    const abs = path.join(root, 'src', 'index.js');
    expect(relPath(root, abs)).toBe('src/index.js');
  });
});

describe('chunkText', () => {
  it('returns empty array for empty input', () => {
    expect(chunkText('')).toEqual([]);
    expect(chunkText(null)).toEqual([]);
  });

  it('returns single chunk for short text', () => {
    const result = chunkText('line1\nline2\nline3', 1000);
    expect(result).toHaveLength(1);
    expect(result[0]).toBe('line1\nline2\nline3');
  });

  it('splits into multiple chunks when text exceeds maxLen', () => {
    const line = 'x'.repeat(50);
    const text = Array(30).fill(line).join('\n');
    const chunks = chunkText(text, 300);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(400);
    }
  });

  it('filters out empty chunks', () => {
    const result = chunkText('\n\n\n', 100);
    expect(result.every(Boolean)).toBe(true);
  });
});

describe('parseImports', () => {
  it('extracts ES module default imports', () => {
    expect(parseImports("import React from 'react';")).toContain('react');
  });

  it('extracts ES module named imports', () => {
    expect(parseImports("import { foo } from './foo';")).toContain('./foo');
  });

  it('extracts side-effect imports', () => {
    expect(parseImports("import './styles.css';")).toContain('./styles.css');
  });

  it('extracts require calls', () => {
    const result = parseImports("const fs = require('fs');");
    expect(result).toContain('fs');
  });

  it('deduplicates identical imports', () => {
    const code = "import 'react';\nrequire('react');";
    expect(parseImports(code).filter((r) => r === 'react')).toHaveLength(1);
  });

  it('returns empty array when no imports', () => {
    expect(parseImports('const x = 1 + 2;')).toEqual([]);
  });

  it('handles null/empty input', () => {
    expect(parseImports('')).toEqual([]);
    expect(parseImports(null)).toEqual([]);
  });
});

describe('summarizeFile', () => {
  it('includes file path', () => {
    expect(summarizeFile('src/foo.js', 'function foo() {}', [], ['c'])).toContain('File: src/foo.js');
  });

  it('counts function symbols', () => {
    const code = 'function a() {}\nfunction b() {}\nclass C {}';
    expect(summarizeFile('f.js', code, [], [])).toContain('Symbols: 3');
  });

  it('reports import count', () => {
    expect(summarizeFile('f.js', 'x', ['react', './foo'], [])).toContain('Imports: 2');
  });

  it('reports chunk count', () => {
    expect(summarizeFile('f.js', 'x', [], ['a', 'b', 'c'])).toContain('Chunks: 3');
  });

  it('handles empty content', () => {
    expect(summarizeFile('f.js', '', [], [])).toContain('(empty file)');
  });
});

describe('resolveImportTargets', () => {
  it('resolves relative import to matching file', () => {
    const fileSet = new Set(['src/utils.js', 'src/index.js']);
    expect(resolveImportTargets('src/index.js', ['./utils'], fileSet)).toContain('src/utils.js');
  });

  it('resolves import with extension variants', () => {
    const fileSet = new Set(['src/helpers.ts']);
    expect(resolveImportTargets('src/index.js', ['./helpers'], fileSet)).toContain('src/helpers.ts');
  });

  it('resolves index file imports', () => {
    const fileSet = new Set(['src/utils/index.js']);
    expect(resolveImportTargets('src/index.js', ['./utils'], fileSet)).toContain('src/utils/index.js');
  });

  it('ignores node_modules (non-relative) imports', () => {
    const fileSet = new Set(['src/index.js']);
    expect(resolveImportTargets('src/index.js', ['react', 'lodash'], fileSet)).toHaveLength(0);
  });

  it('returns empty for no matching files', () => {
    expect(resolveImportTargets('src/index.js', ['./missing'], new Set())).toHaveLength(0);
  });
});

describe('cosineSimilarity', () => {
  it('returns 1 for identical vectors', () => {
    expect(cosineSimilarity([1, 0, 0], [1, 0, 0])).toBeCloseTo(1);
  });

  it('returns 0 for orthogonal vectors', () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0);
  });

  it('returns -1 for opposite vectors', () => {
    expect(cosineSimilarity([1, 0], [-1, 0])).toBeCloseTo(-1);
  });

  it('returns 0 for zero vector', () => {
    expect(cosineSimilarity([0, 0], [1, 1])).toBe(0);
  });

  it('returns 0 for empty arrays', () => {
    expect(cosineSimilarity([], [])).toBe(0);
  });

  it('handles non-array input', () => {
    expect(cosineSimilarity(null, null)).toBe(0);
  });
});

describe('isIgnoredByGlobs', () => {
  const root = process.cwd();

  it('ignores path containing a glob token directory', () => {
    const abs = path.join(root, 'node_modules', 'foo.js');
    expect(isIgnoredByGlobs(root, abs, ['node_modules'])).toBe(true);
  });

  it('does not ignore unrelated paths', () => {
    const abs = path.join(root, 'src', 'index.js');
    expect(isIgnoredByGlobs(root, abs, ['node_modules'])).toBe(false);
  });

  it('handles empty globs list', () => {
    const abs = path.join(root, 'src', 'index.js');
    expect(isIgnoredByGlobs(root, abs, [])).toBe(false);
  });

  it('matches path starting with token', () => {
    const abs = path.join(root, 'dist', 'bundle.js');
    expect(isIgnoredByGlobs(root, abs, ['dist'])).toBe(true);
  });
});
