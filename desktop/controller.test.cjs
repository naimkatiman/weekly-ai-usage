'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DesktopController } = require('./controller.cjs');

function fixture(t, overrides = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'weekly-controller-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const mkdir = name => { const dir = path.join(root, name); fs.mkdirSync(dir, { recursive: true }); return dir; };
  const dataRoot = mkdir('app-data'), userHome = mkdir('user'), home = mkdir('linked-profile'), workspace = mkdir('workspace');
  const cli = path.join(root, 'synthetic-agent.exe'); fs.writeFileSync(cli, 'synthetic executable fixture');
  const options = { dataRoot, userHome, runtime: cli, runnerPath: path.join(root, 'synthetic-runner.cjs'),
    identityReader: async () => ({ email: 'personal@example.com' }),
    collector: async accounts => ({ accounts: accounts.map(account => reading(account)) }),
    launcher: async () => ({ opened: true }), executableResolver: () => cli, ...overrides };
  const controller = new DesktopController(options);
  const add = (input = {}) => {
    const result = controller.addProfile({ provider: 'codex', label: 'Personal', home, email: 'personal@example.com', workspace, cli, ...input });
    return result.profiles.at(-1).id;
  };
  return { root, mkdir, dataRoot, userHome, home, workspace, cli, controller, options, add };
}
function reading(account, extras = {}) {
  return { ...account, status: 'Live', weekly: { used: 25, remaining: 75, reset: new Date(Date.now() + 3600000).toISOString() },
    session: { used: 10, remaining: 90, reset: null }, sessionLabel: '5 hours',
    capturedAt: new Date().toISOString(), checkedAt: new Date().toISOString(), plan: 'Pro', message: '', ...extras };
}
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

test('privacy is enabled initially and API responses omit local account details', async t => {
  const f = fixture(t), id = f.add({ label: 'Personal personal@example.com' });
  const state = await f.controller.refreshUsage(), row = state.profiles[0];
  assert.equal(state.privacy, true);
  assert.equal(row.id, id);
  for (const field of ['email', 'home', 'workspace', 'cli']) assert.equal(Object.hasOwn(row, field), false);
  for (const value of ['personal@example.com', f.home, f.workspace, f.cli]) assert.equal(JSON.stringify(state).includes(value), false);
  const shown = f.controller.setPrivacy(false).profiles[0];
  assert.equal(shown.email, 'personal@example.com');
  assert.equal(shown.home, f.home);
  assert.equal(shown.workspace, f.workspace);
  assert.equal(shown.cli, fs.realpathSync.native(f.cli));
  assert.equal(f.controller.setPrivacy(true).profiles[0].email, undefined);
  assert.throws(() => f.controller.setPrivacy('false'), /true or false/);
});

test('privacy projection redacts cache labels/messages and discards private cache extras', async t => {
  const f = fixture(t), id = f.add({ label: 'personal@example.com' });
  await f.controller.refreshUsage();
  const file = path.join(f.dataRoot, 'quota-cache.json'), cache = JSON.parse(fs.readFileSync(file, 'utf8'));
  const privateValue = 'sk-' + 'synthetic'.repeat(4);
  Object.assign(cache[id].reading, { message: 'For personal@example.com at /Users/example/.codex', plan: privateValue,
    email: 'private@example.com', home: '/Users/example/private', token: privateValue,
    nestedPrivate: { email: 'private@example.com' } });
  cache[id].reading.weekly.extraPrivate = 'private@example.com';
  fs.writeFileSync(file, JSON.stringify(cache));
  const state = new DesktopController(f.options).state(), row = state.profiles[0];
  assert.equal(row.usage.weekly.remaining, 75);
  for (const value of ['personal@example.com', 'private@example.com', '/Users/example', privateValue, 'nestedPrivate', 'extraPrivate'])
    assert.equal(JSON.stringify(state).includes(value), false, 'private cache data must not reach the API');
});

