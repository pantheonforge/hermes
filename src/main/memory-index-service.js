const fs = require('fs');
const path = require('path');
const { Worker } = require('worker_threads');
const { MemoryDB, migrateFromJson } = require('./memory-db');
const {
  normalizePath, relPath, chunkText, parseImports,
  summarizeFile, cosineSimilarity, resolveImportTargets,
  buildIgnoreFilter, walk,
} = require('./memory-utils');

const MAX_SEARCH_CHUNKS = 128;
const EVENT_RETENTION_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

class MemoryIndexService {
  constructor({ app, store }) {
    this.app = app;
    this.store = store;
    const userData = app.getPath('userData');
    this.dbPath = path.join(userData, 'memory.sqlite');
    this.legacyJsonPath = path.join(userData, 'memory.db');

    this.projectPath = '';
    this.embedMethod = 'disabled';
    this.scanning = false;
    this.scanError = '';
    this.scanPromise = null;
    this.sessionTouches = {};
    this.updatedAt = 0;

    this._embedWorker = null;
    this._embedReady = false;
    this._embedCallbacks = new Map();
    this._embedIdSeq = 0;
    this._embedRestartCount = 0;
    this._eventDebounceTimer = null;
    this._pendingEvents = [];

    this._db = new MemoryDB(this.dbPath);
    migrateFromJson(this.legacyJsonPath, this._db);
    this._db.pruneEvents(Date.now() - EVENT_RETENTION_MS);

    this._startEmbedWorker();
  }

  _startEmbedWorker() {
    const workerPath = path.join(__dirname, 'embed-worker.js');
    const worker = new Worker(workerPath, {
      workerData: { cacheDir: path.join(this.app.getPath('userData'), 'model-cache') },
    });
    this._embedWorker = worker;

    worker.on('message', (msg) => {
      if (msg.type === 'ready') {
        const newModel = msg.embedMethod;
        this._embedReady = true;
        this._embedRestartCount = 0;
        if (newModel !== 'disabled') {
          const stored = this._db.getMeta('embed_model');
          if (stored && stored !== newModel) {
            console.log(`[memory] embed model changed ${stored} → ${newModel}, wiping vectors`);
            this._db.wipeVectors();
          }
          this._db.setMeta('embed_model', newModel);
        }
        this.embedMethod = newModel;
        return;
      }
      if (msg.type === 'result') {
        const cb = this._embedCallbacks.get(msg.id);
        if (!cb) return;
        this._embedCallbacks.delete(msg.id);
        if (msg.embedMethod) this.embedMethod = msg.embedMethod;
        cb.resolve(msg.vectors);
      }
    });

    worker.on('error', (err) => {
      console.error('[memory] embed-worker error:', err.message);
      // Reject all pending
      for (const [id, cb] of this._embedCallbacks) {
        this._embedCallbacks.delete(id);
        cb.reject(err);
      }
      this._embedReady = false;
      this.embedMethod = 'disabled';
    });

    worker.on('exit', (code) => {
      if (code !== 0) {
        console.error('[memory] embed-worker exited with code', code);
        this._embedReady = false;
        this.embedMethod = 'disabled';
        if (this._embedRestartCount < 3) {
          this._embedRestartCount += 1;
          setTimeout(() => this._startEmbedWorker(), 2000);
        } else {
          console.error('[memory] embed-worker exceeded restart limit, giving up');
        }
      }
    });
  }

  _embed(texts) {
    return new Promise((resolve, reject) => {
      if (!Array.isArray(texts) || texts.length === 0) return resolve([]);
      const id = ++this._embedIdSeq;
      this._embedCallbacks.set(id, { resolve, reject });
      this._embedWorker.postMessage({ type: 'embed', id, texts });
    });
  }

  async _embedSingle(text) {
    const results = await this._embed([String(text || '').trim()]);
    return Array.isArray(results) && results?.[0] ? results[0] : null;
  }

  async init() {
    const projectPath = String(this.store.get('memoryProjectPath') || '').trim();
    if (projectPath) this.projectPath = projectPath;
    const info = this._db.getIndexInfo();
    this.updatedAt = Date.now();
    return info;
  }

