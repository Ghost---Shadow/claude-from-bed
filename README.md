# Claude From Bed

Monitor and chat with Claude Code from your phone while lying in bed. Runs a local web server on your LAN — no app install needed.

```
┌──────────────┐    HTTP hooks    ┌────────────────┐   WebSocket    ┌─────────────┐
│  Claude Code │ ───────────────> │  Bridge Server │ ────────────> │  Phone UI   │
│  (Terminal)  │ <─────────────── │  (Node.js)     │ <──────────── │  (Browser)  │
└──────────────┘                  └────────────────┘               └─────────────┘
```

## Quick Start

```bash
# 1. Install hooks into Claude Code (one-time)
npx claude-from-bed setup

# 2. Start the bridge server
npx claude-from-bed

# 3. Scan the QR code with your phone (or open the URL)
# 4. Start Claude Code in another terminal — events flow to your phone
```

## What You Get

**Real-time activity feed** — Every tool call (Read, Edit, Bash, Grep, etc.) appears as a card on your phone the moment it happens.

**Push notifications** — Audio chime + browser notification when Claude hits an error or goes idle. Works even with the tab backgrounded.

**Chat back** — Type a message on your phone. It gets delivered to Claude the next time it pauses, injected via the Stop hook. Claude continues working with your message as context.

## How It Works

Claude Code has an [HTTP hooks system](https://docs.anthropic.com/en/docs/claude-code/hooks). The `setup` command installs hooks into `~/.claude/settings.json` that POST events to `localhost:3456` on every tool call, error, notification, and stop. The bridge server receives these, pushes them to your phone via WebSocket, and can inject messages back through the Stop hook.

All hooks are async (fire-and-forget) except the Stop hook, which is synchronous so it can block Claude from stopping when you have a pending message.

## Commands

```bash
npx claude-from-bed          # Start the bridge server
npx claude-from-bed setup    # Install hooks into Claude Code
npx claude-from-bed uninstall # Remove hooks from Claude Code
```

## Requirements

- Node.js 18+
- Claude Code
- Phone and computer on the same WiFi/LAN

## License

MIT
