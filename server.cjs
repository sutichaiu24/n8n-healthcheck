"use strict";
if (require('node:fs').existsSync('.env')) process.loadEnvFile('.env');
const os = require('node:os');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const dns = require('node:dns/promises');
const {DatabaseSync} = require('node:sqlite');
const base = process.env.N8N_INSTALL || path.join(__dirname,'node_modules');
const dataRoot = process.env.N8N_DATA || path.join(os.homedir(),'.n8n');
const workflowId = process.env.N8N_WORKFLOW_ID || '';
const n8nOrigin = process.env.N8N_URL || 'http://127.0.0.1:5678';
const publicOrigin = (process.env.N8N_PUBLIC_URL || 'https://n8n.example.com').replace(/\/$/,'');
const supabaseUrl = process.env.SUPABASE_URL || '';
if (!/^https?:$/.test(new URL(publicOrigin).protocol)) throw Error('N8N_PUBLIC_URL must be HTTP(S)');
const port = Number(process.env.HEALTH_PORT || 8787);
let cache, inFlight;
const state = (id, title, status, detail, extra={}) => ({id,title,status,detail,...extra});
async function probe(url) {
  const start=Date.now();
  const response=await fetch(url,{signal:AbortSignal.timeout(7000),redirect:'manual'});
  return {status:response.status,ms:Date.now()-start};
}
async function collect() {
  const checks=[]; let executions=[], routes=[], trigger, credentialId;
  const health=probe(new URL('/healthz/readiness',n8nOrigin).href).then(r=>checks.push(state('n8n','n8n พร้อมทำงาน',r.status===200?'ok':'error',`HTTP ${r.status} · ${r.ms} ms`))).catch(()=>checks.push(state('n8n','n8n พร้อมทำงาน','error','เชื่อมต่อ n8n ไม่สำเร็จ')));
  let db;
  try {
    db=new DatabaseSync(path.join(dataRoot,'database.sqlite'),{readOnly:true});
    db.exec('PRAGMA busy_timeout=2000');
    const workflow=db.prepare('SELECT id,name,active,nodes FROM workflow_entity WHERE id=?').get(workflowId);
    if(!workflow) throw new Error('Workflow missing');
    routes=db.prepare('SELECT webhookPath,method FROM webhook_entity WHERE workflowId=?').all(workflowId);
    trigger=JSON.parse(workflow.nodes).find(n=>n.type.includes('telegramTrigger'));
    credentialId=trigger?.credentials?.telegramApi?.id;
    checks.push(state('workflow','Workflow และ webhook',workflow.active&&routes.length?'ok':'error',`${workflow.name} · ${workflow.active?'Active':'Inactive'} · ${routes.length} เส้นทาง`));
    checks.push(state('database','ฐานข้อมูล n8n','ok','อ่านฐานข้อมูลจริงแบบ read-only สำเร็จ'));
    const {parse}=require(path.join(base,'flatted'));
    executions=db.prepare('SELECT e.id,e.workflowId,w.name,e.status,e.startedAt,e.stoppedAt FROM execution_entity e LEFT JOIN workflow_entity w ON w.id=e.workflowId ORDER BY e.id DESC LIMIT 12').all().map(e=>{
      let node=''; let error='';
      if(e.status==='error') {
        try {const r=db.prepare('SELECT data FROM execution_data WHERE executionId=?').get(e.id);const x=parse(r.data);node=x.resultData?.lastNodeExecuted||'';const code=x.resultData?.error?.httpCode;error=code ? String(code) : 'Workflow ล้มเหลว — เปิด execution เพื่อดูรายละเอียด';}catch{error='อ่านรายละเอียดไม่ได้';}
      }
      const asUTC=value=>value?value.replace(' ','T').replace(/Z$/,'')+'Z':null;
      return {...e,startedAt:asUTC(e.startedAt),stoppedAt:asUTC(e.stoppedAt),node,error};
    });
    const last=db.prepare('SELECT status,startedAt FROM execution_entity WHERE workflowId=? ORDER BY id DESC LIMIT 1').get(workflowId);
    checks.push(state('bot','ผลล่าสุดของบอต',!last?'unknown':last.status==='success'?'ok':last.status==='error'?'error':'warn',last?`รายการล่าสุด: ${last.status} (ไม่ใช่การส่งข้อความทดสอบใหม่)`:'ยังไม่มีประวัติ'));
    if(credentialId) {
      try {
        const {CipherAes256CBC}=require(path.join(base,'n8n-core/dist/encryption/aes-256-cbc.js'));
        const row=db.prepare('SELECT data FROM credentials_entity WHERE id=?').get(credentialId);
        const key=JSON.parse(fs.readFileSync(path.join(dataRoot,'config'),'utf8')).encryptionKey;
        const cred=JSON.parse(new CipherAes256CBC().decrypt(row.data,key));
        const response=await fetch('https://api.telegram.org/bot'+cred.accessToken+'/getWebhookInfo',{signal:AbortSignal.timeout(8000)});
        const result=await response.json(); if(!result.ok) throw new Error('Telegram API failed');
        const t=result.result;
        const expected=routes.map(r=>publicOrigin+'/webhook/'+r.webhookPath);
        const matches=expected.includes(t.url);
        checks.push(state('telegram','Telegram webhook',!t.url||!matches?'error':t.pending_update_count>0?'warn':'ok',!t.url?'ไม่ได้ลงทะเบียน URL':!matches?'URL ไม่ตรงกับเส้นทางของ workflow':`URL ตรงกัน · ข้อความค้าง ${t.pending_update_count}`,{pending:t.pending_update_count,lastErrorAt:t.last_error_date?new Date(t.last_error_date*1000).toISOString():null,lastError:t.last_error_message?.includes('404')?'HTTP 404':t.last_error_message?'Telegram เคยรายงานข้อผิดพลาด':null}));
      }catch { checks.push(state('telegram','Telegram webhook','unknown','ตรวจ API ไม่สำเร็จ — ยังสรุปสถานะไม่ได้')); }
    } else checks.push(state('telegram','Telegram webhook','unknown','ไม่พบ Telegram credential ของ workflow'));
  } catch {checks.push(state('database','ฐานข้อมูล / workflow','unknown','อ่านข้อมูลไม่ได้ ตรวจสิทธิ์ของผู้รัน dashboard'));}
  finally {db?.close();}
  await health;
  await Promise.all([
    (async()=>{if(!supabaseUrl){checks.push(state('supabase','Supabase และ DNS','unknown','ยังไม่ได้ตั้งค่า SUPABASE_URL'));return;}try{await dns.lookup(new URL(supabaseUrl).hostname);const r=await probe(new URL('/rest/v1/',supabaseUrl).href);checks.push(state('supabase','Supabase และ DNS',[200,401,403].includes(r.status)?'ok':'warn',`DNS ตอบ · HTTP ${r.status} · ${r.ms} ms (ไม่ทดสอบสิทธิ์เขียน)`));}catch{checks.push(state('supabase','Supabase และ DNS','error','DNS หรือการเชื่อมต่อ HTTPS ไม่สำเร็จ'));}})(),
  ]);
  const order=['n8n','workflow','telegram','bot','database','supabase'];checks.sort((a,b)=>order.indexOf(a.id)-order.indexOf(b.id));
  return {checkedAt:new Date().toISOString(),checks,executions,mode:'read-only',intervalSeconds:30};
}
async function snapshot() {
  if(cache&&Date.now()-cache.time<10000)return cache.value;
  if(!inFlight) inFlight=collect().then(value=>{cache={time:Date.now(),value};return value;}).finally(()=>{inFlight=null;});
  return inFlight;
}
const server=http.createServer(async(req,res)=>{
  const allowedHosts=new Set([`127.0.0.1:${port}`,`localhost:${port}`,`[::1]:${port}`]);
  if(!allowedHosts.has(req.headers.host)){res.writeHead(403);return res.end('Local access only');}
  const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY','Referrer-Policy':'no-referrer'};
  if(req.method!=='GET'){res.writeHead(405,headers);return res.end();}
  if(req.url==='/api/health') {try{res.writeHead(200,{...headers,'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(await snapshot()));}catch{res.end(JSON.stringify({error:'Health collection failed'}));}return;}
  if(req.url==='/'||req.url==='/index.html'){res.writeHead(200,{...headers,'Content-Type':'text/html; charset=utf-8'});return res.end(fs.readFileSync(path.join(__dirname,'index.html'),'utf8').replaceAll('https://n8n.example.com',publicOrigin));}
  res.writeHead(404,headers);res.end();
});
function startLocalServer() {
  server.listen(port,'127.0.0.1',()=>console.log(`Health dashboard: http://127.0.0.1:${port}`));
  return server;
}
module.exports = { snapshot, startLocalServer };
if (require.main === module) startLocalServer();
