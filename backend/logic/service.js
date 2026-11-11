'use strict';
const { EventEmitter } = require('node:events');
const { randomUUID, createHash } = require('node:crypto');
const { assert, AppError } = require('./errors');
const { id, angle, integer, configSnapshot, validateMessage } = require('../integrations/mqtt/protocol');
const clone = value => structuredClone(value);
const terminal = status => ['applied', 'rejected', 'cancelled'].includes(status);
const key = prefix => `${prefix}_${Date.now()}_${randomUUID().replaceAll('-', '').slice(0, 16)}`;
const canonical = value => JSON.stringify(value, (_, v) => v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b))) : v);
const hash = value => createHash('sha256').update(canonical(value)).digest('hex');
const localDay = ms => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit' }).format(ms);

class PostureService extends EventEmitter {
  constructor({ store, transport, config, clock = Date.now }) {
    super(); this.store = store; this.transport = transport; this.config = config; this.now = clock;
    this.devices = new Map(); this.queues = new Map(); this.queueDepth = new Map(); this.liveSequence = 0;
    this.sessionCache = new Map();
    this.epoch = randomUUID(); this.stats = { received: 0, invalid: 0 }; this.lastStorageError = null;
  }
  async init() {
    const records = await this.store.get('devices') || {};
    for (const [deviceId, record] of Object.entries(records)) this.devices.set(deviceId, { ...record, fresh: false, telemetry: null, connection: 'offline' });
    return this;
  }
  serial(deviceId, action) {
    const depth = this.queueDepth.get(deviceId) || 0;
    if (depth >= 128) return Promise.reject(new AppError('DEVICE_BUSY', 'Device processing queue is full; retry same immutable message', 503));
    this.queueDepth.set(deviceId, depth + 1);
    const previous = this.queues.get(deviceId) || Promise.resolve();
    const work = previous.then(action);
    const settled = work.catch(() => {});
    this.queues.set(deviceId, settled);
    settled.then(() => {
      const remaining = (this.queueDepth.get(deviceId) || 1) - 1;
      if (remaining) this.queueDepth.set(deviceId, remaining); else this.queueDepth.delete(deviceId);
      if (this.queues.get(deviceId) === settled) this.queues.delete(deviceId);
    });
    return work;
  }
  emitLive(type, deviceId, data) { this.emit('realtime', { id: `${this.epoch}_${++this.liveSequence}`, type, device_id: deviceId, received_at_ms: this.now(), data: clone(data) }); }
  connection(record) {
    if (!this.transport.connected || !record?.fresh || record.state?.online === false) return 'offline';
    const age = this.now() - record.last_state_at_ms;
    return age > this.config.offlineMs ? 'offline' : age > this.config.staleMs ? 'stale' : 'online';
  }
  device(deviceId) {
    id(deviceId, 'device_id');
    const record = this.devices.get(deviceId);
    assert(record, 'DEVICE_NOT_FOUND', 'Device has not announced protocol v2 state', 404);
    const age = record.last_state_at_ms == null ? null : Math.max(0, this.now() - record.last_state_at_ms);
    return { device_id: deviceId, connection: this.connection(record), last_state_at_ms: record.last_state_at_ms ?? null,
      state_age_ms: age, state: record.state || null, pending_command_id: record.control?.pending_command_id || null,
      telemetry: record.telemetry || null, telemetry_stale: !record.telemetry || this.now() - record.telemetry.received_at_ms > this.config.staleMs };
  }
  listDevices() { return [...this.devices.keys()].map(deviceId => this.device(deviceId)); }
  async persist(updates) {
    try {
      await this.store.update(updates); this.lastStorageError = null;
      for (const key of Object.keys(updates)) if (key.startsWith('sessions/')) this.sessionCache.delete(key.split('/')[1]);
    }
    catch (error) { this.lastStorageError = 'STORAGE_UNAVAILABLE'; throw new AppError('STORAGE_UNAVAILABLE', 'Durable storage failed; no storage receipt issued', 503); }
  }
  async getSession(sessionId) {
    id(sessionId, 'session_id'); const session = await this.store.get(`sessions/${sessionId}`);
    assert(session, 'SESSION_NOT_FOUND', 'Unknown session', 404); return session;
  }
  async sessionInfo(sessionId) {
    id(sessionId, 'session_id');
    if (this.sessionCache.has(sessionId)) return clone(this.sessionCache.get(sessionId));
    const meta = await this.store.get(`sessions/${sessionId}/meta`);
    assert(meta, 'SESSION_NOT_FOUND', 'Unknown session', 404);
    const [config_snapshot, latest_summary, final] = await Promise.all(['config_snapshot', 'latest_summary', 'final'].map(field => this.store.get(`sessions/${sessionId}/${field}`)));
    const value = { meta, config_snapshot, latest_summary, final };
    if (this.sessionCache.size >= 256) this.sessionCache.delete(this.sessionCache.keys().next().value);
    this.sessionCache.set(sessionId, clone(value));
    return value;
  }
  async ownedSession(message) {
    const session = await this.sessionInfo(message.session_id);
    assert(session.meta.device_id === message.device_id && session.meta.boot_id === message.boot_id, 'SESSION_MISMATCH', 'Session belongs to another device or boot');
    return session;
  }
  referenceUpdates(deviceId, snapshot, time) {
    return snapshot.reference_rev === null ? {} : {
      [`references/${deviceId}/${snapshot.reference_rev}`]: { ...clone(snapshot.reference), device_id: deviceId, config_rev: snapshot.config_rev, received_at_ms: time }
    };
  }
  async ingest(topic, raw, { retained = false } = {}) {
    this.stats.received++;
    let parsed;
    try { parsed = validateMessage(topic, raw); }
    catch (error) { this.stats.invalid++; throw error; }
    const { type, message } = parsed;
    if (type === 'data' && (this.queueDepth.get(message.device_id) || 0) >= 4) return { type, device_id: message.device_id, ignored: 'TELEMETRY_BACKPRESSURE' };
    return this.serial(message.device_id, async () => {
      if (retained && type !== 'state') throw new AppError('RETAINED_FORBIDDEN', 'Only state may be retained');
      if (type === 'state') await this.onState(message, retained);
      else if (type === 'ack') await this.onAck(message);
      else if (type === 'data') await this.onData(message);
      else if (type === 'summary') await this.onSummary(message);
      else await this.onEvent(message);
      return { type, device_id: message.device_id };
    });
  }
  async onState(message, retained) {
    const deviceId = message.device_id;
    const record = this.devices.get(deviceId) || { state: null, fresh: false, control: {}, telemetry: null };
    const previous = record.state;
    if (message.online === false) {
      if (previous?.boot_id !== message.boot_id || retained) return;
      record.fresh = false; this.emitLive('connection', deviceId, { connection: 'offline' }); return;
    }
    if (retained && record.fresh) return;
    if (previous?.boot_id === message.boot_id && (message.state_seq < previous.state_seq || (record.fresh && message.state_seq === previous.state_seq))) return;
    const time = this.now();
    if (message.state === 'RUNNING' && !retained) {
      const meta = await this.store.get(`sessions/${message.session_id}/meta`);
      if (meta) {
        const session = await this.ownedSession(message);
        for (const rev of ['config_rev', 'geometry_rev', 'calibration_rev', 'reference_rev', 'algorithm_version']) {
          assert(message.config[rev] === session.config_snapshot[rev], 'CONFIG_MISMATCH', 'RUNNING state changed a frozen session revision');
        }
      }
    }
    if (!retained && previous && previous.boot_id !== message.boot_id) {
      const sessionId = previous.session_id;
      if (sessionId) {
        const session = await this.store.get(`sessions/${sessionId}`);
        if (session && !['stopped', 'rejected'].includes(session.meta.status)) {
          session.meta.status = 'interrupted'; session.meta.interruption_reason = 'DEVICE_REBOOT';
          await this.persist({ [`sessions/${sessionId}/meta`]: session.meta });
          this.emitLive('session', deviceId, session.meta);
        }
      }
      record.telemetry = null;
      if (record.control?.pending_command_id) {
        const command = await this.store.get(`commands/${record.control.pending_command_id}`);
        if (command && !terminal(command.status)) {
          const updates = {};
          if (command.payload.command === 'START') {
            updates[`sessions/${command.payload.session_id}/meta/status`] = 'interrupted';
            updates[`sessions/${command.payload.session_id}/meta/interruption_reason`] = 'DEVICE_REBOOT';
          }
          await this.finishCommand(record, command, 'cancelled', { reason: 'DEVICE_REBOOT' }, updates);
        }
      }
    }
    const next = { ...record, state: clone(message), last_state_at_ms: time, fresh: !retained, connection: retained ? 'offline' : 'online' };
    const updates = { [`devices/${deviceId}/state`]: message, [`devices/${deviceId}/last_state_at_ms`]: time, ...this.referenceUpdates(deviceId, message.config, time) };
    await this.persist(updates);
    this.devices.set(deviceId, next);
    if (!retained) {
      const pendingId = next.control?.pending_command_id;
      const command = pendingId ? await this.store.get(`commands/${pendingId}`) : null;
      if (command && command.payload.target_boot_id === message.boot_id && !terminal(command.status)) {
        const kind = command.payload.command;
        const startApplied = kind === 'START' && message.state === 'RUNNING' && message.session_id === command.payload.session_id;
        const stopApplied = kind === 'STOP' && message.state === 'IDLE' && (message.last_command_id === command.command_id || message.last_closed_session_id === command.payload.session_id);
        const referenceApplied = kind === 'SET_REFERENCE' && message.last_command_id === command.command_id && message.config.reference_rev === command.payload.reference_rev;
        if (startApplied || stopApplied || referenceApplied) await this.applyCommand(next, command, { ...message, command_id: command.command_id, session_id: command.payload.session_id ?? null, status: 'applied' });
      }
    }
    this.emitLive('state', deviceId, this.device(deviceId));
  }
  async command(deviceId, request) {
    id(deviceId, 'device_id');
    return this.serial(deviceId, async () => {
      assert(request && typeof request === 'object', 'INVALID_COMMAND', 'Expected command object');
      const commandId = request.command_id ? id(request.command_id, 'command_id') : key('cmd');
      const requestHash = hash({ ...request, command_id: commandId });
      const existing = await this.store.get(`commands/${commandId}`);
      if (existing) {
        assert(existing.device_id === deviceId && existing.request_hash === requestHash, 'COMMAND_CONFLICT', 'Command ID already used with different content', 409);
        const cached = this.devices.get(deviceId);
        if (cached) cached.control = await this.store.get(`devices/${deviceId}/control`) || {};
        return existing;
      }
      const record = this.devices.get(deviceId);
      assert(record && this.connection(record) === 'online', 'DEVICE_OFFLINE', 'A fresh non-retained heartbeat is required', 409);
      record.control = await this.store.get(`devices/${deviceId}/control`) || {};
      assert(!record.control?.pending_command_id, 'COMMAND_PENDING', 'Resolve the pending command before sending another', 409);
      const state = record.state; const snapshot = configSnapshot(state.config); const time = this.now();
      const payload = { schema_version: 2, device_id: deviceId, command_id: commandId, command: request.command,
        target_boot_id: state.boot_id, expected_config_rev: snapshot.config_rev,
        not_after_mono_us: state.t_mono_us + Math.max(0, time - record.last_state_at_ms) * 1000 + this.config.commandTimeoutMs * 1000 };
      const updates = {};
      if (request.command === 'START') {
        assert(state.state === 'IDLE', 'SESSION_CONFLICT', 'Device is not IDLE', 409);
        assert(snapshot.mounting_confirmed, 'MOUNTING_NOT_CONFIRMED', 'Confirm mounting on the device before START', 409);
        assert(['measurement_only', 'reference'].includes(request.mode || 'measurement_only'), 'INVALID_COMMAND', 'Invalid mode');
        assert(request.mode !== 'reference' || snapshot.reference_rev !== null, 'REFERENCE_REQUIRED', 'Set a guided reference first', 409);
        const sessionId = key('ses');
        Object.assign(payload, { session_id: sessionId, mode: request.mode || 'measurement_only', preflight_timeout_ms: 5000 });
        const meta = { session_id: sessionId, device_id: deviceId, boot_id: state.boot_id, status: 'pending', mode: payload.mode,
          command_id: commandId, created_at_ms: time, started_at_ms: null, ended_at_ms: null,
          storage_driver: this.store.kind, storage_status: 'awaiting_final', cloud_status: this.store.kind === 'firebase' ? 'awaiting_final' : 'not_configured' };
        updates[`sessions/${sessionId}/meta`] = meta;
        updates[`sessions/${sessionId}/config_snapshot`] = clone(snapshot);
        updates[`session_index/${sessionId}`] = true;
        updates[`device_sessions/${deviceId}/${sessionId}`] = true;
      } else if (request.command === 'STOP') {
        id(request.session_id, 'session_id');
        assert(state.state === 'RUNNING' && state.session_id === request.session_id, 'SESSION_MISMATCH', 'STOP must target the running session', 409);
        payload.session_id = request.session_id;
      } else if (request.command === 'SET_REFERENCE') {
        assert(state.state === 'IDLE', 'SESSION_LOCKED', 'Reference can only change in IDLE', 409);
        assert(request.guided_confirmation === true, 'GUIDANCE_REQUIRED', 'Confirm the guided reference procedure');
        payload.reference_rev = key('ref'); payload.capture = 'current_stable';
      } else if (request.command === 'SET_REMINDER') {
        assert(typeof request.enabled === 'boolean', 'INVALID_COMMAND', 'enabled must be boolean');
        assert(!request.enabled || snapshot.reference_rev !== null, 'REFERENCE_REQUIRED', 'Reminder requires a reference', 409);
        payload.enabled = request.enabled;
      } else if (request.command === 'TEST_VIBRATION') {
        integer(request.duration_ms, 'duration_ms', 20);
        assert(request.duration_ms <= 1000, 'INVALID_COMMAND', 'Test duration must be 20–1000 ms');
        payload.duration_ms = request.duration_ms;
      } else if (request.command === 'CONFIG') {
        integer(request.publish_interval_ms, 'publish_interval_ms', 50);
        assert(request.publish_interval_ms <= 5000, 'INVALID_COMMAND', 'Publish interval must be 50–5000 ms');
        payload.publish_interval_ms = request.publish_interval_ms;
      } else throw new AppError('UNKNOWN_COMMAND', 'Unsupported command');
      const command = { command_id: commandId, device_id: deviceId, request_hash: requestHash, payload,
        status: 'pending', created_at_ms: time, expires_at_ms: time + this.config.commandTimeoutMs, attempts: 0, last_attempt_at_ms: null };
      const control = { pending_command_id: commandId };
      Object.assign(updates, { [`commands/${commandId}`]: command, [`devices/${deviceId}/control`]: control });
      await this.persist(updates);
      record.control = control;
      await this.sendCommand(command);
      this.emitLive('command', deviceId, command);
      return command;
    });
  }
  async sendCommand(command) {
    command.attempts++; command.last_attempt_at_ms = this.now();
    await this.persist({ [`commands/${command.command_id}`]: command });
    try { await this.transport.publish(`posture/${command.device_id}/cmd`, command.payload); }
    catch { /* Durable pending remains; maintenance retries the same ID, never a new session. */ }
  }
  async finishCommand(record, command, status, result, updates = {}) {
    const next = { ...command, status, result, resolved_at_ms: this.now() };
    const control = { pending_command_id: null };
    await this.persist({ ...updates, [`commands/${command.command_id}`]: next, [`devices/${command.device_id}/control`]: control });
    record.control = control; this.emitLive('command', command.device_id, next);
    return next;
  }
  async onAck(message) {
    const command = await this.store.get(`commands/${message.command_id}`);
    assert(command && command.device_id === message.device_id && command.payload.target_boot_id === message.boot_id, 'ACK_MISMATCH', 'Unknown command or wrong boot');
    const record = this.devices.get(message.device_id);
    assert(record && record.state.boot_id === message.boot_id, 'BOOT_MISMATCH', 'ACK does not match current boot');
    if (terminal(command.status)) return;
    assert(record.control?.pending_command_id === command.command_id, 'ACK_MISMATCH', 'ACK is not for the pending command');
    if (command.payload.session_id) assert(command.payload.session_id === message.session_id, 'ACK_MISMATCH', 'ACK session differs from command');
    if (message.status === 'accepted') {
      command.status = 'accepted'; command.ack = message;
      await this.persist({ [`commands/${command.command_id}`]: command });
      this.emitLive('command', message.device_id, command);
    } else if (message.status === 'rejected') {
      if (command.payload.command === 'START') await this.persist({ [`sessions/${command.payload.session_id}/meta/status`]: 'rejected', [`sessions/${command.payload.session_id}/meta/rejection_reason`]: message.reason });
      await this.finishCommand(record, command, 'rejected', message);
    } else await this.applyCommand(record, command, message);
  }
  async applyCommand(record, command, message) {
    const payload = command.payload; const updates = {}; const time = this.now();
    if (payload.command === 'START') {
      assert(message.state === 'RUNNING', 'ACK_MISMATCH', 'START applied must report RUNNING');
      const session = await this.ownedSession({ ...message, session_id: payload.session_id });
      const startMono = message.started_at_mono_us ?? message.t_mono_us;
      const started = message.started_at_unix_ms ?? (message.ts_unix_ms == null ? time : message.ts_unix_ms - (message.t_mono_us - startMono) / 1000);
      session.meta = { ...session.meta, status: session.meta.status === 'stopped' ? 'stopped' : 'running', started_at_ms: started, started_at_mono_us: startMono,
        report_day: localDay(started), time_quality: message.ts_unix_ms == null ? 'received_estimate' : 'device_utc' };
      updates[`sessions/${payload.session_id}/meta`] = session.meta;
      updates[`session_days/${session.meta.report_day}/${payload.session_id}`] = true;
    } else if (payload.command === 'STOP') {
      assert(message.state === 'IDLE', 'ACK_MISMATCH', 'STOP applied must report IDLE');
      const session = await this.ownedSession({ ...message, session_id: payload.session_id });
      session.meta.status = 'stopped'; session.meta.ended_at_ms = message.ts_unix_ms ?? time;
      updates[`sessions/${payload.session_id}/meta`] = session.meta;
    } else if (payload.command === 'SET_REFERENCE') {
      assert(message.config && message.config.reference_rev === payload.reference_rev, 'ACK_MISMATCH', 'SET_REFERENCE requires confirmed config with requested reference revision');
      configSnapshot(message.config);
      updates[`devices/${message.device_id}/state/config`] = message.config;
      Object.assign(updates, this.referenceUpdates(message.device_id, message.config, time));
    }
    const nextState = { ...record.state, last_command_id: command.command_id };
    if (payload.command === 'START') Object.assign(nextState, { state: 'RUNNING', session_id: payload.session_id });
    if (payload.command === 'STOP') Object.assign(nextState, { state: 'IDLE', session_id: null, last_closed_session_id: payload.session_id });
    if (payload.command === 'SET_REFERENCE') nextState.config = clone(message.config);
    updates[`devices/${message.device_id}/state`] = nextState;
    await this.finishCommand(record, command, 'applied', message, updates);
    record.state = nextState;
    if (payload.session_id) this.emitLive('session', command.device_id, (await this.sessionInfo(payload.session_id)).meta);
  }
  async onData(message) {
    const session = await this.ownedSession(message);
    const snapshot = session.config_snapshot;
    for (const rev of ['config_rev', 'geometry_rev', 'calibration_rev', 'reference_rev', 'algorithm_version']) {
      assert(message[rev] === snapshot[rev], 'CONFIG_MISMATCH', `Frame ${rev} differs from frozen session snapshot`);
    }
    assert(!message.metric_valid || session.meta.mode === 'reference', 'METRIC_MODE_MISMATCH', 'Measurement-only session cannot claim a reference metric');
    const record = this.devices.get(message.device_id);
    if (!record || record.state.boot_id !== message.boot_id || ['rejected', 'pending'].includes(session.meta.status)) return;
    if (session.final) return;
    if (record.telemetry?.session_id === message.session_id && message.telemetry_seq <= record.telemetry.telemetry_seq) return;
    // Late frames may belong to an old session, but must never replace the current live view.
    if (record.state.session_id !== message.session_id || record.state.state !== 'RUNNING') return;
    const time = this.now(); const frame = { ...message, received_at_ms: time };
    if (record.last_keyframe_session_id !== message.session_id || record.last_keyframe_at_ms == null || time - record.last_keyframe_at_ms >= this.config.keyframeIntervalMs) {
      const frameKey = `${message.boot_id}_${String(message.sample_seq).padStart(12, '0')}`;
      await this.persist({ [`sessions/${message.session_id}/keyframes/${frameKey}`]: frame });
      record.last_keyframe_at_ms = time;
      record.last_keyframe_session_id = message.session_id;
    }
    record.telemetry = frame;
    this.emitLive('telemetry', message.device_id, frame);
  }
  async receipt(message) {
    try {
      await this.transport.publish(`posture/${message.device_id}/receipt`, {
        schema_version: 2, device_id: message.device_id, boot_id: message.boot_id,
        session_id: message.session_id, message_id: message.message_id, status: 'stored', stored_at_ms: this.now()
      });
    } catch { /* Device must retry an unreceipted immutable message. */ }
  }
  async onSummary(message) {
    const session = await this.ownedSession(message);
    assert(session.meta.status !== 'rejected', 'SESSION_CLOSED', 'Session was rejected');
    assert(message.valid_metric_ms === 0 || (session.meta.mode === 'reference' && session.config_snapshot.reference_rev !== null), 'METRIC_MODE_MISMATCH', 'Reference time requires reference session mode');
    const digest = hash(message);
    const summaryKey = `${message.boot_id}_${String(message.summary_seq).padStart(12, '0')}`;
    const old = await this.store.get(`sessions/${message.session_id}/summaries/${summaryKey}`);
    if (old) {
      assert(old.payload_hash === digest, 'MESSAGE_CONFLICT', 'Summary sequence was reused with different content');
      // A prior SDK operation may have committed after its local timeout.
      this.sessionCache.delete(message.session_id);
      await this.receipt(message); return;
    }
    const used = await this.store.get(`sessions/${message.session_id}/summary_messages/${message.message_id}`);
    assert(!used || used === digest, 'MESSAGE_CONFLICT', 'Message ID reused');
    const latest = session.latest_summary;
    const advances = !latest || message.summary_seq > latest.summary_seq;
    if (session.final) assert(message.summary_seq <= session.final.summary_seq, 'SESSION_CLOSED', 'Summary exceeds final cutoff');
    if (advances && latest) {
      for (const field of ['elapsed_ms', 'valid_measurement_ms', 'valid_metric_ms', 'invalid_ms', 'last_sample_seq']) {
        assert(message[field] >= latest[field], 'SUMMARY_REGRESSION', `${field} regressed`);
      }
      assert(message.histogram_ms.every((v, i) => v >= latest.histogram_ms[i]), 'SUMMARY_REGRESSION', 'Histogram regressed');
    }
    assert(!message.is_final || advances, 'INVALID_SUMMARY', 'Final must be the newest cumulative snapshot');
    const saved = { ...message, received_at_ms: this.now(), payload_hash: digest };
    const updates = { [`sessions/${message.session_id}/summaries/${summaryKey}`]: saved,
      [`sessions/${message.session_id}/summary_messages/${message.message_id}`]: digest };
    if (advances) updates[`sessions/${message.session_id}/latest_summary`] = saved;
    if (message.is_final) {
      session.meta.storage_status = 'saved'; session.meta.cloud_status = this.store.kind === 'firebase' ? 'saved' : 'not_configured'; session.meta.status = 'stopped';
      session.meta.ended_at_ms = message.ts_unix_ms ?? this.now();
      updates[`sessions/${message.session_id}/final`] = saved;
      updates[`sessions/${message.session_id}/meta`] = session.meta;
    }
    await this.persist(updates);
    await this.receipt(message);
    this.emitLive('summary', message.device_id, saved);
    if (message.is_final) this.emitLive('session', message.device_id, session.meta);
  }
  async onEvent(message) {
    const session = await this.ownedSession(message); const digest = hash(message);
    assert(session.meta.status !== 'rejected', 'SESSION_CLOSED', 'Session was rejected');
    const known = await this.store.get(`sessions/${message.session_id}/event_messages/${message.message_id}`);
    if (known) {
      assert(known === digest, 'MESSAGE_CONFLICT', 'Event message ID reused with different content');
      await this.receipt(message); return;
    }
    const previous = await this.store.get(`sessions/${message.session_id}/events/${message.event_id}`);
    if (previous?.event_seq === message.event_seq) assert(previous.payload_hash === digest, 'MESSAGE_CONFLICT', 'Event revision reused');
    const updates = { [`sessions/${message.session_id}/event_messages/${message.message_id}`]: digest };
    const newer = !previous || message.event_seq > previous.event_seq;
    if (newer) {
      if (previous) {
        assert(message.started_at_mono_us === previous.started_at_mono_us && message.duration_ms >= previous.duration_ms && message.peak_deg >= previous.peak_deg, 'EVENT_REGRESSION', 'Event identity/duration/peak changed');
        assert(previous.ended_at_mono_us === null || (message.ended_at_mono_us !== null && message.ended_at_mono_us >= previous.ended_at_mono_us), 'EVENT_REGRESSION', 'Closed event cannot reopen');
      }
      updates[`sessions/${message.session_id}/events/${message.event_id}`] = { ...message, payload_hash: digest, received_at_ms: this.now() };
      if (message.notification_requested && !await this.store.get(`sessions/${message.session_id}/notification_requests/${message.event_id}`)) {
        updates[`sessions/${message.session_id}/notification_requests/${message.event_id}`] = { event_id: message.event_id, status: 'pending', created_at_ms: this.now() };
      }
    }
    await this.persist(updates); await this.receipt(message);
    if (newer) this.emitLive('event', message.device_id, message);
  }
  async tick() {
    for (const deviceId of this.devices.keys()) await this.serial(deviceId, async () => {
      const record = this.devices.get(deviceId); const connection = this.connection(record);
      record.control = await this.store.get(`devices/${deviceId}/control`) || {};
      if (record.connection !== connection) { record.connection = connection; this.emitLive('connection', deviceId, { connection }); }
      const pendingId = record.control?.pending_command_id;
      if (!pendingId) return;
      const command = await this.store.get(`commands/${pendingId}`);
      if (!command) {
        // Crash recovery for a corrupt/incomplete reservation; never invent or republish a command.
        await this.persist({ [`devices/${deviceId}/control`]: { pending_command_id: null } });
        record.control = { pending_command_id: null }; return;
      }
      if (terminal(command.status)) { record.control = { pending_command_id: null }; return; }
      if (this.now() >= command.expires_at_ms) {
        if (command.status !== 'unknown') {
          command.status = 'unknown';
          await this.persist({ [`commands/${pendingId}`]: command });
          this.emitLive('command', deviceId, command);
        }
        // Same immutable expired envelope is a safe reconciliation query: the device must
        // return its cached result, or reject COMMAND_EXPIRED without executing it anew.
        if (connection === 'online' && this.now() - (command.last_attempt_at_ms || 0) >= this.config.commandRetryMs) await this.sendCommand(command);
        return;
      }
      if (connection === 'online' && this.now() - (command.last_attempt_at_ms || 0) >= this.config.commandRetryMs) await this.sendCommand(command);
    });
  }
  async commandStatus(commandId) {
    id(commandId, 'command_id'); const value = await this.store.get(`commands/${commandId}`);
    assert(value, 'COMMAND_NOT_FOUND', 'Unknown command', 404); return value;
  }
  async page(path, { before, limit = 50 } = {}, hydrate) {
    if (before) id(before, 'before');
    limit = Number(limit);
    assert(Number.isInteger(limit) && limit >= 1 && limit <= 200, 'INVALID_QUERY', 'limit must be 1–200');
    const values = await this.store.list(path, { before, limit: limit + 1 });
    const sorted = Object.entries(values).sort(([a], [b]) => b.localeCompare(a));
    const more = sorted.length > limit; const items = sorted.slice(0, limit);
    return { items: hydrate ? await Promise.all(items.map(([itemId]) => hydrate(itemId))) : items.map(([, value]) => value),
      next_cursor: more ? items.at(-1)[0] : null };
  }
  async sessions(query = {}) {
    const path = query.device_id ? `device_sessions/${id(query.device_id)}` : 'session_index';
    return this.page(path, query, async sessionId => {
      const session = await this.sessionInfo(sessionId);
      return { ...session.meta, summary: session.final || session.latest_summary || null };
    });
  }
  async history(sessionId, type, query) {
    await this.sessionInfo(sessionId);
    assert(['keyframes', 'events', 'summaries'].includes(type), 'INVALID_QUERY', 'Unknown history collection');
    return this.page(`sessions/${sessionId}/${type}`, query);
  }
  async references(deviceId, query) { return this.page(`references/${id(deviceId)}`, query); }
  async reports({ from, to, device_id: deviceId } = {}) {
    const today = localDay(this.now());
    to ||= today;
    const validDay = day => /^\d{4}-\d{2}-\d{2}$/.test(day) && Number.isFinite(Date.parse(`${day}T00:00:00Z`)) && new Date(`${day}T00:00:00Z`).toISOString().startsWith(day);
    assert(validDay(to), 'INVALID_QUERY', 'Use YYYY-MM-DD dates');
    from ||= new Date(Date.parse(`${to}T00:00:00Z`) - 6 * 86400000).toISOString().slice(0, 10);
    assert(validDay(from), 'INVALID_QUERY', 'Use YYYY-MM-DD dates');
    const days = (Date.parse(to) - Date.parse(from)) / 86400000 + 1;
    assert(days > 0 && days <= 31, 'INVALID_QUERY', 'Report range must be 1–31 days');
    if (deviceId) id(deviceId);
    const result = [];
    for (let n = 0; n < days; n++) {
      const day = new Date(Date.parse(from) + n * 86400000).toISOString().slice(0, 10);
      const totals = { day, session_count: 0, incomplete_count: 0, estimated_time_count: 0,
        valid_measurement_ms: 0, valid_metric_ms: 0, histogram_ms: [0, 0, 0, 0, 0, 0] };
      let before;
      do {
        const batch = await this.store.list(`session_days/${day}`, { before, limit: 200 });
        const ids = Object.keys(batch).sort();
        for (const sessionId of ids) {
          const session = await this.sessionInfo(sessionId);
          if (deviceId && session.meta.device_id !== deviceId) continue;
          totals.session_count++; if (!session.final) totals.incomplete_count++;
          if (session.meta.time_quality !== 'device_utc') totals.estimated_time_count++;
          const summary = session.final || session.latest_summary;
          if (summary) {
            totals.valid_measurement_ms += summary.valid_measurement_ms; totals.valid_metric_ms += summary.valid_metric_ms;
            summary.histogram_ms.forEach((value, i) => { totals.histogram_ms[i] += value; });
          }
        }
        before = ids.length === 200 ? ids[0] : null;
      } while (before);
      result.push(totals);
    }
    return { timezone: 'Asia/Ho_Chi_Minh', grouping: 'session_start_day', days: result };
  }
  async close() { await Promise.all(this.queues.values()); await this.transport.close(); await this.store.close(); this.removeAllListeners(); }
}

module.exports = { PostureService, canonical, hash, localDay };
