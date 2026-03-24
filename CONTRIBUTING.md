# Contributing to Hermes

## Setup

See [docs/development.md](docs/development.md) for full dev environment setup, build instructions, and the test suite.

Quick start:

```bash
npm install
npm run dev
```

Requires Node.js 18+ and native build tools (Visual Studio Build Tools on Windows, Xcode CLT on macOS, `build-essential` on Linux).

## Submitting changes

- Open an issue before starting non-trivial work.
- Keep PRs focused — one concern per PR.
- Commit messages should be imperative and describe the *why* where non-obvious (e.g. `Fix usage watcher not respecting enabled toggle`).
- Run the test suite before submitting: `npm test`.

## Architecture

See [docs/architecture.md](docs/architecture.md) for a full file map and explanation of the main/renderer process split, IPC layer, MCP server, and PTY management.

## Reporting bugs

Open an issue at [github.com/pantheonforge/hermes/issues](https://github.com/pantheonforge/hermes/issues) with steps to reproduce, your OS, and Node/Electron versions.
