'use strict';
const { randomUUID } = require('node:crypto');

const COMMANDS = {
  START_SESSION: ['START', (payload, state) => ({ mode: payload.mode ?? (state.referenceReady ? 'reference' : 'measurement_only') })],
  STOP_SESSION: ['STOP', (_payload, state) => ({ session_id: state.sessionId })],
  SAVE_REFERENCE: ['SET_REFERENCE', payload => ({ guided_confirmation: payload.guided_confirmation === true, posture: payload.posture })],
  SET_REMINDER: ['SET_REMINDER', payload => ({ enabled: payload.enabled })],
  TEST_VIBRATION: ['TEST_VIBRATION', () => ({ duration_ms: 200 })]
};
const LABELS = { pending: 'Đang chờ xác nhận', running: 'Đang đo', stopped: 'Đã kết thúc', rejected: 'Bị từ chối', interrupted: 'Bị gián đoạn' };
const REASONS = {
  REFERENCE_UNSTABLE: 'Chưa đủ thời gian ổn định. Giữ yên tư thế rồi thử lại.',
  SENSOR_INVALID: 'Chưa nhận đủ dữ liệu hợp lệ từ bốn cảm biến.',
  REFERENCE_REQUIRED: 'Hãy lưu mốc cá nhân trước.',
  REFERENCE_STALE: 'Cấu hình hiệu chuẩn đã đổi. Hãy lấy lại mốc.',
  REFERENCE_STORAGE_FAILED: 'Thiết bị chưa lưu được mốc. Hãy thử lại.',
  GUIDANCE_REQUIRED: 'Hãy xác nhận đã thực hiện hướng dẫn lấy mốc.',
  MOUNTING_NOT_CONFIRMED: 'Hãy xác nhận cách lắp cảm biến trước khi lấy mốc.',
  DEVICE_OFFLINE: 'Thiết bị chưa kết nối.',
  COMMAND_PENDING: 'Thiết bị đang xử lý một lệnh khác.',
  DEVICE_REBOOT: 'Thiết bị đã khởi động lại.'
};
function referenceView(reference, deviceId) {
  return reference && {
    ...reference, deviceId, pitch: reference.pitch_deg, relative: reference.relative_deg,
    timestamp: reference.captured_at_unix_ms ?? reference.received_at_ms
  };
}

function sessionView(meta, summary) {
  return {
    id: meta.session_id, started: meta.started_at_ms ?? meta.created_at_ms, ended: meta.ended_at_ms,
    elapsedMs: summary?.elapsed_ms, validMs: summary?.valid_measurement_ms, invalidMs: summary?.invalid_ms,
    histogram: summary?.histogram_ms, angleStats: summary?.angle_stats, deviationStats: summary?.deviation_stats,
    validMetricMs: summary?.valid_metric_ms, events: summary?.deviation_stats?.posture_event_count,
    status: LABELS[meta.status] || meta.status, saved: meta.storage_status === 'saved', simulated: meta.simulated === true || summary?.simulated === true
  };
}

function keyframe(frame, started, startUs) {
  return {
    seq: frame.sample_seq, mono: frame.t_mono_us,
    t: frame.ts_unix_ms ?? (started + (frame.t_mono_us - startUs) / 1000),
    pitch: frame.pitch_deg, relative: frame.relative_deg, gapBefore: frame.sample_gap_before === true
  };
}

