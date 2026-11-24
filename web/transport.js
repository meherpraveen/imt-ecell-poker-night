const publicReads=new Map();
function api(action,...args){
  const shared=['publicPrices','liveFloor','passInfo'].includes(action);
  if(!shared)return eventRequest(action,args);
  const key=JSON.stringify([action,args]);
  if(!publicReads.has(key))publicReads.set(key,eventRequest(action,args).finally(()=>publicReads.delete(key)));
  return publicReads.get(key);
}
async function eventRequest(action,args){
  const endpoint=window.POKER_NIGHT_WEB_APP;
  if(!/^https:\/\/script\.google\.com\/(?:a\/macros\/[a-z0-9.-]+\/s|macros\/s)\/[\w-]+\/exec$/.test(endpoint||'')){
    throw Error('The event desk is unavailable. Please contact E-Cell.');
  }
  const read=['publicPrices','publicInfo','liveFloor','passInfo','playerStatus','playerHome'].includes(action);
  const limit=['playerReadProof','playerSubmitPayment'].includes(action)?120000:read?30000:60000;
  const deadline=Date.now()+limit,body=JSON.stringify({action,args});
  const notice=document.getElementById('net'),waiting='The event desk is busy. Retrying automatically…';
  let notified=false;
  try{
    for(let attempt=0;;attempt++){
      const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),Math.max(1,deadline-Date.now()));
      let response,raw;
      try{
        response=await fetch(endpoint,{method:'POST',credentials:'omit',redirect:'follow',referrerPolicy:'no-referrer',
          headers:{'Content-Type':'text/plain;charset=UTF-8'},body,signal:controller.signal});
        raw=await response.text();
      }catch{throw Error('Could not reach the event desk. Check your connection and try again.')}
      finally{clearTimeout(timeout)}
      let result;try{result=JSON.parse(raw)}catch{}
      if(response.ok&&result?.ok===true)return result.value;
      const googleBusy=!result&&/too many scripts running simultaneously|too many simultaneous|too many requests|service invoked too many times in a short time/i.test(raw.slice(0,12000));
      const busy=result?.retryable===true||response.status===429||googleBusy||read&&[502,503,504].includes(response.status);
      if(!busy)throw Error(result?.error||'Could not reach the event desk. Check your connection and try again.');
      const header=response.headers.get('Retry-After');
      const minimum=header?(/^\d+$/.test(header)?Number(header)*1000:Math.max(0,Date.parse(header)-Date.now())||0):0;
      const step=Math.min(6500,650*2**attempt),delay=Math.max(minimum,step)+Math.random()*step;
      if(attempt>=6||Date.now()+delay+1000>=deadline)throw Error('The event desk is busy. Give it a moment and try again.');
      if(notice&&!read){notice.textContent=waiting;notified=true}
      await new Promise(resolve=>setTimeout(resolve,delay));
    }
  }finally{if(notified&&notice.textContent===waiting)notice.textContent=''}
}
