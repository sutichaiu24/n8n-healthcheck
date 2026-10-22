const test=require('node:test');
const assert=require('node:assert/strict');
const {createDemoServer}=require('./demo.cjs');
test('standalone demo serves synthetic data without live services or credentials',async()=>{
  const server=createDemoServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try{const base=`http://127.0.0.1:${server.address().port}`;const page=await fetch(base);assert.equal(page.status,200);assert.match(await page.text(),/Synthetic data only/);const data=await(await fetch(base+'/api/health')).json();assert.equal(data.demo,true);assert.equal(data.checks.length,6);assert.equal(data.history.length,144);assert.ok(data.history.some(h=>h.status==='error'));assert.equal((await fetch(base+'/api/health',{method:'POST'})).status,405);}
  finally{await new Promise(resolve=>server.close(resolve));}
});
