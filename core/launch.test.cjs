'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { EventEmitter } = require('node:events');
const { spawn } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const { ProfileStore } = require('./profiles.cjs');
const { prepareEnvironment, prepareLaunch, terminalSpecification, launchProfile,
  assertCompatibleSettings, resolveExecutable, supportedVersion, readVersionOutput } = require('./launch.cjs');
const { runPlan, readPlan } = require('./terminal-runner.cjs');

function fixture(t, provider = 'codex') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'weekly-launch-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const store = new ProfileStore(path.join(root, 'app'));
  const profile = store.add({ provider, label: 'Synthetic', createNew: true, cli: process.execPath, workspace: root });
  const env = { SystemRoot: process.env.SystemRoot, PATH: path.dirname(process.execPath), HOME: root, USERPROFILE: root };
  return { root, profile, env, store };
}

function planFile(root, plan) {
  const directory = path.join(root, 'launches');
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const file = path.join(directory, randomUUID() + '.json');
  fs.writeFileSync(file, JSON.stringify(plan), { mode: 0o600 });
  return file;
}

test('child environment selects one profile and removes auth overrides without mutating parent', () => {
  const original = { CODEX_HOME: 'other', OPENAI_API_KEY: 'synthetic-private-value', PATH: 'original', Keep: 'yes' };
  const result = prepareEnvironment('codex', '/selected', original, 'darwin');
  assert.equal(original.OPENAI_API_KEY, 'synthetic-private-value');
  assert.equal(original.CODEX_HOME, 'other');
  assert.equal(result.env.CODEX_HOME, '/selected');
  assert.equal(result.env.OPENAI_API_KEY, undefined);
  assert.deepEqual(result.clearedAuthKeys, ['OPENAI_API_KEY']);
  assert.equal(result.env.Keep, 'yes');
  assert.match(result.env.PATH, /\/opt\/homebrew\/bin/);
  const claude = prepareEnvironment('claude', '/selected', { ANTHROPIC_API_KEY: 'synthetic', CLAUDE_CODE_USE_VERTEX: '1', CLAUDE_CONFIG_DIR: '/old', ANTHROPIC_PROFILE: 'other', CLAUDE_SECURESTORAGE_CONFIG_DIR: '/other' }, 'darwin');
  assert.equal(claude.env.CLAUDE_CONFIG_DIR, '/selected');
  assert.equal(claude.env.ANTHROPIC_API_KEY, undefined);
  assert.equal(claude.env.CLAUDE_CODE_USE_VERTEX, undefined);
  assert.equal(claude.env.ANTHROPIC_PROFILE, undefined);
  assert.equal(claude.env.CLAUDE_SECURESTORAGE_CONFIG_DIR, undefined);
  const defaultClaude = prepareEnvironment('claude', '/default', { CLAUDE_CONFIG_DIR: '/old' }, 'darwin', true);
  assert.equal(defaultClaude.env.CLAUDE_CONFIG_DIR, undefined);
});

test('existing-login providers block competing inherited settings using names only', () => {
  for (const [provider, key] of [['grok', 'GROK_HOME'], ['grok', 'GROK_API_KEY'], ['grok', 'XAI_API_KEY'],
    ['devin', 'WINDSURF_API_SERVER_URL']]) {
    const env = { [key]: 'synthetic-private-value', PATH: 'synthetic-path' };
    assert.throws(() => prepareEnvironment(provider, null, env), error => error.message.includes(key) &&
      /Restart the app/.test(error.message) && !error.message.includes('synthetic-private-value'));
    assert.equal(env[key], 'synthetic-private-value');
  }
  assert.doesNotThrow(() => prepareEnvironment('grok', null, { GROK_HOME: '', XAI_API_KEY: '' }));
  assert.doesNotThrow(() => prepareEnvironment('devin', null, {}));
});

test('login uses provider-owned subcommands and shared default homes cannot reconnect', t => {
  const { profile, env, root } = fixture(t);
  const options = { env, action: 'login', managedPaths: [] };
  assert.deepEqual(prepareLaunch(profile, options).plan.args, ['login']);
  assert.deepEqual(prepareLaunch({ ...profile, provider: 'claude' }, options).plan.args, ['auth', 'login']);
  assert.throws(() => prepareLaunch({ ...profile, usesDefaultHome: true, sharesDefaultHome: true }, options), /existing-login/);
  assert.throws(() => prepareLaunch({ ...profile, provider: 'grok' }, options), /existing-login/);
  const existing = prepareLaunch({ ...profile, provider: 'devin', home: null }, { env, managedPaths: [] });
  assert.equal(existing.plan.home, null);
  assert.equal(existing.plan.cwd, root);
  assert.throws(() => prepareLaunch({ ...profile, cli: path.join(root, 'missing') }, { env }), /CLI not found/);
});

