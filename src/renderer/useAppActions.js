import { useEffect } from 'react';
import { collectLeafIds, replaceNode, findLeaf } from './TerminalGrid';

const IPC = {
  FOCUS_TERMINAL: 'app:focus-terminal',
  LAUNCH_CLAUDE: 'app:launch-claude',
  LAUNCH_CODEX: 'app:launch-codex',
  CLEAR_TERMINAL: 'app:clear-terminal',
  RESTART_CLAUDE: 'app:restart-claude',
  RESTART_CODEX: 'app:restart-codex',
  TOGGLE_MONITOR: 'app:toggle-monitor',
  TOGGLE_MANAGER: 'app:toggle-manager',
  OPEN_CONFIG: 'app:open-config',
  COPY_STATE: 'app:copy-state',
  SPLIT_V: 'app:split-v',
  SPLIT_H: 'app:split-h',
  CLOSE_PANE: 'app:close-pane',
  NEXT_PANE: 'app:next-pane',
  PREV_PANE: 'app:prev-pane',
  SHOW_HELP: 'app:show-help',
  NEW_TAB: 'app:new-tab',
  TOGGLE_SESSIONS: 'app:toggle-sessions',
  OPEN_INLINE_EDITOR: 'app:open-inline-editor',
  TOGGLE_MEMORY_MAP: 'app:toggle-memory-map',
  TOGGLE_SEMANTIC_SEARCH: 'app:toggle-semantic-search',
  TOGGLE_DEP_GRAPH: 'app:toggle-dep-graph',
  TOGGLE_AGENT_TREE: 'app:toggle-agent-tree',
  COLLAPSE_ALL: 'app:collapse-all',
  TOGGLE_PALETTE: 'app:toggle-palette',
};

const IPC_TO_HINT = {
  [IPC.LAUNCH_CLAUDE]: 'Ctrl+Enter',
  [IPC.LAUNCH_CODEX]: 'Ctrl+Shift+Enter',
  [IPC.CLEAR_TERMINAL]: 'Ctrl+Shift+K',
  [IPC.SPLIT_V]: 'Ctrl+Shift+D',
  [IPC.SPLIT_H]: 'Ctrl+Shift+E',
  [IPC.CLOSE_PANE]: 'Ctrl+W',
  [IPC.NEXT_PANE]: 'Ctrl+Shift+N',
  [IPC.COLLAPSE_ALL]: 'Ctrl+Shift+W',
  [IPC.TOGGLE_MONITOR]: 'Ctrl+Alt+B',
  [IPC.TOGGLE_MANAGER]: 'Ctrl+Alt+T',
  [IPC.TOGGLE_SESSIONS]: 'Ctrl+Alt+Y',
  [IPC.TOGGLE_MEMORY_MAP]: 'Ctrl+Alt+M',
  [IPC.TOGGLE_SEMANTIC_SEARCH]: 'Ctrl+Shift+F',
  [IPC.TOGGLE_DEP_GRAPH]: 'Ctrl+Alt+G',
  [IPC.TOGGLE_AGENT_TREE]: 'Ctrl+Alt+J',
  [IPC.OPEN_INLINE_EDITOR]: 'Ctrl+Shift+I',
};

