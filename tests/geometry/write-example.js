'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { reconstructSpine2D } = require('../../shared/geometry/spine2d');
const ids = ['P1', 'P2', 'P3', 'P4'];
const pitches = require('./fixtures.json').reference;
const input = { pitchDeg: Object.fromEntries(ids.map((id, i) => [id, pitches[i]])),
  distances: { d12: 7, d23: 7, d34: 7 }, unit: 'cm', frameValid: true, synchronized: true,
  sensorStatus: Object.fromEntries(ids.map(id => [id, 'OK'])) };
const options = { samplesPerSegment: 5 };
const output = { source: 'Simulation', input, options, result: reconstructSpine2D(input, options) };
fs.writeFileSync(path.join(__dirname, 'example-output.json'), JSON.stringify(output, null, 2) + '\n');