test('missing projects open in the user home and credential folders cannot become projects', t => {
  for (const provider of ['codex', 'claude']) {
    const { profile, env, root } = fixture(t, provider);
    for (const action of ['launch', 'login']) {
      const prepared = prepareLaunch({ ...profile, workspace: null }, { env, action, managedPaths: [] });
      assert.equal(prepared.plan.cwd, root);
      assert.notEqual(prepared.plan.cwd, profile.home);
      assert.throws(() => prepareLaunch({ ...profile, workspace: profile.home }, { env, action, managedPaths: [] }),
        error => /outside the account profile folder/.test(error.message) && !error.message.includes(profile.home));
    }
    const child = path.join(profile.home, 'nested-project');
    fs.mkdirSync(child);
    const alias = path.join(root, 'project-alias');
    fs.symlinkSync(child, alias, process.platform === 'win32' ? 'junction' : 'dir');
    for (const workspace of [child, alias]) {
      assert.throws(() => prepareLaunch({ ...profile, workspace }, { env, managedPaths: [] }), /Credential folders cannot be used as projects/);
    }
    const sibling = profile.home + '-project';
    fs.mkdirSync(sibling);
    assert.equal(prepareLaunch({ ...profile, workspace: sibling }, { env, managedPaths: [] }).plan.cwd, sibling);
    const withoutHome = { ...env }; delete withoutHome.HOME;
    assert.equal(prepareLaunch({ ...profile, workspace: null }, { env: withoutHome, managedPaths: [] }).plan.cwd, root);
  }
});

test('Claude launches retain exact explicit alias namespaces and block reconnect for shared defaults', t => {
  const { profile, root, env } = fixture(t, 'claude');
  const alias = path.join(root, 'profile-alias');
  fs.symlinkSync(profile.home, alias, process.platform === 'win32' ? 'junction' : 'dir');
  const prepared = prepareLaunch({ ...profile, home: alias }, { env, managedPaths: [] });
  assert.equal(prepared.plan.home, alias);
  assert.equal(prepared.env.CLAUDE_CONFIG_DIR, alias);
  const userHome = path.join(root, 'synthetic-user');
  const defaultHome = path.join(userHome, '.claude');
  fs.mkdirSync(defaultHome, { recursive: true });
  const store = new ProfileStore(path.join(root, 'default-test-app'), { userHome });
  const explicit = store.add({ provider: 'claude', label: 'Explicit default folder', home: defaultHome, cli: process.execPath });
  const explicitLaunch = prepareLaunch(explicit, { env, managedPaths: [] });
  assert.equal(explicitLaunch.env.CLAUDE_CONFIG_DIR, defaultHome);
  assert.equal(explicitLaunch.plan.usesDefaultHome, false);
  assert.equal(explicitLaunch.plan.sharesDefaultHome, true);
  assert.throws(() => prepareLaunch(explicit, { env, action: 'login', managedPaths: [] }), /existing-login/);
  store.remove(explicit.id);
  const bare = store.add({ provider: 'claude', label: 'Bare default login', defaultLogin: true, cli: process.execPath });
  const defaultLaunch = prepareLaunch(bare, { env: { ...env, CLAUDE_CONFIG_DIR: alias }, managedPaths: [] });
  assert.equal(defaultLaunch.env.CLAUDE_CONFIG_DIR, undefined);
  assert.equal(defaultLaunch.plan.usesDefaultHome, true);
  assert.throws(() => prepareLaunch(bare, { env, action: 'login', managedPaths: [] }), /existing-login/);
});

