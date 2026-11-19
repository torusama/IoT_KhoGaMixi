'use strict';
const mqtt = require('mqtt');
const { randomUUID } = require('node:crypto');
const path = require('node:path');
const { canonical } = require('../logic/service');
const { FileStore } = require('../integrations/firebase/store');
const { id, configSnapshot } = require('../integrations/mqtt/protocol');
const { reconstructSpine2D } = require('../../shared/geometry/spine2d');
const { toTelemetryCurve } = require('../../shared/geometry/f01-adapter');
const { ReferenceCapture, relativeAngles, completeFrame, MAX_SAMPLE_GAP_US } = require('../logic/reference');
const { SessionStats } = require('../logic/session-stats');

function demoCurve(pitchDegrees, distancesMillimeters) {
  // Dữ liệu mô phỏng: bốn góc được tạo trong cùng một lần tick.
  const sensorNames = ['P1', 'P2', 'P3', 'P4'];
  const pitchesBySensor = {};
  const statusesBySensor = {};
  for (let sensorIndex = 0; sensorIndex < sensorNames.length; sensorIndex++) {
    const sensorName = sensorNames[sensorIndex];
    pitchesBySensor[sensorName] = pitchDegrees[sensorIndex];
    statusesBySensor[sensorName] = 'OK';
  }
  const result = reconstructSpine2D({
    pitchDeg: pitchesBySensor,
    sensorStatus: statusesBySensor,
    distances: {
      d12: distancesMillimeters[0],
      d23: distancesMillimeters[1],
      d34: distancesMillimeters[2]
    },
    unit: 'mm',
    frameValid: true,
    synchronized: true
  });
  return toTelemetryCurve(result);
}
const SCENARIOS = ['normal', 'exercise', 'unstable', 'missing'];
function simulatedSample(scenario, state, seconds, posture) {
  const pitch = posture === 'standing' ? [12, 8, 5, 2] : [32, 22, 12, 5];
  const quality = ['OK', 'OK', 'OK', 'OK'];
  if (scenario === 'missing') quality[2] = 'MISSING';
  if (state === 'RUNNING') {
    const phase = seconds % 12;
    if (scenario === 'exercise') {
      if (phase >= 7 && phase < 8) return null;
      if (phase >= 4 && phase < 5) quality[2] = 'MISSING';
      pitch[0] += phase >= 2 && phase < 10 ? 20 : 0;
      pitch[1] += phase >= 2 && phase < 10 ? 5 : 0;
    } else pitch[0] += 8 * Math.sin(seconds / 4);
  } else if (scenario === 'unstable') {
    pitch[3] += 8 * Math.sin(seconds * 6);
  } else {
    pitch[0] += 0.2 * Math.sin(seconds * 3);
  }
  return { pitch_deg: pitch.map((value, i) => quality[i] === 'OK' ? value : null), sensor_quality: quality };
}

