'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { APP_FILES, LAUNCHER_FILES, releaseVersion, productionPackages, stageApplication, stageLauncher } = require('./package-desktop.cjs');
const { ARCHIVES, archiveFor, verifyArchive } = require('./download-runtime.cjs');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'weekly-package-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const repo = path.join(root, 'source');
  const write = (name, value) => {
    const file = path.join(repo, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value));
  };
  const dependencies = { 'synthetic-runtime': '1.0.0' };
  write('package.json', { name: 'synthetic-app', version: '1.0.0', description: 'fixture', license: 'MIT', dependencies,
    devDependencies: { 'synthetic-dev': '1.0.0' }, scripts: { prepare: 'must never ship' } });
  write('package-lock.json', { lockfileVersion: 3, packages: {
    '': { dependencies }, 'node_modules/synthetic-runtime': { version: '1.0.0' },
    'node_modules/synthetic-runtime/node_modules/synthetic-nested': { version: '1.0.0' },
    'node_modules/synthetic-dev': { version: '1.0.0', dev: true },
  } });
  for (const name of ['synthetic-runtime', 'synthetic-runtime/node_modules/synthetic-nested', 'synthetic-dev']) {
    write('node_modules/' + name + '/package.json', { name: name.split('/').at(-1), version: '1.0.0', main: 'index.js' });
    write('node_modules/' + name + '/index.js', 'module.exports = "synthetic";');
  }
  for (const name of APP_FILES) write(name, 'synthetic public file\n');
  return { root, repo, write };
}
function files(folder, prefix = '') {
  return fs.readdirSync(folder, { withFileTypes: true }).flatMap(entry => {
    const name = prefix + entry.name;
    return entry.isDirectory() ? files(path.join(folder, entry.name), name + '/') : [name];
  });
}

test('app staging copies only first-party allowlist and production dependency graph', t => {
  const { root, repo, write } = fixture(t);
  write('accounts.json', 'synthetic private configuration');
  write('.env', 'synthetic private configuration');
  write('unrelated.cjs', 'must not ship');
  write('node_modules/synthetic-runtime/node_modules/unlocked/index.js', 'must not ship');
  const target = path.join(root, 'app');
  const packages = stageApplication(repo, target, '0.3.0-preview.1');
  assert.deepEqual(packages, ['node_modules/synthetic-runtime', 'node_modules/synthetic-runtime/node_modules/synthetic-nested']);
  const actual = files(target).sort();
  const expected = [...APP_FILES, 'package.json',
    'node_modules/synthetic-runtime/package.json', 'node_modules/synthetic-runtime/index.js',
    'node_modules/synthetic-runtime/node_modules/synthetic-nested/package.json', 'node_modules/synthetic-runtime/node_modules/synthetic-nested/index.js'].sort();
  assert.deepEqual(actual, expected);
  const manifest = JSON.parse(fs.readFileSync(path.join(target, 'package.json'), 'utf8'));
  assert.equal(manifest.version, '0.3.0-preview.1');
  assert.equal(manifest.main, 'desktop/main.cjs');
  assert.equal(manifest.scripts, undefined);
  assert.equal(manifest.devDependencies, undefined);
});

test('external launcher stage contains only launcher files and runtime dependencies', t => {
  const { root, repo } = fixture(t), target = path.join(root, 'launcher');
  stageLauncher(repo, target, productionPackages(repo));
  const shipped = files(target);
  assert.deepEqual(shipped.filter(name => !name.startsWith('node_modules/')).sort(), [...LAUNCHER_FILES].sort());
  assert.equal(shipped.some(name => name.includes('synthetic-dev')), false);
  assert.equal(shipped.some(name => name.includes('synthetic-nested/index.js')), true);
});

test('staging fails on missing public source or mismatched installed dependency', t => {
  const { root, repo, write } = fixture(t);
  write('node_modules/synthetic-runtime/package.json', { name: 'synthetic-runtime', version: '0.0.0' });
  assert.throws(() => productionPackages(repo), /differs from the lockfile/);
  write('node_modules/synthetic-runtime/package.json', { name: 'synthetic-runtime', version: '1.0.0' });
  fs.unlinkSync(path.join(repo, 'desktop', 'preload.cjs'));
  assert.throws(() => stageApplication(repo, path.join(root, 'app'), '0.3.0-preview.1'), /ENOENT/);
});

test('invalid lockfile paths cannot escape the package source', t => {
  const { repo, write } = fixture(t);
  write('package-lock.json', { lockfileVersion: 3, packages: {
    '': { dependencies: { 'synthetic-runtime': '1.0.0' } }, '../outside': { version: '1.0.0' },
  } });
  assert.throws(() => productionPackages(repo), /Unsupported runtime dependency path/);
});

test('source directory links cannot import files outside the allowlisted tree', t => {
  const { root, repo } = fixture(t);
  const linked = path.join(repo, 'desktop'), moved = path.join(root, 'external-desktop');
  fs.renameSync(linked, moved);
  fs.symlinkSync(moved, linked, process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => stageApplication(repo, path.join(root, 'app'), '0.3.0-preview.1'), /symbolic links/);
});

test('package versions cannot inject installer flags or output paths', () => {
  assert.equal(releaseVersion('0.3.0-preview.1'), '0.3.0-preview.1');
  assert.equal(releaseVersion('1.2.3'), '1.2.3');
  for (const value of ['../1.0.0', '1.0.0 /danger', '1.0', '', 'v1.0.0', '1.0.0\n', undefined])
    assert.throws(() => releaseVersion(value), /Package version/);
});

test('each runtime has a pinned official HTTPS archive and safe extraction member', () => {
  for (const key of Object.keys(ARCHIVES)) {
    const [platform, arch] = key.split('-'), archive = archiveFor(platform, arch);
    assert.equal(new URL(archive.url).origin, 'https://nodejs.org');
    assert.match(archive.sha256, /^[a-f0-9]{64}$/);
    assert.equal(archive.binary, platform === 'win32' ? 'node.exe' : 'bin/node');
  }
  assert.throws(() => archiveFor('linux', 'x64'), /supports Windows/);
  assert.throws(() => archiveFor('win32', 'arm64'), /supports Windows/);
});

test('runtime extraction is gated by the exact archive checksum', async t => {
  const { root } = fixture(t), archive = path.join(root, 'fixture.zip');
  fs.writeFileSync(archive, 'synthetic archive bytes');
  const hash = createHash('sha256').update('synthetic archive bytes').digest('hex');
  await verifyArchive(archive, hash);
  fs.appendFileSync(archive, 'modified');
  await assert.rejects(verifyArchive(archive, hash), /pinned SHA256/);
});