test('profile and project auth config conflict errors name settings without exposing values', t => {
  const { profile, root, env } = fixture(t);
  const config = path.join(profile.home, 'config.toml');
  fs.writeFileSync(config, 'cli_auth_credentials_store = "keyring"\nforced_chatgpt_workspace_id = "synthetic-workspace"\n');
  assert.doesNotThrow(() => assertCompatibleSettings(profile, root, { env, managedPaths: [] }));
  fs.writeFileSync(config, '"model_provider" = "synthetic-private-provider"\n');
  assert.throws(() => assertCompatibleSettings(profile, root, { env }), error => /model_provider/.test(error.message) && !/synthetic-private/.test(error.message));
  fs.writeFileSync(config, 'cli_auth_credentials_store = "auto"\n');
  fs.mkdirSync(path.join(root, '.codex'));
  fs.writeFileSync(path.join(root, '.codex', 'config.toml'), 'forced_login_method = "api"');
  assert.throws(() => assertCompatibleSettings(profile, root, { env }), /forced_login_method/);
  fs.unlinkSync(path.join(root, '.codex', 'config.toml'));
  fs.writeFileSync(path.join(profile.home, 'auth.json'), '{"OPENAI_API_KEY":"synthetic"}');
  assert.throws(() => assertCompatibleSettings(profile, root, { env }), /auth_mode/);
});

test('Claude local, project and managed API auth settings block without rewriting policy', t => {
  const { profile, root, env } = fixture(t, 'claude');
  const policy = path.join(root, 'managed-settings.json');
  const contents = '{"env":{"ANTHROPIC_AUTH_TOKEN":"synthetic-private-value"}}';
  fs.writeFileSync(policy, contents);
  assert.throws(() => assertCompatibleSettings(profile, root, { env, managedPaths: [policy] }), /env.ANTHROPIC_AUTH_TOKEN/);
  assert.equal(fs.readFileSync(policy, 'utf8'), contents);
  const local = path.join(profile.home, 'settings.json');
  fs.writeFileSync(local, '{"apiKeyHelper":"synthetic-private-command"}');
  assert.throws(() => assertCompatibleSettings(profile, root, { env, managedPaths: [] }), error => /apiKeyHelper/.test(error.message) && !/synthetic-private/.test(error.message));
  fs.writeFileSync(local, '{"forceLoginMethod":"claudeai"}');
  assert.doesNotThrow(() => assertCompatibleSettings(profile, root, { env, managedPaths: [] }));
  fs.writeFileSync(local, '{broken');
  assert.throws(() => assertCompatibleSettings(profile, root, { env, managedPaths: [] }), /could not be checked/);
});

test('executable lookup uses absolute PATH locations and macOS GUI fallback paths', t => {
  const { root } = fixture(t);
  const local = path.join(root, '.local', 'bin');
  fs.mkdirSync(local, { recursive: true });
  const file = path.join(local, 'codex');
  fs.writeFileSync(file, '#!/bin/sh\nexit 0\n', { mode: 0o700 });
  assert.equal(resolveExecutable('codex', null, { HOME: root, PATH: '' }, { platform: 'darwin' }), fs.realpathSync.native(file));
  assert.equal(resolveExecutable('codex', 'relative', {}, { platform: 'darwin' }), null);
  assert.equal(resolveExecutable('unknown', file, {}, { platform: 'darwin' }), null);
});

test('Windows terminal encodes only quoted fixed paths; macOS uses a private command file', t => {
  const { root } = fixture(t);
  const options = {
    runtime: process.execPath, runnerPath: path.join(root, "runner's & helper.cjs"),
    planPath: path.join(root, 'plan $() &.json'), commandPath: path.join(root, 'launch.command'), env: {},
  };
  const windows = terminalSpecification({ ...options, platform: 'win32' });
  assert.deepEqual(windows.args.slice(0, 3), ['-NoLogo', '-NoProfile', '-EncodedCommand']);
  const command = Buffer.from(windows.args[3], 'base64').toString('utf16le');
  assert.ok(command.includes("runner''s & helper.cjs'"));
  assert.ok(command.includes("plan $() &.json'"));
  const mac = terminalSpecification({ ...options, platform: 'darwin' });
  assert.equal(mac.executable, '/usr/bin/open');
  assert.deepEqual(mac.args, ['-a', 'Terminal', options.commandPath]);
  assert.ok(mac.script.includes("runner'\\''s & helper.cjs'"));
  assert.throws(() => terminalSpecification({ ...options, platform: 'linux' }), /Windows and macOS/);
});

