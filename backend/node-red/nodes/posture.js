'use strict';
const { loadConfig } = require('../../config/runtime');
const { createStore } = require('../../integrations/firebase/store');
const { MqttTransport } = require('../../integrations/mqtt/transport');
const { PostureService } = require('../../logic/service');
const { route } = require('../api');

module.exports = function register(RED) {
  function PostureConfig(config) {
    RED.nodes.createNode(this, config); const node = this;
    node.clients = new Set(); node.closing = false;
    node.ready = (async () => {
      const runtime = loadConfig(); const store = await createStore(runtime.store);
      const transport = new MqttTransport(runtime.mqtt);
      node.service = await new PostureService({ store, transport, config: runtime }).init();
      transport.on('fault', () => node.warn('MQTT connection error; reconnecting (see health API)'));
      if (!node.closing) transport.start();
      return node.service;
    })();
    node.ready.catch(error => node.error(`Posture runtime initialization failed: ${error.message}`));
    node.on('close', (_removed, done) => {
      node.closing = true;
      for (const client of node.clients) client.end();
      node.ready.then(service => service.close()).then(() => done(), () => done());
    });
  }
  RED.nodes.registerType('posture-config', PostureConfig);

  function MqttInput(config) {
    RED.nodes.createNode(this, config); const node = this; const runtime = RED.nodes.getNode(config.runtime);
    let transport, receive, connection;
    runtime.ready.then(service => {
      transport = service.transport;
      receive = message => node.send({ topic: message.topic, payload: message.payload, retained: message.retained });
      connection = online => node.status({ fill: online ? 'green' : 'red', shape: 'dot', text: online ? 'MQTT connected' : 'MQTT offline' });
      transport.on('message', receive); transport.on('connection', connection); connection(transport.connected);
    }).catch(error => node.error(error));
    node.on('close', () => { if (transport) { transport.off('message', receive); transport.off('connection', connection); } });
  }
  RED.nodes.registerType('posture-mqtt-in', MqttInput);

  function Ingest(config) {
    RED.nodes.createNode(this, config); const node = this; const runtime = RED.nodes.getNode(config.runtime);
    node.on('input', async (msg, send, done) => {
      try {
        const service = await runtime.ready;
        const result = await service.ingest(msg.topic, msg.payload, { retained: msg.retained });
        // Do not pass raw telemetry or configuration secrets into diagnostics.
        send({ payload: result }); done();
      } catch (error) { node.warn(`Rejected device message: ${error.code || 'INTERNAL_ERROR'}`); done(); }
    });
  }
  RED.nodes.registerType('posture-ingest', Ingest);

  function Maintenance(config) {
    RED.nodes.createNode(this, config); const node = this; const runtime = RED.nodes.getNode(config.runtime); let busy = false;
    node.on('input', async (_msg, _send, done) => {
      if (busy) return done(); busy = true;
      try { await (await runtime.ready).tick(); done(); }
      catch (error) { node.warn(`Maintenance failed: ${error.code || 'INTERNAL_ERROR'}`); done(); }
      finally { busy = false; }
    });
  }
  RED.nodes.registerType('posture-maintenance', Maintenance);

  function Api(config) {
    RED.nodes.createNode(this, config); const runtime = RED.nodes.getNode(config.runtime);
    this.on('input', async (msg, _send, done) => {
      const res = msg.res?._res || msg.res;
      try {
        const result = await route(await runtime.ready, msg.req, res, runtime.clients);
        if (result !== undefined && !res.writableEnded) res.json(result);
      } catch (error) {
        if (!res.headersSent) res.status(error.status || 500).json({ error: { code: error.code || 'INTERNAL_ERROR', message: error.status ? error.message : 'Request failed' } });
        else res.end();
      }
      done();
    });
  }
  RED.nodes.registerType('posture-api', Api);
};
