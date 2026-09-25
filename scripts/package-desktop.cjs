'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { downloadRuntime, sha256 } = require('./download-runtime.cjs');
const run = promisify(execFile);

const APP_NAME = 'Weekly AI Usage';
const APP_FILES = Object.freeze([
  'desktop/main.cjs', 'desktop/controller.cjs', 'desktop/preload.cjs',
  'desktop/index.html', 'desktop/styles.css', 'desktop/renderer.js',
  'core/profiles.cjs', 'core/launch.cjs', 'core/terminal-runner.cjs',
  'collect.cjs', 'credentials.cjs', 'grok.cjs', 'devin.cjs',
  'LICENSE', 'README.md', 'docs/troubleshooting.md', 'docs/screenshot.png', 'docs/onboarding.png',
]);
const LAUNCHER_FILES = Object.freeze(['core/profiles.cjs', 'core/launch.cjs', 'core/terminal-runner.cjs']);
function releaseVersion(value) {
  if (typeof value !== 'string' || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*)?$/.test(value))
    throw new Error('Package version must be a numeric release or a safe prerelease version.');
  return value;
}
function childPath(root, relative) {
  const target = path.resolve(root, relative), inside = path.relative(path.resolve(root), target);
  if (!inside || inside.startsWith('..') || path.isAbsolute(inside)) throw new Error('Package path escapes its staging directory.');
  return target;
}
function sourcePath(root, relative) {
  const target = childPath(root, relative);
  let current = path.resolve(root);
  for (const component of path.relative(current, target).split(path.sep)) {
    current = path.join(current, component);
    if (fs.lstatSync(current).isSymbolicLink()) throw new Error('Package sources must not pass through symbolic links.');
  }
  return target;
}
function copyFile(source, destination) {
  if (!fs.lstatSync(source).isFile()) throw new Error('Only regular source files may enter the desktop package.');
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(source, destination, fs.constants.COPYFILE_EXCL);
}
function copyModule(source, destination) {
  if (!fs.lstatSync(source).isDirectory() || fs.lstatSync(source).isSymbolicLink()) throw new Error('Runtime packages must be regular directories.');
  fs.mkdirSync(destination, { recursive: true });
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    // Nested modules are copied separately from the lockfile graph.
    if (entry.name === 'node_modules' || entry.name === '.git') continue;
    if (entry.isSymbolicLink()) throw new Error('Runtime package symlinks are not allowed.');
    const from = path.join(source, entry.name), to = path.join(destination, entry.name);
    if (entry.isDirectory()) copyModule(from, to);
    else copyFile(from, to);
  }
}
function productionPackages(repo) {
  const manifest = JSON.parse(fs.readFileSync(path.join(repo, 'package.json'), 'utf8'));
  const lock = JSON.parse(fs.readFileSync(path.join(repo, 'package-lock.json'), 'utf8'));
  if (lock.lockfileVersion !== 3 || JSON.stringify(lock.packages?.['']?.dependencies) !== JSON.stringify(manifest.dependencies))
    throw new Error('Production dependency lockfile does not match the package manifest. Run npm ci.');
  return Object.entries(lock.packages).filter(([name, data]) => name && !data.dev).map(([name, data]) => {
    if (!/^node_modules\/(?:@[\w.-]+\/)?[\w.-]+(?:\/node_modules\/(?:@[\w.-]+\/)?[\w.-]+)*$/.test(name) || data.link)
      throw new Error('Unsupported runtime dependency path in the lockfile.');
    const installed = JSON.parse(fs.readFileSync(sourcePath(repo, name + '/package.json'), 'utf8'));
    if (installed.version !== data.version) throw new Error('Installed runtime dependency differs from the lockfile. Run npm ci.');
    return name;
  });
}
function stageApplication(repo, destination, version) {
  const manifest = JSON.parse(fs.readFileSync(path.join(repo, 'package.json'), 'utf8'));
  fs.mkdirSync(destination, { recursive: true });
  for (const name of APP_FILES) copyFile(sourcePath(repo, name), childPath(destination, name));
  const packages = productionPackages(repo);
  for (const name of packages) copyModule(sourcePath(repo, name), childPath(destination, name));
  // No build scripts, development dependencies, local config or lockfile ship.
  fs.writeFileSync(path.join(destination, 'package.json'), JSON.stringify({
    name: manifest.name, version: releaseVersion(version), description: manifest.description,
    main: 'desktop/main.cjs', license: manifest.license, author: manifest.author,
    dependencies: manifest.dependencies,
  }, null, 2) + '\n', { flag: 'wx' });
  return packages;
}
function stageLauncher(repo, destination, packages) {
  fs.mkdirSync(destination, { recursive: true });
  for (const name of LAUNCHER_FILES) copyFile(sourcePath(repo, name), childPath(destination, name));
  for (const name of packages) copyModule(sourcePath(repo, name), childPath(destination, name));
}
function installerCompiler() {
  const candidates = [process.env.ISCC_PATH,
    process.env['ProgramFiles(x86)'] && path.join(process.env['ProgramFiles(x86)'], 'Inno Setup 6', 'ISCC.exe'),
    process.env.ProgramFiles && path.join(process.env.ProgramFiles, 'Inno Setup 6', 'ISCC.exe')].filter(Boolean);
  const compiler = candidates.find(file => fs.existsSync(file) && fs.statSync(file).isFile());
  if (!compiler) throw new Error('Inno Setup 6 is required to build the Windows installer. No builder was installed automatically.');
  return compiler;
}
async function writeChecksum(file) {
  fs.writeFileSync(file + '.sha256', await sha256(file) + '  ' + path.basename(file) + '\n');
}
async function packageDesktop(options = {}) {
  const repo = path.resolve(options.repo || path.join(__dirname, '..'));
  const manifest = JSON.parse(fs.readFileSync(path.join(repo, 'package.json'), 'utf8'));
  const version = releaseVersion(options.version || process.env.PACKAGE_VERSION || manifest.version);
  const platform = process.platform, arch = process.arch;
  if (!(platform === 'win32' && arch === 'x64') && !(platform === 'darwin' && ['arm64', 'x64'].includes(arch)))
    throw new Error('Build on Windows x64 or the target macOS architecture.');
  const output = path.resolve(options.output || path.join(repo, 'dist'));
  fs.mkdirSync(output, { recursive: true });
  if (fs.lstatSync(output).isSymbolicLink()) throw new Error('Package output must not be a symbolic link.');
  const resultDirectory = childPath(output, APP_NAME + '-' + platform + '-' + arch);
  if (fs.existsSync(resultDirectory)) throw new Error('Packaged application output already exists. Choose a fresh build output directory.');
  const build = fs.mkdtempSync(path.join(os.tmpdir(), 'weekly-desktop-build-'));
  try {
    const source = path.join(build, 'app'), launcher = path.join(build, 'launcher');
    const packages = stageApplication(repo, source, version);
    stageLauncher(repo, launcher, packages);
    const runtime = await downloadRuntime(path.join(build, 'runtime'), { platform, arch });
    const scan = async folder => run(process.execPath, [path.join(repo, 'scripts', 'privacy-check.cjs'), '--artifact', folder],
      { cwd: repo, timeout: 60000, maxBuffer: 1024 * 1024, windowsHide: true });
    await scan(source);
    await scan(launcher);
    const { packager } = await import('@electron/packager');
    const [packaged] = await packager({
      dir: source, out: output, name: APP_NAME, executableName: 'WeeklyUsage',
      platform, arch, electronVersion: manifest.devDependencies.electron, appVersion: version,
      buildVersion: version.split('-')[0], appBundleId: 'org.weeklyaiusage.desktop',
      appCategoryType: 'public.app-category.developer-tools', asar: true, prune: false,
      extraResource: [runtime.directory, launcher], overwrite: false,
      osxSign: platform === 'darwin' ? {
        identity: '-', identityValidation: false, continueOnError: false,
        preAutoEntitlements: false, preEmbedProvisioningProfile: false,
        optionsForFile: () => ({ hardenedRuntime: false, timestamp: 'none' }),
      } : undefined,
    });
    if (path.resolve(packaged) !== resultDirectory) throw new Error('Packager returned an unexpected output directory.');
    if (options.directoryOnly) {
      await scan(packaged);
      return { platform, arch, version, directory: packaged, executable: platform === 'win32' ? path.join(packaged, 'WeeklyUsage.exe')
        : path.join(packaged, APP_NAME + '.app', 'Contents', 'MacOS', 'WeeklyUsage'), signing: 'development package' };
    }
    let artifact, executable;
    if (platform === 'win32') {
      executable = path.join(packaged, 'WeeklyUsage.exe');
      await scan(packaged);
      artifact = path.join(output, 'WeeklyAIUsage-' + version + '-Setup-x64.exe');
      if (fs.existsSync(artifact)) throw new Error('Installer output already exists. Choose a fresh output directory.');
      await run(installerCompiler(), ['/Qp', '/DAppVersion=' + version, '/DAppNumericVersion=' + version.split('-')[0] + '.0',
        '/DSourceDirectory=' + packaged, '/DOutputDirectory=' + output, path.join(repo, 'desktop-installer.iss')],
        { cwd: repo, timeout: 300000, maxBuffer: 2 * 1024 * 1024, windowsHide: true });
    } else {
      const bundle = path.join(packaged, APP_NAME + '.app');
      executable = path.join(bundle, 'Contents', 'MacOS', 'WeeklyUsage');
      // Packager signs nested code inside-out with per-role entitlements. This
      // ad-hoc signature is not a verified publisher or Apple notarization.
      await run('/usr/bin/codesign', ['--verify', '--deep', '--strict', bundle], { timeout: 60000 });
      await scan(packaged);
      const dmg = path.join(build, 'dmg');
      fs.mkdirSync(dmg);
      fs.cpSync(bundle, path.join(dmg, APP_NAME + '.app'), { recursive: true, verbatimSymlinks: true });
      fs.symlinkSync('/Applications', path.join(dmg, 'Applications'));
      artifact = path.join(output, 'WeeklyAIUsage-' + version + '-macOS-' + arch + '.dmg');
      if (fs.existsSync(artifact)) throw new Error('DMG output already exists. Choose a fresh output directory.');
      await run('/usr/bin/hdiutil', ['create', '-volname', APP_NAME, '-srcfolder', dmg, '-format', 'UDZO', '-fs', 'HFS+', artifact],
        { timeout: 300000, maxBuffer: 2 * 1024 * 1024 });
    }
    await writeChecksum(artifact);
    const result = { platform, arch, version, directory: packaged, executable, artifact, signing: platform === 'darwin' ? 'ad-hoc, not notarized' : 'unsigned' };
    fs.writeFileSync(path.join(output, 'desktop-build-' + platform + '-' + arch + '.json'), JSON.stringify(result, null, 2) + '\n');
    return result;
  } finally {
    const relative = path.relative(os.tmpdir(), build);
    if (!relative.startsWith('weekly-desktop-build-') || relative.includes(path.sep) || fs.lstatSync(build).isSymbolicLink())
      throw new Error('Refusing to remove an unexpected build directory.');
    fs.rmSync(build, { recursive: true, force: true });
  }
}

if (require.main === module) packageDesktop({ directoryOnly: process.argv.includes('--dir'),
  output: process.argv.includes('--out') ? process.argv[process.argv.indexOf('--out') + 1] : undefined }).then(result => process.stdout.write(JSON.stringify(result, null, 2) + '\n'))
  .catch(error => { process.stderr.write(error.message + '\n'); process.exitCode = 1; });
module.exports = { APP_FILES, LAUNCHER_FILES, releaseVersion, productionPackages, stageApplication, stageLauncher, packageDesktop };
