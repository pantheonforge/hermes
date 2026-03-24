# Development

## Prerequisites

- **Node.js 18+**
- **Windows:** [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) with "Desktop development with C++" (required for node-pty native compilation)
- **macOS:** Xcode Command Line Tools (`xcode-select --install`)
- **Linux:** `build-essential`, `python3`

## Install

```bash
npm install
```

`postinstall` automatically runs `@electron/rebuild` to compile node-pty for the installed Electron version. If it fails due to missing build tools, fix the toolchain and run:

```bash
npm run rebuild
```

## Dev

```bash
npm run dev
```

Starts two processes concurrently:
1. **Vite dev server** on `http://localhost:5173` — HMR for renderer
2. **Electron** with `NODE_ENV=development` — loads from Vite dev server with a retry loop

DevTools can be opened via **Help → Open Dev Tools** in the menu.

## Build (production)

```bash
npm run build
```

Bundles the renderer to `dist/renderer/`.

To package executables/installers:

```bash
npm run dist          # current platform
npm run dist:win      # Windows installer (NSIS)
npm run dist:win-portable  # Windows portable exe
npm run dist:mac      # macOS DMG
npm run dist:linux    # Linux
```

## Testing

```bash
npm test          # run once
npm run test:watch  # watch mode
```

Tests use [Vitest](https://vitest.dev/) in a Node environment. All test files live under `src/test/` and mirror the source tree (`src/test/main/`, `src/test/shared/`).

Covered modules: `src/shared/constants`, `src/main/smart-stderr`, `src/main/pty-parser`, `src/main/memory-utils`, `src/main/config-helpers`, `src/renderer/app-utils`. These are the pure/utility layers with no Electron or DOM coupling. Main-process IPC handlers are not covered by unit tests.

## Project config (electron-store)

Config is stored via `electron-store` in the OS user data directory:
- **Windows:** `%APPDATA%\hermes\config.json`
- **macOS:** `~/Library/Application Support/hermes/config.json`
- **Linux:** `~/.config/hermes/config.json`

Default values are defined in `src/shared/constants.js` → `DEFAULTS`.

`sessionRefs` and `workspaceSnapshot` are also persisted in the same config store and managed via dedicated IPC handlers in `src/main/index.js`.

`memory.sqlite` is written to the same userData directory and stores the persistent Codebase Memory Map index (files, chunks, vectors, and MCP event history). On first run, any existing `memory.db` JSON blob is migrated and renamed to `memory.db.bak`.

A `hermes-mcp.json` file is also written to the userData directory on each launch. It contains the MCP server URL and is passed to Claude Code via `--mcp-config` when using **Ctrl+Enter / Launch Claude Code**.

## Vite config

- **root:** `src/renderer/`
- **outDir:** `../dist/renderer/`
- **base:** `./` (relative paths for Electron `file://` loading)
- **port:** `5173`

The renderer is a standard Vite+React SPA. xterm.js CSS is imported in `src/renderer/main.jsx`.

## Environment detection

`app.isPackaged` is `false` when running with `electron .` and `true` in a packaged build. This is used in `src/main/index.js` to switch between loading the Vite dev server URL and the built `index.html`.

## Native module rebuild

Two native modules require compilation against the Electron ABI:

| Module | Purpose |
|---|---|
| `node-pty` | PTY shell process management |
| `better-sqlite3` | SQLite storage for the semantic memory index |

Both are rebuilt automatically by `@electron/rebuild` during `npm install`. If you upgrade Electron or add a new native module, rebuild manually:

```bash
npm run rebuild
# or target a single module to avoid node-pty winpty issues on Windows
npx @electron/rebuild --only better-sqlite3
```

On Windows, `node-pty` compilation requires Visual Studio Build Tools with "Desktop development with C++". If the rebuild fails for `node-pty` due to the winpty build system (common in CI), you can rebuild only `better-sqlite3`:

```bash
npx @electron/rebuild --only better-sqlite3
```

Both native modules are listed in `asarUnpack` in `package.json` so they are accessible outside the asar archive in packaged builds.

## Adding an MCP tool

1. Add the tool schema to the `TOOLS` array in `src/main/mcp-server.js`
2. Add a case in `handleTool()` with the implementation
3. Broadcast SSE events as needed via `broadcast(type, data)`

Current telemetry tools used by the side panes: `report_tool_call`, `upsert_agent_node`, `append_agent_activity`.
