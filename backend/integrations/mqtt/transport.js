'use strict';
const { EventEmitter } = require('node:events');
const mqtt = require('mqtt');
const { randomUUID } = require('node:crypto');
const { AppError } = require('../../logic/errors');
const { withTimeout } = require('../../logic/timeout');

class MqttTransport extends EventEmitter {
  constructor(config) { super(); this.config = config; this.connected = false; }
  start() {
    this.client = mqtt.connect(this.config.url, {
      clientId: `spt-backend-${randomUUID()}`, username: this.config.username, password: this.config.password,
      ca: this.config.ca, rejectUnauthorized: true, protocolVersion: 4, clean: true,
      reconnectPeriod: 2000, connectTimeout: 5000, queueQoSZero: false,
      resubscribe: true, reconnectOnConnackError: true
    });
    this.client.on('connect', () => {
      this.client.subscribe(['state', 'ack', 'data', 'summary', 'event'].map(type => `posture/+/${type}`), { qos: 1 }, error => {
        if (error) this.emit('fault', error);
        else { this.connected = true; this.emit('connection', true); }
      });
    });
    for (const event of ['offline', 'close']) this.client.on(event, () => { this.connected = false; this.emit('connection', false); });
    this.client.on('error', error => this.emit('fault', error));
    this.client.on('message', (topic, payload, packet) => this.emit('message', { topic, payload, retained: !!packet.retain }));
  }
  async publish(topic, payload, qos = 1) {
    if (!this.connected) throw new AppError('BROKER_OFFLINE', 'MQTT broker unavailable', 503);
    await withTimeout(this.client.publishAsync(topic, JSON.stringify(payload), { qos, retain: false }), 2000, 'MQTT publish timeout');
    this.emit('outbound', { topic, command_id: payload.command_id, message_id: payload.message_id });
  }
  async close() { this.connected = false; if (this.client) await this.client.endAsync(true); }
}
module.exports = { MqttTransport };
