# Claude From Bed

Monitor and chat with Claude Code from your phone while lying in bed. Runs a local web server on your LAN — no app install needed.

```
┌──────────────┐   MCP / hooks   ┌────────────────┐   WebSocket    ┌─────────────┐
│  Claude Code │ ───────────────> │  Bridge Server │ ────────────> │  Phone UI   │
│  (Desktop)   │ <─────────────── │  (Node.js)     │ <──────────── │  (Browser)  │
└──────────────┘                  └────────────────┘               └─────────────┘
```

## Install

### Claude Code CLI (recommended)

```bash
npx claude-from-bed setup-mcp
```

This registers an MCP server that auto-starts with every Claude Code session. No need to run a separate server — it just works.

### Claude Desktop

```bash
npx claude-from-bed setup-desktop
```

Then restart Claude Desktop.

### Standalone (hooks mode)

If you prefer hooks over MCP:

```bash
npx claude-from-bed setup     # Install hooks into ~/.claude/settings.json (one-time)
npx claude-from-bed            # Start the bridge server (run in a separate terminal)
```

## Usage

1. Start a Claude Code session
2. Claude will tell you the phone URL (e.g. `http://192.168.x.x:3456`)
3. Open that URL on your phone (same WiFi network)
4. See everything Claude does in real time
5. Send messages from your phone — Claude picks them up automatically

## Features

- **Real-time activity feed** — Every tool call appears as a card on your phone the moment it happens
- **Push notifications** — Audio chime + browser notification when Claude needs attention
- **Chat from phone** — Send follow-up instructions without walking to your computer
- **Event filters** — Toggle event types on/off to focus on what matters

## Commands

| Command | Description |
|---------|-------------|
| `npx claude-from-bed` | Start bridge server standalone |
| `npx claude-from-bed setup-mcp` | Register MCP server for Claude Code CLI |
| `npx claude-from-bed setup-desktop` | Register MCP server for Claude Desktop |
| `npx claude-from-bed setup` | Install HTTP hooks for Claude Code CLI |
| `npx claude-from-bed uninstall` | Remove hooks from Claude Code |
| `npx claude-from-bed uninstall-desktop` | Remove MCP server from Claude Desktop |

## Uninstall

```bash
# Claude Code CLI
npx claude-from-bed uninstall

# Claude Desktop
npx claude-from-bed uninstall-desktop
# Then restart Claude Desktop
```

## Requirements

- Node.js 18+
- Claude Desktop or Claude Code CLI
- Phone and computer on the same WiFi/LAN

## License

MIT
