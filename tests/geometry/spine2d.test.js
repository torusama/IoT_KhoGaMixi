'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { reconstructSpine2D: reconstruct, wrapDegrees } = require('../../shared/geometry/spine2d');
const fixtures = require('./fixtures.json');
const ids = ['P1', 'P2', 'P3', 'P4'];
function input(pitches = fixtures.straight) {
  return { pitchDeg: Object.fromEntries(ids.map((id, i) => [id, pitches[i]])),
    distances: { d12: 7, d23: 7, d34: 7 }, unit: 'cm', frameValid: true, synchronized: true,
    sensorStatus: Object.fromEntries(ids.map(id => [id, 'OK'])) };
}
function near(actual, expected, tolerance = 1e-10) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected} +/- ${tolerance}`);
}
function pointNear(actual, expected, tolerance) {
  near(actual.x, expected.x, tolerance); near(actual.y, expected.y, tolerance);
}
function finiteTree(value) {
  if (typeof value === 'number') assert.ok(Number.isFinite(value));
  else if (value && typeof value === 'object') Object.values(value).forEach(finiteTree);
}
function good(result) { assert.equal(result.valid, true, JSON.stringify(result.error)); finiteTree(result); return result; }
function bad(value, code, options) {
  const result = reconstruct(value, options);
  assert.equal(result.valid, false); assert.equal(result.error.code, code);
  assert.equal(result.points, null); assert.deepEqual(result.curvePoints, []); assert.deepEqual(result.segments, []);
  finiteTree(result); return result;
}

test('T04-A: upright at exact cumulative arc lengths, no zero division', () => {
  const r = good(reconstruct(input()));
  for (const [i, id] of ['P4', 'P3', 'P2', 'P1'].entries()) pointNear(r.points[id], { x: 0, y: 7 * i });
  for (const s of r.segments) { assert.equal(s.type, 'line'); assert.equal(s.curvature, 0); assert.equal(s.radius, null); assert.equal(s.center, null); }
  assert.deepEqual(r.relativeAnglesDeg, { q12: 0, q23: 0, q34: 0 });
});
test('T04-B: tilted line preserves absolute theta4', () => {
  const r = good(reconstruct(input(fixtures.tilted)));
  pointNear(r.points.P1, { x: 10.5, y: 21 * Math.sqrt(3) / 2 }); near(r.totalLength, 21);
  r.segments.forEach(s => { assert.equal(s.type, 'line'); near(Math.hypot(s.end.x - s.start.x, s.end.y - s.start.y), 7); });
});
test('T04-C: C shape equals an independently calculated single constant-curvature arc', () => {
  const r = good(reconstruct(input(fixtures.cShape)));
  const radius = 21 / (Math.PI / 6);
  pointNear(r.points.P1, { x: radius * (1 - Math.cos(Math.PI / 6)), y: radius * Math.sin(Math.PI / 6) });
  r.segments.forEach(s => { assert.equal(s.type, 'arc'); assert.ok(s.curvature > 0); pointNear(s.center, { x: radius, y: 0 }); });
});
test('T04-D: S shape alternates signed curvature and keeps junctions', () => {
  const r = good(reconstruct(input(fixtures.sShape)));
  assert.deepEqual(r.segments.map(s => Math.sign(s.curvature)), [-1, 1, -1]);
  assert.strictEqual(r.segments[0].end, r.segments[1].start);
  assert.strictEqual(r.segments[1].end, r.segments[2].start);
});
test('T04-E: negative angles mirror the C curve and signed centers', () => {
  const positive = good(reconstruct(input(fixtures.cShape))), negative = good(reconstruct(input(fixtures.reverse)));
  ids.forEach(id => pointNear(negative.points[id], { x: -positive.points[id].x, y: positive.points[id].y }));
  negative.segments.forEach((s, i) => { assert.ok(s.curvature < 0); near(s.radius, positive.segments[i].radius); });
});
test('T04-F: near-zero uses configured straight limit, bounded tangent error', () => {
  const r = good(reconstruct(input([30.06, 30.04, 30.02, 30]), { epsilonDeg: 0.1 }));
  r.segments.forEach(s => { assert.equal(s.type, 'line'); near(s.curvature, 0); assert.equal(s.radius, null); });
  for (let i = 0; i < 2; i++) assert.ok(Math.abs(r.segments[i].thetaEndRad - r.segments[i + 1].thetaStartRad) < 0.1 * Math.PI / 180);
  const exact = good(reconstruct(input([30.000000003, 30.000000002, 30.000000001, 30]), { epsilonDeg: 0 }));
  exact.segments.forEach(s => { assert.equal(s.type, 'arc'); assert.ok(s.radius > 0); });
  pointNear(exact.points.P1, { x: 10.5, y: 21 * Math.sqrt(3) / 2 }, 2e-9);
  good(reconstruct(input(), { epsilonDeg: 0 }));
});
test('T04-G: unequal lengths are d34,d23,d12 when building upward', () => {
  const value = input(); value.distances = { d12: 6, d23: 7, d34: 9 };
  const r = good(reconstruct(value));
  assert.deepEqual(r.segments.map(s => s.length), [9, 7, 6]);
  pointNear(r.points.P3, { x: 0, y: 9 }); pointNear(r.points.P2, { x: 0, y: 16 }); pointNear(r.points.P1, { x: 0, y: 22 });
  const curved = good(reconstruct({ ...value, pitchDeg: input(fixtures.cShape).pitchDeg }));
  curved.segments.forEach((s, i) => near(s.radius, [9, 7, 6][i] / (Math.PI / 18)));
});
test('T04-H: every missing/invalid/disconnected sensor rejects the entire current curve', () => {
  for (const id of ids) for (const status of [undefined, null, false, 'INVALID', 'MISSING', 'DISCONNECTED', 'STALE']) {
    const value = input(); value.sensorStatus[id] = status; bad(value, 'INVALID_SENSOR_FRAME');
  }
  bad({ ...input(), sensorStatus: undefined }, 'INVALID_SENSOR_FRAME');
  good(reconstruct(input())); bad({ ...input(), frameValid: false }, 'INVALID_SENSOR_FRAME');
});
test('T04-I: missing, nonnumeric, nonfinite, zero or negative distances rejected', () => {
  for (const key of ['d12', 'd23', 'd34']) for (const distance of [undefined, null, '7', 0, -1, NaN, Infinity, -Infinity]) {
    const value = input(); value.distances[key] = distance; bad(value, 'INVALID_DISTANCE');
  }
  bad({ ...input(), distances: undefined }, 'INVALID_DISTANCE');
});
test('T04-J: +/-180 wrap follows F01 shortest signed convention in both directions', () => {
  const r = good(reconstruct(input([-175, -177, -179, 179])));
  assert.deepEqual(r.relativeAnglesDeg, { q12: 2, q23: 2, q34: 2 });
  r.segments.forEach(s => near(s.radius, 7 / (2 * Math.PI / 180)));
  const reverse = good(reconstruct(input([175, 177, 179, -179])));
  reverse.segments.forEach(s => assert.ok(s.curvature < 0));
  assert.equal(wrapDegrees(358), -2); assert.equal(wrapDegrees(-358), 2); assert.equal(wrapDegrees(180), -180);
});
test('T04-K: analytic tangents, circle radii, samples, lengths and continuity', () => {
  const value = input(fixtures.reference); value.distances = { d12: 6.12345, d23: 7.23456, d34: 9.34567 };
  const r = good(reconstruct(value, { samplesPerSegment: 101 }));
  near(r.totalLength, 22.70368);
  for (let i = 0; i < 3; i++) {
    const s = r.segments[i];
    near(s.radius * Math.abs(s.deltaDeg) * Math.PI / 180, s.length);
    near(s.curvature * s.length, s.thetaEndRad - s.thetaStartRad);
    for (const p of s.polyline) near(Math.hypot(p.x - s.center.x, p.y - s.center.y), s.radius);
    // Tangent reconstructed from the circle's radius vector, independently of stored angles.
    const sign = Math.sign(s.curvature);
    for (const [p, theta] of [[s.start, s.thetaStartRad], [s.end, s.thetaEndRad]]) {
      near(sign * (p.y - s.center.y) / s.radius, Math.sin(theta));
      near(sign * (s.center.x - p.x) / s.radius, Math.cos(theta));
    }
    if (i < 2) { pointNear(s.end, r.segments[i + 1].start); near(Math.sin(s.thetaEndRad), Math.sin(r.segments[i + 1].thetaStartRad)); near(Math.cos(s.thetaEndRad), Math.cos(r.segments[i + 1].thetaStartRad)); }
    const chordSum = s.polyline.slice(1).reduce((sum, p, j) => sum + Math.hypot(p.x - s.polyline[j].x, p.y - s.polyline[j].y), 0);
    assert.ok(chordSum <= s.length + 1e-10); near(chordSum, s.length, 2e-5);
  }
  assert.equal(r.curvePoints.length, 301);
  for (const id of ['P3', 'P2']) assert.equal(r.curvePoints.filter(p => p === r.points[id]).length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(r)), r);
});
test('missing/malformed pitches and out-of-range absolute angles never become zero', () => {
  for (const id of ids) for (const pitch of [undefined, null, '0', NaN, Infinity, -Infinity, 181, -181]) {
    const value = input(); value.pitchDeg[id] = pitch; bad(value, 'INVALID_PITCH');
  }
  bad({ ...input(), pitchDeg: undefined }, 'INVALID_PITCH');
});
test('frame validity and synchronization are required; contradictory timestamp evidence rejects', () => {
  for (const missing of [undefined, false, null, 1, 'true']) {
    bad({ ...input(), frameValid: missing }, 'INVALID_SENSOR_FRAME');
    bad({ ...input(), synchronized: missing }, 'UNSYNCHRONIZED_FRAME');
  }
  const timing = { sensorTimestampsUs: { P1: 100, P2: 102, P3: 104, P4: 106 }, maxSkewUs: 6 };
  good(reconstruct({ ...input(), ...timing }));
  bad({ ...input(), ...timing, maxSkewUs: 5 }, 'UNSYNCHRONIZED_FRAME');
  bad({ ...input(), maxSkewUs: 5 }, 'UNSYNCHRONIZED_FRAME');
  bad({ ...input(), ...timing, sensorTimestampsUs: { ...timing.sensorTimestampsUs, P1: NaN } }, 'UNSYNCHRONIZED_FRAME');
});
test('units scale coordinates/radii and invert curvature consistently', () => {
  const cm = input(fixtures.reference), mm = { ...cm, unit: 'mm', distances: { d12: 70, d23: 70, d34: 70 } };
  const a = good(reconstruct(cm)), b = good(reconstruct(mm));
  ids.forEach(id => pointNear(b.points[id], { x: 10 * a.points[id].x, y: 10 * a.points[id].y }));
  a.segments.forEach((s, i) => { near(b.segments[i].curvature, s.curvature / 10); near(b.segments[i].radius, 10 * s.radius); });
  bad({ ...cm, unit: undefined }, 'INVALID_UNIT'); bad({ ...cm, unit: 'm' }, 'INVALID_UNIT');
});
test('domain limits and malformed options return errors without throwing', () => {
  bad(input([120, 0, 0, 0]), 'UNSUPPORTED_ANGLE_CHANGE');
  good(reconstruct(input([120, 0, 0, 0]), { maxAngleChangeDeg: 150 }));
  bad(input([180, 0, 0, 0]), 'UNSUPPORTED_ANGLE_CHANGE', { maxAngleChangeDeg: 179 });
  for (const options of [null, [], 2, { epsilonDeg: -1 }, { epsilonDeg: NaN }, { epsilonDeg: 91 }, { maxAngleChangeDeg: 180 }, { samplesPerSegment: 1 }, { samplesPerSegment: 2.5 }, { samplesPerSegment: 10001 }]) bad(input(), 'INVALID_OPTIONS', options);
  for (const value of [null, [], 42, 'frame', true]) bad(value, 'INVALID_SENSOR_FRAME');
});
test('epsilon boundary, minimum sampling and unrounded published fixture', () => {
  const r = good(reconstruct(input([0.9, 0.6, 0.3, 0]), { epsilonDeg: 0.29, samplesPerSegment: 2 }));
  r.segments.forEach(s => assert.equal(s.type, 'arc')); assert.equal(r.curvePoints.length, 4);
  const ref = good(reconstruct(input(fixtures.reference)));
  assert.deepEqual(ref.relativeAnglesDeg, { q12: 10, q23: 10, q34: 7 });
  pointNear(ref.points.P1, { x: 6.2519, y: 19.8336 }, 0.0001);
});
test('numerical overflow is an error, never NaN/Infinity in JSON', () => {
  bad({ ...input(), distances: { d12: 1e308, d23: 1e308, d34: 1e308 } }, 'NUMERICAL_OVERFLOW');
  bad({ ...input(fixtures.cShape), distances: { d12: Number.MIN_VALUE, d23: 7, d34: 7 } }, 'NUMERICAL_OVERFLOW');
});
test('function is deterministic, does not mutate input/options and retains no old curve', () => {
  const value = input(fixtures.sShape), before = structuredClone(value), options = Object.freeze({ samplesPerSegment: 30 });
  const first = good(reconstruct(value, options)); assert.deepEqual(reconstruct(value, options), first); assert.deepEqual(value, before);
  bad({ ...value, frameValid: false }, 'INVALID_SENSOR_FRAME');
});
