'use strict';
const { spawnSync } = require('node:child_process');
const host = process.env.FIREBASE_DATABASE_EMULATOR_HOST;
if (!/^(127\.0\.0\.1|localhost):\d+$/.test(host || '')) throw new Error('Run with the local Firebase emulator');
const result = spawnSync(process.execPath, ['--test', '../tests/backend/integration.test.js'], {
  stdio: 'inherit', windowsHide: true, env: { ...process.env, SPT_TEST_FIREBASE_EMULATOR_HOST: host }
});
process.exitCode = result.status ?? 1;
