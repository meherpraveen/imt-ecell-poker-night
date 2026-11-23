const FEES={pre:149,walk:199,retry:149}, CAP=36, WAVES=6, HOLD=15*60000;
const DESK_OPENS=Date.parse('2026-11-27T19:00:00+05:30'), NEW_CLOSE=Date.parse('2026-11-27T23:00:00+05:30'), EVENT_END=Date.parse('2026-11-28T04:00:00+05:30');
const ROLE=['admin','desk','gate','floor'];
function props_(){return PropertiesService.getScriptProperties()}
function rand_(){return Utilities.getUuid().replace(/-/g,'')}
function hash_(text){return Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,text)).replace(/=+$/,'')}
function mac_(value){return Utilities.base64EncodeWebSafe(Utilities.computeHmacSha256Signature(value,props_().getProperty('KEY'))).replace(/=+$/,'')}
function roll_(v){v=String(v||'').trim();if(!/^\d{9}$/.test(v))throw Error('Enter your nine-digit college roll number.');return v}
function ref_(v){return /^\d{12}$/.test(String(v||'').trim())?String(v).trim():''}
function must_(ok,message){if(!ok)throw Error(message)}
function locked_(fn){const l=LockService.getScriptLock();l.waitLock(24000);try{return fn()}finally{try{SpreadsheetApp.flush()}finally{l.releaseLock()}}}
function book_(){return SpreadsheetApp.openById(props_().getProperty('BOOK'))}
function onOpen(e){
  SpreadsheetApp.getUi().createMenu('Poker Night').addItem('Set up club desk','setupEvent').addToUi();
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
  if(preset.owner)must_(who===preset.owner,'Run setup from the designated club account.');
  const b=configured?SpreadsheetApp.openById(configured):SpreadsheetApp.create('Poker Night · private club desk');
  p.setProperty('BOOK',b.getId());
  if(!p.getProperty('KEY'))p.setProperty('KEY',rand_()+rand_());
  b.setSpreadsheetTimeZone('Asia/Kolkata');
  const headers={Students:['Roll Number','Name','Mail ID','Number'],Staff:['Label','Role','Private sign-in key','Active'],Journal:['Time','Action','Staff or player','Change JSON'],Settings:['Setting','Value']};
  Object.keys(headers).forEach(n=>{const s=b.getSheetByName(n)||b.insertSheet(n);if(!s.getLastRow()){s.appendRow(headers[n]);s.setFrozenRows(1);}});
  const staff=b.getSheetByName('Staff');
  if(staff.getLastRow()===1)staff.appendRow([who,'admin',rand_()+rand_().slice(0,8),'yes']);
  syncStaffLinks_(staff);
  const settings=b.getSheetByName('Settings');
  if(settings.getLastRow()===1)settings.getRange(2,1,3,2).setValues([['Receiving UPI ID',''],['Recipient name',''],['Registration open','no']]);
  if(!p.getProperty('FOLDER'))p.setProperty('FOLDER',preset.folder||DriveApp.createFolder('Poker Night · private payment screenshots').getId());
  return b.getUrl();
}
function doGet(e){
  const q=e&&e.parameter||{};
  const route=['register','staff','board','pass'].includes(q.view)?q.view:'register';
  if(route==='staff'&&!validStaffInvite_(q.invite)){
    return HtmlService.createHtmlOutput('<main style="font:1rem system-ui;margin:3rem"><h1>Page unavailable</h1><a target="_top" href="https://meherpraveen.github.io/imt-ecell-poker-night/">Return to Poker Night</a></main>')
      .setTitle('Page unavailable').addMetaTag('viewport','width=device-width, initial-scale=1');
  }
  const t=HtmlService.createTemplateFromFile('App');
  t.route=route;
  t.invite=route==='staff'?q.invite:'';
  t.pass=/^[A-Z0-9-]{12,24}$/.test(q.p||'')?q.p:'';
  return t.evaluate().setTitle('Poker Night · E-Cell').addMetaTag('viewport','width=device-width, initial-scale=1');
}
function settings_(){const rows=book_().getSheetByName('Settings').getRange(2,2,3,1).getDisplayValues().flat();return {upi:rows[0],name:rows[1],open:rows[2].toLowerCase()==='yes'}}
function roster_(){
  const s=book_().getSheetByName('Students'),n=s.getLastRow()-1;if(n<1)return {};
  return Object.fromEntries(s.getRange(2,1,n,4).getDisplayValues().filter(r=>/^\d{9}$/.test(r[0].trim())).map(r=>[r[0].trim(),{name:r[1],email:r[2].trim(),phone:r[3].replace(/\D/g,'')}]));
}
function stageName_(n){return n<6?'Round 1 · Wave '+(n+1):n===6?'Round 2 · Semifinals':'Round 3 · Final'}
function fresh_(){return {attempts:{},venue:{},game:{next:0,active:null,history:[]},audit:[]}}
function apply_(state,patch){for(const a of patch.attempts||[])state.attempts[a.id]=a;Object.assign(state.venue,patch.venue||{});if(patch.game)state.game=patch.game}
function ledger_(){
  const s=book_().getSheetByName('Journal'),end=s.getLastRow(),cache=CacheService.getScriptCache(),key='journal-v1:'+end;
  try{const v=cache.get(key);if(v)return JSON.parse(Utilities.ungzip(Utilities.newBlob(Utilities.base64Decode(v),'application/gzip')).getDataAsString())}catch(e){}
  const state=fresh_();
  if(end>1){for(const [time,action,actor,json] of s.getRange(2,1,end-1,4).getValues()){
    const patch=JSON.parse(json);apply_(state,patch);
    state.audit.push({time:Number(time),action,actor,target:patch.note||''});if(state.audit.length>35)state.audit.shift();
  }}
  try{const packed=Utilities.base64Encode(Utilities.gzip(Utilities.newBlob(JSON.stringify(state),'text/plain')).getBytes());if(packed.length<93000)cache.put(key,packed,90)}catch(e){}
  return state;
}
function commit_(st,action,actor,patch){
  const json=JSON.stringify(patch);must_(json.length<49000,'This update is too large. Contact the desk.');
  book_().getSheetByName('Journal').appendRow([Date.now(),action,actor,json]);SpreadsheetApp.flush();apply_(st,patch);
}
function staffList_(){const s=book_().getSheetByName('Staff'),n=s.getLastRow()-1;return n?s.getRange(2,1,n,4).getDisplayValues():[]}
function activeStaff_(row){return row[3].toLowerCase()==='yes'&&ROLE.includes(row[1])&&/^[a-z0-9]{40}$/i.test(row[2])}
function staffInvite_(key){
  const signature=Utilities.computeHmacSha256Signature('poker-night:staff-link:v1',key);
  return Utilities.base64EncodeWebSafe(signature).replace(/=+$/,'');
}
function validStaffInvite_(invite){
  if(typeof invite!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(invite))return false;
  return staffList_().some(row=>activeStaff_(row)&&staffInvite_(row[2])===invite);
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
  if(row[1]==='admin')locked_(()=>syncStaffLinks_(book_().getSheetByName('Staff')));
  const id=hash_(key).slice(0,24),expiry=Date.now()+8*3600000,base=id+'.'+expiry;
  return {token:base+'.'+mac_('session:'+base),role:row[1],label:row[0]};
}
function staff_(token,roles){
  const [id,until,sig]=String(token||'').split('.');
  must_(id&&Number(until)>Date.now()&&sig===mac_('session:'+id+'.'+until),'Sign in to the staff desk again.');
  const r=staffList_().find(x=>x[3].toLowerCase()==='yes'&&hash_(x[2]).slice(0,24)===id);
  must_(r&&(r[1]==='admin'||roles.includes(r[1])),'Your staff role cannot perform that action.');
  return {name:r[0],role:r[1]};
}
function issued_(a){return ['PAID','ELIMINATED','QUALIFIED','WINNER','NO_SHOW'].includes(a.status)}
function occupied_(a,now){return a.status==='HOLD'?a.expires>now:['REVIEW','PAID','ELIMINATED','QUALIFIED','WINNER'].includes(a.status)}
function waveFor_(st,roll,now){
  const past=new Set(Object.values(st.attempts).filter(a=>a.roll===roll&&issued_(a)).map(a=>a.wave));
  const start=st.game.next+(st.game.active?1:0);
  for(let w=start;w<WAVES;w++){if(!past.has(w)&&Object.values(st.attempts).filter(a=>a.wave===w&&occupied_(a,now)).length<CAP)return w}
  return -1;
}
function eligibility_(st,roll,kind,now){
  must_(now<EVENT_END,'The event has closed.');
  if(kind!=='retry')must_(now<NEW_CLOSE,'New registrations closed at 11 PM IST.');
  if(kind==='walk')must_(now>=DESK_OPENS,'Walk-in registration opens at 7 PM IST.');
  if(kind==='pre')must_(now<DESK_OPENS,'Use the walk-in desk from 7 PM IST.');
  const mine=Object.values(st.attempts).filter(a=>a.roll===roll);
  const active=mine.find(a=>['REVIEW','PAID','QUALIFIED','WINNER'].includes(a.status)||(a.status==='HOLD'&&a.expires>now));
  must_(!active,'There is already an active attempt for this roll. Use the original receipt page or ask the desk.');
  if(kind==='retry')must_(mine.some(a=>a.status==='ELIMINATED')&&st.game.next<6,'A retry requires an eliminated player and a later Round 1 wave.');
  else must_(!mine.some(a=>issued_(a)),'This roll has played already. The desk can check retry eligibility.');
}
function newAttempt_(roll,kind,w,now){return {id:rand_().slice(0,16),roll,kind,fee:FEES[kind],wave:w,created:now,expires:now+HOLD,status:w<0?'WAITLIST':'HOLD',used:false,delivery:''}}
function publicInfo(){const x=settings_();ensureStaffLinks_();return {open:x.open&&!!x.upi&&!!x.name&&Date.now()<NEW_CLOSE}}
function playerStart(roll,previous){
  roll=roll_(roll);return locked_(()=>{
    const set=settings_(),st=ledger_(),now=Date.now();
    if(previous){const a=fromReceipt_(st,previous);if(a&&a.roll===roll)return receipt_(a,set);}
    must_(set.open&&set.upi&&set.name,'Registration is currently closed. Please contact E-Cell.');
    must_(roster_()[roll],'Check the roll number on your college ID, or speak to the desk.');
    const kind=now>=DESK_OPENS?'walk':'pre';
    const wait=Object.values(st.attempts).find(a=>a.roll===roll&&a.status==='WAITLIST');
    must_(!wait,'This roll is already on the waitlist. Open your original receipt page or ask the desk.');
    eligibility_(st,roll,kind,now);
    const a=newAttempt_(roll,kind,waveFor_(st,roll,now),now);
    commit_(st,'Seat request','Player',{attempts:[a],note:a.id});return receipt_(a,set);
  });
}
function fromReceipt_(st,t){const [id,sig]=String(t||'').split('.');return st.attempts[id]&&sig===mac_('receipt:'+id)?st.attempts[id]:null}
function receipt_(a,set){const open=a.status==='HOLD'&&Date.now()<a.expires;
  return {ticket:a.id+'.'+mac_('receipt:'+a.id),id:a.id,fee:a.fee,wave:a.wave+1,status:a.status==='HOLD'&&!open?'EXPIRED':a.status,expires:a.expires,upi:open?set.upi:'',name:open?set.name:'',delivery:a.delivery||'',reason:a.reason||''};
}
function playerStatus(token){const st=ledger_(),a=fromReceipt_(st,token);must_(a,'Open the receipt on the device you registered with.');return receipt_(a,settings_())}
function imageBytes_(data){
  must_(typeof data==='string'&&data.length<=2400000,'Choose an image under 1.7 MB after compression.');
  const m=/^data:image\/(png|jpeg);base64,([A-Za-z0-9+/=]+)$/.exec(data);must_(m,'Upload a JPEG or PNG screenshot.');
  const bytes=Utilities.base64Decode(m[2]),head=bytes.slice(0,8).map(b=>b&255);
  must_(bytes.length>=20&&bytes.length<=1800000&&(m[1]==='png'?head.join(',')==='137,80,78,71,13,10,26,10':head[0]===255&&head[1]===216&&head[2]===255),'The image format is invalid.');
  return {bytes,mime:'image/'+m[1],ext:m[1]==='png'?'png':'jpg'};
}
function playerUpload(token,suffix,data){
  suffix=String(suffix||'').trim();must_(!suffix||/^\d{4,12}$/.test(suffix),'Enter the final 4–12 visible bank-reference digits, or leave the field blank.');
  return locked_(()=>{const st=ledger_(),a=fromReceipt_(st,token);must_(a,'Invalid receipt.');
    if(a.status==='REVIEW'||issued_(a))return receipt_(a,settings_());
    must_(a.status==='HOLD'&&Date.now()<a.expires,'Your seat hold ended. If you already paid, show the receipt to the desk before paying again.');
    const im=imageBytes_(data),digest=Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,im.bytes));
    const file=DriveApp.getFolderById(props_().getProperty('FOLDER')).createFile(Utilities.newBlob(im.bytes,im.mime,a.id+'.'+im.ext));
    const updated={...a,status:'REVIEW',file:file.getId(),digest,suffix,submitted:Date.now()};
    try{commit_(st,'Proof submitted','Player',{attempts:[updated],note:a.id})}catch(err){if(ledger_().attempts[a.id]?.file!==file.getId())file.setTrashed(true);throw err}
    return receipt_(updated,settings_());
  });
}
function pass_(id){return 'PN-'+mac_('gate:'+id).slice(0,16).toUpperCase().replace(/_/g,'X').replace(/-/g,'Y')}
function normalizeCode_(s){return String(s||'').trim().toUpperCase().replace(/[\s-]/g,'')}
function byCode_(st,s){const v=normalizeCode_(s);must_(v.length===18,'Check the full entry code.');return Object.values(st.attempts).find(a=>issued_(a)&&normalizeCode_(pass_(a.id))===v)}
function passInfo(code){const a=byCode_(ledger_(),code);must_(a,'This pass could not be verified.');return {used:!!a.used,active:a.status==='PAID',wave:a.wave+1,code:pass_(a.id)}}
function proofImage(token,id){staff_(token,['desk']);const a=ledger_().attempts[id];must_(a&&a.file,'No screenshot was uploaded for this attempt.');const b=DriveApp.getFileById(a.file).getBlob();return 'data:'+b.getContentType()+';base64,'+Utilities.base64Encode(b.getBytes())}
function mailCode_(st,a,person,actor){
  let delivery='Desk delivery needed';
  if(person&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(person.email)&&MailApp.getRemainingDailyQuota()>0){
    try{const code=pass_(a.id),url=ScriptApp.getService().getUrl();
      MailApp.sendEmail(person.email,'E-Cell Poker Night · '+(a.kind==='retry'?'retry':'entry')+' pass',
        'Your ₹'+a.fee+' payment is verified. Round 1 wave '+(a.wave+1)+'.\n\nYour single-use code is '+code+'\n'+(url?url+'?view=pass&p='+code+'\n':'')+'\nBring your college ID. Show this pass only to event staff.',{name:'IMT E-Cell Poker Night'});
      delivery='Email sent';
    }catch(e){delivery='Desk delivery needed'}
  }
  const changed={...a,delivery};commit_(st,'Pass delivery',actor,{attempts:[changed],note:a.id});return changed;
}
function staffApprove(token,id,fullRef,confirmed){
  const staff=staff_(token,['desk']);fullRef=ref_(fullRef);must_(confirmed===true&&fullRef,'Confirm the receiving-account credit and enter its full 12-digit UPI reference.');
  return locked_(()=>{const st=ledger_(),a=st.attempts[id];must_(a,'Attempt missing.');
    if(issued_(a)&&a.utr===fullRef)return {status:a.delivery||'Issued'};
    must_(a.status==='REVIEW','This attempt is not awaiting review.');
    must_(!a.suffix||fullRef.endsWith(a.suffix),'The visible receipt digits do not match this bank reference. Check the credit and proof again.');
    must_(!Object.values(st.attempts).some(v=>v.id!==id&&v.utr===fullRef),'This bank reference has already paid for another attempt.');
    must_(a.wave>=st.game.next+(st.game.active?1:0),'The selected wave has started. Move this payment to an available wave at the desk.');
    const paid={...a,status:'PAID',utr:fullRef,verified:Date.now(),delivery:'Pending delivery'};
    commit_(st,'Payment approved',staff.name,{attempts:[paid],note:id});const row=mailCode_(st,paid,roster_()[paid.roll],staff.name);return {status:row.delivery};
  });
}
function staffReject(token,id,why){const s=staff_(token,['desk']);why=String(why||'').trim().slice(0,180);must_(why,'Add a short reason for the player.');return locked_(()=>{const st=ledger_(),a=st.attempts[id];must_(a&&a.status==='REVIEW','Only pending proofs can be rejected.');commit_(st,'Proof rejected',s.name,{attempts:[{...a,status:'REJECTED',reason:why}],note:id});return true})}
function deskPayment(token,roll,kind,full,confirmed){
  const s=staff_(token,['desk']);roll=roll_(roll);full=ref_(full);must_(['walk','retry'].includes(kind)&&full&&confirmed===true,'Check college ID and receiving-account credit, then enter the full UPI reference.');
  return locked_(()=>{const st=ledger_(),people=roster_(),now=Date.now();must_(people[roll],'This roll is missing from the private directory.');
    const used=Object.values(st.attempts).find(a=>a.utr===full);
    if(used&&used.roll===roll&&used.kind===kind)return {status:used.delivery,id:used.id};
    must_(!used,'This reference has already been used.');
    const held=Object.values(st.attempts).find(a=>a.roll===roll&&a.kind===kind&&a.status==='HOLD'&&a.expires>now);
    if(kind==='walk')must_(now>=DESK_OPENS&&now<NEW_CLOSE,'Walk-in purchases run from 7 to 11 PM IST.');
    if(!held)eligibility_(st,roll,kind,now);
    else must_(held.wave>=st.game.next+(st.game.active?1:0),'The held wave has already started.');
    const wave=held?held.wave:waveFor_(st,roll,now);must_(wave>=0,'No later Round 1 seat is available. Do not collect a payment.');
    const a={...(held||newAttempt_(roll,kind,wave,now)),status:'PAID',utr:full,verified:now,delivery:'Pending delivery'};
    const oldWait=Object.values(st.attempts).filter(v=>v.roll===roll&&v.status==='WAITLIST').map(v=>({...v,status:'RELEASED'}));
    commit_(st,'Desk payment verified',s.name,{attempts:[...oldWait,a],note:a.id});const out=mailCode_(st,a,people[roll],s.name);return {status:out.delivery,id:a.id};
  });
}
function staffPass(token,id,send){const s=staff_(token,['desk']);return locked_(()=>{const st=ledger_(),a=st.attempts[id];must_(a&&issued_(a),'Approve the payment first.');const p=roster_()[a.roll]||{};
  const current=send?mailCode_(st,a,p,s.name):a;return {code:pass_(id),phone:p.phone||'',name:p.name||'',wave:a.wave+1,delivery:current.delivery};})}
