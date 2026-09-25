'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { randomUUID } = require('node:crypto');
const sourceText = Symbol('sourceText');

const providerCapabilities = Object.freeze({
  codex: Object.freeze({ isolated: true, login: true, launch: true, usage: true }),
  claude: Object.freeze({ isolated: true, login: true, launch: true, usage: true }),
  grok: Object.freeze({ isolated: false, login: false, launch: true, usage: true }),
  devin: Object.freeze({ isolated: false, login: false, launch: true, usage: true }),
});

function privateDirectory(folder) {
  fs.mkdirSync(folder, { recursive: true, mode: 0o700 });
  if (process.platform !== 'win32') fs.chmodSync(folder, 0o700);
  return folder;
}

function text(value, name, max = 200) {
  if (typeof value !== 'string' || !value.trim() || value.length > max || /[\x00-\x1f\x7f]/.test(value)) {
    throw new Error(`Invalid ${name}.`);
  }
  return value.trim();
}

function folder(value, name) {
  text(value, name, 4096);
  if (!path.isAbsolute(value)) throw new Error(`${name} must be an absolute folder path.`);
  try {
    const resolved = fs.realpathSync.native(value);
    if (!fs.statSync(resolved).isDirectory()) throw new Error();
    // Claude's macOS Keychain namespace depends on the original config-dir string.
    return value;
  } catch { throw new Error(`${name} is not an accessible folder.`); }
}

function executable(value) {
  text(value, 'CLI path', 4096);
  if (!path.isAbsolute(value)) throw new Error('CLI path must be absolute.');
  try {
    const resolved = fs.realpathSync.native(value);
    if (!fs.statSync(resolved).isFile()) throw new Error();
    return resolved;
  } catch { throw new Error('CLI path is not an accessible file.'); }
}

function email(value) {
  if (value === undefined || value === null || value === '') return null;
  const result = text(value, 'account email', 254);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(result)) throw new Error('Invalid account email.');
  return result;
}

function pathKey(value) {
  return process.platform === 'win32' ? value.toLowerCase() : value;
}

function physicalPathKey(value) {
  try { return pathKey(fs.realpathSync.native(value)); }
  catch { return pathKey(path.resolve(value)); }
}

function isDefaultHome(provider, home, userHome = os.homedir()) {
  if (!providerCapabilities[provider]?.isolated || !home) return false;
  const expected = path.join(userHome, provider === 'codex' ? '.codex' : '.claude');
  return physicalPathKey(home) === physicalPathKey(expected);
}

function validateProfile(profile, userHome) {
  if (!profile || !Object.hasOwn(providerCapabilities, profile.provider) || !/^[a-f0-9-]{36}$/.test(profile.id)) {
    throw new Error('Invalid saved profile.');
  }
  text(profile.label, 'nickname', 80);
  for (const name of ['home', 'workspace', 'cli']) {
    if (profile[name] !== null && (typeof profile[name] !== 'string' || !path.isAbsolute(profile[name]))) {
      throw new Error('Invalid saved profile path.');
    }
  }
  if (providerCapabilities[profile.provider].isolated && !profile.home) throw new Error('Profile home is missing.');
  const sharesDefaultHome = isDefaultHome(profile.provider, profile.home, userHome);
  if (profile.usesDefaultHome && (!sharesDefaultHome || profile.managed)) throw new Error('Invalid saved default login.');
  return {
    id: profile.id, provider: profile.provider, label: profile.label,
    home: profile.home, workspace: profile.workspace, cli: profile.cli,
    email: email(profile.email), managed: profile.managed === true,
    usesDefaultHome: profile.usesDefaultHome === true, sharesDefaultHome,
  };
}

class ProfileStore {
  constructor(root, { userHome = os.homedir(), platform = process.platform } = {}) {
    if (!path.isAbsolute(root)) throw new Error('Profile store must use an absolute folder path.');
    this.root = root;
    this.userHome = userHome;
    this.platform = platform;
    this.file = path.join(root, 'profile-store.json');
  }

  load() {
    let snapshot = null;
    try { snapshot = fs.readFileSync(this.file, 'utf8'); }
    catch (error) {
      if (error.code !== 'ENOENT') throw new Error('Account list could not be read. Your provider homes have not been changed.');
    }
    if (snapshot === null) return Object.defineProperty(
      { version: 1, profiles: [], privacy: true, defaultProfileId: null }, sourceText, { value: null, writable: true });
    let data;
    try { data = JSON.parse(snapshot); }
    catch { throw new Error('Account list could not be read. Your provider homes have not been changed.'); }
    if (data.version !== 1 || !Array.isArray(data.profiles) || data.profiles.length > 500) {
      throw new Error('Unsupported account list format.');
    }
    const profiles = data.profiles.map(profile => validateProfile(profile, this.userHome));
    if (new Set(profiles.map(p => p.id)).size !== profiles.length) throw new Error('Duplicate saved profile.');
    return Object.defineProperty({
      version: 1, profiles, privacy: data.privacy !== false,
      defaultProfileId: profiles.some(p => p.id === data.defaultProfileId) ? data.defaultProfileId : null,
    }, sourceText, { value: snapshot, writable: true });
  }

