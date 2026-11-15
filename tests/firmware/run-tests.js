'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

// Chạy: node tests/firmware/run-tests.js; cần g++ trong PATH hoặc biến CXX.
const repositoryRoot = path.resolve(__dirname, '../..');
const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'spt-angle-tests-'));
const executable = path.join(temporaryDirectory, process.platform === 'win32' ? 'angle-tests.exe' : 'angle-tests');
const compiler = process.env.CXX || 'g++';

try {
  const compilation = spawnSync(compiler, [
    '-std=c++17', '-Wall', '-Wextra', '-Werror',
    '-I' + __dirname,
    '-I' + path.join(repositoryRoot, 'hardware/firmware/include'),
    path.join(__dirname, 'angle_calculator.test.cpp'),
    path.join(repositoryRoot, 'hardware/firmware/src/angle_calculator.cpp'),
    '-o', executable
  ], { encoding: 'utf8', windowsHide: true });
  if (compilation.error) throw compilation.error;
  if (compilation.status !== 0) throw new Error(compilation.stderr);

  const execution = spawnSync(executable, [], { encoding: 'utf8', windowsHide: true });
  if (execution.error) throw execution.error;
  process.stdout.write(execution.stdout);
  if (execution.status !== 0) throw new Error(execution.stderr || 'Native assertions failed.');
} finally {
  fs.rmSync(temporaryDirectory, { recursive: true, force: true });
}
