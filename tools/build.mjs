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
const scannerVersion=writeAsset('gate-camera.js',read('web/scanner.js'));
const playerCode=read('web/payment-form.js')+'\n'+read('web/ticket.js')+'\n'+read('web/player.js').replace('__SCANNER_VERSION__',scannerVersion);
const pricing=read('gas/Pricing.gs');
const priceDisplay=read('web/prices.js');
const sponsorMarkup=read('web/sponsors.html').trim();
function withSponsors(html) {
  const slot=/<!-- SPONSORS:START -->[\s\S]*?<!-- SPONSORS:END -->/;
  if (!slot.test(html)) throw new Error('Missing sponsor section in public page');
  return html.replace(slot, ()=>'<!-- SPONSORS:START -->\n'+sponsorMarkup+'\n<!-- SPONSORS:END -->');
}
const bundles={
  js:[read('web/config.js'),read('web/public-api.js'),read('web/transport.js'),priceDisplay,commonCode,playerCode].join('\n;\n'),
  css:[baseStyles,eventStyles].join('\n')
};
function writeAsset(filename, content) {
  // Stable hashes on both Windows and Unix checkouts.
  const normalized=content.replace(/\r\n/g,'\n');
  fs.writeFileSync(path.join(root,assets+filename),normalized);
  return createHash('sha256').update(normalized).digest('hex').slice(0,12);
}
const homeVersion=writeAsset('site.css',baseStyles+'\n'+read('web/home.css'));
const priceVersion=writeAsset('entry-prices.js',[read('web/config.js'),read('web/transport.js'),priceDisplay].join('\n;\n'));
const homepage=withSponsors(read('docs/index.html')).replace(/site\.css\?v=[a-z0-9]+/,'site.css?v='+homeVersion)
  .replace(/entry-prices\.js\?v=[a-z0-9]+/,'entry-prices.js?v='+priceVersion);
fs.writeFileSync(path.join(root,'docs/index.html'),homepage);
let publicPage=withSponsors(read('docs/event.html'));
for(const [extension,content] of Object.entries(bundles)){
  const version=writeAsset('event-app.'+extension,content);
  publicPage=publicPage.replace(new RegExp('event-app\\.'+extension+'\\?v=[a-z0-9]+'),'event-app.'+extension+'?v='+version);
}
fs.writeFileSync(path.join(root,'docs/event.html'),publicPage);
const library=fs.readFileSync(require.resolve('qrcode-generator',{paths:[root,...(process.env.POKER_BUILD_LIBS?[process.env.POKER_BUILD_LIBS]:[])]}),'utf8');
fs.writeFileSync(path.join(root,'docs/assets/qrcode-1.4.4.js'),library);
fs.copyFileSync(require.resolve('jsqr'),path.join(root,assets,'jsQR-1.4.0.js'));
writeAsset('jsQR-LICENSE.txt',fs.readFileSync(require.resolve('jsqr/LICENSE'),'utf8').trimEnd()+'\n');
const out=path.join(root,'.deploy');
fs.mkdirSync(out,{recursive:true});
for(const f of ['appsscript.json','Floor.gs','Auth.gs'])fs.copyFileSync(path.join(root,'gas',f),path.join(out,f));
const decoderSource=fs.readFileSync(require.resolve('jpeg-js/lib/decoder'),'utf8');
const qrSource=fs.readFileSync(require.resolve('jsqr'),'utf8');
const wrapModule=source=>'(()=>{const module={exports:{}},exports=module.exports;\n'+source+'\nreturn module.exports})()';
const qrReader='function readReceiverQr_(bytes){const decode='+wrapModule(decoderSource)+',scan='+wrapModule(qrSource)+';const im=decode(bytes,{useTArray:true,maxResolutionInMP:3,maxMemoryUsageInMB:48});return scan(new Uint8ClampedArray(im.data),im.width,im.height)?.data||""}';
const paymentServer=['PaymentProof','Statements','Reconcile'].map(name=>read('gas/'+name+'.gs')).join('\n');
fs.writeFileSync(path.join(out,'Code.gs'),pricing+'\n'+read('gas/Code.gs')+'\n'+paymentServer+'\n'+qrReader+'\nconst ticketQrEncoder_=(function(){\n'+library+'\nreturn qrcode;\n})();\n');
const feather=require('feather-icons');
const deskIcons=['activity','arrow-right','camera','check-circle','chevron-down','chevron-right','clock','credit-card','grid','inbox','log-out','refresh-cw','search','settings','user','user-plus','users','x'];
const iconSymbols=deskIcons.map(name=>'<symbol id="desk-i-'+name+'" viewBox="0 0 24 24">'+feather.icons[name].contents+'</symbol>').join('');
const iconLicense=fs.readFileSync(require.resolve('feather-icons/LICENSE'),'utf8');
const deskSprite='<!-- Feather Icons\n'+iconLicense+'-->\n<svg xmlns="http://www.w3.org/2000/svg" width="0" height="0" aria-hidden="true" style="position:absolute;overflow:hidden">'+iconSymbols+'</svg>';
const page=read('web/App.html')
  .replace('__CLUB_LOGO__',()=> 'data:image/webp;base64,'+fs.readFileSync(path.join(root,assets+'imt-ecell-logo.webp')).toString('base64'))
  .replace('__EVENT_WORDMARK__',()=> 'data:image/webp;base64,'+fs.readFileSync(path.join(root,assets+'poke-poker-night-small.webp')).toString('base64'))
  .replace('__EVENT_ICON__',()=> 'data:image/png;base64,'+fs.readFileSync(path.join(root,assets+'poke-chip.png')).toString('base64'))
  .replace('/* BASE_STYLES */',()=>baseStyles)
  .replace('/* EVENT_STYLES */',()=>eventStyles)
  .replace('/* QR_LIBRARY */',()=>library)
  .replace('/* COMMON_CODE */',()=>priceDisplay+'\n'+commonCode)
  .replace('/* STAFF_STYLES */',()=>read('web/staff.css'))
  .replace('<!-- STAFF_ICONS -->',()=>deskSprite)
  .replace('/* STAFF_CODE */',()=>read('web/payment-admin.js')+'\n'+read('web/staff-views.js')+'\n'+read('web/staff.js'))
  .replace('/* APP_CODE */',()=>playerCode);
fs.writeFileSync(path.join(out,'App.html'),page);
console.log('Apps Script files ready in .deploy');
