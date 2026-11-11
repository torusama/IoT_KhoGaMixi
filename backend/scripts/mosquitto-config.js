'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { randomBytes, pbkdf2Sync } = require('node:crypto');
const { id } = require('../integrations/mqtt/protocol');
// Mosquitto password-file hash format $7$ (PBKDF2-HMAC-SHA512).
function passwordLine(user, password) {
  const salt = randomBytes(12); const rounds = 101000;
  const digest = pbkdf2Sync(password, salt, rounds, 64, 'sha512');
  return `${user}:$7$${rounds}$${salt.toString('base64')}$${digest.toString('base64')}`;
}
function generate(env = process.env) {
  const device = id(env.DEVICE_ID || 'esp32_01'); const backend = id(env.MQTT_USERNAME || 'backend');
  if (device === backend || !env.MQTT_PASSWORD || !env.DEVICE_MQTT_PASSWORD) throw new Error('Configure distinct broker/device credentials first');
  const directory = path.resolve(__dirname, '../.runtime/mosquitto'); fs.mkdirSync(directory, { recursive: true });
  const lines = [`user ${backend}`];
  for (const type of ['state', 'ack', 'data', 'summary', 'event']) lines.push(`topic read posture/+/${type}`);
  for (const type of ['cmd', 'receipt']) lines.push(`topic write posture/+/${type}`);
  lines.push('', `user ${device}`);
  for (const type of ['cmd', 'receipt']) lines.push(`topic read posture/${device}/${type}`);
  for (const type of ['state', 'ack', 'data', 'summary', 'event']) lines.push(`topic write posture/${device}/${type}`);
  fs.writeFileSync(path.join(directory, 'acl'), lines.join('\n') + '\n', { mode: 0o600 });
  fs.writeFileSync(path.join(directory, 'passwords'), [passwordLine(backend, env.MQTT_PASSWORD), passwordLine(device, env.DEVICE_MQTT_PASSWORD)].join('\n') + '\n', { mode: 0o600 });
  console.log('Generated ignored .runtime/mosquitto/passwords and acl; no credentials printed.');
}
if (require.main === module) generate();
module.exports = { passwordLine, generate };
