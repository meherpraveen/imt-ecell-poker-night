import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
const root=fileURLToPath(new URL('../',import.meta.url));
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const require=createRequire(import.meta.url);
const assets='docs/assets/';
const baseStyles=read('web/base.css');
const eventStyles=read('web/event.css');
const commonCode=read('web/common.js');
const playerCode=read('web/player.js');
const sponsorMarkup=read('web/sponsors.html').trim();
function withSponsors(html) {
  const slot=/<!-- SPONSORS:START -->[\s\S]*?<!-- SPONSORS:END -->/;
  if (!slot.test(html)) throw new Error('Missing sponsor section in public page');
  return html.replace(slot, ()=>'<!-- SPONSORS:START -->\n'+sponsorMarkup+'\n<!-- SPONSORS:END -->');
}
const bundles={
  js:[read('web/config.js'),read('web/public-api.js'),commonCode,playerCode].join('\n;\n'),
  css:[baseStyles,eventStyles].join('\n')
};
function writeAsset(filename, content) {
  // Stable hashes on both Windows and Unix checkouts.
  const normalized=content.replace(/\r\n/g,'\n');
  fs.writeFileSync(path.join(root,assets+filename),normalized);
  return createHash('sha256').update(normalized).digest('hex').slice(0,12);
}
const homeVersion=writeAsset('site.css',baseStyles+'\n'+read('web/home.css'));
const homepage=withSponsors(read('docs/index.html')).replace(/site\.css\?v=[a-z0-9]+/,'site.css?v='+homeVersion);
fs.writeFileSync(path.join(root,'docs/index.html'),homepage);
let publicPage=withSponsors(read('docs/event.html'));
for(const [extension,content] of Object.entries(bundles)){
  const version=writeAsset('event-app.'+extension,content);
  publicPage=publicPage.replace(new RegExp('event-app\\.'+extension+'\\?v=[a-z0-9]+'),'event-app.'+extension+'?v='+version);
}
fs.writeFileSync(path.join(root,'docs/event.html'),publicPage);
const library=fs.readFileSync(require.resolve('qrcode-generator',{paths:[root,...(process.env.POKER_BUILD_LIBS?[process.env.POKER_BUILD_LIBS]:[])]}),'utf8');
fs.writeFileSync(path.join(root,'docs/assets/qrcode-1.4.4.js'),library);
const out=path.join(root,'.deploy');
fs.mkdirSync(out,{recursive:true});
for(const f of ['appsscript.json','Code.gs','Floor.gs','Auth.gs'])fs.copyFileSync(path.join(root,'gas',f),path.join(out,f));
const page=read('web/App.html')
  .replace('/* BASE_STYLES */',()=>baseStyles)
  .replace('/* EVENT_STYLES */',()=>eventStyles)
  .replace('/* QR_LIBRARY */',()=>library)
  .replace('/* COMMON_CODE */',()=>commonCode)
  .replace('/* STAFF_CODE */',()=>read('web/staff.js'))
  .replace('/* APP_CODE */',()=>playerCode);
fs.writeFileSync(path.join(out,'App.html'),page);
console.log('Apps Script files ready in .deploy');
