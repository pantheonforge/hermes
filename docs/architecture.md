# Architecture

## Process model

- Main process (`src/main/index.js`): window lifecycle, keyboard shortcuts, PTY/clipboard/config/workspace/MCP IPC handlers, app menu. Delegates domain IPC to module files below.
- `src/main/ipc-git.js`: git IPC handlers (`GIT_STATUS` … `GIT_SHOW`). No shared-state deps.
- `src/main/ipc-sessions.js`: session-ref CRUD (`SESSION_LIST` … `SESSION_RENAME`) + ranking helpers.
- `src/main/ipc-files.js`: file read/write, explorer, agent memory, prompt drafts, artifacts, backup, context surgeon handlers.
- `src/main/ipc-memory.js`: memory index IPC (`MEMORY_GET_SNAPSHOT` … `MEMORY_SEMANTIC_SEARCH`).
- `src/main/ipc-voice.js`: `VOICE_TRANSCRIBE` with lazy Whisper pipeline.
- `src/main/config-helpers.js`: layout normalization and `readNormalizedConfig` — used by both `index.js` and `ipc-files.js`.
- MCP server (`src/main/mcp-server.js`): HTTP + SSE and in-memory shared state.
- Memory index service (`src/main/memory-index-service.js`): project scan/chunk/embed and persistent `memory.db`.
- PTY manager (`src/main/pty-manager.js`): shell process lifecycle and PTY I/O.
- Renderer (`src/renderer/App.jsx` + hooks + components): tabbed terminal UI, monitor (Feed/Artifacts), session manager, terminal manager.

## Renderer layout

- Left icon rail: compact icon actions (new tab, monitor, memory map, live deps, sub-agent tree, session manager, manager, settings, help).
- Top tab strip: workspace tabs for pane trees.
- Center workspace: active tab terminal grid plus optional left side-panels (monitor, memory map, live deps, sub-agent tree, sessions, terminal manager).
- Footer: shortcut hints.

## Terminal state model

- App keeps a `tabs[]` array with:
  - `id`
  - `title`
  - `paneTree`
  - `focusedPaneId`
- `activeTabId` selects which tab receives pane/terminal actions.
- `nextTermId` is global to keep PTY IDs unique across tabs.
- Tabs are session-only and initialized with one tab from startup layout.

## Session references

- Stored in `electron-store` as `sessionRefs` in the main process.
- Each reference tracks command, cwd, tool (`claude`/`codex`/`other`), fingerprint, pinned state, use count, and timestamps.
- Upsert deduplicates by fingerprint (`tool|cwd|command`) and updates recency/frequency.
- Renderer Session Manager consumes ranked refs and can run one directly in the focused terminal.

## Artifact collector

- MCP server stores submitted artifacts in memory (`artifacts[]`) for the running app session.
- `submit_artifact` broadcasts a dedicated SSE `artifact` event and snapshot includes current `artifacts`.
- MCP Monitor provides an `Artifacts` tab with list actions (preview/copy/save) and unread badge state.
- MCP Monitor provides a `Diff Timeline` tab fed by `report_tool_call` write/edit telemetry with reasoning and line-level additions/removals.

## Memory map and agent telemetry

- `memory.sqlite` (SQLite, WAL mode) is stored in userData and persists the semantic index between sessions. A first-run migration converts the old `memory.db` JSON blob automatically.
- Memory indexing runs only when explicitly triggered by the user from the Memory Map pane.
- A persistent `Worker` thread (`src/main/embed-worker.js`) loads the fastembed ONNX model once at startup and handles all embedding requests (scan + query) via a message queue, eliminating the per-query 2-5 s model reload cost of the old worker-per-call design.
- If the embedding model fails to load, semantic search is disabled and the UI shows a clear error rather than returning noise from the old hash-based fallback.
- Gitignore handling uses the `ignore` package and recurses into all subdirectories to collect nested `.gitignore` files. The `.git/` directory is always excluded unconditionally.
- MCP event stream ingestion: `post_message`, `submit_artifact`, and `append_agent_activity` payloads are batch-embedded (2 s debounce) and stored in the `mcp_events` table with a 30-day retention policy. This makes cross-session agent activity semantically searchable.
- Agents can query the index directly via the `semantic_search` MCP tool (scoped to `code`, `events`, or `all`), rate-limited to 5 requests per 10 s per agent.
- MCP telemetry tools (`report_tool_call`, `upsert_agent_node`, `append_agent_activity`) feed Live Dependency Graph and Sub-Agent Spawning panels.
- Cross-panel link: selecting a file in live deps highlights the same file node in Codebase Memory Map and tracks `last touched by` agent badges.

### Memory subsystem files

| File | Role |
|---|---|
| `src/main/embed-worker.js` | Long-lived Worker thread; loads fastembed once, handles all embed requests |
| `src/main/memory-db.js` | `better-sqlite3` wrapper — schema, incremental upserts, vector blob I/O |
| `src/main/memory-utils.js` | Shared helpers: chunking, import parsing, file walking, gitignore via `ignore` pkg |
| `src/main/memory-index-service.js` | Orchestrates scan, query, and MCP event ingestion; owns the embed worker |

## Action flow

- Keyboard/menu/rail action -> main process `send(IPC.*)` (or renderer-local action) -> preload `onAction` -> `useAppActions` hook dispatch.
- Pane actions (`split`, `close`, `next`, `prev`) operate on active tab.
- Terminal manager actions can target terminals in any tab and will switch tab when focusing.
- Inline editor action opens a modal bound to the focused pane and sends draft text through existing terminal `runCommand` wiring.

## Renderer hooks

- `src/renderer/useAppActions.js`: wraps the `window.electron.onAction` dispatcher. Receives all action callbacks and state setters as params; the `useEffect` with the full channel switch-case lives here.
- `src/renderer/useSidePanels.js`: owns sidebar visibility state (`activeSidebar`, `gitOpen`, `codeViewerFile`, `railExpanded`, `paletteOpen`) and exposes a `toggleSidebar(name)` helper.
- `src/renderer/app-utils.js`: pure utility functions and constants — layout helpers (`sanitizeLayout`, `pickLayout`, `buildPaneTreeFromTerminals`), pane-tree ops (`updateLeafCwd`, `sanitizePaneTree`), tool detection (`detectTool`), session labeling, command building, prompt-draft helpers, and storage key constants.

## IPC constants

Defined once in `src/shared/constants.js` (exported as `IPC`). The preload exposes the full object to the renderer as `window.electron.IPC`, so `App.jsx` and all renderer code use `window.electron.IPC.*` — no local redeclaration.

## Key components

- `TerminalGrid.jsx`: computes layout from pane tree and renders resizable splits.
- `Terminal.jsx`: xterm + PTY wiring, launch/restart behavior.
- `MCPMonitor.jsx`: live SSE data panel.
- `TerminalManager.jsx`: grouped terminal list across all tabs with focus/restart/close controls.
