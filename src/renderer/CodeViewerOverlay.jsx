import React, { useMemo, useRef, useEffect } from 'react';
import { getHighlighted } from './fileHighlight';
import 'highlight.js/styles/atom-one-dark.css';

export default function CodeViewerOverlay({ file, onClose }) {
  const containerRef = useRef(null);

  const { html, language, lines } = useMemo(() => {
    if (!file) return { html: '', language: 'plain', lines: [] };
    const { html: h, language: l } = getHighlighted(file.content, file.path);
    return { html: h, language: l, lines: (file.content.match(/\n/g) || []).length + 1 };
  }, [file]);

  // Scroll to top when file changes
  useEffect(() => {
    if (containerRef.current) containerRef.current.scrollTop = 0;
  }, [file?.path]);

  if (!file) return null;

  const shortName = file.path.split(/[\\/]/).pop();

  return (
    <div className="cv-overlay">
      <div className="cv-header">
        <span className="cv-filename" title={file.path}>{shortName}</span>
        <span className="cv-filepath" title={file.path}>{file.path}</span>
        <span className="cv-lang">{language}</span>
        <button className="manager-hide-btn" onClick={onClose} title="Close viewer">‹</button>
      </div>
      <div className="cv-body" ref={containerRef}>
        <div className="cv-gutter">
          {Array.from({ length: lines }, (_, i) => (
            <div key={i + 1} className="cv-line-num">{i + 1}</div>
          ))}
        </div>
        <pre
          className="cv-code hljs"
          dangerouslySetInnerHTML={{ __html: html }}
        />
      </div>
    </div>
  );
}
