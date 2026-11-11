'use strict';
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
function number(env, key, fallback, min = 1, max = 86400000) {
  const value = Number(env[key] ?? fallback);
  if (!Number.isSafeInteger(value) || value < min || value > max) throw new Error(`Invalid ${key}`);
  return value;
}
function loadConfig(env = process.env) {
  const config = {
    production: env.NODE_ENV === 'production',
    host: env.HOST || '127.0.0.1', port: number(env, 'PORT', 1880, 1, 65535),
    apiToken: env.API_TOKEN || '', origins: (env.ALLOWED_ORIGINS || '').split(',').filter(Boolean),
    mqtt: { url: env.MQTT_URL || 'mqtt://127.0.0.1:1883', username: env.MQTT_USERNAME || '',
      password: env.MQTT_PASSWORD || '', ca: env.MQTT_CA_FILE ? fs.readFileSync(env.MQTT_CA_FILE) : undefined },
    store: { driver: env.STORE_DRIVER || 'file', file: path.resolve(ROOT, env.STORE_FILE || '.runtime/store.json'),
      databaseURL: env.FIREBASE_DATABASE_URL, projectId: env.FIREBASE_PROJECT_ID,
      root: env.FIREBASE_ROOT || 'spt', emulator: env.FIREBASE_DATABASE_EMULATOR_HOST },
    staleMs: number(env, 'HEARTBEAT_STALE_MS', 6000), offlineMs: number(env, 'HEARTBEAT_OFFLINE_MS', 15000),
    commandTimeoutMs: number(env, 'COMMAND_TIMEOUT_MS', 10000, 1000, 60000),
    commandRetryMs: number(env, 'COMMAND_RETRY_MS', 2000, 100, 60000),
    keyframeIntervalMs: number(env, 'KEYFRAME_INTERVAL_MS', 5000, 1000, 60000)
  };
  if (config.apiToken.length < 24) throw new Error('API_TOKEN must contain at least 24 characters; run npm run configure');
  if (config.offlineMs <= config.staleMs) throw new Error('HEARTBEAT_OFFLINE_MS must exceed stale timeout');
  if (!['file', 'firebase'].includes(config.store.driver)) throw new Error('Unknown STORE_DRIVER');
  if (!/^[a-zA-Z0-9_-]+$/.test(config.store.root)) throw new Error('Invalid FIREBASE_ROOT');
  const mqttUrl = new URL(config.mqtt.url);
  if (!['mqtt:', 'mqtts:'].includes(mqttUrl.protocol) || mqttUrl.username || mqttUrl.password) throw new Error('Use MQTT_USERNAME/PASSWORD and mqtt(s):// URL');
  if (config.production && (mqttUrl.protocol !== 'mqtts:' || !config.mqtt.username || !config.mqtt.password)) throw new Error('Production requires authenticated MQTT TLS');
  if (config.production && (config.store.driver !== 'firebase' || config.store.emulator)) throw new Error('Production requires real Firebase persistence');
  return config;
}
module.exports = { loadConfig, ROOT };
