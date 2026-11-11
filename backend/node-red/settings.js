'use strict';
const path = require('node:path');
const { timingSafeEqual } = require('node:crypto');
const { loadConfig } = require('../config/runtime');
const config = loadConfig();
const editor = process.env.ENABLE_EDITOR === 'true';
const hash = process.env.NODE_RED_ADMIN_PASSWORD_HASH;
if (editor && !['127.0.0.1', 'localhost', '::1'].includes(config.host) && !hash) throw new Error('Non-loopback editor requires NODE_RED_ADMIN_PASSWORD_HASH');

module.exports = {
  uiHost: config.host, uiPort: config.port,
  flowFile: path.join(__dirname, 'flows.json'), nodesDir: path.join(__dirname, 'nodes'),
  credentialSecret: config.apiToken, flowFilePretty: true,
  httpAdminRoot: editor ? '/editor' : false,
  adminAuth: editor && hash ? { type: 'credentials', users: [{ username: process.env.NODE_RED_ADMIN_USER || 'admin', password: hash, permissions: '*' }] } : undefined,
  httpNodeRoot: '/', apiMaxLength: '32kb',
  httpNodeCors: {
    origin(origin, done) { done(null, !!origin && config.origins.includes(origin)); },
    methods: ['GET', 'POST', 'OPTIONS'], allowedHeaders: ['Authorization', 'Content-Type'], optionsSuccessStatus: 204
  },
  contextStorage: { default: { module: 'localfilesystem' } },
  editorTheme: { palette: { editable: false }, projects: { enabled: false } },
  logging: { console: { level: 'info', metrics: false, audit: false } },
  httpNodeMiddleware(req, res, next) {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'no-store');
    const origin = req.headers.origin;
    if (origin) {
      if (!config.origins.includes(origin)) return res.status(403).json({ error: { code: 'ORIGIN_FORBIDDEN' } });
      res.setHeader('Access-Control-Allow-Origin', origin); res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    }
    if (req.method === 'OPTIONS') return res.status(204).end();
    const supplied = Buffer.from(req.headers.authorization || '');
    const expected = Buffer.from(`Bearer ${config.apiToken}`);
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Bearer token required' } });
    if (req.method === 'POST' && !/^application\/json(?:;|$)/i.test(req.headers['content-type'] || '')) return res.status(415).json({ error: { code: 'JSON_REQUIRED', message: 'Use application/json' } });
    next();
  }
};
