const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const path = require('path');
const os = require('os');

const PORT = process.env.PORT || 3456;

// ── State ──────────────────────────────────────────────────────────────────────
const events = [];           // ring buffer of recent events
const MAX_EVENTS = 500;
let pendingMessages = [];    // messages from phone waiting for Stop hook
let activeTools = new Map(); // tool_use_id → event (for matching pre/post)

// ── Express + WebSocket setup ──────────────────────────────────────────────────
const app = express();
app.use(express.json({ limit: '5mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

// ── WebSocket connections ──────────────────────────────────────────────────────
const clients = new Set();

wss.on('connection', (ws) => {
  clients.add(ws);
  console.log(`[ws] Phone connected (${clients.size} total)`);

  // Send recent events on connect
  ws.send(JSON.stringify({ type: 'init', events: events.slice(-100) }));

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw);
      if (msg.type === 'message' && msg.text) {
        pendingMessages.push({
          text: msg.text,
          timestamp: Date.now()
        });
        const evt = createEvent('phone_message', {
          text: msg.text,
          status: 'queued'
        });
        broadcast(evt);
        console.log(`[phone] Message queued: "${msg.text.substring(0, 80)}..."`);
      }
    } catch (e) {
      // ignore malformed messages
    }
  });

  ws.on('close', () => {
    clients.delete(ws);
    console.log(`[ws] Phone disconnected (${clients.size} total)`);
  });
});

function broadcast(event) {
  const data = JSON.stringify({ type: 'event', event });
  for (const ws of clients) {
    if (ws.readyState === 1) ws.send(data);
  }
}

// ── Event helpers ──────────────────────────────────────────────────────────────
function createEvent(kind, data) {
  const event = {
    id: events.length,
    kind,
    timestamp: Date.now(),
    ...data
  };
  events.push(event);
  if (events.length > MAX_EVENTS) events.shift();
  return event;
}

function summarizeToolInput(toolName, toolInput) {
  if (!toolInput) return '';
  switch (toolName) {
    case 'Bash':
      return toolInput.command || '';
    case 'Read':
      return toolInput.file_path || '';
    case 'Write':
      return toolInput.file_path || '';
    case 'Edit':
      return toolInput.file_path || '';
    case 'Glob':
      return toolInput.pattern || '';
    case 'Grep':
      return `${toolInput.pattern || ''} ${toolInput.path || ''}`.trim();
    case 'WebFetch':
      return toolInput.url || '';
    case 'WebSearch':
      return toolInput.query || '';
    case 'TodoWrite':
      const todos = toolInput.todos || [];
      return todos.map(t => `[${t.status}] ${t.content}`).join(', ');
    case 'Task':
      return toolInput.description || toolInput.prompt?.substring(0, 100) || '';
    default:
      // MCP tools or unknown
      return JSON.stringify(toolInput).substring(0, 200);
  }
}

function summarizeToolResponse(toolName, response) {
  if (!response) return '';
  const str = typeof response === 'string' ? response : JSON.stringify(response);
  // Truncate long responses
  return str.length > 300 ? str.substring(0, 300) + '...' : str;
}

// ── Hook endpoints ─────────────────────────────────────────────────────────────

// PreToolUse - log only (async hook, Claude doesn't wait)
app.post('/hooks/pre-tool-use', (req, res) => {
  const { tool_name, tool_input, tool_use_id, session_id } = req.body;
  const summary = summarizeToolInput(tool_name, tool_input);

  const evt = createEvent('tool_start', {
    tool_name,
    summary,
    tool_use_id,
    session_id
  });

  if (tool_use_id) activeTools.set(tool_use_id, evt);
  broadcast(evt);
  console.log(`[hook] ${tool_name}: ${summary.substring(0, 80)}`);
  res.json({});
});

// PostToolUse - log result (async hook)
app.post('/hooks/post-tool-use', (req, res) => {
  const { tool_name, tool_input, tool_response, tool_use_id, session_id } = req.body;
  const summary = summarizeToolInput(tool_name, tool_input);
  const result = summarizeToolResponse(tool_name, tool_response);

  const evt = createEvent('tool_end', {
    tool_name,
    summary,
    result,
    tool_use_id,
    session_id
  });

  activeTools.delete(tool_use_id);
  broadcast(evt);
  res.json({});
});