test('terminal spawn returns a safe result and failed spawn removes private requests', async t => {
  const { profile, root, env } = fixture(t);
  let captured;
  const fake = (command, args, options) => {
    captured = { command, args, options };
    const child = new EventEmitter(); child.unref = () => {};
    process.nextTick(() => child.emit('spawn'));
    return child;
  };
  const options = { env: { ...env, OPENAI_API_KEY: 'synthetic-private' }, platform: 'win32',
    runtime: process.execPath, runnerPath: __filename, dataRoot: path.join(root, 'app'), spawn: fake,
    versionReader: async () => 'codex-cli 0.156.0' };
  const result = await launchProfile(profile, options);
  assert.deepEqual(result, { started: true, clearedAuthKeys: ['OPENAI_API_KEY'] });
  assert.equal(captured.options.env.OPENAI_API_KEY, undefined);
  const launches = path.join(root, 'app', 'launches');
  const plan = path.join(launches, fs.readdirSync(launches)[0]);
  assert.equal(fs.readFileSync(plan, 'utf8').includes('synthetic-private'), false);
  fs.unlinkSync(plan);
  const failed = () => {
    const child = new EventEmitter();
    process.nextTick(() => child.emit('error', new Error('synthetic-private-path')));
    return child;
  };
  await assert.rejects(launchProfile(profile, { ...options, spawn: failed }), /Could not open a terminal/);
  assert.deepEqual(fs.readdirSync(launches), []);
});

test('two real child processes preserve separate homes, literal argv and untouched defaults', async t => {
  const { profile, root, env, store } = fixture(t);
  const other = store.add({ provider: 'codex', label: 'Second', createNew: true, cli: process.execPath, workspace: root });
  const defaults = path.join(root, '.codex');
  fs.mkdirSync(defaults);
  const shared = path.join(defaults, 'auth.json');
  fs.writeFileSync(shared, '{"syntheticDefault":true}');
  const before = fs.readFileSync(shared);
  const script = path.join(root, 'echo.cjs');
  fs.writeFileSync(script, "const fs=require('node:fs');setTimeout(()=>{fs.writeFileSync(process.argv[2],JSON.stringify({home:process.env.CODEX_HOME,args:process.argv.slice(3),override:process.env.OPENAI_API_KEY||null}));},100);");
  const args = ['with spaces', 'quote"value', "apostrophe'value", '& echo synthetic', '$(synthetic)', '%SYNTHETIC_VARIABLE%', 'semi;colon', 'back`tick'];
  const outputs = [path.join(root, 'one.json'), path.join(root, 'two.json')];
  const files = [];
  const requests = [profile, other].map((p, i) => {
    const prepared = prepareLaunch(p, { env, args: [script, outputs[i], ...args] });
    const file = planFile(root, prepared.plan);
    files.push(file);
    return runPlan(file, { env: { ...env, CODEX_HOME: defaults, OPENAI_API_KEY: 'synthetic-private' }, stdio: 'ignore' });
  });
  const results = await Promise.all(requests);
  assert.deepEqual(results.map(result => result.code), [0, 0]);
  const reports = outputs.map(file => JSON.parse(fs.readFileSync(file, 'utf8')));
  assert.deepEqual(reports.map(report => report.home), [profile.home, other.home]);
  for (const report of reports) { assert.deepEqual(report.args, args); assert.equal(report.override, null); }
  assert.deepEqual(fs.readFileSync(shared), before);
  assert.equal(files.some(file => fs.existsSync(file)), false);
});

test('Windows npm CMD shim resolves to direct Node execution preserving shell metacharacters', { skip: process.platform !== 'win32' }, async t => {
  const { profile, root, env } = fixture(t);
  const script = path.join(root, 'echo.cjs');
  const output = path.join(root, 'output.json');
  fs.writeFileSync(script, "require('node:fs').writeFileSync(process.argv[2],JSON.stringify(process.argv.slice(3)));");
  const shim = path.join(root, 'synthetic-agent.cmd');
  fs.writeFileSync(shim, '@ECHO off\r\nSET dp0=%~dp0\r\nSET "_prog=node"\r\n"%_prog%" "%dp0%\\echo.cjs" %*\r\n');
  const args = ['space value', 'quote"value', '& echo injected', '| more', 'semi;colon', '$(literal)', '%SYNTHETIC_UNSET_VALUE%'];
  const { plan } = prepareLaunch({ ...profile, cli: shim }, { env, args: [output, ...args] });
  const file = planFile(root, plan);
  assert.equal(plan.executable, process.execPath);
  assert.equal(plan.args[0], script);
  const result = await runPlan(file, { env, stdio: 'ignore' });
  assert.equal(result.code, 0);
  assert.deepEqual(JSON.parse(fs.readFileSync(output, 'utf8')), args);
  fs.writeFileSync(shim, '@echo %*');
  assert.throws(() => prepareLaunch({ ...profile, cli: shim }, { env }), /batch launcher is unsupported/);
});

