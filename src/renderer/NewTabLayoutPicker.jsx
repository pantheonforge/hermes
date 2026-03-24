import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

function pickInitial(layouts, preferredIds) {
  for (const id of preferredIds) {
    if (!id) continue;
    if (layouts.some((layout) => layout.id === id)) return id;
  }
  return layouts[0]?.id || '';
}

export default function NewTabLayoutPicker({
  visible,
  layouts,
  defaultLayoutId,
  lastUsedLayoutId,
  position,
  onClose,
  onSelect,
}) {
  const sorted = useMemo(
    () => [...(Array.isArray(layouts) ? layouts : [])].sort((a, b) => a.name.localeCompare(b.name)),
    [layouts]
  );
  const [selectedId, setSelectedId] = useState('');
  const rootRef = useRef(null);

  useEffect(() => {
    if (!visible) return;
    setSelectedId(pickInitial(sorted, [lastUsedLayoutId, defaultLayoutId]));
  }, [visible, sorted, lastUsedLayoutId, defaultLayoutId]);

  const selected = sorted.find((layout) => layout.id === selectedId) || sorted[0];

  const handleConfirm = useCallback(() => {
    if (!selected?.id) return;
    onSelect?.(selected.id);
  }, [onSelect, selected]);

  useEffect(() => {
    if (!visible) return undefined;
    const handler = (event) => {
      if (event.key === 'Escape') {
        onClose?.();
      } else if (event.key === 'Enter') {
        handleConfirm();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [visible, onClose, handleConfirm]);

  useEffect(() => {
    if (!visible) return undefined;
    const clickHandler = (event) => {
      if (rootRef.current && !rootRef.current.contains(event.target)) {
        onClose?.();
      }
    };
    window.addEventListener('mousedown', clickHandler);
    return () => window.removeEventListener('mousedown', clickHandler);
  }, [visible, onClose]);

  if (!visible) return null;

  return (
    <div
      ref={rootRef}
      className="layout-picker-dropdown"
      style={{
        position: 'fixed',
        top: position?.top || 48,
        left: position?.left || 48,
      }}
    >
      <div className="config-panel layout-picker-panel" onClick={(e) => e.stopPropagation()}>
        <div className="config-header">
          <span className="config-title">New Tab Layout</span>
          <button className="config-close" onClick={onClose}>x</button>
        </div>
        <div className="config-body">
          <div className="field-group">
            <label className="field-label">Choose layout</label>
            <div className="layout-list">
              {sorted.map((layout) => (
                <button
                  key={layout.id}
                  className={`layout-list-item${layout.id === selected?.id ? ' active' : ''}`}
                  onClick={() => setSelectedId(layout.id)}
                  title={layout.name}
                >
                  <span>{layout.name}</span>
                  <span className="layout-list-meta">
                    {(layout.terminals || []).length} term
                    {(layout.terminals || []).length === 1 ? '' : 's'}
                  </span>
                </button>
              ))}
            </div>
            <div className="field-hint">Enter to open tab, Esc to close</div>
          </div>
        </div>
        <div className="config-footer">
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={handleConfirm}>Open Tab</button>
        </div>
      </div>
    </div>
  );
}
