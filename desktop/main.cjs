'use strict';
const { app, BrowserWindow, ipcMain, dialog, protocol, net, session, Tray, Menu, nativeImage, shell } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { pathToFileURL } = require('node:url');
const { DesktopController, publicError } = require('./controller.cjs');

const appUrl = 'weekly://app/index.html';
protocol.registerSchemesAsPrivileged([{ scheme: 'weekly', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);
app.setName('Weekly AI Usage');
let window, tray, controller, refreshTimer;
const smokeIndex = process.argv.indexOf('--smoke-root');
let smokeRoot = null;
function insideRoot(root, candidate) {
  const relative = path.relative(root, path.resolve(candidate));
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}
function checkSmokeTree(root) {
  let count = 0;
  const visit = directory => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (++count > 10000 || entry.isSymbolicLink()) throw new Error('Isolated desktop tests cannot use linked filesystem entries.');
      if (entry.isDirectory()) visit(path.join(directory, entry.name));
    }
  };
  visit(root);
  const storeFile = path.join(root, 'profile-store.json');
  if (fs.existsSync(storeFile)) {
    const saved = JSON.parse(fs.readFileSync(storeFile, 'utf8'));
    if (!Array.isArray(saved.profiles) || saved.profiles.some(profile =>
      (profile.email && !/^[^@]+@example\.(com|org|net)$/.test(profile.email)) ||
      ['home', 'workspace', 'cli'].some(key => profile[key] && !insideRoot(root, profile[key]))))
      throw new Error('Isolated desktop tests cannot load private account state.');
  }
}
if (smokeIndex >= 0) {
  try {
  const candidate = path.resolve(process.argv[smokeIndex + 1] || '');
  const temporary = fs.realpathSync(os.tmpdir());
  if (!/^weekly-ai-usage-test-[a-f0-9-]+$/.test(path.basename(candidate)) ||
      path.dirname(fs.realpathSync(candidate)) !== temporary || fs.lstatSync(candidate).isSymbolicLink()) {
    throw new Error('Invalid isolated desktop test directory.');
  }
  checkSmokeTree(candidate);
  smokeRoot = candidate;
  } catch {
    process.stderr.write('Invalid isolated desktop test configuration.\n');
    process.exit(2);
  }
}
const dataRoot = smokeRoot || (process.platform === 'win32'
  ? path.join(process.env.LOCALAPPDATA || path.resolve(app.getPath('appData'), '..', 'Local'), 'Weekly AI Usage')
  : app.getPath('userData'));
app.setPath('userData', dataRoot);
const primary = app.requestSingleInstanceLock();
if (!primary) app.quit();