class BackendDashboard {
  constructor({ api, deviceId }) {
    this.api = api;
    this.tail = Promise.resolve();
    this.state = { mode: 'connected', deviceId, connection: 'offline', session: 'idle', samples: [], history: [],
      historyDetails: {}, references: [], distances: [], pending: null };
  }
  handle(input = {}) {
    if (input.kind === 'tick' && this.polling) return this.polling;
    const work = this.tail.then(async () => {
      const state = this.state;
      try {
        if (input.kind === 'tick') await this.poll();
        if (input.kind === 'command') { await this.submit(input); await this.poll(); }
        if (input.kind === 'historyRefresh') {
          await this.loadHistory();
          if (state.history.some(session => session.id === input.id)) await this.loadDetail(input.id);
        }
        if (input.kind === 'historyMore' && state.historyCursor) await this.loadHistory(state.historyCursor);
        if (input.kind === 'historyDetail' && state.history.some(session => session.id === input.id)) await this.loadDetail(input.id, input.more);
        if (input.kind === 'referenceMore' && state.referenceCursor) await this.loadReferences(state.referenceCursor);
      } catch (error) {
        if (input.kind === 'tick' || !error.status) {
          Object.assign(state, { connection: 'offline', valid: false, curveReady: false, pitch: null, relative: null, deviation: null, sensorStatus: [] });
          this.connectionError = true;
        }
        state.error = REASONS[error.code] || (error.status ? error.message : 'Không nhận được phản hồi từ backend.');
      }
      return structuredClone(state);
    });
    this.tail = work.catch(() => {});
    if (input.kind === 'tick') {
      this.polling = work;
      work.then(() => { this.polling = null; }, () => { this.polling = null; });
    }
    return work;
  }
  async submit(input) {
    const state = this.state;
    if (state.pending || state.connection !== 'online' || !Object.hasOwn(COMMANDS, input.command)) return;
    const [command, fields] = COMMANDS[input.command];
    const request = { id: randomUUID(), command, fields: fields(input.payload ?? {}, state) };
    this.request = request;
    Object.assign(state, { pending: { id: request.id, status: 'pending' }, error: '', notice: '' });
    try { await this.api.send(state.deviceId, request.command, request.fields, request.id); }
    catch (error) {
      if (error.status && error.status < 500) {
        this.request = null;
        state.pending = null;
        throw error;
      }
    }
  }
  async resolveCommand(id) {
    let command;
    try { command = await this.api.command(id); }
    catch (error) {
      if (error.status !== 404 || this.request?.id !== id) throw error;
      const { command: name, fields } = this.request;
      try { command = await this.api.send(this.state.deviceId, name, fields, id); }
      catch (retryError) {
        if (!retryError.status || retryError.status >= 500) throw retryError;
        command = { status: 'rejected', payload: { command: name }, result: { reason: retryError.code } };
      }
    }
    return command;
  }
  async poll() {
    const state = this.state;
    const device = await this.api.device(state.deviceId).catch(error => {
      if (error.status !== 404) throw error;
      return { connection: 'offline' };
    });
    if (this.connectionError) {
      state.error = '';
      this.connectionError = false;
    }
    const wire = device.state;
    const config = wire?.config;
    const remoteCommandId = this.request?.id ?? device.pending_command_id ?? state.pending?.id;
    state.pending = remoteCommandId ? { id: remoteCommandId, status: 'pending' } : null;
    if (remoteCommandId) {
      const command = await this.resolveCommand(remoteCommandId);
      if (['applied', 'rejected', 'cancelled'].includes(command.status)) {
        state.pending = null;
        this.request = null;
        state.error = command.status === 'applied' ? '' : REASONS[command.result?.reason] || command.result?.reason || 'Lệnh chưa thực hiện được.';
        state.notice = command.status === 'applied' && command.payload.command === 'SET_REFERENCE' ? 'Đã lưu mốc cá nhân.' : '';
      } else {
        state.pending.status = command.status;
      }
    }
    const priorSessionId = state.sessionId;
    const session = wire?.state === 'RUNNING' ? 'active' : wire?.state === 'PREFLIGHT' || wire?.state === 'STOPPING' ? 'waiting' : 'idle';
    const online = device.connection === 'online';
    let frame = null;
    if (online && session === 'idle' && wire?.idle_sample && wire.t_mono_us - wire.idle_sample.t_mono_us <= 250000) frame = wire.idle_sample;
    if (online && session === 'active' && !device.telemetry_stale && device.telemetry?.session_id === wire.session_id) frame = device.telemetry;
    const reference = config?.reference;
    const sensorStatus = frame?.sensor_quality.map(quality => quality.toLowerCase()) ?? [];
    Object.assign(state, {
      connection: device.connection, session, sessionId: wire?.session_id ?? null, simulated: wire?.simulated === true,
      valid: sensorStatus.length === 4 && sensorStatus.every(quality => quality === 'ok'), sensorStatus,
      curveReady: session === 'idle' ? !!frame && wire.simulated === true : frame?.curve_valid === true,
      pitch: frame?.pitch_deg ?? null, relative: frame?.relative_deg ?? null, deviation: frame?.metric_valid ? frame.deviation : null,
      updated: frame?.received_at_ms ?? device.last_state_at_ms, distances: config?.distances_mm ?? [],
      mountingConfirmed: config?.mounting_confirmed === true,
      reference: referenceView(reference ?? null, state.deviceId), referenceCapture: online ? wire?.reference_capture : null,
      referenceReady: !!reference && (reference.calibration_rev == null || reference.calibration_rev === config.calibration_rev) &&
        (reference.geometry_rev == null || reference.geometry_rev === config.geometry_rev),
      reminder: wire?.reminder_enabled === true
    });
    if (priorSessionId !== state.sessionId) { state.samples = []; state.validMs = 0; state.frameSeq = null; }
    if (session === 'active') {
      const detail = await this.api.session(state.sessionId);
      state.started = detail.meta.started_at_ms ?? detail.meta.created_at_ms;
      state.validMs = detail.summary?.valid_measurement_ms ?? 0;
      if (frame && frame.sample_seq !== state.frameSeq) {
        const entry = keyframe(frame, state.started, detail.meta.started_at_mono_us);
        if (entry.gapBefore) state.samples.push({ t: entry.t, pitch: null, relative: null });
        state.samples.push(entry);
        state.frameSeq = frame.sample_seq;
      } else if (!frame && state.samples.at(-1)?.pitch) {
        state.samples.push({ t: Date.now(), pitch: null, relative: null });
      }
      state.samples = state.samples.slice(-120);
    } else if (priorSessionId && session === 'idle') {
      this.finishedSession = priorSessionId;
    }
    if (this.finishedSession || !this.historyLoaded) {
      await this.loadHistory();
      const finished = state.history.some(item => item.id === this.finishedSession);
      if (finished && state.historyDetails[this.finishedSession]) await this.loadDetail(this.finishedSession);
      if (state.history.some(item => item.id === this.finishedSession && (item.saved || ['Bị gián đoạn', 'Bị từ chối'].includes(item.status)))) this.finishedSession = null;
    }
    if (config && (!this.referencesLoaded || this.loadedReferenceRev !== config.reference_rev)) {
      await this.loadReferences();
      this.loadedReferenceRev = config.reference_rev;
    }
  }
  async loadHistory(before) {
    const state = this.state;
    const result = await this.api.sessions({ device_id: state.deviceId, before });
    const items = result.items.map(meta => sessionView(meta, meta.summary));
    state.history = before ? [...state.history, ...items] : items;
    state.historyCursor = result.next_cursor;
    this.historyLoaded = true;
  }
  async loadReferences(before) {
    const state = this.state;
    const result = await this.api.references(state.deviceId, { before });
    const items = result.items.map(reference => referenceView(reference, state.deviceId));
    state.references = before ? [...state.references, ...items] : items;
    state.referenceCursor = result.next_cursor;
    this.referencesLoaded = true;
  }
  async loadDetail(id, more) {
    const details = this.state.historyDetails;
    const previous = details[id];
    if (more && (!previous || !['samples', 'events'].includes(more) || !previous.cursors[more])) return;
    const [detail, samples, events] = await Promise.all([
      this.api.session(id),
      !more || more === 'samples' ? this.api.history(id, 'keyframes', { limit: 100, before: more ? previous.cursors.samples : undefined }) : null,
      !more || more === 'events' ? this.api.history(id, 'events', { limit: 100, before: more ? previous.cursors.events : undefined }) : null
    ]);
    const view = sessionView(detail.meta, detail.summary);
    const startUs = detail.meta.started_at_mono_us ?? detail.summary?.coverage_start_mono_us ?? 0;
    const eventTime = mono => mono == null ? null : view.started + (mono - startUs) / 1000;
    const config = detail.config_snapshot;
    const eventLog = events ? events.items.map(event => ({
      id: event.event_id, type: event.type, start: eventTime(event.started_at_mono_us),
      end: eventTime(event.ended_at_mono_us), durationMs: event.duration_ms, peak: event.type === 'data_gap' ? null : event.peak_deg,
      metric: { data_gap: 'Mất dữ liệu', posture: 'Vượt ngưỡng P1', reminder: 'Nhắc rung', prolonged: 'Lệch kéo dài' }[event.type],
      vibrated: event.vibrated, startMono: event.started_at_mono_us, endMono: event.ended_at_mono_us
    })) : [];
    const allEvents = events ? [...(more ? previous.eventLog : []), ...eventLog].sort((a,b) => b.start - a.start) : previous.eventLog;
    const allSamples = samples ? [...(more ? previous.samples : []), ...samples.items.map(frame => keyframe(frame, view.started, startUs))]
      .sort((a,b) => a.mono - b.mono) : previous.samples;
    if (Object.keys(details).length >= 3 && !previous) delete details[Object.keys(details)[0]];
    details[id] = { ...view, samples: allSamples, eventLog: allEvents, gaps: allEvents.filter(event => event.type === 'data_gap'),
      reference: referenceView(config?.reference ?? null, this.state.deviceId),
      conditions: config ? `${config.reference_rev ?? 'Chỉ đo'} · ${config.calibration_rev} · ${config.distances_mm.join(' / ')} mm` : '',
      cursors: { samples: samples ? samples.next_cursor : previous.cursors.samples, events: events ? events.next_cursor : previous.cursors.events } };
  }
}

function createBackendDashboard({ baseUrl, token, deviceId }) {
  const ready = import('../assets/js/posture-api.js').then(({ PostureApi }) => new BackendDashboard({
    deviceId,
    api: new PostureApi({ baseUrl, token, fetchImpl: (url, options) => fetch(url, { ...options, signal: AbortSignal.timeout(3000) }) })
  }));
  return { async handle(input) { return (await ready).handle(input); } };
}

module.exports = { BackendDashboard, createBackendDashboard };
