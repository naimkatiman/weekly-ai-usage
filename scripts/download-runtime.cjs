'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { Readable, Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const run = promisify(execFile);

const VERSION = '24.21.0';
// Verified against https://nodejs.org/dist/v24.21.0/SHASUMS256.txt.
const ARCHIVES = Object.freeze({
  'win32-x64': { name: 'node-v24.21.0-win-x64.zip', sha256: '158f7685b44de51f6c0df1d153526cbcd3e1bc739a8dfc607721cef75de9e541', binary: 'node.exe' },
  'darwin-arm64': { name: 'node-v24.21.0-darwin-arm64.tar.gz', sha256: 'bed7eea5325e1108f32ce5228ddd6a5f0f08a499ee42aa7442aea583702f6057', binary: 'bin/node' },
  'darwin-x64': { name: 'node-v24.21.0-darwin-x64.tar.gz', sha256: '1462cb3b3046b815cf8ea436d3da450ec1a9f11dac7e5a46b0ada5305d7e8097', binary: 'bin/node' },
});

function archiveFor(platform, arch) {
  const archive = ARCHIVES[platform + '-' + arch];
  if (!archive) throw new Error('Bundled Node supports Windows x64 and macOS arm64/x64 only.');
  return { ...archive, url: 'https://nodejs.org/dist/v' + VERSION + '/' + archive.name };
}
async function sha256(file) {
  const hash = createHash('sha256');
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}
async function verifyArchive(file, expected) {
  if (!/^[a-f0-9]{64}$/.test(expected) || await sha256(file) !== expected)
    throw new Error('Bundled Node archive failed its pinned SHA256 check.');
}
async function downloadRuntime(destination, options = {}) {
  const platform = options.platform || process.platform, arch = options.arch || process.arch;
  const archive = archiveFor(platform, arch);
  const target = path.resolve(destination);
  if (fs.existsSync(target)) throw new Error('Runtime destination must not already exist.');
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const temp = fs.mkdtempSync(path.join(path.dirname(target), 'node-download-'));
  const packed = path.join(temp, archive.name);
  try {
    const response = await fetch(archive.url, { redirect: 'error', signal: AbortSignal.timeout(120000) });
    if (!response.ok || !response.body) throw new Error('Official Node runtime download failed.');
    let bytes = 0;
    const bound = new Transform({ transform(chunk, _encoding, callback) {
      bytes += chunk.length;
      callback(bytes > 200 * 1024 * 1024 ? new Error('Node runtime archive exceeds the download limit.') : null, chunk);
    } });
    await pipeline(Readable.fromWeb(response.body), bound, fs.createWriteStream(packed, { flags: 'wx', mode: 0o600 }));
    await verifyArchive(packed, archive.sha256);
    const folder = archive.name.replace(/\.(zip|tar\.gz)$/, '');
    // Extract only the verified executable and its license, never npm or scripts.
    await run(platform === 'win32' ? path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe') : '/usr/bin/tar',
      ['-xf', packed, '-C', temp, folder + '/' + archive.binary, folder + '/LICENSE'],
      { timeout: 60000, maxBuffer: 1024 * 1024, windowsHide: true });
    fs.mkdirSync(target);
    const binary = path.join(target, platform === 'win32' ? 'node.exe' : 'node');
    for (const [source, output] of [[path.join(temp, folder, archive.binary), binary], [path.join(temp, folder, 'LICENSE'), path.join(target, 'LICENSE')]]) {
      if (!fs.lstatSync(source).isFile()) throw new Error('Node archive did not contain the expected regular files.');
      fs.copyFileSync(source, output, fs.constants.COPYFILE_EXCL);
    }
    if (platform !== 'win32') fs.chmodSync(binary, 0o755);
    return { directory: target, binary, version: VERSION, archiveSha256: archive.sha256 };
  } finally {
    // temp was created by mkdtemp directly inside this caller-owned build folder.
    const relative = path.relative(path.dirname(target), temp);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative) || fs.lstatSync(temp).isSymbolicLink())
      throw new Error('Refusing to clean a runtime directory outside its build folder.');
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

module.exports = { VERSION, ARCHIVES, archiveFor, sha256, verifyArchive, downloadRuntime };
