import fs from 'node:fs';
import {minify} from 'terser';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {runInNewContext} from 'node:vm';
const root=fileURLToPath(new URL('../',import.meta.url));
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const require=createRequire(import.meta.url);
const assets='docs/assets/';
const baseStyles=read('web/base.css');
const eventStyles=read('web/event.css');
const commonCode=read('web/common.js');
const scannerVersion=writeAsset('gate-camera.js',read('web/scanner.js'));
const paymentCode=read('web/payment-form.js');
const paymentVersion=writeAsset('payment-form.js',(await minify(paymentCode,{ecma:2020})).code+'\n');
const accountCode=['ticket','registration-drafts','player-account'].map(name=>read('web/'+name+'.js')).join('\n');
const accountVersion=writeAsset('player-account.js',(await minify(accountCode,{ecma:2020})).code+'\n');
const playerCode=read('web/player-storage.js')+'\n'+read('web/player.js')
  .replace('__ACCOUNT_VERSION__',accountVersion).replace('__SCANNER_VERSION__',scannerVersion).replace('__PAYMENT_VERSION__',paymentVersion);
const pricing=read('gas/Pricing.gs');
const publishedPrices=runInNewContext(pricing+'\nENTRY_PRICING');
const money=new Intl.NumberFormat('en-IN',{style:'currency',currency:publishedPrices.currency,maximumFractionDigits:0});
const fees={label:'Entry fees',entry:money.format(publishedPrices.earlyBird)+'–'+money.format(publishedPrices.standard),
  standard:money.format(publishedPrices.standard),retry:money.format(publishedPrices.retry)};
const deadline=new Date(publishedPrices.earlyBirdEndsAt).toLocaleString('en-IN',{day:'numeric',month:'short',hour:'numeric',minute:'2-digit',timeZone:'Asia/Kolkata'})+' IST';
const feeMarkup='<div class="price-label">Published entry fees</div><div class="price-values"><strong>'+fees.entry+'</strong></div>'+
  '<p class="price-time">Early Bird ends '+deadline+'</p>';
const priceDisplay=read('web/prices.js').replace('__PUBLISHED_SCHEDULE__',()=>JSON.stringify({fees,markup:feeMarkup}));
function withPublishedFees(html){
  return html.replace(/<!-- FEES:START -->[\s\S]*?<!-- FEES:END -->/g,()=>'<!-- FEES:START -->'+feeMarkup+'<!-- FEES:END -->')
    .replace(/(<(?:span|strong|dd) data-home-fee="(label|entry|standard|retry)">)[^<]*/g,(_,tag,key)=>tag+fees[key]);
}
const sponsorMarkup=read('web/sponsors.html').trim();
function withSponsors(html) {
  const slot=/<!-- SPONSORS:START -->[\s\S]*?<!-- SPONSORS:END -->/;
  if (!slot.test(html)) throw new Error('Missing sponsor section in public page');
  return html.replace(slot, ()=>'<!-- SPONSORS:START -->\n'+sponsorMarkup+'\n<!-- SPONSORS:END -->');
}
async function publicScript(parts){
  const compiled=await minify(parts.join('\n;\n'),{ecma:2020});
  return read('web/config.js').trim()+'\n'+compiled.code+'\n';
}
// Pages can serve a cached HTML document with newer bytes at an old script URL.
// Either entry point can install the transport. A normal visit shares one request map.
const transport=await publicScript([read('web/transport.js')]);
const installTransport="'use strict';\nif(typeof window.api!=='function'){(()=>{"+transport+"window.api=api;})();}\n";
const bundles={
  js:installTransport+(await minify([read('web/public-api.js'),priceDisplay,commonCode,playerCode].join('\n;\n'),{ecma:2020})).code+'\n',
  css:[baseStyles,eventStyles].join('\n')
};
function writeAsset(filename, content) {
  // Stable hashes on both Windows and Unix checkouts.
  const normalized=content.replace(/\r\n/g,'\n');
  fs.writeFileSync(path.join(root,assets+filename),normalized);
  return createHash('sha256').update(normalized).digest('hex').slice(0,12);
}
const homeStyles=baseStyles+'\n'+read('web/home.css');
writeAsset('site.css',homeStyles);
const priceVersion=writeAsset('entry-prices.js',await publicScript([read('web/transport.js'),priceDisplay,read('web/home-navigation.js')]));
const homeSource=withPublishedFees(withSponsors(read('docs/index.html')));
const hero=homeSource.match(/<img class="hero-wordmark"[^>]+>/)[0];
const avifSet=hero.match(/srcset="([^"]+)"/)[1].replace(/\.webp/g,'.avif'),heroSizes=hero.match(/sizes="([^"]+)"/)[1];
const preload='<link rel="preload" as="image" type="image/avif" fetchpriority="high" imagesrcset="'+avifSet+'" imagesizes="'+heroSizes+'">';
const homepage=homeSource.replace(/<!-- HOME-STYLES:START -->[\s\S]*?<!-- HOME-STYLES:END -->/,
  ()=>'<!-- HOME-STYLES:START -->\n  '+preload+'\n  <style>'+homeStyles.trim()+'</style>\n  <!-- HOME-STYLES:END -->')
  .replace(/<source type="image\/avif"[^>]*>/,()=>'<source type="image/avif" srcset="'+avifSet+'" sizes="'+heroSizes+'">')
  .replace(/entry-prices\.js\?v=[a-z0-9]+/,'entry-prices.js?v='+priceVersion);
fs.writeFileSync(path.join(root,'docs/index.html'),homepage);
let publicPage=withPublishedFees(withSponsors(read('docs/event.html')));
const floorStart="if(document.documentElement.dataset.entry==='board'&&!document.hidden){window.firstFloorRead=api('liveFloor');window.firstFloorRead.catch(()=>{});}";
publicPage=publicPage.replace(/<!-- EVENT-DATA:START -->[\s\S]*?<!-- EVENT-DATA:END -->/,
  ()=>'<!-- EVENT-DATA:START -->\n  <script>'+installTransport+floorStart+'</script>\n  <!-- EVENT-DATA:END -->');
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
  .replace('/* APP_CODE */',()=>paymentCode+'\n'+accountCode+'\n'+playerCode);
fs.writeFileSync(path.join(out,'App.html'),page);
console.log('Apps Script files ready in .deploy');