export function useAppActions(params) {
  const {
    activeTabIdRef,
    tabActionRefs,
    getTabById,
    focusPane,
    updateTab,
    allocTermId,
    closePaneInTab,
    openInlineEditor,
    openNewTabPicker,
    showToast,
    setActiveSidebar,
    setActiveContext,
    setConfigOpen,
    setGitOpen,
    setCodebaseOpen,
    setCodeViewerFile,
    setShowHelp,
    setRecentHintKeys,
    setPaletteOpen,
    config,
  } = params;

  useEffect(() => {
    const cleanup = window.electron.onAction((channel, ...args) => {
      const tabId = activeTabIdRef.current;
      const tab = getTabById(tabId);
      if (!tab) return;

      switch (channel) {
        case IPC.FOCUS_TERMINAL: {
          const ids = collectLeafIds(tab.paneTree);
          const id = ids[args[0]];
          if (id) focusPane(tabId, id);
          break;
        }
        case IPC.LAUNCH_CLAUDE:
          tabActionRefs.current[tabId]?.current.launchClaude?.();
          break;
        case IPC.LAUNCH_CODEX:
          tabActionRefs.current[tabId]?.current.launchCodex?.();
          break;
        case IPC.CLEAR_TERMINAL:
          tabActionRefs.current[tabId]?.current.clear?.();
          break;
        case IPC.RESTART_CLAUDE:
          tabActionRefs.current[tabId]?.current.restartClaude?.();
          break;
        case IPC.RESTART_CODEX:
          tabActionRefs.current[tabId]?.current.restartCodex?.();
          break;
        case IPC.TOGGLE_MONITOR:
          setActiveSidebar((v) => (v === 'monitor' ? null : 'monitor'));
          setActiveContext('monitor');
          break;
        case IPC.TOGGLE_MANAGER:
          setActiveSidebar((v) => (v === 'manager' ? null : 'manager'));
          setActiveContext('manager');
          break;
        case IPC.OPEN_CONFIG:
          setConfigOpen(true);
          break;
        case IPC.COPY_STATE:
          showToast('Shared state copied to clipboard');
          break;
        case IPC.SPLIT_V: {
          const targetId = tab.focusedPaneId || collectLeafIds(tab.paneTree)[0];
          if (!targetId) break;
          const existingIds = new Set(collectLeafIds(tab.paneTree));
          let newId = allocTermId();
          while (existingIds.has(newId)) newId = allocTermId();
          const existingLeaf = findLeaf(tab.paneTree, targetId) || { type: 'leaf', id: targetId };
          updateTab(tabId, (prevTab) => ({
            ...prevTab,
            paneTree: replaceNode(prevTab.paneTree, targetId, {
              type: 'split',
              dir: 'v',
              ratio: 0.5,
              a: existingLeaf,
              b: { type: 'leaf', id: newId, cwd: config?.cwd || '', startupCommand: '' },
            }),
            focusedPaneId: newId,
          }));
          setActiveContext('terminal');
          break;
        }
        case IPC.SPLIT_H: {
          const targetId = tab.focusedPaneId || collectLeafIds(tab.paneTree)[0];
          if (!targetId) break;
          const existingIds = new Set(collectLeafIds(tab.paneTree));
          let newId = allocTermId();
          while (existingIds.has(newId)) newId = allocTermId();
          const existingLeaf = findLeaf(tab.paneTree, targetId) || { type: 'leaf', id: targetId };
          updateTab(tabId, (prevTab) => ({
            ...prevTab,
            paneTree: replaceNode(prevTab.paneTree, targetId, {
              type: 'split',
              dir: 'h',
              ratio: 0.5,
              a: existingLeaf,
              b: { type: 'leaf', id: newId, cwd: config?.cwd || '', startupCommand: '' },
            }),
            focusedPaneId: newId,
          }));
          setActiveContext('terminal');
          break;
        }
        case IPC.CLOSE_PANE:
          closePaneInTab(tabId, tab.focusedPaneId);
          break;
        case IPC.NEXT_PANE: {
          const ids = collectLeafIds(tab.paneTree);
          const idx = ids.indexOf(tab.focusedPaneId);
          focusPane(tabId, ids[(idx + 1) % ids.length]);
          break;
        }
        case IPC.PREV_PANE: {
          const ids = collectLeafIds(tab.paneTree);
          const idx = ids.indexOf(tab.focusedPaneId);
          focusPane(tabId, ids[(idx - 1 + ids.length) % ids.length]);
          break;
        }
        case IPC.COLLAPSE_ALL:
          setActiveSidebar(null);
          setGitOpen(false);
          setCodeViewerFile(null);
          setActiveContext('terminal');
          break;
        case IPC.SHOW_HELP:
          setShowHelp(true);
          break;
        case IPC.NEW_TAB:
          openNewTabPicker();
          break;
        case IPC.TOGGLE_SESSIONS:
          setActiveSidebar((v) => (v === 'sessions' ? null : 'sessions'));
          setActiveContext('sessions');
          break;
        case IPC.OPEN_INLINE_EDITOR:
          openInlineEditor();
          break;
        case IPC.TOGGLE_MEMORY_MAP:
        case IPC.TOGGLE_SEMANTIC_SEARCH:
          setCodebaseOpen((v) => !v);
          setActiveContext('codebase');
          break;
        case IPC.TOGGLE_DEP_GRAPH:
          setActiveSidebar((v) => (v === 'dep-graph' ? null : 'dep-graph'));
          setActiveContext('dep-graph');
          break;
        case IPC.TOGGLE_AGENT_TREE:
          setActiveSidebar((v) => (v === 'agent-tree' ? null : 'agent-tree'));
          setActiveContext('agent-tree');
          break;
        case IPC.TOGGLE_PALETTE:
          setPaletteOpen((v) => !v);
          break;
      }
      const hk = IPC_TO_HINT[channel];
      if (hk) setRecentHintKeys((prev) => [hk, ...prev.filter((k) => k !== hk)].slice(0, 8));
    });
    return cleanup;
  }, [allocTermId, closePaneInTab, focusPane, getTabById, openInlineEditor, openNewTabPicker, showToast, updateTab]);
}
