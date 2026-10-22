import test from 'node:test';
import assert from 'node:assert/strict';
import worker,{sanitize,withFreshness,withHistoryCoverage} from './worker.mjs';
import {digest,COOKIE} from './auth.mjs';
const data=()=>({checkedAt:new Date().toISOString(),checks:[{id:'n8n',title:'n8n',status:'ok',detail:'HTTP 200',accessToken:'must-not-leak'}],executions:[],secret:'must-not-leak'});
test('payload is allowlisted, no credentials, missing checks are unknown',()=>{const x=sanitize(data());assert.equal(x.checks.length,6);assert.equal(x.checks.filter(c=>c.status==='unknown').length,5);assert.ok(!JSON.stringify(x).includes('must-not-leak'));});
test('older agents and stored snapshots can contain the retired public-domain check',()=>{const input=data();input.checks.push({id:'public',title:'Public domain',status:'warn',detail:'Login redirect'});assert.ok(!sanitize(input).checks.some(c=>c.id==='public'));assert.ok(!withFreshness(input,new Date().toISOString()).checks.some(c=>c.id==='public'));});
test('reject replay and invalid status',()=>{assert.throws(()=>sanitize({...data(),checkedAt:'2020-01-01T00:00:00Z'}));const x=data();x.checks[0].status='green';assert.throws(()=>sanitize(x));});
test('stale agent cannot leave green cards visible',()=>{const p=sanitize(data());const x=withFreshness(p,new Date(Date.now()-181000).toISOString());assert.equal(x.cloud.stale,true);assert.ok(x.checks.every(c=>c.status==='unknown'));});
test('fresh agent retains status',()=>{const p=sanitize(data());const x=withFreshness(p,new Date().toISOString());assert.equal(x.cloud.stale,false);assert.equal(x.checks[0].status,'ok');});
test('an hourly bucket is green-eligible only after complete, continuous coverage',()=>{
  const now=Date.parse('2026-10-17T10:02:00Z');const row={hour_start:'2026-10-17T09:00:00.000Z',check_id:'n8n',status:'ok',sample_count:60,first_checked_at:'2026-10-17T09:00:10.000Z',last_checked_at:'2026-10-17T09:59:10.000Z',max_gap_seconds:70};
  assert.equal(withHistoryCoverage([row],now)[0].complete,true);
  assert.equal(withHistoryCoverage([{...row,sample_count:49}],now)[0].complete,false);
  assert.equal(withHistoryCoverage([{...row,max_gap_seconds:240}],now)[0].complete,false);
  assert.equal(withHistoryCoverage([{...row,hour_start:'2026-10-17T10:00:00.000Z'}],now)[0].complete,false);
});
test('page redirects to login and API denies unauthenticated reads and writes',async()=>{const env={VIEW_TOKEN:'viewer-secret',INGEST_TOKEN:'ingest-secret'};for(const route of ['/','/api/health','/api/ingest']){const r=await worker.fetch(new Request('https://health.example'+route,{method:route.endsWith('ingest')?'POST':'GET'}),env);assert.equal(r.status,route==='/'?303:401);assert.equal(r.headers.get('WWW-Authenticate'),null);}});
test('viewer password cannot write monitoring data',async()=>{const r=await worker.fetch(new Request('https://health.example/api/ingest',{method:'POST',headers:{Authorization:'Bearer viewer-secret'}}),{VIEW_TOKEN:'viewer-secret',INGEST_TOKEN:'ingest-secret'});assert.equal(r.status,401);});
test('authorized upload, private read, and stale detection work together',async()=>{
  let row;let batchStatements=[];const hourlyRows=[];
  const credentialHash=await digest('viewer-secret');
  const env={VIEW_TOKEN:'viewer-secret',INGEST_TOKEN:'ingest-secret',DB:{prepare(sql){const statement={sql,args:[],bind(...args){this.args=args;return this;},async first(){return sql.includes('FROM auth_sessions')?{expires_at:Date.now()+60000,credential_hash:credentialHash}:row;},async all(){return {results:hourlyRows};}};return statement;},async batch(statements){batchStatements=statements;const latest=statements.find(s=>s.sql.startsWith('INSERT INTO latest_health'));row={received_at:latest.args[0],payload:latest.args[1]};return [];}}};
  const upload=await worker.fetch(new Request('https://health.example/api/ingest',{method:'POST',headers:{Authorization:'Bearer ingest-secret'},body:JSON.stringify(data())}),env);
  assert.equal(upload.status,200);assert.ok(row);assert.ok(!row.payload.includes('must-not-leak'));assert.equal(batchStatements.filter(s=>s.sql.includes('INSERT INTO health_hourly')).length,6);
  const read=()=>worker.fetch(new Request('https://health.example/api/health',{headers:{Cookie:COOKIE+'='+'a'.repeat(64)}}),env);
  let response=await read();assert.equal(response.status,200);const fresh=await response.json();assert.equal(fresh.cloud.stale,false);assert.deepEqual(fresh.history,[]);
  row.received_at=new Date(Date.now()-181000).toISOString();response=await read();const stale=await response.json();assert.equal(stale.cloud.stale,true);assert.ok(stale.checks.every(c=>c.status==='unknown'));
});
