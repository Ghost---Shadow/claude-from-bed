# Claude From Bed - Remote Monitor & Chat

Monitor and interact with Claude Code from your phone over LAN.

## The Problem

Claude Code runs in a terminal on your desktop. You're on the bed. You want to:
1. **See** what Claude is doing in real time
2. **Get notified** when it needs attention (errors, idle, questions)
3. **Chat back** - send follow-up messages from phone

## Architecture

```
┌──────────────┐    HTTP POST hooks    ┌────────────────┐   WebSocket    ┌─────────────┐
│              │ ───────────────────>  │                │ ────────────> │             │
│  Claude Code │                       │  Bridge Server │               │  Phone UI   │
│  (Terminal)  │ <───────────────────  │  (Node.js)     │ <──────────── │  (Browser)  │
│              │  Hook JSON responses  │  :3456         │  User actions │             │
└──────────────┘                       └────────────────┘               └─────────────┘
```

**Key insight**: Claude Code's hooks system supports `"type": "http"` hooks that POST
JSON events to an HTTP endpoint. Our server receives these, pushes them to the phone
via WebSocket, and can inject messages back to Claude via the Stop hook.

## How Each Feature Works

### 1. Real-Time Activity Feed

Claude Code fires hooks on every meaningful event. We configure HTTP hooks for:

| Hook Event         | What it captures                        |
|--------------------|-----------------------------------------|
| `PreToolUse`       | Tool about to run (name, args)          |
| `PostToolUse`      | Tool finished (result summary)          |
| `PostToolUseFailure` | Tool failed (error message)           |
| `Notification`     | Permission prompts, idle alerts         |
| `Stop`             | Claude finished responding              |
| `SessionStart`     | Session started/resumed/compacted       |

The server receives these POSTs, stores recent events in a ring buffer, and pushes
each event to the phone via WebSocket. The phone renders them as a scrolling activity
feed with color-coded cards (tool calls, results, errors, notifications).

### 2. Push Notifications

When specific events arrive (Notification hook with `permission_prompt` or `idle_prompt`
matcher), the server pushes a WebSocket message tagged as `notification`. The phone UI
uses the **Web Notifications API** (`Notification.requestPermission()` + `new Notification()`)
to show a system-level push notification, even if the browser tab is in the background.

Additionally, an audio chime plays on high-priority events (permission needed, errors).

### 3. Sending Messages Back to Claude

This is the trickiest part. Claude Code has no direct "inject a prompt" API. But the
**Stop hook** provides a workaround:

```
1. Phone user types a message in the chat input
2. Message is stored on the server as "pending message"
3. Claude finishes its current work → Stop hook fires
4. Server checks for pending messages
5. If message exists:
   - Respond with exit-code-2 equivalent: the response body signals "block stop"
   - The pending message is included in the response as feedback context
   - Claude receives the message as if it were user feedback and continues working
6. If no pending message:
   - Respond normally, Claude stops and waits for terminal input
```

**Implementation detail**: For the HTTP Stop hook, the server returns:
```json
{
  "decision": "block",
  "reason": "[Phone] User says: Can you also add error handling to that function?"
}
```
This makes Claude continue with the phone user's message as context.

**Limitation**: This only works when Claude reaches a natural stopping point. If Claude
is mid-task, the message queues until the Stop hook fires. The phone UI shows a
"message queued - will deliver when Claude pauses" indicator.

## Tech Stack

| Component       | Technology                          | Why                              |
|-----------------|-------------------------------------|----------------------------------|
| Server runtime  | Node.js                             | Easy async, great WebSocket libs |
| HTTP framework  | Express                             | Minimal, well-known              |
| WebSocket       | `ws` library                        | Lightweight, no bloat            |
| QR code         | `qrcode-terminal`                   | Print scannable URL in terminal  |
| Frontend        | Single HTML file, vanilla JS + CSS  | No build step, instant load      |
| Styling         | CSS (dark theme, mobile-first)      | Bed-friendly viewing             |
| Notifications   | Web Notifications API               | Works on Android Chrome, iOS Safari |

