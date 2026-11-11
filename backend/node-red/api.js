'use strict';
const { AppError } = require('../logic/errors');

function openStream(service, req, res, clients) {
  if (clients.size >= 64) throw new AppError('TOO_MANY_STREAMS', 'At most 64 realtime connections', 429);
  res.status(200).set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', 'Connection': 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.flushHeaders();
  const send = event => {
    if (!res.write(`id: ${event.id || ''}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`)) res.end();
  };
  const listener = event => send(event);
  const heartbeat = setInterval(() => { if (!res.write(': heartbeat\n\n')) res.end(); }, 15000);
  const cleanup = () => { clearInterval(heartbeat); service.off('realtime', listener); clients.delete(res); };
  res.on('close', cleanup); clients.add(res); service.on('realtime', listener);
  send({ type: 'snapshot', data: service.listDevices(), received_at_ms: Date.now() });
  // No historical replay over SSE. Reconnect gets snapshot; use REST cursors for history.
}
async function route(service, req, res, clients) {
  const url = new URL(req.originalUrl || req.url, 'http://localhost');
  const path = url.pathname.replace(/\/$/, ''); const query = Object.fromEntries(url.searchParams);
  const method = req.method.toUpperCase(); const body = req.body;
  if (method === 'GET' && path === '/api/v1/health') return { ready: !service.lastStorageError, storage: service.store.kind, mqtt_connected: service.transport.connected, protocol_version: 2, counters: service.stats };
  if (method === 'GET' && path === '/api/v1/stream') { openStream(service, req, res, clients); return undefined; }
  if (method === 'GET' && path === '/api/v1/devices') return { items: service.listDevices() };
  let match = /^\/api\/v1\/devices\/([^/]+)$/.exec(path);
  if (method === 'GET' && match) return service.device(match[1]);
  match = /^\/api\/v1\/devices\/([^/]+)\/commands$/.exec(path);
  if (method === 'POST' && match) { res.status(202); return service.command(match[1], body); }
  match = /^\/api\/v1\/devices\/([^/]+)\/references$/.exec(path);
  if (method === 'GET' && match) return service.references(match[1], query);
  match = /^\/api\/v1\/commands\/([^/]+)$/.exec(path);
  if (method === 'GET' && match) return service.commandStatus(match[1]);
  if (method === 'GET' && path === '/api/v1/sessions') return service.sessions(query);
  match = /^\/api\/v1\/sessions\/([^/]+)\/(keyframes|events|summaries)$/.exec(path);
  if (method === 'GET' && match) return service.history(match[1], match[2], query);
  match = /^\/api\/v1\/sessions\/([^/]+)$/.exec(path);
  if (method === 'GET' && match) {
    const session = await service.sessionInfo(match[1]);
    return { meta: session.meta, config_snapshot: session.config_snapshot, summary: session.final || session.latest_summary || null, final: session.final || null };
  }
  if (method === 'GET' && path === '/api/v1/reports/daily') return service.reports(query);
  throw new AppError('NOT_FOUND', 'Unknown API route', 404);
}
module.exports = { route, openStream };
