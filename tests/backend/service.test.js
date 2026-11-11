'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { FileStore } = require('../../backend/integrations/firebase/store');
const { validateMessage } = require('../../backend/integrations/mqtt/protocol');
const { localDay } = require('../../backend/logic/service');
const { encode, decode } = require('../../backend/integrations/firebase/store');
const { fixture, running, state, snapshot, ack, summary, event, data, removeTestDir } = require('./helpers');
const rejects = (operation, code) => assert.rejects(operation, error => error.code === code);

test('retained state cannot authorize commands; heartbeat sequence controls freshness', async () => {
  const f = await fixture();
  await f.service.ingest('posture/esp32_01/state', state(), { retained: true });
  assert.equal(f.service.device('esp32_01').connection, 'offline');
  await rejects(f.service.command('esp32_01', { command: 'START' }), 'DEVICE_OFFLINE');
  await f.ingest(state()); assert.equal(f.service.device('esp32_01').connection, 'online');
  f.advance(7000); await f.ingest(state()); await f.service.tick();
  assert.equal(f.service.device('esp32_01').connection, 'stale');
  f.advance(9000); assert.equal(f.service.device('esp32_01').connection, 'offline');
  assert.equal(f.transport.sent.length, 0);
});

test('HTTP idempotency and one pending command; accepted is not applied', async () => {
  const f = await fixture(); await f.ingest(state());
  const request = { command: 'START', command_id: 'start_1' };
  const command = await f.service.command('esp32_01', request);
  assert.equal((await f.service.command('esp32_01', request)).command_id, command.command_id);
  assert.equal(f.transport.sent.length, 1);
  await rejects(f.service.command('esp32_01', { ...request, mode: 'reference' }), 'COMMAND_CONFLICT');
  await rejects(f.service.command('esp32_01', { command: 'TEST_VIBRATION', duration_ms: 200 }), 'COMMAND_PENDING');
  await f.ingest(ack(command, { status: 'accepted', state: 'PREFLIGHT' }));
  assert.equal((await f.service.getSession(command.payload.session_id)).meta.status, 'pending');
  await f.ingest(ack(command));
  assert.equal((await f.service.getSession(command.payload.session_id)).meta.status, 'running');
  await rejects(f.service.command('esp32_01', { command: 'START' }), 'SESSION_CONFLICT');
});

test('wrong boot/session ACK cannot mutate the pending command', async () => {
  const f = await fixture(); await f.ingest(state());
  const command = await f.service.command('esp32_01', { command: 'START' });
  await rejects(f.ingest(ack(command, { boot_id: 'other_boot' })), 'ACK_MISMATCH');
  await rejects(f.ingest(ack(command, { session_id: 'other_session' })), 'ACK_MISMATCH');
  assert.equal((await f.service.commandStatus(command.command_id)).status, 'pending');
});

test('unknown timeout keeps reservation and reconciles with identical expired envelope', async () => {
  const f = await fixture(); await f.ingest(state());
  const command = await f.service.command('esp32_01', { command: 'START', command_id: 'start_1' });
  const original = structuredClone(command.payload);
  f.advance(11000); await f.ingest(state({ state_seq: 2, t_mono_us: 12000000 })); await f.service.tick();
  assert.equal((await f.service.commandStatus(command.command_id)).status, 'unknown');
  assert.deepEqual(f.transport.sent.at(-1).payload, original);
  await rejects(f.service.command('esp32_01', { command: 'START' }), 'COMMAND_PENDING');
  await f.ingest(ack(command, { status: 'rejected', reason: 'COMMAND_EXPIRED', state: 'IDLE' }));
  assert.equal(f.service.device('esp32_01').pending_command_id, null);
  assert.equal((await f.service.getSession(command.payload.session_id)).meta.status, 'rejected');
});

test('fresh running state recovers a lost START ACK without creating a new session', async () => {
  const f = await fixture(); await f.ingest(state());
  const command = await f.service.command('esp32_01', { command: 'START' });
  await f.ingest(state({ state_seq: 2, state: 'RUNNING', session_id: command.payload.session_id, t_mono_us: 5000000, started_at_mono_us: 2000000 }));
  assert.equal((await f.service.commandStatus(command.command_id)).status, 'applied');
  assert.equal((await f.service.sessions()).items.length, 1);
  assert.equal((await f.service.getSession(command.payload.session_id)).meta.started_at_mono_us, 2000000);
});

