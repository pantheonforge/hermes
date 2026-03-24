const { ipcMain } = require('electron');
const { IPC } = require('../shared/constants');

function setup(deps) {
  ipcMain.handle(IPC.MEMORY_GET_SNAPSHOT, () => deps.memoryIndex?.getSnapshot() || null);
  ipcMain.handle(IPC.MEMORY_RESCAN, async () => {
    if (!deps.memoryIndex) return null;
    const cfg = deps.store.store;
    return deps.memoryIndex.startScan(cfg.memoryProjectPath || '');
  });
  ipcMain.handle(IPC.MEMORY_SET_PROJECT_PATH, async (_e, projectPath) => {
    if (!deps.memoryIndex) return null;
    deps.memoryIndex.setProjectPath(projectPath);
    deps.store.set('memoryProjectPath', String(projectPath || '').trim());
    return deps.memoryIndex.getSnapshot();
  });
  ipcMain.handle(IPC.MEMORY_GET_FILE_DETAILS, (_e, filePath) =>
    deps.memoryIndex?.getFileDetails(filePath) || null);
  ipcMain.handle(IPC.MEMORY_SEMANTIC_SEARCH, async (_e, query, limit, scope) =>
    deps.memoryIndex?.semanticSearch(query, limit, scope) || { ok: true, needsIndex: true, results: [] });
  ipcMain.handle(IPC.MEMORY_GET_GRAPH_EDGES, () =>
    deps.memoryIndex?.getSemanticEdges() || []);
  ipcMain.handle(IPC.MEMORY_GET_PATH_SCAN_INFO, (_e, projectPath) =>
    deps.memoryIndex?.getPathScanInfo(projectPath) || null);
}

module.exports = { setup };
