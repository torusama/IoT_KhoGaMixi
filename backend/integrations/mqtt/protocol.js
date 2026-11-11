'use strict';
const { assert, AppError } = require('../../logic/errors');
const ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const STATES = ['IDLE', 'PREFLIGHT', 'RUNNING', 'STOPPING'];
const QUALITY = ['OK', 'MISSING', 'READ_ERROR', 'MOTION', 'STALE', 'WARMING_UP'];
const TYPES = ['state', 'ack', 'data', 'summary', 'event'];
const finite = value => typeof value === 'number' && Number.isFinite(value);
function id(value, label = 'id') { assert(typeof value === 'string' && ID.test(value) && !['__proto__', 'constructor', 'prototype'].includes(value), 'INVALID_MESSAGE', `Invalid ${label}`); return value; }
function integer(value, label, min = 0) { assert(Number.isSafeInteger(value) && value >= min, 'INVALID_MESSAGE', `Invalid ${label}`); }
function array(value, count, check, label) { assert(Array.isArray(value) && value.length === count && value.every(check), 'INVALID_MESSAGE', `Invalid ${label}`); }
function angle(value) { return finite(value) && value >= -180 && value < 180; }
function same(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
function configSnapshot(value) {
  assert(value && typeof value === 'object' && !Array.isArray(value), 'INVALID_CONFIG', 'Missing config snapshot');
  for (const key of ['config_rev', 'geometry_rev', 'calibration_rev', 'algorithm_version']) id(value[key], key);
  assert(value.reference_rev === null || (typeof value.reference_rev === 'string' && ID.test(value.reference_rev)), 'INVALID_CONFIG', 'Invalid reference revision');
  if (value.reference_rev !== null) id(value.reference_rev, 'reference_rev');
  array(value.distances_mm, 3, n => finite(n) && n > 0 && n <= 1000, 'distances_mm');
  array(value.sensor_map, 4, n => Number.isInteger(n) && n >= 0 && n < 8, 'sensor_map');
  assert(new Set(value.sensor_map).size === 4, 'INVALID_CONFIG', 'Duplicate sensor channels');
  assert(typeof value.mounting_confirmed === 'boolean', 'INVALID_CONFIG', 'Missing mounting confirmation');
  if (value.reference_rev !== null) {
    assert(value.reference && value.reference.reference_rev === value.reference_rev, 'INVALID_CONFIG', 'Missing reference snapshot');
    array(value.reference.pitch_deg, 4, angle, 'reference.pitch_deg');
  } else assert(value.reference == null, 'INVALID_CONFIG', 'Reference without revision');
  return value;
}
function validateMessage(topic, raw) {
  const match = /^posture\/([A-Za-z0-9_-]+)\/(state|ack|data|summary|event)$/.exec(topic);
  assert(match, 'INVALID_TOPIC', 'Unsupported device topic');
  const bytes = Buffer.isBuffer(raw) ? raw : Buffer.from(typeof raw === 'string' ? raw : JSON.stringify(raw));
  assert(bytes.length <= 16384, 'PAYLOAD_TOO_LARGE', 'Device payload exceeds 16 KiB', 413);
  let message;
  try { message = JSON.parse(bytes.toString('utf8')); } catch { throw new AppError('INVALID_JSON', 'Malformed device JSON'); }
  assert(message && typeof message === 'object' && !Array.isArray(message), 'INVALID_MESSAGE', 'Expected object');
  assert(message.schema_version === 2, 'SCHEMA_UNSUPPORTED', 'Device must implement protocol v2');
  id(message.device_id, 'device_id'); id(message.boot_id, 'boot_id');
  assert(message.device_id === match[1], 'DEVICE_MISMATCH', 'Topic device differs from payload');
  const type = match[2];
  if (type === 'state' && message.online === false) return { type, message };
  integer(message.t_mono_us, 't_mono_us');
  if (message.ts_unix_ms != null) integer(message.ts_unix_ms, 'ts_unix_ms');
  if (message.started_at_mono_us != null) {
    integer(message.started_at_mono_us, 'started_at_mono_us');
    assert(message.started_at_mono_us <= message.t_mono_us, 'INVALID_MESSAGE', 'Start time is in the future');
  }
  if (message.started_at_unix_ms != null) integer(message.started_at_unix_ms, 'started_at_unix_ms');
  if (type === 'state') {
    integer(message.state_seq, 'state_seq');
    assert(STATES.includes(message.state), 'INVALID_MESSAGE', 'Invalid state');
    assert(typeof message.online === 'boolean', 'INVALID_MESSAGE', 'Missing online flag');
    if (message.state === 'IDLE') assert(message.session_id === null, 'INVALID_MESSAGE', 'IDLE session must be null');
    else id(message.session_id, 'session_id');
    configSnapshot(message.config);
  } else if (type === 'ack') {
    id(message.command_id, 'command_id');
    assert(['accepted', 'applied', 'rejected'].includes(message.status), 'INVALID_MESSAGE', 'Invalid ACK status');
    assert(STATES.includes(message.state), 'INVALID_MESSAGE', 'Invalid ACK state');
    if (message.session_id != null) id(message.session_id, 'session_id');
    if (message.status === 'rejected') id(message.reason, 'reason');
    if (message.config) configSnapshot(message.config);
  } else {
    id(message.session_id, 'session_id');
    if (type === 'data') {
      for (const key of ['config_rev', 'geometry_rev', 'calibration_rev', 'algorithm_version']) id(message[key], key);
      assert(message.reference_rev === null || (typeof message.reference_rev === 'string' && ID.test(message.reference_rev)), 'INVALID_MESSAGE', 'Invalid reference_rev');
      if (message.reference_rev !== null) id(message.reference_rev, 'reference_rev');
      integer(message.sample_seq, 'sample_seq'); integer(message.telemetry_seq, 'telemetry_seq');
      array(message.pitch_deg, 4, n => n === null || angle(n), 'pitch_deg');
      array(message.relative_deg, 3, n => n === null || angle(n), 'relative_deg');
      array(message.sensor_quality, 4, n => QUALITY.includes(n), 'sensor_quality');
      assert(typeof message.curve_valid === 'boolean' && typeof message.metric_valid === 'boolean', 'INVALID_MESSAGE', 'Missing validity flags');
      for (let i = 0; i < 4; i++) assert((message.sensor_quality[i] === 'OK') === (message.pitch_deg[i] !== null), 'INVALID_MESSAGE', 'Quality and pitch disagree');
      const complete = message.sensor_quality.every(q => q === 'OK');
      for (let i = 0; i < 3; i++) {
        const pairValid = message.pitch_deg[i] !== null && message.pitch_deg[i + 1] !== null;
        assert(pairValid === (message.relative_deg[i] !== null), 'INVALID_MESSAGE', 'Invalid adjacent relative null');
        if (pairValid) {
          const expected = ((message.pitch_deg[i] - message.pitch_deg[i + 1] + 540) % 360) - 180;
          assert(Math.abs(expected - message.relative_deg[i]) < 0.05, 'ANGLE_CONVENTION_MISMATCH', 'Relative sign/value differs from P1-P4 convention');
        }
      }
      assert(!message.curve_valid || complete, 'INVALID_MESSAGE', 'Curve requires four valid sensors');
      assert(!message.metric_valid || (complete && message.reference_rev !== null), 'INVALID_MESSAGE', 'Metric requires complete frame and reference');
      if (message.curve_valid) {
        assert(message.curve && same(message.curve.order, ['P4', 'P3', 'P2', 'P1']), 'INVALID_MESSAGE', 'Invalid curve order');
        array(message.curve.nodes_mm, 4, p => Array.isArray(p) && p.length === 2 && p.every(finite), 'curve nodes');
        array(message.curve.kappa_per_mm, 3, finite, 'curve kappa');
      } else assert(message.curve === null, 'INVALID_MESSAGE', 'Invalid curve must be null');
    } else {
      id(message.message_id, 'message_id');
      if (type === 'summary') {
        integer(message.summary_seq, 'summary_seq'); integer(message.last_sample_seq, 'last_sample_seq');
        for (const key of ['elapsed_ms', 'valid_measurement_ms', 'valid_metric_ms', 'invalid_ms', 'coverage_start_mono_us', 'coverage_end_mono_us']) integer(message[key], key);
        array(message.histogram_ms, 6, n => Number.isSafeInteger(n) && n >= 0, 'histogram_ms');
        assert(message.histogram_ms.reduce((a, b) => a + b, 0) === message.valid_metric_ms, 'INVALID_SUMMARY', 'Histogram must equal valid metric time');
        assert(message.valid_metric_ms <= message.valid_measurement_ms && message.valid_measurement_ms + message.invalid_ms === message.elapsed_ms, 'INVALID_SUMMARY', 'Invalid time accounting');
        assert(message.coverage_end_mono_us >= message.coverage_start_mono_us && message.t_mono_us >= message.coverage_end_mono_us, 'INVALID_SUMMARY', 'Invalid coverage');
        assert(typeof message.is_final === 'boolean', 'INVALID_SUMMARY', 'Missing is_final');
      } else {
        id(message.event_id, 'event_id'); integer(message.event_seq, 'event_seq');
        assert(['posture', 'reminder', 'prolonged', 'data_gap'].includes(message.type), 'INVALID_EVENT', 'Invalid event type');
        id(message.metric, 'metric'); integer(message.started_at_mono_us, 'started_at_mono_us');
        if (message.ended_at_mono_us !== null) integer(message.ended_at_mono_us, 'ended_at_mono_us', message.started_at_mono_us);
        integer(message.duration_ms, 'duration_ms');
        assert(message.started_at_mono_us <= message.t_mono_us && (message.ended_at_mono_us === null || message.ended_at_mono_us <= message.t_mono_us), 'INVALID_EVENT', 'Event time is in the future');
        assert(finite(message.peak_deg) && message.peak_deg >= 0 && message.peak_deg <= 180, 'INVALID_EVENT', 'Invalid peak_deg');
        assert(typeof message.vibrated === 'boolean' && typeof message.notification_requested === 'boolean', 'INVALID_EVENT', 'Missing event flags');
      }
    }
  }
  return { type, message };
}
module.exports = { ID, TYPES, STATES, id, integer, finite, angle, configSnapshot, validateMessage };
