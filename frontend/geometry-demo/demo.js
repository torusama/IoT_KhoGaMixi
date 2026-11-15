'use strict';
const byId = id => document.getElementById(id);
const ids = ['P1', 'P2', 'P3', 'P4'];
const presets = { straight: [0, 0, 0, 0], tilted: [30, 30, 30, 30], c: [30, 20, 10, 0], s: [0, 15, 0, 15] };
const number = id => byId(id).valueAsNumber; // Blank controls remain invalid, never silently become zero.
const fmt = value => value === null ? '—' : Number(value.toPrecision(6)).toString();
const colors = ['#517bc0', '#43876c', '#b37146'];
function svgElement(name, attributes) {
  const node = document.createElementNS('http://www.w3.org/2000/svg', name);
  Object.entries(attributes).forEach(([key, value]) => node.setAttribute(key, value));
  return node;
}
function render() {
  const result = Spine2D.reconstructSpine2D({
    pitchDeg: Object.fromEntries(ids.map(id => [id, number(id)])),
    distances: Object.fromEntries(['d12', 'd23', 'd34'].map(id => [id, number(id)])),
    unit: byId('unit').value, frameValid: byId('frame').checked, synchronized: byId('sync').checked,
    sensorStatus: Object.fromEntries(ids.map(id => [id, byId('sensors').checked ? 'OK' : 'MISSING']))
  }, { epsilonDeg: number('epsilon'), samplesPerSegment: number('samples') });
  byId('output').textContent = JSON.stringify(result, null, 2);
  byId('plot').replaceChildren(); byId('segments').replaceChildren(); byId('coordinates').textContent = '';
  byId('status').className = result.valid ? '' : 'invalid';
  byId('status').textContent = result.valid ? `Valid · ${fmt(result.totalLength)} ${result.unit} · Simulation` : `Invalid · ${result.error.code}: ${result.error.message}`;
  if (!result.valid) return;
  const xs = result.curvePoints.map(p => p.x), ys = result.curvePoints.map(p => p.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  // One uniform scale for both axes; flip Y only at the SVG boundary.
  const extent = Math.max(maxX - minX, maxY - minY);
  const midX = (minX + maxX) / 2, midY = (minY + maxY) / 2;
  const pixel = p => ({ x: 300 + ((p.x - midX) / extent) * 340, y: 220 - ((p.y - midY) / extent) * 340 });
  result.segments.forEach((segment, i) => {
    const d = segment.polyline.map((p, j) => { const q = pixel(p); return `${j ? 'L' : 'M'} ${q.x} ${q.y}`; }).join(' ');
    byId('plot').append(svgElement('path', { d, fill: 'none', stroke: colors[i], 'stroke-width': 4 }));
    const row = document.createElement('tr');
    [segment.from + '→' + segment.to, segment.type, fmt(segment.deltaDeg), fmt(segment.radius), fmt(segment.curvature)].forEach(value => {
      const cell = document.createElement('td'); cell.textContent = value; row.append(cell);
    }); byId('segments').append(row);
  });
  Object.entries(result.points).forEach(([id, p]) => {
    const q = pixel(p), label = svgElement('text', { x: q.x + 10, y: q.y + 4 }); label.textContent = id;
    byId('plot').append(svgElement('circle', { cx: q.x, cy: q.y, r: 4, fill: '#20304b' }), label);
  });
  byId('coordinates').textContent = `R: ${result.unit}; κ: ${result.unit}⁻¹. ` + Object.entries(result.points).map(([id, p]) => `${id}=(${fmt(p.x)}, ${fmt(p.y)})`).join(' · ');
}
function reset() {
  presets[byId('preset').value].forEach((pitch, i) => { byId(ids[i]).value = pitch; });
  ['d12', 'd23', 'd34'].forEach(id => { byId(id).value = byId('unit').value === 'cm' ? 7 : 70; });
  ['frame', 'sensors', 'sync'].forEach(id => { byId(id).checked = true; });
  byId('epsilon').value = 0.3; byId('samples').value = 25; render();
}
byId('controls').addEventListener('submit', event => event.preventDefault());
byId('controls').addEventListener('input', render);
byId('preset').addEventListener('change', reset);
byId('reset').addEventListener('click', reset);
render();
