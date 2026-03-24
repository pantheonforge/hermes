import React, { useEffect } from 'react';

const SHORTCUTS = [
  {
    category: 'Panes',
    items: [
      ['Ctrl+Shift+D', 'Split pane vertically (side by side)'],
      ['Ctrl+Shift+E', 'Split pane horizontally (stacked)'],
      ['Ctrl+W', 'Close focused pane'],
      ['Ctrl+Shift+N', 'Focus next pane'],
      ['Ctrl+Shift+P', 'Focus previous pane'],
      ['Ctrl+1', 'Focus pane 1'],
      ['Ctrl+2', 'Focus pane 2'],
    ],
  },
  {
    category: 'Terminal',
    items: [
      ['Ctrl+Enter', 'Launch Claude Code in focused terminal'],
      ['Ctrl+Shift+Enter', 'Launch OpenAI Codex in focused terminal'],
      ['Tab', 'Accept predictive hint in focused terminal (when shown)'],
      ['Ctrl+Shift+I', 'Open inline editor for focused terminal'],
      ['Ctrl+C', 'Copy selected text from focused terminal (otherwise sends interrupt)'],
      ['Ctrl+V', 'Paste clipboard text into focused terminal'],
      ['Ctrl+Shift+K', 'Clear focused terminal'],
      ['Ctrl+Alt+R', 'Restart Claude Code in focused terminal'],
      ['Ctrl+Alt+Shift+R', 'Restart OpenAI Codex in focused terminal'],
    ],
  },
  {
    category: 'MCP',
    items: [
      ['Ctrl+Alt+B', 'Toggle MCP monitor panel'],
      ['Ctrl+Alt+T', 'Toggle terminal manager sidebar'],
      ['Ctrl+Alt+Y', 'Toggle session manager sidebar'],
      ['Ctrl+Alt+M', 'Toggle codebase memory map panel'],
      ['Ctrl+Shift+F', 'Toggle semantic search panel'],
      ['Ctrl+Alt+G', 'Toggle live dependency graph panel'],
      ['Ctrl+Alt+J', 'Toggle sub-agent panel'],
      ['Ctrl+Alt+S', 'Copy shared state JSON to clipboard'],
    ],
  },
  {
    category: 'Voice',
    items: [
      ['Ctrl+Space (hold)', 'Record voice input — transcript is typed into focused terminal on release'],
    ],
  },
  {
    category: 'App',
    items: [
      ['Ctrl+Shift+W', 'Close all side panels and code viewer'],
      ['Ctrl+T', 'Open a new tab'],
      ['Ctrl+,', 'Open settings'],
      ['Ctrl+Alt+P', 'Open command palette'],
      ['F1 or Ctrl+/', 'Show keyboard shortcuts'],
    ],
  },
];

export default function HelpModal({ onClose }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="config-overlay" onClick={onClose}>
      <div className="config-panel help-panel" onClick={(e) => e.stopPropagation()}>
        <div className="config-header">
          <span className="config-title">Keyboard Shortcuts</span>
          <button className="config-close" onClick={onClose}>x</button>
        </div>
        <div className="config-body">
          {SHORTCUTS.map(({ category, items }) => (
            <div key={category} className="help-section">
              <div className="help-category">{category}</div>
              <table className="help-table">
                <tbody>
                  {items.map(([keys, desc]) => (
                    <tr key={keys}>
                      <td><kbd className="help-kbd">{keys}</kbd></td>
                      <td className="help-desc">{desc}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
