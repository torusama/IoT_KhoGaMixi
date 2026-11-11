'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
const root = path.resolve(__dirname, '..');
const token = () => randomBytes(32).toString('hex');
const target = path.join(root, '.env');
if (!fs.existsSync(target)) {
  const body = fs.readFileSync(path.join(root, '.env.example'), 'utf8')
    .replace(/^API_TOKEN=$/m, `API_TOKEN=${token()}`)
    .replace(/^MQTT_PASSWORD=$/m, `MQTT_PASSWORD=${token()}`)
    .replace(/^DEVICE_MQTT_PASSWORD=$/m, `DEVICE_MQTT_PASSWORD=${token()}`);
  fs.writeFileSync(target, body, { flag: 'wx', mode: 0o600 });
  console.log('Created backend/.env with random local credentials. Existing files are never overwritten.');
} else console.log('backend/.env already exists; preserved.');