function showWindow() {
  if (!window) return;
  window.show(); if (window.isMinimized()) window.restore(); window.focus();
}
function runtimePaths() {
  if (app.isPackaged) return {
    runtime: path.join(process.resourcesPath, 'runtime', process.platform === 'win32' ? 'node.exe' : 'node'),
    runnerPath: path.join(process.resourcesPath, 'launcher', 'core', 'terminal-runner.cjs'),
  };
  // Development only. Packaged applications always use their own runtime.
  const nodeIndex = process.argv.indexOf('--development-node');
  return { runtime: nodeIndex >= 0 ? process.argv[nodeIndex + 1] : process.env.npm_node_execpath,
    runnerPath: path.join(__dirname, '..', 'core', 'terminal-runner.cjs') };
}
function smokeOptions() {
  if (!smokeRoot) return {};
  const signedIn = new Set();
  return {
    userHome: smokeRoot,
    identityReader: async profile => profile.email || signedIn.has(profile.id) ? { email: profile.email || 'connected@example.com' } : null,
    executableResolver: () => path.join(smokeRoot, 'synthetic-agent'),
    collector: async accounts => ({ accounts: accounts.map(account => ({
      ...account, status: 'Live', plan: 'Demo', weekly: { used: account.provider === 'claude' ? 74 : 38, remaining: account.provider === 'claude' ? 26 : 62,
        reset: new Date(Date.now() + 86400000).toISOString() }, session: { used: 12, remaining: 88, reset: new Date(Date.now() + 3600000).toISOString() },
      sessionLabel: '5 hours', capturedAt: new Date().toISOString(), checkedAt: new Date().toISOString(), message: '',
    })) }),
    launcher: async (profile, options) => {
      if (options.action === 'login') signedIn.add(profile.id);
      fs.appendFileSync(path.join(smokeRoot, 'launch-events.jsonl'), JSON.stringify({ id: profile.id, provider: profile.provider, action: options.action }) + '\n', { mode: 0o600 });
      return { started: true, clearedAuthKeys: [] };
    },
  };
}
function bind(name, handler) {
  ipcMain.handle('desktop:' + name, async (event, ...args) => {
    if (!window || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame ||
        event.senderFrame.url !== appUrl) return { ok: false, error: 'This action is only available inside the app.' };
    try {
      if (JSON.stringify(args).length > 20000) throw new Error('Invalid action input.');
      if (smokeRoot && ['addProfile', 'updateProfile'].includes(name)) {
        const input = name === 'addProfile' ? args[0] : args[1];
        if (input?.email && !/^[^@]+@example\.(com|org|net)$/.test(input.email)) throw new Error('Invalid synthetic identity.');
        for (const key of ['home', 'workspace', 'cli']) {
          if (input?.[key] && (!insideRoot(smokeRoot, input[key]) || !insideRoot(smokeRoot, fs.realpathSync(input[key]))))
            throw new Error('Invalid synthetic profile path.');
        }
      }
      const data = await handler(...args);
      if (smokeRoot && data && Array.isArray(data.profiles)) data.demo = true;
      if (['addProfile', 'updateProfile', 'importLegacy'].includes(name)) void controller.refreshUsage().catch(() => {});
      return { ok: true, data };
    } catch (error) { return { ok: false, error: publicError(error) }; }
  });
}
function registerActions() {
  bind('getState', () => controller.state());
  bind('addProfile', input => controller.addProfile(input));
  bind('updateProfile', (id, patch) => controller.updateProfile(id, patch));
  bind('removeProfile', id => controller.removeProfile(id));
  bind('setPrivacy', enabled => controller.setPrivacy(enabled));
  bind('setDefault', id => controller.setDefault(id));
  bind('refreshUsage', () => controller.refreshUsage());
  bind('launchProfile', (id, action) => controller.launch(id, action));
  bind('chooseFolder', async kind => {
    if (!['home', 'workspace'].includes(kind)) throw new Error('Invalid folder choice.');
    if (smokeRoot) {
      const folder = path.join(smokeRoot, 'picked-' + kind); fs.mkdirSync(folder, { recursive: true }); return folder;
    }
    const properties = ['openDirectory'];
    if (kind === 'home') properties.push('showHiddenFiles', ...(process.platform === 'darwin' ? ['noResolveAliases'] : ['dontAddToRecent']));
    const selected = await dialog.showOpenDialog(window, { title: kind === 'home' ? 'Choose an existing CLI profile folder' : 'Choose a project folder', properties });
    return selected.canceled ? null : selected.filePaths[0];
  });
  bind('chooseExecutable', async () => {
    if (smokeRoot) return null;
    const selected = await dialog.showOpenDialog(window, { title: 'Choose the installed agent CLI', properties: ['openFile'] });
    return selected.canceled ? null : selected.filePaths[0];
  });
  bind('importLegacy', async () => {
    if (smokeRoot) return controller.importLegacy(path.join(smokeRoot, 'legacy.json'));
    const homes = controller.discoverHomes();
    if (homes.length) {
      const choice = await dialog.showMessageBox(window, { type: 'question',
        buttons: ['Link existing account homes', 'Choose a settings file', 'Cancel'], defaultId: 0, cancelId: 2,
        message: `Found ${homes.length} profile folders in your local agent-auth setup.`,
        detail: 'Link those Codex and Claude folders in place? No credentials are copied. Already linked folders are skipped.' });
      if (choice.response === 0) return controller.importHomes();
      if (choice.response === 2) return controller.state();
    }
    const selected = await dialog.showOpenDialog(window, { title: 'Import existing dashboard account settings',
      defaultPath: process.env.WEEKLY_USAGE_CONFIG || path.join(path.dirname(process.execPath), 'accounts.json'),
      filters: [{ name: 'Account settings', extensions: ['json'] }], properties: ['openFile'] });
    if (selected.canceled) return controller.state();
    const confirmed = await dialog.showMessageBox(window, { type: 'question', buttons: ['Import references', 'Cancel'], defaultId: 1, cancelId: 1,
      message: 'Link the account folders from this file?', detail: 'Only local account references are imported. Provider credentials are not copied or moved.' });
    return confirmed.response === 0 ? controller.importLegacy(selected.filePaths[0]) : controller.state();
  });
  const guides = { codex: 'https://developers.openai.com/codex/cli/', claude: 'https://code.claude.com/docs/en/quickstart',
    grok: 'https://docs.x.ai/build', devin: 'https://docs.devin.ai/cli/getting-started' };
  bind('openProviderDocs', async provider => {
    if (!Object.hasOwn(guides, provider)) throw new Error('Invalid provider.');
    if (!smokeRoot) await shell.openExternal(guides[provider]);
    return null;
  });
}
function trayImage() {
  const size = 24, bytes = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const radius = Math.hypot(x - 11.5, y - 11.5);
    if ((radius >= 8 && radius <= 10 && !(y > 16 && x > 6 && x < 17)) ||
        (x >= 11 && x <= 17 && Math.abs(y - (23 - x)) < 1.2)) {
      const offset = (y * size + x) * 4; bytes.set([180, 89, 35, 255], offset);
    }
  }
  const icon = nativeImage.createFromBitmap(bytes, { width: size, height: size });
  if (process.platform === 'darwin') icon.setTemplateImage(true);
  return icon;
}

