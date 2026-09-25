'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const forbiddenNames = /^(?:auth\.json|\.credentials\.json|accounts\.json|profile-store\.json|profiles\.json|usage-cache\.json|quota-cache\.json|credentials\.toml|\.env(?:\..*)?|.*\.keychain(?:-db)?)$/i;
function textFindings(name, text) {
  const findings = [];
  const add = rule => findings.push({ path: name, rule });
  const emails = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || [];
  if (emails.some(email => !/@(?:example\.(?:com|org|net)|[^@]+\.(?:test|invalid)|users\.noreply\.github\.com)$/i.test(email))) add('non-example account address');
  if (/(?:[A-Z]:[\\/]+Users[\\/]+(?!<|example(?:[\\/"'\s]|$)|Public[\\/])[^\s/\\"']+|\/Users\/(?!<|example(?:[\/"'\s]|$))[^\s/"']+)/i.test(text)) add('machine-specific home path');
  if (/(?:sk-(?:ant-|proj-)?[A-Za-z0-9_-]{20,}|eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{12,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----)/.test(text)) add('credential-like literal');
  if (/(?:xai-[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,}|https?:\/\/[^\s/@:]+:[^\s/@]+@)/.test(text)) add('credential-like literal');
  return findings;
}
function firstParty(name) {
  return !/(?:^|[\\/])node_modules[\\/]/.test(name) && !/(?:^|[\\/])runtime[\\/]/.test(name) &&
    !/^(?:LICENSE\.electron\.txt|LICENSES\.chromium\.html)$/.test(path.basename(name));
}
function checkBytes(name, bytes) {
  if (forbiddenNames.test(path.basename(name))) return [{ path: name, rule: 'private state file' }];
  if (!firstParty(name)) return [];
  if (bytes.includes(0)) return [];
  return textFindings(name, bytes.toString('utf8'));
}
function sourceFiles(root, staged = false) {
  const args = staged ? ['diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z'] : ['ls-files', '--cached', '--others', '--exclude-standard', '-z'];
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean);
}
function scanSource(root, staged = false) {
  const findings = [];
  for (const name of sourceFiles(root, staged)) {
    let bytes;
    if (staged) bytes = execFileSync('git', ['show', ':' + name], { cwd: root, maxBuffer: 12 * 1024 * 1024 });
    else {
      const file = path.join(root, name);
      if (!fs.existsSync(file)) continue;
      if (fs.lstatSync(file).isSymbolicLink()) { findings.push({ path: name, rule: 'source symlink' }); continue; }
      bytes = fs.readFileSync(file);
    }
    findings.push(...checkBytes(name, bytes));
  }
  return findings;
}
async function scanArtifact(root) {
  const findings = [];
  const asar = await import('@electron/asar');
  function walk(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name), relative = path.relative(root, file);
      // Framework bundle symlinks are valid; app/source symlinks are excluded during staging.
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) { walk(file); continue; }
      if (entry.name === 'app.asar') {
        for (const inside of asar.listPackage(file)) {
          const name = inside.replace(/^[\\/]/, '').replaceAll('\\', '/');
          const nativeName = path.normalize(name);
          const metadata = name ? asar.statFile(file, nativeName, false) : null;
          if (!name || metadata.files) continue;
          if (metadata.link) { findings.push({ path: relative + '/' + name, rule: 'application archive symlink' }); continue; }
          try { findings.push(...checkBytes(relative + '/' + name, asar.extractFile(file, nativeName))); }
          catch { if (firstParty(name)) findings.push({ path: relative + '/' + name, rule: 'unreadable application file' }); }
        }
      } else findings.push(...checkBytes(relative, fs.readFileSync(file)));
    }
  }
  walk(root); return findings;
}
function scanCommits(root, range) {
  const findings = [];
  const commits = execFileSync('git', ['rev-list', range], { cwd: root, encoding: 'utf8' }).trim().split('\n').filter(Boolean);
  for (const commit of commits) {
    const emails = execFileSync('git', ['show', '-s', '--format=%ae%n%ce', commit], { cwd: root, encoding: 'utf8' }).trim().split('\n');
    if (emails.some(email => !/^[^@]+@users\.noreply\.github\.com$/.test(email))) findings.push({ path: commit.slice(0, 12), rule: 'commit identity is not a public no-reply address' });
    const names = execFileSync('git', ['diff-tree', '--no-commit-id', '--name-only', '--diff-filter=ACMR', '-r', '-z', commit], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean);
    for (const name of names) {
      const bytes = execFileSync('git', ['show', commit + ':' + name], { cwd: root, maxBuffer: 12 * 1024 * 1024 });
      findings.push(...checkBytes(name, bytes));
    }
  }
  return findings;
}
async function main() {
  const root = path.resolve(__dirname, '..'), args = process.argv.slice(2);
  let findings;
  if (args[0] === '--artifact' && args[1]) findings = await scanArtifact(path.resolve(args[1]));
  else if (args[0] === '--commits' && args[1]) findings = scanCommits(root, args[1]);
  else findings = scanSource(root, args.includes('--staged'));
  if (findings.length) {
    for (const finding of findings) process.stderr.write(`${finding.path}: ${finding.rule}\n`);
    process.exitCode = 1;
  } else process.stdout.write('Privacy check passed: no private state, account addresses, home paths or credential literals found.\n');
}
if (require.main === module) main().catch(() => { process.stderr.write('Privacy check failed to inspect the requested input.\n'); process.exitCode = 1; });
module.exports = { textFindings, checkBytes, sourceFiles, scanSource, scanArtifact, scanCommits };
