import { useState, useEffect, useRef, useCallback } from 'react';

const STORAGE_KEY = 'hermes:todo-lists';

function genId() {
  return Math.random().toString(36).slice(2, 10);
}

function sanitizeFilename(name) {
  return 'todo_' + name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60) + '.md';
}

function serializeList(list) {
  const lines = [];
  if (list.complete) lines.push('<!-- hermes:complete -->');
  lines.push(`# ${list.name}`, '');
  for (const task of list.tasks) {
    lines.push(`- [${task.done ? 'x' : ' '}] ${task.text}`);
  }
  return lines.join('\n');
}

function parseList(filename, content) {
  const lines = content.split('\n');
  let complete = false;
  let name = filename.replace(/^todo_/, '').replace(/\.md$/, '').replace(/_/g, ' ');
  const tasks = [];
  for (const line of lines) {
    if (line.trim() === '<!-- hermes:complete -->') { complete = true; continue; }
    const headMatch = line.match(/^#\s+(.+)/);
    if (headMatch) { name = headMatch[1].trim(); continue; }
    const taskMatch = line.match(/^- \[( |x)\] (.+)/);
    if (taskMatch) tasks.push({ id: genId(), text: taskMatch[2], done: taskMatch[1] === 'x' });
  }
  return { name, complete, tasks };
}

function loadFromStorage() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
  } catch {
    return [];
  }
}

