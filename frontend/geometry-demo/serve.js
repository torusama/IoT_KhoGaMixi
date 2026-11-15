'use strict';
// Development-only static server. No extra packages or backend credentials required.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const files = new Map([
  ['/', ['frontend/geometry-demo/index.html', 'text/html; charset=utf-8']],
  ['/frontend/geometry-demo/', ['frontend/geometry-demo/index.html', 'text/html; charset=utf-8']],
  ['/frontend/geometry-demo/index.html', ['frontend/geometry-demo/index.html', 'text/html; charset=utf-8']],
  ['/frontend/geometry-demo/demo.js', ['frontend/geometry-demo/demo.js', 'text/javascript; charset=utf-8']],
  ['/demo.js', ['frontend/geometry-demo/demo.js', 'text/javascript; charset=utf-8']],
  ['/shared/geometry/spine2d.js', ['shared/geometry/spine2d.js', 'text/javascript; charset=utf-8']]
]);
const server = http.createServer((req, res) => {
  const file = files.get(new URL(req.url, 'http://localhost').pathname);
  if (!file) { res.writeHead(404); res.end('Not found'); return; }
  res.writeHead(200, { 'Content-Type': file[1], 'Cache-Control': 'no-store' });
  fs.createReadStream(path.join(root, file[0])).pipe(res);
});
server.listen(Number(process.env.SPT_GEOMETRY_PORT || 1882), '127.0.0.1', () => {
  console.log(`F02.1 Simulation: http://127.0.0.1:${server.address().port}/frontend/geometry-demo/`);
});
