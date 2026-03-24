import React from 'react';

export default function ImportExportPanel({
  visible,
  busy,
  status,
  onHide,
  onFocus,
  onExport,
  onImport,
}) {
  if (!visible) return <div className="manager-sidebar hidden" />;

  return (
    <div className="manager-sidebar" onClick={onFocus}>
      <div className="manager-header">
        <span className="manager-title">Import / Export</span>
        <button className="manager-hide-btn" onClick={(e) => { e.stopPropagation(); onHide?.(); }} title="Hide panel">‹</button>
      </div>
      <div className="import-export-body">
        <div className="import-export-card">
          <div className="import-export-title">Export app backup</div>
          <div className="import-export-copy">Includes app settings, layouts, session refs, prompt templates, and prompt drafts.</div>
          <button className="btn-primary" onClick={onExport} disabled={busy}>Export</button>
        </div>
        <div className="import-export-card">
          <div className="import-export-title">Import backup (replace current)</div>
          <div className="import-export-copy">Replaces current app-local data with selected backup file.</div>
          <button className="btn" onClick={onImport} disabled={busy}>Import</button>
        </div>
        <div className="import-export-status">{status || 'No operation yet.'}</div>
      </div>
    </div>
  );
}
