'use strict';
const net = require('node:net');
const { timingSafeEqual } = require('node:crypto');

function equal(a, b) {
  if (!(typeof a === 'string' || Buffer.isBuffer(a)) || !(typeof b === 'string' || Buffer.isBuffer(b))) return false;
  const x = Buffer.from(a); const y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y);
}
async function createDevBroker({ port = 1883, host = '127.0.0.1', username, password, devices = {} }) {
  if (!username || !password || !Object.keys(devices).length || Object.hasOwn(devices, username) || Object.values(devices).some(value => typeof value !== 'string' || !value)) throw new Error('Broker requires distinct backend/device credentials');
  const { Aedes } = await import('aedes');
  const broker = await Aedes.createBroker({ maxClientsIdLength: 128 });
  broker.authenticate = (client, user, pass, done) => {
    const name = user?.toString();
    const backend = equal(name, username) && equal(pass, password);
    const device = Object.hasOwn(devices, name) && equal(pass, devices[name]) && client.id === name;
    client.role = backend ? 'backend' : device ? name : null;
    done(null, !!client.role);
  };
  broker.authorizePublish = (client, packet, done) => {
    if (!client) return done(null);
    const match = /^posture\/([A-Za-z0-9_-]+)\/(state|ack|data|summary|event|cmd|receipt)$/.exec(packet.topic);
    const allowed = match && packet.payload.length <= 16384 && (!packet.retain || match[2] === 'state') &&
      (client.role === 'backend' ? ['cmd', 'receipt'].includes(match[2]) : client.role === match[1] && !['cmd', 'receipt'].includes(match[2]));
    done(allowed ? null : new Error('MQTT publish forbidden'));
  };
  broker.authorizeSubscribe = (client, sub, done) => {
    const match = /^posture\/([A-Za-z0-9_+-]+)\/(state|ack|data|summary|event|cmd|receipt)$/.exec(sub.topic);
    const allowed = match && (client.role === 'backend' ? !['cmd', 'receipt'].includes(match[2]) : client.role === match[1] && ['cmd', 'receipt'].includes(match[2]));
    done(null, allowed ? sub : null);
  };
  broker.on('clientError', () => {});
  const server = net.createServer(broker.handle);
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, host, resolve); });
  return { broker, server, port: server.address().port,
    async close() { await new Promise(resolve => broker.close(resolve)); await new Promise(resolve => server.close(resolve)); } };
}
if (require.main === module) {
  (async () => {
    if (process.env.NODE_ENV === 'production') throw new Error('Development broker must not be used for production');
    const device = process.env.DEVICE_ID || 'esp32_01';
    const instance = await createDevBroker({ username: process.env.MQTT_USERNAME, password: process.env.MQTT_PASSWORD,
      devices: { [device]: process.env.DEVICE_MQTT_PASSWORD } });
    console.log(`Authenticated development MQTT broker listening at 127.0.0.1:${instance.port}`);
    let stopping = false;
    for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => { if (!stopping) { stopping = true; await instance.close(); } });
  })().catch(error => { console.error(error.message); process.exitCode = 1; });
}
module.exports = { createDevBroker };
