#!/usr/bin/env node
/**
 * MCP (Model Context Protocol) server wrapper for Claude From Bed.
 *
 * When Claude Desktop/Code starts, it launches this process.
 * This process:
 *   1. Starts the Express/WebSocket bridge server (phone UI, JSONL watcher)
 *   2. Exposes MCP tools so Claude can natively check phone messages
 *
 * Stdout is reserved for MCP JSON-RPC protocol.
 * All logging goes to stderr.
 */

const readline = require('readline');
const path = require('path');
const os = require('os');

// ── Redirect console to stderr (stdout = MCP protocol) ─────────────────────
const _write = (stream) => (...args) => {
  stream.write(args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ') + '\n');
};
console.log = _write(process.stderr);
console.info = _write(process.stderr);
console.warn = _write(process.stderr);
console.error = _write(process.stderr);

// ── Start the bridge server ─────────────────────────────────────────────────
const { startServer, startJsonlWatcher, drainMessages, getStatus } = require('./index.js');

function getLanIP() {
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const iface of nets[name]) {
      if (iface.family === 'IPv4' && !iface.internal) return iface.address;
    }
  }
  return 'localhost';
}
const PHONE_URL = `http://${getLanIP()}:3456`;

startServer();

// Auto-start JSONL watcher after server is up
setTimeout(() => {
  const watchResult = startJsonlWatcher();
  if (watchResult) {
    console.log('[mcp] JSONL watcher started');
  }
}, 1000);

// ── MCP Protocol (JSON-RPC 2.0 over stdio) ─────────────────────────────────

const PROTOCOL_VERSION = '2024-11-05';
const SERVER_INFO = { name: 'claude-from-bed', version: '0.1.0' };

const TOOLS = [
  {
    name: 'check_phone_messages',
    description: 'Check for new messages sent from your phone. Call this when you want to see if there are any pending instructions from the user\'s phone. Returns an array of messages (may be empty).',
    inputSchema: {
      type: 'object',
      properties: {},
      required: []
    }
  },
  {
    name: 'phone_status',
    description: 'Check the status of the phone bridge server — how many phones are connected, the URL/QR code to access it, pending messages, etc. Call this at the start of a session so you can share the phone URL with the user.',
    inputSchema: {
      type: 'object',
      properties: {},
      required: []
    }
  }
];

function send(msg) {
  const json = JSON.stringify(msg);
  process.stdout.write(json + '\n');
}

function handleRequest(msg) {
  const { id, method, params } = msg;

  switch (method) {
    case 'initialize':
      send({
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: PROTOCOL_VERSION,
          capabilities: { tools: {} },
          serverInfo: SERVER_INFO,
          instructions: [
            'Claude From Bed: Phone bridge server is running.',
            `Phone URL: ${PHONE_URL}`,
            '',
            'At the START of every response, silently check for phone messages by running:',
            '  curl -s http://localhost:3456/api/pending-messages',
            'If the response contains messages (non-empty messages array), read them and incorporate them into your response. Treat phone messages as additional user instructions with the same priority as the main prompt. Mention that you received a message from the phone.',
            'If the curl fails (server not running), silently ignore it and continue normally.',
            '',
            'After checking messages, if there is no background long-poll task already running, start one:',
            '  curl -s "http://localhost:3456/api/wait-for-message?timeout=120"',
            'Run this as a background task. When it completes, read the output — it contains a phone message. Process it and start a new long-poll.',
            '',
            `Tell the user they can open ${PHONE_URL} on their phone (same WiFi) to monitor and chat with Claude.`
          ].join('\n')
        }
      });
      break;

    case 'notifications/initialized':
      // No response needed for notifications
      console.log('[mcp] Client initialized');
      break;

    case 'tools/list':
      send({
        jsonrpc: '2.0',
        id,
        result: { tools: TOOLS }
      });
      break;

    case 'tools/call':
      handleToolCall(id, params);
      break;

    case 'ping':
      send({ jsonrpc: '2.0', id, result: {} });
      break;

    default:
      if (id !== undefined) {
        // Unknown method with an id = request, send error
        send({
          jsonrpc: '2.0',
          id,
          error: {
            code: -32601,
            message: `Method not found: ${method}`
          }
        });
      }
      // Notifications (no id) for unknown methods are silently ignored
      break;
  }
}

function handleToolCall(id, params) {
  const { name } = params;

  try {
    let result;

    switch (name) {
      case 'check_phone_messages': {
        const { messages } = drainMessages();
        if (messages.length === 0) {
          result = { content: [{ type: 'text', text: 'No pending phone messages.' }] };
        } else {
          const formatted = messages.map((m, i) =>
            `Message ${i + 1}: ${m.text}`
          ).join('\n\n');
          result = {
            content: [{
              type: 'text',
              text: `📱 ${messages.length} message(s) from phone:\n\n${formatted}`
            }]
          };
        }
        break;
      }

      case 'phone_status': {
        const status = getStatus();
        result = {
          content: [{
            type: 'text',
            text: [
              `📱 Phone Bridge Status:`,
              `  Phone URL: ${PHONE_URL}`,
              `  Connected phones: ${status.clients}`,
              `  Pending messages: ${status.pendingMessages}`,
              `  Events tracked: ${status.eventCount}`,
              `  Active tools: ${status.activeTools}`,
              `  Server uptime: ${Math.round(status.uptime)}s`,
              ``,
              `Tell the user to open ${PHONE_URL} on their phone (same WiFi) to monitor and chat with Claude.`
            ].join('\n')
          }]
        };
        break;
      }

      default:
        send({
          jsonrpc: '2.0',
          id,
          error: {
            code: -32602,
            message: `Unknown tool: ${name}`
          }
        });
        return;
    }

    send({ jsonrpc: '2.0', id, result });
  } catch (err) {
    send({
      jsonrpc: '2.0',
      id,
      result: {
        content: [{ type: 'text', text: `Error: ${err.message}` }],
        isError: true
      }
    });
  }
}

// ── Read stdin line by line ─────────────────────────────────────────────────
const rl = readline.createInterface({ input: process.stdin, terminal: false });

rl.on('line', (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;

  try {
    const msg = JSON.parse(trimmed);
    handleRequest(msg);
  } catch (e) {
    console.error('[mcp] Failed to parse message:', e.message);
  }
});

rl.on('close', () => {
  console.log('[mcp] stdin closed, shutting down');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('[mcp] Received SIGINT, shutting down');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('[mcp] Received SIGTERM, shutting down');
  process.exit(0);
});

console.log('[mcp] Claude From Bed MCP server started');
