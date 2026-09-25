'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { randomUUID } = require('node:crypto');
const { spawn: nativeSpawn } = require('node:child_process');
const { providerCapabilities, privateDirectory, folder, isDefaultHome } = require('./profiles.cjs');

const authKeys = Object.freeze({
  codex: ['OPENAI_API_KEY', 'CODEX_API_KEY', 'OPENAI_BASE_URL', 'OPENAI_ORG_ID', 'OPENAI_ORGANIZATION', 'OPENAI_PROJECT', 'CODEX_AUTH_TOKEN'],
  claude: ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_BASE_URL', 'ANTHROPIC_CUSTOM_HEADERS',
    'CLAUDE_CODE_OAUTH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN_FILE', 'CLAUDE_CODE_USE_BEDROCK',
    'CLAUDE_CODE_USE_VERTEX', 'CLAUDE_CODE_USE_FOUNDRY', 'ANTHROPIC_PROFILE', 'CLAUDE_SECURESTORAGE_CONFIG_DIR'],
});

function augmentedPath(env, platform) {
  const paths = Object.entries(env).find(([key]) => key.toUpperCase() === 'PATH')?.[1] || '';
  const home = env.HOME || env.USERPROFILE || os.homedir();
  const common = platform === 'win32'
    ? [env.APPDATA && path.join(env.APPDATA, 'npm'), path.join(home, '.local', 'bin')]
    : [path.join(home, '.local', 'bin'), '/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin'];
  return [paths, ...common.filter(Boolean)].join(platform === 'win32' ? ';' : ':');
}

function resolveExecutable(provider, override, env = process.env, { platform = process.platform } = {}) {
  if (!Object.hasOwn(providerCapabilities, provider)) return null;
  const extensions = platform === 'win32' ? ['.exe', '.cmd', '.bat', ''] : [''];
  const candidates = override ? [override] : augmentedPath(env, platform).split(platform === 'win32' ? ';' : ':')
    .filter(Boolean).flatMap(dir => extensions.map(ext => path.join(dir, provider + ext)));
  for (const candidate of candidates) {
    if (!path.isAbsolute(candidate)) continue;
    try {
      if (!fs.statSync(candidate).isFile()) continue;
      if (platform !== 'win32') fs.accessSync(candidate, fs.constants.X_OK);
      return fs.realpathSync.native(candidate);
    } catch { /* Continue through installed locations without exposing paths. */ }
  }
  return null;
}

function prepareEnvironment(provider, home, inherited = process.env, platform = process.platform, usesDefaultHome = false) {
  const selectors = provider === 'grok' ? ['GROK_HOME', 'GROK_API_KEY', 'XAI_API_KEY']
    : provider === 'devin' ? ['WINDSURF_API_SERVER_URL'] : [];
  const competing = [...new Set(Object.keys(inherited).filter(key => selectors.includes(key.toUpperCase()) && inherited[key])
    .map(key => key.toUpperCase()))];
  if (competing.length) throw new Error(`Conflicting existing-login environment settings: ${competing.join(', ')}. Restart the app without these overrides to open the same login used for usage.`);
  const env = { ...inherited };
  const clearedAuthKeys = [];
  const forbidden = new Set(authKeys[provider] || []);
  for (const key of Object.keys(env)) {
    if (forbidden.has(key.toUpperCase())) {
      clearedAuthKeys.push(key.toUpperCase());
      delete env[key];
    }
  }
  if (providerCapabilities[provider]?.isolated) {
    const selected = provider === 'codex' ? 'CODEX_HOME' : 'CLAUDE_CONFIG_DIR';
    for (const key of Object.keys(env)) if (key.toUpperCase() === selected) delete env[key];
    if (!(provider === 'claude' && usesDefaultHome)) env[selected] = home;
  }
  const envPath = augmentedPath(env, platform);
  for (const key of Object.keys(env)) if (key.toUpperCase() === 'PATH') delete env[key];
  env.PATH = envPath;
  return { env, clearedAuthKeys: [...new Set(clearedAuthKeys)].sort() };
}

