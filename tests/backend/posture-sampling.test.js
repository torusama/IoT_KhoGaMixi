'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { ReferenceCapture, evaluateFrame, relativeAngles } = require('../../backend/logic/reference');
const { SessionStats } = require('../../backend/logic/session-stats');
const { snapshot } = require('./helpers');

function frame(ms, pitch = [179, 20, 10, 5]) {
  return { t_mono_us: ms * 1000, pitch_deg: pitch, relative_deg: relativeAngles(pitch),
    sensor_quality: pitch.map(value => value === null ? 'MISSING' : 'OK') };
}

test('reference restarts after P4 motion, missing data and clock gaps, and averages across the wrap boundary', () => {
  const capture = new ReferenceCapture({ windowUs: 400000 });
  assert.equal(capture.add(frame(0)), null);
  assert.equal(capture.add(frame(100, [179, 20, 10, 9])), null);
  assert.equal(capture.progress.status, 'unstable');
  assert.equal(capture.add(frame(200, [179, 20, null, 5])), null);
  assert.equal(capture.progress.status, 'invalid');
  assert.equal(capture.add(frame(300)), null);
  assert.equal(capture.add(frame(600, [179.5, 20, 10, 5])), null);
  assert.equal(capture.progress.stable_ms, 0);
  assert.equal(capture.add(frame(800, [-179.5, 20, 10, 5])), null);
  const captured = capture.add(frame(1000, [179.5, 20, 10, 5]));
  assert.ok(Math.abs(captured[0]) > 179);
  assert.ok(captured.slice(1).every((value, i) => Math.abs(value - [20, 10, 5][i]) < 1e-9));
});

test('deviation requires all four sensors, reference mode and matching revisions', () => {
  const config = snapshot(true);
  Object.assign(config.reference, { pitch_deg: [179, 20, 10, 5], calibration_rev: config.calibration_rev });
  const reading = frame(0, [-179, 20, 10, 5]);
  assert.equal(evaluateFrame(reading, config, 'reference').deviation.value_deg, 2);
  assert.equal(evaluateFrame(reading, config, 'measurement_only').deviation, null);
  assert.equal(evaluateFrame(reading, { ...config, calibration_rev: 'new_cal' }, 'reference').deviation, null);
  assert.equal(evaluateFrame(frame(0, [-179, 20, null, 5]), config, 'reference').measurement_valid, false);
});

test('session counts valid intervals and relative angles, splits events at gaps, and closes on STOP', () => {
  const config = snapshot(true);
  config.reference.pitch_deg = [179, 20, 10, 5];
  const stats = new SessionStats({ startUs: 0, mode: 'reference', snapshot: config });
  const tilted = [-161, 25, 10, 5];
  for (const sample of [
    frame(0), frame(100, [-179, 20, 10, 5]), frame(250, tilted), frame(450, tilted),
    frame(550, [-161, 25, null, 5]), frame(650, tilted), frame(850, tilted),
    frame(1300, tilted), frame(1400)
  ]) stats.record(sample);
  stats.finish(1500000);
  const summary = stats.summary();
  assert.deepEqual([summary.elapsed_ms, summary.valid_measurement_ms, summary.valid_metric_ms, summary.invalid_ms], [1500, 750, 750, 750]);
  assert.deepEqual(summary.histogram_ms, [250, 0, 0, 0, 500, 0]);
  assert.equal(summary.deviation_stats.above_threshold_ms, 500);
  assert.equal(summary.deviation_stats.posture_event_count, 3);
  assert.equal(summary.angle_stats.pitch[0].min_deg, -179);
  assert.equal(summary.angle_stats.pitch[0].max_deg, 179);
  assert.ok(Math.abs(summary.angle_stats.pitch[0].mean_deg) > 160);
  assert.equal(summary.angle_stats.relative.length, 3);
  const closed = stats.drainEvents().filter(event => event.event_seq === 2);
  assert.deepEqual(closed.filter(event => event.type === 'data_gap').map(event => event.duration_ms), [200, 450]);
  assert.deepEqual(closed.filter(event => event.type === 'posture').map(event => [event.duration_ms, event.ended_reason]),
    [[200, 'data_gap'], [200, 'data_gap'], [100, 'below_threshold']]);
});

test('measurement-only keeps angle coverage without reference stats and empty summaries report null angles', () => {
  const stats = new SessionStats({ startUs: 0, mode: 'measurement_only', snapshot: snapshot() });
  assert.equal(stats.summary().angle_stats.pitch[0].mean_deg, null);
  stats.record(frame(0, [179, 20, 10, 5]));
  stats.record(frame(100, [-179, 20, 10, 5]));
  stats.record(frame(200, [-179, 20, 10, 5]));
  stats.finish(200000);
  const sum = stats.summary();
  assert.equal(sum.valid_measurement_ms, 200);
  assert.equal(sum.valid_metric_ms, 0);
  assert.equal(sum.deviation_stats, null);
  assert.ok(Math.abs(sum.angle_stats.pitch[0].mean_deg) > 179.9);
});
