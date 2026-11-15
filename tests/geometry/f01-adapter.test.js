'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { reconstructF01Frame, toTelemetryCurve } = require('../../shared/geometry/f01-adapter');
const { validateMessage } = require('../../backend/integrations/mqtt/protocol');
const config = { unit: 'cm', distances: { d12: 6, d23: 7, d34: 9 } };
const context = { frameValid: true, synchronized: true, pitchConvention: 'SPT' };
const frame = () => ({ pitch: [30, 20, 10, 0], relative: [-10, -10, -10], status: [1, 1, 1, 1], timestamp: 1000 });
test('legacy F01 maps four sensors and recomputes opposite-sign relative[]', () => {
  const r = reconstructF01Frame(frame(), config, context);
  assert.equal(r.valid, true); assert.deepEqual(r.relativeAnglesDeg, { q12: 10, q23: 10, q34: 10 });
  assert.deepEqual(r.segments.map(s => s.length), [9, 7, 6]);
  assert.deepEqual(toTelemetryCurve(r).order, ['P4', 'P3', 'P2', 'P1']);
});
test('legacy F01 cannot infer synchronization or pitch mounting from its single timestamp', () => {
  assert.equal(reconstructF01Frame(frame(), config, {}).valid, false);
  assert.equal(reconstructF01Frame(frame(), config, { ...context, synchronized: undefined }).error.code, 'UNSYNCHRONIZED_FRAME');
  assert.equal(reconstructF01Frame(frame(), config, { ...context, pitchConvention: undefined }).valid, false);
  assert.equal(reconstructF01Frame({ ...frame(), timestamp: undefined }, config, context).valid, false);
});
test('invalid current frame clears all geometry; no fallback to a previous result', () => {
  assert.equal(reconstructF01Frame(frame(), config, context).valid, true);
  const r = reconstructF01Frame({ ...frame(), status: [1, 0, 1, 1] }, config, context);
  assert.equal(r.error.code, 'INVALID_SENSOR_FRAME'); assert.equal(toTelemetryCurve(r), null);
});
test('adapter verifies supplied timestamp skew and refuses missing configuration', () => {
  const ctx = { ...context, sensorTimestampsUs: [100, 102, 104, 106], maxSkewUs: 5 };
  assert.equal(reconstructF01Frame(frame(), config, ctx).error.code, 'UNSYNCHRONIZED_FRAME');
  assert.equal(reconstructF01Frame(frame(), config, { ...ctx, maxSkewUs: 6 }).valid, true);
  for (const value of [null, [], 4]) assert.equal(reconstructF01Frame(value, config, context).valid, false);
  assert.equal(reconstructF01Frame(frame(), null, context).valid, false);
});
test('v2 revision/quality adapter produces geometry accepted by the existing validator', () => {
  const message = structuredClone(require('../../backend/integrations/mqtt/examples/data.json'));
  const snapshot = { geometry_rev: message.geometry_rev, distances_mm: [60, 70, 90] };
  const r = reconstructF01Frame(message, snapshot, context);
  assert.equal(r.valid, true, JSON.stringify(r.error)); assert.equal(r.unit, 'mm');
  message.curve = toTelemetryCurve(r);
  assert.equal(validateMessage(`posture/${message.device_id}/data`, message).type, 'data');
  assert.deepEqual(message.curve.nodes_mm[3], [r.points.P1.x, r.points.P1.y]);
  assert.equal(reconstructF01Frame(message, { ...snapshot, geometry_rev: 'other' }, context).error.code, 'INVALID_CONFIG');
  assert.equal(reconstructF01Frame({ ...message, curve_valid: false }, snapshot, context).valid, false);
  assert.equal(reconstructF01Frame({ ...message, sensor_quality: ['OK', 'STALE', 'OK', 'OK'] }, snapshot, context).valid, false);
  assert.equal(reconstructF01Frame(message, snapshot, { ...context, synchronized: undefined }).error.code, 'UNSYNCHRONIZED_FRAME');
});
test('cm telemetry export converts both nodes and inverse-length curvature', () => {
  const r = reconstructF01Frame(frame(), config, context), curve = toTelemetryCurve(r);
  assert.equal(curve.nodes_mm[1][0], r.points.P3.x * 10);
  assert.equal(curve.kappa_per_mm[0], r.segments[0].curvature / 10);
});
