import React, { useState, useEffect, useRef, useCallback } from 'react';

export default function CommandPalette({ open, onClose, commands }) {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef(null);
  const listRef = useRef(null);
  const itemRefs = useRef([]);

  const filtered = (commands || []).filter((cmd) =>
    cmd.label.toLowerCase().includes(query.toLowerCase())
  );

  useEffect(() => {
    if (open) {
      setQuery('');
      setSelectedIndex(0);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  useEffect(() => {
    const el = itemRefs.current[selectedIndex];
    if (el) el.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

  const invoke = useCallback((cmd) => {
    cmd.action();
    onClose();
  }, [onClose]);

  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Escape') { onClose(); return; }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((i) => Math.min(i + 1, filtered.length - 1));
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((i) => Math.max(i - 1, 0));
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      const cmd = filtered[selectedIndex];
      if (cmd) invoke(cmd);
    }
  }, [filtered, invoke, onClose, selectedIndex]);

  if (!open) return null;

  let lastGroup = null;
  const items = [];
  filtered.forEach((cmd, idx) => {
    if (cmd.group !== lastGroup) {
      lastGroup = cmd.group;
      items.push(<div key={`g-${cmd.group}`} className="palette-group-label">{cmd.group}</div>);
    }
    items.push(
      <div
        key={cmd.label}
        ref={(el) => { itemRefs.current[idx] = el; }}
        className={`palette-item${idx === selectedIndex ? ' palette-item-selected' : ''}`}
        onMouseDown={(e) => { e.preventDefault(); invoke(cmd); }}
        onMouseEnter={() => setSelectedIndex(idx)}
      >
        <span>{cmd.label}</span>
        {cmd.shortcut && <span className="palette-shortcut">{cmd.shortcut}</span>}
      </div>
    );
  });

  return (
    <div className="palette-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="palette-box">
        <input
          ref={inputRef}
          className="palette-input"
          placeholder="Search commands…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
        />
        <div ref={listRef} className="palette-list">
          {items.length === 0
            ? <div className="palette-group-label">No commands found</div>
            : items
          }
        </div>
      </div>
    </div>
  );
}
