'use strict';
const path = require('node:path');
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
const { sourceFiles } = require('./privacy-check.cjs');
const root = path.resolve(__dirname, '..');
let checked = 0;
for (const file of sourceFiles(root)) {
  if (!/\.[cm]?js$/.test(file) || !fs.existsSync(path.join(root, file))) continue;
  execFileSync(process.execPath, ['--check', path.join(root, file)], { stdio: 'pipe', windowsHide: true });
  checked++;
}
process.stdout.write(`Syntax checks passed for ${checked} JavaScript files.\n`);