  save(data) {
    if (!Object.hasOwn(data, sourceText)) throw new Error('Account settings must be loaded again before saving.');
    privateDirectory(this.root);
    const temporary = path.join(this.root, `${randomUUID()}.tmp`);
    const serialized = JSON.stringify(data, null, 2) + '\n';
    try {
      const fd = fs.openSync(temporary, 'wx', 0o600);
      try { fs.writeFileSync(fd, serialized); fs.fsyncSync(fd); }
      finally { fs.closeSync(fd); }
      for (let attempt = 0; ; attempt++) {
        try {
          let current = null;
          try { current = fs.readFileSync(this.file, 'utf8'); }
          catch (error) { if (error.code !== 'ENOENT') throw error; }
          if (current !== data[sourceText]) throw new Error('Account settings changed in another process. Refresh the account list and try again.');
          fs.renameSync(temporary, this.file);
          data[sourceText] = serialized;
          break;
        } catch (error) {
          if (this.platform !== 'win32' || attempt >= 4 || !['EPERM', 'EACCES', 'EBUSY'].includes(error.code)) throw error;
          Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20 * (attempt + 1));
        }
      }
      if (process.platform !== 'win32') fs.chmodSync(this.file, 0o600);
    } finally {
      try { fs.unlinkSync(temporary); } catch { /* Renamed successfully or temporarily locked; never remove the old account list. */ }
    }
    return data;
  }

  add(input) {
    if (!input || !Object.hasOwn(providerCapabilities, input.provider)) throw new Error('Unsupported provider.');
    if (input.defaultLogin !== undefined && typeof input.defaultLogin !== 'boolean') throw new Error('Invalid default login mode.');
    if (input.defaultLogin && (!providerCapabilities[input.provider].isolated || input.home || input.createNew)) {
      throw new Error('Default login links must use the provider default folder without creating a profile.');
    }
    const data = this.load();
    if (data.profiles.length >= 500) throw new Error('Account limit reached.');
    const label = text(input.label, 'nickname', 80);
    const identity = email(input.email);
    const workspace = input.workspace ? folder(input.workspace, 'Project folder') : null;
    const cli = input.cli ? executable(input.cli) : null;
    const id = randomUUID();
    let home = input.defaultLogin ? folder(path.join(this.userHome, '.' + input.provider), 'Default login folder')
      : input.home ? folder(input.home, 'Profile folder') : null;
    if (input.createNew) {
      if (home || !providerCapabilities[input.provider].isolated) throw new Error('This provider cannot create an isolated profile here.');
      privateDirectory(this.root);
      const profiles = privateDirectory(path.join(this.root, 'profiles'));
      const provider = privateDirectory(path.join(profiles, input.provider));
      home = privateDirectory(path.join(provider, id));
    }
    if (providerCapabilities[input.provider].isolated && !home) throw new Error('Choose an existing profile folder or create a new account.');
    this.assertUnique(data, { provider: input.provider, home });
    const profile = { id, provider: input.provider, label, home, workspace, cli, email: identity, managed: !!input.createNew,
      usesDefaultHome: input.defaultLogin === true, sharesDefaultHome: isDefaultHome(input.provider, home, this.userHome) };
    data.profiles.push(profile);
    if (!data.defaultProfileId) data.defaultProfileId = id;
    this.save(data);
    return profile;
  }

  assertUnique(data, profile, exceptId = null) {
    if (data.profiles.some(p => p.id !== exceptId && p.provider === profile.provider &&
      (p.home && profile.home ? physicalPathKey(p.home) === physicalPathKey(profile.home) : p.home === profile.home))) {
      throw new Error('This provider profile is already linked.');
    }
  }

  update(id, fields) {
    const data = this.load();
    const profile = data.profiles.find(p => p.id === id);
    if (!profile) throw new Error('Account not found.');
    if (!fields || Object.keys(fields).some(k => !['label', 'home', 'workspace', 'cli', 'email'].includes(k))) {
      throw new Error('Unsupported account update.');
    }
    if (Object.hasOwn(fields, 'label')) profile.label = text(fields.label, 'nickname', 80);
    if (Object.hasOwn(fields, 'email')) profile.email = email(fields.email);
    for (const name of ['home', 'workspace', 'cli']) {
      if (!Object.hasOwn(fields, name)) continue;
      if (name === 'home' && profile.managed) throw new Error('A managed profile home stays fixed.');
      if (name === 'home' && profile.usesDefaultHome) throw new Error('Default login folder stays fixed. Link a separate profile to choose a different folder.');
      profile[name] = fields[name] ? (name === 'cli' ? executable(fields[name]) : folder(fields[name], name)) : null;
    }
    if (providerCapabilities[profile.provider].isolated && !profile.home) throw new Error('Profile folder is required.');
    this.assertUnique(data, profile, id);
    profile.sharesDefaultHome = isDefaultHome(profile.provider, profile.home, this.userHome);
    this.save(data);
    return profile;
  }

  remove(id) {
    const data = this.load();
    if (!data.profiles.some(p => p.id === id)) throw new Error('Account not found.');
    data.profiles = data.profiles.filter(p => p.id !== id);
    if (data.defaultProfileId === id) data.defaultProfileId = data.profiles[0]?.id || null;
    return this.save(data);
  }

  setDefault(id) {
    const data = this.load();
    if (id !== null && !data.profiles.some(p => p.id === id)) throw new Error('Account not found.');
    data.defaultProfileId = id;
    return this.save(data);
  }

  setPrivacy(enabled) {
    if (typeof enabled !== 'boolean') throw new Error('Privacy setting must be true or false.');
    const data = this.load();
    data.privacy = enabled;
    return this.save(data);
  }
}

module.exports = { ProfileStore, providerCapabilities, privateDirectory, folder, isDefaultHome };
