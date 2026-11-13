'use strict';
const path = require('node:path');
module.exports = {uiHost:'127.0.0.1',uiPort:Number(process.env.SPT_PORT||1881),flowFile:path.join(__dirname,'flows_spt_frontend.json'),httpAdminRoot:false,logging:{console:{level:'info'}}};
