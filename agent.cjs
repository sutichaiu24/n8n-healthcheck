'use strict';
const fs=require('node:fs');
if(fs.existsSync('.env'))process.loadEnvFile('.env');
const {snapshot,startLocalServer}=require('./server.cjs');
const configFile=process.env.HEALTH_AGENT_CONFIG || require('node:path').join(require('node:os').homedir(),'.n8n-healthcheck','agent.json');
let config;
try {config=JSON.parse(fs.readFileSync(configFile,'utf8'));}catch {console.error('Agent configuration missing. Run Cloudflare deployment first.');process.exit(1);}
const endpoint=new URL(config.endpoint);
if(endpoint.protocol!=='https:'||endpoint.pathname!=='/api/ingest'||!config.ingestToken) throw Error('Invalid agent configuration');
const statusFile=require('node:path').join(require('node:path').dirname(configFile),'agent-status.json');
let lastDeliveredAt=null;
function recordStatus(result){try{fs.writeFileSync(statusFile,JSON.stringify({attemptedAt:new Date().toISOString(),lastDeliveredAt,...result}));}catch{}}
const local=startLocalServer();
local.on('error',error=>{if(error.code==='EADDRINUSE'){console.log('Existing local dashboard detected; continuing the independent cloud sender.');}else{console.error('Local dashboard failed:',error.code);}});
async function tick() {
  const started=Date.now();
  try {
    let result;
    try {result=await snapshot();}catch {result={checkedAt:new Date().toISOString(),checks:[{id:'n8n',title:'n8n',status:'unknown',detail:'ตัวเก็บสถานะอ่านข้อมูลไม่ได้'}],executions:[]};}
    const response=await fetch(endpoint,{method:'POST',redirect:'error',headers:{'Content-Type':'application/json',Authorization:'Bearer '+config.ingestToken},body:JSON.stringify(result),signal:AbortSignal.timeout(12000)});
    if(!response.ok) throw Error('HTTP '+response.status);
    lastDeliveredAt=new Date().toISOString();recordStatus({status:'delivered'});
    console.log(new Date().toISOString()+' Health snapshot delivered');
  } catch(error) {const errorCode=error.cause?.code || (/^HTTP \d+$/.test(error.message)?error.message:error.name);recordStatus({status:'failed',errorCode});console.error(new Date().toISOString()+' Delivery failed: '+errorCode);}
  setTimeout(tick,Math.max(1000,60000-(Date.now()-started)));
}
tick();