// PostToolUseFailure - alert on error (async hook)
app.post('/hooks/post-tool-use-failure', (req, res) => {
  const { tool_name, tool_input, error_message, tool_use_id, session_id } = req.body;
  const summary = summarizeToolInput(tool_name, tool_input);

  const evt = createEvent('tool_error', {
    tool_name,
    summary,
    error: error_message || 'Unknown error',
    tool_use_id,
    session_id,
    notify: true
  });

  activeTools.delete(tool_use_id);
  broadcast(evt);
  console.log(`[hook] ERROR ${tool_name}: ${error_message}`);
  res.json({});
});

// Notification - push to phone (async hook)
app.post('/hooks/notification', (req, res) => {
  const { message, title, notification_type, session_id } = req.body;

  const evt = createEvent('notification', {
    message: message || title || 'Claude needs attention',
    notification_type,
    session_id,
    notify: true
  });

  broadcast(evt);
  console.log(`[hook] Notification: ${message || title}`);
  res.json({});
});

// Stop - check for pending messages (SYNC hook - Claude waits for response)
app.post('/hooks/stop', (req, res) => {
  const { session_id, last_assistant_message } = req.body;

  // Push Claude's final message to the phone
  if (last_assistant_message) {
    const msgEvt = createEvent('claude_message', {
      text: last_assistant_message,
      session_id
    });
    broadcast(msgEvt);
  }

  // Check for pending phone messages
  if (pendingMessages.length > 0) {
    const messages = pendingMessages.splice(0); // drain queue
    const combined = messages.map(m => m.text).join('\n\n');

    // Mark messages as delivered on phone
    const deliveredEvt = createEvent('phone_message_delivered', {
      count: messages.length
    });
    broadcast(deliveredEvt);

    console.log(`[stop] Injecting ${messages.length} phone message(s) into Claude`);

    // Block stop + inject message
    res.json({
      decision: 'block',
      reason: `[Message from user via phone]:\n${combined}`
    });
  } else {
    // Let Claude stop normally
    const evt = createEvent('claude_stopped', { session_id });
    broadcast(evt);
    console.log('[stop] Claude stopped (no pending messages)');
    res.json({});
  }
});

// SessionStart - reset state (async hook)
app.post('/hooks/session-start', (req, res) => {
  const { session_id, source } = req.body;

  activeTools.clear();

  const evt = createEvent('session_start', {
    session_id,
    source: source || 'startup',
    notify: true
  });

  broadcast(evt);
  console.log(`[hook] Session started (${source || 'startup'})`);
  res.json({});
});

// ── REST API for phone ─────────────────────────────────────────────────────────
app.get('/api/events', (req, res) => {
  const limit = parseInt(req.query.limit) || 100;
  res.json(events.slice(-limit));
});

app.get('/api/status', (req, res) => {
  res.json({
    uptime: process.uptime(),
    clients: clients.size,
    eventCount: events.length,
    pendingMessages: pendingMessages.length,
    activeTools: activeTools.size
  });
});

// ── Start server ───────────────────────────────────────────────────────────────
function getLanIP() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return 'localhost';
}

function startServer() {
  const lanIP = getLanIP();
  const url = `http://${lanIP}:${PORT}`;

  server.listen(PORT, '0.0.0.0', () => {
    console.log('');
    console.log('  ╔══════════════════════════════════════╗');
    console.log('  ║        Claude From Bed               ║');
    console.log('  ╚══════════════════════════════════════╝');
    console.log('');
    console.log(`  Local:   http://localhost:${PORT}`);
    console.log(`  Network: ${url}`);
    console.log('');

    // Print QR code
    try {
      const qr = require('qrcode-terminal');
      console.log('  Scan with your phone:');
      console.log('');
      qr.generate(url, { small: true }, (code) => {
        // Indent each line
        const indented = code.split('\n').map(l => '  ' + l).join('\n');
        console.log(indented);
        console.log('');
        console.log('  Waiting for Claude Code hooks...');
        console.log('');
      });
    } catch (e) {
      console.log(`  Open on your phone: ${url}`);
      console.log('');
      console.log('  Waiting for Claude Code hooks...');
      console.log('');
    }
  });
}

module.exports = { startServer, app, server };

// Run directly
if (require.main === module) {
  startServer();
}
