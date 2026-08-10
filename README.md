# Chimera

A multi-provider desktop AI chat app — a power-user hybrid of Claude Desktop and the ChatGPT/Codex desktop app, with a cross-session agent bus.

## Features

- **Two backends behind one abstraction**: Claude (via `@anthropic-ai/claude-agent-sdk`) and OpenAI Codex (via `@openai/codex-sdk`), streaming into a shared normalized event model. More providers can be added by implementing `ChatProvider` ([src/main/providers/types.ts](src/main/providers/types.ts)).
- **Web login, done compliantly**: Chimera never implements OAuth itself. Claude auth uses your own Claude Code CLI login (`claude /login`, launched in a terminal from the app); Codex uses the official `codex login` ChatGPT flow. API keys work too (`ANTHROPIC_API_KEY`).
- **chimera-bus**: every session is connected to an MCP server exposing `list_sessions` / `send_to_session` / `await_reply` / `reply_to_message` / `check_inbox` — so a Claude conversation can ask a Codex conversation to review its work (and vice versa), visible as cards in both transcripts. Deadlock-guarded (timeouts, cycle detection, inbox caps).
- **MCP management**: add stdio/HTTP/SSE servers, per-conversation enable/disable, one-click import from Claude Desktop's `claude_desktop_config.json`.
- **Connector directory**: curated remote MCP connectors (GitHub, Linear, Notion, Sentry, Stripe, DeepWiki, Hugging Face, Context7) — one click to add.
- **Claude Code plugins**: load local plugin folders (skills, agents, commands, hooks) into every Claude session.
- **Permissions**: tool calls surface as Allow / Always allow / Deny dialogs (Agent SDK `canUseTool` bridge with persisted always-allow rules). The per-conversation permission mode maps to Codex's sandbox: `default`→`workspace-write`, `plan`→`read-only`, `bypassPermissions`→`danger-full-access`.
  - **Known Codex CLI bug** ([openai/codex#16685](https://github.com/openai/codex/issues/16685)): in non-interactive mode, MCP tool calls are auto-cancelled unless the sandbox is `danger-full-access`. Practical consequence: a Codex conversation can *receive* bus messages in any mode, but can only *reply* over the bus when its permission mode is "Full access".
- **Model picker** per conversation (Fable 5 / Opus 5 / Sonnet 5 / Haiku 4.5; Codex models), switchable mid-conversation.
- **Persistence**: conversations in SQLite (`node:sqlite` — no native deps), transcripts replayed from the providers' own session stores, resume on reopen.

## Development

```bash
npm install
npm run dev        # electron-vite dev with HMR + main-process watch
npm test           # vitest (BusCore unit tests)
CHIMERA_ACID=1 npm test   # + live cross-provider bus test (needs both logins, spends tokens)
npm run typecheck
npm run package    # electron-builder AppImage (untested)
```

## First run

1. **Claude**: click "Log in" in the header (or Settings → Providers). A terminal opens running the official `claude /login` flow. Alternatively export `ANTHROPIC_API_KEY`.
2. **Codex**: needs the `codex` CLI installed and `codex login` completed (Settings → Providers has a login button).

## Architecture

```
renderer (React 19 + zustand + Tailwind, sandboxed, no Node)
   ↕ typed IPC (zod-validated, single push channel for session events, 16ms delta coalescing)
main (Electron)
   ├─ providers/   ChatProvider abstraction → ClaudeProvider | CodexProvider
   ├─ bus/         BusCore + in-process MCP server (Claude) + localhost HTTP MCP (Codex)
   ├─ store/       node:sqlite: conversations, mcp_servers, plugins, permission_rules
   └─ terminal.ts  login flows via the user's own terminal
```

Session events are normalized to one union ([src/shared/events.ts](src/shared/events.ts)): `text.delta`, `thinking.delta`, `tool.started/output`, `permission.request`, `bus.message`, `turn.completed`, …
