function paymentsReady_(s){return !!(s.published&&s.name&&(s.upi||s.qrFile))}
function publicPrices(){return {...entryOffer_(Date.now()),retry:ENTRY_PRICING.retry}}
function signupInfo_(s,now,st){
  const open=s.open&&now>=PRE_OPENS&&now<NEW_CLOSE;
  const offer=entryOffer_(now);
  const info={open,paymentsReady:paymentReadyFor_(s,st||ledger_()),offer,fee:offer.amount};
  if(!open)info.message=now<PRE_OPENS?'Pre-registration starts on 23 November.':now>=NEW_CLOSE?'New registrations have ended.':'The club has paused new registrations.';
  return info;
}

function usesBankVerification_(st){return receivers_(st).length>0||props_().getProperty('PAYMENT_VERIFICATION_REQUIRED')==='yes'}
function paymentReadyFor_(set,st){return usesBankVerification_(st)?receivers_(st).some(r=>r.active):paymentsReady_(set)}

function issued_(a){return ['PAID','ELIMINATED','QUALIFIED','WINNER','NO_SHOW'].includes(a.status)}
// HOLD is the journal's historical name for an unpaid checkout. It reserves no capacity.
function quotedFee_(a,now){
  return ['REGISTERED','WAITLIST','HOLD'].includes(a.status)?entryOffer_(now,a.kind).amount:a.fee;
}
function occupied_(a){return ['REVIEW','PAID','ELIMINATED','QUALIFIED','WINNER'].includes(a.status)}
function latestRegistration_(st,roll){
  return Object.values(st.attempts).reduce((latest,a)=>a.roll===roll&&(!latest||a.created>=latest.created)?a:latest,null);
}
function currentRegistration_(st,a){
  if(!['HOLD','REGISTERED','WAITLIST'].includes(a.status))return a;
  return latestRegistration_(st,a.roll)||a;
}
function waveFor_(st,roll,now,exceptId){
  const past=new Set(),booked=Array(WAVES).fill(0);let waiting=0;
  for(const attempt of Object.values(st.attempts)){
    if(attempt.roll===roll&&issued_(attempt)&&attempt.used)past.add(attempt.wave);
    if(attempt.id===exceptId)continue;
    if(attempt.used&&attempt.wave>=0&&attempt.wave<WAVES){booked[attempt.wave]++;continue;}
    if(occupied_(attempt)&&(attempt.status==='PAID'||attempt.capacityReserved===true||attempt.capacityReserved===undefined&&attempt.wave>=0))waiting++;
  }
  const start=st.game.next+(st.game.active?1:0);
  let free=0,first=-1;
  for(let wave=start;wave<WAVES;wave++)if(!past.has(wave)&&booked[wave]<CAP){free+=CAP-booked[wave];if(first<0)first=wave;}
  // Reserve event capacity only. A registration has no particular wave until
  // the desk checks it in; another player's arrival order cannot bind it early.
  return free>waiting?first:-1;
}
function deskWaveFor_(st,roll){
  const past=new Set(Object.values(st.attempts).filter(a=>a.roll===roll&&a.used).map(a=>a.wave));
  const start=st.game.next+(st.game.active?1:0);
  for(let wave=start;wave<WAVES;wave++)if(!past.has(wave)&&Object.values(st.attempts).filter(a=>a.used&&a.wave===wave).length<CAP)return wave;
  return -1;
}
function pendingAllocation_(st,a,now){return {wave:-1,capacityReserved:proofWave_(st,a,now)>=0}}
function eligibility_(st,roll,kind,now,exceptId){
  must_(now<EVENT_END,'The event has closed.');
  if(kind!=='retry')must_(now<NEW_CLOSE,'New registrations closed at 11 PM IST.');
  if(kind==='walk')must_(now>=DESK_OPENS,'Walk-in registration opens at 7 PM IST.');
  if(kind==='pre')must_(now<DESK_OPENS,'Use the walk-in desk from 7 PM IST.');
  const mine=Object.values(st.attempts).filter(a=>a.roll===roll&&a.id!==exceptId);
  const latest=latestRegistration_(st,roll);
  const active=mine.find(a=>(['REGISTERED','HOLD'].includes(a.status)&&a.id===latest?.id)||['REVIEW','PAID','QUALIFIED','WINNER'].includes(a.status));
  must_(!active,'There is already an active attempt for this roll. Use the original receipt page or ask the desk.');
  if(kind==='retry')must_(mine.some(a=>a.status==='ELIMINATED')&&st.game.next<6,'A retry requires an eliminated player and a later Round 1 wave.');
  else must_(!mine.some(a=>issued_(a)),'This roll has played already. The desk can check retry eligibility.');
}
function newAttempt_(roll,kind,availableWave,now){
  return {id:rand_().slice(0,16),roll,kind,fee:entryOffer_(now,kind).amount,wave:-1,created:now,status:availableWave<0?'WAITLIST':'HOLD',used:false,delivery:''};
}
function proofWave_(st,a,now){
  if(now>=EVENT_END)return -1;
  return waveFor_(st,a.roll,now,a.id);
}
function publicInfo(){
  loadInitialReceivers_();
  ensureStaffLinks_();
  let settings=settings_();
  if(settings.legacy)settings=locked_(()=>{
    const latest=settings_();
    if(latest.legacy)writeSettings_(latest);
    return latest;
  });
  return signupInfo_(settings,Date.now());
}
function playerHome(session,preferred){
  const player=playerDirectory_(session),expires=rememberedExpiry_(session,player.session);
  return {...accountForRoll_(player.roll,preferred,player.person),sessionExpires:expires};
}
function accountForRoll_(roll,preferred,verifiedPerson){
  loadInitialReceivers_();
  const st=ledger_(),set=settings_(),now=Date.now(),saved=fromReceipt_(st,preferred);
  const attempt=saved&&saved.roll===roll?currentRegistration_(st,saved):latestRegistration_(st,roll);
  const person=verifiedPerson||roster_()[roll]||{};
  return {...signupInfo_(set,now,st),player:{name:person.name||'',roll,email:person.email||'',phone:person.phone||''},receipt:attempt?resumeReceipt_(attempt,set,st):null};
}
function playerStart(session,previous,requestId,detailsJson){
  const roll=playerRoll_(session);
  must_(!requestId||(typeof requestId==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId)),'Refresh the page and try again.');
  const result=locked_(()=>{
    const set=settings_(),st=ledger_(),now=Date.now();
    if(previous){const a=fromReceipt_(st,previous);if(a&&a.roll===roll)return {a:currentRegistration_(st,a),set,st};}
    const startHash=requestId?hash_('seat-request:'+requestId):'';
    if(startHash){
      const existing=Object.values(st.attempts).find(a=>a.roll===roll&&a.startHash===startHash);
      if(existing)return {a:currentRegistration_(st,existing),set,st};
    }
    const current=latestRegistration_(st,roll);
    if(current&&['REGISTERED','WAITLIST','HOLD','REVIEW','PAID'].includes(current.status))return {a:current,set,st};
    const info=signupInfo_(set,now,st);
    must_(info.open,info.message);
    const kind=now>=DESK_OPENS?'walk':'pre';
    eligibility_(st,roll,kind,now);
    const a=attachReceiver_(newAttempt_(roll,kind,info.paymentsReady?waveFor_(st,roll,now):-1,now),st,now);
    if(!info.paymentsReady)a.status='REGISTERED';
    a.details=registrationDetails_(roll,detailsJson);a.detailsRevision=1;
    if(startHash)a.startHash=startHash;
    commit_(st,a.status==='HOLD'?'Checkout opened':'Registration saved','Player',{attempts:[a],note:a.id});return {a,set,st};
  },false);
  return resumeReceipt_(result.a,result.set,result.st);
}
function fromReceipt_(st,t){const [id,sig]=String(t||'').split('.');return st.attempts[id]&&sig===mac_('receipt:'+id)?st.attempts[id]:null}
function ownReceipt_(st,ticket,roll){
  const attempt=fromReceipt_(st,ticket);
  must_(attempt&&attempt.roll===roll,'This receipt is unavailable for your account.');
  return attempt;
}
function ticketActive_(a,st,now){
  return a.status==='PAID'&&!a.used&&now<EVENT_END&&deskWaveFor_(st,a.roll)>=0;
}
function receipt_(a,set,st){
  const now=Date.now(),offer=entryOffer_(now,a.kind),ready=paymentReadyFor_(set,st),managed=usesBankVerification_(st),selected=a.receiver;
  const checkout=a.status==='HOLD',ended=now>=EVENT_END;
  const full=checkout&&!ended&&waveFor_(st,a.roll,now)<0;
  const open=checkout&&!ended&&!full&&!missingDetail_(a.details)&&currentRegistration_(st,a).id===a.id;
  const payable=open&&(managed?!!selected&&st.receivers[selected.id]?.active&&st.receivers[selected.id]?.upi===selected.upi:ready);
  const payee=selected||set;
  const checkoutReceivers=open&&managed?checkoutOptions_(a,st):[];
  const pinnedQr=checkoutReceivers.find(r=>r.id===selected?.id)?.qr;
  let paymentQr=payable&&selected?pinnedQr||'':'';
  if(payable&&!selected&&payee.qrFile){
    try{paymentQr=checkoutQr_({id:'legacy',upi:payee.upi,qrFile:payee.qrFile})}
    catch{console.warn('Legacy payment QR unavailable')}
  }
  return {ticket:a.id+'.'+mac_('receipt:'+a.id),id:a.id,fee:quotedFee_(a,now),offer,wave:a.used?a.wave+1:0,allocation:a.used?'assigned':'desk',status:a.status,
    // Older clients use expires to discard an outdated UPI amount at the pricing cutoff.
    paymentsCloseAt:EVENT_END,expires:checkout&&offer.early?Math.min(offer.endsAt,EVENT_END):checkout?EVENT_END:0,full,upi:payable?payee.upi:'',name:payable?payee.name:'',paymentQr,
    checkoutReceivers,chosenReceiverId:chosenReceiver_(a,checkoutReceivers),receiverChoiceVersion:a.receiverChoiceVersion||0,
    managed,canChooseReceiver:open&&!!selected&&!a.file&&!a.legacyReceiver,details:a.details||null,detailsRevision:a.detailsRevision||0,fairPlay:FAIR_PLAY_DECLARATION,fairPlayVersion:FAIR_PLAY_VERSION,
    paymentRecipients:selected?receivers_(st).filter(r=>r.active||r.id===selected.id||r.id===a.claim?.paidReceiver?.id||a.offeredReceivers?.some(option=>option.id===r.id)).map(receiverView_):[],
    receiver:selected?{id:selected.id,name:selected.name,upi:selected.upi,number:selected.number||''}:null,
    identifyReceivers:managed&&!selected&&['HOLD','REVIEW','REJECTED'].includes(a.status)?receivers_(st).map(receiverView_):[],
    paymentStatus:a.paymentStatus||(issued_(a)?'AUTHORIZED':'PENDING'),proofVersion:a.proofVersion||0,claim:a.claim||null,needsConfirmation:!!a.claim&&a.claim.source!=='screenshot'&&!a.claim.paidReceiver,issue:a.reviewReason||a.reason||(a.claim&&a.claim.source!=='screenshot'&&!a.claim.paidReceiver?'Confirm the payment recipient and fair-play declaration below.':''),beneficiary:a.roll,
    canCheckout:a.status==='REGISTERED'&&ready&&!ended,checkoutEnded:ended,delivery:a.delivery||'',reason:a.reason||'',
    seat:a.seat||null,checkedInAt:a.checkedInAt||null,entryCode:ticketActive_(a,st,now)?pass_(a.id):''};
}
function canResumeCheckout_(a,set,st,now){
  if(!['REGISTERED','WAITLIST'].includes(a.status)||missingDetail_(a.details)||now>=EVENT_END||!paymentReadyFor_(set,st))return false;
  return a.status==='REGISTERED'||waveFor_(st,a.roll,now)>=0;
}
function openSavedCheckout_(a,set,st,now){
  if(!canResumeCheckout_(a,set,st,now))return a;
  const available=waveFor_(st,a.roll,now)>=0;
  const next=attachReceiver_({...a,wave:-1,fee:entryOffer_(now,a.kind).amount,status:available?'HOLD':'WAITLIST'},st,now);
  commit_(st,available?'Checkout opened':'Added to waitlist','Player',{attempts:[next],note:a.id});
  return next;
}
function resumeReceipt_(a,set,st){
  if(!canResumeCheckout_(a,set,st,Date.now()))return receipt_(a,set,st);
  const result=locked_(()=>{
    const latest=ledger_(),settings=settings_(),registration=currentRegistration_(latest,latest.attempts[a.id]);
    return {a:openSavedCheckout_(registration,settings,latest,Date.now()),set:settings,st:latest};
  },false);
  return receipt_(result.a,result.set,result.st);
}
function playerStatus(session,ticket){
  const roll=playerRoll_(session),st=ledger_();
  return resumeReceipt_(currentRegistration_(st,ownReceipt_(st,ticket,roll)),settings_(),st);
}
function playerCheckout(session,ticket){return playerStatus(session,ticket)}
