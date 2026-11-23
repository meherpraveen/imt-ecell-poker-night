import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {createRequire} from 'node:module';
const root=fileURLToPath(new URL('../',import.meta.url));
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const require=createRequire(import.meta.url);
const library=fs.readFileSync(require.resolve('qrcode-generator',{paths:[root,...(process.env.POKER_BUILD_LIBS?[process.env.POKER_BUILD_LIBS]:[])]}),'utf8');
const out=path.join(root,'.deploy');
fs.mkdirSync(out,{recursive:true});
for(const f of ['appsscript.json','Code.gs','Floor.gs','Auth.gs'])fs.copyFileSync(path.join(root,'gas',f),path.join(out,f));
const page=read('web/App.html')
  .replace('/* BASE_STYLES */',()=>read('docs/assets/site.css'))
  .replace('/* EVENT_STYLES */',()=>read('docs/assets/event.css'))
  .replace('/* QR_LIBRARY */',()=>library)
  .replace('/* COMMON_CODE */',()=>read('docs/assets/common.js'))
  .replace('/* STAFF_CODE */',()=>read('web/staff.js'))
  .replace('/* APP_CODE */',()=>read('docs/assets/player.js'));
fs.writeFileSync(path.join(out,'App.html'),page);
console.log('Apps Script files ready in .deploy');
