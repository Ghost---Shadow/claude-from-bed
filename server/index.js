const express = require('express');
const http = require('http');
const fs = require('fs');
const { WebSocketServer } = require('ws');
const path = require('path');
const os = require('os');

const PORT = process.env.PORT || 3456;

// ── State ──────────────────────────────────────────────────────────────────────
const events = [];           // ring buffer of recent events
const MAX_EVENTS = 500;
let pendingMessages = [];    // messages from phone waiting for Stop hook
let activeTools = new Map(); // tool_use_id → event (for matching pre/post)
let hooksActive = false;     // true once a hook endpoint is hit

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
  ws.send(JSON.stringify({ type: 'init', events: events.slice(-100), hooksActive }));

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw);
      if (msg.type === 'message' && msg.text) {
        const phoneMsg = { text: msg.text, timestamp: Date.now() };
        pendingMessages.push(phoneMsg);
        const evt = createEvent('phone_message', {
          text: msg.text,
          status: 'queued'
        });
        broadcast(evt);
        console.log(`[phone] Message queued: "${msg.text.substring(0, 80)}..."`);

        // Wake up any long-poll clients waiting for messages
        if (waitingClients.length > 0) {
          const messages = pendingMessages.splice(0);
          const deliveredEvt = createEvent('phone_message_delivered', { count: messages.length });
          broadcast(deliveredEvt);
          const payload = { messages: messages.map(m => ({ text: m.text, timestamp: m.timestamp })) };
          waitingClients.forEach(c => {
            if (!c.resolved) {
              c.resolved = true;
              c.res.json(payload);
            }
          });
          waitingClients = [];
          console.log(`[wait] Delivered ${messages.length} message(s) to long-poll client`);
        }
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
  if (!hooksActive) {
    hooksActive = true;
    broadcast({ type: 'hooks_active' });
  }
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
    session_id
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
    session_id
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
    const evt = createEvent('claude_stopped', { session_id, notify: true });
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
    source: source || 'startup'
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

// Drain pending phone messages (called by Claude via curl/WebFetch)
app.get('/api/pending-messages', (req, res) => {
  if (pendingMessages.length === 0) {
    res.json({ messages: [] });
    return;
  }
  const messages = pendingMessages.splice(0); // drain
  const deliveredEvt = createEvent('phone_message_delivered', {
    count: messages.length
  });
  broadcast(deliveredEvt);
  console.log(`[api] Delivered ${messages.length} phone message(s) to Claude`);
  res.json({ messages: messages.map(m => ({ text: m.text, timestamp: m.timestamp })) });
});

// Long-poll: blocks until a phone message arrives, then returns it
// Used as a background task so Claude gets notified when a message comes in
let waitingClients = [];

app.get('/api/wait-for-message', (req, res) => {
  const timeout = Math.min(parseInt(req.query.timeout) || 120, 300) * 1000; // default 120s, max 300s

  // If there are already pending messages, return immediately
  if (pendingMessages.length > 0) {
    const messages = pendingMessages.splice(0);
    const deliveredEvt = createEvent('phone_message_delivered', { count: messages.length });
    broadcast(deliveredEvt);
    console.log(`[wait] Delivered ${messages.length} phone message(s) immediately`);
    res.json({ messages: messages.map(m => ({ text: m.text, timestamp: m.timestamp })) });
    return;
  }

  // Otherwise, wait for a message to arrive
  const client = { res, resolved: false };
  waitingClients.push(client);

  const timer = setTimeout(() => {
    if (!client.resolved) {
      client.resolved = true;
      waitingClients = waitingClients.filter(c => c !== client);
      res.json({ messages: [], timeout: true });
    }
  }, timeout);

  req.on('close', () => {
    clearTimeout(timer);
    client.resolved = true;
    waitingClients = waitingClients.filter(c => c !== client);
  });
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

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.log(`  [server] Port ${PORT} already in use — another instance may be running.`);
      console.log(`  [server] Try: npx kill-port ${PORT}  or change PORT env var`);
    } else {
      console.log(`  [server] Server error: ${err.message}`);
    }
  });

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

// ── JSONL File Watcher (fallback for sessions without hooks) ───────────────────
function findLatestJsonl() {
  const projectsDir = path.join(os.homedir(), '.claude', 'projects');
  if (!fs.existsSync(projectsDir)) return null;

  let latest = null;
  let latestMtime = 0;

  for (const dir of fs.readdirSync(projectsDir)) {
    const projectPath = path.join(projectsDir, dir);
    if (!fs.statSync(projectPath).isDirectory()) continue;

    for (const file of fs.readdirSync(projectPath)) {
      if (!file.endsWith('.jsonl')) continue;
      const filePath = path.join(projectPath, file);
      const stat = fs.statSync(filePath);
      if (stat.mtimeMs > latestMtime) {
        latestMtime = stat.mtimeMs;
        latest = filePath;
      }
    }
  }
  return latest;
}