function readSettings(file, parser) {
  if (!fs.existsSync(file)) return null;
  try {
    if (fs.statSync(file).size > 2 * 1024 * 1024) throw new Error();
    const parsed = parser(fs.readFileSync(file, 'utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error();
    return parsed;
  } catch { throw new Error('Provider settings could not be checked. Repair the settings before opening this account.'); }
}

function conflict(keys) {
  throw new Error(`Account launch blocked by authentication settings: ${[...new Set(keys)].join(', ')}. Review these settings in the provider before continuing.`);
}

function codexConflicts(config) {
  const keys = [];
  if (config.model_provider !== undefined && config.model_provider !== 'openai') keys.push('model_provider');
  if (config.forced_login_method && config.forced_login_method !== 'chatgpt') keys.push('forced_login_method');
  if (config.cli_auth_credentials_store && !['file', 'keyring', 'auto'].includes(config.cli_auth_credentials_store)) keys.push('cli_auth_credentials_store');
  if (config.model_providers?.openai) keys.push('model_providers.openai');
  if (config.chatgpt_base_url) keys.push('chatgpt_base_url');
  if (config.profile && config.profiles?.[config.profile]) keys.push(...codexConflicts(config.profiles[config.profile]));
  return keys;
}

function claudeConflicts(config) {
  const keys = [];
  if (config.apiKeyHelper) keys.push('apiKeyHelper');
  if (config.forceLoginMethod && config.forceLoginMethod !== 'claudeai') keys.push('forceLoginMethod');
  for (const key of Object.keys(config.env || {})) if (authKeys.claude.includes(key.toUpperCase())) keys.push(`env.${key.toUpperCase()}`);
  return keys;
}

function ancestors(workspace) {
  const dirs = [];
  for (let current = workspace; current; current = path.dirname(current)) {
    dirs.push(current);
    if (fs.existsSync(path.join(current, '.git'))) return dirs;
    if (path.dirname(current) === current) break;
  }
  // A folder outside a repository has no inherited project configuration.
  return [workspace];
}

function assertCompatibleSettings(profile, workspace, { platform = process.platform, env = process.env, managedPaths } = {}) {
  if (!providerCapabilities[profile.provider]?.isolated) return;
  const files = [];
  if (profile.provider === 'codex') {
    files.push(path.join(profile.home, 'config.toml'));
    for (const directory of ancestors(workspace)) files.push(path.join(directory, '.codex', 'config.toml'));
    const parse = require('smol-toml').parse;
    for (const file of new Set(files)) {
      const config = readSettings(file, parse);
      if (config) { const keys = codexConflicts(config); if (keys.length) conflict(keys); }
    }
    const auth = readSettings(path.join(profile.home, 'auth.json'), JSON.parse);
    if (auth && (auth.auth_mode === 'apikey' || (auth.OPENAI_API_KEY && !auth.tokens))) conflict(['auth_mode']);
  } else {
    files.push(path.join(profile.home, 'settings.json'), path.join(profile.home, 'settings.local.json'));
    for (const directory of ancestors(workspace)) {
      files.push(path.join(directory, '.claude', 'settings.json'), path.join(directory, '.claude', 'settings.local.json'));
    }
    const policy = managedPaths || (platform === 'win32'
      ? [path.join(env.ProgramFiles || 'C:\\Program Files', 'ClaudeCode', 'managed-settings.json')]
      : ['/Library/Application Support/ClaudeCode/managed-settings.json', '/etc/claude-code/managed-settings.json']);
    files.push(...policy);
    for (const file of new Set(files)) {
      const config = readSettings(file, JSON.parse);
      if (config) { const keys = claudeConflicts(config); if (keys.length) conflict(keys); }
    }
  }
}

function checkedArguments(provider, args) {
  if (!Array.isArray(args) || args.length > 100 || args.some(arg => typeof arg !== 'string' || arg.length > 32768 || /[\x00\r\n]/.test(arg))) {
    throw new Error('Invalid CLI arguments.');
  }
  const overrides = provider === 'codex' ? ['--config', '-c', '--profile', '-p', '--cd', '-C']
    : provider === 'claude' ? ['--settings', '--setting-sources'] : [];
  if (args.some(arg => overrides.some(flag => arg === flag || arg.startsWith(`${flag}=`) ||
    (flag.length === 2 && arg.startsWith(flag))))) {
    throw new Error('Configuration overrides require a separately linked profile. Choose its profile and project folder in the app.');
  }
  return args.slice();
}

function resolveInvocation(executable, args, runtime, platform) {
  if (platform !== 'win32' || !/\.(cmd|bat)$/i.test(executable)) return { executable, args };
  // Global npm shims cause another cmd.exe expansion of %*. Avoid the shell entirely.
  // Read only a static JavaScript target from the standard npm node shim format.
  let script;
  try {
    const contents = fs.readFileSync(executable, 'utf8');
    if (contents.length > 32768 || !/SET\s+"_prog=node"/i.test(contents)) throw new Error();
    const match = contents.match(/"%(?:dp0%|~dp0)\\?([^"%\r\n]+\.(?:[cm]?js))"\s+%\*\s*$/im);
    if (!match || !/"%_prog%"/.test(contents)) throw new Error();
    script = fs.realpathSync.native(path.resolve(path.dirname(executable), match[1]));
    if (!fs.statSync(script).isFile()) throw new Error();
  } catch { throw new Error('This batch launcher is unsupported. Choose the official agent executable or its npm installation.'); }
  if (!path.isAbsolute(runtime || '')) throw new Error('A bundled Node runtime is required for this agent installation.');
  return { executable: runtime, args: [script, ...args] };
}

const minimumVersions = Object.freeze({ codex: '0.156.0', claude: '2.1.63' });

function versionError(provider) {
  const name = provider === 'codex' ? 'Codex' : 'Claude Code';
  return new Error(`${name} ${minimumVersions[provider]} or newer is required for isolated accounts. Update using the provider's installation guide, then choose the official executable and try again.`);
}

function supportedVersion(provider, output) {
  const pattern = provider === 'codex' ? /^codex-cli (\d+)\.(\d+)\.(\d+)$/ : /^(\d+)\.(\d+)\.(\d+) \(Claude Code\)$/;
  const match = typeof output === 'string' ? output.trim().match(pattern) : null;
  if (!match || !minimumVersions[provider]) throw versionError(provider);
  const installed = match.slice(1).map(Number);
  const minimum = minimumVersions[provider].split('.').map(Number);
  if (installed.some(part => !Number.isSafeInteger(part))) throw versionError(provider);
  for (let index = 0; index < 3; index++) {
    if (installed[index] > minimum[index]) break;
    if (installed[index] < minimum[index]) throw versionError(provider);
  }
  return installed.join('.');
}

function readVersionOutput(invocation, { env, cwd, timeoutMs = 5000 } = {}) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = nativeSpawn(invocation.executable, invocation.args, {
        env, cwd, stdio: ['ignore', 'pipe', 'ignore'], shell: false, windowsHide: true,
      });
    } catch { reject(new Error('Agent version could not be checked.')); return; }
    let stdout = '';
    let failed = false;
    const stop = () => { failed = true; stdout = ''; child.kill(); };
    const timer = setTimeout(stop, timeoutMs);
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', chunk => {
      if (failed) return;
      stdout += chunk;
      if (stdout.length > 4096) stop();
    });
    child.once('error', () => { failed = true; });
    child.once('close', code => {
      clearTimeout(timer);
      if (failed || code !== 0) reject(new Error('Agent version could not be checked.'));
      else resolve(stdout);
    });
  });
}

