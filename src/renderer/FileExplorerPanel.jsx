import React, { useState, useEffect, useCallback, useRef } from 'react';

const DIR_IGNORE = new Set(['.git', 'node_modules', '__pycache__', '.next', 'dist', 'build', '.cache', 'target', 'venv', '.venv']);

const FILE_ICONS = {
  js: 'JS', jsx: 'JSX', ts: 'TS', tsx: 'TSX',
  py: 'PY', rs: 'RS', go: 'GO', rb: 'RB', java: 'JA',
  json: '{}', yaml: 'YM', yml: 'YM', toml: 'TM',
  css: 'CS', scss: 'SC', html: 'HT', htm: 'HT', xml: 'XM', svg: 'SV',
  md: 'MD', txt: 'TX', sh: 'SH', bash: 'SH',
};

function fileIcon(name) {
  const ext = name.split('.').pop()?.toLowerCase() || '';
  return FILE_ICONS[ext] || '  ';
}

function DirNode({ path: dirPath, name, depth, expanded, onToggle, onFileClick, dirContents }) {
  const contents = dirContents.get(dirPath);
  const isExpanded = expanded.has(dirPath);

  return (
    <div>
      <button
        className="fe-node fe-dir"
        style={{ paddingLeft: `${8 + depth * 14}px` }}
        onClick={() => onToggle(dirPath)}
        title={dirPath}
      >
        <span className="fe-chevron">{isExpanded ? '▾' : '▸'}</span>
        <span className="fe-dir-icon">⬡</span>
        <span className="fe-name">{name}</span>
      </button>
      {isExpanded && contents?.entries && (
        <div>
          {contents.entries.map((entry) =>
            entry.type === 'dir'
              ? <DirNode
                  key={entry.path}
                  path={entry.path}
                  name={entry.name}
                  depth={depth + 1}
                  expanded={expanded}
                  onToggle={onToggle}
                  onFileClick={onFileClick}
                  dirContents={dirContents}
                />
              : <FileNode
                  key={entry.path}
                  path={entry.path}
                  name={entry.name}
                  depth={depth + 1}
                  onFileClick={onFileClick}
                />
          )}
          {contents.entries.length === 0 && (
            <div className="fe-empty" style={{ paddingLeft: `${8 + (depth + 1) * 14}px` }}>empty</div>
          )}
        </div>
      )}
      {isExpanded && contents?.loading && (
        <div className="fe-empty" style={{ paddingLeft: `${8 + (depth + 1) * 14}px` }}>loading…</div>
      )}
    </div>
  );
}

function FileNode({ path: filePath, name, depth, onFileClick }) {
  return (
    <button
      className="fe-node fe-file"
      style={{ paddingLeft: `${8 + depth * 14}px` }}
      onClick={() => onFileClick(filePath, name)}
      title={filePath}
    >
      <span className="fe-file-icon">{fileIcon(name)}</span>
      <span className="fe-name">{name}</span>
    </button>
  );
}

export default function FileExplorerPanel({ cwd, onHide, onFocus, onOpenFile }) {
  const [rootDir, setRootDir] = useState(cwd || '');
  const [expanded, setExpanded] = useState(() => new Set());
  const [dirContents, setDirContents] = useState(() => new Map());
  const [error, setError] = useState('');
  const cwdRef = useRef(cwd);

  const loadDir = useCallback(async (dirPath) => {
    setDirContents((prev) => {
      const next = new Map(prev);
      next.set(dirPath, { loading: true, entries: prev.get(dirPath)?.entries || [] });
      return next;
    });
    try {
      const res = await window.electron.explorer.listDir(dirPath);
      if (res.ok) {
        setDirContents((prev) => {
          const next = new Map(prev);
          next.set(dirPath, { loading: false, entries: res.entries });
          return next;
        });
      } else {
        setDirContents((prev) => {
          const next = new Map(prev);
          next.set(dirPath, { loading: false, entries: [], error: res.error });
          return next;
        });
        setError(res.error || 'Failed to list directory');
      }
    } catch (e) {
      setDirContents((prev) => {
        const next = new Map(prev);
        next.set(dirPath, { loading: false, entries: [], error: e.message });
        return next;
      });
    }
  }, []);

  // Load root dir on mount or when cwd changes
  useEffect(() => {
    const dir = cwd || '';
    cwdRef.current = dir;
    if (dir && dir !== rootDir) {
      setRootDir(dir);
      setExpanded(new Set());
      setDirContents(new Map());
    }
    if (dir) loadDir(dir);
  }, [cwd]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (rootDir) loadDir(rootDir);
  }, [rootDir, loadDir]);

  const handleToggle = useCallback((dirPath) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(dirPath)) {
        next.delete(dirPath);
      } else {
        next.add(dirPath);
        if (!dirContents.has(dirPath) || dirContents.get(dirPath)?.loading === false) {
          loadDir(dirPath);
        }
      }
      return next;
    });
  }, [dirContents, loadDir]);

  const handleFileClick = useCallback(async (filePath, name) => {
    try {
      const res = await window.electron.explorer.readFile(filePath);
      if (res.ok) {
        onOpenFile?.({ path: filePath, name, content: res.content });
      } else {
        setError(res.error || 'Failed to read file');
      }
    } catch (e) {
      setError(e.message || 'Failed to read file');
    }
  }, [onOpenFile]);

  const goUp = () => {
    const parts = rootDir.replace(/\\/g, '/').split('/').filter(Boolean);
    if (parts.length <= 1) return;
    const parent = rootDir.includes('\\')
      ? rootDir.split('\\').slice(0, -1).join('\\') || '\\'
      : '/' + parts.slice(0, -1).join('/');
    setRootDir(parent);
    setExpanded(new Set());
    setDirContents(new Map());
  };

  const rootEntries = dirContents.get(rootDir);

  return (
    <div className="fe-panel" onClick={onFocus}>
      <div className="fe-header">
        <svg className="fe-logo" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M3 7h18M3 12h18M3 17h18" />
        </svg>
        <span className="fe-title">Explorer</span>
        <div className="fe-header-actions">
          <button className="manager-hide-btn" onClick={(e) => { e.stopPropagation(); if (rootDir) loadDir(rootDir); }} title="Refresh">R</button>
          <button className="manager-hide-btn" onClick={(e) => { e.stopPropagation(); onHide?.(); }} title="Close">‹</button>
        </div>
      </div>

      {rootDir && (
        <div className="fe-rootbar">
          <button className="fe-up-btn" onClick={goUp} title="Go up">↑</button>
          <span className="fe-rootpath" title={rootDir}>{rootDir}</span>
        </div>
      )}

      {error && <div className="fe-error" onClick={() => setError('')}>{error}</div>}

      {!rootDir && <div className="fe-empty-msg">No directory. Open a terminal first.</div>}

      <div className="fe-tree">
        {rootEntries?.loading && <div className="fe-empty">Loading…</div>}
        {rootEntries?.entries?.map((entry) =>
          entry.type === 'dir'
            ? <DirNode
                key={entry.path}
                path={entry.path}
                name={entry.name}
                depth={0}
                expanded={expanded}
                onToggle={handleToggle}
                onFileClick={handleFileClick}
                dirContents={dirContents}
              />
            : <FileNode
                key={entry.path}
                path={entry.path}
                name={entry.name}
                depth={0}
                onFileClick={handleFileClick}
              />
        )}
      </div>
    </div>
  );
}
