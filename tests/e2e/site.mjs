import {createServer} from 'node:http';
import {randomInt} from 'node:crypto';
import {once} from 'node:events';
import {readFile} from 'node:fs/promises';
import {test as base,expect} from '@playwright/test';
import {createEvent} from './event-runtime.mjs';

const docs=new URL('../../docs/',import.meta.url);
const types={html:'text/html',css:'text/css',js:'text/javascript',webp:'image/webp',avif:'image/avif',png:'image/png'};
const testEndpoint='https://script.google.com/macros/s/test-event/exec';
const staffTransport=`<script>
window.google={script:{
  run:{withSuccessHandler(ok){return {withFailureHandler(no){return new Proxy({},{get:(_,name)=>(...args)=>fetch("/test-staff-rpc",{method:"POST",body:JSON.stringify({name,args})}).then(r=>r.json()).then(r=>r.ok?ok(r.value):no(Error(r.error)),no)})}}}},
  url:{getLocation(done){done({hash:location.hash.slice(1)})}},
  history:{replace(state,params,hash){const url=new URL(location.href);url.search=new URLSearchParams(params);url.hash=hash;window.history.replaceState(state,'',url)}}
}};
</script>`;
const staffMethods=new Set(['requestOwnerCode','verifyOwnerCode','completeDeskSignIn','staffLogin','staffLogout','staffSnapshot','adminSettings','adminPaymentQr','adminAddStaff','deskPayment','deskStudent','staffApprove','staffReject','staffPass','proofImage','gateAction','releaseSeat','gamePreview','startStage','skipEmptyWave','tableResult','finishStage','adminSaveReceiver','adminImportStatement','adminStatementPreview','adminApplyStatement','adminDispatchPasses','adminPaymentDetail','adminNeedsReview','adminReviewPayment','adminCertifyPdfRow','adminOpenDeskPayment']);

export const test=base.extend({
  site:async({context},use)=>{
    const event=createEvent();
    const staffPage=url=>event.get(Object.fromEntries(url.searchParams)).replace('</head>',staffTransport+'</head>');
    function staffReply({name,args}){
      if(!staffMethods.has(name))return {ok:false,error:'Unknown test operation'};
      try{
        const value=event.staff(name,args);
        if(value?.scannerUrl)value.scannerUrl=value.scannerUrl.replace('https://pokernight.imtneversleeps.com/',origin+'/');
        return {ok:true,value};
      }catch(e){return {ok:false,error:e.message}}
    }
    const server=createServer(async(req,res)=>{
      const u=new URL(req.url,'http://localhost');
      try{
        if(u.pathname==='/test-staff-rpc'&&req.method==='POST'){
          let data='';for await(const part of req)data+=part;
          res.setHeader('content-type','application/json');return res.end(JSON.stringify(staffReply(JSON.parse(data))));
        }
        if(u.pathname==='/club'){
          res.setHeader('content-type','text/html; charset=utf-8');
          return res.end(staffPage(u));
        }
        if(['/event.html','/assets/event-app.js','/assets/entry-prices.js'].includes(u.pathname)){
          const bundle=await readFile(new URL(u.pathname.slice(1),docs),'utf8');
          const config=await readFile(new URL('../../web/config.js',import.meta.url),'utf8');
          res.setHeader('content-type',u.pathname==='/event.html'?'text/html; charset=utf-8':'text/javascript; charset=utf-8');
          return res.end(bundle.replace(config.trim(),'window.POKER_NIGHT_WEB_APP="'+testEndpoint+'";'));
        }
        const path=u.pathname==='/'?'index.html':u.pathname.slice(1);
        if(!/^(index\.html|event\.html|assets\/[\w.-]+)$/.test(path)){res.statusCode=404;return res.end()}
        const bytes=await readFile(new URL(path,docs));
        res.setHeader('content-type',(types[path.split('.').pop()]||'application/octet-stream')+'; charset=utf-8');res.end(bytes);
      }catch{res.statusCode=500;res.end('Fixture request failed')}
    });
    // Some Windows hosts allocate browser-blocked ports such as 10080 when asked for port zero.
    for(let attempt=1;;attempt++){
      const listening=once(server,'listening');
      server.listen(randomInt(49152,65536),'127.0.0.1');
      try{await listening;break}
      catch(error){if(attempt>=10||!['EADDRINUSE','EACCES'].includes(error.code))throw error}
    }
    const origin='http://127.0.0.1:'+server.address().port;
    const attach=target=>target.route('**/*',async route=>{
      const url=route.request().url();
      if(url.startsWith(origin+'/')||url.startsWith('blob:'))return route.continue();
      if(url.startsWith(testEndpoint+'?')&&route.request().isNavigationRequest())return route.fulfill({contentType:'text/html; charset=utf-8',body:staffPage(new URL(url))});
      if(url==='https://script.google.com/test-staff-rpc')return route.fulfill({json:staffReply(route.request().postDataJSON())});
      if(url===testEndpoint)return route.fulfill({json:event.post(route.request().postDataJSON()),headers:{'Access-Control-Allow-Origin':'*'}});
      return route.abort();
    });
    await attach(context);
    const staffUrl=role=>origin+'/club?view=staff&invite='+event.invite(role);
    try{await use({...event,origin,staffUrl,attach,register:origin+'/event.html?view=register',floor:origin+'/event.html?view=board',endpoint:testEndpoint})}
    finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve))}
  }
});
export {expect};
