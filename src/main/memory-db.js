const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const SCHEMA = `
PRAGMA journal_mode=WAL;
PRAGMA foreign_keys=ON;

CREATE TABLE IF NOT EXISTS files (
  id         INTEGER PRIMARY KEY,
  rel_path   TEXT    UNIQUE NOT NULL,
  abs_path   TEXT    NOT NULL,
  module     TEXT    NOT NULL,
  mtime_ms   INTEGER NOT NULL,
  size       INTEGER NOT NULL DEFAULT 0,
  import_count INTEGER NOT NULL DEFAULT 0,
  imports    TEXT    NOT NULL DEFAULT '[]',
  chunk_count  INTEGER NOT NULL DEFAULT 0,
  vector_count INTEGER NOT NULL DEFAULT 0,
  summary    TEXT    NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS chunks (
  id          INTEGER PRIMARY KEY,
  file_id     INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  chunk_index INTEGER NOT NULL,
  text        TEXT    NOT NULL,
  vector      BLOB
);

CREATE TABLE IF NOT EXISTS mcp_events (
  id        INTEGER PRIMARY KEY,
  type      TEXT    NOT NULL,
  agent_id  TEXT    NOT NULL DEFAULT '',
  channel   TEXT    NOT NULL DEFAULT '',
  content   TEXT    NOT NULL,
  timestamp INTEGER NOT NULL,
  vector    BLOB
);

CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_chunks_file_id ON chunks(file_id);
CREATE INDEX IF NOT EXISTS idx_mcp_events_ts  ON mcp_events(timestamp);
`;

function vecToBlob(vec) {
  if (!Array.isArray(vec) || vec.length === 0) return null;
  const buf = Buffer.allocUnsafe(vec.length * 4);
  for (let i = 0; i < vec.length; i++) buf.writeFloatLE(Number(vec[i] || 0), i * 4);
  return buf;
}

function blobToVec(blob) {
  if (!blob || !Buffer.isBuffer(blob) || blob.length === 0) return null;
  const len = blob.length / 4;
  const vec = new Array(len);
  for (let i = 0; i < len; i++) vec[i] = blob.readFloatLE(i * 4);
  return vec;
}

class MemoryDB {
  constructor(dbPath) {
    this.db = new Database(dbPath);
    this.db.exec(SCHEMA);
    this._prepare();
  }

  _prepare() {
    this.stmts = {
      upsertFile: this.db.prepare(`
        INSERT INTO files (rel_path, abs_path, module, mtime_ms, size, import_count, imports, chunk_count, vector_count, summary)
        VALUES (@rel_path, @abs_path, @module, @mtime_ms, @size, @import_count, @imports, @chunk_count, @vector_count, @summary)
        ON CONFLICT(rel_path) DO UPDATE SET
          abs_path=excluded.abs_path, module=excluded.module, mtime_ms=excluded.mtime_ms,
          size=excluded.size, import_count=excluded.import_count, imports=excluded.imports,
          chunk_count=excluded.chunk_count, vector_count=excluded.vector_count, summary=excluded.summary
      `),
      getFile: this.db.prepare('SELECT * FROM files WHERE rel_path=?'),
      getFileId: this.db.prepare('SELECT id FROM files WHERE rel_path=?'),
      listFiles: this.db.prepare('SELECT * FROM files'),
      deleteChunks: this.db.prepare('DELETE FROM chunks WHERE file_id=?'),
      insertChunk: this.db.prepare('INSERT INTO chunks (file_id, chunk_index, text, vector) VALUES (?,?,?,?)'),
      getAllChunks: this.db.prepare('SELECT f.rel_path, f.abs_path, c.chunk_index, c.text, c.vector FROM chunks c JOIN files f ON f.id=c.file_id'),
      deleteFile: this.db.prepare('DELETE FROM files WHERE rel_path=?'),
      deleteStaleFiles: this.db.prepare('DELETE FROM files WHERE rel_path NOT IN (SELECT value FROM json_each(?))'),
      insertEvent: this.db.prepare('INSERT INTO mcp_events (type, agent_id, channel, content, timestamp) VALUES (?,?,?,?,?)'),
      updateEventVector: this.db.prepare('UPDATE mcp_events SET vector=? WHERE id=?'),
      getUnembeddedEvents: this.db.prepare('SELECT id, content FROM mcp_events WHERE vector IS NULL ORDER BY id DESC LIMIT 50'),
      getAllEventVectors: this.db.prepare('SELECT id, type, agent_id, channel, content, timestamp, vector FROM mcp_events WHERE vector IS NOT NULL'),
      pruneEvents: this.db.prepare('DELETE FROM mcp_events WHERE timestamp < ?'),
      countFiles: this.db.prepare('SELECT COUNT(*) as n FROM files'),
      countChunks: this.db.prepare('SELECT SUM(vector_count) as n FROM files'),
      getMeta: this.db.prepare('SELECT value FROM meta WHERE key=?'),
      setMeta: this.db.prepare('INSERT INTO meta (key, value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value'),
      wipeChunkVectors: this.db.prepare('UPDATE chunks SET vector=NULL'),
      wipeEventVectors: this.db.prepare('UPDATE mcp_events SET vector=NULL'),
      resetVectorCounts: this.db.prepare('UPDATE files SET vector_count=0'),
    };
  }

