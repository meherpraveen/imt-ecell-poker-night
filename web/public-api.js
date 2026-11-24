'use strict';
const view=new URLSearchParams(location.search).get('view')||'register';
document.body.dataset.mode=['register','board','pass'].includes(view)?view:'unavailable';
document.title=view==='board'?'Live floor · Poker Night':view==='pass'?'Entry pass · Poker Night':'Event sign-in · Poker Night';
const fragment=new URLSearchParams(location.hash.slice(1));
const receipt=fragment.get('receipt')||'';
const incomingReceipt=/^[a-f0-9]{16}\.[A-Za-z0-9_-]{43}$/.test(receipt)?receipt:'';
if(view==='pass'){
  const code=fragment.get('code')||'';
  document.body.dataset.pass=code;
  try{
    if(code)sessionStorage.setItem('pn26:entry-pass',code);
    else document.body.dataset.pass=sessionStorage.getItem('pn26:entry-pass')||'';
  }catch{}
}
if(fragment.has('receipt')||fragment.has('code'))history.replaceState(null,'',location.pathname+location.search);

async function api(action,...args){
  const endpoint=window.POKER_NIGHT_WEB_APP;
  if(!/^https:\/\/script\.google\.com\/(?:a\/macros\/[a-z0-9.-]+\/s|macros\/s)\/[\w-]+\/exec$/.test(endpoint||'')){
    throw Error('The event desk is unavailable. Please contact E-Cell.');
  }
  const controller=new AbortController();
  const timeout=setTimeout(()=>controller.abort(),['publicInfo','liveFloor','playerHome','passInfo','playerStatus'].includes(action)?20000:55000);
  let result;
  try{
    const response=await fetch(endpoint,{
      method:'POST',credentials:'omit',redirect:'follow',referrerPolicy:'no-referrer',
      headers:{'Content-Type':'text/plain;charset=UTF-8'},
      body:JSON.stringify({action,args}),signal:controller.signal
    });
    if(!response.ok)throw Error();
    result=await response.json();
  }catch{
    throw Error('Could not reach the event desk. Check your connection and try again.');
  }finally{clearTimeout(timeout)}
  if(!result||result.ok!==true)throw Error(result?.error||'The event service is temporarily unavailable.');
  return result.value;
}
