const CAP=36, WAVES=6;
const PRE_OPENS=Date.parse('2026-11-23T00:00:00+05:30');
const DESK_OPENS=Date.parse('2026-11-27T19:00:00+05:30'), NEW_CLOSE=Date.parse('2026-11-27T23:00:00+05:30'), EVENT_END=Date.parse('2026-11-28T04:00:00+05:30');
const ROLE=['admin','desk','gate','floor'];
function props_(){return PropertiesService.getScriptProperties()}
function rand_(){return Utilities.getUuid().replace(/-/g,'')}
function hash_(text){return Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,text)).replace(/=+$/,'')}
let executionSigningKey;
function mac_(value){return Utilities.base64EncodeWebSafe(Utilities.computeHmacSha256Signature(value,executionSigningKey||(executionSigningKey=props_().getProperty('KEY')))).replace(/=+$/,'')}
function roll_(v){v=String(v||'').trim();must_(/^\d{9}$/.test(v),'Enter your nine-digit college roll number.');return v}
function ref_(v){return /^\d{12}$/.test(String(v||'').trim())?String(v).trim():''}
function must_(ok,message){
  if(!ok){const error=new Error(message);error.name='EventValidationError';throw error}
}
function locked_(fn,flush=true){
  const lock=LockService.getScriptLock();
  try{lock.waitLock(4500)}catch{
    const error=Error('The event desk is busy. Please try again in a moment.');
    error.name='EventBusyError';throw error;
  }
  try{return fn()}finally{try{if(flush)SpreadsheetApp.flush()}finally{lock.releaseLock()}}
}
let executionBook;
function book_(){return executionBook||(executionBook=SpreadsheetApp.openById(props_().getProperty('BOOK')))}
function onOpen(e){
  SpreadsheetApp.getUi().createMenu('Poké Poker Night').addItem('Set up club desk','setupEvent').addToUi();
  if(e && e.source && e.source.getId()===props_().getProperty('BOOK')){
    const staff=e.source.getSheetByName('Staff');
    if(staff)locked_(()=>syncStaffLinks_(staff));
  }
}
function setupEvent(){
  // Only the signed-in owner may initialize the private club resources.
  const who=String(Session.getActiveUser().getEmail()||'').toLowerCase();
  must_(who && who===String(Session.getEffectiveUser().getEmail()||'').toLowerCase(),'Run setup using the club account in the private Sheet or Apps Script editor.');
  return locked_(()=>init_(who));
}
function init_(who){
  const p=props_(),preset=typeof CLUB_RESOURCES==='object'?CLUB_RESOURCES:{},configured=p.getProperty('BOOK')||preset.book;
  const owner=clubOwner_();
  must_(emailAddress_(who)&&(!owner||who===owner),'Run setup from the designated club account.');
  if(!owner)p.setProperty('EVENT_OWNER',who);
  const b=configured?SpreadsheetApp.openById(configured):SpreadsheetApp.create('Poké Poker Night · private club desk');
  p.setProperty('BOOK',b.getId());
  if(!p.getProperty('KEY'))p.setProperty('KEY',rand_()+rand_());
  b.setSpreadsheetTimeZone('Asia/Kolkata');
  const headers={Students:['Roll Number','Name','Mail ID','Number'],Staff:['Label','Role','Private sign-in key','Active'],Journal:['Time','Action','Staff or player','Change JSON'],Settings:['Setting','Value']};
  Object.keys(headers).forEach(n=>{const s=b.getSheetByName(n)||b.insertSheet(n);if(!s.getLastRow()){s.appendRow(headers[n]);s.setFrozenRows(1);}});
  const staff=b.getSheetByName('Staff');
  if(staff.getLastRow()===1)staff.appendRow([who,'admin',rand_()+rand_().slice(0,8),'yes']);
  syncStaffLinks_(staff);
  const settings=b.getSheetByName('Settings');
  if(settings.getLastRow()===1)writeSettings_({upi:'',name:'',open:true,qrFile:'',published:false});
  if(!p.getProperty('FOLDER'))p.setProperty('FOLDER',preset.folder||DriveApp.createFolder('Poké Poker Night · private payment screenshots').getId());
  p.setProperty('PAYMENT_VERIFICATION_REQUIRED','yes');
  return b.getUrl();
}
function doGet(e){
  const q=e&&e.parameter||{};
  const requested=['register','staff','board','pass'].includes(q.view)?q.view:'register';
  const staff=requested==='staff'?invitedStaff_(q.invite):null;
  const route=requested==='staff'&&!staff?'unavailable':requested;
  const t=HtmlService.createTemplateFromFile('App');
  t.route=route;
  t.ownerLogin=!!staff&&staff[1]==='admin';
  t.verifiedEntry=t.ownerLogin&&q.entry==='verified'?'yes':'';
  t.ownerEmail=t.ownerLogin?clubOwner_():'';
  t.invite=route==='staff'?q.invite:'';
  t.pass=/^[A-Z0-9-]{12,24}$/.test(q.p||'')?q.p:'';
  return t.evaluate().setTitle(route==='unavailable'?'Page unavailable':'Poké Poker Night 2026 · E-Cell').addMetaTag('viewport','width=device-width, initial-scale=1');
}
function doPost(event){
  let result;
  try{
    const body=event&&event.postData&&event.postData.contents;
    must_(typeof body==='string'&&body.length<=4*Math.ceil(PROOF_MAX_BYTES/3)+12000,'Check the request or choose a smaller screenshot.');
    const request=JSON.parse(body);
    const methods=new Map([
      ['publicPrices',[publicPrices,0]],['publicInfo',[publicInfo,0]],['liveFloor',[liveFloor,0]],
      ['requestEventCode',[requestEventCode,1]],['signInEvent',[signInEvent,3]],
      ['requestPlayerCode',[requestPlayerCode,1]],['verifyPlayerCode',[verifyPlayerCode,2]],['playerLogout',[playerLogout,1]],
      ['requestMatchedPlayerCode',[requestMatchedPlayerCode,2]],['signInPlayer',[signInPlayer,3]],['passInfo',[passInfo,1]],
      ['playerHome',[playerHome,2]],['playerStart',[playerStart,3]],['playerStatus',[playerStatus,2]],
      ['playerSelectReceiver',[playerSelectReceiver,3]],['playerSaveDetails',[playerSaveDetails,3]],['playerCheckout',[playerCheckout,2]],['playerUpload',[playerUpload,4]],['playerReadProof',[playerReadProof,3]],['playerSubmitPayment',[playerSubmitPayment,4]],['playerIdentifyReceiver',[playerIdentifyReceiver,3]],
      ['scanEntryTicket',[scanEntryTicket,3]]
    ]);
    const method=request&&methods.get(request.action);
    must_(method&&Array.isArray(request.args)&&request.args.every(arg=>typeof arg==='string'),'Invalid event request.');
    must_(body.length<=2410000||['playerReadProof','playerSubmitPayment'].includes(request.action),'This request is too large.');
    must_(request.args.length===method[1]||['playerStart','playerSelectReceiver','signInEvent'].includes(request.action)&&request.args.length===4, 'Refresh the event page and sign in to continue.');
    result={ok:true,value:method[0](...request.args)};
  }catch(error){
    const validation=error.name==='EventValidationError';
    const retryable=error.name==='EventBusyError';
    result={ok:false,error:validation||retryable?error.message:'The event service is temporarily unavailable. Please try again.',validation,retryable};
  }
  return ContentService.createTextOutput(JSON.stringify(result)).setMimeType(ContentService.MimeType.JSON);
}
function settings_(){
  const rows=book_().getSheetByName('Settings').getRange(2,1,5,2).getDisplayValues();
  const [upi,name,flag,file,publish]=rows.map(row=>row[1].trim());
  const legacy=rows[3][0]!=='Payment QR file'||rows[4][0]!=='Payment details published';
  const qrFile=legacy?'':file;
  const wasOpen=flag.toLowerCase()==='yes';
  return {upi,name,qrFile,legacy,open:wasOpen||(legacy&&!upi&&!name),
    published:legacy?wasOpen&&!!(upi&&name):publish.toLowerCase()==='yes'};
}
function writeSettings_(s){
  const sheet=book_().getSheetByName('Settings');
  const extra=sheet.getRange(5,1,2,2).getDisplayValues();
  if(extra.some(row=>row.some(Boolean))&&(extra[0][0]!=='Payment QR file'||extra[1][0]!=='Payment details published'))sheet.insertRowsAfter(4,2);
  sheet.getRange(2,1,5,2).setValues([
    ['Receiving UPI ID',s.upi],['Recipient name',s.name],['Registration open',s.open?'yes':'no'],
    ['Payment QR file',s.qrFile],['Payment details published',s.published?'yes':'no']
  ]);
}
function paymentsReady_(s){return !!(s.published&&s.name&&(s.upi||s.qrFile))}
function publicPrices(){return {...entryOffer_(Date.now()),retry:ENTRY_PRICING.retry}}
function signupInfo_(s,now,st){
  const open=s.open&&now>=PRE_OPENS&&now<NEW_CLOSE;
  const offer=entryOffer_(now);
  const info={open,paymentsReady:paymentReadyFor_(s,st||ledger_()),offer,fee:offer.amount};
  if(!open)info.message=now<PRE_OPENS?'Pre-registration starts on 23 November.':now>=NEW_CLOSE?'New registrations have ended.':'The club has paused new registrations.';
  return info;
}
function directoryPerson_(row){return {name:row[1],email:row[2].trim(),phone:row[3].replace(/\D/g,'')}}
function directoryPlayer_(roll){
  const sheet=book_().getSheetByName('Students');
  const found=sheet.getRange('A:A').createTextFinder('^\\s*'+roll+'\\s*$').useRegularExpression(true).findAll();
  if(found.length!==1)return null;
  const row=sheet.getRange(found[0].getRow(),1,1,4).getDisplayValues()[0];
  return row[0].trim()===roll?directoryPerson_(row):null;
}
function roster_(){
  const sheet=book_().getSheetByName('Students'),n=sheet.getLastRow()-1,people={};
  if(n>0)sheet.getRange(2,1,n,4).getDisplayValues().forEach(row=>{
    const roll=row[0].trim();if(/^\d{9}$/.test(roll))people[roll]=directoryPerson_(row);
  });
  return people;
}
function stageName_(n){return n<6?'Round 1 · Wave '+(n+1):n===6?'Round 2 · Semifinals':'Round 3 · Final'}
function usesBankVerification_(st){return receivers_(st).length>0||props_().getProperty('PAYMENT_VERIFICATION_REQUIRED')==='yes'}
function paymentReadyFor_(set,st){return usesBankVerification_(st)?receivers_(st).some(r=>r.active):paymentsReady_(set)}
function fresh_(){return {receivers:{},statements:{},bankCorrections:{},attempts:{},venue:{},game:{next:0,active:null,history:[]},audit:[]}}
function nextSeat_(state,wave){
  const taken=new Set(Object.values(state.attempts).filter(a=>a.wave===wave&&a.used).map(a=>a.seat));
  for(let seat=1;seat<=CAP;seat++)if(!taken.has(seat))return seat;
  throw Error('No numbered seat is available in this wave. Contact the floor manager.');
}
function apply_(state,patch,action,time){
  for(const receiver of patch.receivers||[])state.receivers[receiver.id]=receiver;
  for(const statement of patch.statements||[])state.statements[statement.id]=statement;
  if(patch.bankCorrection)state.bankCorrections[patch.bankCorrection.key]=patch.bankCorrection;
  for(const d of patch.bankDecisions||[]){
    const a=state.attempts[d.id];must_(a,'Missing payment in the reconciliation journal.');
    state.attempts[d.id]={...a,status:'PAID',paymentStatus:'AUTHORIZED',utr:d.utr,bankRow:d.row,bankStatement:patch.bankStatement,verified:patch.bankTime,reviewReason:'',decisionReason:d.reason||'',delivery:'Pending delivery'};
  }
  for(const [id,reason] of patch.bankFlags||[])state.attempts[id]={...state.attempts[id],reviewReason:reason};
  for(const a of patch.attempts||[]){
    // Older admissions recorded the time on the journal row and only a used flag on the ticket.
    if(a.used&&!a.checkedInAt){
      const prior=state.attempts[a.id];
      if(prior?.checkedInAt){a.checkedInAt=prior.checkedInAt;a.seat=prior.seat}
      else if(action==='Gate admit'){a.checkedInAt=Number(time);a.seat=nextSeat_(state,a.wave)}
    }
    state.attempts[a.id]=a;
  }
  Object.assign(state.venue,patch.venue||{});
  if(patch.game)state.game=patch.game;
}
// The journal is append-only. A cached snapshot covers exactly its recorded prefix.
const JOURNAL_SNAPSHOT='event-journal-prefix-v1', JOURNAL_CHUNK=88000;
function readJournalSnapshot_(cache,end){
  const saved=JSON.parse(cache.get(JOURNAL_SNAPSHOT)||'null');
  if(!saved||!Number.isSafeInteger(saved.row)||saved.row<1||saved.row>end)return null;
  let packed=saved.packed;
  if(saved.parts){
    const keys=Array.from({length:saved.parts},(_,i)=>JOURNAL_SNAPSHOT+':'+saved.row+':'+i),parts=cache.getAll(keys);
    if(keys.some(key=>!parts[key]))return null;
    packed=keys.map(key=>parts[key]).join('');
  }
  return {row:saved.row,state:JSON.parse(Utilities.ungzip(Utilities.newBlob(Utilities.base64Decode(packed),'application/gzip')).getDataAsString())};
}
function saveJournalSnapshot_(cache,row,state){
  const packed=Utilities.base64Encode(Utilities.gzip(Utilities.newBlob(JSON.stringify(state),'text/plain')).getBytes());
  let value={row,packed};
  if(packed.length>JOURNAL_CHUNK){
    const parts=Math.ceil(packed.length/JOURNAL_CHUNK),chunks={};
    for(let i=0;i<parts;i++)chunks[JOURNAL_SNAPSHOT+':'+row+':'+i]=packed.slice(i*JOURNAL_CHUNK,(i+1)*JOURNAL_CHUNK);
    cache.putAll(chunks,600);value={row,parts};
  }
  cache.put(JOURNAL_SNAPSHOT,JSON.stringify(value),600);
}
function ledger_(){
  const sheet=book_().getSheetByName('Journal'),end=sheet.getLastRow();
  let cache,saved;
  try{cache=CacheService.getScriptCache();saved=readJournalSnapshot_(cache,end)}catch{/* Evicted or unreadable snapshots are rebuilt from the sheet. */}
  const state=saved?saved.state:fresh_(),after=saved?saved.row:1;
  if(end>after){
    for(const [time,action,actor,json] of sheet.getRange(after+1,1,end-after,4).getValues()){
      const patch=JSON.parse(json);apply_(state,patch,action,time);
      state.audit.push({time:Number(time),action,actor,target:patch.note||''});if(state.audit.length>35)state.audit.shift();
    }
    try{saveJournalSnapshot_(cache,end,state)}catch{/* The journal remains authoritative if the cache is full. */}
  }
  return state;
}
function commit_(st,action,actor,patch){
  const json=JSON.stringify(patch);must_(json.length<49000,'This update is too large. Contact the desk.');
  book_().getSheetByName('Journal').appendRow([Date.now(),action,actor,json]);SpreadsheetApp.flush();apply_(st,patch);
  if(patch.game)cacheFloorChange_(st);
}
function staffList_(){const s=book_().getSheetByName('Staff'),n=s.getLastRow()-1;return n?s.getRange(2,1,n,4).getDisplayValues():[]}
function activeStaff_(row){return row[3].toLowerCase()==='yes'&&ROLE.includes(row[1])&&/^[a-z0-9]{40}$/i.test(row[2])&&(row[1]!=='admin'||(!!emailAddress_(row[0])&&emailAddress_(row[0])===clubOwner_()))}
function staffInvite_(key){
  const signature=Utilities.computeHmacSha256Signature('poker-night:staff-link:v1',key);
  return Utilities.base64EncodeWebSafe(signature).replace(/=+$/,'');
}
function invitedStaff_(invite){
  if(typeof invite!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(invite))return null;
  return staffList_().find(row=>activeStaff_(row)&&staffInvite_(row[2])===invite);
}
function deskBaseUrl_(){
  const url=(typeof CLUB_RESOURCES==='object'&&CLUB_RESOURCES.webAppUrl)||ScriptApp.getService().getUrl()||'';
  return /^https:\/\/script\.google\.com\/(?:a\/macros\/[a-z0-9.-]+\/s|macros\/s)\/[\w-]+\/exec$/.test(url)?url:'';
}
function staffDeskLink_(base,key){return base+'?view=staff&invite='+staffInvite_(key)}
function ensureStaffLinks_(){
  // Upgrade pre-invitation workbooks once. All inputs come from the club's own configuration.
  const properties=props_();
  if(properties.getProperty('STAFF_LINKS_V1'))return;
  locked_(()=>{
    if(properties.getProperty('STAFF_LINKS_V1'))return;
    const staff=book_().getSheetByName('Staff');
    if(staff&&syncStaffLinks_(staff))properties.setProperty('STAFF_LINKS_V1','ready');
  });
}
function syncStaffLinks_(sheet){
  const base=deskBaseUrl_();
  if(!base)return false;
  const title='Private desk link';
  const headers=sheet.getRange(1,1,1,Math.max(sheet.getLastColumn(),4)).getDisplayValues()[0];
  const existing=headers.indexOf(title);
  const column=existing<0?headers.length+1:existing+1;
  if(existing<0)sheet.getRange(1,column).setValue(title);
  const count=sheet.getLastRow()-1;
  if(count<=0)return true;
  const staff=sheet.getRange(2,1,count,4).getDisplayValues();
  const range=sheet.getRange(2,column,count,1);
  const current=range.getDisplayValues();
  const links=staff.map(row=>[activeStaff_(row)?staffDeskLink_(base,row[2]):'']);
  if(links.some((cell,i)=>cell[0]!==current[i][0]))range.setValues(links);
  return true;
}
function staffLogin(key,invite){
  key=String(key||'').trim();must_(/^[a-z0-9]{40}$/i.test(key),'Check your staff key.');
  must_(typeof invite==='string'&&staffInvite_(key)===invite,'Use the private link and key issued to you.');
  const row=staffList_().find(r=>r[2]===key&&activeStaff_(r));
  must_(row,'Check your staff access with the coordinator.');
  must_(row[1]!=='admin','Open the owner’s private desk link and sign in with the emailed code.');
  return staffSession_(row);
}
function staff_(token,roles){
  return staffClaims_(authSession_(token,'staff'),roles);
}
function staffClaims_(session,roles){
  must_(session&&session.type==='staff'&&session.expires>Date.now(),STAFF_SIGN_IN);
  const r=staffList_().find(x=>activeStaff_(x)&&x[1]===session.role&&hash_(x[2]).slice(0,24)===session.staffId);
  must_(r&&(r[1]==='admin'||roles.includes(r[1])),'Your staff role cannot perform that action.');
  return {name:r[0],role:r[1]};
}
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
  const past=new Set(Object.values(st.attempts).filter(a=>a.roll===roll&&issued_(a)).map(a=>a.wave));
  const start=st.game.next+(st.game.active?1:0);
  for(let w=start;w<WAVES;w++){if(!past.has(w)&&Object.values(st.attempts).filter(a=>a.id!==exceptId&&a.wave===w&&occupied_(a)).length<CAP)return w}
  return -1;
}
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
  const first=st.game.next+(st.game.active?1:0);
  if(a.status==='REVIEW'&&a.wave>=first&&a.wave<WAVES&&Object.values(st.attempts).filter(other=>other.id!==a.id&&other.wave===a.wave&&occupied_(other)).length<CAP)return a.wave;
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
  return a.status==='PAID'&&!a.used&&now<EVENT_END&&a.wave>=st.game.next+(st.game.active?1:0)&&a.wave<WAVES;
}
function receipt_(a,set,st){
  const now=Date.now(),offer=entryOffer_(now,a.kind),ready=paymentReadyFor_(set,st),managed=usesBankVerification_(st),selected=a.receiver;
  const checkout=a.status==='HOLD',ended=now>=EVENT_END;
  const full=checkout&&!ended&&waveFor_(st,a.roll,now)<0;
  const open=checkout&&!ended&&!full&&!missingDetail_(a.details)&&currentRegistration_(st,a).id===a.id;
  const payable=open&&(managed?!!selected&&st.receivers[selected.id]?.active&&st.receivers[selected.id]?.upi===selected.upi:ready);
  const payee=selected||set;
  const checkoutReceivers=open&&selected?checkoutOptions_(a,st):[];
  const pinnedQr=checkoutReceivers.find(r=>r.id===selected?.id)?.qr;
  const paymentQr=payable?(selected?pinnedQr||'':payee.qrFile?paymentQrData_(payee.qrFile):''):'';
  return {ticket:a.id+'.'+mac_('receipt:'+a.id),id:a.id,fee:quotedFee_(a,now),offer,wave:checkout?0:a.wave+1,status:a.status,
    // Older clients use expires to discard an outdated UPI amount at the pricing cutoff.
    paymentsCloseAt:EVENT_END,expires:checkout&&offer.early?Math.min(offer.endsAt,EVENT_END):checkout?EVENT_END:0,full,upi:payable?payee.upi:'',name:payable?payee.name:'',paymentQr,
    checkoutReceivers,chosenReceiverId:chosenReceiver_(a,checkoutReceivers),receiverChoiceVersion:a.receiverChoiceVersion||0,
    managed,canChooseReceiver:open&&!!selected&&!a.file&&!a.legacyReceiver,details:a.details||null,detailsRevision:a.detailsRevision||0,fairPlay:FAIR_PLAY_DECLARATION,fairPlayVersion:FAIR_PLAY_VERSION,
    paymentRecipients:selected?receivers_(st).filter(r=>r.active||r.id===selected.id||r.id===a.claim?.paidReceiver?.id||a.offeredReceivers?.some(option=>option.id===r.id)).map(receiverView_):[],
    receiver:selected?{id:selected.id,name:selected.name,upi:selected.upi,number:selected.number||''}:null,
    identifyReceivers:managed&&!selected&&['HOLD','REVIEW','REJECTED'].includes(a.status)?receivers_(st).map(receiverView_):[],
    paymentStatus:a.paymentStatus||(issued_(a)?'AUTHORIZED':'PENDING'),proofVersion:a.proofVersion||0,claim:a.claim||null,needsConfirmation:!!a.claim&&!a.claim.paidReceiver,issue:a.reviewReason||a.reason||(a.claim&&!a.claim.paidReceiver?'Confirm the payment recipient and fair-play declaration below.':''),beneficiary:a.roll,
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
function imageBytes_(data){
  must_(typeof data==='string'&&data.length<=2400000,'Choose an image under 1.7 MB after compression.');
  const m=/^data:image\/(png|jpeg);base64,([A-Za-z0-9+/=]+)$/.exec(data);must_(m,'Upload a JPEG or PNG screenshot.');
  const bytes=Utilities.base64Decode(m[2]),head=bytes.slice(0,8).map(b=>b&255);
  must_(bytes.length>=20&&bytes.length<=1800000&&(m[1]==='png'?head.join(',')==='137,80,78,71,13,10,26,10':head[0]===255&&head[1]===216&&head[2]===255),'The image format is invalid.');
  return {bytes,mime:'image/'+m[1],ext:m[1]==='png'?'png':'jpg'};
}
function playerUpload(session,ticket,suffix,data){
  const roll=playerRoll_(session);
  suffix=String(suffix||'').trim();must_(!suffix||/^\d{4,12}$/.test(suffix),'Enter the final 4–12 visible bank-reference digits, or leave the field blank.');
  const im=imageBytes_(data),digest=proofDigest_(im.bytes);
  return saveProofFile_(roll,ticket,im,'proof',(st,a)=>{
    must_(!usesBankVerification_(st),'Refresh the event page to submit the full payment details.');
    if(a.status==='REVIEW'||issued_(a))return null;
    must_(a.status==='HOLD'&&currentRegistration_(st,a).id===a.id,'Open your current registration to submit proof.');
    requirePlayerDetails_(a.details);
    const now=Date.now();
    return {status:'REVIEW',wave:proofWave_(st,a,now),fee:quotedFee_(a,now),digest,suffix,submitted:now};
  });
}
function pass_(id){return 'PN-'+mac_('gate:'+id).slice(0,16).toUpperCase().replace(/_/g,'X').replace(/-/g,'Y')}
function normalizeCode_(s){return String(s||'').trim().toUpperCase().replace(/[\s-]/g,'')}
function byCode_(st,s){
  const v=normalizeCode_(s);
  if(!/^PN[A-Z0-9]{16}$/.test(v))return null;
  // Cache only the lookup. Every scan checks the ticket in the current journal.
  const key='ticket-id:'+v;
  let cache;
  try{cache=CacheService.getScriptCache();const a=st.attempts[cache.get(key)];if(a&&issued_(a)&&normalizeCode_(pass_(a.id))===v)return a}catch{}
  const match=Object.values(st.attempts).find(a=>issued_(a)&&normalizeCode_(pass_(a.id))===v);
  if(match&&cache){try{cache.put(key,match.id,21600)}catch{}}
  return match;
}
function passInfo(code){
  const st=ledger_(),a=byCode_(st,code);must_(a,'Invalid ticket');
  const active=ticketActive_(a,st,Date.now());
  return {used:!!a.used,active,wave:a.wave+1,seat:a.seat||null,checkedInAt:a.checkedInAt||null,code:active?pass_(a.id):''};
}
function proofImage(token,id){staff_(token,['desk']);const a=ledger_().attempts[id];must_(a&&a.file,'No screenshot was uploaded for this attempt.');const b=DriveApp.getFileById(a.file).getBlob();return 'data:'+b.getContentType()+';base64,'+Utilities.base64Encode(b.getBytes())}

// MailApp supplies the executing club account as From. All event mail shares its identity.
const EVENT_MAIL_NAME = 'Poké Poker Night 2026';
const EVENT_PAGE = 'https://meherpraveen.github.io/imt-ecell-poker-night/event.html';
function sendEventMail_(recipient, subject, paragraphs) {
  const body = [...paragraphs, 'Entrepreneurship Cell, IMT Ghaziabad\nYou can reply to this email for help.'].join('\n\n');
  MailApp.sendEmail(recipient, subject, body, {name:EVENT_MAIL_NAME, replyTo:clubOwner_()});
}
function deliverPass_(id,actor,force=false){
  const plan=locked_(()=>{
    const st=ledger_(),a=st.attempts[id],now=Date.now();
    must_(a&&issued_(a),'This payment has no authorized ticket.');
    if(force)must_(ticketActive_(a,st,now),'This ticket is no longer available for entry.');
    if(a.mailUntil>now)return {status:'Sending email'};
    if(!force&&a.delivery!=='Pending delivery')return {status:a.delivery||'Desk delivery needed'};
    const slots=pendingMail_(now);
    if(remainingMail_(slots)<=1){
      commit_(st,'Pass delivery',actor,{attempts:[{...a,delivery:'Desk delivery needed'}],note:id});
      return {status:'Desk delivery needed'};
    }
    const ref=rand_().slice(0,16),until=now+6*60000;
    slots[ref]=until;props_().setProperty('MAIL_IN_FLIGHT',JSON.stringify(slots));
    // If the provider acknowledgement is lost, the desk can explicitly resend the same pass.
    commit_(st,'Pass delivery started',actor,{attempts:[{...a,delivery:'Desk delivery needed',mailClaim:ref,mailUntil:until}],note:id});
    return {ref,a};
  },false);
  if(!plan.ref)return plan.status;
  let delivery='Desk delivery needed';
  try{
    const a=plan.a,person=roster_()[a.roll],code=pass_(id);
    if(person&&emailAddress_(person.email)){
      const subject=EVENT_MAIL_NAME+' '+(a.kind==='retry'?'retry':'entry')+' pass';
      sendEventMail_(person.email,subject,[
        'E-Cell verified your '+formatFee_(a.fee)+' payment for Round 1, wave '+(a.wave+1)+'.',
        'Open your private pass to show or save your entry QR.\n'+EVENT_PAGE+'?view=pass#code='+encodeURIComponent(code),
        'You can also give the gate volunteer this code.\n'+code,
        'Bring your college ID on 27 November and keep your pass private.'
      ]);
      delivery='Email sent';
    }
  }catch{console.warn('Pass email delivery was unconfirmed for '+id)}
  return locked_(()=>{
    const st=ledger_(),latest=st.attempts[id],slots=pendingMail_(Date.now());
    delete slots[plan.ref];props_().setProperty('MAIL_IN_FLIGHT',JSON.stringify(slots));
    if(latest.mailClaim!==plan.ref)return latest.delivery;
    // Admission or a detail edit may have been committed while the email was in flight.
    commit_(st,'Pass delivery',actor,{attempts:[{...latest,delivery,mailClaim:'',mailUntil:0}],note:id});
    return delivery;
  },false);
}
function staffApprove(token,id,fullRef,confirmed){
  const staff=staff_(token,['desk']);fullRef=ref_(fullRef);must_(confirmed===true&&fullRef,'Confirm the receiving-account credit and enter its full 12-digit UPI reference.');
  locked_(()=>{const st=ledger_(),a=st.attempts[id];must_(a,'Attempt missing.');
    if(issued_(a)&&a.utr===fullRef)return;
    must_(!usesBankVerification_(st),'Use the admin statement review to authorize this payment.');
    must_(a.status==='REVIEW','This attempt is not awaiting review.');
    must_(validBatch_(a.details?.batch),'Ask the player to choose their batch in registration details. Their proof is saved.');
    must_(!a.suffix||fullRef.endsWith(a.suffix),'The visible receipt digits do not match this bank reference. Check the credit and proof again.');
    must_(!Object.values(st.attempts).some(v=>v.id!==id&&v.utr===fullRef),'This bank reference has already paid for another attempt.');
    must_(Date.now()<EVENT_END&&a.wave>=st.game.next+(st.game.active?1:0)&&a.wave<WAVES,'Move this payment to an available qualifier before approving it.');
    must_(Object.values(st.attempts).filter(other=>other.id!==a.id&&other.wave===a.wave&&occupied_(other)).length<CAP,'The wave is full. Move this payment to an available wave.');
    const paid={...a,status:'PAID',utr:fullRef,verified:Date.now(),delivery:'Pending delivery'};
    commit_(st,'Payment approved',staff.name,{attempts:[paid],note:id});
  },false);
  return {status:deliverPass_(id,staff.name)};
}
function staffReject(token,id,why){const s=staff_(token,['desk']);why=String(why||'').trim().slice(0,180);must_(why,'Add a short reason for the player.');return locked_(()=>{const st=ledger_(),a=st.attempts[id];must_(!usesBankVerification_(st),'Use the admin statement review to reject this proof.');must_(a&&a.status==='REVIEW','Only pending proofs can be rejected.');commit_(st,'Proof rejected',s.name,{attempts:[{...a,status:'REJECTED',reason:why}],note:id});return true})}
function deskPayment(token,roll,kind,full,confirmed,verifiedFee,batch,phone){
  const s=staff_(token,['desk']);roll=roll_(roll);full=ref_(full);must_(['walk','retry'].includes(kind)&&full&&confirmed===true,'Check college ID and receiving-account credit, then enter the full UPI reference.');
  const id=locked_(()=>{const st=ledger_(),people=roster_(),now=Date.now();must_(!usesBankVerification_(st),'Open a desk payment and have the player upload proof.');must_(people[roll],'This roll is missing from the private directory.');
    const used=Object.values(st.attempts).find(a=>a.utr===full);
    if(used&&used.roll===roll&&(used.kind===kind||(kind==='walk'&&used.kind==='pre')))return used.id;
    must_(!used,'This reference has already been used.');
    const existing=Object.values(st.attempts).find(a=>a.roll===roll&&(a.kind===kind||(kind==='walk'&&a.kind==='pre'))&&
      ['REGISTERED','WAITLIST','HOLD'].includes(a.status)&&currentRegistration_(st,a).id===a.id);
    const fee=existing?quotedFee_(existing,now):entryOffer_(now,kind).amount;
    must_(verifiedFee===undefined||verifiedFee===fee,'The expected fee has changed. Refresh the player record and check the credit.');
    if(kind==='walk')must_(now>=DESK_OPENS&&now<NEW_CLOSE,'Walk-in purchases run from 7 to 11 PM IST.');
    eligibility_(st,roll,kind,now,existing?.id);
    const wave=waveFor_(st,roll,now);must_(wave>=0,'No later Round 1 seat is available. Do not collect a payment.');
    const saved=existing?.details||latestRegistration_(st,roll)?.details;
    const details=registrationDetails_(roll,{fullName:saved?.fullName||people[roll].name,pgpId:roll,contact:validContact_(saved?.contact)?saved.contact:phone||people[roll].phone,batch:validBatch_(saved?.batch)?saved.batch:batch});
    const a={...(existing||newAttempt_(roll,kind,wave,now)),details,detailsRevision:existing?.detailsRevision||1,fee,wave,status:'PAID',utr:full,verified:now,delivery:'Pending delivery'};
    const oldWait=Object.values(st.attempts).filter(v=>v.roll===roll&&v.id!==a.id&&v.status==='WAITLIST').map(v=>({...v,status:'RELEASED'}));
    commit_(st,'Desk payment verified',s.name,{attempts:[...oldWait,a],note:a.id});return a.id;
  },false);
  return {status:deliverPass_(id,s.name),id};
}
function staffPass(token,id,send){
  const staff=staff_(token,['desk']);
  if(send)deliverPass_(id,staff.name,true);
  const st=ledger_(),a=st.attempts[id];
  must_(a&&ticketActive_(a,st,Date.now()),'This ticket is no longer available for entry.');
  const p=a.details||roster_()[a.roll]||{};
  return {code:pass_(id),phone:(p.contact||p.phone||'').replace(/\D/g,''),name:p.fullName||p.name||'',wave:a.wave+1,delivery:a.mailUntil>Date.now()?'Sending email':a.delivery};
}
function scannerLink_(token){
  // This capability can only admit tickets. Revoking the parent desk session also revokes the camera.
  const key=hash_(token);
  return EVENT_PAGE+'?view=scan#access='+key+'.'+mac_('camera-admit:'+key);
}
function scanEntryTicket(access,value,op){
  const match=/^([\w-]{43})\.([\w-]{43})$/.exec(access);
  must_(match&&equalDigest_(match[2],mac_('camera-admit:'+match[1])),STAFF_SIGN_IN);
  const session=JSON.parse(props_().getProperty('AUTH_SESSION_'+match[1])||'null');
  const staff=staffClaims_(session,['gate','desk']);
  return admitTicket_(staff,value,op);
}
function admitTicket_(staff,value,op){
  must_(/^[a-zA-Z0-9-]{8,64}$/.test(op),'Invalid gate action.');
  return locked_(()=>{
    const st=ledger_(),a=byCode_(st,value);
    if(!a)return {status:'invalid'};
    if(!a.used&&!ticketActive_(a,st,Date.now()))return {status:'invalid'};
    const player=a.details?.fullName||roster_()[a.roll]?.name||a.roll;
    if(a.used)return {status:'used',player,wave:a.wave+1,seat:a.seat,checkedInAt:a.checkedInAt};
    const seat=nextSeat_(st,a.wave),checkedInAt=Date.now();
    const venue={where:'IN',ops:[...(st.venue[a.roll]?.ops||[]).slice(-23),op]};
    commit_(st,'Gate admit',staff.name,{attempts:[{...a,used:true,seat,checkedInAt}],venue:{[a.roll]:venue},note:a.roll});
    return {status:'admitted',player,wave:a.wave+1,seat,checkedInAt};
  },false);
}
function gateAction(token,action,value,op){
  const s=staff_(token,['gate','desk']);
  if(action==='admit')return admitTicket_(s,value,op);
  must_(['exit','return'].includes(action)&&/^[a-zA-Z0-9-]{8,64}$/.test(op),'Invalid gate action.');
  return locked_(()=>{const st=ledger_(),roll=roll_(value),prior=st.venue[roll]||{where:'NEVER',ops:[]};
    if(prior.ops.includes(op))return 'Already recorded';
    if(action==='exit')must_(prior.where==='IN','This player is not recorded inside.');
    if(action==='return')must_(prior.where==='OUT','A venue return requires an earlier checked-in exit.');
    const where=action==='exit'?'OUT':'IN',v={where,ops:[...prior.ops.slice(-23),op]};
    commit_(st,'Gate '+action,s.name,{venue:{[roll]:v},note:roll});return where==='IN'?'Recorded inside':'Recorded outside';
  });
}
function releaseSeat(token,id,mode){
  const s=staff_(token,['desk','floor']);return locked_(()=>{const st=ledger_(),a=st.attempts[id];must_(a,'Attempt missing.');
    if(mode==='no-show'){must_(a.status==='PAID'&&!a.used,'Only an unused paid pass can be marked no-show.');commit_(st,'No-show',s.name,{attempts:[{...a,status:'NO_SHOW'}],note:id})}
    else if(mode==='move'){must_(['REVIEW','WAITLIST'].includes(a.status),'Only a pending or waitlisted attempt can move.');const now=Date.now(),w=waveFor_(st,a.roll,now,a.id);must_(w>=0,'No wave has space.');const moved={...a,wave:a.status==='REVIEW'?w:-1,reservedAfterReview:a.status==='REVIEW'};if(a.status==='WAITLIST'){must_(paymentReadyFor_(settings_(),st)&&now<EVENT_END,'Checkout is currently unavailable.');Object.assign(moved,{fee:entryOffer_(now,a.kind).amount,status:'HOLD'})}commit_(st,'Seat offered',s.name,{attempts:[a.status==='WAITLIST'?attachReceiver_(moved,st,now):moved],note:id})}
    else throw Error('Unknown seat action.');return true;
  });
}
