'use strict';
const http=require('node:http');
const fs=require('node:fs');
const path=require('node:path');
function buildSnapshot(now=Date.now()){
  const hour=3600000,current=Math.floor(now/hour)*hour;
  const checks=[
    {id:'n8n',title:'n8n พร้อมทำงาน',status:'ok',detail:'HTTP 200 · 8 ms'},
    {id:'workflow',title:'Workflow และ webhook',status:'ok',detail:'Example workflow · Active · 1 เส้นทาง'},
    {id:'telegram',title:'Telegram webhook',status:'ok',detail:'URL ตรงกัน · ข้อความค้าง 0',pending:0},
    {id:'bot',title:'ผลล่าสุดของบอต',status:'ok',detail:'รายการล่าสุด: success — ข้อมูลจำลอง'},
    {id:'database',title:'ฐานข้อมูล n8n',status:'ok',detail:'ตัวอย่างผลตรวจแบบ read-only'},
    {id:'supabase',title:'Supabase และ DNS',status:'ok',detail:'DNS ตอบ · HTTP 401 · 120 ms (ตัวอย่าง)'},
  ];
  const history=[];
  for(let i=23;i>=0;i--)for(const c of checks){const start=current-i*hour;history.push({hour_start:new Date(start).toISOString(),check_id:c.id,status:i===5&&c.id==='n8n'?'error':i===5&&c.id==='telegram'?'warn':'ok',sample_count:i?60:Math.max(1,new Date(now).getUTCMinutes()),first_checked_at:new Date(start+10000).toISOString(),last_checked_at:new Date(i?start+hour-50000:now).toISOString(),max_gap_seconds:60,complete:i>0});}
  return {demo:true,mode:'synthetic-demo',checkedAt:new Date(now).toISOString(),intervalSeconds:60,cloud:{receivedAt:new Date(now).toISOString(),stale:false,ageSeconds:0,staleAfterSeconds:180},checks,history,executions:[{id:101,workflowId:'demo-workflow',name:'Example expense workflow',status:'success',startedAt:new Date(now-90000).toISOString(),stoppedAt:new Date(now-85000).toISOString(),node:'Reply - Success',error:''}]};
}
function createDemoServer(){return http.createServer((req,res)=>{
  const port=res.socket.localPort;
  const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY'};
  if(![`127.0.0.1:${port}`,`localhost:${port}`].includes(req.headers.host)){res.writeHead(403,headers);return res.end();}
  if(req.method!=='GET'){res.writeHead(405,headers);return res.end();}
  const url=new URL(req.url,'http://127.0.0.1');
  if(url.pathname==='/api/health'){res.writeHead(200,{...headers,'Content-Type':'application/json; charset=utf-8'});return res.end(JSON.stringify(buildSnapshot()));}
  if(url.pathname==='/'){
    let html=fs.readFileSync(path.join(__dirname,'index.html'),'utf8');
    html=html.replace(/<body([^>]*)>/,'<body$1><div role="status" style="padding:12px 20px;background:#fff3cf;color:#634600;text-align:center;font:500 13px system-ui">DEMO · Synthetic data only · ไม่ได้เชื่อมต่อ n8n, Telegram หรือ Cloudflare จริง</div>');
    res.writeHead(200,{...headers,'Content-Type':'text/html; charset=utf-8'});return res.end(html);
  }
  res.writeHead(404,headers);res.end();
});}
module.exports={buildSnapshot,createDemoServer};
if(require.main===module){const port=Number(process.env.DEMO_PORT||8788);createDemoServer().listen(port,'127.0.0.1',()=>console.log(`Synthetic demo: http://127.0.0.1:${port}`));}