function prepareLaunch(profile, options) {
  const { platform = process.platform, env = process.env, action = 'launch' } = options;
  const capability = profile && Object.hasOwn(providerCapabilities, profile.provider) ? providerCapabilities[profile.provider] : null;
  if (!capability) throw new Error('Unsupported provider.');
  const selectedHome = capability.isolated || profile.home ? folder(profile.home, 'Profile folder') : null;
  const home = capability.isolated ? selectedHome : null;
  const sharesDefaultHome = !!profile.sharesDefaultHome || isDefaultHome(profile.provider, home);
  const usesDefaultHome = profile.usesDefaultHome === true;
  if (usesDefaultHome && !sharesDefaultHome) throw new Error('Invalid default login folder.');
  if (!['launch', 'login'].includes(action) || (action === 'login' && (!capability.login || sharesDefaultHome))) {
    throw new Error('This provider supports existing-login launches only.');
  }
  const workspace = folder(profile.workspace || env.HOME || env.USERPROFILE || os.homedir(), 'Project folder');
  if (selectedHome) {
    const relative = path.relative(fs.realpathSync.native(selectedHome), fs.realpathSync.native(workspace));
    if (!relative || (relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative))) {
      throw new Error('Choose a project folder outside the account profile folder. Credential folders cannot be used as projects.');
    }
  }
  const executable = resolveExecutable(profile.provider, profile.cli, env, { platform });
  if (!executable) throw new Error('Agent CLI not found. Install it using the provider instructions or choose its executable.');
  assertCompatibleSettings({ ...profile, home }, workspace, options);
  const args = action === 'login' ? (profile.provider === 'codex' ? ['login'] : ['auth', 'login']) : checkedArguments(profile.provider, options.args || []);
  const invocation = resolveInvocation(executable, args, options.runtime || process.execPath, platform);
  const versionCommand = resolveInvocation(executable, ['--version'], options.runtime || process.execPath, platform);
  const prepared = prepareEnvironment(profile.provider, home, env, platform, usesDefaultHome);
  return { plan: { version: 1, provider: profile.provider, home, usesDefaultHome, sharesDefaultHome, cwd: workspace, ...invocation }, versionCommand, ...prepared };
}

