import React, { useMemo, useState } from 'react';

export default function ConfigPage({ config, onSave, onClose, onManageLayouts }) {
  const [form, setForm] = useState({
    shell: config.shell || '',
    claudeCmd: config.claudeCmd || 'claude',
    codexCmd: config.codexCmd || 'codex',
    cwd: config.cwd || '',
    mcpPort: String(config.mcpPort || 2337),
    fontSize: String(config.fontSize || 13),
    fontFamily: config.fontFamily || '',
    theme: config.theme || 'dark',
    agentLabels: [...(config.agentLabels || ['Agent 1', 'Agent 2', 'Agent 3', 'Agent 4'])],
    memoryProjectPath: config.memoryProjectPath || config.cwd || '',
    promptDraftsFolder: config.promptDraftsFolder || '',
    usagePollingEnabled: config.usagePollingEnabled ?? false,
  });

  const defaultLayoutName = useMemo(() => {
    const layouts = Array.isArray(config.layouts) ? config.layouts : [];
    const match = layouts.find((layout) => layout.id === config.defaultLayoutId);
    return match?.name || layouts[0]?.name || 'Default';
  }, [config.layouts, config.defaultLayoutId]);

  const set = (key, value) => setForm((prev) => ({ ...prev, [key]: value }));
  const setLabel = (i, v) =>
    setForm((prev) => {
      const labels = [...prev.agentLabels];
      labels[i] = v;
      return { ...prev, agentLabels: labels };
    });

  const handleSave = () => {
    onSave({
      shell: form.shell,
      claudeCmd: form.claudeCmd,
      codexCmd: form.codexCmd,
      cwd: form.cwd,
      mcpPort: parseInt(form.mcpPort, 10) || 2337,
      fontSize: parseInt(form.fontSize, 10) || 13,
      fontFamily: form.fontFamily,
      theme: form.theme,
      agentLabels: form.agentLabels,
      memoryProjectPath: form.memoryProjectPath,
      promptDraftsFolder: form.promptDraftsFolder,
      usagePollingEnabled: form.usagePollingEnabled,
    });
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Escape') onClose();
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleSave();
  };

  return (
    <div className="config-overlay" onClick={onClose} onKeyDown={handleKeyDown}>
      <div className="config-panel" onClick={(e) => e.stopPropagation()}>
        <div className="config-header">
          <span className="config-title">Settings</span>
          <button className="config-close" onClick={onClose}>x</button>
        </div>

        <div className="config-body">
          <div className="field-group">
            <label className="field-label">Shell</label>
            <input
              className="field-input"
              value={form.shell}
              onChange={(e) => set('shell', e.target.value)}
              placeholder="powershell.exe / /bin/zsh"
            />
            <div className="field-hint">Requires app restart to take effect</div>
          </div>

          <div className="field-group">
            <label className="field-label">Claude Code command</label>
            <input
              className="field-input"
              value={form.claudeCmd}
              onChange={(e) => set('claudeCmd', e.target.value)}
              placeholder="claude"
            />
          </div>

          <div className="field-group">
            <label className="field-label">OpenAI Codex command</label>
            <input
              className="field-input"
              value={form.codexCmd}
              onChange={(e) => set('codexCmd', e.target.value)}
              placeholder="codex"
            />
          </div>

          <div className="field-group">
            <label className="field-label">Default working directory</label>
            <input
              className="field-input"
              value={form.cwd}
              onChange={(e) => set('cwd', e.target.value)}
              placeholder="~/projects"
            />
          </div>

          <div className="field-group">
            <label className="field-label">Memory map project path</label>
            <input
              className="field-input"
              value={form.memoryProjectPath}
              onChange={(e) => set('memoryProjectPath', e.target.value)}
              placeholder="Path indexed into memory.db"
            />
            <div className="field-hint">Only scanned when you explicitly trigger Scan from the Memory Map panel.</div>
          </div>

          <div className="field-row">
            <div className="field-group">
              <label className="field-label">MCP server port</label>
              <input
                className="field-input"
                type="number"
                value={form.mcpPort}
                onChange={(e) => set('mcpPort', e.target.value)}
              />
              <div className="field-hint">Requires restart</div>
            </div>
            <div className="field-group">
              <label className="field-label">Font size</label>
              <input
                className="field-input"
                type="number"
                value={form.fontSize}
                onChange={(e) => set('fontSize', e.target.value)}
                min="8"
                max="24"
              />
            </div>
          </div>

          <div className="field-group">
            <label className="field-label">Font family</label>
            <input
              className="field-input"
              value={form.fontFamily}
              onChange={(e) => set('fontFamily', e.target.value)}
              placeholder="Cascadia Code, monospace"
            />
          </div>

          <div className="field-group">
            <label className="field-label">Prompt Drafts Folder</label>
            <input
              className="field-input"
              value={form.promptDraftsFolder}
              onChange={(e) => set('promptDraftsFolder', e.target.value)}
              placeholder="C:\\prompts\\drafts"
            />
            <div className="field-hint">Optional. Saves drafts as markdown files when set.</div>
          </div>

          <div className="field-group">
            <label className="field-label">Layouts</label>
            <div className="field-hint">Default on startup: {defaultLayoutName}</div>
            <button className="btn" onClick={onManageLayouts}>Manage Layouts</button>
          </div>

          <div className="field-group">
            <label className="field-label">Agent labels</label>
            <div className="field-row" style={{ gridTemplateColumns: '1fr 1fr' }}>
              {form.agentLabels.map((lbl, i) => (
                <input
                  key={i}
                  className="field-input"
                  value={lbl}
                  onChange={(e) => setLabel(i, e.target.value)}
                  placeholder={`Agent ${i + 1}`}
                />
              ))}
            </div>
            <div className="field-hint">Labels for terminals 1-4</div>
          </div>

          <div className="field-group" style={{ borderTop: '1px solid var(--border)', paddingTop: 12 }}>
            <label className="field-label">Claude usage bar</label>
            <div style={{
              background: 'rgba(255, 180, 0, 0.08)',
              border: '1px solid rgba(255, 180, 0, 0.35)',
              borderRadius: 4,
              padding: '8px 10px',
              marginBottom: 8,
              fontSize: 11,
              color: 'var(--text-dim)',
              lineHeight: 1.5,
            }}>
              <strong style={{ color: 'rgba(255,180,0,0.9)' }}>Privacy notice:</strong> When enabled, Hermes reads your Claude OAuth
              token from <code style={{ fontSize: 10 }}>~/.claude/.credentials.json</code> and polls
              the Anthropic usage API every 5 minutes to display the session usage bar in the footer.
              No data is stored or shared beyond the API call. Disabled by default.
            </div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 12 }}>
              <input
                type="checkbox"
                checked={form.usagePollingEnabled}
                onChange={(e) => set('usagePollingEnabled', e.target.checked)}
              />
              Enable Claude usage polling
            </label>
          </div>
        </div>

        <div className="config-footer">
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={handleSave}>Save</button>
        </div>
      </div>
    </div>
  );
}
