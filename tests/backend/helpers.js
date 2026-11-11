'use strict';
const { FileStore } = require('../../backend/integrations/firebase/store');
const { PostureService } = require('../../backend/logic/service');
const { demoCurve } = require('../../backend/scripts/simulator');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
async function removeTestDir(directory) {
  const target = await fs.realpath(directory); const temporaryRoot = await fs.realpath(os.tmpdir());
  if (path.dirname(target) !== temporaryRoot || !path.basename(target).startsWith('spt-')) throw new Error('Refusing cleanup outside task test directory');
  await fs.rm(target, { recursive: true, force: true });
}
const config = { staleMs: 6000, offlineMs: 15000, commandTimeoutMs: 10000, commandRetryMs: 2000, keyframeIntervalMs: 5000 };
function snapshot(reference = false) {
  return { config_rev: 'cfg_1', geometry_rev: 'g_1', calibration_rev: 'c_1', reference_rev: reference ? 'r_1' : null,
    algorithm_version: 'arc2d_v1', distances_mm: [70, 70, 70], sensor_map: [0, 1, 2, 3], mounting_confirmed: true,
    reference: reference ? { reference_rev: 'r_1', pitch_deg: [32, 22, 12, 5] } : null };
}
function state(overrides = {}) {
  return { schema_version: 2, device_id: 'esp32_01', boot_id: 'boot_1', t_mono_us: 1000000, ts_unix_ms: 1794405600000,
    online: true, state_seq: 1, state: 'IDLE', session_id: null, config: snapshot(), ...overrides };
}
function ack(command, overrides = {}) {
  return { schema_version: 2, device_id: command.device_id, boot_id: command.payload.target_boot_id,
    t_mono_us: 2000000, ts_unix_ms: 1794405601000, command_id: command.command_id,
    session_id: command.payload.session_id || null, status: 'applied', state: command.payload.command === 'START' ? 'RUNNING' : 'IDLE', ...overrides };
}
function summary(command, overrides = {}) {
  return { schema_version: 2, device_id: command.device_id, boot_id: command.payload.target_boot_id, session_id: command.payload.session_id,
    message_id: 'summary_1', summary_seq: 1, last_sample_seq: 100, t_mono_us: 5000000, ts_unix_ms: 1794405604000,
    elapsed_ms: 2000, valid_measurement_ms: 2000, valid_metric_ms: 0, invalid_ms: 0, histogram_ms: [0, 0, 0, 0, 0, 0],
    coverage_start_mono_us: 2000000, coverage_end_mono_us: 4000000, is_final: false, ...overrides };
}
function event(command, overrides = {}) {
  return { schema_version: 2, device_id: command.device_id, boot_id: command.payload.target_boot_id, session_id: command.payload.session_id,
    t_mono_us: 5000000, ts_unix_ms: 1794405604000, event_id: 'event_1', event_seq: 1, message_id: 'event_message_1',
    type: 'posture', metric: 'upper_reference_deviation', started_at_mono_us: 2500000, ended_at_mono_us: null,
    duration_ms: 1500, peak_deg: 18, vibrated: false, notification_requested: false, ...overrides };
}
function data(command, overrides = {}) {
  const pitch = [32, 22, 12, 5]; const cfg = snapshot();
  return { schema_version: 2, device_id: command.device_id, boot_id: command.payload.target_boot_id, session_id: command.payload.session_id,
    t_mono_us: 3000000, sample_seq: 10, telemetry_seq: 1, config_rev: cfg.config_rev, geometry_rev: cfg.geometry_rev,
    calibration_rev: cfg.calibration_rev, reference_rev: cfg.reference_rev, algorithm_version: cfg.algorithm_version,
    pitch_deg: pitch, relative_deg: [10, 10, 7], sensor_quality: ['OK', 'OK', 'OK', 'OK'], curve_valid: true, metric_valid: false,
    curve: demoCurve(pitch, cfg.distances_mm), ...overrides };
}
async function fixture(options = {}) {
  let time = 1794405600000;
  const transport = { connected: true, sent: [], async publish(topic, payload) { this.sent.push({ topic, payload: structuredClone(payload) }); }, async close() {} };
  const store = options.store || await new FileStore().init();
  const service = await new PostureService({ config, store, transport, clock: () => time }).init();
  const ingest = message => service.ingest(`posture/${message.device_id}/${message.command_id ? 'ack' : message.summary_seq ? 'summary' : message.event_id ? 'event' : message.telemetry_seq ? 'data' : 'state'}`, message);
  return { service, store, transport, ingest, advance: ms => { time += ms; } };
}
async function running(f = null) {
  f ||= await fixture(); await f.ingest(state());
  const command = await f.service.command('esp32_01', { command: 'START', command_id: 'start_1' });
  await f.ingest(ack(command)); return { ...f, command };
}
module.exports = { config, snapshot, state, ack, summary, event, data, fixture, running, removeTestDir };
