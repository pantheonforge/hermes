# Terminals

## Overview

Each terminal pane maps to one PTY session managed by `node-pty` and rendered with `xterm.js`.

## IDs and scope

- Terminal IDs are globally unique (`term-<n>`) across all tabs.
- Pane operations apply to the active tab.
- Terminal manager can act on terminals from any tab.

## PTY IPC

| Channel | Direction | Args | Description |
|---|---|---|---|
| `pty:create` | renderer -> main (invoke) | `(id, options)` | Spawn PTY |
| `pty:input` | renderer -> main (send) | `(id, data)` | Write to PTY |
| `pty:resize` | renderer -> main (send) | `(id, cols, rows)` | Resize PTY |
| `pty:kill` | renderer -> main (send) | `(id)` | Kill PTY |
| `pty:output` | main -> renderer (on) | `(id, data)` | PTY output |
| `pty:exit` | main -> renderer (on) | `(id, code)` | PTY exit event |
| `pty:cwd` | main -> renderer (on) | `(id, cwd)` | CWD update |

## Resize behavior

`Terminal.jsx` uses `ResizeObserver` and `FitAddon` to keep xterm and PTY rows/cols in sync during pane drag, panel toggles, and window resize.

## Lifecycle

PTY sessions are killed when:
1. A pane is closed.
2. A tab is closed (all terminals in that tab).
3. App quits (`before-quit` / `window-all-closed`).

## Claude launch

`Ctrl/Cmd+Enter` launches configured `claudeCmd` in focused terminal with `--mcp-config` when available.
