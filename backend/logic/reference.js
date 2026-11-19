'use strict';
const { wrapDegrees } = require('../../shared/geometry/spine2d');

const METRIC = 'upper_reference_deviation';
const POSTURES = ['seated', 'standing'];
const MAX_SAMPLE_GAP_US = 250000;
const STABILITY_WINDOW_US = 5000000;
const MAX_SPREAD_DEG = 2;

function relativeAngles(pitch) {
  return pitch.slice(0, 3).map((value, i) => Number.isFinite(value) && Number.isFinite(pitch[i + 1])
    ? wrapDegrees(value - pitch[i + 1]) : null);
}

function completeFrame(frame) {
  return Array.isArray(frame?.pitch_deg) && frame.pitch_deg.length === 4 &&
    Array.isArray(frame.sensor_quality) && frame.sensor_quality.length === 4 &&
    frame.pitch_deg.every(value => Number.isFinite(value) && value >= -180 && value < 180) &&
    frame.sensor_quality.every(value => value === 'OK');
}

function angleMean(sin, cos, weight) {
  if (!weight || Math.hypot(sin, cos) / weight < 1e-9) return null;
  return wrapDegrees(Math.atan2(sin, cos) * 180 / Math.PI);
}

function referenceMatches(snapshot) {
  const reference = snapshot.reference;
  return !!reference &&
    reference.reference_rev === snapshot.reference_rev &&
    (reference.calibration_rev == null || reference.calibration_rev === snapshot.calibration_rev) &&
    (reference.geometry_rev == null || reference.geometry_rev === snapshot.geometry_rev);
}

function evaluateFrame(frame, snapshot, mode) {
  const measurement_valid = completeFrame(frame);
  const metric_valid = measurement_valid && mode === 'reference' && referenceMatches(snapshot);
  return {
    measurement_valid,
    metric_valid,
    deviation: metric_valid ? { metric: METRIC, value_deg: Math.abs(wrapDegrees(frame.pitch_deg[0] - snapshot.reference.pitch_deg[0])) } : null
  };
}

class ReferenceCapture {
  constructor({ windowUs = STABILITY_WINDOW_US, maxSpread = MAX_SPREAD_DEG, maxGapUs = MAX_SAMPLE_GAP_US } = {}) {
    this.windowUs = windowUs;
    this.maxSpread = maxSpread;
    this.maxGapUs = maxGapUs;
    this.frames = [];
    this.progress = { status: 'waiting', stable_ms: 0, required_ms: Math.ceil(windowUs / 1000) };
  }
  add(frame) {
    const now = frame.t_mono_us;
    if (!Number.isSafeInteger(now) || now < 0 || now <= this.lastUs) return null;
    this.lastUs = now;
    const last = this.frames.at(-1);
    const complete = completeFrame(frame);
    if (!complete || (last && now - last.t_mono_us > this.maxGapUs)) this.frames = [];
    if (!complete) return this.update('invalid', 0);

    this.frames.push(frame);
    const first = this.frames[0];
    const offsets = first.pitch_deg.map((pitch, channel) => this.frames.map(sample => wrapDegrees(sample.pitch_deg[channel] - pitch)));
    if (offsets.some(values => Math.max(...values) - Math.min(...values) > this.maxSpread)) {
      this.frames = [frame];
      return this.update('unstable', 0);
    }
    const stableUs = now - first.t_mono_us;
    if (stableUs < this.windowUs) return this.update('stabilizing', stableUs);
    this.update('ready', stableUs);
    return first.pitch_deg.map((_, channel) => {
      const radians = this.frames.map(sample => sample.pitch_deg[channel] * Math.PI / 180);
      return angleMean(radians.reduce((sum, angle) => sum + Math.sin(angle), 0),
        radians.reduce((sum, angle) => sum + Math.cos(angle), 0), radians.length);
    });
  }
  update(status, stableUs) {
    this.progress = { ...this.progress, status, stable_ms: Math.min(this.progress.required_ms, Math.floor(stableUs / 1000)) };
    return null;
  }
}

module.exports = { METRIC, POSTURES, MAX_SAMPLE_GAP_US, STABILITY_WINDOW_US, MAX_SPREAD_DEG,
  relativeAngles, completeFrame, referenceMatches, evaluateFrame, angleMean, ReferenceCapture };
