'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crossSpawn = require('cross-spawn');
const { providerCapabilities } = require('./profiles.cjs');
const { prepareEnvironment, assertCompatibleSettings, checkedArguments } = require('./launch.cjs');

function readPlan(file) {
  let plan, original;
  try {
    if (typeof file !== 'string' || !path.isAbsolute(file) || path.basename(path.dirname(file)) !== 'launches' ||
      !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}\.json$/i.test(path.basename(file))) throw new Error();
    if (fs.lstatSync(path.dirname(file)).isSymbolicLink()) throw new Error();
    original = fs.lstatSync(file);
    if (!original.isFile() || original.isSymbolicLink() || original.nlink !== 1 || original.size > 4 * 1024 * 1024 ||
      (process.platform !== 'win32' && ((original.mode & 0o077) !== 0 || original.uid !== process.getuid()))) throw new Error();
    const fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
    try {
      const opened = fs.fstatSync(fd);
      if (opened.dev !== original.dev || opened.ino !== original.ino) throw new Error();
      plan = JSON.parse(fs.readFileSync(fd, 'utf8'));
    } finally { fs.closeSync(fd); }
  } catch { throw new Error('The launch request is unavailable. Open the account again from the app.'); }
  const validPath = value => typeof value === 'string' && path.isAbsolute(value) && !/[\x00\r\n]/.test(value);
  const command = file.replace(/\.json$/, '.command');
  const fields = ['version', 'provider', 'home', 'usesDefaultHome', 'sharesDefaultHome', 'cwd', 'executable', 'args', 'checkedCliVersion', 'commandPath'];
  if (!plan || Array.isArray(plan) || Object.keys(plan).some(key => !fields.includes(key)) ||
    plan.version !== 1 || !Object.hasOwn(providerCapabilities, plan.provider) ||
    ![plan.executable, plan.cwd].every(validPath) ||
    (providerCapabilities[plan.provider].isolated ? !validPath(plan.home) : plan.home !== null) ||
    typeof plan.usesDefaultHome !== 'boolean' || typeof plan.sharesDefaultHome !== 'boolean' ||
    (plan.usesDefaultHome && !plan.sharesDefaultHome) ||
    (plan.commandPath != null && plan.commandPath !== command) ||
    (plan.checkedCliVersion !== undefined && !/^\d+\.\d+\.\d+$/.test(plan.checkedCliVersion))) {
    throw new Error('Invalid launch request.');
  }
  checkedArguments(plan.provider, plan.args);
  try {
    const current = fs.lstatSync(file);
    if (current.isSymbolicLink() || current.dev !== original.dev || current.ino !== original.ino ||
      current.size !== original.size || current.mtimeMs !== original.mtimeMs) throw new Error();
    let paired = false;
    if (plan.commandPath === command && fs.existsSync(command)) {
      const helper = fs.lstatSync(command);
      if (!helper.isFile() || helper.isSymbolicLink() || helper.nlink !== 1) throw new Error();
      paired = true;
    }
    fs.unlinkSync(file);
    if (paired) fs.unlinkSync(command);
  } catch { throw new Error('The launch request could not be consumed. Open the account again from the app.'); }
  return plan;
}

async function runPlan(file, { spawn = crossSpawn, env = process.env, platform = process.platform, stdio = 'inherit', managedPaths } = {}) {
  const plan = readPlan(file);
  assertCompatibleSettings({ provider: plan.provider, home: plan.home }, plan.cwd, { platform, env, managedPaths });
  const prepared = prepareEnvironment(plan.provider, plan.home, env, platform, plan.usesDefaultHome);
  return new Promise((resolve, reject) => {
    let child;
    try { child = spawn(plan.executable, plan.args, { cwd: plan.cwd, env: prepared.env, stdio, shell: false }); }
    catch { reject(new Error('The agent could not start. Check its installation in the app.')); return; }
    child.once('error', () => reject(new Error('The agent could not start. Check its installation in the app.')));
    child.once('exit', (code, signal) => resolve({ code: code ?? 1, signal, clearedAuthKeys: prepared.clearedAuthKeys }));
  });
}

if (require.main === module) {
  runPlan(process.argv[2]).then(result => { process.exitCode = result.code; }, error => {
    // Provider output stays in its own terminal; application errors never dump paths or credentials.
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = { readPlan, runPlan };
