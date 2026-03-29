import React, { useState, useEffect, useRef } from 'react';

const PINNED = [
  ['Ctrl+Enter', 'launch claude'],
  ['Ctrl+Shift+Enter', 'launch codex'],
  ['Ctrl+Shift+I', 'editor'],
];

const HINTS_TERMINAL = [
  ['Ctrl+Shift+K', 'clear'],
  ['Ctrl+Shift+D', 'split-v'],
  ['Ctrl+Shift+E', 'split-h'],
  ['Ctrl+W', 'close'],
  ['Ctrl+Shift+N', 'next pane'],
];

const HINTS_PANEL = [
  ['Ctrl+Alt+B', 'mcp'],
  ['Ctrl+Alt+T', 'manager'],
  ['Ctrl+Alt+Y', 'sessions'],
  ['Ctrl+Alt+M', 'memory'],
  ['Ctrl+Shift+F', 'search'],
  ['Ctrl+Alt+G', 'deps'],
  ['Ctrl+Alt+J', 'agents'],
];

const HINTS_GLOBAL = [
  ['Ctrl+T', 'new tab'],
  ['Ctrl+,', 'settings'],
  ['F1', 'help'],
];

function Hint({ keys, label }) {
  return (
    <span className="footer-hint">
      <kbd>{keys}</kbd>
      <span>{label}</span>
    </span>
  );
}

function HorizonLine() {
  const [usage, setUsage] = useState(null);
  const [hovered, setHovered] = useState(false);
  const barRef = useRef(null);

  useEffect(() => {
    if (!window.electron?.usage) return;
    window.electron.usage.get().then(setUsage).catch(() => {});
    const unsub = window.electron.usage.onUpdate((data) => setUsage(data));
    return unsub;
  }, []);

  const formatTime = (iso) => {
    if (!iso) return null;
    return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  if (usage?.loading) {
    return (
      <span
        ref={barRef}
        className="horizon-line horizon-line--loading"
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        {hovered && (
          <span className="horizon-tooltip">
            <span className="horizon-tooltip-row">
              <span>usage</span><span>loading…</span>
            </span>
          </span>
        )}
      </span>
    );
  }

  if (usage?.rateLimited) {
    return (
      <span
        ref={barRef}
        className="horizon-line horizon-line--error"
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        <span className="horizon-pct horizon-pct--error">429</span>
        <span className="horizon-fill" style={{ width: '100%' }} />
        {hovered && (
          <span className="horizon-tooltip">
            <span className="horizon-tooltip-row horizon-tooltip-error">
              <span>rate limited</span>
              <span>{usage.retryAt ? `retry ${formatTime(usage.retryAt)}` : '—'}</span>
            </span>
          </span>
        )}
      </span>
    );
  }

  if (!usage?.fiveHour) {
    return <span className="horizon-line horizon-line--inactive" />;
  }

  const pct = Math.min(usage.fiveHour.utilization / 100, 1);
  const pctDisplay = Math.round(usage.fiveHour.utilization);
  const over90 = pctDisplay >= 90;

  return (
    <span
      ref={barRef}
      className={`horizon-line${over90 ? ' horizon-line--alert' : ''}`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <span className="horizon-pct">{pctDisplay}%</span>
      <span className="horizon-fill" style={{ width: `${pct * 100}%` }} />
      {hovered && (
        <span className="horizon-tooltip">
          <span className="horizon-tooltip-row">
            <span>session (5h)</span>
            <span>
              {pctDisplay}%
              {usage.fiveHour.resetsAt ? ` · resets ${formatTime(usage.fiveHour.resetsAt)}` : ''}
            </span>
          </span>
          <span className="horizon-tooltip-row">
            <span>7-day</span><span>{Math.round(usage.sevenDay.utilization)}%</span>
          </span>
          {usage.fetchedAt && (
            <span className="horizon-tooltip-row horizon-tooltip-fetched">
              <span>updated</span>
              <span>{new Date(usage.fetchedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
            </span>
          )}
          {usage.extraUsage?.isEnabled && (
            <span className="horizon-tooltip-row horizon-tooltip-total">
              <span>extra</span>
              <span>${(usage.extraUsage.usedCredits / 100).toFixed(2)} / ${(usage.extraUsage.monthlyLimit / 100).toFixed(2)}</span>
            </span>
          )}
        </span>
      )}
    </span>
  );
}

export default function Footer({ context, port, recentKeys = [] }) {
  const pinnedKeys = new Set(PINNED.map(([k]) => k));
  const contextPool = [...(context === 'terminal' ? HINTS_TERMINAL : HINTS_PANEL), ...HINTS_GLOBAL];
  const available = contextPool.filter(([k]) => !pinnedKeys.has(k));

  const recentSet = new Set(recentKeys);
  const sorted = [
    ...available.filter(([k]) => !recentSet.has(k)),
    ...available.filter(([k]) => recentSet.has(k)),
  ];

  const shown = [...PINNED, ...sorted.slice(0, 5)];

  return (
    <div className="footer">
      {shown.map(([keys, label]) => (
        <Hint key={keys} keys={keys} label={label} />
      ))}
      <HorizonLine />
    </div>
  );
}
