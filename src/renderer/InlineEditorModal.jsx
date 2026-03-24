import React, { useEffect, useRef, useState, useCallback } from 'react';

const TPL_KEY = 'hermes:prompt-templates';
const VAR_COLORS = ['var(--accent)', 'var(--green)', 'var(--yellow)', 'var(--orange)', 'var(--purple)'];

function loadTemplates() {
  try { return JSON.parse(localStorage.getItem(TPL_KEY) || '[]'); } catch { return []; }
}

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

export default function InlineEditorModal({
  visible,
  paneId,
  value,
  onChange,
  onSend,
  onClose,
  onClear,
  onSaveDraft,
  onSaveDraftAs,
  availableProjects = [],
  activeDraft,
  voiceState,
}) {
  const inputRef = useRef(null);
  const [draftName, setDraftName] = useState('');
  const [draftProject, setDraftProject] = useState('');
  const [showTplPicker, setShowTplPicker] = useState(false);
  const [templates, setTemplates] = useState([]);
  const [pickerTpl, setPickerTpl] = useState(null);
  const [pickerVars, setPickerVars] = useState({});

  useEffect(() => {
    if (!visible) {
      setShowTplPicker(false);
      setPickerTpl(null);
      return undefined;
    }
    setDraftName(String(activeDraft?.name || ''));
    setDraftProject(String(activeDraft?.project || ''));
    if (!showTplPicker) {
      requestAnimationFrame(() => inputRef.current?.focus());
    }
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        if (pickerTpl) { setPickerTpl(null); return; }
        if (showTplPicker) { setShowTplPicker(false); return; }
        onClose?.();
      } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        onSend?.();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [visible, onClose, onSend, showTplPicker, pickerTpl, activeDraft?.name, activeDraft?.project]);

  const openTplPicker = useCallback(() => {
    setTemplates(loadTemplates());
    setPickerTpl(null);
    setPickerVars({});
    setShowTplPicker(true);
  }, []);

  const selectTpl = useCallback((tpl) => {
    const vars = parseVars(tpl.template);
    if (vars.length === 0) {
      onChange?.(value ? value + '\n' + tpl.template : tpl.template);
      setShowTplPicker(false);
    } else {
      setPickerTpl(tpl);
      setPickerVars({});
    }
  }, [onChange, value]);

  const insertTpl = useCallback(() => {
    if (!pickerTpl) return;
    const resolved = resolveTemplate(pickerTpl.template, pickerVars);
    onChange?.(value ? value + '\n' + resolved : resolved);
    setPickerTpl(null);
    setShowTplPicker(false);
  }, [pickerTpl, pickerVars, onChange, value]);

  const savePayload = useCallback(() => ({
    id: activeDraft?.id || null,
    fileName: activeDraft?.fileName || null,
    name: String(draftName || '').trim(),
    project: String(draftProject || '').trim(),
    content: String(value || ''),
  }), [activeDraft?.id, activeDraft?.fileName, draftName, draftProject, value]);

  const handleSave = useCallback(async () => {
    const payload = savePayload();
    if (!activeDraft?.id || !payload.name || !payload.content) return;
    await onSaveDraft?.(payload);
  }, [savePayload, activeDraft?.id, onSaveDraft]);

  const handleSaveAs = useCallback(async () => {
    const payload = savePayload();
    if (!payload.name || !payload.content) return;
    await onSaveDraftAs?.(payload);
  }, [savePayload, onSaveDraftAs]);

  if (!visible) return null;

  const vars = pickerTpl ? parseVars(pickerTpl.template) : [];
  const allFilled = vars.every((v) => pickerVars[v]?.trim());

  if (showTplPicker) {
    return (
      <div className="config-overlay" onClick={() => setShowTplPicker(false)}>
        <div className="config-panel inline-editor-panel" onClick={(e) => e.stopPropagation()}>
          <div className="config-header">
            <span className="config-title">
              {pickerTpl ? pickerTpl.name : 'Load Template'}
            </span>
            <button className="config-close" onClick={() => setShowTplPicker(false)}>x</button>
          </div>
          {pickerTpl ? (
            <>
              <div className="config-body ied-tpl-fill">
                {vars.map((v, i) => (
                  <div key={v} className="pt-var-row">
                    <label className="pt-var-label" style={{ color: VAR_COLORS[i % VAR_COLORS.length] }}>{v}</label>
                    <input
                      className="pt-var-input"
                      style={{ borderColor: pickerVars[v]?.trim() ? VAR_COLORS[i % VAR_COLORS.length] : undefined }}
                      placeholder={`Enter ${v}...`}
                      value={pickerVars[v] || ''}
                      onChange={(e) => setPickerVars((prev) => ({ ...prev, [v]: e.target.value }))}
                      autoFocus={i === 0}
                    />
                  </div>
                ))}
                <div className="pt-preview-section">
                  <div className="pt-preview-label">Preview</div>
                  <div className="pt-preview-box">{resolveTemplate(pickerTpl.template, pickerVars)}</div>
                </div>
              </div>
              <div className="config-footer">
                <button className="btn" onClick={() => setPickerTpl(null)}>&lt; Back</button>
                <button className="btn-primary" onClick={insertTpl} disabled={!allFilled} style={{ flex: 1 }}>
                  Insert into editor
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="config-body ied-tpl-list">
                {templates.length === 0 && (
                  <div className="pt-empty">No templates saved yet.</div>
                )}
                {templates.map((tpl) => (
                  <div key={tpl.id} className="pd-item" onClick={() => selectTpl(tpl)}>
                    <span className="pd-item-name">{tpl.name}</span>
                    {tpl.useCount > 0 && <span className="pt-use-count">x{tpl.useCount}</span>}
                  </div>
                ))}
              </div>
              <div className="config-footer">
                <button className="btn" onClick={() => setShowTplPicker(false)}>Cancel</button>
              </div>
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="config-overlay" onClick={onClose}>
      <div className="config-panel inline-editor-panel" onClick={(e) => e.stopPropagation()}>
        <div className="config-header">
          <span className="config-title">Inline Editor</span>
          <span className="inline-editor-target">Pane: {paneId || '-'}</span>
          {voiceState && (
            <span className={`pane-recording-badge pane-recording-badge--${voiceState}`} style={{ position: 'static', marginLeft: 'auto', marginRight: '8px' }}>
              <span className="voice-dot" />
              {voiceState === 'recording' ? 'Recording...' : voiceState === 'processing' ? 'Processing...' : 'Injecting...'}
            </span>
          )}
          <button className="config-close" onClick={onClose}>x</button>
        </div>
        <div className="config-body">
          <textarea
            ref={inputRef}
            className="inline-editor-input"
            value={value}
            onChange={(e) => onChange?.(e.target.value)}
            spellCheck={false}
            placeholder="Write terminal input here..."
          />
          <div className="ied-save-draft-row">
            <input
              className="ied-draft-name-input"
              placeholder="Draft name"
              value={draftName}
              onChange={(e) => setDraftName(e.target.value)}
            />
            <input
              className="ied-draft-project-input"
              placeholder="Project"
              value={draftProject}
              list="ied-project-options"
              onChange={(e) => setDraftProject(e.target.value)}
            />
            <datalist id="ied-project-options">
              {availableProjects.map((project) => (
                <option key={project} value={project} />
              ))}
            </datalist>
          </div>
          <div className="field-hint">Ctrl+Enter to send, Esc to close</div>
        </div>
        <div className="config-footer">
          <button className="btn" onClick={onClear}>Clear</button>
          <button className="btn" onClick={openTplPicker}>Templates</button>
          <button className="btn" onClick={onClose}>Close</button>
          <button className="btn" onClick={handleSave} disabled={!activeDraft?.id || !draftName.trim() || !value}>Save</button>
          <button className="btn" onClick={handleSaveAs} disabled={!draftName.trim() || !value}>Save As</button>
          <button className="btn-primary" onClick={onSend}>Send</button>
        </div>
      </div>
    </div>
  );
}