test('saved quota cannot cross provider, home or email after profile changes', async t => {
  for (const change of ['provider', 'home', 'email']) {
    const f = fixture(t), id = f.add(); await f.controller.refreshUsage();
    const file = path.join(f.dataRoot, 'profile-store.json'), saved = JSON.parse(fs.readFileSync(file, 'utf8'));
    saved.profiles[0][change] = change === 'provider' ? 'claude' : change === 'home' ? f.mkdir('another-profile') : 'other@example.com';
    fs.writeFileSync(file, JSON.stringify(saved));
    const row = new DesktopController(f.options).state().profiles.find(p => p.id === id);
    assert.equal(row.usage.status, 'Unavailable', change + ' must invalidate the cached identity');
    assert.equal(row.usage.weekly.used, null);
  }
});

test('a discovered identity mismatch clears previous quota and persists that removal', async t => {
  let email = 'personal@example.com';
  const f = fixture(t, { identityReader: async () => ({ email }) }), id = f.add();
  await f.controller.refreshUsage(); email = 'other@example.com';
  const row = (await f.controller.refreshUsage()).profiles[0];
  assert.equal(row.usage.weekly.used, null);
  assert.equal(row.usage.status, 'Unavailable');
  assert.match(row.usage.message, /different account/);
  assert.equal(JSON.parse(fs.readFileSync(path.join(f.dataRoot, 'quota-cache.json'), 'utf8'))[id], undefined);
});

test('provider-reported identity mismatch cannot retain a prior quota as stale', async t => {
  let mismatch = false;
  const f = fixture(t, { collector: async (accounts, previous) => ({ accounts: [mismatch
    ? { ...previous.accounts[0], status: 'Stale', message: 'Account identity mismatch. Check the provider login.' }
    : reading(accounts[0])] }) });
  const id = f.add(); await f.controller.refreshUsage(); mismatch = true;
  const row = (await f.controller.refreshUsage()).profiles[0];
  assert.equal(row.usage.weekly.used, null, 'remote identity failure must invalidate previous quota');
  assert.equal(row.usage.status, 'Unavailable');
  assert.equal(JSON.parse(fs.readFileSync(path.join(f.dataRoot, 'quota-cache.json'), 'utf8'))[id], undefined);
});

test('cached quota becomes stale, reset pending or unavailable as its timestamps age', async t => {
  const f = fixture(t), id = f.add(); await f.controller.refreshUsage();
  const file = path.join(f.dataRoot, 'quota-cache.json'), cache = JSON.parse(fs.readFileSync(file, 'utf8'));
  const check = (age, reset, expected, used) => {
    cache[id].reading.capturedAt = new Date(Date.now() - age).toISOString();
    cache[id].reading.weekly.reset = new Date(Date.now() + reset).toISOString();
    fs.writeFileSync(file, JSON.stringify(cache));
    const row = new DesktopController(f.options).state().profiles[0];
    assert.equal(row.usage.status, expected); assert.equal(row.usage.weekly.used, used);
  };
  check(21 * 60000, 3600000, 'Stale', 25);
  check(60000, -1000, 'Reset pending', null);
  check(86400001, 3600000, 'Unavailable', null);
});

test('adding and removing profiles preserves linked and managed provider homes', t => {
  const f = fixture(t), authFile = path.join(f.home, 'auth.json'), bytes = '{"synthetic":"local-only"}';
  fs.writeFileSync(authFile, bytes);
  const id = f.add();
  assert.deepEqual(fs.readdirSync(f.home), ['auth.json']);
  assert.equal(fs.existsSync(path.join(f.dataRoot, 'auth.json')), false);
  f.controller.removeProfile(id);
  assert.equal(fs.readFileSync(authFile, 'utf8'), bytes);
  const managedId = f.add({ home: null, createNew: true, label: 'Managed' });
  const managed = f.controller.profile(managedId).home;
  fs.writeFileSync(path.join(managed, 'synthetic-state'), 'keep');
  f.controller.removeProfile(managedId);
  assert.equal(fs.readFileSync(path.join(managed, 'synthetic-state'), 'utf8'), 'keep');
  assert.deepEqual(f.controller.state().profiles, []);
});

