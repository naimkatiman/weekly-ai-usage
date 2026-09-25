'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { ProfileStore, providerCapabilities } = require('./profiles.cjs');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'weekly-profile-test-'));
  // This generated temp tree contains synthetic data only and is never a provider home.
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const userHome = path.join(root, 'synthetic-user');
  fs.mkdirSync(userHome);
  const store = new ProfileStore(path.join(root, 'private-app'), { userHome });
  return { root, userHome, store };
}

test('managed profiles use stable random folders and private metadata, preserving defaults', t => {
  const { store, userHome } = fixture(t);
  fs.mkdirSync(path.join(userHome, '.codex'));
  const auth = path.join(userHome, '.codex', 'auth.json');
  fs.writeFileSync(auth, '{"syntheticDefault":true}');
  const before = fs.readFileSync(auth);
  const profile = store.add({ provider: 'codex', label: 'Personal', email: 'personal@example.com', createNew: true });
  assert.ok(fs.statSync(profile.home).isDirectory());
  assert.ok(profile.home.startsWith(path.join(store.root, 'profiles', 'codex')));
  assert.equal(profile.home.includes('example.com'), false);
  assert.equal(profile.usesDefaultHome, false);
  assert.equal(store.load().defaultProfileId, profile.id);
  assert.equal(store.load().privacy, true);
  assert.deepEqual(fs.readFileSync(auth), before);
  if (process.platform !== 'win32') {
    assert.equal(fs.statSync(store.file).mode & 0o777, 0o600);
    assert.equal(fs.statSync(profile.home).mode & 0o777, 0o700);
  }
});

test('import references an existing home and removal never deletes its files', t => {
  const { root, store } = fixture(t);
  const home = path.join(root, 'existing');
  fs.mkdirSync(home);
  const credential = path.join(home, '.credentials.json');
  fs.writeFileSync(credential, '{"synthetic":true}');
  const profile = store.add({ provider: 'claude', label: 'Work', home });
  assert.equal(profile.home, home);
  assert.equal(profile.managed, false);
  assert.deepEqual(fs.readdirSync(home), ['.credentials.json']);
  assert.throws(() => store.add({ provider: 'claude', label: 'Duplicate', home: path.join(home, '.') }), /already linked/);
  store.remove(profile.id);
  assert.ok(fs.existsSync(credential));
  assert.equal(store.load().profiles.length, 0);
  assert.equal(store.load().defaultProfileId, null);
});

test('default selection, local nickname and privacy changes survive reload', t => {
  const { store } = fixture(t);
  const a = store.add({ provider: 'codex', label: 'One', createNew: true });
  const b = store.add({ provider: 'claude', label: 'Two', createNew: true });
  store.setDefault(b.id);
  store.setPrivacy(false);
  store.update(a.id, { label: 'Personal', email: 'personal@example.com' });
  const data = new ProfileStore(store.root).load();
  assert.equal(data.defaultProfileId, b.id);
  assert.equal(data.profiles[0].label, 'Personal');
  assert.equal(data.privacy, false);
  assert.throws(() => store.update(a.id, { home: b.home }), /stays fixed/);
  assert.throws(() => store.update(a.id, { provider: 'claude' }), /Unsupported/);
  assert.throws(() => store.setDefault('unknown'), /not found/);
  assert.throws(() => store.setPrivacy('false'), /true or false/);
  assert.deepEqual(fs.readdirSync(store.root).filter(name => name.endsWith('.tmp')), []);
});

test('an explicit default-folder link preserves its namespace and detects shared default files', t => {
  const { store, userHome } = fixture(t);
  const home = path.join(userHome, '.claude');
  fs.mkdirSync(home);
  const profile = store.add({ provider: 'claude', label: 'Explicit folder', home, usesDefaultHome: true, sharesDefaultHome: false });
  assert.equal(profile.usesDefaultHome, false);
  assert.equal(profile.sharesDefaultHome, true);
  const data = JSON.parse(fs.readFileSync(store.file, 'utf8'));
  data.profiles[0].sharesDefaultHome = false;
  fs.writeFileSync(store.file, JSON.stringify(data));
  assert.equal(store.load().profiles[0].usesDefaultHome, false);
  assert.equal(store.load().profiles[0].sharesDefaultHome, true);
});

