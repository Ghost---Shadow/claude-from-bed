#!/usr/bin/env node

const path = require('path');
const fs = require('fs');
const os = require('os');

const HOOKS_CONFIG = {
  PreToolUse: [{
    matcher: '',
    hooks: [{
      type: 'http',
      url: 'http://localhost:3456/hooks/pre-tool-use',
      timeout: 5
    }]
  }],
  PostToolUse: [{
    matcher: '',
    hooks: [{
      type: 'http',
      url: 'http://localhost:3456/hooks/post-tool-use',
      timeout: 5
    }]
  }],
  PostToolUseFailure: [{
    matcher: '',
    hooks: [{
      type: 'http',
      url: 'http://localhost:3456/hooks/post-tool-use-failure',
      timeout: 5
    }]
  }],
  Notification: [{
    matcher: '',
    hooks: [{
      type: 'http',
      url: 'http://localhost:3456/hooks/notification',
      timeout: 5
    }]
  }],
  Stop: [{
    matcher: '',
    hooks: [{
      type: 'http',
      url: 'http://localhost:3456/hooks/stop',
      timeout: 10
    }]
  }],
  SessionStart: [{
    matcher: '',
    hooks: [{
      type: 'http',
      url: 'http://localhost:3456/hooks/session-start',
      timeout: 5
    }]
  }]
};

const CLAUDE_SETTINGS_PATH = path.join(os.homedir(), '.claude', 'settings.json');

function setup() {
  console.log('');
  console.log('  Setting up Claude From Bed hooks...');
  console.log('');

  // Ensure ~/.claude/ exists
  const claudeDir = path.dirname(CLAUDE_SETTINGS_PATH);
  if (!fs.existsSync(claudeDir)) {
    fs.mkdirSync(claudeDir, { recursive: true });
  }

  // Read existing settings
  let settings = {};
  if (fs.existsSync(CLAUDE_SETTINGS_PATH)) {
    try {
      settings = JSON.parse(fs.readFileSync(CLAUDE_SETTINGS_PATH, 'utf8'));
    } catch (e) {
      console.log(`  Warning: Could not parse ${CLAUDE_SETTINGS_PATH}, starting fresh`);
    }
  }

  // Merge hooks (don't clobber existing ones)
  if (!settings.hooks) settings.hooks = {};

  for (const [event, config] of Object.entries(HOOKS_CONFIG)) {
    if (!settings.hooks[event]) {
      settings.hooks[event] = [];
    }

    // Check if our hook URL is already present
    const ourUrl = config[0].hooks[0].url;
    const alreadyExists = settings.hooks[event].some(entry =>
      entry.hooks && entry.hooks.some(h => h.url && h.url.includes('localhost:3456'))
    );

    if (!alreadyExists) {
      settings.hooks[event].push(...config);
      console.log(`  + Added ${event} hook`);
    } else {
      console.log(`  = ${event} hook already exists, skipping`);
    }
  }

  // Write back
  fs.writeFileSync(CLAUDE_SETTINGS_PATH, JSON.stringify(settings, null, 2));
  console.log('');
  console.log(`  Hooks installed to: ${CLAUDE_SETTINGS_PATH}`);
  console.log('  Start any Claude Code session and events will flow.');
  console.log('');
}

function uninstall() {
  console.log('');
  console.log('  Removing Claude From Bed hooks...');

  if (!fs.existsSync(CLAUDE_SETTINGS_PATH)) {
    console.log('  No settings file found. Nothing to remove.');
    return;
  }

  let settings = {};
  try {
    settings = JSON.parse(fs.readFileSync(CLAUDE_SETTINGS_PATH, 'utf8'));
  } catch (e) {
    console.log('  Could not parse settings file.');
    return;
  }

  if (!settings.hooks) {
    console.log('  No hooks found. Nothing to remove.');
    return;
  }

  let removed = 0;
  for (const event of Object.keys(settings.hooks)) {
    const before = settings.hooks[event].length;
    settings.hooks[event] = settings.hooks[event].filter(entry =>
      !(entry.hooks && entry.hooks.some(h => h.url && h.url.includes('localhost:3456')))
    );
    removed += before - settings.hooks[event].length;

    // Clean up empty arrays
    if (settings.hooks[event].length === 0) {
      delete settings.hooks[event];
    }
  }

  // Clean up empty hooks object
  if (Object.keys(settings.hooks).length === 0) {
    delete settings.hooks;
  }

  fs.writeFileSync(CLAUDE_SETTINGS_PATH, JSON.stringify(settings, null, 2));
  console.log(`  Removed ${removed} hook(s).`);
  console.log('');
}

// ── CLI router ─────────────────────────────────────────────────────────────────
const command = process.argv[2];

switch (command) {
  case 'setup':
    setup();
    break;

  case 'uninstall':
    uninstall();
    break;

  case 'start':
  case undefined:
    // Start the server
    const { startServer } = require(path.join(__dirname, '..', 'server', 'index.js'));
    startServer();
    break;

  default:
    console.log('');
    console.log('  Usage: claude-from-bed [command]');
    console.log('');
    console.log('  Commands:');
    console.log('    (none)      Start the bridge server');
    console.log('    setup       Install hooks into Claude Code settings');
    console.log('    uninstall   Remove hooks from Claude Code settings');
    console.log('');
    break;
}
