'use strict';
const { assert, AppError } = require('../../logic/errors');
const { METRIC, POSTURES, relativeAngles } = require('../../logic/reference');
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
function frameAngles(frame) {
  array(frame.pitch_deg, 4, n => n === null || angle(n), 'pitch_deg');
  array(frame.relative_deg, 3, n => n === null || angle(n), 'relative_deg');
  array(frame.sensor_quality, 4, n => QUALITY.includes(n), 'sensor_quality');
  for (let i = 0; i < 4; i++) assert((frame.sensor_quality[i] === 'OK') === (frame.pitch_deg[i] !== null), 'INVALID_MESSAGE', 'Quality and pitch disagree');
  const expected = relativeAngles(frame.pitch_deg);
  for (let i = 0; i < 3; i++) {
    const received = frame.relative_deg[i];
    assert((expected[i] === null) === (received === null), 'INVALID_MESSAGE', 'Invalid adjacent relative null');
    if (received !== null) assert(Math.abs(expected[i] - received) < 0.05, 'ANGLE_CONVENTION_MISMATCH', 'Relative sign/value differs from P1-P4 convention');
  }
  return frame.sensor_quality.every(q => q === 'OK');
}
function angleStat(value, validMs) {
  if (!value || typeof value !== 'object') return false;
  const { min_deg: min, max_deg: max, mean_deg: mean } = value;
  const { sin_ms: sin, cos_ms: cos } = value;
  if (sin !== undefined || cos !== undefined) {
    if (!finite(sin) || !finite(cos) || Math.hypot(sin, cos) > validMs + 0.001) return false;
  }
  return (mean === null || angle(mean)) && ((min === null && max === null && mean === null) || (angle(min) && angle(max) && min <= max));
}
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
    const reference = value.reference;
    if (reference.relative_deg !== undefined) {
      array(reference.relative_deg, 3, angle, 'reference.relative_deg');
      assert(relativeAngles(reference.pitch_deg).every((angle, i) => Math.abs(angle - reference.relative_deg[i]) < 0.05), 'INVALID_CONFIG', 'Reference relative angles disagree with pitch');
    }
    if (reference.posture !== undefined) assert(POSTURES.includes(reference.posture), 'INVALID_CONFIG', 'Invalid reference posture');
    if (reference.captured_at_unix_ms !== undefined) integer(reference.captured_at_unix_ms, 'captured_at_unix_ms');
    for (const rev of ['calibration_rev', 'geometry_rev']) if (reference[rev] !== undefined) id(reference[rev], rev);
    if (reference.calibration !== undefined) {
      assert(reference.calibration && typeof reference.calibration === 'object', 'INVALID_CONFIG', 'Invalid reference calibration');
      id(reference.calibration.profile, 'calibration.profile');
      if (reference.calibration.pitch_offsets_deg !== undefined) array(reference.calibration.pitch_offsets_deg, 4, angle, 'calibration.pitch_offsets_deg');
    }
    if (reference.stability !== undefined) {
      assert(reference.stability && finite(reference.stability.max_spread_deg) && reference.stability.max_spread_deg > 0 &&
        reference.stability.max_spread_deg < 180, 'INVALID_CONFIG', 'Invalid reference spread');
      integer(reference.stability.window_ms, 'reference.stability.window_ms', 1);
    }
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
    if (message.idle_sample != null) {
      assert(message.state === 'IDLE', 'INVALID_MESSAGE', 'Idle sample requires IDLE state');
      integer(message.idle_sample.t_mono_us, 'idle sample time');
      assert(message.idle_sample.t_mono_us <= message.t_mono_us, 'INVALID_MESSAGE', 'Idle sample is in the future');
      frameAngles(message.idle_sample);
    }
    if (message.reference_capture != null) {
      const capture = message.reference_capture;
      id(capture.command_id, 'command_id');
      integer(capture.stable_ms, 'stable_ms'); integer(capture.required_ms, 'required_ms', 1);
      assert(message.state === 'IDLE' && ['waiting', 'stabilizing', 'unstable', 'invalid', 'ready'].includes(capture.status) &&
        capture.stable_ms <= capture.required_ms, 'INVALID_MESSAGE', 'Invalid reference capture status');
    }
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
      const complete = frameAngles(message);
      assert(typeof message.curve_valid === 'boolean' && typeof message.metric_valid === 'boolean', 'INVALID_MESSAGE', 'Missing validity flags');
      if (message.measurement_valid !== undefined) assert(message.measurement_valid === complete, 'INVALID_MESSAGE', 'Measurement validity disagrees with sensors');
      if (message.sample_gap_before !== undefined) assert(typeof message.sample_gap_before === 'boolean', 'INVALID_MESSAGE', 'Invalid sample gap flag');
      assert(!message.curve_valid || complete, 'INVALID_MESSAGE', 'Curve requires four valid sensors');
      assert(!message.metric_valid || (complete && message.reference_rev !== null), 'INVALID_MESSAGE', 'Metric requires complete frame and reference');
      if (message.deviation !== undefined) {
        const value = message.deviation;
        assert(message.metric_valid ? value?.metric === METRIC && finite(value.value_deg) && value.value_deg >= 0 && value.value_deg <= 180 : value === null,
          'INVALID_MESSAGE', 'Invalid deviation');
      }
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
        if (message.angle_stats !== undefined) {
          assert(message.angle_stats && typeof message.angle_stats === 'object', 'INVALID_SUMMARY', 'Invalid angle stats');
          const present = stat => angleStat(stat, message.valid_measurement_ms) && (stat.min_deg !== null) === (message.valid_measurement_ms > 0);
          array(message.angle_stats.pitch, 4, present, 'angle_stats.pitch');
          array(message.angle_stats.relative, 3, present, 'angle_stats.relative');
        }
        if (message.deviation_stats != null) {
          const stats = message.deviation_stats;
          id(stats.reference_rev, 'reference_rev');
          integer(stats.above_threshold_ms, 'above_threshold_ms'); integer(stats.posture_event_count, 'posture_event_count');
          assert(stats.metric === METRIC && finite(stats.threshold_deg) && stats.threshold_deg > 0 && stats.threshold_deg <= 180 &&
            stats.above_threshold_ms <= message.valid_metric_ms, 'INVALID_SUMMARY', 'Invalid deviation stats');
        }
      } else {
        id(message.event_id, 'event_id'); integer(message.event_seq, 'event_seq');
        assert(['posture', 'reminder', 'prolonged', 'data_gap'].includes(message.type), 'INVALID_EVENT', 'Invalid event type');
        id(message.metric, 'metric'); integer(message.started_at_mono_us, 'started_at_mono_us');
        if (message.ended_at_mono_us !== null) integer(message.ended_at_mono_us, 'ended_at_mono_us', message.started_at_mono_us);
        integer(message.duration_ms, 'duration_ms');
        assert(message.started_at_mono_us <= message.t_mono_us && (message.ended_at_mono_us === null || message.ended_at_mono_us <= message.t_mono_us), 'INVALID_EVENT', 'Event time is in the future');
        assert(finite(message.peak_deg) && message.peak_deg >= 0 && message.peak_deg <= 180, 'INVALID_EVENT', 'Invalid peak_deg');
        assert(typeof message.vibrated === 'boolean' && typeof message.notification_requested === 'boolean', 'INVALID_EVENT', 'Missing event flags');
        if (message.ended_reason !== undefined) {
          assert(message.ended_at_mono_us !== null, 'INVALID_EVENT', 'End reason requires a closed event');
          id(message.ended_reason, 'ended_reason');
        }
        if (message.reference_rev !== undefined) id(message.reference_rev, 'reference_rev');
        if (message.threshold_deg !== undefined) assert(finite(message.threshold_deg) && message.threshold_deg > 0 && message.threshold_deg <= 180, 'INVALID_EVENT', 'Invalid event threshold');
      }
    }
  }
  return { type, message };
}
module.exports = { ID, TYPES, STATES, id, integer, finite, angle, configSnapshot, validateMessage };
