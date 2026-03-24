import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';

const STATUS_LABELS = { M: 'modified', A: 'added', D: 'deleted', R: 'renamed', C: 'copied', '??': 'untracked' };
const STATUS_CLASSES = { M: 'modified', A: 'added', D: 'deleted', R: 'renamed', C: 'copied', '??': 'untracked' };

function statusLabel(s) { return STATUS_LABELS[s] || s; }
function statusClass(s) { return STATUS_CLASSES[s] || 'other'; }

function parseCommitDiffByFile(diffText) {
  if (!diffText) return [];
  const sections = [];
  let current = null;
  for (const line of diffText.split('\n')) {
    if (line.startsWith('diff --git ')) {
      if (current) sections.push({ ...current, diff: current.lines.join('\n') });
      const match = line.match(/^diff --git a\/.+ b\/(.+)$/);
      current = { file: match ? match[1] : line.slice(11), lines: [line] };
    } else if (current) {
      current.lines.push(line);
    }
  }
  if (current) sections.push({ ...current, diff: current.lines.join('\n') });
  return sections;
}

function DiffView({ diff }) {
  if (!diff) return <div className="git-diff-empty">No diff available</div>;
  return (
    <pre className="git-diff-body">
      {diff.split('\n').map((line, i) => {
        let cls = '';
        if (line.startsWith('+') && !line.startsWith('+++')) cls = ' add';
        else if (line.startsWith('-') && !line.startsWith('---')) cls = ' del';
        else if (line.startsWith('@@')) cls = ' hunk';
        return <div key={i} className={`git-diff-line${cls}`}>{line}</div>;
      })}
    </pre>
  );
}

