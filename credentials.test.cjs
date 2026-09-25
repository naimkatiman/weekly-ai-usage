'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash, randomBytes } = require('node:crypto');
const { execFile } = require('node:child_process');
const { readIdentity, readCredentials, keychainEntry, keychainRead } = require('./credentials.cjs');
const { collect } = require('./collect.cjs');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'weekly-credential-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const write = (file, value) => {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), typeof value === 'string' ? value : JSON.stringify(value));
  };
  return { root, write };
}
const token = claims => 'fixture.' + Buffer.from(JSON.stringify(claims)).toString('base64url') + '.fixture';
const codexAuth = (email = 'personal@example.com') => ({ tokens: {
  id_token: token({ email }), access_token: token({ exp: Date.now() / 1000 + 600 }), account_id: 'synthetic-account',
} });
const claudeAuth = () => ({ claudeAiOauth: { accessToken: 'synthetic-access', expiresAt: Date.now() + 600000, subscriptionType: 'max' } });
const identity = (email = 'personal@example.com') => ({ oauthAccount: { emailAddress: email } });
const profile = (provider, home) => ({ id: 'synthetic-profile', provider, home, email: 'personal@example.com', label: 'Personal', plan: 'Pro' });

test('identity discovery exposes only the selected account email', async t => {
  const { root, write } = fixture(t);
  write('codex/auth.json', codexAuth());
  const selected = profile('codex', path.join(root, 'codex'));
  assert.deepEqual(await readIdentity(selected, { userRoot: root }), { email: 'personal@example.com' });
  assert.equal((await readCredentials(selected, { userRoot: root })).accountId, 'synthetic-account');
});

test('explicit homes never borrow matching default credentials', async t => {
  const { root, write } = fixture(t);
  write('.codex/auth.json', codexAuth());
  write('.claude/.credentials.json', claudeAuth());
  write('.claude.json', identity());
  for (const provider of ['claude', 'codex']) {
    const selected = profile(provider, path.join(root, 'empty-' + provider));
    assert.equal(await readIdentity(selected, { platform: 'win32', userRoot: root }), null);
    await assert.rejects(readCredentials(selected, { platform: 'win32', userRoot: root }), /No matching/);
    assert.deepEqual(await readIdentity(profile(provider, null), { platform: 'win32', userRoot: root }), { email: 'personal@example.com' });
  }
});

test('Claude honors the selected legacy identity file and rejects identity mismatch', async t => {
  const { root, write } = fixture(t);
  write('claude/.credentials.json', claudeAuth());
  write('claude/.claude.json', identity('ignored@example.com'));
  write('claude/.config.json', identity());
  const selected = profile('claude', path.join(root, 'claude'));
  assert.deepEqual(await readIdentity(selected, { platform: 'win32', userRoot: root }), { email: 'personal@example.com' });
  await assert.rejects(readCredentials({ ...selected, email: 'other@example.com' }, { platform: 'win32', userRoot: root }), { code: 'identity_mismatch' });
});

test('Claude Keychain lookup selects only the exact config-directory entry', async t => {
  const { root, write } = fixture(t);
  write('claude/.claude.json', identity());
  const selected = profile('claude', path.join(root, 'claude'));
  const calls = [];
  const options = { platform: 'darwin', userRoot: root, username: 'synthetic-user', keychainRead: async entry => {
    calls.push(entry); return JSON.stringify(claudeAuth());
  } };
  assert.equal((await readCredentials(selected, options)).token, 'synthetic-access');
  const hash = createHash('sha256').update(selected.home.normalize('NFC')).digest('hex').slice(0, 8);
  assert.deepEqual(calls, [{ service: 'Claude Code-credentials-' + hash, account: 'synthetic-user' }]);
  assert.equal(keychainEntry(profile('claude', null), options).service, 'Claude Code-credentials');
  assert.notEqual(keychainEntry(profile('claude', path.join(root, '.claude')), options).service, 'Claude Code-credentials');
});