test('reference requires guidance and confirmed applied config; no-reference supports measurement only', async () => {
  const f = await fixture(); await f.ingest(state());
  await rejects(f.service.command('esp32_01', { command: 'START', mode: 'reference' }), 'REFERENCE_REQUIRED');
  await rejects(f.service.command('esp32_01', { command: 'SET_REFERENCE' }), 'GUIDANCE_REQUIRED');
  const command = await f.service.command('esp32_01', { command: 'SET_REFERENCE', guided_confirmation: true });
  assert.equal((await f.service.references('esp32_01')).items.length, 0);
  await rejects(f.ingest(ack(command)), 'ACK_MISMATCH');
  const config = snapshot(true); config.reference_rev = command.payload.reference_rev; config.reference.reference_rev = command.payload.reference_rev;
  await f.ingest(ack(command, { config }));
  assert.equal((await f.service.references('esp32_01')).items.length, 1);
  const start = await f.service.command('esp32_01', { command: 'START', mode: 'reference' }); await f.ingest(ack(start));
  await rejects(f.service.command('esp32_01', { command: 'SET_REFERENCE', guided_confirmation: true }), 'SESSION_LOCKED');
});

test('STOP targets exact session; final saved differs from STOP applied', async () => {
  const f = await running();
  await rejects(f.service.command('esp32_01', { command: 'STOP', session_id: 'old_session' }), 'SESSION_MISMATCH');
  const stop = await f.service.command('esp32_01', { command: 'STOP', session_id: f.command.payload.session_id });
  await f.ingest(ack(stop));
  let session = await f.service.getSession(stop.payload.session_id);
  assert.equal(session.meta.status, 'stopped'); assert.equal(session.meta.storage_status, 'awaiting_final');
  await f.ingest(summary(f.command, { is_final: true })); session = await f.service.getSession(stop.payload.session_id);
  assert.equal(session.meta.storage_status, 'saved'); assert.equal(session.meta.cloud_status, 'not_configured');
});

test('summary deduplication, cumulative totals, regression and histogram validation', async () => {
  const f = await running(); const one = summary(f.command);
  await f.ingest(one); await f.ingest(one);
  assert.equal(Object.keys((await f.service.getSession(one.session_id)).summaries).length, 1);
  assert.equal(f.transport.sent.filter(p => p.topic.endsWith('/receipt')).length, 2);
  await rejects(f.ingest({ ...one, message_id: 'different_id' }), 'MESSAGE_CONFLICT');
  await rejects(f.ingest({ ...one, summary_seq: 2, message_id: 'summary_2', elapsed_ms: 1000, valid_measurement_ms: 1000 }), 'SUMMARY_REGRESSION');
  await rejects(f.ingest({ ...one, histogram_ms: [1, 0, 0, 0, 0, 0] }), 'INVALID_SUMMARY');
  const final = summary(f.command, { summary_seq: 3, message_id: 'final_3', elapsed_ms: 3000, valid_measurement_ms: 3000, is_final: true });
  await f.ingest(final); await f.ingest(final);
  assert.equal((await f.service.getSession(one.session_id)).final.elapsed_ms, 3000);
  await rejects(f.ingest(summary(f.command, { summary_seq: 4, message_id: 'after_final' })), 'SESSION_CLOSED');
});

test('storage failure issues no receipt and retry can succeed', async () => {
  const f = await running(); const original = f.store.update.bind(f.store);
  const count = f.transport.sent.length;
  f.store.update = async () => { throw new Error('disk full'); };
  await rejects(f.ingest(summary(f.command)), 'STORAGE_UNAVAILABLE');
  assert.equal(f.transport.sent.length, count);
  f.store.update = original; await f.ingest(summary(f.command));
  assert.ok(f.transport.sent.at(-1).topic.endsWith('/receipt'));
});

test('event deduplication and out-of-order updates cannot overwrite newer revision', async () => {
  const f = await running(); const one = event(f.command); const two = event(f.command, { event_seq: 2, message_id: 'event_message_2', duration_ms: 2500, notification_requested: true });
  await f.ingest(two); await f.ingest(one); await f.ingest(two);
  const session = await f.service.getSession(one.session_id);
  assert.equal(session.events.event_1.event_seq, 2);
  assert.equal(Object.keys(session.notification_requests).length, 1);
  await rejects(f.ingest({ ...two, peak_deg: 40 }), 'MESSAGE_CONFLICT');
});

