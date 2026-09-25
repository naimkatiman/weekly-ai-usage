'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { createHash } = require('node:crypto');
const { execFile } = require('node:child_process');
const { parse: parseToml } = require('smol-toml');

const LIMIT = 2 * 1024 * 1024;
function failure(code, message) { return Object.assign(new Error(message), { code }); }
function textFile(file) {
  try {
    const fd = fs.openSync(file, 'r');
    try {
      if (fs.fstatSync(fd).size > LIMIT) throw failure('credential_unreadable', 'Provider login data is too large.');
      return fs.readFileSync(fd, 'utf8').replace(/^\uFEFF/, '');
    } finally { fs.closeSync(fd); }
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw failure('credential_unreadable', 'Provider login data could not be read. Check local file permissions.');
  }
}
function json(text) {
  if (text == null) return null;
  try { return JSON.parse(text); }
  catch { throw failure('credential_unreadable', 'Provider login data is unreadable. Reconnect this account.'); }
}
function jwt(token) {
  try { return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8')); }
  catch { return {}; }
}
function email(value) { return typeof value === 'string' && /^[^\s@]+@[^\s@]+$/.test(value) ? value : null; }
function sameEmail(a, b) { return email(a) && email(b) && a.toLowerCase() === b.toLowerCase(); }
function location(profile, options = {}) {
  if (!['codex', 'claude'].includes(profile.provider)) throw failure('provider_unsupported', 'This provider does not support local account discovery.');
  const userRoot = options.userRoot || os.homedir();
  const home = profile.home ? profile.home.replace(/^~(?=$|[\\/])/, userRoot).normalize('NFC') : path.join(userRoot, '.' + profile.provider);
  if (!path.isAbsolute(home)) throw failure('home_invalid', 'Choose an absolute provider profile folder.');
  return { home, userRoot };
}
function digest(value, size) { return createHash('sha256').update(value).digest('hex').slice(0, size); }

// Codex upstream login/src/auth/storage.rs, direct backend. Canonicalize only
// Codex homes: Claude hashes the NFC-normalized CLAUDE_CONFIG_DIR string itself.
function keychainEntry(profile, options = {}) {
  const { home } = location(profile, options);
  if (profile.provider === 'codex') {
    let canonical = home;
    try { canonical = fs.realpathSync.native(home); } catch { /* Same fallback as the CLI. */ }
    return { service: 'Codex Auth', account: 'cli|' + digest(canonical, 16) };
  }
  let account = options.username || process.env.USER;
  if (!account) { try { account = os.userInfo().username; } catch { account = 'claude-code-user'; } }
  // Verified against Anthropic's published CLI 2.1.63. Setting an explicit home,
  // including ~/.claude, selects a suffixed entry. No bare-entry fallback.
  return { service: 'Claude Code-credentials' + (profile.home ? '-' + digest(home, 8) : ''), account };
}

// Only one selected generic-password entry is queried. Never enumerate stores,
// run a shell, log subprocess errors, or return credentials to the renderer.
function keychainRead(entry, options = {}) {
  const run = options.execFile || execFile;
  const args = ['find-generic-password', '-s', entry.service, '-a', entry.account, '-w'];
  // Test-only injection permits a disposable CI keychain without touching the
  // login keychain or the user's search list. Production callers omit this.
  if (options.keychainPath) args.push(options.keychainPath);
  return new Promise((resolve, reject) => {
    run('/usr/bin/security', args, { timeout: 8000, maxBuffer: LIMIT, encoding: 'utf8', windowsHide: true }, (error, stdout) => {
      if (error) {
        if (error.code === 44) return resolve(null); // errSecItemNotFound
        return reject(failure('keychain_unavailable', 'Keychain access is unavailable. Unlock it or allow access, then refresh.'));
      }
      if (typeof stdout !== 'string' || stdout.length > LIMIT) return reject(failure('credential_unreadable', 'Provider login data is unreadable. Reconnect this account.'));
      resolve(stdout.trim() || null);
    });
  });
}

function codexStore(home) {
  let config;
  try { config = parseToml(textFile(path.join(home, 'config.toml')) || ''); }
  catch { throw failure('store_unsupported', 'This Codex credential storage configuration could not be read. Check its config file.'); }
  const mode = config.cli_auth_credentials_store ?? 'file';
  if (!['file', 'keyring', 'auto', 'ephemeral'].includes(mode))
    throw failure('store_unsupported', 'This Codex credential storage configuration is not supported for quota reads.');
  // Current Codex enables encrypted auth using this feature. Do not query an
  // obsolete direct-Keychain token when the new backend has been selected.
  const secrets = config.features?.secret_auth_storage;
  if (secrets !== undefined && typeof secrets !== 'boolean')
    throw failure('store_unsupported', 'This Codex credential storage configuration is not supported for quota reads.');
  return { mode, secrets: secrets === true };
}
function fileAuth(profile, options = {}) {
  const { home, userRoot } = location(profile, options);
  const auth = json(textFile(path.join(home, profile.provider === 'codex' ? 'auth.json' : '.credentials.json')));
  if (profile.provider === 'codex') return { auth, email: email(jwt(auth?.tokens?.id_token).email) };
  const legacy = path.join(home, '.config.json');
  const identityFile = fs.existsSync(legacy) ? legacy : path.join(profile.home ? home : userRoot, '.claude.json');
  const identity = json(textFile(identityFile));
  return { auth, email: email(identity?.oauthAccount?.emailAddress) };
}
async function selectedAuth(profile, options = {}) {
  const { home } = location(profile, options);
  const platform = options.platform || process.platform;
  const store = profile.provider === 'codex' ? codexStore(home) : { mode: platform === 'darwin' ? 'auto' : 'file' };
  if (store.mode === 'ephemeral') throw failure('store_unsupported', 'This login exists only inside the agent process. Quota cannot be read here.');
  if (store.mode === 'file') return fileAuth(profile, options);
  if (platform !== 'darwin' || store.secrets)
    throw failure('store_unsupported', 'This credential store is not supported for quota reads. Open the agent to check usage.');
  let auth, keychainError;
  try { auth = json(await (options.keychainRead || keychainRead)(keychainEntry(profile, options))); }
  catch (error) { keychainError = error.code === 'credential_unreadable' ? error : failure('keychain_unavailable', 'Keychain access is unavailable. Unlock it or allow access, then refresh.'); }
  if (auth) {
    if (profile.provider === 'codex') return { auth, email: email(jwt(auth.tokens?.id_token).email) };
    // Claude's opaque OAuth token has no local identity claim. Its selected
    // config identity is verified again through /api/oauth/profile before usage.
    const local = fileAuthIdentity(profile, options);
    return { auth, email: local };
  }
  if (store.mode === 'auto') {
    const fallback = fileAuth(profile, options);
    if (fallback.auth) return fallback;
  }
  if (keychainError) throw keychainError;
  return { auth: null, email: null };
}
function fileAuthIdentity(profile, options = {}) {
  const { home, userRoot } = location(profile, options);
  const legacy = path.join(home, '.config.json');
  const file = fs.existsSync(legacy) ? legacy : path.join(profile.home ? home : userRoot, '.claude.json');
  return email(json(textFile(file))?.oauthAccount?.emailAddress);
}
function credential(profile, selected) {
  if (!sameEmail(selected.email, profile.email)) throw failure('identity_mismatch', 'No matching ' + profile.provider + ' login found. Check this profile folder and reconnect.');
  const auth = selected.auth;
  const c = profile.provider === 'codex' ? {
    token: auth?.tokens?.access_token, expires: (jwt(auth?.tokens?.access_token).exp || 0) * 1000,
    accountId: auth?.tokens?.account_id,
  } : {
    token: auth?.claudeAiOauth?.accessToken, expires: auth?.claudeAiOauth?.expiresAt,
    plan: auth?.claudeAiOauth?.rateLimitTier?.includes('20x') ? 'Max 20x' :
      auth?.claudeAiOauth?.rateLimitTier?.includes('5x') ? 'Max 5x' : auth?.claudeAiOauth?.subscriptionType,
  };
  if (typeof c.token !== 'string' || !c.token) throw failure('login_missing', 'No matching ' + profile.provider + ' login found. Reconnect this account.');
  if (!(c.expires > Date.now())) throw failure('login_expired', 'Login expired. Open this account in the agent to renew its login.');
  return c;
}
async function readCredentials(profile, options = {}) { return credential(profile, await selectedAuth(profile, options)); }
async function readIdentity(profile, options = {}) {
  const selected = await selectedAuth(profile, options);
  return selected.auth && selected.email ? { email: selected.email } : null;
}
// Preserve the legacy synchronous collector API for file-backed Windows callers.
// An explicit home is now strict, so it can never borrow a default login.
function credentials(profile, userRoot = os.homedir()) { return credential(profile, fileAuth(profile, { userRoot })); }

module.exports = { credentials, readCredentials, readIdentity, keychainEntry, keychainRead };