## File Structure

```
claude-from-bed/
├── server/
│   ├── package.json
│   ├── index.js              # Express + WebSocket server
│   └── public/
│       └── index.html        # Mobile web UI (single file: HTML + CSS + JS)
├── .claude/
│   └── settings.local.json   # Hook configuration (local, not committed)
├── docs/
│   └── PLAN.md               # This document
└── README.md
```

## Hook Configuration

`.claude/settings.local.json`:
```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "http",
            "url": "http://localhost:3456/hooks/pre-tool-use",
            "timeout": 5,
            "async": true
          }
        ]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "http",
            "url": "http://localhost:3456/hooks/post-tool-use",
            "timeout": 5,
            "async": true
          }
        ]
      }
    ],
    "PostToolUseFailure": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "http",
            "url": "http://localhost:3456/hooks/post-tool-use-failure",
            "timeout": 5,
            "async": true
          }
        ]
      }
    ],
    "Notification": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "http",
            "url": "http://localhost:3456/hooks/notification",
            "timeout": 5,
            "async": true
          }
        ]
      }
    ],
    "Stop": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "http",
            "url": "http://localhost:3456/hooks/stop",
            "timeout": 10
          }
        ]
      }
    ],
    "SessionStart": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "http",
            "url": "http://localhost:3456/hooks/session-start",
            "timeout": 5,
            "async": true
          }
        ]
      }
    ]
  }
}
```

## Server Endpoints

### Hook Receivers (POST, called by Claude Code)

| Endpoint                          | Behavior                                                    |
|-----------------------------------|-------------------------------------------------------------|
| `POST /hooks/pre-tool-use`        | Log: push tool call event to phone                          |
| `POST /hooks/post-tool-use`       | Log: push tool result summary to phone                      |
| `POST /hooks/post-tool-use-failure` | Alert: push error to phone with notification              |
| `POST /hooks/notification`        | Alert: push notification to phone, trigger push notification|
| `POST /hooks/stop`                | Check pending messages; block stop if message waiting       |
| `POST /hooks/session-start`       | Push session info, reset state                              |

### Phone API (called by phone UI via WebSocket)

| WS Message Type      | Payload                     | Effect                              |
|-----------------------|-----------------------------|-------------------------------------|
| `message`             | `{text}`                    | Queue message for Stop hook         |
| `ping`                | -                           | Keep-alive                          |

### Static Assets

| Endpoint              | Serves                                   |
|-----------------------|-------------------------------------------|
| `GET /`               | `public/index.html` (the phone UI)        |
| `GET /api/events`     | Recent events (for initial load/reconnect)|
| `GET /api/status`     | Server status + connection info           |

## Mobile UI Design

Dark theme, large touch targets, optimized for one-handed phone use.

```
┌─────────────────────────────┐
│  Claude From Bed     ● Live │  ← Status bar (green dot = connected)
├─────────────────────────────┤
│                             │
│  ┌─────────────────────┐    │
│  │ ⚡ Bash              │    │  ← Active tool card (pulsing)
│  │ npm test             │    │
│  └─────────────────────┘    │
│                             │
│  ┌─────────────────────┐    │
│  │ ✓ Read              │    │  ← Completed tool (collapsed)
│  │ src/index.ts         │    │
│  └─────────────────────┘    │
│                             │
│  ┌─────────────────────┐    │
│  │ ✓ Edit              │    │
│  │ src/utils.ts:42      │    │
│  │ +3 -1 lines          │    │
│  └─────────────────────┘    │
│                             │
│  ┌─────────────────────┐    │
│  │ ❌ Bash (FAILED)     │    │  ← Error card (red)
│  │ tsc --noEmit         │    │
│  │ Error: TS2345...     │    │
│  └─────────────────────┘    │
│                             │
├─────────────────────────────┤
│  ┌───────────────────┐ ┌─┐ │
│  │ Type a message...  │ │→│ │  ← Chat input
│  └───────────────────┘ └─┘ │
│  ⏳ Will deliver on pause   │  ← Queue indicator
└─────────────────────────────┘
```

