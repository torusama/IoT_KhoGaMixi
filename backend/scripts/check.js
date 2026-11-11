'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
let count = 0;
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', '.runtime', '.git'].includes(entry.name)) continue;
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(file);
    else if (file.endsWith('.js')) {
      const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8', windowsHide: true });
      if (result.status) { process.stderr.write(result.stderr); process.exitCode = 1; } count++;
    } else if (file.endsWith('.json')) { JSON.parse(fs.readFileSync(file, 'utf8')); count++; }
  }
}
walk(root); console.log(`Checked ${count} JavaScript/JSON files.`);
