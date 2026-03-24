# Security

## Reporting a vulnerability

Please open a GitHub issue tagged **security** or email the maintainers directly. Do not disclose vulnerabilities publicly until they have been triaged.

## Known security considerations

### Electron renderer sandbox

Hermes runs with `sandbox: false` in the BrowserWindow `webPreferences`. This is a conscious tradeoff:

- `contextIsolation: true` and `nodeIntegration: false` are both enforced, so the renderer cannot directly access Node.js APIs.
- The preload script exposes only a narrow, explicitly defined API surface via `contextBridge`.
- Navigation to external URLs and new window creation are both blocked (`will-navigate` guard + `setWindowOpenHandler`).
- The app does not load any remote content — in production it loads from a local `file://` path.

Enabling `sandbox: true` would provide an additional layer of process isolation at the cost of further restricting the preload environment. This has not been tested and may be addressed in a future release.

### Claude OAuth token access (usage polling)

The optional usage bar feature reads the Claude OAuth token from `~/.claude/.credentials.json` and polls `api.anthropic.com/api/oauth/usage` to display session utilization in the footer. This feature is **disabled by default** and must be explicitly opted in to via Settings. No token or usage data is stored beyond the in-memory cache used to render the UI.

### MCP server session token

The embedded MCP server generates a random session token on each launch and writes it to a local config file. All MCP requests are validated against this token. The server only binds to `localhost` and accepts CORS requests from `localhost` origins only.

### PTY / shell access

Hermes spawns shell processes (PTY) on behalf of the user. It does not restrict or sandbox these processes — they run with the same permissions as the user who launched Hermes. This is intentional; Hermes is a developer terminal, not a sandboxed execution environment.