test('runner rejects config overrides and deletes only its paired helper', async t => {
  const { profile, root, env } = fixture(t);
  assert.throws(() => prepareLaunch(profile, { env, args: ['--config', 'model_provider="other"'] }), /overrides/);
  assert.throws(() => prepareLaunch(profile, { env, args: ['-cmodel_provider="other"'] }), /overrides/);
  const helper = path.join(root, 'other.command');
  fs.writeFileSync(helper, 'synthetic');
  const { plan } = prepareLaunch(profile, { env, args: ['--version'] });
  plan.commandPath = helper;
  const invalid = planFile(root, plan);
  assert.throws(() => readPlan(invalid), /Invalid launch request/);
  assert.ok(fs.existsSync(invalid));
  assert.ok(fs.existsSync(helper));
  plan.commandPath = null;
  const file = planFile(root, plan);
  const result = await runPlan(file, { env, stdio: 'ignore', spawn });
  assert.equal(result.code, 0);
});

test('runner leaves unrelated JSON, malformed requests and linked files intact', t => {
  const { profile, root, env } = fixture(t);
  const contents = '{"syntheticCredential":"must-remain-intact"}';
  for (const filename of ['auth.json', 'other.json']) {
    const file = path.join(root, filename);
    fs.writeFileSync(file, contents, { mode: 0o600 });
    assert.throws(() => readPlan(file), /unavailable/);
    assert.equal(fs.readFileSync(file, 'utf8'), contents);
  }
  const malformed = planFile(root, { version: 1, syntheticCredential: 'must-remain-intact' });
  const before = fs.readFileSync(malformed);
  assert.throws(() => readPlan(malformed), /Invalid launch request/);
  assert.deepEqual(fs.readFileSync(malformed), before);
  const { plan } = prepareLaunch(profile, { env, args: ['--version'] });
  const linked = path.join(root, 'launches', randomUUID() + '.json');
  fs.linkSync(malformed, linked);
  assert.throws(() => readPlan(linked), /unavailable/);
  assert.deepEqual(fs.readFileSync(malformed), before);
  const aliasRoot = path.join(root, 'alias-parent');
  const targetRoot = path.join(root, 'alias-target');
  fs.mkdirSync(aliasRoot); fs.mkdirSync(targetRoot);
  const aliasDirectory = path.join(aliasRoot, 'launches');
  fs.symlinkSync(targetRoot, aliasDirectory, process.platform === 'win32' ? 'junction' : 'dir');
  const aliasName = randomUUID() + '.json';
  const targetFile = path.join(targetRoot, aliasName);
  fs.writeFileSync(targetFile, JSON.stringify(plan), { mode: 0o600 });
  assert.throws(() => readPlan(path.join(aliasDirectory, aliasName)), /unavailable/);
  assert.equal(fs.readFileSync(targetFile, 'utf8'), JSON.stringify(plan));
  const invalidArgs = planFile(root, { ...plan, args: ['--config=forced_login_method="api"'] });
  const argsBefore = fs.readFileSync(invalidArgs);
  assert.throws(() => readPlan(invalidArgs), /overrides/);
  assert.deepEqual(fs.readFileSync(invalidArgs), argsBefore);
  const owned = planFile(root, plan);
  const paired = owned.replace(/\.json$/, '.command');
  fs.writeFileSync(paired, '# synthetic generated helper', { mode: 0o700 });
  fs.writeFileSync(owned, JSON.stringify({ ...plan, commandPath: paired }));
  readPlan(owned);
  assert.equal(fs.existsSync(owned), false);
  assert.equal(fs.existsSync(paired), false);
});

test('isolated version gate requires recognized stable provider versions at the verified baseline', () => {
  for (const output of ['codex-cli 0.156.0', 'codex-cli 0.200.0', 'codex-cli 1.0.0']) {
    assert.ok(supportedVersion('codex', output));
  }
  for (const output of ['2.1.63 (Claude Code)', '2.1.99 (Claude Code)', '3.0.0 (Claude Code)']) {
    assert.ok(supportedVersion('claude', output));
  }
  for (const [provider, output] of [
    ['codex', 'codex-cli 0.155.99'], ['codex', 'codex-cli 0.156.0-alpha.1'],
    ['codex', 'v99.0.0'], ['claude', '2.1.62 (Claude Code)'],
    ['claude', '99.0.0 (Unknown Tool)'], ['claude', 'synthetic-private-output'],
  ]) {
    assert.throws(() => supportedVersion(provider, output), error => /installation guide/.test(error.message) && !error.message.includes(output));
  }
});