test('Claude Keychain takes priority over an obsolete credential file', async t => {
  const { root, write } = fixture(t);
  write('claude/.claude.json', identity());
  write('claude/.credentials.json', '{obsolete unreadable file');
  assert.equal((await readCredentials(profile('claude', path.join(root, 'claude')), {
    platform: 'darwin', userRoot: root, keychainRead: async () => JSON.stringify(claudeAuth()),
  })).token, 'synthetic-access');
});

test('Claude falls back only to its own file after an absent Keychain entry', async t => {
  const { root, write } = fixture(t);
  write('claude/.claude.json', identity());
  write('claude/.credentials.json', claudeAuth());
  const options = { platform: 'darwin', userRoot: root, keychainRead: async () => null };
  assert.equal((await readCredentials(profile('claude', path.join(root, 'claude')), options)).token, 'synthetic-access');
});

test('denied or locked Keychain errors are sanitized and never become zero quota', async t => {
  const { root, write } = fixture(t);
  write('claude/.claude.json', identity());
  const selected = profile('claude', path.join(root, 'claude'));
  const options = { platform: 'darwin', userRoot: root, keychainRead: async () => { throw new Error('synthetic-private-error'); } };
  await assert.rejects(readIdentity(selected, options), error => error.code === 'keychain_unavailable' && !error.message.includes('synthetic-private-error'));
  const result = await collect([selected], null, options);
  assert.equal(result.accounts[0].status, 'Unavailable');
  assert.equal(result.accounts[0].weekly.used, null);
  assert.match(result.accounts[0].message, /Keychain access is unavailable/);
  assert.equal(JSON.stringify(result).includes(root), false);
});

test('Codex Keychain uses its canonical home hash and preserves keyring precedence', async t => {
  const { root, write } = fixture(t);
  write('codex/config.toml', 'cli_auth_credentials_store = "keyring"\n');
  write('codex/auth.json', codexAuth('obsolete@example.com'));
  const selected = profile('codex', path.join(root, 'codex'));
  const expected = 'cli|' + createHash('sha256').update(fs.realpathSync.native(selected.home)).digest('hex').slice(0, 16);
  const calls = [];
  const options = { platform: 'darwin', userRoot: root, keychainRead: async entry => { calls.push(entry); return JSON.stringify(codexAuth()); } };
  assert.deepEqual(await readIdentity(selected, options), { email: 'personal@example.com' });
  assert.deepEqual(calls, [{ service: 'Codex Auth', account: expected }]);
  await assert.rejects(readCredentials(selected, { ...options, keychainRead: async () => null }), /No matching/);
});

test('Codex file mode never probes Keychain; auto can use its own fallback file', async t => {
  const { root, write } = fixture(t);
  write('codex/auth.json', codexAuth());
  const selected = profile('codex', path.join(root, 'codex'));
  let calls = 0;
  const options = { platform: 'darwin', userRoot: root, keychainRead: async () => { calls++; return null; } };
  assert.deepEqual(await readIdentity(selected, options), { email: 'personal@example.com' });
  assert.equal(calls, 0);
  write('codex/config.toml', 'cli_auth_credentials_store = "auto" # configured\n');
  assert.deepEqual(await readIdentity(selected, options), { email: 'personal@example.com' });
  assert.equal(calls, 1);
});

test('unsupported ephemeral and encrypted Codex stores do not read stale direct credentials', async t => {
  const { root, write } = fixture(t);
  const selected = profile('codex', path.join(root, 'codex'));
  for (const config of [
    'cli_auth_credentials_store = "ephemeral"',
    'cli_auth_credentials_store = "keyring"\n[features]\nsecret_auth_storage = true',
    'cli_auth_credentials_store = "unknown"',
  ]) {
    write('codex/config.toml', config);
    await assert.rejects(readIdentity(selected, { platform: 'darwin', userRoot: root, keychainRead: () => assert.fail('must not query Keychain') }), { code: 'store_unsupported' });
  }
});

