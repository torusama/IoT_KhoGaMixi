'use strict';
const { angleMean, evaluateFrame, MAX_SAMPLE_GAP_US, METRIC } = require('./reference');

const EVENT_THRESHOLD_DEG = 15;

class SessionStats {
  constructor({ startUs, mode, snapshot, thresholdDeg = EVENT_THRESHOLD_DEG, maxGapUs = MAX_SAMPLE_GAP_US }) {
    Object.assign(this, { startUs, mode, snapshot, thresholdDeg, maxGapUs });
    this.endUs = startUs;
    this.previous = null;
    this.measurementMs = 0;
    this.metricMs = 0;
    this.aboveMs = 0;
    this.histogram = Array(6).fill(0);
    this.totals = Array.from({ length: 7 }, () => ({ sin: 0, cos: 0, min: Infinity, max: -Infinity }));
    this.eventCount = 0;
    this.nextEvent = 0;
    this.posture = null;
    this.gap = null;
    this.updates = [];
  }
  ms(atUs) { return Math.floor((atUs - this.startUs) / 1000); }
  record(frame) {
    const now = frame.t_mono_us;
    if (now < this.endUs || (this.previous && now === this.endUs)) return null;
    const values = evaluateFrame(frame, this.snapshot, this.mode);
    const previous = this.previous;
    if (previous) {
      const before = previous.frame.t_mono_us;
      if (previous.values.measurement_valid && values.measurement_valid && now - before <= this.maxGapUs) {
        this.close('gap', before, 'recovered');
        this.accumulate(previous, frame, this.ms(now) - this.ms(before));
      } else {
        this.close('posture', before, 'data_gap');
        if (!this.gap) this.open('gap', before);
      }
    } else if (now - this.startUs > this.maxGapUs) {
      this.open('gap', this.startUs);
    }
    const value = values.deviation?.value_deg;
    if (value >= this.thresholdDeg) {
      if (!this.posture) this.open('posture', now, value);
      this.posture.peak_deg = Math.max(this.posture.peak_deg, value);
    } else {
      this.close('posture', now, 'below_threshold');
    }
    this.endUs = now;
    this.previous = { frame, values };
    return values;
  }
  accumulate({ frame, values }, next, dt) {
    if (!dt) return;
    this.measurementMs += dt;
    const endAngles = [...next.pitch_deg, ...next.relative_deg];
    [...frame.pitch_deg, ...frame.relative_deg].forEach((value, index) => {
      const total = this.totals[index], radians = value * Math.PI / 180;
      total.sin += Math.sin(radians) * dt;
      total.cos += Math.cos(radians) * dt;
      total.min = Math.min(total.min, value, endAngles[index]);
      total.max = Math.max(total.max, value, endAngles[index]);
    });
    if (!values.metric_valid) return;
    this.metricMs += dt;
    const value = values.deviation.value_deg;
    this.histogram[Math.min(5, Math.floor(value / 5))] += dt;
    if (value >= this.thresholdDeg) {
      this.aboveMs += dt;
      this.posture.duration_ms += dt;
    }
  }
  open(kind, timeUs, peak = 0) {
    const event = { number: ++this.nextEvent, event_seq: 1, type: kind === 'gap' ? 'data_gap' : kind,
      metric: kind === 'gap' ? 'measurement_quality' : METRIC, started_at_mono_us: timeUs, ended_at_mono_us: null,
      duration_ms: 0, peak_deg: peak, vibrated: false, notification_requested: false };
    if (kind === 'posture') {
      this.eventCount++;
      Object.assign(event, { threshold_deg: this.thresholdDeg, reference_rev: this.snapshot.reference_rev });
    }
    this[kind] = event;
    this.updates.push({ ...event });
  }
  close(kind, timeUs, endedReason) {
    const event = this[kind];
    if (!event) return;
    if (kind === 'gap') event.duration_ms = this.ms(timeUs) - this.ms(event.started_at_mono_us);
    this.updates.push({ ...event, event_seq: 2, ended_at_mono_us: timeUs, ended_reason: endedReason });
    this[kind] = null;
  }
  drainEvents() { return this.updates.splice(0); }
  finish(stopUs) {
    this.close('posture', this.endUs, 'session_stop');
    if (!this.gap && stopUs - this.endUs > this.maxGapUs) this.open('gap', this.endUs);
    this.close('gap', stopUs, 'session_stop');
    this.endUs = Math.max(this.endUs, stopUs);
  }
  summary() {
    const elapsed_ms = this.ms(this.endUs);
    const angles = this.totals.map(({ sin, cos, min, max }) => ({
      mean_deg: angleMean(sin, cos, this.measurementMs),
      min_deg: this.measurementMs ? min : null,
      max_deg: this.measurementMs ? max : null,
      sin_ms: sin, cos_ms: cos
    }));
    return {
      coverage_start_mono_us: this.startUs,
      coverage_end_mono_us: this.endUs,
      elapsed_ms,
      valid_measurement_ms: this.measurementMs,
      valid_metric_ms: this.metricMs,
      invalid_ms: elapsed_ms - this.measurementMs,
      histogram_ms: [...this.histogram],
      angle_stats: { pitch: angles.slice(0, 4), relative: angles.slice(4) },
      deviation_stats: this.mode === 'reference' ? {
        metric: METRIC, reference_rev: this.snapshot.reference_rev, threshold_deg: this.thresholdDeg,
        above_threshold_ms: this.aboveMs, posture_event_count: this.eventCount
      } : null
    };
  }
}

module.exports = { SessionStats, EVENT_THRESHOLD_DEG };