test('explicit default-login mode uses only the provider default folder and stays fixed', t => {
  const { store, userHome } = fixture(t);
  const home = path.join(userHome, '.claude');
  fs.mkdirSync(home);
  const profile = store.add({ provider: 'claude', label: 'Existing default', defaultLogin: true });
  assert.equal(profile.home, home);
  assert.equal(profile.usesDefaultHome, true);
  assert.equal(profile.sharesDefaultHome, true);
  assert.equal(profile.managed, false);
  assert.equal(store.load().profiles[0].usesDefaultHome, true);
  assert.throws(() => store.update(profile.id, { home: userHome }), /stays fixed/);
  assert.throws(() => store.add({ provider: 'codex', label: 'Invalid', defaultLogin: true, home }), /Default login links/);
  assert.throws(() => store.add({ provider: 'codex', label: 'Invalid', defaultLogin: true, createNew: true }), /Default login links/);
  assert.throws(() => store.add({ provider: 'grok', label: 'Invalid', defaultLogin: true }), /Default login links/);
});

test('linked folder aliases retain the original string and dedupe by physical folder', t => {
  const { store, root, userHome } = fixture(t);
  const physical = path.join(root, 'actual-profile');
  const alias = path.join(root, 'profile-alias');
  fs.mkdirSync(physical);
  fs.symlinkSync(physical, alias, process.platform === 'win32' ? 'junction' : 'dir');
  const profile = store.add({ provider: 'claude', label: 'Alias', home: alias });
  assert.equal(profile.home, alias);
  assert.equal(store.load().profiles[0].home, alias);
  assert.equal(profile.usesDefaultHome, false);
  assert.equal(profile.sharesDefaultHome, false);
  assert.throws(() => store.add({ provider: 'claude', label: 'Same folder', home: physical }), /already linked/);
  const data = JSON.parse(fs.readFileSync(store.file, 'utf8'));
  data.profiles[0].usesDefaultHome = true;
  fs.writeFileSync(store.file, JSON.stringify(data));
  assert.throws(() => store.load(), /Invalid saved default login/);
  data.profiles[0].usesDefaultHome = false;
  fs.writeFileSync(store.file, JSON.stringify(data));
  const defaultHome = path.join(userHome, '.codex');
  fs.mkdirSync(defaultHome);
  const defaultAlias = path.join(root, 'default-alias');
  fs.symlinkSync(defaultHome, defaultAlias, process.platform === 'win32' ? 'junction' : 'dir');
  const shared = store.add({ provider: 'codex', label: 'Explicit default alias', home: defaultAlias });
  assert.equal(shared.home, defaultAlias);
  assert.equal(shared.usesDefaultHome, false);
  assert.equal(shared.sharesDefaultHome, true);
});

test('capabilities reject unverified isolated login and invalid references', t => {
  const { store, root } = fixture(t);
  assert.equal(providerCapabilities.codex.isolated, true);
  assert.equal(providerCapabilities.grok.login, false);
  assert.equal(providerCapabilities.devin.isolated, false);
  assert.throws(() => store.add({ provider: 'grok', label: 'Work', createNew: true }), /cannot create/);
  assert.throws(() => store.add({ provider: 'constructor', label: 'Work' }), /Unsupported/);
  assert.throws(() => store.add({ provider: 'claude', label: 'Work' }), /Choose an existing/);
  assert.throws(() => store.add({ provider: 'claude', label: 'Work', home: '../relative' }), /absolute/);
  assert.throws(() => store.add({ provider: 'claude', label: 'Work', home: path.join(root, 'missing') }), /accessible/);
  assert.throws(() => store.add({ provider: 'codex', label: 'Work\nHidden', createNew: true }), /nickname/);
  const profile = store.add({ provider: 'grok', label: 'Existing login' });
  assert.equal(profile.home, null);
});

