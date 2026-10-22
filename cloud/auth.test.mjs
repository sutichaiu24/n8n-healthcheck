import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import fs from 'node:fs';
import worker from './worker.mjs';
import {handleAuthRoute,viewerAllowed,COOKIE,digest} from './auth.mjs';
function fixture(){
  const db=new DatabaseSync(':memory:');db.exec(fs.readFileSync(new URL('./schema.sql',import.meta.url),'utf8'));
  const wrap=sql=>{let args=[];return {bind(...values){args=values;return this;},async first(){return db.prepare(sql).get(...args)||null;},async run(){return db.prepare(sql).run(...args);},async all(){return {results:db.prepare(sql).all(...args)};}};};
  return {db,env:{VIEW_TOKEN:'a-long-test-password',INGEST_TOKEN:'independent-agent-token',DB:{prepare:wrap,async batch(statements){return Promise.all(statements.map(s=>s.run()));}},ASSETS:{async fetch(){return new Response('<form><!-- LOGIN_MESSAGE --></form>');}}}};
}
function login({remember=true,password='a-long-test-password',origin='https://health.example'}={}){
  return new Request('https://health.example/login',{method:'POST',headers:{Origin:origin,'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({username:'health',password,...(remember?{remember:'on'}:{})})});
}
const req=cookie=>new Request('https://health.example/api/health',{headers:{Cookie:cookie}});
test('remembered login sets a secure 30-day cookie and hashes stored session',async()=>{
  const {db,env}=fixture();const now=Date.now();const r=await handleAuthRoute(login(),env,now);assert.equal(r.status,303);
  const cookie=r.headers.get('Set-Cookie');assert.match(cookie,/Max-Age=2592000/);for(const attr of ['HttpOnly','Secure','SameSite=Lax','Path=/'])assert.ok(cookie.includes(attr));
  const pair=cookie.split(';')[0];assert.equal(await viewerAllowed(req(pair),env,now),true);
  const row=db.prepare('SELECT * FROM auth_sessions').get();assert.equal(row.expires_at,now+30*86400000);assert.ok(!JSON.stringify(row).includes(pair.split('=')[1]));
  assert.equal(await viewerAllowed(req(pair),env,now+30*86400000+1),false);db.close();
});
test('unchecked remember uses a browser session cookie capped at 12 hours',async()=>{
  const {db,env}=fixture();const now=Date.now();const r=await handleAuthRoute(login({remember:false}),env,now);const cookie=r.headers.get('Set-Cookie');assert.ok(!cookie.includes('Max-Age'));assert.equal(await viewerAllowed(req(cookie.split(';')[0]),env,now+12*3600000+1),false);db.close();
});
test('logout revokes the session server-side and clears the cookie',async()=>{
  const {db,env}=fixture();const r=await handleAuthRoute(login(),env);const cookie=r.headers.get('Set-Cookie').split(';')[0];
  const logout=await handleAuthRoute(new Request('https://health.example/logout',{method:'POST',headers:{Origin:'https://health.example',Cookie:cookie}}),env);
  assert.equal(logout.status,303);assert.match(logout.headers.get('Set-Cookie'),/Max-Age=0/);assert.equal(await viewerAllowed(req(cookie),env),false);db.close();
});
test('cross-origin login/logout and incorrect credentials do not create sessions',async()=>{
  const {db,env}=fixture();assert.equal((await handleAuthRoute(login({origin:'https://evil.example'}),env)).status,403);
  const bad=await handleAuthRoute(login({password:'wrong'}),env);assert.equal(bad.status,401);assert.equal(bad.headers.get('WWW-Authenticate'),null);assert.equal(db.prepare('SELECT COUNT(*) n FROM auth_sessions').get().n,0);db.close();
});
test('login page preserves same-origin form headers instead of stripping them',async()=>{
  const {db,env}=fixture();const page=await handleAuthRoute(new Request('https://health.example/login'),env);
  assert.equal(page.headers.get('Referrer-Policy'),'same-origin');db.close();
});
test('privacy-filtered Origin is allowed only with browser same-origin Fetch Metadata',async()=>{
  const {db,env}=fixture();
  for(const origin of [null,'null']){
    const headers={'Content-Type':'application/x-www-form-urlencoded','Sec-Fetch-Site':'same-origin'};if(origin)headers.Origin=origin;
    const r=await handleAuthRoute(new Request('https://health.example/login',{method:'POST',headers,body:new URLSearchParams({username:'health',password:'a-long-test-password',remember:'on'})}),env);
    assert.equal(r.status,303);
    const cookie=r.headers.get('Set-Cookie').split(';')[0];
    const logout=await handleAuthRoute(new Request('https://health.example/logout',{method:'POST',headers:{...headers,Cookie:cookie}}),env);assert.equal(logout.status,303);
  }
  db.close();
});
test('missing or null Origin cannot bypass protection from another site',async()=>{
  const {db,env}=fixture();
  for(const fetchSite of [undefined,'cross-site','same-site','none']){
    const headers={'Content-Type':'application/x-www-form-urlencoded',Origin:'null'};if(fetchSite)headers['Sec-Fetch-Site']=fetchSite;
    const r=await handleAuthRoute(new Request('https://health.example/login',{method:'POST',headers,body:'username=health&password=a-long-test-password'}),env);assert.equal(r.status,403);
  }
  const bad=new Request('https://health.example/login',{method:'POST',headers:{Origin:'https://evil.example','Sec-Fetch-Site':'same-origin','Content-Type':'application/x-www-form-urlencoded'},body:'username=health&password=a-long-test-password'});
  assert.equal((await handleAuthRoute(bad,env)).status,403);db.close();
});
test('rate limiting persists in database and recovers in the next window',async()=>{
  const {db,env}=fixture();const now=9000000;
  for(let i=0;i<10;i++)assert.equal((await handleAuthRoute(login({password:'wrong'}),env,now)).status,401);
  assert.equal((await handleAuthRoute(login(),env,now)).status,429);assert.equal((await handleAuthRoute(login(),env,now+900000)).status,303);db.close();
});
test('cookie tampering and password rotation invalidate sessions',async()=>{
  const {db,env}=fixture();const r=await handleAuthRoute(login(),env);const cookie=r.headers.get('Set-Cookie').split(';')[0];
  assert.equal(await viewerAllowed(req(COOKIE+'='+'b'.repeat(64)),env),false);
  assert.equal(await viewerAllowed(req(cookie),{...env,VIEW_TOKEN:'rotated-password'}),false);db.close();
});
test('worker redirects anonymous pages, exposes login, and preserves agent endpoint',async()=>{
  const {db,env}=fixture();const page=await worker.fetch(new Request('https://health.example/'),env);assert.equal(page.status,303);assert.equal(page.headers.get('Location'),'/login');
  assert.equal((await worker.fetch(new Request('https://health.example/login'),env)).status,200);
  assert.equal((await worker.fetch(new Request('https://health.example/api/health'),env)).status,401);
  assert.equal((await worker.fetch(new Request('https://health.example/api/ingest',{method:'POST'}),env)).status,401);db.close();
});
