const { ipcMain } = require('electron');
const { IPC } = require('../shared/constants');

const SESSION_MAX = 200;

function setup({ store, detectTool }) {
  function getSessionRefs() {
    const refs = store.get('sessionRefs', []);
    return Array.isArray(refs) ? refs : [];
  }

  function rankSessionRefs(refs) {
    const now = Date.now();
    return refs
      .map((ref) => {
        const hours = Math.max(0, (now - Number(ref.lastUsedAt || now)) / 3600000);
        const recencyScore = Math.max(0, 96 - hours);
        const freqScore = Math.min(40, Number(ref.useCount || 1) * 2);
        const pinScore = ref.pinned ? 250 : 0;
        const knownToolBonus = ref.tool === 'claude' || ref.tool === 'codex' ? 12 : 0;
        return { ...ref, _score: pinScore + recencyScore + freqScore + knownToolBonus };
      })
      .sort((a, b) => {
        if (b._score !== a._score) return b._score - a._score;
        return Number(b.lastUsedAt || 0) - Number(a.lastUsedAt || 0);
      })
      .map(({ _score, ...ref }) => ref);
  }

  function setSessionRefs(refs) {
    const deduped = new Map();
    for (const ref of refs) {
      if (!ref || !ref.id) continue;
      if (!deduped.has(ref.id)) deduped.set(ref.id, ref);
    }
    const ranked = rankSessionRefs(Array.from(deduped.values()));
    store.set('sessionRefs', ranked);
    return ranked;
  }

  function normalizeSessionRef(input) {
    const now = Date.now();
    const command = String(input?.command || '').trim();
    if (!command) return null;
    const cwd = String(input?.cwd || '').trim();
    const tool = String(input?.tool || detectTool(command));
    const fingerprint = String(input?.fingerprint || `${tool}|${cwd}|${command}`);
    const label = String(input?.label || `${tool.toUpperCase()} ${cwd || 'session'}`);
    const result = {
      id: String(input?.id || `session-${now}-${Math.random().toString(36).slice(2, 8)}`),
      label,
      tool,
      cwd,
      command,
      fingerprint,
      pinned: Boolean(input?.pinned),
      useCount: Math.max(1, Number(input?.useCount || 1)),
      createdAt: Number(input?.createdAt || now),
      lastUsedAt: Number(input?.lastUsedAt || now),
    };
    const resumeId = String(input?.claudeSessionId || '').trim();
    if (resumeId) result.claudeSessionId = resumeId;
    return result;
  }

  ipcMain.handle(IPC.SESSION_LIST, () => rankSessionRefs(getSessionRefs()));
  ipcMain.handle(IPC.SESSION_UPSERT, (_e, payload) => {
    const normalized = normalizeSessionRef(payload);
    if (!normalized) return rankSessionRefs(getSessionRefs());

    const refs = getSessionRefs();
    if (refs.some((ref) => ref.id === normalized.id)) {
      return { error: `Session with ID "${normalized.id}" already exists` };
    }
    if (refs.length >= SESSION_MAX) {
      return { error: `Session limit reached (${SESSION_MAX}). Remove sessions before adding more.` };
    }
    refs.push(normalized);
    return setSessionRefs(refs);
  });
  ipcMain.handle(IPC.SESSION_REMOVE, (_e, id) => {
    const targetId = String(id || '');
    const next = getSessionRefs().filter((ref) => ref.id !== targetId);
    return setSessionRefs(next);
  });
  ipcMain.handle(IPC.SESSION_PIN, (_e, id, pinned) => {
    const targetId = String(id || '');
    const next = getSessionRefs().map((ref) => (
      ref.id === targetId ? { ...ref, pinned: Boolean(pinned) } : ref
    ));
    return setSessionRefs(next);
  });
  ipcMain.handle(IPC.SESSION_TOUCH, (_e, id) => {
    const targetId = String(id || '');
    const next = getSessionRefs().map((ref) => (
      ref.id === targetId
        ? { ...ref, lastUsedAt: Date.now(), useCount: Math.max(1, Number(ref.useCount || 1) + 1) }
        : ref
    ));
    return setSessionRefs(next);
  });
  ipcMain.handle(IPC.SESSION_RENAME, (_e, id, label) => {
    const targetId = String(id || '');
    const newLabel = String(label || '').trim();
    if (!newLabel) return rankSessionRefs(getSessionRefs());
    const next = getSessionRefs().map((ref) => (
      ref.id === targetId ? { ...ref, label: newLabel } : ref
    ));
    return setSessionRefs(next);
  });
  ipcMain.handle(IPC.SESSION_TOGGLE_MCP, (_e, id) => {
    const targetId = String(id || '');
    const next = getSessionRefs().map((ref) => (
      ref.id === targetId ? { ...ref, useMcp: !ref.useMcp } : ref
    ));
    return setSessionRefs(next);
  });
}

module.exports = { setup };