test('frame validity, relative sign and frozen revision are enforced; missing data stays null', async () => {
  const f = await running();
  await f.ingest(data(f.command));
  await rejects(f.ingest(data(f.command, { relative_deg: [-10, -10, -7] })), 'ANGLE_CONVENTION_MISMATCH');
  await rejects(f.ingest(data(f.command, { config_rev: 'new_config' })), 'CONFIG_MISMATCH');
  const partial = data(f.command, { telemetry_seq: 2, sample_seq: 11, pitch_deg: [32, null, 12, 5], relative_deg: [null, null, 7],
    sensor_quality: ['OK', 'MISSING', 'OK', 'OK'], curve_valid: false, curve: null });
  await f.ingest(partial);
  assert.equal(f.service.device('esp32_01').telemetry.curve, null);
  await rejects(f.ingest({ ...partial, curve_valid: true }), 'INVALID_MESSAGE');
});

test('reboot interrupts running and pending sessions, old data does not become live', async () => {
  const f = await running(); await f.ingest(data(f.command));
  await f.ingest(state({ boot_id: 'boot_2', state_seq: 1 }));
  assert.equal((await f.service.getSession(f.command.payload.session_id)).meta.status, 'interrupted');
  assert.equal(f.service.device('esp32_01').telemetry, null);
  await f.ingest(data(f.command, { telemetry_seq: 2 })); assert.equal(f.service.device('esp32_01').telemetry, null);
  const pending = await f.service.command('esp32_01', { command: 'START' });
  await f.ingest(state({ boot_id: 'boot_3', state_seq: 1 }));
  assert.equal((await f.service.commandStatus(pending.command_id)).status, 'cancelled');
  assert.equal((await f.service.getSession(pending.payload.session_id)).meta.status, 'interrupted');
});

test('durable file reload keeps pending command without automatic replay until fresh state', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'spt-store-'));
  t.after(() => removeTestDir(directory));
  const file = path.join(directory, 'state.json'); const store = await new FileStore(file).init();
  const first = await fixture({ store }); await first.ingest(state());
  const command = await first.service.command('esp32_01', { command: 'START' }); await first.service.close();
  const second = await fixture({ store: await new FileStore(file).init() });
  await second.service.tick(); assert.equal(second.transport.sent.length, 0);
  assert.equal(second.service.device('esp32_01').connection, 'offline');
  await second.ingest(state({ state_seq: 2, state: 'RUNNING', session_id: command.payload.session_id }));
  assert.equal((await second.service.commandStatus(command.command_id)).status, 'applied');
});

test('history pagination and report use one cumulative snapshot per session and start-day timezone', async () => {
  const f = await running(); await f.ingest(summary(f.command));
  await f.ingest(summary(f.command, { summary_seq: 2, message_id: 'summary_2', elapsed_ms: 3000, valid_measurement_ms: 3000 }));
  const report = await f.service.reports({ from: localDay(1794405601000), to: localDay(1794405601000) });
  assert.equal(report.days[0].valid_measurement_ms, 3000); assert.equal(report.days[0].incomplete_count, 1);
  const page = await f.service.history(f.command.payload.session_id, 'summaries', { limit: 1 });
  assert.equal(page.items[0].summary_seq, 2); assert.ok(page.next_cursor);
  assert.equal((await f.service.history(f.command.payload.session_id, 'summaries', { limit: 1, before: page.next_cursor })).items[0].summary_seq, 1);
  await rejects(f.service.reports({ to: 'garbage' }), 'INVALID_QUERY');
});

test('unsupported firmware, topic mismatch, unsafe ID and oversized message are rejected', () => {
  assert.throws(() => validateMessage('posture/esp32_01/data', { device_id: 'esp32_01', pitch: [1, 2, 3, 4] }), { code: 'SCHEMA_UNSUPPORTED' });
  assert.throws(() => validateMessage('posture/other/state', state()), { code: 'DEVICE_MISMATCH' });
  assert.throws(() => validateMessage('posture/esp32_01/state', state({ boot_id: '../boot' })), { code: 'INVALID_MESSAGE' });
  assert.throws(() => validateMessage('posture/esp32_01/state', Buffer.alloc(17000)), { code: 'PAYLOAD_TOO_LARGE' });
});

test('protocol examples conform to the live device-message validator', async () => {
  const directory = path.resolve(__dirname, '../../backend/integrations/mqtt/examples');
  for (const type of ['state', 'ack', 'data', 'summary', 'event']) {
    const body = JSON.parse(await fs.readFile(path.join(directory, `${type}.json`), 'utf8'));
    assert.equal(validateMessage(`posture/esp32_01/${type}`, body).type, type);
  }
});

