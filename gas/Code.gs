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
function parseObject_(text,message){
  let value;
  try{value=JSON.parse(text)}catch{must_(false,message)}
  must_(value!==null&&typeof value==='object'&&!Array.isArray(value),message);
  return value;
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
    const request=parseObject_(body,'Invalid event request.');
    const methods=new Map([
      ['publicPrices',[publicPrices,0]],['publicInfo',[publicInfo,0]],['liveFloor',[liveFloor,0]],
      ['requestEventCode',[requestEventCode,1]],['signInEvent',[signInEvent,3,4]],
      ['requestPlayerCode',[requestPlayerCode,1]],['verifyPlayerCode',[verifyPlayerCode,2]],['playerLogout',[playerLogout,1]],
      ['requestMatchedPlayerCode',[requestMatchedPlayerCode,2]],['signInPlayer',[signInPlayer,3]],['passInfo',[passInfo,1]],
      ['playerHome',[playerHome,2]],['playerStart',[playerStart,3,4]],['playerStatus',[playerStatus,2]],
      ['playerSelectReceiver',[playerSelectReceiver,3,4]],['playerSaveDetails',[playerSaveDetails,3]],['playerCheckout',[playerCheckout,2]],['playerUpload',[playerUpload,4]],['playerSubmitScreenshot',[playerSubmitScreenshot,4]],['playerReadProof',[playerReadProof,3]],['playerSubmitPayment',[playerSubmitPayment,4]],['playerIdentifyReceiver',[playerIdentifyReceiver,3]],
      ['scanEntryTicket',[scanEntryTicket,3]]
    ]);
    const method=methods.get(request.action);
    must_(method&&Array.isArray(request.args)&&request.args.every(arg=>typeof arg==='string'),'Invalid event request.');
    must_(body.length<=2410000||['playerReadProof','playerSubmitPayment','playerSubmitScreenshot'].includes(request.action),'This request is too large.');
    const [handle,minArgs,maxArgs=minArgs]=method;
    must_(request.args.length>=minArgs&&request.args.length<=maxArgs,'Refresh the event page and sign in to continue.');
    result={ok:true,value:handle(...request.args)};
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
