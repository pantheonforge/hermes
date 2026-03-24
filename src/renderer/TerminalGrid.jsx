import React, { useRef, useEffect, useCallback, useMemo } from 'react';
import Terminal from './Terminal';

const MIN_RATIO = 0.15;
const MAX_RATIO = 0.85;

export function collectLeafIds(node) {
  if (node.type === 'leaf') return [node.id];
  return [...collectLeafIds(node.a), ...collectLeafIds(node.b)];
}

export function collectLeaves(node) {
  if (node.type === 'leaf') return [node];
  return [...collectLeaves(node.a), ...collectLeaves(node.b)];
}

export function replaceNode(tree, targetId, replacement) {
  if (tree.type === 'leaf') return tree.id === targetId ? replacement : tree;
  return { ...tree, a: replaceNode(tree.a, targetId, replacement), b: replaceNode(tree.b, targetId, replacement) };
}

export function removeLeaf(tree, targetId) {
  if (tree.type === 'leaf') return tree;
  if (tree.a.type === 'leaf' && tree.a.id === targetId) return tree.b;
  if (tree.b.type === 'leaf' && tree.b.id === targetId) return tree.a;
  return { ...tree, a: removeLeaf(tree.a, targetId), b: removeLeaf(tree.b, targetId) };
}

export function findLeaf(node, id) {
  if (node.type === 'leaf') return node.id === id ? node : null;
  return findLeaf(node.a, id) || findLeaf(node.b, id);
}

function clampRatio(value) {
  return Math.max(MIN_RATIO, Math.min(MAX_RATIO, value));
}

function updateSplitRatio(node, path, ratio) {
  if (node.type !== 'split') return node;
  if (path.length === 0) return { ...node, ratio: clampRatio(ratio) };
  const [head, ...rest] = path;
  return { ...node, [head]: updateSplitRatio(node[head], rest, ratio) };
}

function computeLayout(node, x, y, w, h, path = []) {
  if (node.type === 'leaf') return { panes: { [node.id]: { left: x, top: y, width: w, height: h } }, dividers: [] };
  const ratio = clampRatio(node.ratio ?? 0.5);
  if (node.dir === 'v') {
    const splitWidth = w * ratio;
    const left = computeLayout(node.a, x, y, splitWidth, h, [...path, 'a']);
    const right = computeLayout(node.b, x + splitWidth, y, w - splitWidth, h, [...path, 'b']);
    return {
      panes: { ...left.panes, ...right.panes },
      dividers: [
        ...left.dividers,
        ...right.dividers,
        {
          id: path.length === 0 ? 'root' : path.join('.'),
          path,
          dir: 'v',
          ratio,
          pos: x + splitWidth,
          crossStart: y,
          crossSize: h,
          splitSize: w,
        },
      ],
    };
  }
  const splitHeight = h * ratio;
  const top = computeLayout(node.a, x, y, w, splitHeight, [...path, 'a']);
  const bottom = computeLayout(node.b, x, y + splitHeight, w, h - splitHeight, [...path, 'b']);
  return {
    panes: { ...top.panes, ...bottom.panes },
    dividers: [
      ...top.dividers,
      ...bottom.dividers,
      {
        id: path.length === 0 ? 'root' : path.join('.'),
        path,
        dir: 'h',
        ratio,
        pos: y + splitHeight,
        crossStart: x,
        crossSize: w,
        splitSize: h,
      },
    ],
  };
}