**Card types**:
- **Active tool** (yellow/pulsing border): Tool currently running
- **Completed tool** (green left bar): Tool ran successfully, shows summary
- **Failed tool** (red left bar): Tool failed, shows error
- **Notification** (blue): Claude is idle, needs input, etc.
- **Message sent** (gray): Your message, queued or delivered
- **Claude response** (white): Context from Claude's Stop hook

## Implementation Plan

### Phase 1: Server + Activity Feed (MVP)
1. Set up Node.js project with Express + ws
2. Implement hook receiver endpoints (all async, log-only)
3. Build mobile UI with WebSocket connection and event rendering
4. Configure Claude Code hooks
5. Test: start Claude Code, see events on phone

### Phase 2: Notifications
6. Add Web Notifications API to phone UI
7. Add audio chime for high-priority events (errors, idle)
8. Tag notification-type events for push alerts

### Phase 3: Chat Back
9. Add message queue on server
10. Implement Stop hook logic (check queue, block if message pending)
11. Add chat input to phone UI with delivery status indicator

### Phase 4: Polish
12. Auto-reconnect WebSocket on connection drop
13. Event persistence (survive server restart)
14. QR code in terminal on startup (scans to phone URL)
15. Sound/vibration settings
16. Collapsible event details (expand to see full tool input/output)

### Phase 5: Distribution
17. Add `bin` entry to package.json for `claude-from-bed` CLI command
18. Add `setup` subcommand that auto-installs hooks into Claude Code settings
19. Publish to npm
20. Final: `npx claude-from-bed` just works

## Security Considerations

- Server binds to `0.0.0.0:3456` (LAN accessible) - fine for home network
- No authentication by default (trusted LAN assumption)
- Optional: add a simple shared secret/PIN for basic auth
- All hooks are async except Stop, so server downtime never blocks Claude

## Limitations & Workarounds

| Limitation | Workaround |
|------------|------------|
| No "inject prompt" API | Stop hook with decision: block to feed messages as context |
| Messages only delivered when Claude pauses | Queue with status indicator on phone |
| Can't see Claude's text output in real time | PostToolUse provides tool results; Stop provides final message via `last_assistant_message` |

## Distribution

Publish as an npm package with a CLI entry point. Zero-config experience:

```bash
# One-time setup: installs hooks into ~/.claude/settings.json
npx claude-from-bed setup

# Run the server (every time)
npx claude-from-bed
```

### What `setup` does

1. Reads `~/.claude/settings.json` (creates if missing)
2. Merges the hook configuration (won't clobber existing hooks)
3. Writes it back
4. Confirms: "Hooks installed. Start any Claude Code session and they'll fire."

### What the main command does

1. Detects LAN IP address
2. Starts Express + WebSocket server on `:3456`
3. Prints QR code to terminal (encodes `http://<LAN_IP>:3456`)
4. Waits for hook events from Claude Code sessions

### package.json setup

```json
{
  "name": "claude-from-bed",
  "bin": {
    "claude-from-bed": "./bin/cli.js"
  },
  "files": ["bin/", "server/", "hooks.json"]
}
```

`bin/cli.js` handles argument parsing:
- No args or `start` → run the server
- `setup` → install hooks
- `uninstall` → remove hooks from settings

### Why npm over alternatives

| Option | Tradeoff |
|--------|----------|
| npm package | One command, auto-deps, cross-platform, easy updates via `npm update` |
| GitHub clone | Manual git clone + npm install, no auto-updates |
| Docker | Overkill, networking complexity for LAN access |
| Single binary (pkg/bun compile) | No Node.js needed but harder to update, larger binary |

npm wins because the target audience (Claude Code users) already has Node.js installed.

## Quick Start

```bash
# First time
npx claude-from-bed setup   # installs hooks into Claude Code
npx claude-from-bed          # starts server, prints QR code

# Scan QR code with phone → opens mobile UI
# Start Claude Code in another terminal → events flow to phone
```