async function startSimulator({ url, password, deviceId = 'esp32_01', preflightMs = 2000, ca,
  scenario = 'normal', captureOptions, sampleSource, referenceFile } = {}) {
  id(deviceId, 'device_id');
  if (!SCENARIOS.includes(scenario)) throw new Error('SIM_SCENARIO must be normal, exercise, unstable or missing');
  const bootId = `b_${randomUUID().replaceAll('-', '').slice(0, 16)}`; const baseTime = process.hrtime.bigint();
  const mono = () => Number((process.hrtime.bigint() - baseTime) / 1000n);
  let state = 'IDLE', sessionId = null, stateSeq = 0, sampleSeq = 0, telemetrySeq = 0, summarySeq = 0;
  let startUs = 0, lastCommandId = null, lastClosed = null, lastData = 0, lastSummary = 0;
  let stats, capture, savingReference, idleSample, lastValidity, lastSampleUs, interval = 100;
  let reminder = false, stopping = false;
  let snapshot = { config_rev: 'cfg_1', geometry_rev: 'g_1', calibration_rev: 'c_1', reference_rev: null,
    algorithm_version: 'arc2d_v1', distances_mm: [70, 70, 70], sensor_map: [0, 1, 2, 3], mounting_confirmed: true, reference: null };
  const referenceStore = await new FileStore(referenceFile).init();
  const storedSnapshot = await referenceStore.get('snapshot');
  if (storedSnapshot) snapshot = configSnapshot(storedSnapshot);
  const results = new Map(); const outbox = new Map();
  const envelope = () => ({ schema_version: 2, device_id: deviceId, boot_id: bootId, t_mono_us: mono(), ts_unix_ms: Date.now(), simulated: true });
  const client = await mqtt.connectAsync(url, { clientId: deviceId, username: deviceId, password, ca, rejectUnauthorized: true,
    reconnectPeriod: 1000, protocolVersion: 4, queueQoSZero: false,
    will: { topic: `posture/${deviceId}/state`, payload: JSON.stringify({ schema_version: 2, device_id: deviceId, boot_id: bootId, online: false }), qos: 0, retain: true } });
  const publish = (type, message, retain = false) => { if (client.connected) client.publish(`posture/${deviceId}/${type}`, JSON.stringify(message), { qos: 0, retain }); };
  const announce = () => publish('state', { ...envelope(), online: true, state, state_seq: ++stateSeq, session_id: sessionId,
    started_at_mono_us: startUs, last_command_id: lastCommandId, last_closed_session_id: lastClosed, config: snapshot, reminder_enabled: reminder,
    idle_sample: state === 'IDLE' ? idleSample ?? null : null,
    reference_capture: capture ? { command_id: capture.command.command_id, ...capture.window.progress } : null }, true);
  const ack = (command, status, reason) => ({ ...envelope(), command_id: command.command_id, session_id: command.session_id || null, status, state,
    ...(reason ? { reason } : {}), ...(command.command === 'SET_REFERENCE' && status === 'applied' ? { config: snapshot } : {}), started_at_mono_us: startUs });
  const finish = (command, status, reason) => { const value = ack(command, status, reason); results.set(command.command_id, { request: canonical(command), value }); publish('ack', value); };
  function durable(type, value) {
    outbox.set(value.message_id, { type, value });
    publish(type, value);
  }
  function summary(final) {
    const value = { ...envelope(), session_id: sessionId, message_id: `sum_${bootId}_${++summarySeq}`, summary_seq: summarySeq,
      last_sample_seq: sampleSeq, ...stats.summary(), is_final: final };
    durable('summary', value);
  }
  function publishEvents() {
    for (const { number, ...event } of stats.drainEvents()) {
      const eventId = `evt_${String(number).padStart(8, '0')}`;
      durable('event', { ...envelope(), ...event, session_id: sessionId, event_id: eventId,
        message_id: `${sessionId}_${eventId}_${event.event_seq}` });
    }
  }
  function sample(now) {
    const posture = capture?.command.posture ?? snapshot.reference?.posture ?? 'seated';
    const elapsedSeconds = (state === 'RUNNING' ? now - startUs : now) / 1000000;
    const values = sampleSource ? sampleSource({ state, nowUs: now, elapsedSeconds, posture }) : simulatedSample(scenario, state, elapsedSeconds, posture);
    return values && { ...values, t_mono_us: now, relative_deg: relativeAngles(values.pitch_deg) };
  }
  function captureTick(frame, now) {
    if (!capture || savingReference) return;
    const { command, window, deadline } = capture;
    if (now >= deadline) {
      const reason = window.progress.status === 'invalid' ? 'SENSOR_INVALID' : 'REFERENCE_UNSTABLE';
      capture = null; finish(command, 'rejected', reason); announce(); return;
    }
    const pitch = window.add(frame ?? { t_mono_us: now });
    if (!pitch) return;
    const reference = { reference_rev: command.reference_rev, pitch_deg: pitch, relative_deg: relativeAngles(pitch),
      posture: command.posture ?? 'seated', captured_at_unix_ms: Date.now(),
      calibration_rev: snapshot.calibration_rev, geometry_rev: snapshot.geometry_rev,
      calibration: { profile: 'simulator_identity', pitch_offsets_deg: [0, 0, 0, 0] },
      stability: { window_ms: window.progress.required_ms, max_spread_deg: window.maxSpread } };
    const next = { ...snapshot, config_rev: `cfg_${randomUUID().slice(0, 8)}`, reference_rev: command.reference_rev, reference };
    savingReference = referenceStore.update({ snapshot: next }).then(() => {
      snapshot = next; capture = null; lastCommandId = command.command_id;
      finish(command, 'applied'); announce();
    }, () => {
      capture = null; finish(command, 'rejected', 'REFERENCE_STORAGE_FAILED'); announce();
    }).finally(() => { savingReference = null; });
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
    if (capture) return finish(command, 'rejected', 'COMMAND_PENDING');
    if (command.command === 'START') {
      if (state !== 'IDLE' || command.session_id === lastClosed) return finish(command, 'rejected', 'SESSION_CONFLICT');
      if (command.mode === 'reference' && !snapshot.reference) return finish(command, 'rejected', 'REFERENCE_REQUIRED');
      sessionId = command.session_id; state = 'PREFLIGHT'; finish(command, 'accepted'); announce();
      setTimeout(() => {
        if (stopping) return;
        const now = mono();
        const failure = now > command.not_after_mono_us ? 'COMMAND_EXPIRED' : !completeFrame(sample(now)) ? 'SENSOR_INVALID' : null;
        if (failure) { state = 'IDLE'; finish(command, 'rejected', failure); sessionId = null; announce(); return; }
        state = 'RUNNING'; startUs = now; lastSampleUs = now; lastData = now; lastSummary = now;
        summarySeq = 0; telemetrySeq = 0; sampleSeq = 0; lastValidity = null;
        stats = new SessionStats({ startUs, mode: command.mode, snapshot });
        const initial = sample(now);
        if (initial) { stats.record(initial); sampleSeq++; }
        lastCommandId = command.command_id;
        finish(command, 'applied'); announce();
      }, preflightMs).unref();
      return;
    }
    if (command.command === 'STOP') {
      if (state !== 'RUNNING' || command.session_id !== sessionId) return finish(command, 'rejected', 'SESSION_MISMATCH');
      stats.finish(mono()); publishEvents(); summary(true);
      lastClosed = sessionId; state = 'IDLE'; lastCommandId = command.command_id;
      finish(command, 'applied'); sessionId = null; announce(); return;
    }
    if (command.command === 'SET_REFERENCE') {
      if (state !== 'IDLE') return finish(command, 'rejected', 'SESSION_LOCKED');
      capture = { command, window: new ReferenceCapture(captureOptions), deadline: Math.min(command.not_after_mono_us, mono() + 8000000) };
      finish(command, 'accepted'); announce(); return;
    } else if (command.command === 'SET_REMINDER') reminder = command.enabled;
    else if (command.command === 'CONFIG') interval = command.publish_interval_ms;
    else if (command.command !== 'TEST_VIBRATION') return finish(command, 'rejected', 'UNKNOWN_COMMAND');
    lastCommandId = command.command_id; finish(command, 'applied'); announce();
  });
  const subscribe = async () => { await client.subscribeAsync([`posture/${deviceId}/cmd`, `posture/${deviceId}/receipt`], { qos: 1 }); announce(); };
  client.on('connect', () => subscribe().catch(() => {})); client.on('error', () => {}); await subscribe();
  const timer = setInterval(() => {
    const now = mono();
    const frame = sample(now);
    if (state === 'IDLE') {
      idleSample = frame;
      captureTick(frame, now);
      return;
    }
    if (state !== 'RUNNING' || !frame) return;
    const values = stats.record(frame);
    sampleSeq++;
    const resumed = now - lastSampleUs > MAX_SAMPLE_GAP_US;
    lastSampleUs = now;
    publishEvents();
    if (now - lastData >= interval * 1000 || values.measurement_valid !== lastValidity || resumed) {
      lastData = now; lastValidity = values.measurement_valid;
      const curve = values.measurement_valid ? demoCurve(frame.pitch_deg, snapshot.distances_mm) : null;
      publish('data', { ...envelope(), ...frame, ...values, session_id: sessionId, sample_seq: sampleSeq, telemetry_seq: ++telemetrySeq,
        config_rev: snapshot.config_rev, geometry_rev: snapshot.geometry_rev, calibration_rev: snapshot.calibration_rev,
        reference_rev: snapshot.reference_rev, algorithm_version: snapshot.algorithm_version, sample_gap_before: resumed,
        curve_valid: curve !== null, curve });
    }
    if (now - lastSummary >= 5000000) { lastSummary = now; summary(false); }
  }, 20);
  const heartbeat = setInterval(announce, 1000);
  const retry = setInterval(() => { for (const item of outbox.values()) publish(item.type, item.value); }, 2000);
  return { client, bootId, announce, getState: () => ({ state, sessionId, snapshot }),
    async close() { stopping = true; clearInterval(timer); clearInterval(heartbeat); clearInterval(retry);
      await savingReference;
      await referenceStore.close();
      if (client.connected) await client.publishAsync(`posture/${deviceId}/state`, JSON.stringify({ schema_version: 2, device_id: deviceId, boot_id: bootId, online: false }), { retain: true });
      await client.endAsync(true); } };
}
if (require.main === module) {
  const deviceId = process.env.DEVICE_ID || 'esp32_01';
  startSimulator({ url: process.env.MQTT_URL || 'mqtt://127.0.0.1:1883', password: process.env.DEVICE_MQTT_PASSWORD,
    deviceId, scenario: process.env.SIM_SCENARIO, referenceFile: path.join(__dirname, '..', '.runtime', `simulator-${deviceId}.json`),
    ca: process.env.MQTT_CA_FILE ? require('node:fs').readFileSync(process.env.MQTT_CA_FILE) : undefined })
    .then(simulator => { console.log('SIMULATED DEVICE running; no physical sensor or motor is connected.');
      let closing = false; for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => { if (!closing) { closing = true; await simulator.close(); } }); })
    .catch(error => { console.error(error.message); process.exitCode = 1; });
}
module.exports = { startSimulator, demoCurve };
