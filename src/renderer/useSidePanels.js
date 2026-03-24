import { useState, useCallback } from 'react';

export function useSidePanels() {
  const [activeSidebar, _setActiveSidebar] = useState(null);
  const [gitOpen, _setGitOpen] = useState(false);
  const [codebaseOpen, _setCodebaseOpen] = useState(false);
  const [codeViewerFile, setCodeViewerFile] = useState(null);
  const [railExpanded, setRailExpanded] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);

  const setActiveSidebar = useCallback((updater) => {
    _setActiveSidebar(prev => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      if (next !== null) { _setGitOpen(false); _setCodebaseOpen(false); }
      return next;
    });
  }, []);

  const setGitOpen = useCallback((updater) => {
    _setGitOpen(prev => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      if (next) { _setCodebaseOpen(false); _setActiveSidebar(null); }
      return next;
    });
  }, []);

  const setCodebaseOpen = useCallback((updater) => {
    _setCodebaseOpen(prev => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      if (next) { _setGitOpen(false); _setActiveSidebar(null); }
      return next;
    });
  }, []);

  const toggleSidebar = useCallback((name) => {
    setActiveSidebar(v => v === name ? null : name);
  }, [setActiveSidebar]);

  return { activeSidebar, setActiveSidebar, gitOpen, setGitOpen, codebaseOpen, setCodebaseOpen, codeViewerFile, setCodeViewerFile, railExpanded, setRailExpanded, paletteOpen, setPaletteOpen, toggleSidebar };
}
