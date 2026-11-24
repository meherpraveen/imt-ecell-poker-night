// Shared by Apps Script and the public pages. The cutoff includes the event's UTC offset.
const ENTRY_PRICING = Object.freeze({
  currency: 'INR',
  standard: 199,
  earlyBird: 149,
  retry: 149,
  earlyBirdEndsAt: '2026-11-27T19:00:00+05:30'
});

function entryOffer_(now, kind) {
  const endsAt = Date.parse(ENTRY_PRICING.earlyBirdEndsAt);
  const early = kind !== 'retry' && now < endsAt;
  const amount = kind === 'retry' ? ENTRY_PRICING.retry : early ? ENTRY_PRICING.earlyBird : ENTRY_PRICING.standard;
  return {amount, early, endsAt, standard: ENTRY_PRICING.standard, currency: ENTRY_PRICING.currency, now};
}

function formatFee_(amount, currency = ENTRY_PRICING.currency) {
  return new Intl.NumberFormat('en-IN', {style: 'currency', currency, maximumFractionDigits: 0}).format(amount);
}

'use strict';
let displayedOffer=entryOffer_(Date.now()),offerReceived=Date.now();
function syncOffer(offer){
  if(!offer)return;
  displayedOffer=offer;offerReceived=Date.now();
  updatePrices();
}
function eventNow(){return displayedOffer.now+(Date.now()-offerReceived)}
function remainingTime(ms){
  const minutes=Math.ceil(ms/60000),hours=Math.floor(minutes/60),days=Math.floor(hours/24);
  if(days)return days+'d '+hours%24+'h left';
  if(hours)return hours+'h '+minutes%60+'m left';
  return minutes+' min left';
}
function updatePrices(){
  const offers=document.querySelectorAll('[data-entry-price]'),homeFees=document.querySelectorAll('[data-home-fee]');
  if(!offers.length&&!homeFees.length)return;
  const offer=displayedOffer,now=eventNow(),early=offer.early&&now<offer.endsAt;
  const amount=formatFee_(early?offer.amount:offer.standard,offer.currency);
  const standard=formatFee_(offer.standard,offer.currency);
  const end=new Date(offer.endsAt).toLocaleString('en-IN',{day:'numeric',month:'short',hour:'numeric',minute:'2-digit',timeZone:'Asia/Kolkata'})+' IST';
  for(const box of offers){
    const remaining=early?remainingTime(offer.endsAt-now):'';
    const key=[amount,standard,end,remaining].join('|');
    if(box.dataset.rendered===key)continue;
    box.dataset.rendered=key;
    box.innerHTML='<div class="price-label">'+(early?'Early Bird':'Standard entry')+'</div><div class="price-values"><strong>'+amount+'</strong>'+
      (early?'<s><span class="sr-only">Standard price </span>'+standard+'</s>':'')+'</div>'+
      (early?'<p class="price-time"><b>'+remaining+'</b> · Ends '+end+'</p>':'');
  }
  for(const row of document.querySelectorAll('[data-early-only]'))row.hidden=!early;
  for(const node of homeFees){
    const kind=node.dataset.homeFee;
    const value=kind==='retry'?formatFee_(ENTRY_PRICING.retry):kind==='standard'?standard:kind==='label'?(early?'Early Bird':'Standard entry'):amount;
    if(node.textContent!==value)node.textContent=value;
  }
}
updatePrices();
setInterval(updatePrices,1000);
document.addEventListener('visibilitychange',updatePrices);