function startJsonlWatcher(filePath) {
  if (!filePath) {
    filePath = findLatestJsonl();
    if (!filePath) {
      console.log('  [watcher] No JSONL conversation files found');
      return null;
    }
  }

  console.log(`  [watcher] Tailing: ${path.basename(filePath)}`);

  let fileSize = fs.statSync(filePath).size;
  const seenToolIds = new Set();

  function processNewLines() {
    const currentSize = fs.statSync(filePath).size;
    if (currentSize <= fileSize) return;

    // Read only the new bytes
    const fd = fs.openSync(filePath, 'r');
    const buffer = Buffer.alloc(currentSize - fileSize);
    fs.readSync(fd, buffer, 0, buffer.length, fileSize);
    fs.closeSync(fd);
    fileSize = currentSize;

    const newData = buffer.toString('utf8');
    const lines = newData.trim().split('\n').filter(l => l.trim());

    for (const line of lines) {
      try {
        const entry = JSON.parse(line);
        processJsonlEntry(entry);
      } catch (e) {
        // partial line, skip
      }
    }
  }

  function processJsonlEntry(entry) {
    const content = entry.message?.content;
    if (!Array.isArray(content)) return;

    for (const block of content) {
      if (block.type === 'tool_use' && !seenToolIds.has(block.id)) {
        seenToolIds.add(block.id);
        const summary = summarizeToolInput(block.name, block.input);
        const evt = createEvent('tool_start', {
          tool_name: block.name,
          summary,
          tool_use_id: block.id,
          source: 'watcher'
        });
        if (block.id) activeTools.set(block.id, evt);
        broadcast(evt);
        console.log(`[watcher] ${block.name}: ${summary.substring(0, 80)}`);
      }

      if (block.type === 'tool_result' && !seenToolIds.has('result_' + block.tool_use_id)) {
        seenToolIds.add('result_' + block.tool_use_id);
        // Extract text from tool result content
        let resultText = '';
        if (typeof block.content === 'string') {
          resultText = block.content;
        } else if (Array.isArray(block.content)) {
          resultText = block.content
            .filter(c => c.type === 'text')
            .map(c => c.text)
            .join('\n');
        }

        const evt = createEvent('tool_end', {
          tool_name: activeTools.get(block.tool_use_id)?.tool_name || '?',
          summary: activeTools.get(block.tool_use_id)?.summary || '',
          result: summarizeToolResponse('', resultText),
          tool_use_id: block.tool_use_id,
          is_error: block.is_error || false,
          source: 'watcher'
        });

        if (block.is_error) {
          evt.kind = 'tool_error';
          evt.error = resultText.substring(0, 300);
          evt.notify = true;
        }

        activeTools.delete(block.tool_use_id);
        broadcast(evt);
      }

      // Capture Claude's text responses
      if (block.type === 'text' && entry.message?.role === 'assistant' && block.text?.length > 10) {
        // Only emit for text-only messages (not mixed with tool_use)
        const hasToolUse = content.some(c => c.type === 'tool_use');
        if (!hasToolUse) {
          const evt = createEvent('claude_message', {
            text: block.text.substring(0, 500),
            source: 'watcher'
          });
          broadcast(evt);
        }
      }
    }
  }

  // Watch for changes
  const watcher = fs.watch(filePath, () => {
    try { processNewLines(); } catch (e) { /* file busy, retry next change */ }
  });

  // Also poll every 2s as fs.watch can be unreliable
  const pollInterval = setInterval(() => {
    try { processNewLines(); } catch (e) {}
  }, 2000);

  return { watcher, pollInterval, filePath };
}

function drainMessages() {
  if (pendingMessages.length === 0) {
    return { messages: [] };
  }
  const messages = pendingMessages.splice(0);
  const deliveredEvt = createEvent('phone_message_delivered', {
    count: messages.length
  });
  broadcast(deliveredEvt);
  return { messages: messages.map(m => ({ text: m.text, timestamp: m.timestamp })) };
}

function getStatus() {
  return {
    uptime: process.uptime(),
    clients: clients.size,
    eventCount: events.length,
    pendingMessages: pendingMessages.length,
    activeTools: activeTools.size
  };
}

module.exports = { startServer, startJsonlWatcher, drainMessages, getStatus, app, server };

// Run directly
if (require.main === module) {
  startServer();

  // Auto-start JSONL watcher after server is up
  setTimeout(() => {
    const watchResult = startJsonlWatcher();
    if (watchResult) {
      console.log(`  [watcher] Live-tailing conversation file`);
      console.log(`  [watcher] Events from this session will appear on phone`);
      console.log('');
    }
  }, 1000);
}
