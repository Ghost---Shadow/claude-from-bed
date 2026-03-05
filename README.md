# Claude From Bed

Monitor and chat with Claude Code from your phone while lying in bed. Runs a local web server on your LAN — no app install needed.

```
┌──────────────┐   MCP / hooks   ┌────────────────┐   WebSocket    ┌─────────────┐
│  Claude Code │ ───────────────> │  Bridge Server │ ────────────> │  Phone UI   │
│  (Desktop)   │ <─────────────── │  (Node.js)     │ <──────────── │  (Browser)  │
└──────────────┘                  └────────────────┘               └─────────────┘
```

## Quick Start (Claude Desktop)

```bash
# One-time setup — registers MCP server
npx claude-from-bed setup-desktop

# Restart Claude Desktop. The bridge server auto-starts with each session.
# Open the URL shown in logs on your phone (same WiFi).
```

## Quick Start (Claude Code CLI)

```bash
# Option A: MCP server (auto-starts with Claude)
npx claude-from-bed setup-mcp

# Option B: Hooks + standalone server
npx claude-from-bed setup    # Install hooks (one-time)
npx claude-from-bed           # Start the bridge server
```

## What You Get

**Real-time activity feed** — Every tool call (Read, Edit, Bash, Grep, etc.) appears as a card on your phone the moment it happens.

**Push notifications** — Audio chime + browser notification when Claude hits an error or goes idle. Works even with the tab backgrounded.

**Chat back** — Type a message on your phone. It gets delivered to Claude via the MCP `check_phone_messages` tool or the Stop hook. Claude continues working with your message as context.

## How It Works

The bridge server runs on your LAN (port 3456) and serves a mobile web UI over WebSocket.

**MCP mode** (recommended): The server registers as an MCP server that auto-starts with Claude. It exposes a `check_phone_messages` tool that Claude can call to receive your phone messages natively. Activity monitoring uses the JSONL conversation file watcher.

**Hooks mode**: Claude Code's [HTTP hooks system](https://docs.anthropic.com/en/docs/claude-code/hooks) POSTs events to `localhost:3456` on every tool call, error, notification, and stop. The Stop hook is synchronous and can inject phone messages back into Claude.

Both modes can be used together for the best experience.

## Commands

```bash
npx claude-from-bed               # Start the bridge server standalone
npx claude-from-bed setup-desktop  # Register MCP server for Claude Desktop
npx claude-from-bed setup-mcp      # Register MCP server for Claude Code CLI
npx claude-from-bed setup          # Install HTTP hooks for Claude Code CLI
npx claude-from-bed uninstall      # Remove hooks from Claude Code
npx claude-from-bed uninstall-desktop # Remove MCP server from Claude Desktop
```

## Requirements

- Node.js 18+
- Claude Code (Desktop or CLI)
- Phone and computer on the same WiFi/LAN

## License

MIT
