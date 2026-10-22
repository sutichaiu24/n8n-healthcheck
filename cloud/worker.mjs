import {viewerAllowed,handleAuthRoute} from './auth.mjs';
const headers = {
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'same-origin',
  'Strict-Transport-Security': 'max-age=31536000',
};
const json = (data, status = 200, extra = {}) => new Response(JSON.stringify(data), { status, headers: { ...headers, 'Content-Type': 'application/json; charset=utf-8', ...extra } });
const ids = new Set(['n8n','workflow','telegram','bot','database','supabase']);
const statuses = new Set(['ok','warn','error','unknown']);
const HOUR_MS=60*60*1000;
const short = (value, max=240) => typeof value === 'string' ? value.slice(0,max) : '';
function hourIso(timestamp){const d=new Date(timestamp);return new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),d.getUTCDate(),d.getUTCHours())).toISOString();}
export function withHistoryCoverage(rows, now=Date.now()) {
  const currentHour=Math.floor(now/HOUR_MS)*HOUR_MS;
  return rows.map(row=>{
    const start=Date.parse(row.hour_start),first=Date.parse(row.first_checked_at),last=Date.parse(row.last_checked_at);
    const complete=Number.isFinite(start)&&Number.isFinite(first)&&Number.isFinite(last)&&start+HOUR_MS<=currentHour&&
      Number(row.sample_count)>=50&&first<=start+120000&&last>=start+HOUR_MS-120000&&Number(row.max_gap_seconds)<=150;
    return {...row,complete};
  });
}
async function sameSecret(a,b) {
  if(!a || !b) return false;
  const enc = new TextEncoder();
  const [x,y] = await Promise.all([a,b].map(s=>crypto.subtle.digest('SHA-256',enc.encode(s))));
  const aa = new Uint8Array(x), bb = new Uint8Array(y); let difference=0;
  for(let i=0;i<aa.length;i++) difference |= aa[i]^bb[i];
  return difference===0;
}
export function sanitize(input, now=Date.now()) {
  if(!input || !Array.isArray(input.checks) || input.checks.length<1 || input.checks.length>10) throw Error('Invalid checks');
  const checked=Date.parse(input.checkedAt);
  if(!Number.isFinite(checked) || checked>now+60000 || checked<now-180000) throw Error('Invalid timestamp');
  const seen = new Set();
  const checks=input.checks.filter(c=>c.id!=='public').map(c=>{
    if(!ids.has(c.id)||!statuses.has(c.status)||seen.has(c.id)) throw Error('Invalid check');seen.add(c.id);
    const result={id:c.id,title:short(c.title,80),status:c.status,detail:short(c.detail)};
    if(c.id==='telegram') {
      result.pending=Number.isSafeInteger(c.pending)&&c.pending>=0?c.pending:null;
      result.lastErrorAt=Number.isFinite(Date.parse(c.lastErrorAt))?new Date(c.lastErrorAt).toISOString():null;
      result.lastError=short(c.lastError,100);
    }
    return result;
  });
  for(const id of ids) if(!seen.has(id)) checks.push({id,title:id,status:'unknown',detail:'ตัวตรวจไม่ได้ส่งผลรายการนี้'});
  const executions=(Array.isArray(input.executions)?input.executions:[]).slice(0,12).map(e=>({
    id:Number.isSafeInteger(e.id)?e.id:0,
    workflowId:short(e.workflowId,80),name:short(e.name,120),status:short(e.status,24),
    startedAt:Number.isFinite(Date.parse(e.startedAt))?new Date(e.startedAt).toISOString():null,
    stoppedAt:Number.isFinite(Date.parse(e.stoppedAt))?new Date(e.stoppedAt).toISOString():null,
    node:short(e.node,100),error:short(e.error,100),
  }));
  return {checkedAt:new Date(checked).toISOString(),checks,executions,mode:'read-only',intervalSeconds:60};
}
export function withFreshness(payload, receivedAt, now=Date.now()) {
  const receivedAge=now-Date.parse(receivedAt);
  const checkAge=now-Date.parse(payload.checkedAt);
  const age=Math.max(receivedAge,checkAge);
  const stale=!Number.isFinite(age)||age>180000||age< -60000;
  const checks=payload.checks.filter(c=>c.id!=='public');
  return {...payload,checks:stale?checks.map(c=>({...c,status:'unknown',detail:'ข้อมูลเก่า — เครื่องขาดการติดต่อ ห้ามใช้ยืนยันสถานะปัจจุบัน'})):checks,
    cloud:{receivedAt,stale,ageSeconds:Math.max(0,Math.floor(age/1000)),staleAfterSeconds:180},
  };
}
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if(url.pathname==='/api/ingest') {
      if(request.method!=='POST') return json({error:'Method not allowed'},405);
      const auth=request.headers.get('Authorization')||'';
      if(!auth.startsWith('Bearer ')||!await sameSecret(auth.slice(7),env.INGEST_TOKEN)) return json({error:'Unauthorized'},401);
      try {
        if(Number(request.headers.get('Content-Length'))>32768) return json({error:'Too large'},413);
        const reader=request.body?.getReader();if(!reader)return json({error:'Missing body'},400);
        const chunks=[];let size=0;
        while(true){const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>32768){await reader.cancel();return json({error:'Too large'},413);}chunks.push(value);}
        const all=new Uint8Array(size);let offset=0;for(const chunk of chunks){all.set(chunk,offset);offset+=chunk.length;}
        const payload=sanitize(JSON.parse(new TextDecoder().decode(all)));
        const receivedAt=new Date().toISOString();const bucket=hourIso(payload.checkedAt);const checkedAt=payload.checkedAt;
        const statements=[env.DB.prepare('INSERT INTO latest_health (id,received_at,payload) VALUES (1,?,?) ON CONFLICT(id) DO UPDATE SET received_at=excluded.received_at,payload=excluded.payload').bind(receivedAt,JSON.stringify(payload))];
        for(const check of payload.checks) statements.push(env.DB.prepare(`INSERT INTO health_hourly (hour_start,check_id,status,sample_count,first_checked_at,last_checked_at,max_gap_seconds) VALUES (?,?,?,1,?,?,0)
          ON CONFLICT(hour_start,check_id) DO UPDATE SET
            status=CASE WHEN CASE excluded.status WHEN 'error' THEN 3 WHEN 'warn' THEN 2 WHEN 'unknown' THEN 1 ELSE 0 END > CASE health_hourly.status WHEN 'error' THEN 3 WHEN 'warn' THEN 2 WHEN 'unknown' THEN 1 ELSE 0 END THEN excluded.status ELSE health_hourly.status END,
            sample_count=health_hourly.sample_count+CASE WHEN excluded.last_checked_at>health_hourly.last_checked_at THEN 1 ELSE 0 END,
            first_checked_at=MIN(health_hourly.first_checked_at,excluded.first_checked_at),
            max_gap_seconds=MAX(health_hourly.max_gap_seconds,CASE WHEN excluded.last_checked_at>health_hourly.last_checked_at THEN MAX(0,CAST(strftime('%s',excluded.last_checked_at) AS INTEGER)-CAST(strftime('%s',health_hourly.last_checked_at) AS INTEGER)) ELSE 0 END),
            last_checked_at=MAX(health_hourly.last_checked_at,excluded.last_checked_at)`).bind(bucket,check.id,check.status,checkedAt,checkedAt));
        if(new Date(checkedAt).getUTCMinutes()===0) statements.push(env.DB.prepare('DELETE FROM health_hourly WHERE hour_start < ?').bind(new Date(Date.parse(bucket)-30*24*HOUR_MS).toISOString()));
        await env.DB.batch(statements);
        return json({ok:true,receivedAt});
      } catch { return json({error:'Invalid payload or storage unavailable'},400); }
    }
    if(!env.VIEW_TOKEN || !env.INGEST_TOKEN) return json({error:'Dashboard not configured'},503);
    try {
      const authResponse=await handleAuthRoute(request,env);if(authResponse)return authResponse;
      if(!await viewerAllowed(request,env))return url.pathname.startsWith('/api/')?json({error:'Unauthorized'},401):new Response(null,{status:303,headers:{...headers,Location:'/login'}});
    } catch {return json({error:'Login service unavailable'},503);}
    if(request.method!=='GET') return json({error:'Method not allowed'},405);
    if(url.pathname==='/api/health') {
      try {
        const now=Date.now();const currentHour=Math.floor(now/HOUR_MS)*HOUR_MS;const from=new Date(currentHour-23*HOUR_MS).toISOString();
        const [row,hourRows]=await Promise.all([
          env.DB.prepare('SELECT received_at,payload FROM latest_health WHERE id=1').first(),
          env.DB.prepare('SELECT hour_start,check_id,status,sample_count,first_checked_at,last_checked_at,max_gap_seconds FROM health_hourly WHERE hour_start>=? ORDER BY hour_start,check_id').bind(from).all(),
        ]);
        const history=withHistoryCoverage(hourRows.results||[],now);
        if(!row)return json({checkedAt:null,checks:[{id:'agent',title:'ตัวส่งสถานะจากเครื่อง',status:'unknown',detail:'ยังไม่ได้รับข้อมูลจากเครื่อง n8n'}],executions:[],history,cloud:{stale:true,receivedAt:null,ageSeconds:null},mode:'read-only'});
        return json({...withFreshness(JSON.parse(row.payload),row.received_at),history});
      } catch { return json({error:'Storage unavailable'},503); }
    }
    if(url.pathname==='/'||url.pathname==='/index.html') {
      const asset=await env.ASSETS.fetch(new URL('/index.html',request.url));
      return new Response(asset.body,{status:asset.status,headers:{...headers,'Content-Type':'text/html; charset=utf-8'}});
    }
    return json({error:'Not found'},404);
  }
};
