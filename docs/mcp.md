# MCP Server

## Overview

An Express HTTP server embedded in the Electron main process. Implements the [MCP StreamableHTTP transport](https://spec.modelcontextprotocol.io/) so Claude Code agents can call tools via HTTP POST.

- **Default port:** `2337` (configurable in settings, requires restart)
- **Bind address:** `127.0.0.1` (loopback only)

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| `POST /` | JSON-RPC 2.0 | MCP tool calls (from Claude Code) |
| `GET /events` | SSE stream | Live monitor feed (from renderer) |
| `DELETE /messages` | — | Clear message history |
| `DELETE /state` | — | Reset shared state |
| `GET /state` | JSON | Read full shared state |

## MCP protocol

The server handles standard MCP JSON-RPC methods:

| Method | Description |
|---|---|
| `initialize` | Handshake; returns `protocolVersion: 2024-11-05` and capabilities |
| `tools/list` | Returns the tool schemas |
| `tools/call` | Executes a tool by name |
| `ping` | Keepalive; returns `{}` |

Notifications (no `id` field) return `204 No Content`.

## Tools

### `post_message`
Publish a message to a named channel.
```json
{ "channel": "string", "content": "string" }
```
Messages are stored in memory (capped at 1000) and broadcast via SSE.

### `read_messages`
Read messages from a channel.
```json
{ "channel": "string", "since": 1700000000000 }
```
`since` is an optional Unix timestamp in ms; returns only messages after that point.

### `set_shared_state`
Write to the shared key-value store.
```json
{ "key": "string", "value": <any> }
```

### `get_shared_state`
Read from the shared key-value store.
```json
{ "key": "string" }
```
Returns `{ "key": "...", "value": ... }`. Value is `null` if the key doesn't exist.

### `list_agents`
Returns an array of all registered agents:
```json
[{ "id": "...", "label": "...", "status": "idle|working", "registeredAt": 1700000000000 }]
```

### `register_agent`
Register this agent session with Hermes.
```json
{ "id": "string", "label": "string", "terminal_id": "string?" }
```
Call this early in your agent's system prompt or init tool sequence. Pass `terminal_id: process.env.HERMES_TERMINAL_ID` (set automatically by Hermes when spawning a terminal) to link your chosen agent ID to your terminal so that `signal_agent` can deliver inline banners to your PTY.

### `signal_agent`
Send a direct message to another agent. The message is:
1. Broadcast as an SSE event visible in the monitor
2. Written directly to the target agent's PTY as a highlighted inline message
```json
{ "agent_id": "string", "message": "string" }
```

### `submit_artifact`
Submit an in-memory artifact deliverable for monitor surfacing.
```json
{ "agent_id": "string", "filename": "string", "content": "string", "mime_type": "string?" }
```
Artifacts are session-scoped (memory only) and not persisted across app restarts.

### `report_tool_call`
Report agent tool activity for live dependency graph updates.
```json
{
  "agent_id": "string",
  "tool_name": "string",
  "file_path": "string?",
  "op": "read|write|edit|delete?",
  "timestamp": 1700000000000?,
  "reasoning": "string?",
  "before": "string?",
  "after": "string?",
  "diff": "string?",
  "lines_added": 0?,
  "lines_removed": 0?
}
```
When `tool_name` is `write_file` (or `op` is `write`/`edit`) and diff metadata is provided, Hermes also appends a session-scoped diff timeline entry.

### `upsert_agent_node`
Create or update a node in the sub-agent orchestration tree.
```json
{ "agent_id": "string", "parent_id": "string?", "role": "string", "status": "pending|running|done|error", "progress": 0, "model": "string?", "token_burn": 0? }
```

### `append_agent_activity`
Append a log entry to an agent node.
```json
{ "agent_id": "string", "message": "string", "level": "info|warn|error?" }
```

### `semantic_search`
Semantic vector search over the indexed codebase and/or MCP event history.
```json
{ "query": "string", "limit": 10, "scope": "code|events|all" }
```
- `scope` defaults to `"code"`. Use `"events"` to search agent messages, artifacts, and activity logs. Use `"all"` for both.
- Results are ranked by cosine similarity. Each result includes `filePath`, `excerpt`, `score`, and `chunkIndex` for code results; `agentId`, `channel`, `eventType`, and `timestamp` for event results.
- Rate-limited to **5 requests per 10 seconds per agent**.
- Returns `{ "ok": false }` if the embedding model is not loaded or no index exists.

The index is populated by:
1. **Explicit scan** — user triggers a scan from the Codebase Memory Map pane
2. **Live MCP events** — `post_message`, `submit_artifact`, and `append_agent_activity` calls are automatically batch-embedded (2 s debounce) into a 30-day rolling `mcp_events` store

## SSE event types

The `/events` stream sends JSON objects with `{ type, data, ts }`:

| Type | Data | Description |
|---|---|---|
| `snapshot` | `{ messages, agents, sharedState, artifacts, toolCalls, diffTimeline, agentNodes, agentActivities }` | Full state on connect |
| `message` | message object | New message posted |
| `agent` | agent object | Agent registered or updated |
| `state` | `{ key, value }` | Shared state key changed |
| `signal` | `{ agent_id, message, from, timestamp }` | Signal sent to an agent |
| `artifact` | `{ agent_id, filename, content, mime_type?, timestamp }` | Artifact submitted by an agent |
| `tool_call` | `{ agent_id, tool_name, file_path?, op?, timestamp }` | Agent file/tool telemetry |
| `diff_timeline` | `{ id, agent_id, tool_name, file_path, op, timestamp, reasoning, lines_added, lines_removed, diff_lines[] }` | Session diff timeline entry |
| `agent_node` | `{ id, parent_id?, role, status, progress, model, token_burn, updatedAt, createdAt }` | Agent tree node upserted |
| `agent_activity` | `{ agent_id, message, level, timestamp }` | Agent log entry |
| `cleared` | `{ target: "messages"|"state" }` | Bulk clear event |

A keepalive comment (`: ping`) is sent every 15 seconds.

## Agent config for Claude Code

```json
{
  "mcpServers": {
    "hermes": {
      "type": "http",
      "url": "http://localhost:2337"
    }
  }
}
```

This can be placed in `~/.claude/claude_desktop_config.json` or injected per-project.
