import fs from 'node:fs';

const source = new URL('../index.html', import.meta.url);
const outputDir = new URL('./dist/', import.meta.url);
fs.mkdirSync(outputDir, { recursive: true });
let dashboard=fs.readFileSync(source,'utf8');
dashboard=dashboard.replace('<button type="button" id="refresh"','<form method="post" action="/logout" style="margin:0"><button type="submit" style="height:44px;padding:0 14px;border:1px solid #E3E6EB;border-radius:10px;background:#fff;color:#525A66;font:500 13px inherit;cursor:pointer">ออกจากระบบ</button></form><button type="button" id="refresh"');
dashboard=dashboard.replace('if(!response.ok)throw Error();','if(response.status===401){window.location.replace("/login");return;}if(!response.ok)throw Error();');
fs.writeFileSync(new URL('./dist/index.html',import.meta.url),dashboard);
const fontFaces=dashboard.match(/<style id="embedded-fonts">[\s\S]*?<\/style>/)?.[0]||'';
const login=fs.readFileSync(new URL('./login.html',import.meta.url),'utf8').replace('<!-- EMBEDDED_FONTS -->',fontFaces);
fs.writeFileSync(new URL('./dist/login.html',import.meta.url),login);
console.log('Cloud dashboard built from the reference layout.');