if (primary) app.whenReady().then(async () => {
  const assets = new Set(['index.html', 'renderer.js', 'styles.css']);
  protocol.handle('weekly', request => {
    const url = new URL(request.url), asset = url.pathname.slice(1);
    if (request.method !== 'GET' || url.host !== 'app' || !assets.has(asset)) return new Response('Not found', { status: 404 });
    return net.fetch(pathToFileURL(path.join(__dirname, asset)).href);
  });
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
  controller = new DesktopController({ dataRoot, ...runtimePaths(), ...smokeOptions() });
  if (smokeRoot) {
    const fixture = JSON.parse(fs.readFileSync(path.join(smokeRoot, 'fixture.json'), 'utf8'));
    if (!Array.isArray(fixture.profiles) || fixture.profiles.length > 20) throw new Error('Invalid synthetic fixture.');
    for (const profile of fixture.profiles) {
      if (!/^[^@]+@example\.(com|org|net)$/.test(profile.email || '') || !['codex', 'claude'].includes(profile.provider)) throw new Error('Synthetic fixture identities must use example domains.');
      controller.store.add({ provider: profile.provider, label: profile.label, email: profile.email, createNew: true });
    }
  }
  window = new BrowserWindow({ width: 1120, height: 800, minWidth: 800, minHeight: 600, show: false, title: 'Weekly AI Usage',
    backgroundColor: '#f6f8fb', icon: trayImage(),
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, sandbox: true,
      nodeIntegration: false, webSecurity: true, webviewTag: false, backgroundThrottling: !smokeRoot } });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  window.webContents.on('will-attach-webview', event => event.preventDefault());
  window.on('closed', () => { window = null; });
  if (process.platform === 'win32') window.removeMenu();
  else Menu.setApplicationMenu(Menu.buildFromTemplate([{ label: app.name, submenu: [{ role: 'about' }, { type: 'separator' }, { role: 'quit' }] },
    { role: 'editMenu' }, { role: 'windowMenu' }]));
  tray = new Tray(trayImage()); tray.setToolTip('Weekly AI Usage');
  tray.setContextMenu(Menu.buildFromTemplate([{ label: 'Open dashboard', click: showWindow },
    { label: 'Open default account', click: async () => {
      const id = controller.store.load().defaultProfileId;
      if (!id) { showWindow(); return; }
      try { await controller.launch(id, 'launch'); }
      catch (error) { showWindow(); dialog.showMessageBox(window, { message: publicError(error), type: 'info' }); }
    } },
    { label: 'Refresh usage', click: () => void controller.refreshUsage().catch(() => {}) }, { type: 'separator' }, { label: 'Quit', click: () => app.quit() }]));
  tray.on('double-click', showWindow); tray.on('click', showWindow);
  window.on('minimize', event => { event.preventDefault(); window.hide(); });
  registerActions();
  await window.loadURL(appUrl);
  if (!smokeRoot) window.show();
  void controller.refreshUsage().catch(() => {});
  refreshTimer = setInterval(() => void controller.refreshUsage().catch(() => {}), 15 * 60000); refreshTimer.unref();
}).catch(() => {
  if (!smokeRoot) dialog.showErrorBox('Weekly AI Usage could not start', 'Check that your local account settings are readable. Provider logins have not been changed.');
  app.exit(1);
});
app.on('second-instance', showWindow);
app.on('activate', showWindow);
app.on('window-all-closed', () => app.quit());
app.on('will-quit', () => { clearInterval(refreshTimer); tray?.destroy(); });