test('Codex parses quoted keys, escaped TOML strings and inline feature tables', async t => {
  const { root, write } = fixture(t);
  const selected = profile('codex', path.join(root, 'codex'));
  const options = { platform: 'darwin', userRoot: root, keychainRead: async () => JSON.stringify(codexAuth()) };
  for (const config of [
    '"cli_auth_credentials_store" = "keyring" # selected store\n["features"]\n"secret_auth_storage" = false',
    'cli_auth_credentials_store = "key\\u0072ing"\nfeatures = { secret_auth_storage = false }',
  ]) {
    write('codex/config.toml', config);
    assert.deepEqual(await readIdentity(selected, options), { email: 'personal@example.com' });
  }
  for (const config of [
    'cli_auth_credentials_store = "keyring"\nfeatures = { "secret_auth_storage" = true }',
    'cli_auth_credentials_store = "keyring"\n"features"."secret_auth_storage" = true',
    'cli_auth_credentials_store = "keyring"\n[features]\nsecret_auth_storage = "true"',
  ]) {
    write('codex/config.toml', config);
    await assert.rejects(readIdentity(selected, { ...options, keychainRead: () => assert.fail('must not query old Keychain backend') }), { code: 'store_unsupported' });
  }
});

test('TOML comments and unrelated nested keys cannot change the selected credential store', async t => {
  const { root, write } = fixture(t);
  write('codex/auth.json', codexAuth());
  write('codex/config.toml', '# cli_auth_credentials_store = "keyring"\n[project]\ncli_auth_credentials_store = "keyring"\nsecret_auth_storage = true');
  const selected = profile('codex', path.join(root, 'codex'));
  assert.deepEqual(await readIdentity(selected, { platform: 'darwin', userRoot: root, keychainRead: () => assert.fail('file is the root default') }),
    { email: 'personal@example.com' });
  write('codex/config.toml', 'cli_auth_credentials_store = "synthetic-private-invalid');
  await assert.rejects(readIdentity(selected, { userRoot: root }), error => error.code === 'store_unsupported' && !error.message.includes('synthetic-private-invalid'));
});

test('security uses bounded argv execution and strips subprocess diagnostics', async () => {
  const entry = { service: 'Claude Code-credentials-synthetic', account: 'synthetic-user' };
  let invocation;
  const value = await keychainRead(entry, { execFile: (file, args, options, done) => {
    invocation = { file, args, options }; done(null, ' {"fixture":true}\n');
  } });
  assert.equal(value, '{"fixture":true}');
  assert.equal(invocation.file, '/usr/bin/security');
  assert.deepEqual(invocation.args, ['find-generic-password', '-s', entry.service, '-a', entry.account, '-w']);
  assert.equal(invocation.options.timeout, 8000);
  assert.equal(invocation.options.maxBuffer, 2 * 1024 * 1024);
  assert.equal(invocation.options.shell, undefined);
  assert.equal(await keychainRead(entry, { execFile: (_file, _args, _options, done) => done({ code: 44 }) }), null);
  for (const code of [36, 51, 128, 'ENOENT', 'ETIMEDOUT']) {
    await assert.rejects(keychainRead(entry, { execFile: (_file, _args, _options, done) => done({ code, message: 'synthetic-private-error', stderr: 'synthetic-private-error' }) }),
      error => error.code === 'keychain_unavailable' && !error.message.includes('synthetic-private-error'));
  }
});

test('the Keychain test adapter can select a disposable keychain explicitly', async () => {
  await keychainRead({ service: 'synthetic-service', account: 'synthetic-user' }, {
    keychainPath: '/tmp/synthetic.keychain-db', execFile: (_file, args, _options, done) => {
      assert.equal(args.at(-1), '/tmp/synthetic.keychain-db'); done(null, '{}');
    },
  });
});