test('old, unrecognized or failed version checks never open a terminal or write a launch plan', async t => {
  const { profile, root, env } = fixture(t);
  let terminalCalls = 0;
  const options = { env, runtime: process.execPath, runnerPath: __filename, dataRoot: path.join(root, 'app'),
    spawn: () => { terminalCalls++; throw new Error('Terminal must not open'); } };
  for (const provider of ['codex', 'claude']) {
    for (const output of ['unknown synthetic-private-output', provider === 'codex' ? 'codex-cli 0.155.0' : '2.1.62 (Claude Code)']) {
      await assert.rejects(launchProfile({ ...profile, provider }, { ...options, versionReader: async () => output }), /or newer is required/);
    }
  }
  await assert.rejects(launchProfile(profile, { ...options, versionReader: async () => { throw new Error('synthetic-private-diagnostic'); } }),
    error => /or newer is required/.test(error.message) && !error.message.includes('synthetic-private'));
  assert.equal(terminalCalls, 0);
  assert.equal(fs.existsSync(path.join(root, 'app', 'launches')), false);
});

test('version check executes only --version in the selected environment and preserves launch argv', async t => {
  const { profile, root, env } = fixture(t);
  const capture = path.join(root, 'version-report.json');
  const script = path.join(root, 'synthetic-cli.cjs');
  fs.writeFileSync(script, '#!/usr/bin/env node\n' +
    "require('node:fs').writeFileSync(process.env.SYNTHETIC_CAPTURE,JSON.stringify({args:process.argv.slice(2),home:process.env.CODEX_HOME,override:process.env.OPENAI_API_KEY||null}));process.stdout.write('codex-cli 0.156.0\\n');", { mode: 0o700 });
  let executable = script;
  if (process.platform === 'win32') {
    executable = path.join(root, 'synthetic-cli.cmd');
    fs.writeFileSync(executable, '@ECHO off\r\nSET dp0=%~dp0\r\nSET "_prog=node"\r\n"%_prog%" "%dp0%\\synthetic-cli.cjs" %*\r\n');
  }
  const fakeTerminal = () => {
    const child = new EventEmitter(); child.unref = () => {};
    process.nextTick(() => child.emit(process.platform === 'darwin' ? 'exit' : 'spawn', 0));
    return child;
  };
  const args = ['exec', 'literal & $(value)'];
  const result = await launchProfile({ ...profile, cli: executable }, {
    env: { ...env, SYNTHETIC_CAPTURE: capture, OPENAI_API_KEY: 'synthetic-private-value' }, args,
    runtime: process.execPath, runnerPath: __filename, dataRoot: path.join(root, 'app'), spawn: fakeTerminal,
  });
  assert.equal(result.started, true);
  const report = JSON.parse(fs.readFileSync(capture, 'utf8'));
  assert.deepEqual(report, { args: ['--version'], home: profile.home, override: null });
  const launches = path.join(root, 'app', 'launches');
  const plan = JSON.parse(fs.readFileSync(path.join(launches, fs.readdirSync(launches).find(file => file.endsWith('.json'))), 'utf8'));
  assert.deepEqual(plan.args.slice(-args.length), args);
  assert.equal(plan.checkedCliVersion, '0.156.0');
});

test('version reader caps output, discards stderr and times out synthetic child processes', async t => {
  const { root, env } = fixture(t);
  const script = path.join(root, 'version.cjs');
  const invocation = { executable: process.execPath, args: [script] };
  fs.writeFileSync(script, "process.stderr.write('synthetic-private-diagnostic');process.stdout.write('2.1.63 (Claude Code)');");
  assert.equal(await readVersionOutput(invocation, { env, cwd: root }), '2.1.63 (Claude Code)');
  fs.writeFileSync(script, "process.stdout.write('x'.repeat(5000));");
  await assert.rejects(readVersionOutput(invocation, { env, cwd: root }), /could not be checked/);
  fs.writeFileSync(script, 'setTimeout(()=>{},10000);');
  await assert.rejects(readVersionOutput(invocation, { env, cwd: root, timeoutMs: 50 }), /could not be checked/);
});
