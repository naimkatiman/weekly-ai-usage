'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { createHash } = require('node:crypto');
const { ProfileStore, providerCapabilities, privateDirectory } = require('../core/profiles.cjs');
const { resolveExecutable, launchProfile } = require('../core/launch.cjs');
const { readIdentity } = require('../credentials.cjs');
const { collect, loadAccounts } = require('../collect.cjs');

const emailPattern = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
function redact(value) {
  return String(value || '').replace(emailPattern, '[account]')
    .replace(/(?:[A-Z]:[\\/]|\/(?:Users|home|private|tmp)\/)[^\r\n]*/gi, '[local path]')
    .replace(/(?:sk-[A-Za-z0-9_-]{12,}|eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)/g, '[private value]');
}
function publicError(error) {
  const message = String(error?.message || '');
  if (/keychain/i.test(message)) return 'Keychain access is unavailable. Unlock it or allow access, then refresh.';
  if (/identity|mismatch/i.test(message)) return 'This login belongs to a different account. Reconnect the intended profile.';
  if (/expired|revoked|access denied|HTTP 40[13]/i.test(message)) return 'Sign in again with this account, then refresh.';
  if (/not found|login missing|matching.*login|not signed/i.test(message)) return 'No matching login. Sign in with this account, then refresh.';
  if (/Network|timed out|rate limit|HTTP 429/i.test(message)) return 'Usage could not be read. Check connectivity and try again later.';
  if (/ENOENT|EACCES|EPERM|EISDIR|ENOTDIR/.test(message)) return 'The selected file or folder is unavailable. Check access and try again.';
  if (/^(Invalid|Unsupported|Account|Profile|CLI|Codex|Claude|Agent|Workspace|Nickname|Choose|Select|Cannot|Default|Launch|Provider|Sign|Existing|Conflicting|Authentication|The |A |Only |This )/.test(message))
    return redact(message).slice(0, 240);
  return 'This action could not finish. Check the selected profile and try again.';
}
function emptyUsage(message = 'Refresh to check this account.') {
  return { status: 'Unavailable', weekly: { used: null, remaining: null, reset: null }, session: null, capturedAt: null, message };
}
function selectionKey(profile) { return JSON.stringify([profile.provider, profile.home, profile.email, profile.cli, profile.usesDefaultHome]); }
function publicReading(reading) {
  const number = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100 ? value : null;
  const date = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;
  const quota = value => ({ used: number(value?.used), remaining: number(value?.remaining), reset: date(value?.reset) });
  return { status: ['Live', 'Stale', 'Unavailable', 'Reset pending'].includes(reading?.status) ? reading.status : 'Unavailable',
    weekly: quota(reading?.weekly), session: quota(reading?.session), sessionLabel: reading?.sessionLabel === 'Daily' ? 'Daily' : '5 hours',
    capturedAt: date(reading?.capturedAt), checkedAt: date(reading?.checkedAt), plan: redact(reading?.plan).slice(0, 60),
    message: redact(reading?.message).slice(0, 240) };
}