function gateAction(token,action,value,op){
  const s=staff_(token,['gate','desk']);must_(['admit','exit','return'].includes(action)&&/^[a-zA-Z0-9-]{8,64}$/.test(op),'Invalid gate action.');
  return locked_(()=>{const st=ledger_();const a=action==='admit'?byCode_(st,value):null;if(action==='admit')must_(a,'Code not recognised.');
    const roll=a?a.roll:roll_(value),prior=st.venue[roll]||{where:'NEVER',ops:[]};
    if(prior.ops.includes(op))return 'Already recorded';
    if(a)must_(a.status==='PAID'&&!a.used,'This entry code is spent or the attempt is closed.');
    if(action==='exit')must_(prior.where==='IN','This player is not recorded inside.');
    if(action==='return')must_(prior.where==='OUT','A venue return requires an earlier checked-in exit.');
    const where=action==='exit'?'OUT':'IN',v={where,ops:[...prior.ops.slice(-23),op]};
    commit_(st,'Gate '+action,s.name,{attempts:a?[{...a,used:true}]:[],venue:{[roll]:v},note:roll});return where==='IN'?'Recorded inside':'Recorded outside';
  });
}
function releaseSeat(token,id,mode){
  const s=staff_(token,['desk','floor']);return locked_(()=>{const st=ledger_(),a=st.attempts[id];must_(a,'Attempt missing.');
    if(mode==='no-show'){must_(a.status==='PAID'&&!a.used,'Only an unused paid pass can be marked no-show.');commit_(st,'No-show',s.name,{attempts:[{...a,status:'NO_SHOW'}],note:id})}
    else if(mode==='move'){must_(['REVIEW','WAITLIST'].includes(a.status),'Only a pending or waitlisted attempt can move.');const w=waveFor_(st,a.roll,Date.now());must_(w>=0,'No wave has space.');const moved={...a,wave:w};if(a.status==='WAITLIST'){moved.status='HOLD';moved.expires=Date.now()+HOLD}commit_(st,'Seat offered',s.name,{attempts:[moved],note:id})}
    else throw Error('Unknown seat action.');return true;
  });
}
