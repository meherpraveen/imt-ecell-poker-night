window.POKER_NIGHT_WEB_APP = 'https://script.google.com/macros/s/AKfycbzPn65IjbFTE6QL8uCKfiwOuMZvTfhthGgsrVs0yvSiLr4i25lCwA6UQNJN1Pcx9Xa96Q/exec';

;
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

;
'use strict';
let displayedOffer=null,offerReceived=0,offerRequest=null,retryOfferAt=0,expiredOffer='';
function formatFee_(amount,currency='INR'){return new Intl.NumberFormat('en-IN',{style:'currency',currency,minimumFractionDigits:0,maximumFractionDigits:2}).format(amount)}
function eventNow(){return displayedOffer?displayedOffer.now+(Date.now()-offerReceived):Date.now()}
function syncOffer(offer){
  if(!offer||!Number.isFinite(offer.now)||!Number.isFinite(offer.amount))return;
  if(displayedOffer&&offer.now<displayedOffer.now)return;
  displayedOffer={...offer,retry:offer.retry??displayedOffer?.retry};offerReceived=Date.now();
  updatePrices();
}
function remainingTime(ms){
  const minutes=Math.ceil(ms/60000),hours=Math.floor(minutes/60),days=Math.floor(hours/24);
  return days?days+'d '+hours%24+'h left':hours?hours+'h '+minutes%60+'m left':minutes+' min left';
}
function loadOffer(){
  if(offerRequest||Date.now()<retryOfferAt)return;
  retryOfferAt=Date.now()+10000;
  offerRequest=api('publicPrices').then(syncOffer).catch(()=>{
    for(const box of document.querySelectorAll('[data-entry-price]'))box.textContent='Entry fee unavailable. Reconnecting to the event desk…';
  }).finally(()=>{offerRequest=null});
}
function updatePrices(){
  if(document.body.dataset.mode&&document.body.dataset.mode!=='register')return;
  const offers=document.querySelectorAll('[data-entry-price]'),homeFees=document.querySelectorAll('[data-home-fee]');
  if(!offers.length&&!homeFees.length)return;
  const offer=displayedOffer,now=eventNow();
  if(!offer||offer.early&&now>=offer.endsAt){
    for(const b of offers){if(b.dataset.rendered||!b.textContent){b.textContent='Checking the current entry fee…';delete b.dataset.rendered}}
    for(const n of homeFees)n.textContent=n.dataset.homeFee==='label'?'Entry fee at registration':'';
    for(const row of document.querySelectorAll('[data-early-only]'))row.hidden=true;
    if(offer&&expiredOffer!==offer.endsAt){expiredOffer=offer.endsAt;retryOfferAt=0}
    loadOffer();return;
  }
  const amount=formatFee_(offer.amount,offer.currency),standard=formatFee_(offer.standard,offer.currency);
  const end=new Date(offer.endsAt).toLocaleString('en-IN',{day:'numeric',month:'short',hour:'numeric',minute:'2-digit',timeZone:'Asia/Kolkata'})+' IST';
  for(const box of offers){
    const remaining=offer.early?remainingTime(offer.endsAt-now):'',key=[amount,standard,end,remaining].join('|');
    if(box.dataset.rendered===key)continue;
    box.dataset.rendered=key;
    box.innerHTML='<div class="price-label">'+(offer.early?'Early Bird':'Standard entry')+'</div><div class="price-values"><strong>'+amount+'</strong>'+
      (offer.early?'<s><span class="sr-only">Standard price </span>'+standard+'</s>':'')+'</div>'+
      (offer.early?'<p class="price-time"><b>'+remaining+'</b> · Ends '+end+'</p>':'');
  }
  for(const row of document.querySelectorAll('[data-early-only]'))row.hidden=!offer.early;
  for(const node of homeFees){
    const kind=node.dataset.homeFee;
    const value=kind==='retry'?(offer.retry!=null?formatFee_(offer.retry,offer.currency):'See the desk'):kind==='standard'?standard:kind==='label'?(offer.early?'Early Bird':'Standard entry'):amount;
    if(node.textContent!==value)node.textContent=value;
  }
}
updatePrices();setInterval(updatePrices,1000);
document.addEventListener('visibilitychange',updatePrices);
addEventListener('online',()=>{retryOfferAt=0;updatePrices()});