class DesktopController {
  constructor({ dataRoot, runtime, runnerPath, userHome = os.homedir(), platform = process.platform,
    identityReader = readIdentity, collector = collect, launcher = launchProfile, executableResolver = resolveExecutable } = {}) {
    privateDirectory(dataRoot);
    this.store = new ProfileStore(dataRoot, { userHome });
    Object.assign(this, { dataRoot, runtime, runnerPath, userHome, platform, identityReader, collector, launcher, executableResolver });
    this.cacheFile = path.join(dataRoot, 'quota-cache.json');
    this.cache = {};
    try {
      if (fs.statSync(this.cacheFile).size < 1024 * 1024) this.cache = JSON.parse(fs.readFileSync(this.cacheFile, 'utf8'));
    } catch { /* No private cache is required for startup. */ }
    this.identities = new Map(); this.errors = new Map(); this.refreshing = false;
  }
  profile(id) {
    const profile = this.store.load().profiles.find(p => p.id === id);
    if (!profile) throw new Error('Account not found.');
    return profile;
  }
  capabilities(profile) {
    const base = providerCapabilities[profile.provider];
    let canLaunch = base.launch;
    if (profile.provider === 'grok' && profile.home) {
      let defaultHome = path.join(this.userHome, '.grok');
      try { defaultHome = fs.realpathSync.native(defaultHome); } catch { /* Missing default is not linked. */ }
      canLaunch = this.platform === 'win32' ? profile.home.toLowerCase() === defaultHome.toLowerCase() : profile.home === defaultHome;
    }
    if (profile.provider === 'devin' && profile.home) canLaunch = false;
    return { usage: base.usage, launch: canLaunch, connect: base.login && !profile.sharesDefaultHome,
      isolated: base.isolated && !profile.sharesDefaultHome };
  }
  accountInput(profile, email) {
    return { provider: profile.provider, label: profile.label, email,
      home: profile.usesDefaultHome ? null : profile.home, cli: profile.cli || undefined };
  }
  identityKey(profile, email) {
    return createHash('sha256').update([profile.provider, profile.home || '', profile.usesDefaultHome ? 'default' : 'explicit', email.toLowerCase()].join('\0')).digest('hex');
  }
  state() {
    const data = this.store.load();
    const profiles = data.profiles.map(profile => {
      const cached = this.cache[profile.id];
      let usage = cached?.reading && profile.email && cached.identityKey === this.identityKey(profile, profile.email)
        ? publicReading(cached.reading) : emptyUsage(this.errors.get(profile.id));
      const captured = Date.parse(usage.capturedAt);
      if (usage.status === 'Live' && (!Number.isFinite(captured) || Date.now() - captured > 20 * 60000)) usage.status = 'Stale';
      if (usage.weekly?.reset && Date.parse(usage.weekly.reset) <= Date.now()) {
        usage = { ...usage, status: 'Reset pending', weekly: { used: null, remaining: null, reset: usage.weekly.reset },
          message: 'Waiting for a new reading after the reported reset.' };
      }
      if (Number.isFinite(captured) && Date.now() - captured > 86400000) usage = emptyUsage('The last reading is too old. Refresh this account.');
      usage.message = this.errors.get(profile.id) || usage.message;
      const result = { id: profile.id, provider: profile.provider, label: data.privacy ? redact(profile.label) : profile.label,
        usesDefaultHome: profile.usesDefaultHome, sharesDefaultHome: profile.sharesDefaultHome,
        hasHome: Boolean(profile.home), hasEmail: Boolean(profile.email), capabilities: this.capabilities(profile),
        cliAvailable: Boolean(this.executableResolver(profile.provider, profile.cli, process.env, { platform: this.platform })), usage };
      if (!data.privacy) Object.assign(result, { email: this.identities.get(profile.id) || profile.email || null,
        home: profile.home, workspace: profile.workspace, cli: profile.cli });
      return result;
    });
    return { profiles, privacy: data.privacy, defaultProfileId: data.defaultProfileId, platform: this.platform, refreshing: this.refreshing };
  }
  addProfile(input) { this.store.add(input); return this.state(); }
  updateProfile(id, patch) {
    this.store.update(id, patch); delete this.cache[id]; this.identities.delete(id); this.errors.delete(id);
    this.saveCache(); return this.state();
  }
  removeProfile(id) {
    this.store.remove(id); delete this.cache[id]; this.identities.delete(id); this.errors.delete(id);
    this.saveCache(); return this.state();
  }
  setPrivacy(enabled) { this.store.setPrivacy(enabled); return this.state(); }
  setDefault(id) { this.store.setDefault(id); return this.state(); }
  saveCache() {
    const ids = new Set(this.store.load().profiles.map(p => p.id));
    const clean = Object.fromEntries(Object.entries(this.cache).filter(([id]) => ids.has(id)));
    const temporary = this.cacheFile + '.' + process.pid + '.tmp';
    try {
      fs.writeFileSync(temporary, JSON.stringify(clean), { mode: 0o600 });
      fs.renameSync(temporary, this.cacheFile);
    } catch { /* A read-only cache must not prevent account launch or setup. */ }
    finally { try { fs.unlinkSync(temporary); } catch { /* Already renamed. */ } }
  }
  async refreshUsage() {
    if (this.refreshing) return this.state();
    this.refreshing = true;
    try {
      const profiles = this.store.load().profiles;
      await Promise.all(profiles.map(async profile => {
        try {
          let email = profile.email;
          if (['codex', 'claude'].includes(profile.provider)) {
            const identity = await this.identityReader({ ...profile, home: profile.usesDefaultHome ? null : profile.home },
              { platform: this.platform, userRoot: this.userHome });
            const current = this.store.load().profiles.find(p => p.id === profile.id);
            if (!current || selectionKey(current) !== selectionKey(profile)) return;
            if (identity?.email) {
              if (email && email.toLowerCase() !== identity.email.toLowerCase()) {
                delete this.cache[profile.id]; throw new Error('Account identity mismatch.');
              }
              email = identity.email;
              this.identities.set(profile.id, email);
              if (!profile.email) { this.store.update(profile.id, { email }); profile.email = email; }
            }
          }
          if (!email) throw new Error(['codex', 'claude'].includes(profile.provider)
            ? 'No matching login.' : 'Account email is needed for usage. Add it in the account settings.');
          const key = this.identityKey(profile, email);
          const accounts = loadAccounts({ accounts: [this.accountInput(profile, email)] });
          const previous = this.cache[profile.id]?.identityKey === key ? {
            accounts: [{ ...this.cache[profile.id].reading, id: accounts[0].id, email }],
          } : null;
          const snapshot = await this.collector(accounts, previous, { platform: this.platform, userRoot: this.userHome });
          const row = snapshot.accounts[0];
          const current = this.store.load().profiles.find(p => p.id === profile.id);
          if (!current || selectionKey(current) !== selectionKey(profile)) return;
          if (/identity mismatch|different account/i.test(row.message || '')) {
            delete this.cache[profile.id]; throw new Error('Account identity mismatch.');
          }
          this.cache[profile.id] = { identityKey: key, reading: {
            status: row.status, weekly: row.weekly, session: row.session, sessionLabel: row.sessionLabel,
            capturedAt: row.capturedAt, checkedAt: row.checkedAt, plan: redact(row.plan),
            message: row.message ? publicError(new Error(row.message)) : '',
          } };
          this.errors.delete(profile.id);
        } catch (error) {
          const current = this.store.load().profiles.find(p => p.id === profile.id);
          if (!current || selectionKey(current) !== selectionKey(profile)) return;
          this.errors.set(profile.id, publicError(error));
          if (this.cache[profile.id]?.reading) this.cache[profile.id].reading.status = 'Stale';
        }
      }));
      this.saveCache();
    } finally { this.refreshing = false; }
    return this.state();
  }
  async launch(id, action) {
    if (!['launch', 'login'].includes(action)) throw new Error('Invalid account action.');
    const profile = this.profile(id);
    const capabilities = this.capabilities(profile);
    if (action === 'launch' && !capabilities.launch) throw new Error('This profile supports usage only. Isolated account launching is not available for this agent.');
    if (action === 'login' && !capabilities.connect) throw new Error('This linked login cannot be changed by the app. Create an isolated account to sign in separately.');
    return this.launcher(profile, { action, runtime: this.runtime, runnerPath: this.runnerPath, dataRoot: this.dataRoot, platform: this.platform });
  }
  discoverHomes() {
    const homes = [];
    for (const provider of ['codex', 'claude']) {
      const parent = path.join(this.userHome, '.agent-auth', 'homes', provider);
      let entries;
      try { entries = fs.readdirSync(parent, { withFileTypes: true }); } catch { continue; }
      for (const entry of entries) {
        if (entry.name.startsWith('.') || homes.length >= 100) continue;
        const home = path.join(parent, entry.name);
        try {
          if (fs.statSync(home).isDirectory()) homes.push({ provider, label: entry.name, home });
        } catch { /* A removed home is not imported. No credential file is read. */ }
      }
    }
    return homes;
  }
  importHomes() {
    let imported = 0, skipped = 0;
    for (const home of this.discoverHomes()) {
      try { this.store.add({ ...home, createNew: false }); imported++; }
      catch { skipped++; }
    }
    return { ...this.state(), importResult: { imported, skipped } };
  }
  importLegacy(file) {
    if (!path.isAbsolute(file) || fs.statSync(file).size > 1024 * 1024) throw new Error('Invalid account configuration file.');
    const config = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
    if (!Array.isArray(config.accounts) || config.accounts.length > 500) throw new Error('Invalid legacy account configuration.');
    let imported = 0, skipped = 0;
    for (const entry of config.accounts) {
      try {
        if (!Object.hasOwn(providerCapabilities, entry?.provider)) throw new Error();
        const defaultLogin = !entry.home && ['codex', 'claude'].includes(entry.provider);
        let home = entry.home || (entry.provider === 'grok' ? path.join(this.userHome, '.grok') : null);
        if (home?.startsWith('~')) home = path.join(this.userHome, home.slice(1));
        if (home && !path.isAbsolute(home)) home = path.resolve(path.dirname(file), home);
        this.store.add({ provider: entry.provider, label: entry.label || `${entry.provider} ${imported + 1}`,
          email: entry.email, home, cli: entry.cli, createNew: false, defaultLogin });
        imported++;
      } catch { skipped++; }
    }
    return { ...this.state(), importResult: { imported, skipped } };
  }
}
module.exports = { DesktopController, publicError, redact, emptyUsage };