  getSnapshot() {
    const files = this._db.listFiles();
    const now = Date.now();
    const info = this._db.getIndexInfo();
    const fileSet = new Set(files.map((f) => f.relPath));

    const nodes = files.map((f) => {
      const ageHours = Math.max(0, (now - Number(f.mtimeMs || now)) / 3600000);
      const recency = Math.max(0, 72 - ageHours);
      const score = Number((recency * 0.5 + f.importCount * 2).toFixed(3));
      return {
        id: f.relPath,
        filePath: f.relPath,
        module: f.module,
        importance: score,
        importCount: f.importCount,
        vectorCount: f.vectorCount,
        mtimeMs: f.mtimeMs,
        summary: f.summary,
      };
    });

    // Build import-based edges by resolving relative imports to indexed files
    const edgeSet = new Set();
    const edges = [];
    for (const f of files) {
      const targets = resolveImportTargets(f.relPath, f.imports, fileSet);
      for (const target of targets) {
        const key = `${f.relPath}→${target}`;
        if (!edgeSet.has(key)) {
          edgeSet.add(key);
          edges.push({ from: f.relPath, to: target, type: 'import' });
        }
      }
    }

    return {
      projectPath: this.projectPath,
      updatedAt: this.updatedAt,
      scanning: this.scanning,
      scanError: this.scanError,
      indexInfo: { fileCount: info.fileCount, chunkCount: info.vectorCount, vectorCount: info.vectorCount },
      embedder: this.embedMethod,
      nodes,
      edges,
      touches: { ...this.sessionTouches },
    };
  }

  getSemanticEdges(threshold = 0.62, maxPerFile = 4) {
    const chunks = this._db.getAllChunks();
    if (!chunks.length) return [];

    // Average chunk vectors per file
    const fileVecSums = new Map();
    const fileVecCounts = new Map();
    for (const chunk of chunks) {
      if (!chunk.vector || !chunk.vector.length) continue;
      if (!fileVecSums.has(chunk.relPath)) {
        fileVecSums.set(chunk.relPath, new Float64Array(chunk.vector.length));
        fileVecCounts.set(chunk.relPath, 0);
      }
      const sum = fileVecSums.get(chunk.relPath);
      for (let i = 0; i < chunk.vector.length; i++) sum[i] += chunk.vector[i];
      fileVecCounts.set(chunk.relPath, fileVecCounts.get(chunk.relPath) + 1);
    }

    const files = [];
    const vecs = [];
    for (const [relPath, sum] of fileVecSums) {
      const count = fileVecCounts.get(relPath);
      const avg = Array.from(sum).map((v) => v / count);
      files.push(relPath);
      vecs.push(avg);
    }

    const n = files.length;
    if (n < 2) return [];

    // Cap to avoid O(n²) explosion on huge codebases
    const limit = Math.min(n, 300);

    // Pairwise cosine similarity; keep top-maxPerFile edges per file above threshold
    const candidates = new Map(files.slice(0, limit).map((f) => [f, []]));
    for (let i = 0; i < limit; i++) {
      for (let j = i + 1; j < limit; j++) {
        const sim = cosineSimilarity(vecs[i], vecs[j]);
        if (sim >= threshold) {
          candidates.get(files[i]).push({ to: files[j], sim });
          candidates.get(files[j]).push({ to: files[i], sim });
        }
      }
    }

    const edgeSet = new Set();
    const edges = [];
    for (const [from, list] of candidates) {
      list.sort((a, b) => b.sim - a.sim);
      for (const { to, sim } of list.slice(0, maxPerFile)) {
        const key = [from, to].sort().join('\0');
        if (!edgeSet.has(key)) {
          edgeSet.add(key);
          edges.push({ from, to, type: 'semantic', weight: Number(sim.toFixed(4)) });
        }
      }
    }
    return edges;
  }