test('macOS reads synthetic credentials from an explicitly selected private Keychain', { skip: process.platform !== 'darwin', timeout: 45000 }, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'weekly-keychain-test-'));
  const keychainPath = path.join(root, 'synthetic.keychain-db');
  const password = randomBytes(24).toString('hex');
  let created = false;
  const security = args => new Promise((resolve, reject) => {
    execFile('/usr/bin/security', args, { timeout: 8000, maxBuffer: 1024 * 1024, encoding: 'utf8' }, error => {
      // Never let child-process diagnostics expose even synthetic password argv.
      if (error) reject(new Error('Synthetic Keychain fixture command failed.'));
      else resolve();
    });
  });
  try {
    // Apple's StorageManager::shouldAddToSearchList excludes private keychains:
    // only login/System creation can change the default or search list. This
    // fixture uses an absolute temporary path, never login.keychain or System.
    await security(['create-keychain', '-p', password, keychainPath]);
    created = true;
    await security(['unlock-keychain', '-p', password, keychainPath]);
    for (const provider of ['claude', 'codex']) {
      const home = path.join(root, provider);
      fs.mkdirSync(home);
      const selected = profile(provider, home);
      if (provider === 'codex') fs.writeFileSync(path.join(home, 'config.toml'), 'cli_auth_credentials_store = "keyring"');
      else fs.writeFileSync(path.join(home, '.claude.json'), JSON.stringify(identity()));
      const options = { platform: 'darwin', userRoot: root, username: 'synthetic-user',
        keychainRead: entry => keychainRead(entry, { keychainPath }) };
      const entry = keychainEntry(selected, options);
      const payload = JSON.stringify(provider === 'codex' ? codexAuth() : claudeAuth());
      await security(['add-generic-password', '-a', entry.account, '-s', entry.service, '-w', payload, '-T', '/usr/bin/security', keychainPath]);
      assert.deepEqual(await readIdentity(selected, options), { email: 'personal@example.com' });
      assert.equal(typeof (await readCredentials(selected, options)).token, 'string');
      assert.equal(await keychainRead({ ...entry, service: entry.service + '-missing' }, { keychainPath }), null);
    }
  } finally {
    try { if (created) await security(['delete-keychain', keychainPath]); }
    finally { fs.rmSync(root, { recursive: true, force: true }); }
  }
});

test('expired, malformed and unreadable credentials expose no secret values', async t => {
  const { root, write } = fixture(t);
  const selected = profile('codex', path.join(root, 'codex'));
  const auth = codexAuth(); auth.tokens.access_token = token({ exp: 1 });
  write('codex/auth.json', auth);
  await assert.rejects(readCredentials(selected, { userRoot: root }), { code: 'login_expired' });
  write('codex/auth.json', '{synthetic-secret-malformed');
  await assert.rejects(readIdentity(selected, { userRoot: root }), error => error.code === 'credential_unreadable' && !error.message.includes('synthetic-secret'));
  write('codex/auth.json', 'x'.repeat(2 * 1024 * 1024 + 1));
  await assert.rejects(readIdentity(selected, { userRoot: root }), { code: 'credential_unreadable' });
});

test('collector confirms remote Claude identity before requesting usage', async t => {
  const { root, write } = fixture(t);
  write('claude/.credentials.json', claudeAuth()); write('claude/.claude.json', identity());
  const urls = [];
  t.mock.method(global, 'fetch', async url => {
    urls.push(url); return { ok: true, status: 200, text: async () => JSON.stringify({ account: { email: 'other@example.com' } }) };
  });
  const result = await collect([profile('claude', path.join(root, 'claude'))], null, { platform: 'win32', userRoot: root });
  assert.deepEqual(urls, ['https://api.anthropic.com/api/oauth/profile']);
  assert.equal(result.accounts[0].status, 'Unavailable');
  assert.equal(result.accounts[0].weekly.used, null);
  assert.match(result.accounts[0].message, /identity mismatch/);
});

test('collector imported API produces verified quota without cache or credential writes', async t => {
  const { root, write } = fixture(t);
  write('codex/auth.json', codexAuth());
  const before = fs.readFileSync(path.join(root, 'codex', 'auth.json'), 'utf8');
  t.mock.method(global, 'fetch', async () => ({ ok: true, status: 200, text: async () => JSON.stringify({
    email: 'personal@example.com', rate_limit: { primary_window: { used_percent: 12, limit_window_seconds: 604800 } },
  }) }));
  const result = await collect([profile('codex', path.join(root, 'codex'))], null, { userRoot: root });
  assert.equal(result.accounts[0].weekly.remaining, 88);
  assert.equal(result.accounts[0].status, 'Live');
  assert.equal(fs.readFileSync(path.join(root, 'codex', 'auth.json'), 'utf8'), before);
  assert.deepEqual(fs.readdirSync(root), ['codex']);
});
