import React, { useState, useEffect, useRef, useCallback, useMemo, Component } from 'react';
import MCPMonitor from './MCPMonitor';
import DiffTimelinePanel from './DiffTimelinePanel';
import ArtifactsPanel from './ArtifactsPanel';
import TerminalManager from './TerminalManager';
import SessionManager from './SessionManager';
import CodebasePanel from './CodebasePanel';
import SmartStderrPanel from './SmartStderrPanel';
import LiveDependencyGraph from './LiveDependencyGraph';
import AgentTreePanel from './AgentTreePanel';
import TerminalGrid, { collectLeafIds, replaceNode, removeLeaf, findLeaf } from './TerminalGrid';
import ConfigPage from './ConfigPage';
import LayoutsModal from './LayoutsModal';
import NewTabLayoutPicker from './NewTabLayoutPicker';
import Footer from './Footer';
import HelpModal from './HelpModal';
import InlineEditorModal from './InlineEditorModal';
import PromptTemplatesPanel from './PromptTemplatesPanel';
import PromptDraftsPanel, { DRAFTS_STORAGE_KEY } from './PromptDraftsPanel';
import AgentMemoryPanel from './AgentMemoryPanel';
import TodoPanel from './TodoPanel';
import ImportExportPanel from './ImportExportPanel';
import GitWorkflowPanel from './GitWorkflowPanel';
import FileExplorerPanel from './FileExplorerPanel';
import CodeViewerOverlay from './CodeViewerOverlay';
import CommandPalette from './CommandPalette';
import ContextSurgeonPanel from './ContextSurgeonPanel';
import MCPCallLogPanel from './MCPCallLogPanel';
import { useSidePanels } from './useSidePanels';
import { useAppActions } from './useAppActions';
import {
  detectTool,
  createSessionLabel,
  buildToolCommand,
  updateLeafCwd,
  normalizeFilePathForProject,
  sanitizeLayout,
  sanitizeLayouts,
  pickLayout,
  buildPaneTreeFromTerminals,
  makeTab,
  makeUniqueTermId,
  PROMPT_TEMPLATES_STORAGE_KEY,
  clampRatio,
  sanitizePaneTree,
  sanitizeWorkspaceSnapshot,
  buildPromptDraftFilename,
  parseDraftFile,
  formatSummaryUsage,
} from './app-utils';

const IPC = window.electron.IPC;

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

class ErrorBoundary extends Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(error) { return { error }; }
  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 16, color: '#f85149', fontFamily: 'monospace', fontSize: 12 }}>
          <div style={{ marginBottom: 4 }}>Panel error: {this.state.error.message}</div>
          <button style={{ fontSize: 11, cursor: 'pointer' }} onClick={() => this.setState({ error: null })}>retry</button>
        </div>
      );
    }
    return this.props.children;
  }
}

const BACKUP_LOCAL_KEYS = [PROMPT_TEMPLATES_STORAGE_KEY, DRAFTS_STORAGE_KEY];

function readLocalBackupData() {
  const localData = {};
  for (const key of BACKUP_LOCAL_KEYS) {
    localData[key] = localStorage.getItem(key);
  }
  return localData;
}

function writeLocalBackupData(raw) {
  const localData = raw && typeof raw === 'object' ? raw : {};
  for (const key of BACKUP_LOCAL_KEYS) {
    const value = localData[key];
    if (typeof value === 'string') localStorage.setItem(key, value);
    else localStorage.removeItem(key);
  }
}

function loadPromptDrafts() {
  try {
    const parsed = JSON.parse(localStorage.getItem(DRAFTS_STORAGE_KEY) || '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item) => item && typeof item === 'object' && item.id && item.name)
      .map((item) => ({
        id: String(item.id),
        name: String(item.name || '').trim(),
        project: String(item.project || '').trim(),
        content: String(item.content || ''),
        updatedAt: Number(item.updatedAt || Date.now()),
        fileName: item.fileName ? String(item.fileName) : '',
      }))
      .sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0));
  } catch {
    return [];
  }
}

function persistPromptDrafts(drafts) {
  localStorage.setItem(DRAFTS_STORAGE_KEY, JSON.stringify(drafts));
}

async function scanDraftsFolder(folder, existing) {
  if (!folder) return existing;
  let result;
  try {
    result = await window.electron.promptDrafts.readFolder({ folder });
  } catch {
    return existing;
  }
  if (!result?.ok || !Array.isArray(result.files) || result.files.length === 0) return existing;
  const existingFileNames = new Set(existing.filter((d) => d.fileName).map((d) => d.fileName));
  const next = [...existing];
  for (const { filename, content } of result.files) {
    if (existingFileNames.has(filename)) continue;
    const { name, project, content: parsedContent } = parseDraftFile(filename, content);
    if (!name) continue;
    next.push({ id: `pd-file-${filename}`, name, project, content: parsedContent, updatedAt: Date.now(), fileName: filename });
  }
  const sorted = next.sort((a, b) => b.updatedAt - a.updatedAt);
  persistPromptDrafts(sorted);
  return sorted;
}