test('corrupt metadata fails with a path-free error and does not overwrite the file', t => {
  const { store } = fixture(t);
  fs.mkdirSync(store.root);
  fs.writeFileSync(store.file, '{broken');
  assert.throws(() => store.load(), error => !error.message.includes(store.root) && /could not be read/.test(error.message));
  assert.equal(fs.readFileSync(store.file, 'utf8'), '{broken');
});

test('Windows metadata rename retries transient locks before saving', t => {
  const { root } = fixture(t);
  const store = new ProfileStore(path.join(root, 'retry-store'), { platform: 'win32' });
  store.add({ provider: 'codex', label: 'Personal', createNew: true });
  const rename = fs.renameSync;
  let attempts = 0;
  t.mock.method(fs, 'renameSync', (from, to) => {
    attempts++;
    if (attempts <= 2) { const error = new Error('Synthetic lock'); error.code = attempts === 1 ? 'EPERM' : 'EBUSY'; throw error; }
    rename(from, to);
  });
  store.setPrivacy(false);
  assert.equal(attempts, 3);
  assert.equal(store.load().privacy, false);
  assert.deepEqual(fs.readdirSync(store.root).filter(name => name.endsWith('.tmp')), []);
});

test('persistent Windows rename locks preserve previous metadata and stop after bounded retries', t => {
  const { root } = fixture(t);
  const store = new ProfileStore(path.join(root, 'locked-store'), { platform: 'win32' });
  store.add({ provider: 'codex', label: 'Personal', createNew: true });
  const before = fs.readFileSync(store.file, 'utf8');
  let attempts = 0;
  t.mock.method(fs, 'renameSync', () => {
    attempts++;
    const error = new Error('Synthetic lock'); error.code = 'EACCES'; throw error;
  });
  assert.throws(() => store.setPrivacy(false), { code: 'EACCES' });
  assert.equal(attempts, 5);
  assert.equal(fs.readFileSync(store.file, 'utf8'), before);
  assert.deepEqual(fs.readdirSync(store.root).filter(name => name.endsWith('.tmp')), []);
});

test('metadata save rejects another writer both before replacement and between Windows retries', t => {
  const { root } = fixture(t);
  const store = new ProfileStore(path.join(root, 'concurrent-store'), { platform: 'win32' });
  const profile = store.add({ provider: 'codex', label: 'Personal', createNew: true });
  const stale = store.load();
  store.update(profile.id, { label: 'Updated elsewhere' });
  stale.privacy = false;
  assert.throws(() => store.save(stale), /changed in another process/);
  assert.equal(store.load().profiles[0].label, 'Updated elsewhere');
  assert.equal(store.load().privacy, true);
  assert.equal(Object.keys(store.load()).includes('sourceText'), false);
  assert.equal(JSON.stringify(store.load()).includes('sourceText'), false);
  let attempts = 0;
  let external;
  t.mock.method(fs, 'renameSync', () => {
    attempts++;
    external = JSON.parse(fs.readFileSync(store.file, 'utf8'));
    external.profiles[0].label = 'Concurrent edit during retry';
    fs.writeFileSync(store.file, JSON.stringify(external));
    const error = new Error('Synthetic lock'); error.code = 'EPERM'; throw error;
  });
  assert.throws(() => store.setPrivacy(false), /changed in another process/);
  assert.equal(attempts, 1);
  assert.equal(fs.readFileSync(store.file, 'utf8'), JSON.stringify(external));
});

test('non-Windows rename errors fail immediately without replacing the old account list', t => {
  const { root } = fixture(t);
  const store = new ProfileStore(path.join(root, 'posix-store'), { platform: 'darwin' });
  store.add({ provider: 'codex', label: 'Personal', createNew: true });
  const before = fs.readFileSync(store.file, 'utf8');
  let attempts = 0;
  t.mock.method(fs, 'renameSync', () => {
    attempts++;
    const error = new Error('Synthetic lock'); error.code = 'EPERM'; throw error;
  });
  assert.throws(() => store.setPrivacy(false), { code: 'EPERM' });
  assert.equal(attempts, 1);
  assert.equal(fs.readFileSync(store.file, 'utf8'), before);
});
