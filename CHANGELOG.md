# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.1.0] — 2026-03-24

### Added
- Multi-tab terminal workspace with split-pane layouts and snapshot persistence
- Built-in MCP server (HTTP + SSE) for inter-agent communication
- Agent coordination tools: `register_agent`, `upsert_agent_node`, `append_agent_activity`, `signal_agent`, `post_message` / `read_messages`, `set_shared_state` / `get_shared_state`
- Live dependency graph fed by `report_tool_call` telemetry
- Sub-agent tree panel for parent-child orchestration
- Diff timeline with file metadata, reasoning, and line-level diffs
- Artifact collector panel (`submit_artifact`)
- Semantic search over codebase and MCP event history (SQLite + fastembed)
- Codebase memory map with chunk and vector metadata
- Git workflow panel (stage, diff, commit, push)
- File explorer with syntax-highlighted code viewer
- Prompt drafts and templates panels
- Agent memory panel (`CLAUDE.md` / `AGENTS.md` viewer and editor)
- Terminal summarisation via `summarize_terminal_output` MCP tool (SSE streaming)
- Voice input via local Whisper transcription (`@xenova/transformers`)
- Inline terminal editor (`Ctrl+Shift+I`)
- Predictive command-history autocomplete
- Session manager with persistent Claude/Codex session references
- Import/export for full workspace backup and restore
- Claude usage bar (optional, opt-in) showing 5-hour and 7-day utilisation
- Context surgeon panel for inspecting Claude session context files
- MCP call log panel
- Smart stderr collector

[0.1.0]: https://github.com/pantheonforge/hermes/releases/tag/v0.1.0
