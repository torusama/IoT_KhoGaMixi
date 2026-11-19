'use strict';
const path = require('node:path');
const fs = require('node:fs');
const { parseEnv } = require('node:util');
const { createBackendDashboard } = require('./backend-adapter');

const functionGlobalContext = {};
if ((process.env.SPT_MODE || '').toLowerCase() === 'connected') {
  const envPath = path.resolve(__dirname, '../../backend/.env');
  const local = fs.existsSync(envPath) ? parseEnv(fs.readFileSync(envPath, 'utf8')) : {};
  const token = process.env.SPT_API_TOKEN || process.env.API_TOKEN || local.API_TOKEN;
  if (!token) throw new Error('Run npm run configure in backend or set SPT_API_TOKEN.');
  functionGlobalContext.connectedDashboard = createBackendDashboard({
    baseUrl: process.env.SPT_BACKEND_URL || `http://127.0.0.1:${local.PORT || 1880}`,
    deviceId: process.env.SPT_DEVICE_ID || local.DEVICE_ID || 'esp32_01',
    token
  });
}
module.exports = {uiHost:'127.0.0.1',uiPort:Number(process.env.SPT_PORT||1881),flowFile:path.join(__dirname,'flows_spt_frontend.json'),
  httpAdminRoot:false, functionGlobalContext, logging:{console:{level:'info'}}};