  upsertFile(fileData, chunks) {
    const upsert = this.db.transaction((fd, cks) => {
      this.stmts.upsertFile.run({
        rel_path: fd.relPath,
        abs_path: fd.absPath,
        module: fd.module,
        mtime_ms: fd.mtimeMs,
        size: fd.size,
        import_count: fd.importCount,
        imports: JSON.stringify(fd.imports),
        chunk_count: fd.chunkCount,
        vector_count: fd.vectorCount,
        summary: fd.summary,
      });
      const row = this.stmts.getFileId.get(fd.relPath);
      if (!row) return;
      this.stmts.deleteChunks.run(row.id);
      for (let i = 0; i < cks.length; i++) {
        const ck = cks[i];
        this.stmts.insertChunk.run(row.id, i, ck.text, vecToBlob(ck.vector));
      }
    });
    upsert(fileData, chunks);
  }

  getFileMtime(relPath) {
    const row = this.stmts.getFile.get(relPath);
    return row ? Number(row.mtime_ms) : null;
  }

  listFiles() {
    return this.stmts.listFiles.all().map((row) => ({
      relPath: row.rel_path,
      absPath: row.abs_path,
      module: row.module,
      mtimeMs: row.mtime_ms,
      size: row.size,
      importCount: row.import_count,
      imports: JSON.parse(row.imports || '[]'),
      chunkCount: row.chunk_count,
      vectorCount: row.vector_count,
      summary: row.summary,
    }));
  }

  getAllChunks() {
    return this.stmts.getAllChunks.all().map((row) => ({
      relPath: row.rel_path,
      absPath: row.abs_path,
      chunkIndex: row.chunk_index,
      text: row.text,
      vector: blobToVec(row.vector),
    }));
  }

  deleteStaleFiles(currentRelPaths) {
    this.stmts.deleteStaleFiles.run(JSON.stringify(currentRelPaths));
  }

  insertEvent(type, agentId, channel, content, timestamp) {
    const info = this.stmts.insertEvent.run(type, agentId, channel, content, timestamp);
    return info.lastInsertRowid;
  }

  updateEventVector(id, vector) {
    this.stmts.updateEventVector.run(vecToBlob(vector), id);
  }

  getUnembeddedEvents() {
    return this.stmts.getUnembeddedEvents.all();
  }

  getAllEventVectors() {
    return this.stmts.getAllEventVectors.all().map((row) => ({
      id: row.id,
      type: row.type,
      agentId: row.agent_id,
      channel: row.channel,
      content: row.content,
      timestamp: row.timestamp,
      vector: blobToVec(row.vector),
    }));
  }

  pruneEvents(olderThanMs) {
    this.stmts.pruneEvents.run(olderThanMs);
  }

  getMeta(key) {
    const row = this.stmts.getMeta.get(key);
    return row ? row.value : null;
  }

  setMeta(key, value) {
    this.stmts.setMeta.run(key, String(value));
  }

  wipeVectors() {
    this.db.transaction(() => {
      this.stmts.wipeChunkVectors.run();
      this.stmts.wipeEventVectors.run();
      this.stmts.resetVectorCounts.run();
    })();
  }

  getIndexInfo() {
    const fileCount = this.stmts.countFiles.get().n;
    const vectorCount = this.stmts.countChunks.get().n || 0;
    return { fileCount, vectorCount };
  }

  close() {
    try { this.db.close(); } catch { /* ignore */ }
  }
}

/** Migrate from the old monolithic JSON memory.db if it exists. */
function migrateFromJson(jsonPath, memDb) {
  if (!fs.existsSync(jsonPath)) return false;
  let parsed;
  try {
    const raw = fs.readFileSync(jsonPath, 'utf8');
    parsed = JSON.parse(raw);
  } catch {
    return false;
  }
  // If it already looks like a valid JSON memory dump (not SQLite)
  if (!parsed || typeof parsed !== 'object' || !parsed.files) return false;
  let migrated = 0;
  for (const [rel, item] of Object.entries(parsed.files || {})) {
    try {
      const chunks = (item.searchChunks || []).map((c) => ({ text: c.text, vector: c.vector }));
      memDb.upsertFile({
        relPath: rel,
        absPath: item.absPath || '',
        module: item.module || 'root',
        mtimeMs: item.mtimeMs || 0,
        size: item.size || 0,
        importCount: item.importCount || 0,
        imports: item.imports || [],
        chunkCount: item.chunkCount || chunks.length,
        vectorCount: item.vectorCount || chunks.length,
        summary: item.summary || '',
      }, chunks);
      migrated++;
    } catch { /* skip bad entries */ }
  }
  if (migrated > 0) {
    // Rename the old file as backup
    try { fs.renameSync(jsonPath, jsonPath + '.bak'); } catch { /* ignore */ }
    return true;
  }
  return false;
}

module.exports = { MemoryDB, migrateFromJson };
