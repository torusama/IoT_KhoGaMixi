'use strict';
const mqtt = require('mqtt');
const { randomUUID } = require('node:crypto');
const { canonical } = require('../logic/service');

const wrap = value => ((value + 540) % 360) - 180;
function demoCurve(pitch, distances) {
  const nodes = [[0, 0]]; const kappa = [];
  for (let i = 3; i > 0; i--) {
    const a = pitch[i] * Math.PI / 180; const delta = wrap(pitch[i - 1] - pitch[i]) * Math.PI / 180;
    const d = distances[i - 1]; const h = delta / 2; const m = a + h;
    const sinc = Math.abs(h) < 1e-6 ? 1 - h * h / 6 : Math.sin(h) / h;
    const [x, y] = nodes.at(-1); nodes.push([x + d * sinc * Math.sin(m), y + d * sinc * Math.cos(m)]); kappa.push(delta / d);
  }
  return { order: ['P4', 'P3', 'P2', 'P1'], nodes_mm: nodes, kappa_per_mm: kappa };
}
async function startSimulator({ url, password, deviceId = 'esp32_01', preflightMs = 2000, ca }) {
  const bootId = `b_${randomUUID().replaceAll('-', '').slice(0, 16)}`; const baseTime = process.hrtime.bigint();
  const mono = () => Number((process.hrtime.bigint() - baseTime) / 1000n);
  let state = 'IDLE', sessionId = null, stateSeq = 0, sampleSeq = 0, telemetrySeq = 0, summarySeq = 0;
  let startUs = 0, lastCommandId = null, lastClosed = null, lastSampleUs = 0, lastData = 0, lastSummary = 0;
  let elapsed = 0, validMetric = 0, histogram = [0, 0, 0, 0, 0, 0], interval = 100, referenceMode = false;
  let reminder = false, pitch = [32, 22, 12, 5], stopping = false;
  let snapshot = { config_rev: 'cfg_1', geometry_rev: 'g_1', calibration_rev: 'c_1', reference_rev: null,
    algorithm_version: 'arc2d_v1', distances_mm: [70, 70, 70], sensor_map: [0, 1, 2, 3], mounting_confirmed: true, reference: null };
  const results = new Map(); const outbox = new Map();
  const envelope = () => ({ schema_version: 2, device_id: deviceId, boot_id: bootId, t_mono_us: mono(), ts_unix_ms: Date.now(), simulated: true });
  const client = await mqtt.connectAsync(url, { clientId: deviceId, username: deviceId, password, ca, rejectUnauthorized: true,
    reconnectPeriod: 1000, protocolVersion: 4, queueQoSZero: false,
    will: { topic: `posture/${deviceId}/state`, payload: JSON.stringify({ schema_version: 2, device_id: deviceId, boot_id: bootId, online: false }), qos: 0, retain: true } });
  const publish = (type, message, retain = false) => { if (client.connected) client.publish(`posture/${deviceId}/${type}`, JSON.stringify(message), { qos: 0, retain }); };
  const announce = () => publish('state', { ...envelope(), online: true, state, state_seq: ++stateSeq, session_id: sessionId,
    started_at_mono_us: startUs, last_command_id: lastCommandId, last_closed_session_id: lastClosed, config: snapshot, reminder_enabled: reminder }, true);
  const ack = (command, status, reason) => ({ ...envelope(), command_id: command.command_id, session_id: command.session_id || null, status, state,
    ...(reason ? { reason } : {}), ...(command.command === 'SET_REFERENCE' && status === 'applied' ? { config: snapshot } : {}), started_at_mono_us: startUs });
  const finish = (command, status, reason) => { const value = ack(command, status, reason); results.set(command.command_id, { request: canonical(command), value }); publish('ack', value); };
  function summary(final) {
    const value = { ...envelope(), session_id: sessionId, message_id: `sum_${bootId}_${++summarySeq}`, summary_seq: summarySeq,
      last_sample_seq: sampleSeq, coverage_start_mono_us: startUs, coverage_end_mono_us: mono(), elapsed_ms: elapsed,
      valid_measurement_ms: elapsed, valid_metric_ms: validMetric, invalid_ms: 0, histogram_ms: [...histogram], is_final: final };
    value.t_mono_us = Math.max(value.t_mono_us, value.coverage_end_mono_us);
    outbox.set(value.message_id, { type: 'summary', value }); publish('summary', value);
  }
  client.on('message', (topic, bytes) => {
    let command; try { command = JSON.parse(bytes); } catch { return; }
    if (topic.endsWith('/receipt')) {
      if (command.boot_id === bootId && command.status === 'stored') outbox.delete(command.message_id);
      return;
    }
    if (command.schema_version !== 2 || command.device_id !== deviceId || typeof command.command_id !== 'string') return;
    const old = results.get(command.command_id);
    if (old) { publish('ack', old.request === canonical(command) ? old.value : ack(command, 'rejected', 'COMMAND_CONFLICT')); return; }
    if (command.target_boot_id !== bootId) return finish(command, 'rejected', 'BOOT_MISMATCH');
    if (mono() > command.not_after_mono_us) return finish(command, 'rejected', 'COMMAND_EXPIRED');
    if (command.expected_config_rev !== snapshot.config_rev) return finish(command, 'rejected', 'CONFIG_MISMATCH');
    if (command.command === 'START') {
      if (state !== 'IDLE' || command.session_id === lastClosed) return finish(command, 'rejected', 'SESSION_CONFLICT');
      if (command.mode === 'reference' && !snapshot.reference) return finish(command, 'rejected', 'REFERENCE_REQUIRED');
      sessionId = command.session_id; state = 'PREFLIGHT'; finish(command, 'accepted'); announce();
      setTimeout(() => {
        if (stopping) return;
        state = 'RUNNING'; startUs = mono(); lastSampleUs = startUs; elapsed = 0; validMetric = 0;
        histogram = [0, 0, 0, 0, 0, 0]; summarySeq = 0; telemetrySeq = 0; sampleSeq = 0;
        referenceMode = command.mode === 'reference'; lastCommandId = command.command_id;
        finish(command, 'applied'); announce();
      }, preflightMs).unref();
      return;
    }
    if (command.command === 'STOP') {
      if (state !== 'RUNNING' || command.session_id !== sessionId) return finish(command, 'rejected', 'SESSION_MISMATCH');
      summary(true); lastClosed = sessionId; state = 'IDLE'; lastCommandId = command.command_id;
      finish(command, 'applied'); sessionId = null; announce(); return;
    }
    if (command.command === 'SET_REFERENCE') {
      if (state !== 'IDLE') return finish(command, 'rejected', 'SESSION_LOCKED');
      snapshot = { ...snapshot, config_rev: `cfg_${randomUUID().slice(0, 8)}`, reference_rev: command.reference_rev,
        reference: { reference_rev: command.reference_rev, pitch_deg: [...pitch], captured_at_unix_ms: Date.now() } };
    } else if (command.command === 'SET_REMINDER') reminder = command.enabled;
    else if (command.command === 'CONFIG') interval = command.publish_interval_ms;
    else if (command.command !== 'TEST_VIBRATION') return finish(command, 'rejected', 'UNKNOWN_COMMAND');
    lastCommandId = command.command_id; finish(command, 'applied'); announce();
  });
  const subscribe = async () => { await client.subscribeAsync([`posture/${deviceId}/cmd`, `posture/${deviceId}/receipt`], { qos: 1 }); announce(); };
  client.on('connect', () => subscribe().catch(() => {})); client.on('error', () => {}); await subscribe();
  const timer = setInterval(() => {
    if (state !== 'RUNNING') return;
    const nowUs = mono(); const dt = Math.max(0, Math.round((nowUs - lastSampleUs) / 1000)); lastSampleUs = nowUs;
    elapsed += dt; sampleSeq++;
    pitch = [32 + 8 * Math.sin((nowUs - startUs) / 4000000), 22, 12, 5];
    if (referenceMode && snapshot.reference) {
      const metric = Math.abs(wrap(pitch[0] - snapshot.reference.pitch_deg[0]));
      histogram[Math.min(5, Math.floor(metric / 5))] += dt; validMetric += dt;
    }
    if (Date.now() - lastData >= interval) {
      lastData = Date.now();
      publish('data', { ...envelope(), session_id: sessionId, sample_seq: sampleSeq, telemetry_seq: ++telemetrySeq,
        config_rev: snapshot.config_rev, geometry_rev: snapshot.geometry_rev, calibration_rev: snapshot.calibration_rev,
        reference_rev: snapshot.reference_rev, algorithm_version: snapshot.algorithm_version, pitch_deg: pitch,
        relative_deg: pitch.slice(0, 3).map((p, i) => wrap(p - pitch[i + 1])), sensor_quality: ['OK', 'OK', 'OK', 'OK'],
        curve_valid: true, metric_valid: referenceMode && !!snapshot.reference, curve: demoCurve(pitch, snapshot.distances_mm) });
    }
    if (Date.now() - lastSummary >= 5000) { lastSummary = Date.now(); summary(false); }
  }, 20);
  const heartbeat = setInterval(announce, 1000);
  const retry = setInterval(() => { for (const item of outbox.values()) publish(item.type, item.value); }, 2000);
  return { client, bootId, announce, getState: () => ({ state, sessionId, snapshot }),
    async close() { stopping = true; clearInterval(timer); clearInterval(heartbeat); clearInterval(retry);
      if (client.connected) await client.publishAsync(`posture/${deviceId}/state`, JSON.stringify({ schema_version: 2, device_id: deviceId, boot_id: bootId, online: false }), { retain: true });
      await client.endAsync(true); } };
}
if (require.main === module) {
  startSimulator({ url: process.env.MQTT_URL || 'mqtt://127.0.0.1:1883', password: process.env.DEVICE_MQTT_PASSWORD,
    deviceId: process.env.DEVICE_ID || 'esp32_01', ca: process.env.MQTT_CA_FILE ? require('node:fs').readFileSync(process.env.MQTT_CA_FILE) : undefined })
    .then(simulator => { console.log('SIMULATED DEVICE running; no physical sensor or motor is connected.');
      let closing = false; for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => { if (!closing) { closing = true; await simulator.close(); } }); })
    .catch(error => { console.error(error.message); process.exitCode = 1; });
}
module.exports = { startSimulator, demoCurve };