export default function GitWorkflowPanel({ cwd, onHide, onFocus }) {
  const [view, setView] = useState('changes');
  const [staged, setStaged] = useState([]);
  const [unstaged, setUnstaged] = useState([]);
  const [selected, setSelected] = useState(null);
  const [diff, setDiff] = useState(null);
  const [commitMsg, setCommitMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');
  const [logEntries, setLogEntries] = useState([]);
  const [selectedCommit, setSelectedCommit] = useState(null);
  const [commitDiff, setCommitDiff] = useState(null);
  const [logBusy, setLogBusy] = useState(false);
  const [fileFilter, setFileFilter] = useState('');
  const [logLimit, setLogLimit] = useState(200);
  const [selectedDiffFile, setSelectedDiffFile] = useState(null);
  const [pushing, setPushing] = useState(false);
  const filterTimerRef = useRef(null);

  const showToast = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(''), 2500);
  };

  const refresh = useCallback(async () => {
    setBusy(true);
    setError('');
    try {
      const res = await window.electron.git.status(cwd);
      if (res.ok) {
        setStaged(res.staged || []);
        setUnstaged(res.unstaged || []);
      } else {
        setError(res.error || 'git status failed');
      }
    } catch (e) {
      setError(e.message || 'git status failed');
    } finally {
      setBusy(false);
    }
  }, [cwd]);

  useEffect(() => { refresh(); }, [refresh]);

  const loadDiff = useCallback(async (file, isStaged) => {
    setSelected({ file, staged: isStaged });
    setDiff(null);
    try {
      const res = await window.electron.git.diff(cwd, file, isStaged);
      setDiff(res.ok ? res.diff : res.error || '');
    } catch (e) {
      setDiff(e.message || '');
    }
  }, [cwd]);

  const loadLog = useCallback(async (filePath) => {
    setLogBusy(true);
    setError('');
    try {
      const res = await window.electron.git.log(cwd, filePath || null, logLimit);
      if (res.ok) setLogEntries(res.commits || []);
      else setError(res.error || 'git log failed');
    } catch (e) {
      setError(e.message || 'git log failed');
    } finally {
      setLogBusy(false);
    }
  }, [cwd, logLimit]);

  const loadCommitDiff = useCallback(async (hash) => {
    setCommitDiff(null);
    try {
      const res = await window.electron.git.show(cwd, hash);
      setCommitDiff(res.ok ? res.diff : res.error || '');
    } catch (e) {
      setCommitDiff(e.message || '');
    }
  }, [cwd]);

  useEffect(() => {
    if (view === 'history') loadLog(fileFilter || null);
  }, [view, cwd, loadLog]);

  useEffect(() => {
    if (view !== 'history') return;
    clearTimeout(filterTimerRef.current);
    filterTimerRef.current = setTimeout(() => loadLog(fileFilter || null), 300);
    return () => clearTimeout(filterTimerRef.current);
  }, [fileFilter]);

  const handleStage = async (file) => {
    const res = await window.electron.git.stage(cwd, file);
    if (res.ok) { showToast(`Staged ${file}`); refresh(); }
    else setError(res.error || 'stage failed');
  };

  const handleUnstage = async (file) => {
    const res = await window.electron.git.unstage(cwd, file);
    if (res.ok) { showToast(`Unstaged ${file}`); refresh(); }
    else setError(res.error || 'unstage failed');
  };

  const handleDiscard = async (file) => {
    const res = await window.electron.git.discard(cwd, file);
    if (res.ok) { showToast(`Discarded ${file}`); refresh(); }
    else setError(res.error || 'discard failed');
  };

  const handleCommit = async () => {
    const msg = commitMsg.trim();
    if (!msg) { setError('Commit message required'); return; }
    if (staged.length === 0) { setError('No staged changes to commit'); return; }
    setBusy(true);
    setError('');
    const res = await window.electron.git.commit(cwd, msg);
    setBusy(false);
    if (res.ok) {
      setCommitMsg('');
      setSelected(null);
      setDiff(null);
      showToast('Committed successfully');
      refresh();
    } else {
      setError(res.error || 'commit failed');
    }
  };

  const stageAll = async () => {
    for (const { file } of unstaged) {
      await window.electron.git.stage(cwd, file);
    }
    showToast('Staged all changes');
    refresh();
  };

  const handlePush = async () => {
    setPushing(true);
    setError('');
    const res = await window.electron.git.push(cwd);
    setPushing(false);
    if (res.ok) showToast('Pushed successfully');
    else setError(res.error || 'push failed');
  };

  const commitDiffFiles = useMemo(() => parseCommitDiffByFile(commitDiff), [commitDiff]);

  useEffect(() => { setSelectedDiffFile(null); }, [selectedCommit]);

  return (
    <div className="git-panel" onClick={onFocus}>
      <div className="git-header">
        <svg className="git-logo" viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="7" cy="6" r="2" />
          <circle cx="7" cy="18" r="2" />
          <circle cx="17" cy="11" r="2" />
          <path d="M7 8v8M9 6c3 0 6 2 6 5" />
        </svg>
        <span className="git-title">Git</span>
        {cwd && <span className="git-cwd" title={cwd}>{cwd}</span>}
        <div className="git-header-actions">
          <button className="manager-hide-btn" onClick={(e) => { e.stopPropagation(); if (view === 'changes') refresh(); else loadLog(fileFilter || null); }} title="Refresh" disabled={busy || logBusy}>R</button>
          <button className="manager-hide-btn" onClick={(e) => { e.stopPropagation(); handlePush(); }} title="Push" disabled={pushing}>↑</button>
          <button className="manager-hide-btn" onClick={(e) => { e.stopPropagation(); onHide?.(); }} title="Close">‹</button>
        </div>
      </div>

      <div className="git-tabs">
        <button className={`git-tab${view === 'changes' ? ' active' : ''}`} onClick={() => setView('changes')}>Changes</button>
        <button className={`git-tab${view === 'history' ? ' active' : ''}`} onClick={() => setView('history')}>History</button>
      </div>

      {toast && <div className="git-toast">{toast}</div>}
      {error && <div className="git-error" onClick={() => setError('')}>{error}</div>}

      {view === 'changes' && (
        <div className="git-body">
          <div className="git-sidebar">

            <div className="git-section">
              <div className="git-section-header">
                <span className="git-section-title">Staged ({staged.length})</span>
              </div>
              {staged.length === 0
                ? <div className="git-empty">Nothing staged</div>
                : staged.map(({ file, status: s }) => (
                  <div key={file} className={`git-file${selected?.file === file && selected?.staged ? ' active' : ''}`}>
                    <button className="git-file-name" onClick={() => loadDiff(file, true)} title={file}>
                      <span className={`git-badge git-badge-${statusClass(s)}`}>{statusLabel(s)}</span>
                      <span className="git-file-path">{file}</span>
                    </button>
                    <button className="git-action-btn" onClick={() => handleUnstage(file)} title="Unstage">−</button>
                  </div>
                ))
              }
            </div>

            <div className="git-section">
              <div className="git-section-header">
                <span className="git-section-title">Changes ({unstaged.length})</span>
                {unstaged.length > 0 && (
                  <button className="git-section-action" onClick={stageAll} title="Stage all">Stage all</button>
                )}
              </div>
              {unstaged.length === 0
                ? <div className="git-empty">Working tree clean</div>
                : unstaged.map(({ file, status: s }) => (
                  <div key={file} className={`git-file${selected?.file === file && !selected?.staged ? ' active' : ''}`}>
                    <button className="git-file-name" onClick={() => loadDiff(file, false)} title={file}>
                      <span className={`git-badge git-badge-${statusClass(s)}`}>{statusLabel(s)}</span>
                      <span className="git-file-path">{file}</span>
                    </button>
                    <div className="git-file-btns">
                      {s !== '??' && (
                        <button className="git-action-btn danger" onClick={() => handleDiscard(file)} title="Discard changes">✕</button>
                      )}
                      <button className="git-action-btn" onClick={() => handleStage(file)} title="Stage">+</button>
                    </div>
                  </div>
                ))
              }
            </div>

            <div className="git-commit">
              <textarea
                className="git-commit-input"
                placeholder="Commit message..."
                value={commitMsg}
                onChange={(e) => setCommitMsg(e.target.value)}
                rows={3}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                    e.preventDefault();
                    handleCommit();
                  }
                }}
              />
              <button
                className="btn-primary git-commit-btn"
                onClick={handleCommit}
                disabled={busy || !commitMsg.trim() || staged.length === 0}
              >
                {busy ? 'Committing…' : 'Commit'}
              </button>
              <div className="git-commit-hint">Ctrl+Enter to commit</div>
            </div>
          </div>

          <div className="git-diff-pane">
            {!selected
              ? <div className="git-diff-empty">Select a file to view diff</div>
              : diff === null
                ? <div className="git-diff-empty">Loading…</div>
                : diff === ''
                  ? <div className="git-diff-empty">No diff (binary or empty file)</div>
                  : <DiffView diff={diff} />
            }
          </div>
        </div>
      )}

      {view === 'history' && (
        <div className="git-body">
          <div className="git-history-pane">
            <input
              className="git-file-filter"
              placeholder="Filter by file path…"
              value={fileFilter}
              onChange={(e) => setFileFilter(e.target.value)}
            />
            {logBusy && <div className="git-empty">Loading…</div>}
            {!logBusy && logEntries.length === 0 && <div className="git-empty">No commits found</div>}
            {logEntries.map((c) => (
              <div
                key={c.hash}
                className={`git-commit-row${selectedCommit === c.hash ? ' active' : ''}`}
                onClick={() => { setSelectedCommit(c.hash); loadCommitDiff(c.hash); }}
              >
                <span className="git-commit-hash">{c.shortHash}</span>
                <span className="git-commit-subject">{c.subject}</span>
                <span className="git-commit-meta">{c.author} · {c.relativeDate}</span>
              </div>
            ))}
            {logEntries.length >= logLimit && (
              <button className="git-section-action" style={{ margin: '8px auto', display: 'block' }} onClick={() => setLogLimit((n) => n + 200)}>Load more</button>
            )}
          </div>
          <div className="git-history-diff">
            {!selectedCommit
              ? <div className="git-diff-empty">Select a commit to view diff</div>
              : commitDiff === null
                ? <div className="git-diff-empty">Loading…</div>
                : commitDiffFiles.length === 0
                  ? <DiffView diff={commitDiff} />
                  : (
                    <div className="git-commit-diff-split">
                      <div className="git-commit-diff-files">
                        {commitDiffFiles.map((s) => (
                          <button
                            key={s.file}
                            className={`git-commit-diff-file-btn${selectedDiffFile === s.file ? ' active' : ''}`}
                            onClick={() => setSelectedDiffFile(s.file)}
                            title={s.file}
                          >{s.file}</button>
                        ))}
                      </div>
                      <div className="git-commit-diff-content">
                        {selectedDiffFile
                          ? <DiffView diff={commitDiffFiles.find((s) => s.file === selectedDiffFile)?.diff || ''} />
                          : <div className="git-diff-empty">Select a file</div>
                        }
                      </div>
                    </div>
                  )
            }
          </div>
        </div>
      )}
    </div>
  );
}
