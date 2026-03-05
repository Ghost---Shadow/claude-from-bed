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
const CLAUDE_DESKTOP_CONFIG_PATH = process.platform === 'win32'
  ? path.join(process.env.APPDATA || '', 'Claude', 'claude_desktop_config.json')
  : path.join(os.homedir(), 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json');

const MCP_SERVER_PATH = path.resolve(path.join(__dirname, '..', 'server', 'mcp.js'));

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

function setupDesktop() {
  console.log('');
  console.log('  Setting up Claude From Bed as MCP server for Claude Desktop...');
  console.log('');

  // Ensure config directory exists
  const configDir = path.dirname(CLAUDE_DESKTOP_CONFIG_PATH);
  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true });
  }

  // Read existing config
  let config = {};
  if (fs.existsSync(CLAUDE_DESKTOP_CONFIG_PATH)) {
    try {
      config = JSON.parse(fs.readFileSync(CLAUDE_DESKTOP_CONFIG_PATH, 'utf8'));
    } catch (e) {
      console.log(`  Warning: Could not parse ${CLAUDE_DESKTOP_CONFIG_PATH}, starting fresh`);
    }
  }

  // Add MCP server
  if (!config.mcpServers) config.mcpServers = {};

  config.mcpServers['claude-from-bed'] = {
    command: 'npx',
    args: ['-y', 'claude-from-bed', 'mcp']
  };

  fs.writeFileSync(CLAUDE_DESKTOP_CONFIG_PATH, JSON.stringify(config, null, 2));
  console.log(`  + Registered MCP server: npx -y claude-from-bed mcp`);
  console.log(`  Config: ${CLAUDE_DESKTOP_CONFIG_PATH}`);
  console.log('');
  console.log('  Restart Claude Desktop to activate.');
  console.log('  The bridge server will auto-start with each session.');
  console.log('  Open the URL shown in Claude Desktop logs on your phone.');
  console.log('');
}

function setupMcpCli() {
  console.log('');
  console.log('  Setting up Claude From Bed as MCP server for Claude Code CLI...');
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

  // Add MCP server
  if (!settings.mcpServers) settings.mcpServers = {};

  settings.mcpServers['claude-from-bed'] = {
    command: 'npx',
    args: ['-y', 'claude-from-bed', 'mcp']
  };

  fs.writeFileSync(CLAUDE_SETTINGS_PATH, JSON.stringify(settings, null, 2));
  console.log(`  + Registered MCP server: npx -y claude-from-bed mcp`);
  console.log(`  Config: ${CLAUDE_SETTINGS_PATH}`);
  console.log('');
  console.log('  Start a new Claude Code session to activate.');
  console.log('');
}

function uninstallDesktop() {
  console.log('');
  console.log('  Removing Claude From Bed MCP server from Claude Desktop...');

  if (!fs.existsSync(CLAUDE_DESKTOP_CONFIG_PATH)) {
    console.log('  No config file found. Nothing to remove.');
    return;
  }

  let config = {};
  try {
    config = JSON.parse(fs.readFileSync(CLAUDE_DESKTOP_CONFIG_PATH, 'utf8'));
  } catch (e) {
    console.log('  Could not parse config file.');
    return;
  }

  if (config.mcpServers && config.mcpServers['claude-from-bed']) {
    delete config.mcpServers['claude-from-bed'];
    if (Object.keys(config.mcpServers).length === 0) delete config.mcpServers;
    fs.writeFileSync(CLAUDE_DESKTOP_CONFIG_PATH, JSON.stringify(config, null, 2));
    console.log('  Removed MCP server entry.');
  } else {
    console.log('  MCP server not found in config.');
  }
  console.log('');
}

// ── CLI router ─────────────────────────────────────────────────────────────────
const command = process.argv[2];

switch (command) {
  case 'setup':
    setup();
    break;

  case 'setup-desktop':
    setupDesktop();
    break;

  case 'setup-mcp':
    setupMcpCli();
    break;

  case 'uninstall':
    uninstall();
    break;

  case 'uninstall-desktop':
    uninstallDesktop();
    break;

  case 'mcp':
    // Start as MCP server (called by Claude Desktop/Code)
    require(path.join(__dirname, '..', 'server', 'mcp.js'));
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
    console.log('    (none)             Start the bridge server standalone');
    console.log('    mcp                Start as MCP server (used by Claude Desktop)');
    console.log('    setup              Install hooks into Claude Code settings');
    console.log('    setup-desktop      Register MCP server for Claude Desktop');
    console.log('    setup-mcp          Register MCP server for Claude Code CLI');
    console.log('    uninstall          Remove hooks from Claude Code settings');
    console.log('    uninstall-desktop  Remove MCP server from Claude Desktop');
    console.log('');
    break;
}