  getFileDetails(filePath) {
    const rel = normalizePath(String(filePath || ''));
    const files = this._db.listFiles().find((f) => f.relPath === rel);
    if (!files) return null;
    return {
      filePath: rel,
      summary: files.summary,
      vectorCount: files.vectorCount,
      chunkCount: files.chunkCount,
      lastTouchedAt: this.sessionTouches[rel] || null,
      mtimeMs: files.mtimeMs,
      module: files.module,
      importCount: files.importCount,
      imports: files.imports,
    };
  }

  async semanticSearch(query, limit = 10, scope = 'code') {
    const text = String(query || '').trim();
    const safeLimit = Math.max(1, Math.min(50, Number(limit || 10)));
    if (!text) return { ok: true, needsIndex: false, results: [] };

    if (this.embedMethod === 'disabled') {
      return { ok: false, needsIndex: false, embedDisabled: true, results: [] };
    }

    const queryVec = await this._embedSingle(text);
    if (!queryVec) return { ok: true, needsIndex: true, results: [] };

    const scored = [];

    if (scope === 'code' || scope === 'all') {
      if (!this.projectPath || this._db.getIndexInfo().fileCount === 0) {
        if (scope === 'code') return { ok: true, needsIndex: true, results: [] };
      } else {
        for (const chunk of this._db.getAllChunks()) {
          if (!chunk.vector) continue;
          const score = cosineSimilarity(queryVec, chunk.vector);
          if (!Number.isFinite(score)) continue;
          scored.push({
            kind: 'code',
            filePath: chunk.relPath,
            absPath: chunk.absPath,
            excerpt: String(chunk.text || '').slice(0, 700),
            score: Number(score.toFixed(6)),
            chunkIndex: chunk.chunkIndex,
          });
        }
      }
    }

    if (scope === 'events' || scope === 'all') {
      for (const ev of this._db.getAllEventVectors()) {
        if (!ev.vector) continue;
        const score = cosineSimilarity(queryVec, ev.vector);
        if (!Number.isFinite(score)) continue;
        scored.push({
          kind: 'event',
          filePath: '',
          agentId: ev.agentId,
          channel: ev.channel,
          eventType: ev.type,
          timestamp: ev.timestamp,
          excerpt: String(ev.content || '').slice(0, 700),
          score: Number(score.toFixed(6)),
          chunkIndex: 0,
        });
      }
    }

    if (scored.length === 0) return { ok: true, needsIndex: true, results: [] };
    scored.sort((a, b) => b.score - a.score);
    return { ok: true, needsIndex: false, results: scored.slice(0, safeLimit) };
  }

  setProjectPath(projectPath) {
    const next = String(projectPath || '').trim();
    if (!next) return this.getSnapshot();
    this.projectPath = next;
    this.store.set('memoryProjectPath', next);
    return this.getSnapshot();
  }

  markTouched(filePath, timestamp = Date.now()) {
    const raw = String(filePath || '').trim();
    if (!raw) return;
    let rel = normalizePath(raw);
    if (this.projectPath) {
      const normalizedRoot = normalizePath(this.projectPath).toLowerCase();
      const normalizedRaw = normalizePath(raw).toLowerCase();
      if (normalizedRaw.startsWith(normalizedRoot)) {
        rel = normalizePath(relPath(this.projectPath, raw));
      }
    }
    this.sessionTouches[rel] = Number(timestamp || Date.now());
  }

  ingestMcpEvent(type, agentId, channel, content, timestamp) {
    const text = String(content || '').trim();
    if (!text || this.embedMethod === 'disabled') return;
    this._pendingEvents.push({ type, agentId, channel, content: text, timestamp: timestamp || Date.now() });
    if (this._eventDebounceTimer) clearTimeout(this._eventDebounceTimer);
    this._eventDebounceTimer = setTimeout(() => this._flushPendingEvents(), 2000);
  }

  async _flushPendingEvents() {
    this._eventDebounceTimer = null;
    const batch = this._pendingEvents.splice(0);
    if (batch.length === 0) return;
    try {
      const texts = batch.map((e) => e.content);
      const vectors = await this._embed(texts);
      for (let i = 0; i < batch.length; i++) {
        const ev = batch[i];
        const id = this._db.insertEvent(ev.type, ev.agentId, ev.channel, ev.content, ev.timestamp);
        if (Array.isArray(vectors) && vectors[i]) {
          this._db.updateEventVector(id, vectors[i]);
        }
      }
    } catch (err) {
      console.error('[memory] event flush error:', err.message);
    }
  }