export default function TodoPanel({ config, onHide, onFocus }) {
  const [lists, setLists] = useState(loadFromStorage);
  const [selectedId, setSelectedId] = useState(null);
  const [hideDone, setHideDone] = useState(false);
  const [hideComplete, setHideComplete] = useState(false);
  const [newListName, setNewListName] = useState('');
  const [showNewList, setShowNewList] = useState(false);
  const [newTaskText, setNewTaskText] = useState('');
  const dirtyRef = useRef(new Set());
  const debounceRef = useRef({});

  const folder = String(config?.promptDraftsFolder || '').trim();

  // persist to localStorage on every lists change
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(lists));
  }, [lists]);

  // load from disk on mount / folder change
  useEffect(() => {
    if (!folder) return;
    window.electron.todo.readFolder({ folder }).then((res) => {
      if (!res.ok) return;
      setLists((prev) => {
        const byName = new Map(prev.map((l) => [l.name.toLowerCase(), l]));
        const merged = [...prev];
        for (const { filename, content } of res.files) {
          const parsed = parseList(filename, content);
          const existing = byName.get(parsed.name.toLowerCase());
          if (existing) {
            const idx = merged.findIndex((l) => l.id === existing.id);
            merged[idx] = { ...existing, ...parsed, filename, updatedAt: existing.updatedAt };
          } else {
            merged.push({ id: genId(), filename, updatedAt: Date.now(), ...parsed });
          }
        }
        return merged;
      });
    }).catch(() => {});
  }, [folder]);

  const syncFile = useCallback((list) => {
    if (!folder || !list.filename) return;
    clearTimeout(debounceRef.current[list.id]);
    debounceRef.current[list.id] = setTimeout(() => {
      window.electron.todo.writeFile({
        folder,
        filename: list.filename,
        content: serializeList(list),
      }).catch(() => {});
      dirtyRef.current.delete(list.id);
    }, 300);
  }, [folder]);

  const updateList = useCallback((id, updater) => {
    setLists((prev) => {
      const next = prev.map((l) => l.id === id ? { ...updater(l), updatedAt: Date.now() } : l);
      const updated = next.find((l) => l.id === id);
      if (updated && folder) {
        dirtyRef.current.add(id);
        syncFile(updated);
      }
      return next;
    });
  }, [folder, syncFile]);

  const addList = () => {
    const name = newListName.trim();
    if (!name) return;
    const filename = folder ? sanitizeFilename(name) : undefined;
    const list = { id: genId(), name, complete: false, filename, tasks: [], updatedAt: Date.now() };
    setLists((prev) => [...prev, list]);
    if (folder && filename) {
      window.electron.todo.writeFile({ folder, filename, content: serializeList(list) }).catch(() => {});
    }
    setSelectedId(list.id);
    setNewListName('');
    setShowNewList(false);
  };

  const deleteList = (id) => {
    const list = lists.find((l) => l.id === id);
    if (list?.filename && folder) {
      window.electron.todo.deleteFile({ folder, filename: list.filename }).catch(() => {});
    }
    setLists((prev) => prev.filter((l) => l.id !== id));
    if (selectedId === id) setSelectedId(null);
  };

  const renameList = (id, newName) => {
    const name = newName.trim();
    if (!name) return;
    const list = lists.find((l) => l.id === id);
    if (!list) return;
    const oldFilename = list.filename;
    const newFilename = folder ? sanitizeFilename(name) : undefined;
    if (oldFilename && folder && oldFilename !== newFilename) {
      window.electron.todo.deleteFile({ folder, filename: oldFilename }).catch(() => {});
    }
    updateList(id, (l) => ({ ...l, name, filename: newFilename }));
    if (newFilename && folder) {
      const updated = { ...list, name, filename: newFilename };
      setTimeout(() => {
        window.electron.todo.writeFile({ folder, filename: newFilename, content: serializeList(updated) }).catch(() => {});
      }, 0);
    }
  };

  const addTask = (listId) => {
    const text = newTaskText.trim();
    if (!text) return;
    updateList(listId, (l) => ({ ...l, tasks: [...l.tasks, { id: genId(), text, done: false }] }));
    setNewTaskText('');
  };

  const toggleTask = (listId, taskId) => {
    updateList(listId, (l) => ({
      ...l,
      tasks: l.tasks.map((t) => t.id === taskId ? { ...t, done: !t.done } : t),
    }));
  };

  const deleteTask = (listId, taskId) => {
    updateList(listId, (l) => ({ ...l, tasks: l.tasks.filter((t) => t.id !== taskId) }));
  };

  const toggleComplete = (listId) => {
    updateList(listId, (l) => ({ ...l, complete: !l.complete }));
  };

  const selected = lists.find((l) => l.id === selectedId) ?? null;
  const visibleLists = hideComplete ? lists.filter((l) => !l.complete) : lists;
  const visibleTasks = selected
    ? (hideDone ? selected.tasks.filter((t) => !t.done) : selected.tasks)
    : [];

  return (
    <div className="td-panel" onMouseDown={onFocus}>
      <div className="td-header">
        <button className="td-back-btn" onClick={onHide} title="Close">‹</button>
        <span className="td-title">Todo</span>
        <button className="td-add-btn" onClick={() => setShowNewList((v) => !v)} title="New list">+</button>
      </div>

      <div className="td-body">
        <div className="td-list-pane">
          <div className="td-list-scroll">
            {visibleLists.map((list) => (
              <div
                key={list.id}
                className={`td-list-item${list.id === selectedId ? ' td-list-item--active' : ''}${list.complete ? ' td-list-item--complete' : ''}`}
                onClick={() => setSelectedId(list.id)}
              >
                <span
                  className="td-list-dot"
                  onClick={(e) => { e.stopPropagation(); toggleComplete(list.id); }}
                  title={list.complete ? 'Mark incomplete' : 'Mark complete'}
                >●</span>
                <span className="td-list-name">{list.name}</span>
                <span className="td-list-count">{list.tasks.filter((t) => !t.done).length}/{list.tasks.length}</span>
                <button
                  className="td-list-del"
                  onClick={(e) => { e.stopPropagation(); deleteList(list.id); }}
                  title="Delete list"
                >✕</button>
              </div>
            ))}
          </div>
          <div className="td-list-toolbar">
            <button
              className={`td-toggle-btn${hideComplete ? ' active' : ''}`}
              onClick={() => setHideComplete((v) => !v)}
            >hide complete</button>
          </div>
          {showNewList && (
            <div className="td-new-list-row">
              <input
                className="td-input"
                placeholder="List name"
                value={newListName}
                onChange={(e) => setNewListName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') addList(); if (e.key === 'Escape') setShowNewList(false); }}
                autoFocus
              />
              <button className="td-confirm-btn" onClick={addList}>↵</button>
            </div>
          )}
        </div>

        {selected && (
          <div className="td-task-pane">
            <div className="td-task-header">
              <span
                className="td-task-title"
                contentEditable
                suppressContentEditableWarning
                onBlur={(e) => renameList(selected.id, e.target.textContent)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.target.blur(); } }}
              >{selected.name}</span>
              <button
                className={`td-toggle-btn${hideDone ? ' active' : ''}`}
                onClick={() => setHideDone((v) => !v)}
              >hide done</button>
            </div>
            <div className="td-task-list">
              {visibleTasks.map((task) => (
                <div key={task.id} className={`td-task-row${task.done ? ' td-task-row--done' : ''}`}>
                  <input
                    type="checkbox"
                    checked={task.done}
                    onChange={() => toggleTask(selected.id, task.id)}
                    className="td-checkbox"
                  />
                  <span className="td-task-text">{task.text}</span>
                  <button
                    className="td-task-del"
                    onClick={() => deleteTask(selected.id, task.id)}
                    title="Delete task"
                  >✕</button>
                </div>
              ))}
            </div>
            <div className="td-task-add">
              <input
                className="td-input"
                placeholder="Add task…"
                value={newTaskText}
                onChange={(e) => setNewTaskText(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') addTask(selected.id); }}
              />
              <button className="td-confirm-btn" onClick={() => addTask(selected.id)}>+</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
