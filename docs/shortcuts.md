# Keyboard Shortcuts

Shortcuts are handled in the main process keybinding handler. On macOS, menu accelerators are also exposed in the app menu.

On macOS, use `Cmd` instead of `Ctrl` for `CmdOrCtrl` bindings.

## Panes

| Shortcut | Action |
|---|---|
| `Ctrl+Shift+D` | Split focused pane vertically |
| `Ctrl+Shift+E` | Split focused pane horizontally |
| `Ctrl+W` | Close focused pane (no-op if last pane in tab) |
| `Ctrl+Shift+N` | Focus next pane |
| `Ctrl+Shift+P` | Focus previous pane |
| `Ctrl+1` | Focus pane 1 |
| `Ctrl+2` | Focus pane 2 |

## Terminal

| Shortcut | Action |
|---|---|
| `Ctrl+Enter` | Launch Claude Code in focused terminal |
| `Ctrl+Shift+Enter` | Launch OpenAI Codex in focused terminal |
| `Tab` | Accept predictive hint in focused terminal (when shown) |
| `Ctrl+Shift+I` | Open inline editor for focused terminal input |
| `Ctrl+Shift+K` | Clear focused terminal |
| `Ctrl+Alt+R` | Restart Claude Code in focused terminal |
| `Ctrl+Alt+Shift+R` | Restart OpenAI Codex in focused terminal |
| `Ctrl+Space` | Start / stop voice recording (injects transcription on stop) |

## Panels and App

| Shortcut | Action |
|---|---|
| `Ctrl+Shift+W` | Close all side panels and code viewer |
| `Ctrl+Alt+B` | Toggle MCP monitor panel |
| `Ctrl+Alt+T` | Toggle terminal manager sidebar |
| `Ctrl+Alt+Y` | Toggle session manager sidebar |
| `Ctrl+Alt+M` | Toggle codebase memory map panel |
| `Ctrl+Shift+F` | Toggle semantic search panel |
| `Ctrl+Alt+G` | Toggle live dependency graph panel |
| `Ctrl+Alt+J` | Toggle sub-agent spawning panel |
| `Ctrl+Alt+S` | Copy shared state JSON to clipboard |
| `Ctrl+Alt+P` | Open command palette |
| `Ctrl+T` | Open a new terminal tab |
| `Ctrl+,` | Open settings |
| `F1` or `Ctrl+/` | Show keyboard shortcuts help |

## Notes

- Tabs are session-only: they are not restored after app restart.
- On Windows/Linux, the native menu bar is hidden; use shortcuts or left-rail buttons.
- Session references are persisted and ranked by recency/frequency (with pinning support) in Session Manager.
