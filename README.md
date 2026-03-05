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

# Restart Claude Desktop
```

That's it. On the next Claude session:

1. Claude will tell you the phone URL (e.g. `http://192.168.x.x:3456`)
2. Open that URL on your phone (same WiFi)
3. You'll see a real-time feed of everything Claude does
4. Type a message on your phone — Claude picks it up automatically

## Quick Start (Claude Code CLI)

```bash
# Option A: MCP server (auto-starts with Claude)
npx claude-from-bed setup-mcp

# Option B: Hooks + standalone server
npx claude-from-bed setup     # Install hooks (one-time)
npx claude-from-bed            # Start the bridge server in another terminal
```

## What You Get

**Real-time activity feed** — Every tool call (Read, Edit, Bash, Grep, etc.) appears as a card on your phone the moment it happens.

**Push notifications** — Audio chime + browser notification when Claude goes idle and is waiting for your response.

**Chat back from phone** — Type a message on your phone. Claude picks it up via a background long-poll listener and processes it as a user instruction. No need to walk back to your computer.

## How It Works

The MCP server auto-starts a bridge server on your LAN (port 3456) with each Claude session. On startup, it sends Claude instructions to:

1. **Tell you the phone URL** so you can connect
2. **Poll for phone messages** at the start of every response
3. **Run a background long-poll listener** that blocks until a phone message arrives, then wakes Claude up to process it

The phone UI connects via WebSocket for real-time push updates. Activity monitoring comes from watching Claude's JSONL conversation files and/or HTTP hooks.

## Commands

```bash
npx claude-from-bed                  # Start the bridge server standalone
npx claude-from-bed mcp              # Start as MCP server (used by Claude Desktop)
npx claude-from-bed setup-desktop    # Register MCP server for Claude Desktop
npx claude-from-bed setup-mcp        # Register MCP server for Claude Code CLI
npx claude-from-bed setup            # Install HTTP hooks for Claude Code CLI
npx claude-from-bed uninstall        # Remove hooks from Claude Code
npx claude-from-bed uninstall-desktop # Remove MCP server from Claude Desktop
```

## Uninstall

```bash
# Claude Desktop
npx claude-from-bed uninstall-desktop
# Restart Claude Desktop

# Claude Code CLI
npx claude-from-bed uninstall
```

## Requirements

- Node.js 18+
- Claude Desktop or Claude Code CLI
- Phone and computer on the same WiFi/LAN

## License

MIT