test('nullable Firebase records round-trip without leaking storage markers to the API', () => {
  const value = { reference_rev: null, reference: null, values: [null, 0, null], empty: [], object: {} };
  assert.deepEqual(decode(encode(value)), value);
  assert.throws(() => encode({ __spt_type__: 'null' }), /Reserved persistence key/);
});

test('closed events cannot reopen and telemetry cannot replace the live view after final', async () => {
  const f = await running();
  await f.ingest(event(f.command, { ended_at_mono_us: 4000000 }));
  await rejects(f.ingest(event(f.command, { message_id: 'event_reopen', event_seq: 2 })), 'EVENT_REGRESSION');
  await f.ingest(data(f.command)); const previous = f.service.device('esp32_01').telemetry;
  await f.ingest(summary(f.command, { is_final: true }));
  await f.ingest(data(f.command, { telemetry_seq: 2, sample_seq: 20 }));
  assert.deepEqual(f.service.device('esp32_01').telemetry, previous);
});

test('queued work is bounded and telemetry may be dropped under backpressure', async () => {
  const f = await fixture(); let release;
  const pending = new Promise(resolve => { release = resolve; });
  const works = Array.from({ length: 128 }, () => f.service.serial('esp32_01', () => pending));
  await rejects(f.service.serial('esp32_01', () => true), 'DEVICE_BUSY');
  const sample = data({ device_id: 'esp32_01', payload: { target_boot_id: 'boot_1', session_id: 'ses_backpressure' } });
  assert.equal((await f.service.ingest('posture/esp32_01/data', sample)).ignored, 'TELEMETRY_BACKPRESSURE');
  release(); await Promise.all(works); assert.equal(f.service.queueDepth.size, 0);
});

test('telemetry never reads the complete history tree and caches immutable session context', async () => {
  const f = await running(); const reads = []; const get = f.store.get.bind(f.store);
  f.store.get = async key => { reads.push(key); return get(key); };
  await f.ingest(data(f.command)); reads.length = 0;
  await f.ingest(data(f.command, { sample_seq: 11, telemetry_seq: 2 }));
  reads.length = 0;
  await f.ingest(data(f.command, { sample_seq: 12, telemetry_seq: 3 }));
  assert.equal(reads.length, 0);
  const cfg = snapshot(); cfg.geometry_rev = 'changed_geometry';
  await rejects(f.ingest(state({ state_seq: 2, state: 'RUNNING', session_id: f.command.payload.session_id, config: cfg })), 'CONFIG_MISMATCH');
});

test('dictionary keys do not resolve inherited JavaScript properties', async () => {
  const store = await new FileStore().init();
  assert.equal(await store.get('devices/toString'), null);
  await store.update({ 'devices/toString/state': { online: true } });
  assert.deepEqual(await store.get('devices/toString/state'), { online: true });
  await assert.rejects(store.update({ 'devices/__proto__/polluted': true }), /Invalid storage path/);
  assert.equal({}.polluted, undefined);
  assert.throws(() => validateMessage('posture/constructor/state', state({ device_id: 'constructor' })), { code: 'INVALID_MESSAGE' });
});

test('late storage commit preserves command reservation and final retry refreshes cached status', async () => {
  const f = await fixture(); await f.ingest(state()); const update = f.store.update.bind(f.store);
  let failOnce = true;
  f.store.update = async updates => { await update(updates); if (failOnce) { failOnce = false; throw new Error('Committed after caller timeout'); } };
  await rejects(f.service.command('esp32_01', { command: 'START', command_id: 'uncertain_start' }), 'STORAGE_UNAVAILABLE');
  await rejects(f.service.command('esp32_01', { command: 'START' }), 'COMMAND_PENDING');
  f.advance(2500); await f.service.tick();
  const command = await f.service.commandStatus('uncertain_start'); assert.equal(f.transport.sent.at(-1).payload.command_id, command.command_id);
  await f.ingest(ack(command)); await f.service.sessionInfo(command.payload.session_id);
  failOnce = true;
  const final = summary(command, { is_final: true });
  await rejects(f.ingest(final), 'STORAGE_UNAVAILABLE');
  await f.ingest(final);
  assert.equal((await f.service.sessionInfo(command.payload.session_id)).meta.storage_status, 'saved');
});
