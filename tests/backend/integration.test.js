'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { randomBytes } = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { pathToFileURL } = require('node:url');
const mqtt = require('../../backend/node_modules/mqtt');
const { createDevBroker } = require('../../backend/scripts/dev-broker');
const { startSimulator } = require('../../backend/scripts/simulator');
const { removeTestDir, running, fixture, summary, event } = require('./helpers');
const backend = path.resolve(__dirname, '../../backend');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(get, condition = Boolean, timeout = 15000) {
  const deadline = Date.now() + timeout; let lastError;
  while (Date.now() < deadline) {
    try { const result = await get(); if (condition(result)) return result; } catch (error) { lastError = error; }
    await delay(100);
  }
  throw new Error(`Condition timed out${lastError ? `: ${lastError.message}` : ''}`);
}
async function freePort() {
  const server = net.createServer(); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const port = server.address().port; await new Promise(resolve => server.close(resolve)); return port;
}

test('real Node-RED + authenticated MQTT + simulator + REST/SSE + durable history', { timeout: 45000 }, async t => {
  const secret = () => randomBytes(24).toString('hex');
  const backendPassword = secret(), devicePassword = secret(), apiToken = secret();
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'spt-integration-'));
  const broker = await createDevBroker({ port: 0, username: 'backend', password: backendPassword, devices: { esp32_01: devicePassword } });
  let simulator, child, client; const abort = new AbortController(); let logs = '';
  const stopChild = async () => {
    if (child && child.exitCode === null) { const closed = once(child, 'exit'); child.kill(); await closed; }
  };
  t.after(async () => {
    abort.abort(); if (client) await client.endAsync(true); if (simulator) await simulator.close();
    await stopChild(); await broker.close(); await removeTestDir(directory);
  });
  const httpPort = await freePort(); const url = `mqtt://127.0.0.1:${broker.port}`;
  const headers = { Authorization: `Bearer ${apiToken}`, 'Content-Type': 'application/json' };
  const request = async (route, body) => {
    const response = await fetch(`http://127.0.0.1:${httpPort}/api/v1${route}`, { method: body ? 'POST' : 'GET', headers, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(1500) });
    const value = await response.json(); assert.ok(response.ok, JSON.stringify(value)); return value;
  };
  const boot = async () => {
    child = spawn(process.execPath, [path.join(backend, 'node_modules/node-red/red.js'), '--userDir', path.join(directory, 'red'), '--settings', path.join(backend, 'node-red/settings.js')], {
      cwd: backend, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env,
        NODE_ENV: 'development', HOST: '127.0.0.1', PORT: String(httpPort), API_TOKEN: apiToken, ENABLE_EDITOR: 'false',
        MQTT_URL: url, MQTT_USERNAME: 'backend', MQTT_PASSWORD: backendPassword, MQTT_CA_FILE: '',
        STORE_DRIVER: 'file', STORE_FILE: path.join(directory, 'store.json'), ALLOWED_ORIGINS: 'http://localhost:5173' }
    });
    child.stdout.on('data', data => { logs = (logs + data).slice(-12000); }); child.stderr.on('data', data => { logs = (logs + data).slice(-12000); });
    try { await until(() => request('/health'), value => value.ready && value.mqtt_connected); }
    catch (error) { throw new Error(`${error.message}\n${logs}`); }
  };
  await boot();
  const unauthorized = await fetch(`http://127.0.0.1:${httpPort}/api/v1/devices`); assert.equal(unauthorized.status, 401);
  const forbidden = await fetch(`http://127.0.0.1:${httpPort}/api/v1/devices`, { headers: { ...headers, Origin: 'https://untrusted.example' } }); assert.equal(forbidden.status, 403);
  const preflight = await fetch(`http://127.0.0.1:${httpPort}/api/v1/devices/esp32_01/commands`, {
    method: 'OPTIONS', headers: { Origin: 'http://localhost:5173', 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'authorization,content-type' }
  });
  assert.equal(preflight.status, 204); assert.equal(preflight.headers.get('access-control-allow-origin'), 'http://localhost:5173');
  simulator = await startSimulator({ url, password: devicePassword, preflightMs: 100 });
  await until(() => request('/devices/esp32_01'), value => value.connection === 'online');
  const { PostureApi } = await import(pathToFileURL(path.resolve(__dirname, '../../frontend/assets/js/posture-api.js')).href);
  const api = new PostureApi({ baseUrl: `http://127.0.0.1:${httpPort}`, token: apiToken });
  const stream = api.stream({ signal: abort.signal }); const first = await stream.next(); assert.equal(first.value.type, 'snapshot');
  const applied = async command => until(() => request(`/commands/${command.command_id}`), value => value.status === 'applied');
  const reference = await request('/devices/esp32_01/commands', { command: 'SET_REFERENCE', guided_confirmation: true, command_id: 'integration_reference' });
  await applied(reference); assert.equal((await request('/devices/esp32_01/references')).items.length, 1);
  const vibration = await api.vibrate('esp32_01', 100, 'integration_vibration'); await applied(vibration);
  const startBody = { command: 'START', mode: 'reference', command_id: 'integration_start' };
  const start = await request('/devices/esp32_01/commands', startBody); await applied(start);
  assert.equal((await request('/devices/esp32_01/commands', startBody)).payload.session_id, start.payload.session_id);
  const live = await until(() => request('/devices/esp32_01'), value => value.telemetry?.session_id === start.payload.session_id);
  assert.equal(live.telemetry.curve.nodes_mm.length, 4); assert.equal(live.telemetry.simulated, true);
  const reminder = await api.setReminder('esp32_01', false, 'integration_reminder'); await applied(reminder);
  const next = await stream.next(); assert.ok(next.value.type); await stream.return();
  const event = { schema_version: 2, device_id: 'esp32_01', boot_id: live.state.boot_id, session_id: start.payload.session_id,
    t_mono_us: live.telemetry.t_mono_us, message_id: 'integration_event_message', event_id: 'integration_event', event_seq: 1,
    type: 'posture', metric: 'upper_reference_deviation', started_at_mono_us: live.telemetry.t_mono_us,
    ended_at_mono_us: null, duration_ms: 0, peak_deg: 10, vibrated: false, notification_requested: false };
  await simulator.client.publishAsync('posture/esp32_01/event', JSON.stringify(event), { qos: 0 });
  await simulator.client.publishAsync('posture/esp32_01/event', JSON.stringify(event), { qos: 0 });
  await until(() => request(`/sessions/${start.payload.session_id}/events`), value => value.items.length === 1);
  const stop = await api.stop('esp32_01', start.payload.session_id, 'integration_stop'); await applied(stop);
  const saved = await until(() => request(`/sessions/${start.payload.session_id}`), value => value.meta.storage_status === 'saved');
  assert.ok(saved.final.valid_metric_ms > 0);
  assert.equal(saved.final.histogram_ms.reduce((a, b) => a + b, 0), saved.final.valid_metric_ms);
  assert.ok((await request(`/sessions/${start.payload.session_id}/keyframes`)).items.length > 0);
  await simulator.close(); simulator = null;
  await until(() => request('/devices/esp32_01'), value => value.connection === 'offline');
  // Restart the real runtime: history survives, while retained state alone stays offline.
  await stopChild(); await boot();
  assert.equal((await request('/sessions')).items.length, 1);
  assert.equal((await request(`/sessions/${start.payload.session_id}/events`)).items.length, 1);
  assert.equal((await request('/devices/esp32_01')).connection, 'offline');
});

