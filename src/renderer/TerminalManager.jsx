import React from 'react';
import { collectLeafIds } from './TerminalGrid';

function TerminalRow({ tab, terminalId, isFocused, onFocusTerminal, onRestartTerminal, onCloseTerminal }) {
  return (
    <div className={`manager-row${isFocused ? ' focused' : ''}`}>
      <button className="manager-term-btn" onClick={() => onFocusTerminal(tab.id, terminalId)} title="Focus terminal">
        {terminalId}
      </button>
      <div className="manager-row-actions">
        <button className="manager-icon-btn" onClick={() => onRestartTerminal(tab.id, terminalId)} title="Restart terminal">R</button>
        <button className="manager-icon-btn danger" onClick={() => onCloseTerminal(tab.id, terminalId)} title="Close terminal">X</button>
      </div>
    </div>
  );
}

export default function TerminalManager({
  visible,
  tabs,
  activeTabId,
  onFocusTerminal,
  onRestartTerminal,
  onCloseTerminal,
  onHide,
  onFocus,
}) {
  if (!visible) return <div className="manager-sidebar hidden" />;

  return (
    <div className="manager-sidebar" onClick={onFocus}>
      <div className="manager-header">
        <span className="manager-title">Terminals</span>
        <button className="manager-hide-btn" onClick={(e) => { e.stopPropagation(); onHide?.(); }} title="Hide terminal manager">‹</button>
      </div>
      <div className="manager-body">
        {tabs.map((tab) => {
          const terminalIds = collectLeafIds(tab.paneTree);
          return (
            <div key={tab.id} className="manager-group">
              <div className={`manager-group-title${tab.id === activeTabId ? ' active' : ''}`}>{tab.title}</div>
              {terminalIds.map((terminalId) => (
                <TerminalRow
                  key={terminalId}
                  tab={tab}
                  terminalId={terminalId}
                  isFocused={tab.id === activeTabId && tab.focusedPaneId === terminalId}
                  onFocusTerminal={onFocusTerminal}
                  onRestartTerminal={onRestartTerminal}
                  onCloseTerminal={onCloseTerminal}
                />
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
