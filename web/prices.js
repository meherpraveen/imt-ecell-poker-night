'use strict';
let displayedOffer=null,offerReceived=0,offerRequest=null,retryOfferAt=0,expiredOffer='',priceTimer;
const feeFormats=new Map(),publicQuoteKey='pn26:public-entry-quote';
function formatFee_(amount,currency='INR'){
  if(!feeFormats.has(currency))feeFormats.set(currency,new Intl.NumberFormat('en-IN',{style:'currency',currency,minimumFractionDigits:0,maximumFractionDigits:2}));
  return feeFormats.get(currency).format(amount);
}
function validOffer(offer){
  return offer&&Number.isFinite(offer.now)&&Number.isFinite(offer.amount)&&Number.isFinite(offer.standard)&&Number.isFinite(offer.endsAt)&&offer.currency==='INR'&&typeof offer.early==='boolean';
}
function restorePublicQuote(){
  try{
    const cached=JSON.parse(sessionStorage.getItem(publicQuoteKey)),age=Date.now()-cached.received;
    if(age>=0&&age<60000&&validOffer(cached.offer)&&(!cached.offer.early||cached.offer.now+age<cached.offer.endsAt)){
      displayedOffer=cached.offer;offerReceived=cached.received;
    }
  }catch{}
}
function eventNow(){return displayedOffer?displayedOffer.now+(Date.now()-offerReceived):Date.now()}
function syncOffer(offer){
  if(!validOffer(offer))return;
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
  offerRequest=api('publicPrices').then(offer=>{
    if(!validOffer(offer))throw Error('Entry fee unavailable.');
    try{sessionStorage.setItem(publicQuoteKey,JSON.stringify({offer,received:Date.now()}))}catch{}
    syncOffer(offer);
  }).catch(()=>{
    for(const box of document.querySelectorAll('[data-entry-price]'))if(!box.dataset.rendered){box.removeAttribute('aria-busy');box.textContent='Entry fee unavailable. Reconnecting to the event desk…'}
  }).finally(()=>{offerRequest=null;if(!displayedOffer||displayedOffer.early&&eventNow()>=displayedOffer.endsAt)schedulePrices(Math.max(1000,retryOfferAt-Date.now()))});
}
function schedulePrices(delay){
  clearTimeout(priceTimer);
  if(!document.hidden)priceTimer=setTimeout(updatePrices,Math.max(1,delay));
}
function updatePrices(){
  clearTimeout(priceTimer);
  if(document.hidden||document.body.dataset.mode&&document.body.dataset.mode!=='register')return;
  const offers=[...document.querySelectorAll('[data-entry-price]')].filter(el=>{
    const shell=el.closest('[data-shell]');return !shell||shell.dataset.shell===document.documentElement.dataset.entry;
  }),homeFees=document.querySelectorAll('[data-home-fee]');
  if(!offers.length&&!homeFees.length)return;
  const offer=displayedOffer,now=eventNow();
  if(!offer||offer.early&&now>=offer.endsAt){
    for(const b of offers){b.setAttribute('aria-busy','true');if(b.dataset.rendered||!b.textContent){b.textContent='Checking the current entry fee…';delete b.dataset.rendered}}
    for(const n of homeFees)n.textContent=n.dataset.homeFee==='label'?'Entry fee at registration':'';
    for(const row of document.querySelectorAll('[data-early-only]'))row.hidden=true;
    if(offer&&expiredOffer!==offer.endsAt){expiredOffer=offer.endsAt;retryOfferAt=0}
    loadOffer();if(!offerRequest)schedulePrices(Math.max(1000,retryOfferAt-Date.now()));return;
  }
  const amount=formatFee_(offer.amount,offer.currency),standard=formatFee_(offer.standard,offer.currency);
  const end=new Date(offer.endsAt).toLocaleString('en-IN',{day:'numeric',month:'short',hour:'numeric',minute:'2-digit',timeZone:'Asia/Kolkata'})+' IST';
  for(const box of offers){
    box.removeAttribute('aria-busy');
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
  if(offer.early)schedulePrices((offer.endsAt-now)%60000||60000);
}
restorePublicQuote();updatePrices();
document.addEventListener('visibilitychange',updatePrices);
addEventListener('pageshow',event=>{if(event.persisted)updatePrices()});
addEventListener('online',()=>{retryOfferAt=0;updatePrices()});