export default function App() {
  const { activeSidebar, setActiveSidebar, gitOpen, setGitOpen, codebaseOpen, setCodebaseOpen, codeViewerFile, setCodeViewerFile, railExpanded, setRailExpanded, paletteOpen, setPaletteOpen, toggleSidebar } = useSidePanels();
  const [recentHintKeys, setRecentHintKeys] = useState([]);
  const [sessionRefs, setSessionRefs] = useState([]);
  const [configOpen, setConfigOpen] = useState(false);
  const [layoutsOpen, setLayoutsOpen] = useState(false);
  const [layoutPickerOpen, setLayoutPickerOpen] = useState(false);
  const [layoutPickerPosition, setLayoutPickerPosition] = useState(null);
  const [showHelp, setShowHelp] = useState(false);
  const [config, setConfig] = useState(null);
  const [toast, setToast] = useState(null);
  const [activeContext, setActiveContext] = useState('terminal');
  const [backupBusy, setBackupBusy] = useState(false);
  const [backupStatus, setBackupStatus] = useState('');
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorTarget, setEditorTarget] = useState(null);
  const [editorText, setEditorText] = useState('');
  const [editorDraftMeta, setEditorDraftMeta] = useState(null);
  const [promptDrafts, setPromptDrafts] = useState(loadPromptDrafts);
  const editorOpenRef = useRef(false);
  const editorTextRef = useRef('');
  const editorTargetRef = useRef(null);
  const [memorySnapshot, setMemorySnapshot] = useState(null);
  const [terminalSummaries, setTerminalSummaries] = useState({});
  const [summaryModalTerminalId, setSummaryModalTerminalId] = useState('');
  const [summaryModalShowOutput, setSummaryModalShowOutput] = useState(false);
  const [fileEditorOpen, setFileEditorOpen] = useState(false);
  const [fileEditorPath, setFileEditorPath] = useState('');
  const [fileEditorContent, setFileEditorContent] = useState('');
  const [fileEditorDirty, setFileEditorDirty] = useState(false);
  const [selectedFilePath, setSelectedFilePath] = useState(null);
  const [selectedAgentId, setSelectedAgentId] = useState('');
  const [agentNodes, setAgentNodes] = useState([]);
  const [agentActivities, setAgentActivities] = useState({});
  const [touchedFilesByAgent, setTouchedFilesByAgent] = useState({});
  const [lastTouchedByFile, setLastTouchedByFile] = useState({});
  const [hotFiles, setHotFiles] = useState(() => new Set());
  const [smartStderrEntries, setSmartStderrEntries] = useState({});

  const [voiceState, setVoiceState] = useState(null);
  const mediaRecorderRef = useRef(null);
  const chunksRef = useRef([]);
  const voiceStateRef = useRef(null);

  const [tabs, setTabs] = useState([]);
  const [activeTabId, setActiveTabId] = useState('tab-1');
  const [nextTabId, setNextTabId] = useState(2);
  const [nextTermId, setNextTermId] = useState(1);

  const tabsRef = useRef(tabs);
  const activeTabIdRef = useRef(activeTabId);
  const nextTabIdRef = useRef(nextTabId);
  const nextTermIdRef = useRef(nextTermId);
  const selectedAgentRef = useRef(selectedAgentId);
  tabsRef.current = tabs;
  voiceStateRef.current = voiceState;
  editorOpenRef.current = editorOpen;
  editorTextRef.current = editorText;
  editorTargetRef.current = editorTarget;
  activeTabIdRef.current = activeTabId;
  nextTabIdRef.current = nextTabId;
  nextTermIdRef.current = nextTermId;
  selectedAgentRef.current = selectedAgentId;

  const tabActionRefs = useRef({});
  const focusRequestRef = useRef(0);
  const toastTimer = useRef(null);
  const workspaceReadyRef = useRef(false);
  const workspaceSaveTimerRef = useRef(null);

  const allocTermId = useCallback(() => {
    const n = nextTermIdRef.current;
    nextTermIdRef.current = n + 1;
    setNextTermId(n + 1);
    return makeUniqueTermId();
  }, []);

  const allocTabId = useCallback(() => {
    const n = nextTabIdRef.current;
    nextTabIdRef.current = n + 1;
    setNextTabId(n + 1);
    return { id: `tab-${n}`, title: `Tab ${n}` };
  }, []);

  const getTabActionsRef = useCallback((tabId) => {
    if (!tabActionRefs.current[tabId]) tabActionRefs.current[tabId] = { current: {} };
    return tabActionRefs.current[tabId];
  }, []);

  const showToast = useCallback((msg) => {
    setToast(msg);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2000);
  }, []);

  const getTabById = useCallback((tabId) => tabsRef.current.find((t) => t.id === tabId) || null, []);

  const updateTab = useCallback((tabId, updater) => {
    setTabs((prev) => prev.map((tab) => (tab.id === tabId ? updater(tab) : tab)));
  }, []);

  const focusPane = useCallback((tabId, paneId) => {
    const requestId = ++focusRequestRef.current;
    setActiveTabId(tabId);
    updateTab(tabId, (tab) => ({ ...tab, focusedPaneId: paneId }));
    setActiveContext('terminal');

    const run = () => {
      if (focusRequestRef.current !== requestId) return;
      tabActionRefs.current[tabId]?.current.focus?.(paneId);
    };
    requestAnimationFrame(run);
    setTimeout(run, 16);
  }, [updateTab]);

  const closePaneInTab = useCallback((tabId, paneId) => {
    const tab = getTabById(tabId);
    if (!tab) return;
    const ids = collectLeafIds(tab.paneTree);
    if (ids.length <= 1) return;
    window.electron.pty.kill(paneId);
    const newTree = removeLeaf(tab.paneTree, paneId);
    const idx = ids.indexOf(paneId);
    const newFocused = ids[idx > 0 ? idx - 1 : 1];
    updateTab(tabId, (prevTab) => ({ ...prevTab, paneTree: newTree, focusedPaneId: newFocused }));
  }, [getTabById, updateTab]);

  const refreshSessions = useCallback(async () => {
    const refs = await window.electron.sessions.list();
    setSessionRefs(refs);
  }, []);


  const openSessionInFocusedPane = useCallback(async (session) => {
    const tabId = activeTabIdRef.current;
    const tab = getTabById(tabId);
    if (!tab) return;
    const targetPane = tab.focusedPaneId || collectLeafIds(tab.paneTree)[0];
    if (!targetPane) return;
    focusPane(tabId, targetPane);
    let baseCmd = String(session.command || '').trim();
    if (session.claudeSessionId && /\bclaude\b/.test(baseCmd)) {
      baseCmd = `${baseCmd} --resume ${session.claudeSessionId}`;
    }
    if (session.useMcp) {
      if (session.tool === 'codex' && Number(config?.mcpPort) > 0) {
        const port = Number(config.mcpPort);
        baseCmd += ` -c 'mcp_servers.hermes.url="http://localhost:${port}"' -c 'mcp_servers.hermes.transport="streamable_http"' -c 'mcp_servers.hermes.enabled=true'`;
      } else if (session.tool === 'claude' && config?.mcpConfigPath) {
        baseCmd += ` --mcp-config "${config.mcpConfigPath}"`;
      }
    }
    tabActionRefs.current[tabId]?.current.runCommand?.(targetPane, `${baseCmd}\r`);
    const refs = await window.electron.sessions.touch(session.id);
    setSessionRefs(refs);
    setActiveContext('terminal');
  }, [focusPane, getTabById, config?.mcpPort, config?.mcpConfigPath]);

  const restartPaneInTab = useCallback((tabId, paneId) => {
    tabActionRefs.current[tabId]?.current.restartShell?.(paneId);
  }, []);

  const createTabWithLayout = useCallback((layoutId) => {
    const allLayouts = sanitizeLayouts(config?.layouts);
    const layout = pickLayout(allLayouts, [layoutId, config?.lastUsedLayoutId, config?.defaultLayoutId]);
    const { id: tabId, title } = allocTabId();
    const { tree } = buildPaneTreeFromTerminals(layout.terminals, allocTermId);
    const paneId = collectLeafIds(tree)[0];
    const tab = makeTab(tabId, title, tree, paneId);
    setTabs((prev) => [...prev, tab]);
    setActiveTabId(tabId);
    return { tabId, paneId };
  }, [allocTabId, allocTermId, config?.layouts, config?.lastUsedLayoutId, config?.defaultLayoutId]);

  const createTabAndRun = useCallback((command) => {
    const created = createTabWithLayout(config?.defaultLayoutId);
    if (!created?.tabId || !created?.paneId || !command) return created;
    requestAnimationFrame(() => {
      focusPane(created.tabId, created.paneId);
      setTimeout(() => {
        tabActionRefs.current[created.tabId]?.current.runCommand?.(created.paneId, `${command}\r`);
      }, 60);
    });
    return created;
  }, [createTabWithLayout, config?.defaultLayoutId, focusPane]);

  const openNewTabPicker = useCallback(() => {
    const anchor = document.getElementById('new-tab-btn');
    if (anchor) {
      const rect = anchor.getBoundingClientRect();
      setLayoutPickerPosition({ top: rect.bottom + 4, left: rect.left });
    } else {
      setLayoutPickerPosition(null);
    }
    setLayoutPickerOpen(true);
  }, []);

  const closeLayoutPicker = useCallback(() => {
    setLayoutPickerOpen(false);
    setLayoutPickerPosition(null);
  }, []);

  const handleCreateTabFromPicker = useCallback(async (layoutId) => {
    const created = createTabWithLayout(layoutId);
    if (!created) return;
    setActiveContext('terminal');
    closeLayoutPicker();
    try {
      const nextConfig = await window.electron.config.set('lastUsedLayoutId', layoutId);
      setConfig(nextConfig);
    } catch {
      setConfig((prev) => (prev ? { ...prev, lastUsedLayoutId: layoutId } : prev));
    }
  }, [createTabWithLayout]);

  const closeTab = useCallback((tabId) => {
    setTabs((prev) => {
      if (prev.length <= 1) return prev;
      const target = prev.find((tab) => tab.id === tabId);
      if (target) {
        for (const id of collectLeafIds(target.paneTree)) window.electron.pty.kill(id);
      }
      const nextTabs = prev.filter((tab) => tab.id !== tabId);
      if (activeTabIdRef.current === tabId) setActiveTabId(nextTabs[0]?.id || 'tab-1');
      delete tabActionRefs.current[tabId];
      return nextTabs;
    });
  }, []);

  const callMcpTool = useCallback(async (name, args) => {
    if (!config?.mcpPort) return null;
    try {
      const body = {
        jsonrpc: '2.0',
        id: Date.now(),
        method: 'tools/call',
        params: { name, arguments: args || {} },
      };
      const res = await fetch(`http://localhost:${config.mcpPort}/`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-hermes-token': config.mcpSessionToken || '' },
        body: JSON.stringify(body),
      });
      return await res.json();
    } catch {
      return null;
    }
  }, [config?.mcpPort, config?.memoryProjectPath, config?.cwd]);

  const requestTerminalSummary = useCallback(async (terminalId, outputText) => {
    const id = String(terminalId || '').trim();
    const text = String(outputText || '');
    if (!id || !text) return;
    setSummaryModalTerminalId(id);
    setSummaryModalShowOutput(true);
    setTerminalSummaries((prev) => ({
      ...prev,
      [id]: {
        terminalId: id,
        status: 'running',
        text: '',
        outputText: text,
        usage: null,
        error: '',
      },
    }));
    const response = await callMcpTool('summarize_terminal_output', {
      terminal_id: id,
      output_text: text,
      prompt: 'Summarise this terminal output in 3 lines. Lead with the outcome, then the cause, then the recommended action if any.',
    });
    if (response?.error) {
      setTerminalSummaries((prev) => ({
        ...prev,
        [id]: {
          terminalId: id,
          status: 'error',
          text: '',
          outputText: text,
          usage: null,
          error: String(response.error?.message || 'Summary request failed'),
        },
      }));
    }
  }, [callMcpTool]);

  const clearTerminalSummary = useCallback((terminalId) => {
    const id = String(terminalId || '').trim();
    if (!id) return;
    setTerminalSummaries((prev) => {
      if (!prev[id]) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });
    setSummaryModalTerminalId((current) => (current === id ? '' : current));
    setSummaryModalShowOutput(false);
  }, []);

  const openSearchResultInEditor = useCallback(async (result) => {
    const absPath = String(result?.absPath || '').trim();
    const filePath = String(result?.filePath || '').trim();
    const target = absPath || filePath;
    if (!target) return;
    const loaded = await window.electron.files.readText(target);
    if (!loaded?.ok) {
      showToast(loaded?.error || 'Failed to open file');
      return;
    }
    setFileEditorPath(String(result?.filePath || loaded.filePath || target));
    setFileEditorContent(String(loaded.content || ''));
    setFileEditorDirty(false);
    setFileEditorOpen(true);
  }, [showToast]);

  const saveOpenFileEditor = useCallback(async () => {
    if (!fileEditorPath) return;
    const written = await window.electron.files.writeText(fileEditorPath, fileEditorContent);
    if (!written?.ok) {
      showToast(written?.error || 'Failed to save file');
      return;
    }
    setFileEditorDirty(false);
    showToast('File saved');
  }, [fileEditorPath, fileEditorContent, showToast]);

  const startRecording = useCallback(async () => {
    if (mediaRecorderRef.current?.state === 'recording') return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream);
      chunksRef.current = [];
      mr.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      mr.start();
      mediaRecorderRef.current = mr;
      setVoiceState('recording');
    } catch (err) {
      console.error('[voice] failed to start recording:', err);
    }
  }, []);

  const stopRecording = useCallback(async () => {
    const mr = mediaRecorderRef.current;
    if (!mr || mr.state === 'inactive') return;
    setVoiceState('processing');
    await new Promise((resolve) => {
      mr.onstop = resolve;
      mr.stop();
      mr.stream.getTracks().forEach((t) => t.stop());
    });
    try {
      const blob = new Blob(chunksRef.current, { type: mr.mimeType });
      const rawBuffer = await blob.arrayBuffer();
      // Decode compressed audio → PCM, then resample to 16 kHz mono (required by Whisper)
      const audioCtx = new AudioContext();
      const audioBuffer = await audioCtx.decodeAudioData(rawBuffer);
      audioCtx.close();
      const targetRate = 16000;
      const offlineCtx = new OfflineAudioContext(1, Math.ceil(audioBuffer.duration * targetRate), targetRate);
      const src = offlineCtx.createBufferSource();
      src.buffer = audioBuffer;
      src.connect(offlineCtx.destination);
      src.start();
      const resampled = await offlineCtx.startRendering();
      const float32 = resampled.getChannelData(0);
      const transcript = await window.electron.voice.transcribe(float32.buffer).catch(() => '');
      if (!transcript) { setVoiceState(null); return; }
      setVoiceState('injecting');
      if (editorOpenRef.current) {
        const next = editorTextRef.current ? `${editorTextRef.current} ${transcript}` : transcript;
        setEditorText(next);
      } else {
        const tab = tabsRef.current.find((t) => t.id === activeTabIdRef.current);
        if (!tab) { setVoiceState(null); return; }
        const paneId = tab.focusedPaneId || collectLeafIds(tab.paneTree)[0];
        if (!paneId) { setVoiceState(null); return; }
        window.electron.pty.input(paneId, transcript);
      }
      setTimeout(() => setVoiceState(null), 600);
    } catch (err) {
      console.error('[voice] transcription error:', err);
      setVoiceState(null);
    }
  }, []);

  useEffect(() => {
    const onKeyDown = (e) => {
      if (e.ctrlKey && e.code === 'Space') {
        e.preventDefault();
        e.stopPropagation();
        startRecording();
      }
    };
    const onKeyUp = (e) => {
      if (e.code === 'Space' && voiceStateRef.current === 'recording') {
        e.preventDefault();
        e.stopPropagation();
        stopRecording();
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('keyup', onKeyUp, true);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('keyup', onKeyUp, true);
    };
  }, [startRecording, stopRecording]);

  const openInlineEditor = useCallback(() => {
    const tabId = activeTabIdRef.current;
    const tab = getTabById(tabId);
    if (!tab) return;
    const paneId = tab.focusedPaneId || collectLeafIds(tab.paneTree)[0];
    if (!paneId) return;
    setEditorTarget({ tabId, paneId });
    setEditorDraftMeta(null);
    setEditorText('');
    setEditorOpen(true);
  }, [getTabById]);

  const handleEditorChange = useCallback((next) => {
    setEditorText(next);
  }, []);

  const closeInlineEditor = useCallback(() => {
    setEditorOpen(false);
    setEditorTarget(null);
    setEditorDraftMeta(null);
    setEditorText('');
  }, []);

  const closeInlineEditorPreserve = useCallback(() => {
    setEditorOpen(false);
  }, []);

  const sendInlineEditor = useCallback(() => {
    const draft = String(editorText || '');
    if (!draft) {
      setEditorOpen(false);
      return;
    }
    let tabId = editorTarget?.tabId;
    let paneId = editorTarget?.paneId;
    const tab = tabId ? getTabById(tabId) : null;
    const ids = tab ? collectLeafIds(tab.paneTree) : [];
    if (!tab || !paneId || !ids.includes(paneId)) {
      tabId = activeTabIdRef.current;
      const fallbackTab = getTabById(tabId);
      if (!fallbackTab) return;
      paneId = fallbackTab.focusedPaneId || collectLeafIds(fallbackTab.paneTree)[0];
      if (!paneId) return;
    }
    focusPane(tabId, paneId);
    tabActionRefs.current[tabId]?.current.runCommand?.(paneId, draft);
    closeInlineEditorPreserve();
    setActiveContext('terminal');
  }, [closeInlineEditorPreserve, editorTarget, editorText, focusPane, getTabById]);

  const clearInlineEditor = useCallback(() => {
    setEditorText('');
  }, []);

  const sendPromptToTerminal = useCallback((text) => {
    const tabId = activeTabIdRef.current;
    const tab = getTabById(tabId);
    if (!tab) return;
    const paneId = tab.focusedPaneId || collectLeafIds(tab.paneTree)[0];
    if (!paneId) return;
    focusPane(tabId, paneId);
    tabActionRefs.current[tabId]?.current.runCommand?.(paneId, text);
    setActiveContext('terminal');
  }, [focusPane, getTabById]);

  const openEditorWithContent = useCallback((draft) => {
    const tabId = activeTabIdRef.current;
    const tab = getTabById(tabId);
    if (!tab) return;
    const paneId = tab.focusedPaneId || collectLeafIds(tab.paneTree)[0];
    if (!paneId) return;
    setEditorTarget({ tabId, paneId });
    setEditorDraftMeta(draft || null);
    setEditorText(String(draft?.content || ''));
    setEditorOpen(true);
  }, [getTabById]);

  const syncDraftFileWrite = useCallback(async (folder, filename, project, name, content) => {
    if (!folder) return { ok: true, fileName: '' };
    const finalName = filename || buildPromptDraftFilename(project, name);
    const body = `# ${name}\n\nProject: ${project || 'Unassigned'}\n\n${content}`;
    const result = await window.electron.promptDrafts.writeFile({
      folder,
      filename: finalName,
      content: body,
    });
    if (!result?.ok) {
      showToast(result?.error || 'Draft file save failed');
      return { ok: false, fileName: '' };
    }
    return { ok: true, fileName: finalName };
  }, [showToast]);

  const syncDraftFileDelete = useCallback(async (folder, filename) => {
    if (!folder || !filename) return;
    await window.electron.promptDrafts.deleteFile({ folder, filename }).catch(() => {});
  }, []);

  const handleSaveDraft = useCallback(async (payload) => {
    const id = String(payload?.id || '').trim();
    const name = String(payload?.name || '').trim();
    const project = String(payload?.project || '').trim();
    const content = String(payload?.content || '');
    if (!id || !name || !content) return;
    const now = Date.now();
    const folder = String(config?.promptDraftsFolder || '').trim();
    const nextFilename = folder ? buildPromptDraftFilename(project, name) : '';
    let oldFilename = '';
    let saved = null;
    let fileName = '';
    setPromptDrafts((prev) => {
      const existing = prev.find((d) => d.id === id);
      oldFilename = String(existing?.fileName || payload?.fileName || '');
      saved = {
        id,
        name,
        project,
        content,
        updatedAt: now,
        fileName: folder ? nextFilename : '',
      };
      const next = [saved, ...prev.filter((d) => d.id !== id)].sort((a, b) => b.updatedAt - a.updatedAt);
      persistPromptDrafts(next);
      return next;
    });
    if (folder) {
      const writeResult = await syncDraftFileWrite(folder, nextFilename, project, name, content);
      if (writeResult.ok) fileName = writeResult.fileName;
      if (oldFilename && oldFilename !== writeResult.fileName) await syncDraftFileDelete(folder, oldFilename);
    }
    if (saved) {
      const updatedDraft = { ...saved, fileName: fileName || saved.fileName || '' };
      setEditorDraftMeta(updatedDraft);
      setPromptDrafts((prev) => {
        const next = prev.map((d) => (d.id === id ? updatedDraft : d));
        persistPromptDrafts(next);
        return next;
      });
    }
    showToast('Draft updated');
  }, [config?.promptDraftsFolder, showToast, syncDraftFileDelete, syncDraftFileWrite]);

  const handleSaveDraftAs = useCallback(async (payload) => {
    const name = String(payload?.name || '').trim();
    const project = String(payload?.project || '').trim();
    const content = String(payload?.content || '');
    if (!name || !content) return;
    const now = Date.now();
    const id = `pd-${now}-${Math.random().toString(36).slice(2, 7)}`;
    const folder = String(config?.promptDraftsFolder || '').trim();
    const filename = folder ? buildPromptDraftFilename(project, name) : '';
    const draft = {
      id,
      name,
      project,
      content,
      updatedAt: now,
      fileName: filename,
    };
    setPromptDrafts((prev) => {
      const next = [draft, ...prev].sort((a, b) => b.updatedAt - a.updatedAt);
      persistPromptDrafts(next);
      return next;
    });
    if (folder) await syncDraftFileWrite(folder, filename, project, name, content);
    setEditorDraftMeta(draft);
    showToast('Draft saved');
  }, [config?.promptDraftsFolder, showToast, syncDraftFileWrite]);

  const createSmartStderrDraft = useCallback(async (entry) => {
    const type = String(entry?.type || 'UNKNOWN').trim() || 'UNKNOWN';
    const cwd = String(entry?.cwd || '').trim();
    const terminalId = String(entry?.terminalId || '').trim() || 'terminal';
    const stamp = new Date(Number(entry?.timestamp || Date.now())).toISOString().replace(/[:.]/g, '-');
    const project = cwd ? String(cwd).split(/[\\/]/).filter(Boolean).pop() || 'Unassigned' : 'Unassigned';
    const name = `fix_${type.toLowerCase()}_${terminalId}_${stamp}`;
    const content = `Fix the following error in ${cwd || 'current workspace'}:\n\n${String(entry?.raw || '').trim()}\n\nClassified as: ${type}\nLikely cause: ${String(entry?.cause || '')}\nSuggested fix: ${String(entry?.fix || '')}`;
    await handleSaveDraftAs({ name, project, content });
  }, [handleSaveDraftAs]);

  const handleDeleteDraft = useCallback(async (id) => {
    const removed = promptDrafts.find((d) => d.id === id) ?? null;
    setPromptDrafts((prev) => {
      const next = prev.filter((d) => d.id !== id);
      persistPromptDrafts(next);
      return next;
    });
    if (removed?.id && editorDraftMeta?.id === removed.id) setEditorDraftMeta(null);
    const folder = String(config?.promptDraftsFolder || '').trim();
    if (folder && removed?.fileName) await syncDraftFileDelete(folder, removed.fileName);
  }, [promptDrafts, config?.promptDraftsFolder, editorDraftMeta?.id, syncDraftFileDelete]);

  const handleRenameDraft = useCallback((id, newName) => {
    setPromptDrafts((prev) => {
      const next = prev.map((d) => d.id === id ? { ...d, name: newName, updatedAt: Date.now() } : d);
      persistPromptDrafts(next);
      return next;
    });
  }, []);

  const handleExportBackup = useCallback(async () => {
    setBackupBusy(true);
    setBackupStatus('Exporting backup...');
    try {
      const result = await window.electron.backup.export({ localData: readLocalBackupData() });
      if (result?.canceled) {
        setBackupStatus('Export canceled');
        return;
      }
      if (!result?.ok) {
        setBackupStatus(result?.error || 'Export failed');
        return;
      }
      setBackupStatus(`Exported to ${result.filePath}`);
      showToast('Backup exported');
    } catch {
      setBackupStatus('Export failed');
    } finally {
      setBackupBusy(false);
    }
  }, [showToast]);

  const handleImportBackup = useCallback(async () => {
    setBackupBusy(true);
    setBackupStatus('Selecting backup file...');
    try {
      const picked = await window.electron.backup.importPick();
      if (picked?.canceled) {
        setBackupStatus('Import canceled');
        return;
      }
      if (!picked?.ok || !picked?.data?.config) {
        setBackupStatus(picked?.error || 'Invalid backup file');
        return;
      }
      setBackupStatus('Applying imported backup...');
      const applied = await window.electron.backup.importApplyConfig(picked.data.config);
      if (!applied?.ok || !applied?.config) {
        setBackupStatus(applied?.error || 'Failed to apply backup config');
        return;
      }
      writeLocalBackupData(picked.data.localData);
      setPromptDrafts(loadPromptDrafts());
      const cfg = applied.config;
      const restored = sanitizeWorkspaceSnapshot(cfg?.workspaceSnapshot);
      if (restored) {
        setTabs(restored.tabs);
        setActiveTabId(restored.activeTabId);
        setNextTabId(restored.nextTabId);
        setNextTermId(restored.nextTermId);
        nextTabIdRef.current = restored.nextTabId;
        nextTermIdRef.current = restored.nextTermId;
      } else {
        const startupLayout = pickLayout(cfg.layouts, [cfg.defaultLayoutId, cfg.lastUsedLayoutId]);
        const { tree } = buildPaneTreeFromTerminals(startupLayout.terminals, allocTermId);
        const firstFocused = collectLeafIds(tree)[0];
        setTabs([makeTab('tab-1', 'Tab 1', tree, firstFocused)]);
        setActiveTabId('tab-1');
        setNextTabId(2);
        setNextTermId(nextTermIdRef.current);
        nextTabIdRef.current = 2;
      }
      setConfig(cfg);
      setBackupStatus(`Imported from ${picked.filePath}`);
      setActiveSidebar(null);
      showToast('Backup imported');
    } catch {
      setBackupStatus('Import failed');
    } finally {
      setBackupBusy(false);
    }
  }, [allocTermId, showToast]);

  useEffect(() => {
    window.electron.config.get()
      .then((cfg) => {
        const restored = sanitizeWorkspaceSnapshot(cfg?.workspaceSnapshot);
        setConfig(cfg);
        if (restored) {
          setTabs(restored.tabs);
          setActiveTabId(restored.activeTabId);
          setNextTabId(restored.nextTabId);
          setNextTermId(restored.nextTermId);
          nextTabIdRef.current = restored.nextTabId;
          nextTermIdRef.current = restored.nextTermId;
        } else {
          const startupLayout = pickLayout(cfg.layouts, [cfg.defaultLayoutId, cfg.lastUsedLayoutId]);
          const { tree } = buildPaneTreeFromTerminals(startupLayout.terminals, allocTermId);
          const firstFocused = collectLeafIds(tree)[0];
          setTabs([makeTab('tab-1', 'Tab 1', tree, firstFocused)]);
          setActiveTabId('tab-1');
          setNextTabId(2);
          setNextTermId(nextTermIdRef.current);
          nextTabIdRef.current = 2;
        }
        workspaceReadyRef.current = true;
        const folder = String(cfg?.promptDraftsFolder || '').trim();
        if (folder) {
          scanDraftsFolder(folder, loadPromptDrafts()).then(setPromptDrafts).catch(() => {});
        }
      })
      .catch((err) => console.error('[hermes] config.get() failed:', err));
  }, [allocTermId]);

  useEffect(() => {
    refreshSessions().catch((err) => console.error('[hermes] sessions.list() failed:', err));
  }, [refreshSessions]);

  useEffect(() => {
    const folder = String(config?.promptDraftsFolder || '').trim();
    if (!folder) return;
    scanDraftsFolder(folder, loadPromptDrafts()).then(setPromptDrafts).catch(() => {});
  }, [config?.promptDraftsFolder]);

  useEffect(() => {
    if (!workspaceReadyRef.current || !config || tabs.length === 0) return undefined;
    clearTimeout(workspaceSaveTimerRef.current);
    workspaceSaveTimerRef.current = setTimeout(() => {
      const snapshot = {
        tabs,
        activeTabId,
        nextTabId: nextTabIdRef.current,
        nextTermId: nextTermIdRef.current,
      };
      window.electron.workspace.set(snapshot).catch(() => {});
    }, 250);
    return () => clearTimeout(workspaceSaveTimerRef.current);
  }, [config, tabs, activeTabId]);

  useEffect(() => {
    const handleBeforeUnload = () => {
      clearTimeout(workspaceSaveTimerRef.current);
      if (!workspaceReadyRef.current || tabsRef.current.length === 0) return;
      const snapshot = {
        tabs: tabsRef.current,
        activeTabId: activeTabIdRef.current,
        nextTabId: nextTabIdRef.current,
        nextTermId: nextTermIdRef.current,
      };
      window.electron.workspace.set(snapshot).catch(() => {});
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, []);

  useEffect(() => {
    window.electron.memory.getSnapshot()
      .then((snapshot) => {
        if (snapshot) setMemorySnapshot(snapshot);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    const offSmartStderr = window.electron.pty.onSmartStderr((entry) => {
      const terminalId = String(entry?.terminalId || '').trim();
      if (!terminalId) return;
      setSmartStderrEntries((prev) => {
        const current = Array.isArray(prev[terminalId]) ? prev[terminalId] : [];
        return { ...prev, [terminalId]: [entry, ...current].slice(0, 120) };
      });
    });
    const offTerminalExit = window.electron.pty.onExit((terminalId) => {
      const id = String(terminalId || '').trim();
      if (!id) return;
      setSmartStderrEntries((prev) => {
        if (!prev[id]) return prev;
        const next = { ...prev };
        delete next[id];
        return next;
      });
    });
    return () => {
      offSmartStderr?.();
      offTerminalExit?.();
    };
  }, []);

  useEffect(() => {
    if (!memorySnapshot?.scanning) return undefined;
    let cancelled = false;
    const timer = setInterval(() => {
      window.electron.memory.getSnapshot()
        .then((snapshot) => {
          if (!cancelled && snapshot) setMemorySnapshot(snapshot);
        })
        .catch(() => {});
    }, 700);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [memorySnapshot?.scanning]);

  // Poll focused pane's PTY cwd while agent-memory panel is open
  useEffect(() => {
    if (activeSidebar !== 'agent-memory') return undefined;
    const poll = async () => {
      const tab = tabsRef.current.find((t) => t.id === activeTabIdRef.current);
      if (!tab) return;
      const pid = tab.focusedPaneId || (tab.paneTree ? collectLeafIds(tab.paneTree)[0] : '');
      if (!pid) return;
      const cwd = await window.electron.pty.getCwd(pid).catch(() => null);
      if (!cwd) return;
      updateTab(tab.id, (prevTab) => {
        const leaf = findLeaf(prevTab.paneTree, pid);
        if (!leaf || leaf.cwd === cwd) return prevTab;
        return { ...prevTab, paneTree: updateLeafCwd(prevTab.paneTree, pid, cwd) };
      });
    };
    poll();
    const timer = setInterval(poll, 2000);
    return () => clearInterval(timer);
  }, [activeSidebar, updateTab]);

  useEffect(() => {
    if (!config?.mcpPort) return undefined;
    let active = true;
    let retryTimer = null;
    let es = null;
    function open() {
      es = new EventSource(`http://localhost:${config.mcpPort}/events?token=${encodeURIComponent(config.mcpSessionToken || '')}`);
      es.onerror = () => { es.close(); if (active) retryTimer = setTimeout(open, 3000); };
      es.onmessage = (evt) => {
      let payload;
      try {
        payload = JSON.parse(evt.data);
      } catch {
        return;
      }
      const type = payload?.type;
      const data = payload?.data;
      if (type === 'snapshot') {
        const nodes = Array.isArray(data?.agentNodes) ? data.agentNodes : [];
        const logs = data?.agentActivities && typeof data.agentActivities === 'object' ? data.agentActivities : {};
        const calls = Array.isArray(data?.toolCalls) ? data.toolCalls : [];
        setAgentNodes(nodes);
        setAgentActivities(logs);
        if (!selectedAgentRef.current && nodes[0]?.id) setSelectedAgentId(nodes[0].id);
        setTouchedFilesByAgent(() => {
          const next = {};
          for (const call of calls) {
            if (!call?.agent_id || !call?.file_path) continue;
            if (!next[call.agent_id]) next[call.agent_id] = new Set();
            const normalizedPath = normalizeFilePathForProject(call.file_path, config?.memoryProjectPath || config?.cwd);
            next[call.agent_id].add(normalizedPath);
          }
          return next;
        });
        return;
      }
      if (type === 'tool_call') {
        const agentId = String(data?.agent_id || '');
        const filePathRaw = normalizeFilePathForProject(data?.file_path, config?.memoryProjectPath || config?.cwd);
        if (!agentId || !filePathRaw) return;
        setTouchedFilesByAgent((prev) => {
          const next = { ...prev };
          const set = new Set(next[agentId] || []);
          set.add(filePathRaw);
          next[agentId] = set;
          return next;
        });
        setLastTouchedByFile((prev) => ({ ...prev, [filePathRaw]: agentId }));
        setMemorySnapshot((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            touches: {
              ...(prev.touches || {}),
              [filePathRaw]: Number(data?.timestamp || Date.now()),
            },
          };
        });
        setHotFiles((prev) => {
          const next = new Set(prev);
          next.add(filePathRaw);
          return next;
        });
        setTimeout(() => {
          setHotFiles((prev) => {
            const next = new Set(prev);
            next.delete(filePathRaw);
            return next;
          });
        }, 7000);
        return;
      }
      if (type === 'terminal_summary_chunk') {
        const terminalId = String(data?.terminal_id || '').trim();
        if (!terminalId) return;
        setSummaryModalTerminalId((current) => current || terminalId);
        const chunk = String(data?.chunk || '');
        if (!chunk) return;
        setTerminalSummaries((prev) => {
          const item = prev[terminalId] || {
            terminalId,
            status: 'running',
            text: '',
            outputText: '',
            usage: null,
            error: '',
          };
          return {
            ...prev,
            [terminalId]: {
              ...item,
              status: 'running',
              text: `${item.text || ''}${chunk}`,
            },
          };
        });
        return;
      }
      if (type === 'terminal_summary_done') {
        const terminalId = String(data?.terminal_id || '').trim();
        if (!terminalId) return;
        setSummaryModalTerminalId((current) => current || terminalId);
        setSummaryModalShowOutput(false);
        setTerminalSummaries((prev) => ({
          ...prev,
          [terminalId]: {
            terminalId,
            status: data?.error ? 'error' : 'done',
            text: String(data?.summary || prev[terminalId]?.text || ''),
            outputText: String(prev[terminalId]?.outputText || ''),
            usage: data?.usage || null,
            error: String(data?.error || ''),
          },
        }));
        return;
      }
      if (type === 'agent_node') {
        setAgentNodes((prev) => {
          const idx = prev.findIndex((n) => n.id === data.id);
          if (idx >= 0) {
            const next = [...prev];
            next[idx] = data;
            return next;
          }
          return [...prev, data];
        });
        if (!selectedAgentRef.current) setSelectedAgentId(data.id);
        return;
      }
      if (type === 'agent_activity') {
        setAgentActivities((prev) => {
          const id = String(data?.agent_id || '');
          if (!id) return prev;
          const list = [...(prev[id] || []), data].slice(-300);
          return { ...prev, [id]: list };
        });
      }
      };
    }
    open();
    return () => { active = false; clearTimeout(retryTimer); es?.close(); };
  }, [config?.mcpPort, config?.mcpSessionToken]);

  useAppActions({
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
  });

  const handleConfigSave = useCallback(async (updates) => {
    const nextMemoryProjectPath = updates.memoryProjectPath;
    for (const [key, value] of Object.entries(updates)) {
      await window.electron.config.set(key, value);
    }
    if (typeof nextMemoryProjectPath === 'string') {
      await window.electron.memory.setProjectPath(nextMemoryProjectPath);
      const snapshot = await window.electron.memory.getSnapshot();
      setMemorySnapshot(snapshot);
    }
    const next = await window.electron.config.get();
    setConfig(next);
    setConfigOpen(false);
  }, []);

  const handleLayoutsSave = useCallback(async (updates) => {
    for (const [key, value] of Object.entries(updates)) {
      await window.electron.config.set(key, value);
    }
    const next = await window.electron.config.get();
    setConfig(next);
    setLayoutsOpen(false);
  }, []);

  const handleSpawnAgent = useCallback(async ({ role, model, command, parentId }) => {
    const agentId = `agent-${Date.now().toString(36)}`;
    const spawnCmd = String(command || `${config?.claudeCmd || 'claude'}${config?.mcpConfigPath ? ` --mcp-config "${config.mcpConfigPath}"` : ''}`).trim();
    await callMcpTool('upsert_agent_node', {
      agent_id: agentId,
      parent_id: parentId || null,
      role: String(role || 'Worker'),
      status: 'pending',
      progress: 5,
      model: String(model || ''),
      token_burn: 0,
    });
    await callMcpTool('append_agent_activity', {
      agent_id: agentId,
      message: `Spawn requested: ${spawnCmd}`,
      level: 'info',
    });
    createTabAndRun(spawnCmd);
    setSelectedAgentId(agentId);
    setActiveContext('terminal');
  }, [callMcpTool, config?.claudeCmd, config?.mcpConfigPath, createTabAndRun]);

  const commandCatalog = useMemo(() => [
    { group: 'Panels', label: 'MCP Monitor', shortcut: 'Ctrl+Alt+B', action: () => { setActiveSidebar((v) => (v === 'monitor' ? null : 'monitor')); setActiveContext('monitor'); } },
    { group: 'Panels', label: 'Diffs', action: () => { setActiveSidebar((v) => (v === 'diff-timeline' ? null : 'diff-timeline')); setActiveContext('diff-timeline'); } },
    { group: 'Panels', label: 'Artifacts', action: () => { setActiveSidebar((v) => (v === 'artifacts' ? null : 'artifacts')); setActiveContext('artifacts'); } },
    { group: 'Panels', label: 'Codebase', shortcut: 'Ctrl+Alt+M', action: () => { setCodebaseOpen((v) => !v); setActiveContext('codebase'); } },
    { group: 'Panels', label: 'Dep Graph', shortcut: 'Ctrl+Alt+G', action: () => { setActiveSidebar((v) => (v === 'dep-graph' ? null : 'dep-graph')); setActiveContext('dep-graph'); } },
    { group: 'Panels', label: 'Agent Tree', shortcut: 'Ctrl+Alt+J', action: () => { setActiveSidebar((v) => (v === 'agent-tree' ? null : 'agent-tree')); setActiveContext('agent-tree'); } },
    { group: 'Panels', label: 'Terminals', shortcut: 'Ctrl+Alt+T', action: () => { setActiveSidebar((v) => (v === 'manager' ? null : 'manager')); setActiveContext('manager'); } },
    { group: 'Panels', label: 'Sessions', shortcut: 'Ctrl+Alt+Y', action: () => { setActiveSidebar((v) => (v === 'sessions' ? null : 'sessions')); setActiveContext('sessions'); } },
    { group: 'Panels', label: 'Prompt Drafts', action: () => { setActiveSidebar((v) => (v === 'prompt-drafts' ? null : 'prompt-drafts')); setActiveContext('prompt-drafts'); } },
    { group: 'Panels', label: 'Templates', action: () => { setActiveSidebar((v) => (v === 'prompt-templates' ? null : 'prompt-templates')); setActiveContext('prompt-templates'); } },
    { group: 'Panels', label: 'Agent Memory', action: () => { setActiveSidebar((v) => (v === 'agent-memory' ? null : 'agent-memory')); setActiveContext('agent-memory'); } },
    { group: 'Panels', label: 'File Explorer', action: () => { setActiveSidebar((v) => (v === 'file-explorer' ? null : 'file-explorer')); setActiveContext('file-explorer'); } },
    { group: 'Panels', label: 'Import/Export', action: () => { setActiveSidebar((v) => (v === 'import-export' ? null : 'import-export')); setActiveContext('import-export'); } },
    { group: 'Panels', label: 'Git', action: () => setGitOpen((v) => !v) },
    { group: 'Panels', label: 'Semantic Search', shortcut: 'Ctrl+Shift+F', action: () => { setCodebaseOpen((v) => !v); setActiveContext('codebase'); } },
    { group: 'Actions', label: 'New Tab', shortcut: 'Ctrl+T', action: openNewTabPicker },
    { group: 'Actions', label: 'Launch Claude', shortcut: 'Ctrl+Enter', action: () => { const tab = tabsRef.current.find((t) => t.id === activeTabIdRef.current); if (tab) tabActionRefs.current[tab.id]?.current.launchClaude?.(); } },
    { group: 'Actions', label: 'Launch Codex', shortcut: 'Ctrl+Shift+Enter', action: () => { const tab = tabsRef.current.find((t) => t.id === activeTabIdRef.current); if (tab) tabActionRefs.current[tab.id]?.current.launchCodex?.(); } },
    { group: 'Actions', label: 'Clear Terminal', shortcut: 'Ctrl+Shift+K', action: () => { const tab = tabsRef.current.find((t) => t.id === activeTabIdRef.current); if (tab) tabActionRefs.current[tab.id]?.current.clear?.(); } },
    { group: 'Actions', label: 'Split Vertical', shortcut: 'Ctrl+Shift+D', action: () => { const tab = tabsRef.current.find((t) => t.id === activeTabIdRef.current); if (!tab) return; const targetId = tab.focusedPaneId || collectLeafIds(tab.paneTree)[0]; if (!targetId) return; const newId = allocTermId(); const existingLeaf = findLeaf(tab.paneTree, targetId) || { type: 'leaf', id: targetId }; updateTab(tab.id, (prev) => ({ ...prev, paneTree: replaceNode(prev.paneTree, targetId, { type: 'split', dir: 'v', ratio: 0.5, a: existingLeaf, b: { type: 'leaf', id: newId, cwd: config?.cwd || '', startupCommand: '' } }), focusedPaneId: newId })); } },
    { group: 'Actions', label: 'Split Horizontal', shortcut: 'Ctrl+Shift+E', action: () => { const tab = tabsRef.current.find((t) => t.id === activeTabIdRef.current); if (!tab) return; const targetId = tab.focusedPaneId || collectLeafIds(tab.paneTree)[0]; if (!targetId) return; const newId = allocTermId(); const existingLeaf = findLeaf(tab.paneTree, targetId) || { type: 'leaf', id: targetId }; updateTab(tab.id, (prev) => ({ ...prev, paneTree: replaceNode(prev.paneTree, targetId, { type: 'split', dir: 'h', ratio: 0.5, a: existingLeaf, b: { type: 'leaf', id: newId, cwd: config?.cwd || '', startupCommand: '' } }), focusedPaneId: newId })); } },
    { group: 'Actions', label: 'Close Pane', shortcut: 'Ctrl+W', action: () => { const tab = tabsRef.current.find((t) => t.id === activeTabIdRef.current); if (tab) closePaneInTab(tab.id, tab.focusedPaneId); } },
    { group: 'Actions', label: 'Next Pane', shortcut: 'Ctrl+Shift+N', action: () => { const tab = tabsRef.current.find((t) => t.id === activeTabIdRef.current); if (!tab) return; const ids = collectLeafIds(tab.paneTree); const idx = ids.indexOf(tab.focusedPaneId); focusPane(tab.id, ids[(idx + 1) % ids.length]); } },
    { group: 'Actions', label: 'Previous Pane', shortcut: 'Ctrl+Shift+P', action: () => { const tab = tabsRef.current.find((t) => t.id === activeTabIdRef.current); if (!tab) return; const ids = collectLeafIds(tab.paneTree); const idx = ids.indexOf(tab.focusedPaneId); focusPane(tab.id, ids[(idx - 1 + ids.length) % ids.length]); } },
    { group: 'Actions', label: 'Restart Claude', shortcut: 'Ctrl+Alt+R', action: () => { const tab = tabsRef.current.find((t) => t.id === activeTabIdRef.current); if (tab) tabActionRefs.current[tab.id]?.current.restartClaude?.(); } },
    { group: 'Actions', label: 'Restart Codex', shortcut: 'Ctrl+Alt+Shift+R', action: () => { const tab = tabsRef.current.find((t) => t.id === activeTabIdRef.current); if (tab) tabActionRefs.current[tab.id]?.current.restartCodex?.(); } },
    { group: 'Actions', label: 'Close All Panels', shortcut: 'Ctrl+Shift+W', action: () => { setActiveSidebar(null); setGitOpen(false); setCodeViewerFile(null); setActiveContext('terminal'); } },
    { group: 'Actions', label: 'Open Settings', shortcut: 'Ctrl+,', action: () => setConfigOpen(true) },
    { group: 'Actions', label: 'Open Help', shortcut: 'F1', action: () => setShowHelp(true) },
  ], [allocTermId, closePaneInTab, config?.cwd, focusPane, openNewTabPicker, updateTab]);

  if (!config || tabs.length === 0) return (
    <div style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#8b949e', fontSize: 12, fontFamily: 'monospace' }}>
      Loading...
    </div>
  );

  const showTabsBar = tabs.length > 1;

  return (
    <div className="app">
      <div className="app-main">
        <div className={`icon-rail${railExpanded ? ' expanded' : ''}`}>
          <div className="rail-scroll">
          <button
            id="new-tab-btn"
            className="rail-btn"
            onClick={() => { openNewTabPicker(); setActiveContext('terminal'); }}
            title="New tab"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M12 5v14M5 12h14" />
            </svg>
            <span className="rail-label">New tab</span>
          </button>
          <button
            className={`rail-btn${paletteOpen ? ' active' : ''}`}
            onClick={() => setPaletteOpen(true)}
            title="Command palette (Ctrl+Shift+P)"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="11" cy="11" r="6" />
              <path d="M20 20l-4.2-4.2" />
              <path d="M8 11h6M11 8v6" />
            </svg>
            <span className="rail-label">Palette</span>
          </button>
          <div className="rail-separator" />
          <button
            className={`rail-btn${activeSidebar === 'prompt-drafts' ? ' active' : ''}`}
            onClick={() => {
              setActiveSidebar((v) => (v === 'prompt-drafts' ? null : 'prompt-drafts'));
              setActiveContext('prompt-drafts');
            }}
            title="Prompt drafts"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M4 4h10l6 6v10H4z" />
              <path d="M14 4v6h6M8 16l6-6 2 2-6 6H8zM14 10l2 2" />
            </svg>
            <span className="rail-label">Drafts</span>
          </button>
          <button
            className={`rail-btn${activeSidebar === 'todo' ? ' active' : ''}`}
            onClick={() => {
              setActiveSidebar((v) => (v === 'todo' ? null : 'todo'));
              setActiveContext('todo');
            }}
            title="Todo lists"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <rect x="3" y="5" width="3" height="3" rx="0.5" />
              <rect x="3" y="11" width="3" height="3" rx="0.5" />
              <rect x="3" y="17" width="3" height="3" rx="0.5" />
              <path d="M9 6.5h12M9 12.5h12M9 18.5h7" />
            </svg>
            <span className="rail-label">Todo</span>
          </button>
          <button
            className={`rail-btn${activeSidebar === 'agent-memory' ? ' active' : ''}`}
            onClick={() => {
              setActiveSidebar((v) => (v === 'agent-memory' ? null : 'agent-memory'));
              setActiveContext('agent-memory');
            }}
            title="Agent memory files"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <rect x="4" y="3" width="16" height="18" rx="2" />
              <path d="M8 8h8M8 12h8M8 16h5M14 16h2" />
            </svg>
            <span className="rail-label">Memory</span>
          </button>
          <button
            className={`rail-btn${gitOpen ? ' active' : ''}`}
            onClick={() => setGitOpen((v) => !v)}
            title="Git workflow"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="7" cy="6" r="2" />
              <circle cx="7" cy="18" r="2" />
              <circle cx="17" cy="11" r="2" />
              <path d="M7 8v8M9 6c3 0 6 2 6 5" />
            </svg>
            <span className="rail-label">Git</span>
          </button>
          <button
            className={`rail-btn${activeSidebar === 'prompt-templates' ? ' active' : ''}`}
            onClick={() => {
              setActiveSidebar((v) => (v === 'prompt-templates' ? null : 'prompt-templates'));
              setActiveContext('prompt-templates');
            }}
            title="Prompt templates"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M12 3l8 4-8 4-8-4 8-4z" />
              <path d="M4 12l8 4 8-4M4 17l8 4 8-4" />
            </svg>
            <span className="rail-label">Templates</span>
          </button>
          <button
            className={`rail-btn${activeSidebar === 'context-surgeon' ? ' active' : ''}`}
            onClick={() => {
              setActiveSidebar((v) => (v === 'context-surgeon' ? null : 'context-surgeon'));
              setActiveContext('context-surgeon');
            }}
            title="Context Surgeon — inspect active session context window"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M3 6h18M3 12h12M3 18h8" />
              <circle cx="19" cy="17" r="3" />
              <path d="M21.5 19.5l1.5 1.5" />
            </svg>
            <span className="rail-label">Context</span>
          </button>
          <div className="rail-separator" />
          <button
            className={`rail-btn${activeSidebar === 'file-explorer' ? ' active' : ''}`}
            onClick={() => {
              setActiveSidebar((v) => (v === 'file-explorer' ? null : 'file-explorer'));
              setActiveContext('file-explorer');
            }}
            title="File explorer"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M3 5h18v2H3zM3 11h18v2H3zM3 17h18v2H3z" />
            </svg>
            <span className="rail-label">Files</span>
          </button>
          <button
            className={`rail-btn${codebaseOpen ? ' active' : ''}`}
            onClick={() => { setCodebaseOpen((v) => !v); setActiveContext('codebase'); }}
            title="Codebase / Semantic search"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2z" />
              <path d="M9 4v14M15 6v14" />
            </svg>
            <span className="rail-label">Codebase</span>
          </button>
          <button
            className={`rail-btn${activeSidebar === 'smart-stderr' ? ' active' : ''}`}
            onClick={() => {
              setActiveSidebar((v) => (v === 'smart-stderr' ? null : 'smart-stderr'));
              setActiveContext('smart-stderr');
            }}
            title="Smart stderr feed"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M12 3l9 16H3l9-16z" />
              <path d="M12 9v5M12 17h.01" />
            </svg>
            <span className="rail-label">Stderr</span>
          </button>
          <div className="rail-separator" />
          <button
            className={`rail-btn${activeSidebar === 'monitor' ? ' active' : ''}`}
            onClick={() => {
              setActiveSidebar((v) => (v === 'monitor' ? null : 'monitor'));
              setActiveContext('monitor');
            }}
            title="Toggle MCP monitor"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <rect x="3" y="5" width="18" height="14" rx="2" />
              <path d="M5 14h3l2-5 3 9 2-6h4" />
            </svg>
            <span className="rail-label">MCP</span>
          </button>
          <button
            className={`rail-btn${activeSidebar === 'mcp-call-log' ? ' active' : ''}`}
            onClick={() => {
              setActiveSidebar((v) => (v === 'mcp-call-log' ? null : 'mcp-call-log'));
              setActiveContext('mcp-call-log');
            }}
            title="MCP call log"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M4 6h16M4 10h16M4 14h10M4 18h7" />
              <circle cx="19" cy="17" r="3" />
              <path d="M17.5 17h1.5v1.5" />
            </svg>
            <span className="rail-label">Call log</span>
          </button>
          <button
            className={`rail-btn${activeSidebar === 'diff-timeline' ? ' active' : ''}`}
            onClick={() => {
              setActiveSidebar((v) => (v === 'diff-timeline' ? null : 'diff-timeline'));
              setActiveContext('diff-timeline');
            }}
            title="Toggle diff timeline"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="6" cy="6" r="2" />
              <circle cx="18" cy="6" r="2" />
              <circle cx="6" cy="18" r="2" />
              <path d="M8 6h8M6 8v8M8 18h10" />
            </svg>
            <span className="rail-label">Diffs</span>
          </button>
          <button
            className={`rail-btn${activeSidebar === 'artifacts' ? ' active' : ''}`}
            onClick={() => {
              setActiveSidebar((v) => (v === 'artifacts' ? null : 'artifacts'));
              setActiveContext('artifacts');
            }}
            title="Toggle artifacts panel"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M4 8l8-4 8 4-8 4-8-4z" />
              <path d="M4 8v8l8 4 8-4V8M12 12v8" />
            </svg>
            <span className="rail-label">Artifacts</span>
          </button>
          <button
            className={`rail-btn${activeSidebar === 'dep-graph' ? ' active' : ''}`}
            onClick={() => {
              setActiveSidebar((v) => (v === 'dep-graph' ? null : 'dep-graph'));
              setActiveContext('dep-graph');
            }}
            title="Toggle live dependency graph"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="12" cy="6" r="2" />
              <circle cx="6" cy="12" r="2" />
              <circle cx="18" cy="12" r="2" />
              <circle cx="12" cy="18" r="2" />
              <path d="M12 8v8M8 12h8" />
            </svg>
            <span className="rail-label">Dep. graph</span>
          </button>
          <button
            className={`rail-btn${activeSidebar === 'agent-tree' ? ' active' : ''}`}
            onClick={() => {
              setActiveSidebar((v) => (v === 'agent-tree' ? null : 'agent-tree'));
              setActiveContext('agent-tree');
            }}
            title="Toggle sub-agent tree"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <rect x="10" y="3" width="4" height="4" rx="1" />
              <rect x="3" y="17" width="4" height="4" rx="1" />
              <rect x="10" y="17" width="4" height="4" rx="1" />
              <rect x="17" y="17" width="4" height="4" rx="1" />
              <path d="M12 7v4M5 17v-2h14v2M12 11v4" />
            </svg>
            <span className="rail-label">Agents</span>
          </button>
          <div className="rail-separator" />
          <button
            className={`rail-btn${activeSidebar === 'manager' ? ' active' : ''}`}
            onClick={() => {
              setActiveSidebar((v) => (v === 'manager' ? null : 'manager'));
              setActiveContext('manager');
            }}
            title="Toggle terminal manager"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <rect x="3" y="5" width="18" height="14" rx="2" />
              <path d="M8 9l2 2-2 2M12 13h5" />
            </svg>
            <span className="rail-label">Terminals</span>
          </button>
          <button
            className={`rail-btn${activeSidebar === 'sessions' ? ' active' : ''}`}
            onClick={() => {
              setActiveSidebar((v) => (v === 'sessions' ? null : 'sessions'));
              setActiveContext('sessions');
            }}
            title="Toggle session manager"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="12" cy="12" r="8" />
              <path d="M12 8v5l3 2M8 3h8" />
            </svg>
            <span className="rail-label">Sessions</span>
          </button>
          <div className="rail-separator" />
          <button
            className={`rail-btn${activeSidebar === 'import-export' ? ' active' : ''}`}
            onClick={() => {
              setActiveSidebar((v) => (v === 'import-export' ? null : 'import-export'));
              setActiveContext('import-export');
            }}
            title="Import/export backup"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M12 4v10M8 8l4-4 4 4M12 20V10M8 16l4 4 4-4" />
            </svg>
            <span className="rail-label">Backup</span>
          </button>
          <button
            className={`rail-btn${configOpen ? ' active' : ''}`}
            onClick={() => setConfigOpen(true)}
            title="Settings"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M12 8a4 4 0 100 8 4 4 0 000-8z" />
              <path d="M4 12h2M18 12h2M12 4v2M12 18v2M6.4 6.4l1.4 1.4M16.2 16.2l1.4 1.4M17.6 6.4l-1.4 1.4M7.8 16.2l-1.4 1.4" />
            </svg>
            <span className="rail-label">Settings</span>
          </button>
          <button
            className={`rail-btn${showHelp ? ' active' : ''}`}
            onClick={() => setShowHelp(true)}
            title="Help"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="12" cy="12" r="9" />
              <path d="M9.5 9a2.5 2.5 0 015 0c0 2-2.5 2.1-2.5 4" />
              <path d="M12 17h.01" />
            </svg>
            <span className="rail-label">Help</span>
          </button>
          </div>
          <div className="rail-foot">
            <div className="rail-separator" />
            <button
              className="rail-btn"
              onClick={() => setRailExpanded((v) => !v)}
              title={railExpanded ? 'Collapse menu' : 'Expand menu'}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                {railExpanded
                  ? <path d="M11 6l-6 6 6 6M18 6l-6 6 6 6" />
                  : <path d="M13 6l6 6-6 6M6 6l6 6-6 6" />}
              </svg>
              <span className="rail-label">Collapse</span>
            </button>
          </div>
        </div>

        <div className="workspace-shell">
          {showTabsBar && (
            <div className="tabs-bar">
              {tabs.map((tab) => (
                <div key={tab.id} className={`tab-chip${tab.id === activeTabId ? ' active' : ''}`}>
                  <button className="tab-main" onClick={() => setActiveTabId(tab.id)}>{tab.title}</button>
                  {tabs.length > 1 && (
                    <button className="tab-close" onClick={() => closeTab(tab.id)} title="Close tab">x</button>
                  )}
                </div>
              ))}
              <button className="tab-add" onClick={openNewTabPicker} title="New tab">+</button>
            </div>
          )}

          <div className="workspace-body">
            {activeSidebar && (
              <div className="sidepane-slot">
                {activeSidebar === 'monitor' && (
                  <ErrorBoundary>
                  <MCPMonitor
                    visible
                    port={config.mcpPort}
                    token={config.mcpSessionToken || ''}
                    onHide={() => setActiveSidebar((v) => (v === 'monitor' ? null : v))}
                    onFocus={() => setActiveContext('monitor')}
                  />
                  </ErrorBoundary>
                )}
                {activeSidebar === 'mcp-call-log' && (
                  <MCPCallLogPanel
                    visible
                    port={config.mcpPort}
                    token={config.mcpSessionToken || ''}
                    onHide={() => setActiveSidebar((v) => (v === 'mcp-call-log' ? null : v))}
                    onFocus={() => setActiveContext('mcp-call-log')}
                  />
                )}
                {activeSidebar === 'diff-timeline' && (
                  <DiffTimelinePanel
                    visible
                    port={config.mcpPort}
                    token={config.mcpSessionToken || ''}
                    onHide={() => setActiveSidebar((v) => (v === 'diff-timeline' ? null : v))}
                    onFocus={() => setActiveContext('diff-timeline')}
                  />
                )}
                {activeSidebar === 'artifacts' && (
                  <ArtifactsPanel
                    visible
                    port={config.mcpPort}
                    token={config.mcpSessionToken || ''}
                    onHide={() => setActiveSidebar((v) => (v === 'artifacts' ? null : v))}
                    onFocus={() => setActiveContext('artifacts')}
                  />
                )}
                {activeSidebar === 'smart-stderr' && (
                  <SmartStderrPanel
                    visible
                    entriesByTerminal={smartStderrEntries}
                    onHide={() => setActiveSidebar((v) => (v === 'smart-stderr' ? null : v))}
                    onFocus={() => setActiveContext('smart-stderr')}
                    onDraftPrompt={(entry) => createSmartStderrDraft(entry).catch(() => {})}
                    onSummarizeOutput={requestTerminalSummary}
                    terminalSummaries={terminalSummaries}
                  />
                )}
                {activeSidebar === 'manager' && (
                  <TerminalManager
                    visible
                    tabs={tabs}
                    activeTabId={activeTabId}
                    onFocus={() => setActiveContext('manager')}
                    onHide={() => setActiveSidebar((v) => (v === 'manager' ? null : v))}
                    onFocusTerminal={focusPane}
                    onRestartTerminal={restartPaneInTab}
                    onCloseTerminal={closePaneInTab}
                  />
                )}
                {activeSidebar === 'sessions' && (
                  <SessionManager
                    visible
                    sessions={sessionRefs}
                    onFocus={() => setActiveContext('sessions')}
                    onHide={() => setActiveSidebar((v) => (v === 'sessions' ? null : v))}
                    onOpen={(session) => openSessionInFocusedPane(session).catch(() => {})}
                    onPinToggle={(session) => window.electron.sessions.pin(session.id, !session.pinned).then(setSessionRefs).catch(() => {})}
                    onRemove={(session) => window.electron.sessions.remove(session.id).then(setSessionRefs).catch(() => {})}
                    onRename={(id, label) => window.electron.sessions.rename(id, label).then(setSessionRefs).catch(() => {})}
                    onToggleMcp={(session) => window.electron.sessions.toggleMcp(session.id).then(setSessionRefs).catch(() => {})}
                    onAdd={({ label, tool, sessionId, cwd }) => {
                      const cmd = tool === 'codex' ? (config?.codexCmd || 'codex') : (config?.claudeCmd || 'claude');
                      window.electron.sessions.upsert({
                        label,
                        tool,
                        command: cmd,
                        cwd: cwd || '',
                        claudeSessionId: sessionId,
                      }).then((result) => {
                        if (result?.error) {
                          alert(`Failed to add session: ${result.error}`);
                        } else {
                          setSessionRefs(result);
                        }
                      }).catch(() => {});
                    }}
                  />
                )}
                {activeSidebar === 'import-export' && (
                  <ImportExportPanel
                    visible
                    busy={backupBusy}
                    status={backupStatus}
                    onFocus={() => setActiveContext('import-export')}
                    onHide={() => setActiveSidebar((v) => (v === 'import-export' ? null : v))}
                    onExport={() => handleExportBackup().catch(() => {})}
                    onImport={() => handleImportBackup().catch(() => {})}
                  />
                )}
                {activeSidebar === 'dep-graph' && (
                  <LiveDependencyGraph
                    visible
                    selectedAgentId={selectedAgentId}
                    agents={agentNodes}
                    touchedFilesByAgent={touchedFilesByAgent}
                    memoryEdges={memorySnapshot?.edges || []}
                    hotFiles={hotFiles}
                    onSelectAgent={setSelectedAgentId}
                    onSelectFile={setSelectedFilePath}
                    onHide={() => setActiveSidebar((v) => (v === 'dep-graph' ? null : v))}
                    onFocus={() => setActiveContext('dep-graph')}
                  />
                )}
                {activeSidebar === 'agent-tree' && (
                  <AgentTreePanel
                    visible
                    nodes={agentNodes}
                    activities={agentActivities}
                    selectedAgentId={selectedAgentId}
                    onSelectAgent={setSelectedAgentId}
                    onSpawn={(req) => handleSpawnAgent(req).catch(() => {})}
                    onHide={() => setActiveSidebar((v) => (v === 'agent-tree' ? null : v))}
                    onFocus={() => setActiveContext('agent-tree')}
                  />
                )}
                {activeSidebar === 'context-surgeon' && (
                  <ContextSurgeonPanel
                    onHide={() => setActiveSidebar((v) => (v === 'context-surgeon' ? null : v))}
                    onFocus={() => setActiveContext('context-surgeon')}
                  />
                )}
                {activeSidebar === 'prompt-templates' && (
                  <PromptTemplatesPanel
                    onHide={() => setActiveSidebar((v) => (v === 'prompt-templates' ? null : v))}
                    onFocus={() => setActiveContext('prompt-templates')}
                    onSend={sendPromptToTerminal}
                  />
                )}
                {activeSidebar === 'todo' && (
                  <TodoPanel
                    config={config}
                    onHide={() => setActiveSidebar((v) => (v === 'todo' ? null : v))}
                    onFocus={() => setActiveContext('todo')}
                  />
                )}
                {activeSidebar === 'prompt-drafts' && (
                  <PromptDraftsPanel
                    onHide={() => setActiveSidebar((v) => (v === 'prompt-drafts' ? null : v))}
                    onFocus={() => setActiveContext('prompt-drafts')}
                    drafts={promptDrafts}
                    onDelete={(id) => handleDeleteDraft(id).catch(() => {})}
                    onRename={handleRenameDraft}
                    onOpen={openEditorWithContent}
                  />
                )}
                {activeSidebar === 'file-explorer' && (() => {
                  const eTab = tabs.find((t) => t.id === activeTabId);
                  const eTree = eTab?.paneTree;
                  const ePid = eTab?.focusedPaneId || (eTree ? collectLeafIds(eTree)[0] : '');
                  const explorerCwd = (eTree && ePid) ? (findLeaf(eTree, ePid)?.cwd || config.cwd) : config.cwd;
                  return (
                    <FileExplorerPanel
                      cwd={explorerCwd}
                      onHide={() => setActiveSidebar((v) => (v === 'file-explorer' ? null : v))}
                      onFocus={() => setActiveContext('file-explorer')}
                      onOpenFile={(file) => setCodeViewerFile(file)}
                    />
                  );
                })()}
                {activeSidebar === 'agent-memory' && (() => {
                  const aTab = tabs.find((t) => t.id === activeTabId);
                  const tree = aTab?.paneTree;
                  const pid = aTab?.focusedPaneId || (tree ? collectLeafIds(tree)[0] : '');
                  const activeCwd = (tree && pid) ? (findLeaf(tree, pid)?.cwd || config.cwd) : config.cwd;
                  return (
                    <AgentMemoryPanel
                      cwd={activeCwd}
                      onHide={() => setActiveSidebar((v) => (v === 'agent-memory' ? null : v))}
                      onFocus={() => setActiveContext('agent-memory')}
                    />
                  );
                })()}
              </div>
            )}

            <div className="tabs-stack">
              {tabs.map((tab) => (
                <div key={tab.id} className={`tab-workspace${tab.id === activeTabId ? ' active' : ''}`}>
                  <ErrorBoundary>
                  <TerminalGrid
                    paneTree={tab.paneTree}
                    focusedPaneId={tab.focusedPaneId}
                    voiceState={tab.id === activeTabId ? voiceState : null}
                    onFocus={(id) => focusPane(tab.id, id)}
                    onResizeTree={(updater) => {
                      updateTab(tab.id, (prevTab) => ({ ...prevTab, paneTree: updater(prevTab.paneTree) }));
                    }}
                    onPaneCwd={(paneId, cwd) => {
                      updateTab(tab.id, (prevTab) => {
                        const nextTree = updateLeafCwd(prevTab.paneTree, paneId, cwd);
                        if (nextTree === prevTab.paneTree) return prevTab;
                        return { ...prevTab, paneTree: nextTree };
                      });
                    }}
                    config={config}
                    terminalSummaries={terminalSummaries}
                    onSummarizeOutput={requestTerminalSummary}
                    onClearSummary={clearTerminalSummary}
                    actionsRef={getTabActionsRef(tab.id)}
                  />
                  </ErrorBoundary>
                </div>
              ))}
              {codeViewerFile && (
                <CodeViewerOverlay
                  file={codeViewerFile}
                  onClose={() => setCodeViewerFile(null)}
                />
              )}
            </div>
          </div>
          {gitOpen && (() => {
            const gTab = tabs.find((t) => t.id === activeTabId);
            const gTree = gTab?.paneTree;
            const gPid = gTab?.focusedPaneId || (gTree ? collectLeafIds(gTree)[0] : '');
            const gitCwd = (gTree && gPid) ? (findLeaf(gTree, gPid)?.cwd || config.cwd) : config.cwd;
            return (
              <GitWorkflowPanel
                cwd={gitCwd}
                onHide={() => setGitOpen(false)}
                onFocus={() => setActiveContext('git')}
              />
            );
          })()}
          {codebaseOpen && (
            <CodebasePanel
              snapshot={memorySnapshot}
              hotFiles={hotFiles}
              lastTouchedBy={lastTouchedByFile}
              selectedFilePath={selectedFilePath}
              onSelectFile={setSelectedFilePath}
              onRefresh={(projectPath) => {
                const run = async () => {
                  if (!projectPath || !String(projectPath).trim()) return;
                  await window.electron.memory.setProjectPath(String(projectPath).trim());
                  const s = await window.electron.memory.rescan();
                  if (s) setMemorySnapshot(s);
                };
                run().catch(() => {});
              }}
              onHide={() => setCodebaseOpen(false)}
              onOpenResult={(result) => openSearchResultInEditor(result).catch(() => {})}
            />
          )}
        </div>
      </div>

      <Footer context={activeContext} port={config.mcpPort} recentKeys={recentHintKeys} />
      {configOpen && (
        <ConfigPage
          config={config}
          onSave={handleConfigSave}
          onClose={() => setConfigOpen(false)}
          onManageLayouts={() => setLayoutsOpen(true)}
        />
      )}
      <LayoutsModal
        visible={layoutsOpen}
        config={config}
        onSave={(updates) => handleLayoutsSave(updates).catch(() => {})}
        onClose={() => setLayoutsOpen(false)}
      />
      <NewTabLayoutPicker
        visible={layoutPickerOpen}
        layouts={config.layouts}
        defaultLayoutId={config.defaultLayoutId}
        lastUsedLayoutId={config.lastUsedLayoutId}
        position={layoutPickerPosition}
        onClose={closeLayoutPicker}
        onSelect={(layoutId) => handleCreateTabFromPicker(layoutId).catch(() => {})}
      />
      {showHelp && <HelpModal onClose={() => setShowHelp(false)} />}
      <InlineEditorModal
        visible={editorOpen}
        paneId={editorTarget?.paneId}
        value={editorText}
        onChange={handleEditorChange}
        onSend={sendInlineEditor}
        onClose={closeInlineEditor}
        onClear={clearInlineEditor}
        onSaveDraft={(payload) => handleSaveDraft(payload).catch(() => {})}
        onSaveDraftAs={(payload) => handleSaveDraftAs(payload).catch(() => {})}
        availableProjects={Array.from(new Set(promptDrafts.map((d) => String(d.project || '').trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b))}
        activeDraft={editorDraftMeta}
        voiceState={voiceState}
      />
      {fileEditorOpen && (
        <div className="config-overlay" onClick={() => setFileEditorOpen(false)}>
          <div className="config-panel am-editor-modal" onClick={(e) => e.stopPropagation()}>
            <div className="config-header">
              <span className="config-title">{fileEditorPath}</span>
              {fileEditorDirty && <span className="am-dirty-dot" title="Unsaved changes" />}
              <button className="config-close" onClick={() => setFileEditorOpen(false)}>x</button>
            </div>
            <div className="config-body am-editor-body">
              <textarea
                className="am-editor"
                value={fileEditorContent}
                onChange={(e) => {
                  setFileEditorContent(e.target.value);
                  setFileEditorDirty(true);
                }}
                spellCheck={false}
                autoFocus
              />
            </div>
            <div className="config-footer">
              <button className="btn" onClick={() => setFileEditorOpen(false)}>Close</button>
              <button className="btn-primary" onClick={() => saveOpenFileEditor().catch(() => {})} disabled={!fileEditorDirty}>Save</button>
            </div>
          </div>
        </div>
      )}
      {summaryModalTerminalId && (() => {
        const summary = terminalSummaries[summaryModalTerminalId];
        if (!summary) return null;
        const cost = formatSummaryUsage(summary.usage);
        const isError = summary.status === 'error';
        return (
          <div className="config-overlay" onClick={() => setSummaryModalTerminalId('')}>
            <div className="config-panel terminal-summary-modal" onClick={(e) => e.stopPropagation()}>
              <div className="config-header">
                <span className="config-title">Terminal Summary ({summaryModalTerminalId})</span>
                {cost && <span className="terminal-summary-cost">{cost}</span>}
                <button className="config-close" onClick={() => setSummaryModalTerminalId('')}>x</button>
              </div>
              <div className="config-body terminal-summary-modal-body">
                {isError ? (
                  <div className="terminal-summary-error">{summary.error || 'Summary failed'}</div>
                ) : (
                  <pre className="terminal-summary-text">{summary.text || (summary.status === 'running' ? 'Summarising...' : '')}</pre>
                )}
                <button className="btn" onClick={() => setSummaryModalShowOutput((v) => !v)}>
                  {summaryModalShowOutput ? 'Hide full output' : 'Show full output'}
                </button>
                {summaryModalShowOutput && <pre className="terminal-summary-output">{summary.outputText || ''}</pre>}
              </div>
              <div className="config-footer">
                <button
                  className="btn"
                  onClick={() => clearTerminalSummary(summaryModalTerminalId)}
                >
                  Clear
                </button>
                <button className="btn-primary" onClick={() => setSummaryModalTerminalId('')}>Close</button>
              </div>
            </div>
          </div>
        );
      })()}
      {toast && <div className="toast">{toast}</div>}
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} commands={commandCatalog} />
    </div>
  );
}