test('a profile changed or removed during an in-flight collector read cannot regain old quota', async t => {
  for (const action of ['change', 'remove']) {
    const started = deferred(), response = deferred();
    const f = fixture(t, { collector: async accounts => { started.resolve(); await response.promise; return { accounts: [reading(accounts[0])] }; } });
    const id = f.add(), refresh = f.controller.refreshUsage(); await started.promise;
    if (action === 'remove') f.controller.removeProfile(id);
    else f.controller.updateProfile(id, { home: f.mkdir('replacement') });
    response.resolve(); const state = await refresh;
    assert.equal(state.profiles.length, action === 'remove' ? 0 : 1);
    if (state.profiles.length) assert.equal(state.profiles[0].usage.weekly.used, null);
    assert.equal(JSON.parse(fs.readFileSync(path.join(f.dataRoot, 'quota-cache.json'), 'utf8'))[id], undefined);
  }
});

test('a stale async error cannot mark a replacement profile as the wrong account', async t => {
  const started = deferred(), response = deferred();
  const f = fixture(t, { collector: async () => { started.resolve(); await response.promise; throw new Error('Account identity mismatch.'); } });
  const id = f.add(), refresh = f.controller.refreshUsage(); await started.promise;
  const before = f.controller.updateProfile(id, { home: f.mkdir('replacement') }).profiles[0];
  response.resolve(); const after = (await refresh).profiles[0];
  assert.equal(after.usage.message, before.usage.message, 'old request errors must not contaminate a newly selected home');
  assert.equal(after.usage.weekly.used, null);
});

test('profile removal during identity discovery cannot recreate its reference or quota', async t => {
  const started = deferred(), response = deferred(); let calls = 0;
  const f = fixture(t, { identityReader: async () => { started.resolve(); await response.promise; return { email: 'personal@example.com' }; },
    collector: async () => { calls++; return { accounts: [] }; } });
  const id = f.add({ email: null }), refresh = f.controller.refreshUsage(); await started.promise;
  f.controller.removeProfile(id); response.resolve();
  assert.deepEqual((await refresh).profiles, []); assert.equal(calls, 0);
});

test('legacy import links existing folders without credential copies and reports skipped entries', t => {
  const f = fixture(t), legacy = f.mkdir('legacy'), codex = f.mkdir('legacy/relative-codex'), claude = f.mkdir('user/.claude-custom');
  fs.writeFileSync(path.join(codex, 'auth.json'), '{"synthetic":"codex"}');
  fs.writeFileSync(path.join(claude, '.credentials.json'), '{"synthetic":"claude"}');
  const file = path.join(legacy, 'accounts.json'), content = JSON.stringify({ accounts: [
    { provider: 'codex', email: 'personal@example.com', home: 'relative-codex' },
    { provider: 'codex', email: 'personal@example.com', home: 'relative-codex' },
    { provider: 'claude', email: 'work@example.com', home: '~/.claude-custom' },
    { provider: 'unknown', email: 'personal@example.com' },
    { provider: 'codex', email: 'personal@example.com', home: 'missing' },
  ] });
  fs.writeFileSync(file, content);
  const state = f.controller.importLegacy(file);
  assert.deepEqual(state.importResult, { imported: 2, skipped: 3 });
  const homes = f.controller.store.load().profiles.map(p => p.home).sort();
  assert.deepEqual(homes, [codex, claude].sort());
  assert.equal(fs.existsSync(path.join(f.dataRoot, 'profiles')), false);
  assert.equal(fs.readFileSync(file, 'utf8'), content);
  assert.equal(fs.readFileSync(path.join(codex, 'auth.json'), 'utf8'), '{"synthetic":"codex"}');
  assert.equal(fs.readFileSync(path.join(claude, '.credentials.json'), 'utf8'), '{"synthetic":"claude"}');
});

test('linked shared defaults can launch but cannot reconnect through the app', async t => {
  const actions = [], homes = [];
  const f = fixture(t, { launcher: async (_profile, options) => { actions.push(options.action); return { opened: true }; },
    identityReader: async selected => { homes.push(selected.home); return { email: 'personal@example.com' }; } });
  f.mkdir('user/.codex');
  const id = f.add({ home: null, defaultLogin: true });
  assert.equal(f.controller.state().profiles[0].capabilities.connect, false);
  assert.equal(f.controller.state().profiles[0].capabilities.isolated, false);
  await assert.rejects(f.controller.launch(id, 'login'), /cannot be changed/);
  assert.deepEqual(await f.controller.launch(id, 'launch'), { opened: true });
  assert.deepEqual(actions, ['launch']);
  await f.controller.refreshUsage(); assert.deepEqual(homes, [null]);
});

