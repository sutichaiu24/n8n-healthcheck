const COOKIE='__Host-expense_health';
const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY','Referrer-Policy':'same-origin','Strict-Transport-Security':'max-age=31536000'};
const redirect=(location,cookie)=>new Response(null,{status:303,headers:{...headers,Location:location,...(cookie?{'Set-Cookie':cookie}:{})}});
const hex=bytes=>Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
export const digest=async value=>hex(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))));
function sessionToken(request){const token=(request.headers.get('Cookie')||'').split(';').map(c=>c.trim()).find(c=>c.startsWith(COOKIE+'='))?.slice(COOKIE.length+1);return /^[0-9a-f]{64}$/.test(token||'')?token:null;}
export async function viewerAllowed(request,env,now=Date.now()) {
  const token=sessionToken(request);if(!token)return false;
  const row=await env.DB.prepare('SELECT expires_at,credential_hash FROM auth_sessions WHERE token_hash=?').bind(await digest(token)).first();
  return !!row&&row.expires_at>now&&row.credential_hash===await digest(env.VIEW_TOKEN);
}
async function loginPage(request,env,error='',status=200){
  const asset=await env.ASSETS.fetch(new URL('/login.html',request.url));
  if(asset.status!==200)return new Response('Login page unavailable',{status:503,headers});
  const html=(await asset.text()).replace('<!-- LOGIN_MESSAGE -->',error?'<p class="error" role="alert">'+error+'</p>':'');
  return new Response(html,{status,headers:{...headers,'Content-Type':'text/html; charset=utf-8'}});
}
export async function handleAuthRoute(request,env,now=Date.now()){
  const url=new URL(request.url);
  if(!['/login','/logout','/login.html'].includes(url.pathname))return null;
  if(request.method==='GET'&&url.pathname!=='/logout')return await viewerAllowed(request,env,now)?redirect('/'):loginPage(request,env);
  if(request.method!=='POST'||url.pathname==='/login.html')return new Response('Method not allowed',{status:405,headers});
  const origin=request.headers.get('Origin');
  const trustedPost=origin===url.origin||((!origin||origin==='null')&&request.headers.get('Sec-Fetch-Site')==='same-origin');
  if(!trustedPost)return new Response('Invalid request origin',{status:403,headers});
  if(url.pathname==='/logout'){
    const token=sessionToken(request);
    if(token)await env.DB.prepare('DELETE FROM auth_sessions WHERE token_hash=?').bind(await digest(token)).run();
    return redirect('/login',COOKIE+'=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0');
  }
  if(!request.headers.get('Content-Type')?.startsWith('application/x-www-form-urlencoded'))return new Response('Unsupported form',{status:415,headers});
  if(Number(request.headers.get('Content-Length'))>4096)return new Response('Form too large',{status:413,headers});
  const reader=request.body?.getReader();if(!reader)return new Response('Missing form',{status:400,headers});
  const chunks=[];let size=0;
  while(true){const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>4096){await reader.cancel();return new Response('Form too large',{status:413,headers});}chunks.push(value);}
  const all=new Uint8Array(size);let offset=0;for(const chunk of chunks){all.set(chunk,offset);offset+=chunk.length;}
  const form=new URLSearchParams(new TextDecoder().decode(all));
  const ipHash=await digest(request.headers.get('CF-Connecting-IP')||'unknown');
  const bucket=Math.floor(now/900000);
  const attempts=await env.DB.prepare('INSERT INTO auth_login_limits (ip_hash,bucket,attempts) VALUES (?,?,1) ON CONFLICT(ip_hash) DO UPDATE SET attempts=CASE WHEN auth_login_limits.bucket=excluded.bucket THEN auth_login_limits.attempts+1 ELSE 1 END,bucket=excluded.bucket RETURNING attempts').bind(ipHash,bucket).first();
  if(!attempts||attempts.attempts>10)return loginPage(request,env,'ลองเข้าสู่ระบบหลายครั้งเกินไป กรุณารอ 15 นาทีแล้วลองใหม่',429);
  const password=form.get('password')||'';
  if(form.get('username')!=='health'||!password||await digest(password)!==await digest(env.VIEW_TOKEN))return loginPage(request,env,'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง',401);
  const remember=form.get('remember')==='on';
  const duration=remember?30*86400:12*3600;
  const token=hex(crypto.getRandomValues(new Uint8Array(32)));
  await env.DB.batch([
    env.DB.prepare('INSERT INTO auth_sessions (token_hash,created_at,expires_at,credential_hash) VALUES (?,?,?,?)').bind(await digest(token),now,now+duration*1000,await digest(env.VIEW_TOKEN)),
    env.DB.prepare('DELETE FROM auth_sessions WHERE expires_at<=?').bind(now),
    env.DB.prepare('DELETE FROM auth_login_limits WHERE ip_hash=? OR bucket<?').bind(ipHash,bucket-1),
  ]);
  return redirect('/',`${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax${remember?'; Max-Age='+duration:''}`);
}
export {COOKIE};
