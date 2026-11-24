const CAP=36, WAVES=6, HOLD=15*60000;
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
function locked_(fn,flush=true){const l=LockService.getScriptLock();l.waitLock(24000);try{return fn()}finally{try{if(flush)SpreadsheetApp.flush()}finally{l.releaseLock()}}}
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
    must_(typeof body==='string'&&body.length<=2410000,'Check the request or choose a smaller screenshot.');
    const request=JSON.parse(body);
    const methods=new Map([
      ['publicPrices',[publicPrices,0]],['publicInfo',[publicInfo,0]],['liveFloor',[liveFloor,0]],
      ['requestEventCode',[requestEventCode,1]],['signInEvent',[signInEvent,3]],
      ['requestPlayerCode',[requestPlayerCode,1]],['verifyPlayerCode',[verifyPlayerCode,2]],['playerLogout',[playerLogout,1]],
      ['requestMatchedPlayerCode',[requestMatchedPlayerCode,2]],['signInPlayer',[signInPlayer,3]],['passInfo',[passInfo,1]],
      ['playerHome',[playerHome,2]],['playerStart',[playerStart,3]],['playerStatus',[playerStatus,2]],
      ['playerCheckout',[playerCheckout,2]],['playerUpload',[playerUpload,4]],['playerReadProof',[playerReadProof,3]],['playerSubmitPayment',[playerSubmitPayment,4]],['playerIdentifyReceiver',[playerIdentifyReceiver,3]],
      ['scanEntryTicket',[scanEntryTicket,3]]
    ]);
    const method=request&&methods.get(request.action);
    must_(method&&Array.isArray(request.args)&&request.args.every(arg=>typeof arg==='string'),'Invalid event request.');
    must_(request.args.length===method[1], 'Refresh the event page and sign in to continue.');
    result={ok:true,value:method[0](...request.args)};
  }catch(error){
    const validation=error.name==='EventValidationError';
    result={ok:false,error:validation?error.message:'The event service is temporarily unavailable. Please try again.',validation};
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
function roster_(){
  const s=book_().getSheetByName('Students'),n=s.getLastRow()-1;if(n<1)return {};
  return Object.fromEntries(s.getRange(2,1,n,4).getDisplayValues().filter(r=>/^\d{9}$/.test(r[0].trim())).map(r=>[r[0].trim(),{name:r[1],email:r[2].trim(),phone:r[3].replace(/\D/g,'')}]));
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
function ledger_(){
  const s=book_().getSheetByName('Journal'),end=s.getLastRow(),cache=CacheService.getScriptCache(),key='journal-payments-v3:'+end;
  try{const v=cache.get(key);if(v)return JSON.parse(Utilities.ungzip(Utilities.newBlob(Utilities.base64Decode(v),'application/gzip')).getDataAsString())}catch(e){}
  const state=fresh_();
  if(end>1){for(const [time,action,actor,json] of s.getRange(2,1,end-1,4).getValues()){
    const patch=JSON.parse(json);apply_(state,patch,action,time);
    state.audit.push({time:Number(time),action,actor,target:patch.note||''});if(state.audit.length>35)state.audit.shift();
  }}
  try{const packed=Utilities.base64Encode(Utilities.gzip(Utilities.newBlob(JSON.stringify(state),'text/plain')).getBytes());if(packed.length<93000)cache.put(key,packed,90)}catch(e){}
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
function holdEnd_(a){
  // Also bounds holds created by the previous release.
  return a.kind!=='retry'&&a.fee===ENTRY_PRICING.earlyBird
    ? Math.min(a.expires,Date.parse(ENTRY_PRICING.earlyBirdEndsAt)) : a.expires;
}
function quotedFee_(a,now){
  return ['REGISTERED','WAITLIST'].includes(a.status)?entryOffer_(now,a.kind).amount:a.fee;
}
function occupied_(a,now){if(a.status==='REVIEW'&&a.late&&!a.reservedAfterReview)return false;return a.status==='HOLD'?holdEnd_(a)>now:['REVIEW','PAID','ELIMINATED','QUALIFIED','WINNER'].includes(a.status)}
function waveFor_(st,roll,now){
  const past=new Set(Object.values(st.attempts).filter(a=>a.roll===roll&&issued_(a)).map(a=>a.wave));
  const start=st.game.next+(st.game.active?1:0);
  for(let w=start;w<WAVES;w++){if(!past.has(w)&&Object.values(st.attempts).filter(a=>a.wave===w&&occupied_(a,now)).length<CAP)return w}
  return -1;
}
function eligibility_(st,roll,kind,now,exceptId){
  must_(now<EVENT_END,'The event has closed.');
  if(kind!=='retry')must_(now<NEW_CLOSE,'New registrations closed at 11 PM IST.');
  if(kind==='walk')must_(now>=DESK_OPENS,'Walk-in registration opens at 7 PM IST.');
  if(kind==='pre')must_(now<DESK_OPENS,'Use the walk-in desk from 7 PM IST.');
  const mine=Object.values(st.attempts).filter(a=>a.roll===roll&&a.id!==exceptId);
  const active=mine.find(a=>['REGISTERED','REVIEW','PAID','QUALIFIED','WINNER'].includes(a.status)||(a.status==='HOLD'&&holdEnd_(a)>now));
  must_(!active,'There is already an active attempt for this roll. Use the original receipt page or ask the desk.');
  if(kind==='retry')must_(mine.some(a=>a.status==='ELIMINATED')&&st.game.next<6,'A retry requires an eliminated player and a later Round 1 wave.');
  else must_(!mine.some(a=>issued_(a)),'This roll has played already. The desk can check retry eligibility.');
}
function paymentTerms_(kind,now){
  const offer=entryOffer_(now,kind);
  return {fee:offer.amount,expires:offer.early?Math.min(now+HOLD,offer.endsAt):now+HOLD};
}
function newAttempt_(roll,kind,w,now){return {id:rand_().slice(0,16),roll,kind,...paymentTerms_(kind,now),wave:w,created:now,status:w<0?'WAITLIST':'HOLD',used:false,delivery:''}}
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
  return accountForRoll_(playerRoll_(session),preferred);
}
function accountForRoll_(roll,preferred){
  loadInitialReceivers_();
  const st=ledger_(),set=settings_(),now=Date.now(),saved=fromReceipt_(st,preferred);
  const latest=Object.values(st.attempts).filter(a=>a.roll===roll).sort((a,b)=>b.created-a.created)[0];
  const attempt=saved&&saved.roll===roll?saved:latest;
  const person=roster_()[roll]||{};
  return {...signupInfo_(set,now,st),player:{name:person.name||'',roll,email:person.email||'',phone:person.phone||''},receipt:attempt?receipt_(attempt,set,st):null};
}
function playerStart(session,previous,requestId){
  const roll=playerRoll_(session);
  must_(!requestId||(typeof requestId==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId)),'Refresh the page and try again.');
  return locked_(()=>{
    const set=settings_(),st=ledger_(),now=Date.now();
    if(previous){const a=fromReceipt_(st,previous);if(a&&a.roll===roll)return receipt_(a,set,st);}
    const startHash=requestId?hash_('seat-request:'+requestId):'';
    if(startHash){
      const existing=Object.values(st.attempts).find(a=>a.roll===roll&&a.startHash===startHash);
      if(existing)return receipt_(existing,set,st);
    }
    const info=signupInfo_(set,now,st);
    must_(info.open,info.message);
    const kind=now>=DESK_OPENS?'walk':'pre';
    const wait=Object.values(st.attempts).find(a=>a.roll===roll&&a.status==='WAITLIST');
    must_(!wait,'This roll is already on the waitlist. Open your original receipt page or ask the desk.');
    eligibility_(st,roll,kind,now);
    const a=attachReceiver_(newAttempt_(roll,kind,info.paymentsReady?waveFor_(st,roll,now):-1,now),st,now);
    if(!info.paymentsReady){a.status='REGISTERED';a.expires=0}
    if(startHash)a.startHash=startHash;
    commit_(st,a.status==='REGISTERED'?'Registration saved':'Seat request','Player',{attempts:[a],note:a.id});return receipt_(a,set,st);
  });
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
  const now=Date.now(),expires=holdEnd_(a),hold=a.status==='HOLD'&&now<expires,ready=paymentReadyFor_(set,st);
  const managed=usesBankVerification_(st);
  const selected=a.receiver;
  const payable=hold&&(managed?!!selected&&st.receivers[selected.id]?.active&&st.receivers[selected.id]?.upi===selected.upi:ready);
  const payee=selected||set;
  return {ticket:a.id+'.'+mac_('receipt:'+a.id),id:a.id,fee:quotedFee_(a,now),offer:entryOffer_(now,a.kind),wave:a.wave+1,status:a.status==='HOLD'&&!hold?'EXPIRED':a.status,
    expires,upi:payable?payee.upi:'',name:payable?payee.name:'',paymentQr:payable&&payee.qrFile?paymentQrData_(payee.qrFile):'',
    managed,receiver:selected?{id:selected.id,name:selected.name,upi:selected.upi,number:selected.number||''}:null,
    identifyReceivers:managed&&!selected&&['HOLD','REVIEW','REJECTED'].includes(a.status)?receivers_(st).map(receiverView_):[],
    paymentStatus:a.paymentStatus||(issued_(a)?'AUTHORIZED':'PENDING'),proofVersion:a.proofVersion||0,claim:a.claim||null,issue:a.reviewReason||a.reason||'',beneficiary:a.roll,
    canCheckout:a.status==='REGISTERED'&&ready&&now<NEW_CLOSE,checkoutEnded:now>=NEW_CLOSE,delivery:a.delivery||'',reason:a.reason||'',
    seat:a.seat||null,checkedInAt:a.checkedInAt||null,entryCode:ticketActive_(a,st,now)?pass_(a.id):''};
}
function playerStatus(session,ticket){
  const roll=playerRoll_(session),st=ledger_();
  return receipt_(ownReceipt_(st,ticket,roll),settings_(),st);
}
function playerCheckout(session,ticket){
  const roll=playerRoll_(session);
  return locked_(()=>{
    const st=ledger_(),a=ownReceipt_(st,ticket,roll),set=settings_(),now=Date.now();
    if(a.status!=='REGISTERED')return receipt_(a,set,st);
    must_(now<NEW_CLOSE,'New payment holds have ended. Contact E-Cell if you already paid.');
    must_(paymentReadyFor_(set,st),'The club has not published payment details yet. Your registration is saved.');
    const wave=waveFor_(st,a.roll,now);
    const next=attachReceiver_({...a,...paymentTerms_(a.kind,now),wave,status:wave<0?'WAITLIST':'HOLD'},st,now);
    if(wave<0)next.expires=0;
    commit_(st,'Seat request','Player',{attempts:[next],note:a.id});
    return receipt_(next,set,st);
  });
}
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
  return locked_(()=>{const st=ledger_(),a=ownReceipt_(st,ticket,roll);
    must_(!usesBankVerification_(st),'Refresh the event page to submit the full payment details.');
    if(a.status==='REVIEW'||issued_(a))return receipt_(a,settings_(),st);
    must_(a.status==='HOLD'&&Date.now()<holdEnd_(a),'Your seat hold ended. If you already paid, show the receipt to the desk before paying again.');
    const im=imageBytes_(data),digest=Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,im.bytes));
    const file=DriveApp.getFolderById(props_().getProperty('FOLDER')).createFile(Utilities.newBlob(im.bytes,im.mime,a.id+'.'+im.ext));
    const updated={...a,status:'REVIEW',file:file.getId(),digest,suffix,submitted:Date.now()};
    try{commit_(st,'Proof submitted','Player',{attempts:[updated],note:a.id})}catch(err){if(ledger_().attempts[a.id]?.file!==file.getId())file.setTrashed(true);throw err}
    return receipt_(updated,settings_(),st);
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
function escapeMailHtml_(value) {
  const entities = {'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'};
  return String(value).replace(/[&<>"']/g, char => entities[char]);
}
function sendEventMail_(recipient, {subject, heading, message, code, instructions, passUrl}) {
  const organizer = 'Entrepreneurship Cell, IMT Ghaziabad';
  const support = 'You can reply to this email for help.';
  const plain = [heading, message, code, instructions, passUrl, organizer, support].filter(Boolean).join('\n\n');
  const link = passUrl
    ? '<p><a style="color:#164686" href="'+escapeMailHtml_(passUrl)+'">Open your pass on the event website</a></p>' : '';
  const options = {name:EVENT_MAIL_NAME, replyTo:clubOwner_()};
  let qrImage = '';
  if(passUrl){
    const qr = ticketQrEncoder_(0,'M');
    qr.addData(code);qr.make();
    const bytes=Utilities.base64Decode(qr.createDataURL(8,32).split(',')[1]);
    options.inlineImages={entryQr:Utilities.newBlob(bytes,'image/gif','poker-night-entry.gif')};
    qrImage='<p><img src="cid:entryQr" width="200" height="200" alt="Single-use entry QR"></p>';
  }
  options.htmlBody = '<!doctype html><html lang="en"><body style="margin:0;padding:16px;background:#ffffff;color:#162b48;font:16px/1.5 Arial,sans-serif">'+
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:540px">'+
    '<tr><td bgcolor="#10294e" style="border-top:5px solid #c5283d;padding:16px 20px;background:#10294e">'+
    '<p style="margin:0;color:#ffcb05;font:700 20px/1.35 Arial,sans-serif">'+EVENT_MAIL_NAME+'</p>'+
    '<p style="margin:3px 0 0;color:#d2e0f4;font-size:14px">'+organizer+'</p></td></tr>'+
    '<tr><td style="padding:4px 20px">'+
    '<h1 style="font:700 24px/1.25 Arial,sans-serif;margin:16px 0 8px">'+escapeMailHtml_(heading)+'</h1>'+
    '<p>'+escapeMailHtml_(message)+'</p></td></tr>'+
    '<tr><td bgcolor="#edf2fa" style="padding:14px 20px;color:#10294e;font:700 22px/1.4 Consolas,monospace">'+escapeMailHtml_(code)+'</td></tr>'+
    '<tr><td style="padding:4px 20px 16px">'+qrImage+'<p>'+escapeMailHtml_(instructions)+'</p>'+link+
    '<p style="font-size:14px;color:#4e5f77">'+support+'</p></td></tr></table></body></html>';
  MailApp.sendEmail(recipient, subject, plain, options);
}
function mailCode_(st,a,person,actor){
  let delivery='Desk delivery needed';
  if(person&&emailAddress_(person.email)){
    try{must_(remainingMail_(pendingMail_(Date.now()))>1,'Email sending limit reached.');
      const code=pass_(a.id),url=EVENT_PAGE+'?view=pass#code='+encodeURIComponent(code);
      const kind = a.kind==='retry' ? 'retry' : 'entry';
      sendEventMail_(person.email, {
        subject:EVENT_MAIL_NAME+' '+kind+' pass', heading:'Your '+kind+' pass',
        message:'E-Cell verified your '+formatFee_(a.fee)+' payment for Round 1, wave '+(a.wave+1)+'. Your single-use gate code is below.',
        code, instructions:'On 27 November, bring your college ID and show the code or QR to the gate volunteer. Keep your pass private.',
        passUrl:url
      });
      delivery='Email sent';
    }catch(e){delivery='Desk delivery needed'}
  }
  const changed={...a,delivery};commit_(st,'Pass delivery',actor,{attempts:[changed],note:a.id});return changed;
}
function staffApprove(token,id,fullRef,confirmed){
  const staff=staff_(token,['desk']);fullRef=ref_(fullRef);must_(confirmed===true&&fullRef,'Confirm the receiving-account credit and enter its full 12-digit UPI reference.');
  return locked_(()=>{const st=ledger_(),a=st.attempts[id];must_(a,'Attempt missing.');
    if(issued_(a)&&a.utr===fullRef)return {status:a.delivery||'Issued'};
    must_(!usesBankVerification_(st),'Use the admin statement review to authorize this payment.');
    must_(a.status==='REVIEW','This attempt is not awaiting review.');
    must_(!a.suffix||fullRef.endsWith(a.suffix),'The visible receipt digits do not match this bank reference. Check the credit and proof again.');
    must_(!Object.values(st.attempts).some(v=>v.id!==id&&v.utr===fullRef),'This bank reference has already paid for another attempt.');
    must_(a.wave>=st.game.next+(st.game.active?1:0),'The selected wave has started. Move this payment to an available wave at the desk.');
    const paid={...a,status:'PAID',utr:fullRef,verified:Date.now(),delivery:'Pending delivery'};
    commit_(st,'Payment approved',staff.name,{attempts:[paid],note:id});const row=mailCode_(st,paid,roster_()[paid.roll],staff.name);return {status:row.delivery};
  });
}
function staffReject(token,id,why){const s=staff_(token,['desk']);why=String(why||'').trim().slice(0,180);must_(why,'Add a short reason for the player.');return locked_(()=>{const st=ledger_(),a=st.attempts[id];must_(!usesBankVerification_(st),'Use the admin statement review to reject this proof.');must_(a&&a.status==='REVIEW','Only pending proofs can be rejected.');commit_(st,'Proof rejected',s.name,{attempts:[{...a,status:'REJECTED',reason:why}],note:id});return true})}
function deskPayment(token,roll,kind,full,confirmed,verifiedFee){
  const s=staff_(token,['desk']);roll=roll_(roll);full=ref_(full);must_(['walk','retry'].includes(kind)&&full&&confirmed===true,'Check college ID and receiving-account credit, then enter the full UPI reference.');
  return locked_(()=>{const st=ledger_(),people=roster_(),now=Date.now();must_(!usesBankVerification_(st),'Open a desk payment and have the player upload proof.');must_(people[roll],'This roll is missing from the private directory.');
    const used=Object.values(st.attempts).find(a=>a.utr===full);
    if(used&&used.roll===roll&&(used.kind===kind||(kind==='walk'&&used.kind==='pre')))return {status:used.delivery,id:used.id};
    must_(!used,'This reference has already been used.');
    const existing=Object.values(st.attempts).find(a=>a.roll===roll&&(a.kind===kind||(kind==='walk'&&a.kind==='pre'))&&
      (a.status==='REGISTERED'||a.status==='WAITLIST'||(a.status==='HOLD'&&holdEnd_(a)>now)));
    const fee=existing?quotedFee_(existing,now):entryOffer_(now,kind).amount;
    must_(verifiedFee===undefined||verifiedFee===fee,'The expected fee has changed. Refresh the player record and check the credit.');
    if(kind==='walk')must_(now>=DESK_OPENS&&now<NEW_CLOSE,'Walk-in purchases run from 7 to 11 PM IST.');
    eligibility_(st,roll,kind,now,existing?.id);
    const held=existing?.status==='HOLD';
    if(held)must_(existing.wave>=st.game.next+(st.game.active?1:0),'The held wave has already started.');
    const wave=held?existing.wave:waveFor_(st,roll,now);must_(wave>=0,'No later Round 1 seat is available. Do not collect a payment.');
    const a={...(existing||newAttempt_(roll,kind,wave,now)),fee,wave,status:'PAID',utr:full,verified:now,delivery:'Pending delivery'};
    const oldWait=Object.values(st.attempts).filter(v=>v.roll===roll&&v.id!==a.id&&v.status==='WAITLIST').map(v=>({...v,status:'RELEASED'}));
    commit_(st,'Desk payment verified',s.name,{attempts:[...oldWait,a],note:a.id});const out=mailCode_(st,a,people[roll],s.name);return {status:out.delivery,id:a.id};
  });
}
function staffPass(token,id,send){const s=staff_(token,['desk']);return locked_(()=>{const st=ledger_(),a=st.attempts[id];must_(a&&ticketActive_(a,st,Date.now()),'This ticket is no longer available for entry.');const p=roster_()[a.roll]||{};
  const current=send?mailCode_(st,a,p,s.name):a;return {code:pass_(id),phone:p.phone||'',name:p.name||'',wave:a.wave+1,delivery:current.delivery};})}
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
    const player=roster_()[a.roll]?.name||a.roll;
    if(a.used)return {status:'used',player,wave:a.wave+1,seat:a.seat,checkedInAt:a.checkedInAt};
    const seat=nextSeat_(st,a.wave),checkedInAt=Date.now();
    const venue={where:'IN',ops:[...(st.venue[a.roll]?.ops||[]).slice(-23),op]};
    commit_(st,'Gate admit',staff.name,{attempts:[{...a,used:true,seat,checkedInAt}],venue:{[a.roll]:venue},note:a.roll});
    return {status:'admitted',player,wave:a.wave+1,seat,checkedInAt};
  });
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
    else if(mode==='move'){must_(['REVIEW','WAITLIST'].includes(a.status),'Only a pending or waitlisted attempt can move.');const now=Date.now(),w=waveFor_(st,a.roll,now);must_(w>=0,'No wave has space.');const moved={...a,wave:w,reservedAfterReview:a.status==='REVIEW'};if(a.status==='WAITLIST'){must_(paymentReadyFor_(settings_(),st)&&now<NEW_CLOSE,'Payment holds are currently unavailable.');Object.assign(moved,paymentTerms_(a.kind,now),{status:'HOLD'})}commit_(st,'Seat offered',s.name,{attempts:[a.status==='WAITLIST'?attachReceiver_(moved,st,now):moved],note:id})}
    else throw Error('Unknown seat action.');return true;
  });
}
