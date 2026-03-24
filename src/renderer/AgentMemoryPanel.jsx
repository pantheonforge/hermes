import React, { useState, useCallback, useEffect, useRef } from 'react';

const AGENT_FILES = ['CLAUDE.md', 'AGENTS.md', 'GEMINI.md'];

function deriveContent(claudeContent, target) {
  return claudeContent.replace(/claude/gi, (m) => {
    if (m === m.toUpperCase()) return target.toUpperCase();
    if (m[0] === m[0].toUpperCase()) return target[0].toUpperCase() + target.slice(1);
    return target;
  });
}

export default function AgentMemoryPanel({ cwd, onHide, onFocus }) {
  const [projectFiles, setProjectFiles] = useState([]);
  const [userFiles, setUserFiles] = useState([]);
  const [editorFile, setEditorFile] = useState(null);
  const [editorContent, setEditorContent] = useState('');
  const [saveStatus, setSaveStatus] = useState('saved');
  const [view, setView] = useState('files');
  const [localCwd, setLocalCwd] = useState(cwd);
  const [cwdOverridden, setCwdOverridden] = useState(false);
  const [cwdInput, setCwdInput] = useState(cwd);

  const cwdRef = useRef(localCwd);
  const editorFileRef = useRef(editorFile);
  const unifiedModeRef = useRef(false);
  const projectFilesRef = useRef(projectFiles);
  cwdRef.current = localCwd;
  editorFileRef.current = editorFile;
  projectFilesRef.current = projectFiles;

  const scan = useCallback(async (dir) => {
    try {
      const result = await window.electron.agentMemory.scan(dir || '');
      setProjectFiles(result.projectFiles || []);
      setUserFiles(result.userFiles || []);
    } catch {}
  }, []);

  useEffect(() => {
    if (!cwdOverridden) {
      setLocalCwd(cwd);
      setCwdInput(cwd);
    }
  }, [cwd, cwdOverridden]);

  useEffect(() => { scan(localCwd); }, [localCwd, scan]);

  useEffect(() => {
    const unsub = window.electron.agentMemory?.onChange?.((changedCwd) => {
      if (changedCwd === cwdRef.current) scan(changedCwd);
    });
    return unsub;
  }, [scan]);

  const openFile = useCallback((file) => {
    setEditorFile(file);
    setEditorContent(file.content || '');
    setSaveStatus('saved');
  }, []);

  const createAndOpen = useCallback(async (file) => {
    await window.electron.agentMemory.save(file.fullPath, '').catch(() => {});
    setEditorFile({ ...file, content: '' });
    setEditorContent('');
    setSaveStatus('saved');
    scan(cwdRef.current);
  }, [scan]);

  const closeEditor = useCallback(() => {
    unifiedModeRef.current = false;
    setEditorFile(null);
  }, []);

  const handleSave = useCallback(async () => {
    const file = editorFileRef.current;
    if (!file) return;
    setSaveStatus('saving');
    try {
      await window.electron.agentMemory.save(file.fullPath, editorContent);
      if (unifiedModeRef.current) {
        const files = projectFilesRef.current;
        const gemini = files.find((f) => f.name === 'GEMINI.md');
        const agents = files.find((f) => f.name === 'AGENTS.md');
        if (gemini) await window.electron.agentMemory.save(gemini.fullPath, deriveContent(editorContent, 'gemini')).catch(() => {});
        if (agents) await window.electron.agentMemory.save(agents.fullPath, deriveContent(editorContent, 'codex')).catch(() => {});
      }
      setSaveStatus('saved');
      scan(cwdRef.current);
    } catch {
      setSaveStatus('unsaved');
    }
  }, [editorContent, scan]);

  const openUnifiedEditor = useCallback(() => {
    const claudeFile = projectFilesRef.current.find((f) => f.name === 'CLAUDE.md');
    if (!claudeFile) return;
    unifiedModeRef.current = true;
    if (claudeFile.exists) openFile(claudeFile);
    else createAndOpen(claudeFile);
  }, [openFile, createAndOpen]);

  const commitCwdInput = useCallback((val) => {
    const trimmed = val.trim();
    if (!trimmed) return;
    setCwdOverridden(trimmed !== cwd);
    setLocalCwd(trimmed);
    setCwdInput(trimmed);
  }, [cwd]);

  const resetCwd = useCallback(() => {
    setCwdOverridden(false);
    setLocalCwd(cwd);
    setCwdInput(cwd);
  }, [cwd]);

  const agentFiles = projectFiles.filter((f) => !f.isWorkflow);
  const workflowFiles = projectFiles.filter((f) => f.isWorkflow);
  const hasClaudeMd = agentFiles.some((f) => f.name === 'CLAUDE.md' && f.exists);
  const hasAgentsMd = agentFiles.some((f) => f.name === 'AGENTS.md' && f.exists);
  const isDirty = saveStatus === 'unsaved';

  return (
    <div className="am-panel" onClick={onFocus}>
      <div className="am-header">
        <button className="monitor-hide-btn" onClick={onHide} title="Hide panel">‹</button>
        <span className="title">Agent Memory</span>
        <div className="am-tabs">
          <button
            className={`am-tab${view === 'files' ? ' active' : ''}`}
            onClick={() => setView('files')}
          >Files</button>
          <button
            className={`am-tab${view === 'unified' ? ' active' : ''}`}
            onClick={() => setView('unified')}
          >Unified</button>
        </div>
      </div>

      {view === 'files' && (
        <div className="am-body">
          <div className="am-section-label">Project</div>
          <div className="am-cwd-row">
            <input
              className={`am-cwd-input${cwdOverridden ? ' am-cwd-input--overridden' : ''}`}
              value={cwdInput}
              title={localCwd}
              onChange={(e) => setCwdInput(e.target.value)}
              onBlur={(e) => commitCwdInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.target.blur(); commitCwdInput(e.target.value); } else if (e.key === 'Escape') { setCwdInput(localCwd); e.target.blur(); } }}
              placeholder="No directory"
              spellCheck={false}
            />
            {cwdOverridden && (
              <button className="am-cwd-reset" onClick={resetCwd} title="Reset to active terminal directory">↺</button>
            )}
          </div>
          {hasClaudeMd && hasAgentsMd && (
            <div className="am-note">AGENTS.md takes precedence over CLAUDE.md</div>
          )}
          <div className="am-file-list">
            {agentFiles.map((file) => (
              <button
                key={file.name}
                className={`am-file-btn${file.exists ? ' am-file-exists' : ' am-file-missing'}`}
                onClick={() => file.exists ? openFile(file) : createAndOpen(file)}
              >
                <span className={`am-file-icon${file.exists ? ' am-file-icon--exists' : ' am-file-icon--missing'}`}>
                  {file.exists ? '✓' : '+'}
                </span>
                <span className="am-file-name">{file.name}</span>
              </button>
            ))}
          </div>

          {workflowFiles.length > 0 && (
            <>
              <div className="am-section-label am-section-label--workflow">Workflow</div>
              <div className="am-file-list">
                {workflowFiles.map((file) => (
                  <button
                    key={file.fullPath}
                    className="am-file-btn am-file-exists"
                    onClick={() => openFile(file)}
                  >
                    <span className="am-file-icon am-file-icon--exists">✓</span>
                    <span className="am-file-name">{file.name}</span>
                    <span className="am-file-location">{file.relPath}</span>
                  </button>
                ))}
              </div>
            </>
          )}

          <div className="am-section-label am-section-label--user">User</div>
          <div className="am-file-list">
            {userFiles.map((file) => (
              <button
                key={file.location}
                className={`am-file-btn am-file-btn--user${file.exists ? ' am-file-exists' : ' am-file-missing'}`}
                onClick={() => file.exists ? openFile({ ...file, isUser: true }) : createAndOpen({ ...file, isUser: true })}
              >
                <span className={`am-file-icon${file.exists ? ' am-file-icon--exists' : ' am-file-icon--missing'}`}>
                  {file.exists ? '✓' : '+'}
                </span>
                <span className="am-file-name">{file.name}</span>
                <span className="am-file-location">~/{file.location}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {view === 'unified' && (
        <div className="am-body">
          <div className="am-section-label">Project</div>
          <div className="am-cwd-row">
            <input
              className={`am-cwd-input${cwdOverridden ? ' am-cwd-input--overridden' : ''}`}
              value={cwdInput}
              title={localCwd}
              onChange={(e) => setCwdInput(e.target.value)}
              onBlur={(e) => commitCwdInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.target.blur(); commitCwdInput(e.target.value); } else if (e.key === 'Escape') { setCwdInput(localCwd); e.target.blur(); } }}
              placeholder="No directory"
              spellCheck={false}
            />
            {cwdOverridden && (
              <button className="am-cwd-reset" onClick={resetCwd} title="Reset to active terminal directory">↺</button>
            )}
          </div>
          <div className="am-note">
            Edit CLAUDE.md as the source of truth. GEMINI.md and AGENTS.md are auto-derived on save
            ("claude"→"gemini" / "claude"→"codex").
          </div>
          <div className="am-file-list">
            {agentFiles.map((file) => {
              const isPrimary = file.name === 'CLAUDE.md';
              const isDerived = file.name === 'GEMINI.md' || file.name === 'AGENTS.md';
              const sub = file.name === 'GEMINI.md' ? '"claude"→"gemini"' : file.name === 'AGENTS.md' ? '"claude"→"codex"' : null;
              return (
                <div
                  key={file.name}
                  className={`am-file-btn${file.exists ? ' am-file-exists' : ' am-file-missing'}${isDerived ? ' am-file-btn--derived' : ''}`}
                  style={{ cursor: isPrimary ? 'pointer' : 'default' }}
                  onClick={() => isPrimary && openUnifiedEditor()}
                >
                  <span className={`am-file-icon${file.exists ? ' am-file-icon--exists' : ' am-file-icon--missing'}`}>
                    {isPrimary ? '✎' : isDerived ? '→' : '✓'}
                  </span>
                  <span className="am-file-name">{file.name}</span>
                  {sub && <span className="am-file-location">{sub}</span>}
                </div>
              );
            })}
          </div>
          <div className="am-unified-footer">
            <button className="btn-primary" onClick={openUnifiedEditor}>
              {hasClaudeMd ? 'Edit CLAUDE.md' : 'Create CLAUDE.md'}
            </button>
          </div>
        </div>
      )}

      {editorFile && (
        <div className="config-overlay" onClick={closeEditor}>
          <div className="config-panel am-editor-modal" onClick={(e) => e.stopPropagation()}>
            <div className="config-header">
              <span className="config-title">
                {unifiedModeRef.current ? 'Unified Memory' : editorFile.name}
              </span>
              {unifiedModeRef.current ? (
                <span className="am-user-badge">CLAUDE.md → GEMINI.md, AGENTS.md</span>
              ) : editorFile.isUser ? (
                <span className="am-user-badge">~/{editorFile.location}</span>
              ) : null}
              {isDirty && <span className="am-dirty-dot" title="Unsaved changes" />}
              <button className="config-close" onClick={closeEditor}>x</button>
            </div>
            <div className="config-body am-editor-body">
              <textarea
                className="am-editor"
                value={editorContent}
                onChange={(e) => { setEditorContent(e.target.value); setSaveStatus('unsaved'); }}
                spellCheck={false}
                autoFocus
              />
            </div>
            <div className="config-footer">
              <button className="btn" onClick={closeEditor}>Cancel</button>
              <button
                className="btn-primary"
                onClick={handleSave}
                disabled={!isDirty || saveStatus === 'saving'}
              >
                {saveStatus === 'saving' ? 'Saving…' : unifiedModeRef.current ? 'Save all' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
