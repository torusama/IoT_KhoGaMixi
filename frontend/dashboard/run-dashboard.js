'use strict';
const { spawn } = require('node:child_process');
const path = require('node:path');
const mode = process.argv[2];
const child = spawn(process.execPath, [path.join(__dirname, 'node_modules/node-red/red.js'), '--userDir', '.runtime', '--settings', 'settings.js'], {
  cwd: __dirname,
  stdio: 'inherit',
  env: { ...process.env, SPT_MODE: mode }
});
child.on('error', error => { console.error('Không khởi động được Node-RED:', error.message); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code ?? 1; });
