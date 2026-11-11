'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { withTimeout } = require('../../logic/timeout');

const clone = value => value === undefined ? null : structuredClone(value);
// RTDB removes JSON null/empty collections. Preserve them inside records so API and
// wire values round-trip identically to the file adapter. This key is reserved.
const TYPE_KEY = '__spt_type__';
function encode(value) {
  if (value === null) return { [TYPE_KEY]: 'null' };
  if (Array.isArray(value)) return value.length ? value.map(encode) : { [TYPE_KEY]: 'array' };
  if (value && typeof value === 'object') {
    if (Object.hasOwn(value, TYPE_KEY)) throw new Error('Reserved persistence key');
    return Object.keys(value).length ? Object.fromEntries(Object.entries(value).map(([k, v]) => [k, encode(v)])) : { [TYPE_KEY]: 'object' };
  }
  if (value === undefined || (typeof value === 'number' && !Number.isFinite(value))) throw new Error('Storage requires JSON values');
  return value;
}
function decode(value) {
  if (!value || typeof value !== 'object') return value;
  if (value[TYPE_KEY] === 'null') return null;
  if (value[TYPE_KEY] === 'array') return [];
  if (value[TYPE_KEY] === 'object') return {};
  if (Array.isArray(value)) return value.map(decode);
  return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, decode(v)]));
}
function parts(key) {
  const keys = key.split('/').filter(Boolean);
  if (keys.some(k => !/^[A-Za-z0-9_-]+$/.test(k) || ['__proto__', 'constructor', 'prototype'].includes(k))) throw new Error('Invalid storage path');
  return keys;
}
function read(root, key) { return parts(key).reduce((value, part) => value != null && Object.hasOwn(value, part) ? value[part] : null, root) ?? null; }
function write(root, key, value) {
  const keys = parts(key);
  if (!keys.length) throw new Error('Root replacement is forbidden');
  let parent = root;
  for (const keyPart of keys.slice(0, -1)) {
    if (!Object.hasOwn(parent, keyPart)) parent[keyPart] = {};
    parent = parent[keyPart];
  }
  if (value === null) delete parent[keys.at(-1)]; else parent[keys.at(-1)] = clone(value);
}
class FileStore {
  constructor(file) { this.file = file; this.data = {}; this.tail = Promise.resolve(); this.kind = 'file'; }
  async init() {
    if (this.file) {
      try { this.data = JSON.parse(await fs.readFile(this.file, 'utf8')); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    return this;
  }
  async get(key) { await this.tail; return clone(read(this.data, key)); }
  async list(key, { orderBy, equalTo, before, limit = 50 } = {}) {
    let entries = Object.entries(await this.get(key) || {});
    if (orderBy) entries = entries.filter(([, v]) => equalTo === undefined || read(v, orderBy) === equalTo);
    entries.sort(([a], [b]) => a.localeCompare(b));
    if (before) entries = entries.filter(([id]) => id < before);
    return Object.fromEntries(entries.slice(-limit));
  }
  mutate(callback) {
    const work = this.tail.then(async () => {
      const next = clone(this.data);
      const result = callback(next);
      if (this.file) {
        await fs.mkdir(path.dirname(this.file), { recursive: true });
        const temp = `${this.file}.${randomUUID()}.tmp`;
        await fs.writeFile(temp, JSON.stringify(next), { mode: 0o600 });
        await fs.rename(temp, this.file);
      }
      this.data = next;
      return result;
    });
    this.tail = work.catch(() => {});
    return work;
  }
  async update(updates) { return this.mutate(root => { for (const [key, value] of Object.entries(updates)) write(root, key, value); }); }
  async transaction(key, change) {
    return this.mutate(root => {
      const current = clone(read(root, key));
      const next = change(current);
      if (next === undefined) return { committed: false, value: current };
      write(root, key, next);
      return { committed: true, value: clone(next) };
    });
  }
  async close() { await this.tail; }
}
class FirebaseStore {
  constructor(config) { this.config = config; this.kind = 'firebase'; }
  async init() {
    const { initializeApp, applicationDefault } = require('firebase-admin/app');
    const { getDatabase } = require('firebase-admin/database');
    const config = this.config;
    if (!config.databaseURL || !config.projectId) throw new Error('Firebase requires FIREBASE_DATABASE_URL and FIREBASE_PROJECT_ID');
    const options = { databaseURL: config.databaseURL, projectId: config.projectId };
    if (!config.emulator) options.credential = applicationDefault();
    this.app = initializeApp(options, `spt-${randomUUID()}`);
    this.database = getDatabase(this.app);
    this.root = this.database.ref(config.root);
    try { await this.wait(this.root.child('health').get()); }
    catch (error) { await this.close(); throw error; }
    return this;
  }
  wait(promise) { return withTimeout(promise, 10000, 'Firebase operation timed out'); }
  ref(key) { parts(key); return this.root.child(key); }
  async get(key) { return decode((await this.wait(this.ref(key).get())).val()); }
  async list(key, { orderBy, equalTo, before, limit = 50 } = {}) {
    let query = this.ref(key);
    query = orderBy ? query.orderByChild(orderBy) : query.orderByKey();
    if (equalTo !== undefined) query = query.equalTo(equalTo);
    else if (before) query = query.endBefore(before);
    return decode((await this.wait(query.limitToLast(limit).get())).val()) || {};
  }
  async update(updates) {
    for (const key of Object.keys(updates)) parts(key);
    await this.wait(this.root.update(Object.fromEntries(Object.entries(updates).map(([key, value]) => [key, value === null ? null : encode(value)]))));
  }
  async transaction(key, change) {
    const result = await this.wait(this.ref(key).transaction(current => {
      const value = change(clone(decode(current)));
      return value === undefined || value === null ? value : encode(value);
    }, undefined, false));
    return { committed: result.committed, value: decode(result.snapshot.val()) };
  }
  async close() {
    if (this.database) this.database.goOffline();
    if (this.app) await require('firebase-admin/app').deleteApp(this.app);
  }
}
async function createStore(config) {
  return (config.driver === 'firebase' ? new FirebaseStore(config) : new FileStore(config.file)).init();
}
module.exports = { FileStore, FirebaseStore, createStore, encode, decode };