test('an explicit Claude default-folder link keeps its credential namespace but cannot reconnect', async t => {
  const homes = [];
  const f = fixture(t, { identityReader: async selected => { homes.push(selected.home); return { email: 'personal@example.com' }; } });
  const home = f.mkdir('user/.claude');
  const id = f.add({ provider: 'claude', home });
  const row = f.controller.state().profiles[0];
  assert.equal(row.usesDefaultHome, false);
  assert.equal(row.sharesDefaultHome, true);
  assert.equal(row.capabilities.connect, false);
  await assert.rejects(f.controller.launch(id, 'login'), /cannot be changed/);
  await f.controller.refreshUsage();
  assert.deepEqual(homes, [home]);
});

test('restoring another Claude credential namespace cannot replay the previous cached reading', async t => {
  const f = fixture(t), home = f.mkdir('user/.claude');
  f.add({ provider: 'claude', home });
  assert.equal((await f.controller.refreshUsage()).profiles[0].usage.status, 'Live');
  const data = JSON.parse(fs.readFileSync(f.controller.store.file, 'utf8'));
  data.profiles[0].usesDefaultHome = true;
  fs.writeFileSync(f.controller.store.file, JSON.stringify(data));
  assert.equal(f.controller.state().profiles[0].usage.status, 'Unavailable');
  assert.equal(f.controller.state().profiles[0].usage.weekly.used, null);
});

test('unknown profile IDs and unsupported actions fail before a launcher is invoked', async t => {
  let launches = 0;
  const f = fixture(t, { launcher: async () => { launches++; } }), id = f.add();
  for (const operation of [() => f.controller.profile('missing'), () => f.controller.removeProfile('missing'),
    () => f.controller.updateProfile('missing', { label: 'Unknown' }), () => f.controller.setDefault('missing')]) assert.throws(operation, /not found/);
  await assert.rejects(f.controller.launch('missing', 'launch'), /not found/);
  await assert.rejects(f.controller.launch(id, 'delete-credentials'), /Invalid account action/);
  assert.equal(launches, 0);
});

test('explicit import discovers local agent-auth folders without reading or copying credentials', t => {
  const f = fixture(t);
  const first = f.mkdir('user/.agent-auth/homes/codex/personal');
  const second = f.mkdir('user/.agent-auth/homes/claude/work');
  fs.writeFileSync(path.join(first, 'auth.json'), 'not read by discovery');
  fs.writeFileSync(path.join(second, '.credentials.json'), 'not read by discovery');
  assert.equal(f.controller.discoverHomes().length, 2);
  assert.equal(f.controller.state().profiles.length, 0);
  assert.deepEqual(f.controller.importHomes().importResult, { imported: 2, skipped: 0 });
  assert.deepEqual(f.controller.importHomes().importResult, { imported: 0, skipped: 2 });
  assert.equal(fs.readFileSync(path.join(first, 'auth.json'), 'utf8'), 'not read by discovery');
  assert.equal(fs.existsSync(path.join(f.dataRoot, 'profiles')), false);
  assert.ok(!JSON.stringify(f.controller.state()).includes(first));
});

test('refresh writes only its private cache and leaves the working directory untouched', async t => {
  const f = fixture(t), cwd = f.mkdir('current-folder'), original = process.cwd(); f.add();
  fs.writeFileSync(path.join(cwd, 'usage-cache.json'), 'synthetic existing file');
  process.chdir(cwd);
  try {
    await f.controller.refreshUsage();
    assert.deepEqual(fs.readdirSync(cwd), ['usage-cache.json']);
    assert.equal(fs.readFileSync(path.join(cwd, 'usage-cache.json'), 'utf8'), 'synthetic existing file');
    assert.equal(fs.existsSync(path.join(f.dataRoot, 'quota-cache.json')), true);
  } finally { process.chdir(original); }
});
