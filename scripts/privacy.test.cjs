'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { textFindings, checkBytes, scanArtifact } = require('./privacy-check.cjs');

const syntheticEmail = ['private-fixture', ['synthetic-mail', 'com'].join('.')].join('@');
const syntheticKey = ['sk', 'proj', 'q'.repeat(30)].join('-');
const syntheticJwt = ['eyJ' + 'a'.repeat(30), 'b'.repeat(30), 'c'.repeat(20)].join('.');
const privateHeader = ['-----BEGIN', 'PRIVATE KEY-----'].join(' ');
const windowsHome = path.win32.join('C:', 'Users', 'synthetic-user', 'settings.json');
const macHome = path.posix.join('/', 'Users', 'synthetic-user', 'settings.json');

function temporaryDirectory(t) {
  const base = fs.realpathSync(os.tmpdir());
  const directory = fs.mkdtempSync(path.join(base, 'weekly-privacy-test-'));
  t.after(() => {
    const resolved = fs.realpathSync(directory);
    assert.equal(path.dirname(resolved), base, 'Cleanup must stay inside the temporary directory.');
    assert.equal(path.basename(resolved).startsWith('weekly-privacy-test-'), true, 'Cleanup must target this fixture.');
    fs.rmSync(resolved, { recursive: true, force: true });
  });
  return directory;
}

function writeFixture(root, name, value) {
  const file = path.join(root, name);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, value);
}

test('account findings report category and location without copying the address', () => {
  const findings = textFindings('src/settings.js', syntheticEmail);
  assert.deepEqual(findings, [{ path: 'src/settings.js', rule: 'non-example account address' }]);
  assert.equal(JSON.stringify(findings).includes(syntheticEmail), false);
});

test('example, test, invalid and public no-reply addresses are permitted', () => {
  const addresses = ['person@example.com', 'person@example.org', 'person@example.net',
    'person@fixture.test', 'person@fixture.invalid', '123-fixture@users.noreply.github.com'];
  assert.deepEqual(textFindings('docs/example.md', addresses.join('\n')), []);
});

test('credential-shaped synthetic values are detected without exposing their contents', () => {
  for (const value of [syntheticKey, syntheticJwt, privateHeader]) {
    const findings = textFindings('src/settings.js', value);
    assert.deepEqual(findings, [{ path: 'src/settings.js', rule: 'credential-like literal' }]);
    assert.equal(JSON.stringify(findings).includes(value), false);
  }
});

test('private Windows and macOS homes are detected without exposing the home', () => {
  for (const value of [windowsHome, macHome]) {
    const findings = textFindings('docs/setup.md', value);
    assert.deepEqual(findings, [{ path: 'docs/setup.md', rule: 'machine-specific home path' }]);
    assert.equal(JSON.stringify(findings).includes(value), false);
  }
});

test('private state filenames are rejected even when empty or inside a dependency', () => {
  const filenames = ['auth.json', '.credentials.json', 'accounts.json', 'profile-store.json',
    'profiles.json', 'usage-cache.json', 'quota-cache.json', 'credentials.toml', '.env',
    '.env.local', 'login.keychain', 'login.keychain-db'];
  for (const name of filenames) {
    for (const prefix of ['src', 'node_modules/dependency']) {
      const relative = path.join(prefix, name);
      assert.deepEqual(checkBytes(relative, Buffer.alloc(0)), [{ path: relative, rule: 'private state file' }]);
    }
  }
});

test('third-party maintainer addresses are excluded without hiding project addresses', () => {
  for (const separator of ['/', '\\']) {
    const dependency = ['resources', 'app.asar', 'node_modules', 'outer', 'node_modules', 'inner', 'package.json'].join(separator);
    assert.deepEqual(checkBytes(dependency, Buffer.from(syntheticEmail)), []);
    const project = ['resources', 'app.asar', 'src', 'settings.js'].join(separator);
    assert.equal(checkBytes(project, Buffer.from(syntheticEmail)).some(item => item.rule === 'non-example account address'), true);
  }
});

test('ASAR traversal handles nested dependencies and flags only the project and private state', async t => {
  const root = temporaryDirectory(t);
  const source = path.join(root, 'source');
  const artifact = path.join(root, 'artifact');
  fs.mkdirSync(artifact);
  writeFixture(source, 'src/settings.js', [syntheticEmail, syntheticKey, windowsHome].join('\n'));
  writeFixture(source, 'node_modules/outer/package.json', JSON.stringify({ author: syntheticEmail }));
  writeFixture(source, 'node_modules/outer/node_modules/inner/package.json', JSON.stringify({ author: syntheticEmail }));
  writeFixture(source, 'node_modules/outer/node_modules/inner/auth.json', '{}');
  writeFixture(source, 'state/.credentials.json', '{}');
  const asar = await import('@electron/asar');
  try { await asar.createPackage(source, path.join(artifact, 'app.asar')); }
  catch { assert.fail('Could not create the synthetic archive.'); }
  let findings;
  try { findings = await scanArtifact(artifact); }
  catch { assert.fail('Could not traverse the synthetic archive.'); }
  const summary = findings.map(item => ({ path: item.path.replaceAll('\\', '/'), rule: item.rule }));
  assert.equal(summary.length, 5, 'Expected project payload findings and two private state files.');
  assert.equal(summary.filter(item => item.path === 'app.asar/src/settings.js').length, 3);
  assert.equal(summary.some(item => item.path === 'app.asar/node_modules/outer/node_modules/inner/auth.json' && item.rule === 'private state file'), true);
  assert.equal(summary.some(item => item.path === 'app.asar/state/.credentials.json' && item.rule === 'private state file'), true);
  assert.equal(summary.some(item => item.path.endsWith('/package.json')), false);
  for (const value of [syntheticEmail, syntheticKey, windowsHome]) assert.equal(JSON.stringify(findings).includes(value), false);

  let exitStatus = 0, output = '';
  try { output = execFileSync(process.execPath, [path.join(__dirname, 'privacy-check.cjs'), '--artifact', artifact], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }); }
  catch (error) { exitStatus = error.status; output = String(error.stdout || '') + String(error.stderr || ''); }
  assert.equal(exitStatus, 1, 'The public scanner command must reject the synthetic artifact.');
  assert.equal(output.includes('private state file'), true);
  assert.equal(output.includes('non-example account address'), true);
  for (const value of [syntheticEmail, syntheticKey, windowsHome]) assert.equal(output.includes(value), false);
});

test('the test source itself contains no forbidden literal fixtures', () => {
  assert.deepEqual(checkBytes('scripts/privacy.test.cjs', fs.readFileSync(__filename)), []);
});