  startScan(projectPath) {
    if (this.scanning) return this.getSnapshot();
    const root = String(projectPath || this.projectPath || '').trim();
    if (!root || !fs.existsSync(root)) return this.getSnapshot();
    this.scanning = true;
    this.scanError = '';
    this.projectPath = root;
    this.store.set('memoryProjectPath', root);

    this.scanPromise = this._runScan(root)
      .then(() => {
        this.updatedAt = Date.now();
        const info = this._db.getIndexInfo();
        const key = `scan_info:${normalizePath(root)}`;
        this._db.setMeta(key, JSON.stringify({ lastScannedAt: this.updatedAt, fileCount: info.fileCount, vectorCount: info.vectorCount }));
      })
      .catch((err) => { this.scanError = String(err?.message || err || 'Scan failed'); })
      .finally(() => { this.scanning = false; this.scanPromise = null; });

    return this.getSnapshot();
  }

  async scan(projectPath) {
    this.startScan(projectPath);
    if (this.scanPromise) {
      try { await this.scanPromise; } catch { /* error stored */ }
    }
    return this.getSnapshot();
  }

  async _runScan(root) {
    const ignoreGlobs = Array.isArray(this.store.get('memoryIgnoreGlobs'))
      ? this.store.get('memoryIgnoreGlobs') : [];
    const ig = buildIgnoreFilter(root);
    const absFiles = walk(root, root, ignoreGlobs, ig);

    const currentRels = [];
    const relSet = new Set();
    for (const abs of absFiles) {
      const rel = normalizePath(path.relative(root, abs));
      relSet.add(rel);
      currentRels.push(rel);
    }

    // Remove files that no longer exist
    this._db.deleteStaleFiles(currentRels);

    // Process changed/new files
    for (const abs of absFiles) {
      const rel = normalizePath(path.relative(root, abs));
      let stat;
      try { stat = fs.statSync(abs); } catch { continue; }

      const existingMtime = this._db.getFileMtime(rel);
      if (existingMtime !== null && existingMtime === Number(stat.mtimeMs)) continue;

      let content = '';
      try { content = fs.readFileSync(abs, 'utf8'); } catch { continue; }

      const chunks = chunkText(content);
      const searchChunks = chunks.slice(0, MAX_SEARCH_CHUNKS);
      const imports = parseImports(content);
      const module = rel.split('/')[0] || 'root';
      const summary = summarizeFile(rel, content, imports, chunks);

      let vectors = null;
      if (this.embedMethod !== 'disabled') {
        try { vectors = await this._embed(searchChunks); } catch { vectors = null; }
      }

      const chunkData = searchChunks.map((text, i) => ({
        text,
        vector: Array.isArray(vectors) && vectors[i] ? vectors[i] : null,
      }));

      this._db.upsertFile({
        relPath: rel,
        absPath: abs,
        module,
        mtimeMs: Number(stat.mtimeMs),
        size: Number(stat.size || 0),
        importCount: imports.length,
        imports,
        chunkCount: chunks.length,
        vectorCount: chunkData.filter((c) => c.vector).length,
        summary,
      }, chunkData);
    }
  }

  getPathScanInfo(projectPath) {
    const p = String(projectPath || '').trim();
    if (!p) return null;
    const raw = this._db.getMeta(`scan_info:${normalizePath(p)}`);
    if (!raw) return null;
    try { return JSON.parse(raw); } catch { return null; }
  }

  destroy() {
    if (this._eventDebounceTimer) clearTimeout(this._eventDebounceTimer);
    if (this._embedWorker) {
      try { this._embedWorker.postMessage({ type: 'shutdown' }); } catch { /* ignore */ }
    }
    this._db.close();
  }
}

module.exports = { MemoryIndexService };
