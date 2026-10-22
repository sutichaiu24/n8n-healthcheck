import fs from 'node:fs';
const source=new URL('../index.html',import.meta.url);
const url='https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Thai:wght@400;500;600;700&family=Manrope:wght@400..800&display=swap';
const response=await fetch(url,{headers:{'User-Agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'},signal:AbortSignal.timeout(20000)});
if(!response.ok)throw Error('Font stylesheet unavailable');
let css=await response.text();
css=[...css.matchAll(/\/\* (thai|latin) \*\/\s*(@font-face\s*\{[^}]+\})/g)].map(m=>m[0]).join('\n');
if(!css)throw Error('Thai/Latin font subsets not found');
const urls=[...new Set([...css.matchAll(/url\((https:\/\/fonts\.gstatic\.com\/[^)]+)\)/g)].map(m=>m[1]))];
if(!urls.length)throw Error('No fonts in stylesheet');
for(const remote of urls){
  const r=await fetch(remote,{signal:AbortSignal.timeout(20000)});if(!r.ok)throw Error('Font download failed');
  const bytes=Buffer.from(await r.arrayBuffer());
  if(bytes.toString('ascii',0,4)!=='wOF2')throw Error('Expected WOFF2 font');
  css=css.replaceAll(remote,'data:font/woff2;base64,'+bytes.toString('base64'));
}
css=css.replaceAll("'Manrope'","'Health Sans'").replaceAll("'IBM Plex Sans Thai'","'Health Thai'");
const faceStyle='<style id="embedded-fonts">\n/* Manrope and IBM Plex Sans Thai: SIL Open Font License 1.1; bundled for reliable rendering. */\n'+css+'\n</style>';
let html=fs.readFileSync(source,'utf8').replace(/<style id="embedded-fonts">[\s\S]*?<\/style>\s*/,'');
html=html.replace(/@import url\('https:\/\/fonts\.googleapis\.com[^']*'\);\s*/,'');
html=html.replace('<style>',faceStyle+'\n<style>');
html=html.replaceAll("'Manrope','Anuphan',sans-serif","'Health Sans','Health Thai',sans-serif").replaceAll("'Manrope',sans-serif","'Health Sans','Health Thai',sans-serif").replaceAll("'Noto Sans Thai',system-ui,sans-serif","'Health Sans','Health Thai',sans-serif");
fs.mkdirSync(new URL('../font-licenses/',import.meta.url),{recursive:true});
const notices=[];
for(const family of ['manrope','ibmplexsansthai']){
  const r=await fetch('https://raw.githubusercontent.com/google/fonts/main/ofl/'+family+'/OFL.txt');
  if(!r.ok)throw Error('Font license download failed');
  const notice=await r.text();
  fs.writeFileSync(new URL('../font-licenses/'+family+'-OFL.txt',import.meta.url),notice);
  notices.push(notice);
}
html=html.replace('</style>','\n/* Bundled font license notices\n'+notices.join('\n\n')+'\n*/\n</style>');
fs.writeFileSync(source,html);
console.log(`Bundled ${urls.length} WOFF2 font subsets; page ${(Buffer.byteLength(html)/1024).toFixed(0)} KiB. No external font request required.`);