function quotePowerShell(value) { return `'${value.replace(/'/g, "''")}'`; }
function quoteShell(value) { return `'${value.replace(/'/g, "'\\''")}'`; }

function terminalSpecification({ runtime, runnerPath, planPath, commandPath, platform = process.platform, env = process.env }) {
  if ([runtime, runnerPath, planPath].some(value => typeof value !== 'string' || /[\x00\r\n]/.test(value) || !path.isAbsolute(value))) {
    throw new Error('Terminal runtime paths must be absolute.');
  }
  if (platform === 'win32') {
    const command = `& ${[runtime, runnerPath, planPath].map(quotePowerShell).join(' ')}; Write-Host ''; Read-Host 'Session finished. Press Enter to close'`;
    return {
      executable: path.join(env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
      args: ['-NoLogo', '-NoProfile', '-EncodedCommand', Buffer.from(command, 'utf16le').toString('base64')],
    };
  }
  if (platform === 'darwin') {
    if (!commandPath || !path.isAbsolute(commandPath)) throw new Error('Terminal command path must be absolute.');
    const script = `#!/bin/sh\n${[runtime, runnerPath, planPath].map(quoteShell).join(' ')}\nprintf '\\nSession finished. Press Enter to close. '\nread -r ignored\n`;
    return { executable: '/usr/bin/open', args: ['-a', 'Terminal', commandPath], script };
  }
  throw new Error('Desktop terminal launching supports Windows and macOS.');
}

async function launchProfile(profile, options) {
  const prepared = prepareLaunch(profile, options);
  if (providerCapabilities[profile.provider].isolated && !prepared.plan.usesDefaultHome) {
    try {
      const output = await (options.versionReader || readVersionOutput)(prepared.versionCommand, {
        env: prepared.env, cwd: prepared.plan.cwd,
      });
      prepared.plan.checkedCliVersion = supportedVersion(profile.provider, output);
    } catch { throw versionError(profile.provider); }
  }
  if (!path.isAbsolute(options.dataRoot || '')) throw new Error('Private launch folder is required.');
  const directory = privateDirectory(path.join(privateDirectory(options.dataRoot), 'launches'));
  const planPath = path.join(directory, `${randomUUID()}.json`);
  const commandPath = planPath.replace(/\.json$/, '.command');
  const specification = terminalSpecification({ ...options, planPath, commandPath });
  prepared.plan.commandPath = specification.script ? commandPath : null;
  fs.writeFileSync(planPath, JSON.stringify(prepared.plan), { flag: 'wx', mode: 0o600 });
  if (specification.script) fs.writeFileSync(commandPath, specification.script, { flag: 'wx', mode: 0o700 });
  try {
    const child = (options.spawn || nativeSpawn)(specification.executable, specification.args, {
      detached: true, stdio: 'ignore', windowsHide: false, env: prepared.env,
    });
    await new Promise((resolve, reject) => {
      child.once('error', () => reject(new Error('Could not open a terminal. Check that the system terminal is available.')));
      if ((options.platform || process.platform) === 'darwin') {
        child.once('exit', code => code === 0 ? resolve() : reject(new Error('Could not open Terminal.')));
      } else child.once('spawn', resolve);
    });
    child.unref();
    return { started: true, clearedAuthKeys: prepared.clearedAuthKeys };
  } catch (error) {
    for (const file of [planPath, commandPath]) if (fs.existsSync(file)) fs.unlinkSync(file);
    throw error;
  }
}

module.exports = { authKeys, resolveExecutable, prepareEnvironment, assertCompatibleSettings,
  checkedArguments, resolveInvocation, minimumVersions, supportedVersion, readVersionOutput,
  prepareLaunch, terminalSpecification, launchProfile };
