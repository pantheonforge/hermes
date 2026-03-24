import React, { useState, useCallback } from 'react';

const STORAGE_KEY = 'hermes:prompt-templates';
const VAR_COLORS = ['var(--accent)', 'var(--green)', 'var(--yellow)', 'var(--orange)', 'var(--purple)'];

function parseVars(template) {
  const matches = [];
  const seen = new Set();
  const re = /\{\{(\w+)\}\}/g;
  let m;
  while ((m = re.exec(template)) !== null) {
    if (!seen.has(m[1])) { seen.add(m[1]); matches.push(m[1]); }
  }
  return matches;
}

function resolveTemplate(template, values) {
  return template.replace(/\{\{(\w+)\}\}/g, (_, name) => values[name] || `{{${name}}}`);
}

function loadTemplates() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); } catch { return []; }
}

function saveTemplates(templates) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(templates));
}

export default function PromptTemplatesPanel({ onHide, onFocus, onSend }) {
  const [templates, setTemplates] = useState(loadTemplates);
  const [view, setView] = useState('list');
  const [selectedId, setSelectedId] = useState(null);
  const [showNewForm, setShowNewForm] = useState(false);
  const [newName, setNewName] = useState('');
  const [newTemplate, setNewTemplate] = useState('');
  const [varValues, setVarValues] = useState({});

  const persist = useCallback((next) => {
    setTemplates(next);
    saveTemplates(next);
  }, []);

  const selected = templates.find((t) => t.id === selectedId) || null;
  const vars = selected ? parseVars(selected.template) : [];
  const allFilled = vars.length === 0 || vars.every((v) => varValues[v]?.trim());
  const resolved = selected ? resolveTemplate(selected.template, varValues) : '';

  const openFill = useCallback((tpl) => {
    setSelectedId(tpl.id);
    setVarValues({});
    setView('fill');
  }, []);

  const incrementUseCount = useCallback((id) => {
    persist(templates.map((t) => t.id === id ? { ...t, useCount: (t.useCount || 0) + 1 } : t));
  }, [templates, persist]);

  const handleSend = useCallback(() => {
    if (!allFilled || !selected) return;
    onSend?.(resolved);
    incrementUseCount(selected.id);
    setView('list');
  }, [allFilled, onSend, resolved, selected, incrementUseCount]);

  const handleCopy = useCallback(() => {
    if (!selected) return;
    navigator.clipboard.writeText(resolved).catch(() => {});
    incrementUseCount(selected.id);
  }, [resolved, selected, incrementUseCount]);

  const handleCreate = useCallback(() => {
    const name = newName.trim();
    const tmpl = newTemplate.trim();
    if (!name || !tmpl) return;
    persist([...templates, { id: `pt-${Date.now()}`, name, template: tmpl, useCount: 0 }]);
    setNewName('');
    setNewTemplate('');
    setShowNewForm(false);
  }, [newName, newTemplate, templates, persist]);

  const handleDelete = useCallback((id, e) => {
    e.stopPropagation();
    persist(templates.filter((t) => t.id !== id));
  }, [templates, persist]);

  return (
    <div className="pt-panel" onClick={onFocus}>
      <div className="pt-header">
        <button className="monitor-hide-btn" onClick={onHide} title="Hide panel">‹</button>
        <span className="title">Prompt Templates</span>
      </div>
      <div className="pt-body">
        {view === 'list' ? (
          <>
            <div className="pt-toolbar">
              <span className="pt-toolbar-title">Templates ({templates.length})</span>
              <button className="btn" onClick={() => setShowNewForm((v) => !v)}>
                {showNewForm ? 'Cancel' : '+ New'}
              </button>
            </div>
            {showNewForm && (
              <div className="pt-new-form">
                <input
                  placeholder="Template name"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  autoFocus
                />
                <textarea
                  placeholder="Template text… use {{variable_name}} for variables"
                  value={newTemplate}
                  onChange={(e) => setNewTemplate(e.target.value)}
                  spellCheck={false}
                />
                {newTemplate && (
                  <div className="pt-var-hint">
                    Variables: {parseVars(newTemplate).join(', ') || 'none'}
                  </div>
                )}
                <div className="pt-form-actions">
                  <button
                    className="btn-primary"
                    onClick={handleCreate}
                    disabled={!newName.trim() || !newTemplate.trim()}
                  >
                    Save
                  </button>
                </div>
              </div>
            )}
            <div className="pt-list">
              {templates.length === 0 && !showNewForm && (
                <div className="pt-empty">No templates yet. Click + New to create one.</div>
              )}
              {templates.map((tpl) => (
                <div key={tpl.id} className="pt-item" onClick={() => openFill(tpl)}>
                  <span className="pt-item-name" title={tpl.name}>{tpl.name}</span>
                  <div className="pt-item-meta">
                    {tpl.useCount > 0 && <span className="pt-use-count">×{tpl.useCount}</span>}
                    <button
                      className="pt-run-btn"
                      onClick={(e) => { e.stopPropagation(); openFill(tpl); }}
                      title="Fill & send"
                    >▶</button>
                    <button
                      className="pt-delete-btn"
                      onClick={(e) => handleDelete(tpl.id, e)}
                      title="Delete"
                    >×</button>
                  </div>
                </div>
              ))}
            </div>
          </>
        ) : (
          <>
            <div className="pt-fill-back">
              <button className="pt-back-btn" onClick={() => setView('list')}>‹</button>
              <span className="pt-fill-name">{selected?.name}</span>
            </div>
            <div className="pt-fill-vars">
              {vars.length === 0 && (
                <div className="pt-empty">No variables in this template.</div>
              )}
              {vars.map((v, i) => (
                <div key={v} className="pt-var-row">
                  <label className="pt-var-label" style={{ color: VAR_COLORS[i % VAR_COLORS.length] }}>
                    {v}
                  </label>
                  <input
                    className="pt-var-input"
                    style={{ borderColor: varValues[v]?.trim() ? VAR_COLORS[i % VAR_COLORS.length] : undefined }}
                    placeholder={`Enter ${v}…`}
                    value={varValues[v] || ''}
                    onChange={(e) => setVarValues((prev) => ({ ...prev, [v]: e.target.value }))}
                    autoFocus={i === 0}
                  />
                </div>
              ))}
            </div>
            <div className="pt-preview-section">
              <div className="pt-preview-label">Preview</div>
              <div className="pt-preview-box">{resolved || selected?.template || ''}</div>
            </div>
            <div className="pt-fill-footer">
              <button className="btn" onClick={handleCopy}>Copy</button>
              <button
                className="btn-primary"
                onClick={handleSend}
                disabled={!allFilled}
                style={{ flex: 1 }}
              >
                Send to agent
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