test('Firebase Admin persistence against an explicitly selected emulator', {
  skip: !process.env.SPT_TEST_FIREBASE_EMULATOR_HOST, timeout: 15000
}, async () => {
  const { FirebaseStore } = require('../../backend/integrations/firebase/store');
  const host = process.env.SPT_TEST_FIREBASE_EMULATOR_HOST;
  assert.match(host, /^(127\.0\.0\.1|localhost):\d+$/);
  process.env.FIREBASE_DATABASE_EMULATOR_HOST = host;
  const projectId = 'demo-spt';
  const config = { projectId, databaseURL: `https://${projectId}-default-rtdb.firebaseio.com`, root: `test_${Date.now()}`, emulator: host };
  const first = await new FirebaseStore(config).init();
  try {
    await first.update({ 'records/a': { value: 1 }, 'records/b': { value: 2 } });
    assert.equal((await first.get('records/a')).value, 1);
    assert.equal(Object.keys(await first.list('records', { limit: 1 })).at(0), 'b');
    await first.transaction('records/a', value => ({ value: (value?.value || 0) + 1 }));
    assert.equal((await first.get('records/a')).value, 2);
    await first.update({ 'records/nullable': { null_value: null, empty_array: [], empty_object: {}, mixed: [null, 1, null] } });
    assert.deepEqual(await first.get('records/nullable'), { null_value: null, empty_array: [], empty_object: {}, mixed: [null, 1, null] });
    const f = await running(await fixture({ store: first }));
    await f.ingest(summary(f.command, { is_final: true })); await f.ingest(event(f.command));
    const restored = await new FirebaseStore(config).init();
    try {
      const stored = await restored.get(`sessions/${f.command.payload.session_id}`);
      assert.equal(stored.config_snapshot.reference_rev, null);
      assert.equal(stored.meta.cloud_status, 'saved');
      assert.equal(stored.events.event_1.ended_at_mono_us, null);
      assert.equal((await f.service.reports()).days.reduce((n, day) => n + day.valid_measurement_ms, 0), 2000);
    } finally { await restored.close(); }
  } finally { await first.close(); }
});

test('MQTT broker rejects bad credentials, inherited usernames and cross-device subscriptions', { timeout: 10000 }, async t => {
  const password = randomBytes(24).toString('hex');
  const broker = await createDevBroker({ port: 0, username: 'backend', password, devices: { esp32_01: password } });
  let device;
  t.after(async () => { if (device) await device.endAsync(true); await broker.close(); });
  const url = `mqtt://127.0.0.1:${broker.port}`;
  for (const username of ['esp32_01', 'constructor', '__proto__', 'toString']) {
    await assert.rejects(mqtt.connectAsync(url, { clientId: username, username, password: 'incorrect', reconnectPeriod: 0, connectTimeout: 1000 }));
  }
  device = await mqtt.connectAsync(url, { clientId: 'esp32_01', username: 'esp32_01', password, reconnectPeriod: 0 });
  const grant = await device.subscribeAsync('posture/other_device/cmd').catch(() => null);
  assert.ok(grant === null || grant.every(sub => sub.qos === 128));
  const allowed = await device.subscribeAsync('posture/esp32_01/cmd', { qos: 1 });
  assert.equal(allowed[0].qos, 1);
});
