// One bounded, read-only burst against the event deployment configured in this checkout.
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {performance} from 'node:perf_hooks';

const source=name=>readFileSync(new URL('../web/'+name,import.meta.url),'utf8');
const script=new vm.Script(source('config.js')+'\n'+source('transport.js'));
const count=50,results=await Promise.all(Array.from({length:count},async(_,i)=>{
  const action=i%5===0?'liveFloor':'publicPrices',started=performance.now();
  let attempts=0;
  const context=vm.createContext({
    window:{},document:{getElementById:()=>null},setTimeout,clearTimeout,AbortController,
    fetch(url,request){
      if(url!==context.window.POKER_NIGHT_WEB_APP||JSON.parse(request.body).action!==action)throw Error('Unexpected endpoint or action.');
      attempts++;return fetch(url,request);
    }
  });
  try{
    script.runInContext(context);
    const result=await context.api(action);
    if(action==='publicPrices'?!Number.isFinite(result.amount):typeof result.state!=='string')throw Error('Incomplete event response.');
    return {ms:Math.round(performance.now()-started),attempts};
  }catch(error){return {ms:Math.round(performance.now()-started),attempts,error:error.message}}
}));
const times=results.map(r=>r.ms).sort((a,b)=>a-b),failures=results.filter(r=>r.error);
console.log(JSON.stringify({clients:count,completed:count-failures.length,firstAttempt:results.filter(r=>!r.error&&r.attempts===1).length,
  p50Ms:times[Math.ceil(count*.50)-1],p95Ms:times[Math.ceil(count*.95)-1],maxMs:times.at(-1),errors:[...new Set(failures.map(r=>r.error))]}));
if(failures.length)process.exitCode=1;
