import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {test as base,expect} from '@playwright/test';
import {createEvent} from './event-runtime.mjs';

const docs=new URL('../../docs/',import.meta.url);
const types={html:'text/html',css:'text/css',js:'text/javascript',webp:'image/webp'};
const testEndpoint='https://script.google.com/macros/s/test-event/exec';
const staffTransport='<script>window.google={script:{run:{withSuccessHandler(ok){return {withFailureHandler(no){return new Proxy({},{get:(_,name)=>(...args)=>fetch("/test-staff-rpc",{method:"POST",body:JSON.stringify({name,args})}).then(r=>r.json()).then(r=>r.ok?ok(r.value):no(Error(r.error)),no)})}}}}}};</script>';
const staffMethods=new Set(['requestOwnerCode','verifyOwnerCode','staffLogin','staffLogout','staffSnapshot','adminSettings','adminPaymentQr','adminAddStaff','deskPayment','deskStudent','staffApprove','staffReject','staffPass','proofImage','gateAction','releaseSeat','gamePreview','startStage','skipEmptyWave','tableResult','finishStage']);

export const test=base.extend({
  site:async({context},use)=>{
    const event=createEvent();
    const server=createServer(async(req,res)=>{
      const u=new URL(req.url,'http://localhost');
      try{
        if(u.pathname==='/test-staff-rpc'&&req.method==='POST'){
          let data='';for await(const part of req)data+=part;
          const {name,args}=JSON.parse(data);if(!staffMethods.has(name))throw Error('Unknown test operation');
          let result;try{result={ok:true,value:event.staff(name,args)}}catch(e){result={ok:false,error:e.message}}
          res.setHeader('content-type','application/json');return res.end(JSON.stringify(result));
        }
        if(u.pathname==='/club'){
          res.setHeader('content-type','text/html; charset=utf-8');
          return res.end(event.get(Object.fromEntries(u.searchParams)).replace('</head>',staffTransport+'</head>'));
        }
        if(u.pathname==='/assets/event-app.js'){
          const bundle=await readFile(new URL('assets/event-app.js',docs),'utf8');
          const config=await readFile(new URL('assets/config.js',docs),'utf8');
          res.setHeader('content-type','text/javascript; charset=utf-8');
          return res.end(bundle.replace(config.trim(),'window.POKER_NIGHT_WEB_APP="'+testEndpoint+'";'));
        }
        const path=u.pathname==='/'?'index.html':u.pathname.slice(1);
        if(!/^(index\.html|event\.html|assets\/[\w.-]+)$/.test(path)){res.statusCode=404;return res.end()}
        const bytes=await readFile(new URL(path,docs));
        res.setHeader('content-type',(types[path.split('.').pop()]||'application/octet-stream')+'; charset=utf-8');res.end(bytes);
      }catch{res.statusCode=500;res.end('Fixture request failed')}
    });
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    const origin='http://127.0.0.1:'+server.address().port;
    await context.route('**/*',async route=>{
      const url=route.request().url();
      if(url.startsWith(origin+'/'))return route.continue();
      if(url===testEndpoint)return route.fulfill({json:event.post(route.request().postDataJSON()),headers:{'Access-Control-Allow-Origin':'*'}});
      return route.abort();
    });
    const staffUrl=role=>origin+'/club?view=staff&invite='+event.invite(role);
    try{await use({...event,origin,staffUrl,register:origin+'/event.html?view=register',floor:origin+'/event.html?view=board',endpoint:testEndpoint})}
    finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve))}
  }
});
export {expect};
