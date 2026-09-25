'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { _electron } = require('playwright-core');

const repository = path.resolve(__dirname, '..');
const packagedIndex = process.argv.indexOf('--packaged');
const packaged = packagedIndex >= 0 ? path.resolve(process.argv[packagedIndex + 1]) : null;
const screenshots = path.join(repository, 'dist', 'desktop-qa-' + process.platform + '-' + process.arch);
fs.mkdirSync(screenshots, { recursive: true });
let checks = 0;
function check(value, message) { assert.ok(value, message); checks++; process.stdout.write(`ok ${checks} - ${message}\n`); }
function fixture(profiles) {
  const root = path.join(fs.realpathSync(os.tmpdir()), 'weekly-ai-usage-test-' + randomUUID());
  fs.mkdirSync(root, { mode: 0o700 });
  fs.writeFileSync(path.join(root, 'fixture.json'), JSON.stringify({ profiles }), { mode: 0o600 });
  return root;
}
async function start(root) {
  const executablePath = packaged || require('electron');
  const args = [...(packaged ? [] : [repository]), '--smoke-root', root, '--development-node', process.execPath];
  const instance = await _electron.launch({ executablePath, args, timeout: 30000, env: { ...process.env, ELECTRON_ENABLE_LOGGING: '0' } });
  const page = await instance.firstWindow();
  await page.waitForSelector('#page-title');
  await page.waitForFunction(() => document.getElementById('account-summary').textContent !== 'Loading your accounts...');
  return { instance, page };
}
async function rpc(page, method, ...args) { return page.evaluate(({ method, args }) => window.desktop[method](...args), { method, args }); }
async function reloadState(page) {
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await page.waitForTimeout(100);
}
async function main() {
  if (packaged) {
    const resources = process.platform === 'darwin' ? path.resolve(path.dirname(packaged), '..', 'Resources') : path.join(path.dirname(packaged), 'resources');
    const runtime = path.join(resources, 'runtime', process.platform === 'win32' ? 'node.exe' : 'node');
    const runner = path.join(resources, 'launcher', 'core', 'terminal-runner.cjs');
    const probeRoot = fixture([]), home = path.join(probeRoot, 'selected-home'), launches = path.join(probeRoot, 'launches');
    fs.mkdirSync(home, { mode: 0o700 }); fs.mkdirSync(launches, { mode: 0o700 });
    const probe = path.join(probeRoot, 'probe.cjs');
    fs.writeFileSync(probe, 'process.stdout.write(JSON.stringify({home:process.env.CODEX_HOME,override:process.env.OPENAI_API_KEY,args:process.argv.slice(2)}))');
    const request = path.join(launches, randomUUID() + '.json');
    fs.writeFileSync(request, JSON.stringify({ version: 1, provider: 'codex', home, usesDefaultHome: false, sharesDefaultHome: false,
      cwd: probeRoot, executable: runtime, args: [probe, 'literal & value', 'quote"here'] }), { mode: 0o600 });
    const env = { PATH: path.dirname(runtime), HOME: probeRoot, USERPROFILE: probeRoot, OPENAI_API_KEY: 'synthetic-override' };
    if (process.env.SystemRoot) env.SystemRoot = process.env.SystemRoot;
    const result = JSON.parse(execFileSync(runtime, [runner, request], { env, encoding: 'utf8', windowsHide: true, timeout: 15000 }));
    check(result.home === home && !result.override, 'packaged helper selects its profile and removes competing auth');
    check(JSON.stringify(result.args) === JSON.stringify(['literal & value', 'quote"here']), 'packaged helper preserves literal CLI arguments');
    check(!fs.existsSync(request), 'packaged helper consumes only its private launch request');
  }
  const emptyRoot = fixture([]);
  let { instance, page } = await start(emptyRoot);
  try {
    check(await page.locator('#empty-state').isVisible(), 'first run provides an account setup action');
    const preferences = await instance.evaluate(({ BrowserWindow }) => {
      const p = BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences();
      return { nodeIntegration: p.nodeIntegration, contextIsolation: p.contextIsolation, sandbox: p.sandbox };
    });
    check(!preferences.nodeIntegration && preferences.contextIsolation && preferences.sandbox, 'renderer has no Node integration and stays isolated/sandboxed');
    check(await page.evaluate(() => typeof require === 'undefined'), 'renderer cannot require Node modules');
    await page.screenshot({ path: path.join(screenshots, 'welcome.png'), fullPage: true });
    await page.locator('#add-first-profile').click();
    await page.locator('#profile-label').fill('Personal');
    await page.locator('#choose-workspace').click();
    check(!(await page.locator('body').innerText()).includes(emptyRoot), 'privacy mode hides newly selected folder paths');
    await page.screenshot({ path: path.join(screenshots, 'account-setup.png'), fullPage: true });
    await page.locator('#save-profile').click();
    await page.waitForSelector('.profile-card');
    const added = (await rpc(page, 'getState')).data;
    check(added.profiles.length === 1 && added.profiles[0].label === 'Personal', 'account setup saves the profile');
    const id = added.profiles[0].id;
    check(!JSON.stringify(added).includes(emptyRoot) && !JSON.stringify(added).includes('@example.com'), 'privacy API excludes email and filesystem paths');
    await page.getByRole('button', { name: 'Sign in to Personal', exact: true }).click();
    await page.waitForFunction(() => document.getElementById('app-notice').textContent.includes('Sign-in terminal opened'));
    check(JSON.parse(fs.readFileSync(path.join(emptyRoot, 'launch-events.jsonl'), 'utf8').trim()).action === 'login', 'sign-in action targets the provider login launcher');
    await page.getByRole('button', { name: 'Open terminal with Personal', exact: true }).click();
    await page.waitForFunction(() => document.getElementById('app-notice').textContent.includes('Terminal opened'));
    const launches = fs.readFileSync(path.join(emptyRoot, 'launch-events.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
    check(launches.length === 2 && launches[1].id === id && launches[1].action === 'launch', 'open terminal targets the selected profile');
    await page.locator('#refresh-usage').click();
    await page.waitForSelector('.status-live');
    check(await page.locator('.quota-value').innerText().then(text => text.includes('62%')), 'quota shows verified synthetic provider data');
    await page.locator('#privacy-toggle').click();
    await page.waitForSelector('.private-details');
    check((await page.locator('body').innerText()).includes('connected@example.com'), 'identity details are shown only after an explicit privacy toggle');
    await page.locator('#privacy-toggle').click();
    await page.waitForFunction(() => document.querySelectorAll('.private-details').length === 0);
    const hidden = await page.content();
    if (hidden.includes('connected@example.com') || hidden.includes(emptyRoot))
      fs.writeFileSync(path.join(screenshots, 'privacy-failure.html'), hidden.replaceAll(emptyRoot, '[fixture-root]'));
    check(!hidden.includes('connected@example.com') && !hidden.includes(emptyRoot), 'hiding details removes private values from the DOM');
    const unknown = await rpc(page, 'launchProfile', 'unknown', 'launch');
    check(!unknown.ok, 'unknown account launch is rejected by IPC controller');
    check(!(await rpc(page, 'launchProfile', id, 'push')).ok, 'unapproved credential actions are not exposed');
    const encoded = await rpc(page, 'addProfile', { provider: 'claude', label: '<img src=x onerror=alert(1)>', createNew: true });
    check(encoded.ok, 'synthetic adversarial nickname is valid text');
    await reloadState(page);
    check(await page.locator('img[src=x]').count() === 0, 'nicknames cannot inject HTML');
    const attackProfile = encoded.data.profiles.find(p => p.provider === 'claude');
    await rpc(page, 'removeProfile', attackProfile.id); await reloadState(page);
    const denied = await instance.evaluate(async ({ BrowserWindow }) => {
      const original = BrowserWindow.getAllWindows()[0];
      const other = new BrowserWindow({ show: false, webPreferences: { preload: original.webContents.getLastWebPreferences().preload,
        contextIsolation: true, sandbox: true, nodeIntegration: false } });
      try { await other.loadURL('weekly://app/index.html'); return await other.webContents.executeJavaScript('typeof window.desktop === "object" ? window.desktop.getState() : ({ ok: false })'); }
      finally { other.destroy(); }
    });
    check(denied.ok === false, 'a separate renderer cannot invoke privileged profile IPC');
    check(await page.evaluate(() => fetch('https://example.com').then(() => false, () => true)), 'renderer network access is blocked by CSP');
    await page.setViewportSize({ width: 800, height: 720 });
    check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'layout fits the minimum supported width');
    await page.screenshot({ path: path.join(screenshots, 'account-private.png'), fullPage: true });
    await page.getByRole('button', { name: 'Edit Personal', exact: true }).click();
    await page.locator('#remove-profile').click(); await page.locator('#confirm-remove').click();
    await page.waitForFunction(() => !document.getElementById('empty-state').hidden);
    check(fs.existsSync(path.join(emptyRoot, 'profiles', 'codex', id)), 'removing an account leaves its provider home intact');
  } finally { await instance.close(); }

  const root = fixture([
    { provider: 'codex', label: 'Personal', email: 'personal@example.com' },
    { provider: 'claude', label: 'Work', email: 'work@example.com' },
  ]);
  ({ instance, page } = await start(root));
  try {
    await page.waitForSelector('.status-live');
    check(await page.locator('.profile-card').count() === 2, 'multiple providers appear together');
    check(!(await page.content()).includes('personal@example.com') && !(await page.content()).includes('work@example.com'), 'default screenshots contain nicknames instead of emails');
    const state = (await rpc(page, 'getState')).data;
    await rpc(page, 'setDefault', state.profiles[1].id); await reloadState(page);
    const quick = page.locator('#launch-default');
    if (await quick.count()) {
      await quick.click();
      await page.waitForFunction(() => document.getElementById('app-notice').textContent.includes('Terminal opened'));
      check(JSON.parse(fs.readFileSync(path.join(root, 'launch-events.jsonl'), 'utf8').trim()).id === state.profiles[1].id, 'default quick action launches its selected account');
    } else throw new Error('Default account quick action is missing.');
    await page.screenshot({ path: path.join(screenshots, 'dashboard.png'), fullPage: true });
    const linked = path.join(root, 'legacy-home'); fs.mkdirSync(linked);
    fs.writeFileSync(path.join(root, 'legacy.json'), JSON.stringify({ accounts: [{ provider: 'codex', label: 'Linked', email: 'linked@example.com', home: linked }] }));
    const imported = await rpc(page, 'importLegacy');
    check(imported.ok && imported.data.importResult.imported === 1, 'legacy import links an existing profile reference');
    check(fs.readdirSync(linked).length === 0, 'legacy import does not copy credential data');
  } finally { await instance.close(); }
  process.stdout.write(`PASS: ${checks} Electron desktop checks (${packaged ? 'packaged' : 'development'}, ${process.platform}/${process.arch}). Synthetic screenshots saved.\n`);
}
main().catch(error => {
  // Do not print Playwright protocol logs or profile paths into public CI logs.
  process.stderr.write('Desktop check failed: ' + String(error.message).split('\n')[0].replace(/[A-Z]:[\\/][^\r\n]*/gi, '[local path]') + '\n');
  process.exitCode = 1;
});
