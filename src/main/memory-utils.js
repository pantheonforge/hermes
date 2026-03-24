const fs = require('fs');
const path = require('path');
const ignore = require('ignore');

const TEXT_EXTS = new Set([
  '.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs', '.json',
  '.py', '.go', '.rs', '.java', '.kt', '.swift', '.rb', '.php',
  '.c', '.cc', '.cpp', '.h', '.hpp',
  '.css', '.scss', '.html', '.xml',
  '.md', '.txt', '.yml', '.yaml', '.toml', '.ini', '.sh', '.ps1',
]);

function normalizePath(p) {
  return String(p || '').replace(/\\/g, '/');
}

function relPath(root, abs) {
  return normalizePath(path.relative(root, abs) || '.');
}

function chunkText(input, maxLen = 900) {
  const text = String(input || '');
  if (!text) return [];
  const lines = text.split(/\r?\n/);
  const chunks = [];
  let buf = [];
  let len = 0;
  for (const line of lines) {
    const lineLen = line.length + 1;
    if (len + lineLen > maxLen && buf.length) {
      chunks.push(buf.join('\n'));
      buf = [];
      len = 0;
    }
    buf.push(line);
    len += lineLen;
  }
  if (buf.length) chunks.push(buf.join('\n'));
  return chunks.filter(Boolean);
}

function parseImports(content) {
  const text = String(content || '');
  const refs = new Set();
  const patterns = [
    /import\s+[^'"]*?from\s+['"]([^'"]+)['"]/g,
    /import\s+['"]([^'"]+)['"]/g,
    /require\(\s*['"]([^'"]+)['"]\s*\)/g,
    /from\s+['"]([^'"]+)['"]/g,
  ];
  for (const re of patterns) {
    let m;
    while ((m = re.exec(text)) !== null) refs.add(m[1]);
  }
  return Array.from(refs);
}

function summarizeFile(rel, content, imports, chunks) {
  const text = String(content || '');
  const lines = text.split(/\r?\n/);
  const nonEmpty = lines.map((v) => v.trim()).filter(Boolean);
  const head = nonEmpty.slice(0, 4).join(' ').slice(0, 220);
  const fnCount = (text.match(/\b(function|def|class|interface|type)\b/g) || []).length;
  return [
    `File: ${rel}`,
    `Imports: ${imports.length}`,
    `Symbols: ${fnCount}`,
    `Chunks: ${chunks.length}`,
    head ? `Summary: ${head}` : 'Summary: (empty file)',
  ].join('\n');
}

function resolveImportTargets(fileRel, imports, fileSet) {
  const baseDir = path.posix.dirname(fileRel);
  const targets = new Set();
  for (const imp of imports) {
    if (!imp || (!imp.startsWith('.') && !imp.startsWith('/'))) continue;
    const candidate = normalizePath(path.posix.normalize(path.posix.join(baseDir, imp)));
    const variants = [
      candidate,
      `${candidate}.js`, `${candidate}.ts`, `${candidate}.jsx`, `${candidate}.tsx`,
      `${candidate}.py`, `${candidate}/index.js`, `${candidate}/index.ts`,
    ];
    for (const v of variants) {
      if (fileSet.has(v)) { targets.add(v); break; }
    }
  }
  return Array.from(targets);
}

function cosineSimilarity(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length === 0 || b.length === 0) return 0;
  const len = Math.min(a.length, b.length);
  let dot = 0;
  let magA = 0;
  let magB = 0;
  for (let i = 0; i < len; i += 1) {
    const av = Number(a[i] || 0);
    const bv = Number(b[i] || 0);
    dot += av * bv;
    magA += av * av;
    magB += bv * bv;
  }
  if (magA <= 0 || magB <= 0) return 0;
  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}

/**
 * Build an `ignore` instance that covers all .gitignore files in the tree.
 * The `ignore` package handles nested .gitignore semantics correctly — each
 * file's patterns are scoped to its directory relative to root.
 */
function buildIgnoreFilter(root) {
  const ig = ignore();
  // Always exclude .git
  ig.add('.git');

  function collectDir(dir) {
    const gitignorePath = path.join(dir, '.gitignore');
    if (fs.existsSync(gitignorePath)) {
      try {
        const raw = fs.readFileSync(gitignorePath, 'utf8');
        const relDir = normalizePath(path.relative(root, dir));
        if (relDir === '' || relDir === '.') {
          ig.add(raw);
        } else {
          // Prefix patterns for nested .gitignore files so they apply within their scope
          const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
          for (const line of lines) {
            const negated = line.startsWith('!');
            const pat = negated ? line.slice(1).trim() : line;
            // Only apply patterns that don't already start with a path separator
            const prefixed = pat.startsWith('/') ? `${relDir}${pat}` : `${relDir}/${pat}`;
            ig.add(negated ? `!${prefixed}` : prefixed);
          }
        }
      } catch { /* unreadable */ }
    }

    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (entry.name === '.git') continue;
      // Don't recurse into directories that are already ignored (perf)
      const entryRel = normalizePath(path.relative(root, path.join(dir, entry.name)));
      if (!ig.ignores(entryRel + '/') && !ig.ignores(entryRel)) {
        collectDir(path.join(dir, entry.name));
      }
    }
  }

  collectDir(root);
  return ig;
}

function isIgnoredByGlobs(root, absPath, ignoreGlobs) {
  const rel = normalizePath(relPath(root, absPath));
  for (const token of ignoreGlobs) {
    const t = String(token || '').trim();
    if (!t) continue;
    if (rel.includes(`/${t}/`) || rel.startsWith(`${t}/`) || rel === t) return true;
  }
  return false;
}

function walk(root, dir, ignoreGlobs, ig, out = []) {
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const entry of entries) {
    if (entry.name === '.git') continue;
    const abs = path.join(dir, entry.name);
    const rel = normalizePath(path.relative(root, abs));
    // Check ignore filter (gitignore-based)
    if (ig && ig.ignores(entry.isDirectory() ? rel + '/' : rel)) continue;
    // Check user-configured globs
    if (isIgnoredByGlobs(root, abs, ignoreGlobs)) continue;
    if (entry.isDirectory()) {
      walk(root, abs, ignoreGlobs, ig, out);
      continue;
    }
    if (!TEXT_EXTS.has(path.extname(entry.name).toLowerCase())) continue;
    out.push(abs);
  }
  return out;
}

module.exports = {
  TEXT_EXTS,
  normalizePath,
  relPath,
  chunkText,
  parseImports,
  summarizeFile,
  resolveImportTargets,
  cosineSimilarity,
  buildIgnoreFilter,
  isIgnoredByGlobs,
  walk,
};