export default function TerminalGrid({
  paneTree,
  focusedPaneId,
  voiceState,
  onFocus,
  onResizeTree,
  onPaneCwd,
  config,
  terminalSummaries,
  onSummarizeOutput,
  onClearSummary,
  actionsRef,
}) {
  const containerRef = useRef(null);
  const termRefs = useRef(new Map());
  const dragRef = useRef(null);
  const leaves = collectLeaves(paneTree);
  const { panes, dividers } = useMemo(() => computeLayout(paneTree, 0, 0, 100, 100), [paneTree]);

  useEffect(() => {
    const ids = leaves.map((l) => l.id);
    if (new Set(ids).size !== ids.length) {
      console.warn('[hermes] duplicate terminal ids detected in paneTree', ids);
    }
  }, [leaves]);

  const focus = useCallback((id) => {
    termRefs.current.get(id)?.focus();
  }, []);

  const launchClaude = useCallback(() => {
    termRefs.current.get(focusedPaneId)?.launchClaude();
  }, [focusedPaneId]);

  const launchCodex = useCallback(() => {
    termRefs.current.get(focusedPaneId)?.launchCodex();
  }, [focusedPaneId]);

  const clear = useCallback(() => {
    termRefs.current.get(focusedPaneId)?.clear();
  }, [focusedPaneId]);

  const restartClaude = useCallback(() => {
    termRefs.current.get(focusedPaneId)?.restartClaude();
  }, [focusedPaneId]);

  const restartCodex = useCallback(() => {
    termRefs.current.get(focusedPaneId)?.restartCodex();
  }, [focusedPaneId]);

  const restartShell = useCallback((id) => {
    termRefs.current.get(id)?.restartShell();
  }, []);

  const runCommand = useCallback((id, command) => {
    termRefs.current.get(id)?.runCommand(command);
  }, []);

  useEffect(() => {
    actionsRef.current = {
      focus,
      launchClaude,
      launchCodex,
      clear,
      restartClaude,
      restartCodex,
      restartShell,
      runCommand,
    };
  }, [focus, launchClaude, launchCodex, clear, restartClaude, restartCodex, restartShell, runCommand, actionsRef]);

  const stopDrag = useCallback(() => {
    const drag = dragRef.current;
    if (!drag) return;
    window.removeEventListener('mousemove', drag.onMove);
    window.removeEventListener('mouseup', drag.onUp);
    dragRef.current = null;
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  }, []);

  const onMouseMove = useCallback((e) => {
    const drag = dragRef.current;
    if (!drag) return;
    const delta = drag.dir === 'v' ? (e.clientX - drag.startPos) : (e.clientY - drag.startPos);
    const ratio = clampRatio(drag.startRatio + (delta / drag.splitSizePx));
    onResizeTree((prev) => updateSplitRatio(prev, drag.path, ratio));
  }, [onResizeTree]);

  const onMouseUp = useCallback(() => {
    stopDrag();
  }, [stopDrag]);

  useEffect(() => () => stopDrag(), [stopDrag]);

  const startDrag = useCallback((divider, event) => {
    if (!containerRef.current) return;
    event.preventDefault();
    event.stopPropagation();
    const rect = containerRef.current.getBoundingClientRect();
    const splitSizePx = divider.splitSize * ((divider.dir === 'v' ? rect.width : rect.height) / 100);
    const onMove = (e) => onMouseMove(e);
    const onUp = () => onMouseUp();
    dragRef.current = {
      path: divider.path,
      dir: divider.dir,
      startRatio: divider.ratio,
      startPos: divider.dir === 'v' ? event.clientX : event.clientY,
      splitSizePx: Math.max(1, splitSizePx),
      onMove,
      onUp,
    };
    document.body.style.cursor = divider.dir === 'v' ? 'col-resize' : 'row-resize';
    document.body.style.userSelect = 'none';
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [onMouseMove, onMouseUp]);

  return (
    <div className="terminal-grid" ref={containerRef}>
      {leaves.map(({ id, cwd, startupCommand }) => {
        const b = panes[id];
        return (
          <div
            key={id}
            style={{
              position: 'absolute',
              left: `${b.left}%`,
              top: `${b.top}%`,
              width: `${b.width}%`,
              height: `${b.height}%`,
            }}
          >
            <Terminal
              id={id}
              config={config}
              cwd={cwd}
              startupCommand={startupCommand}
              focused={focusedPaneId === id}
              onFocus={() => onFocus(id)}
              onCwd={(nextCwd) => onPaneCwd?.(id, nextCwd)}
              summaryState={terminalSummaries?.[id] || null}
              onSummarizeOutput={onSummarizeOutput}
              onClearSummary={onClearSummary}
              ref={(el) => {
                if (el) termRefs.current.set(id, el);
                else termRefs.current.delete(id);
              }}
            />
            {voiceState && focusedPaneId === id && (
              <div className={`pane-recording-badge pane-recording-badge--${voiceState}`}>
                <span className="voice-dot" />
                {voiceState === 'recording' ? 'Recording…' : voiceState === 'processing' ? 'Processing…' : 'Injecting…'}
              </div>
            )}
          </div>
        );
      })}
      {dividers.map((divider) => (
        <div
          key={divider.id}
          className={`pane-divider ${divider.dir === 'v' ? 'vertical' : 'horizontal'}`}
          style={divider.dir === 'v'
            ? {
              position: 'absolute',
              left: `${divider.pos}%`,
              top: `${divider.crossStart}%`,
              height: `${divider.crossSize}%`,
              width: '8px',
              transform: 'translateX(-4px)',
            }
            : {
              position: 'absolute',
              top: `${divider.pos}%`,
              left: `${divider.crossStart}%`,
              width: `${divider.crossSize}%`,
              height: '8px',
              transform: 'translateY(-4px)',
            }}
          onMouseDown={(e) => startDrag(divider, e)}
        />
      ))}
    </div>
  );
}
