'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '../..');
test('generated Dashboard widget uses shared core, wraps angles and clears invalid geometry', () => {
  const nodes = JSON.parse(fs.readFileSync(path.join(root, 'frontend/dashboard/flows_spt_frontend.json'), 'utf8'));
  const widget = nodes.find(node => node.id === 'u0').format;
  assert.ok(!widget.includes('/* F02.1_CORE */'));
  const script = widget.match(/<script>([\s\S]*?)<\/script>/)[1];
  // FlowFuse recognizes an SFC only if its first statement is the default export.
  // A top-level bootstrap before export falls back to eval and breaks at runtime.
  assert.ok(script.trimStart().startsWith('export default {'));
  // Vue's in-DOM parsing can lowercase :viewBox; object binding preserves the SVG key.
  assert.ok(widget.includes('v-bind="{viewBox:curve.viewBox}"'));
  const sandbox = vm.createContext({});
  vm.runInContext(script.replace('export default', 'globalThis.component ='), sandbox);
  const method = sandbox.component.methods.geometry;
  const s = { mode: 'demo', valid: true, distances: [70, 70, 70], sensorStatus: ['ok', 'ok', 'ok', 'ok'] };
  const result = method.call({ s }, [30, 30, 30, 30]);
  assert.ok(Math.abs(result.points[3][0] - 105) < 1e-9);
  assert.ok(Math.abs(result.points[3][1] + 210 * Math.sqrt(3) / 2) < 1e-9);
  const viewBox = result.viewBox.split(' ').map(Number); assert.equal(viewBox[2], viewBox[3]);
  assert.ok(result.head.radiusX > 0 && result.head.radiusY > 0);
  assert.ok(result.bodyPath.startsWith('M '));
  const wrap = method.call({ s }, [-175, -177, -179, 179]); assert.ok(wrap.path); // A 358-degree arc would be rejected by the core.
  assert.equal(method.call({ s: { ...s, valid: false } }, [30, 30, 30, 30]), null);
  assert.equal(method.call({ s: { ...s, distances: undefined } }, [30, 30, 30, 30]), null);
  assert.equal(method.call({ s: { ...s, mode: 'production' } }, [30, 30, 30, 30]), null);
});
test('UMD browser entry and Node entry give identical numerical results', () => {
  const sandbox = vm.createContext({});
  vm.runInContext(fs.readFileSync(path.join(root, 'shared/geometry/spine2d.js'), 'utf8'), sandbox);
  const input = { pitchDeg: { P1: 0, P2: 15, P3: 0, P4: 15 }, distances: { d12: 6, d23: 7, d34: 9 },
    unit: 'cm', sensorStatus: { P1: 'OK', P2: 'OK', P3: 'OK', P4: 'OK' }, frameValid: true, synchronized: true };
  const nodeResult = require('../../shared/geometry/spine2d').reconstructSpine2D(input);
  assert.equal(JSON.stringify(sandbox.Spine2D.reconstructSpine2D(input)), JSON.stringify(nodeResult));
});
