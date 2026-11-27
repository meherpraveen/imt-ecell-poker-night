const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),crypto=require('node:crypto');
const {readServerSource}=require('../tools/server-source.cjs');
const {sheet:fixtureSheet}=require('./sheet-fixture.cjs');
const source=['Code','Floor','Auth'].map(readServerSource).join('\n');
function fixture(){
  let time=Date.parse('2026-11-25T12:00:00+05:30');class Clock extends Date{static now(){return time}}
  const sent=[],loginMail=[],people={'123456789':{name:'Sample Player',email:'sample@example.test',phone:'9999999999'},'987654321':{name:'Second Player',email:'second@example.test',phone:''}};
  const properties=new Map([['KEY','fixture-only'],['FOLDER','folder'],['PASS_EMAIL_DELIVERY','enabled']]);
  const ctx={Date:Clock,console,ticketQrEncoder_:require('qrcode-generator'),CLUB_RESOURCES:{owner:'owner@example.test',studentSignIn:'email',ownerSignIn:'email'},Utilities:{getUuid:crypto.randomUUID,base64Decode:s=>Array.from(Buffer.from(s,'base64')),newBlob:(bytes,type,name)=>({bytes,type,name}),computeHmacSha256Signature:(message,key)=>[...crypto.createHmac('sha256',key).update(message).digest()]},
    MailApp:{getRemainingDailyQuota:()=>100,sendEmail:(...m)=>(m[1].includes('sign-in')?loginMail:sent).push(m)},ScriptApp:{getService:()=>({getUrl:()=>''})}};
  vm.createContext(ctx);vm.runInContext(source,ctx);const st=ctx.fresh_(),audit=[];
  ctx.ledger_=()=>st;ctx.locked_=fn=>fn();ctx.commit_=(s,kind,actor,p)=>{audit.push([kind,actor,p]);ctx.apply_(s,JSON.parse(JSON.stringify(p)))};
  const readSettings=ctx.settings_;
  ctx.book_=()=>({getSheetByName:()=>fixtureSheet([['Roll','Name','Email','Phone'],
    ...Object.entries(people).map(([roll,p])=>[roll,p.name||'',p.email||'',p.phone||''])])});
  ctx.roster_=()=>people;ctx.settings_=()=>({upi:'club@example',name:'Example Club',open:true,published:true,qrFile:''});
  ctx.mac_=x=>crypto.createHmac('sha256','synthetic-only').update(x).digest('base64url');
  ctx.hash_=x=>crypto.createHash('sha256').update(x).digest('base64url');
  ctx.props_=()=>({getProperty:k=>properties.get(k)||null,getProperties:()=>Object.fromEntries(properties),setProperties:values=>Object.entries(values).forEach(([k,v])=>properties.set(k,v)),setProperty:(k,v)=>properties.set(k,v),deleteProperty:k=>properties.delete(k)});
  const actualStaff=ctx.staff_;ctx.staff_=(token,roles)=>{if(token!=='admin'&&!roles.includes(token))throw Error('Role denied');return {name:'Test staff',role:token}};
  const sessions=new Map();
  const sessionFor=(roll='123456789')=>{
    if(!sessions.has(roll)){ctx.requestPlayerCode(roll);sessions.set(roll,ctx.verifyPlayerCode(roll,mailDigits(loginMail)).token)}
    return sessions.get(roll);
  };
  return {ctx,st,sent,loginMail,properties,audit,people,actualStaff,readSettings,sessionFor,at:s=>time=Date.parse(s)};
}
function mailDigits(messages){return messages.at(-1)[2].match(/\b\d{6}\b/)[0]}
function details(f,roll){return JSON.stringify({fullName:f.people[roll]?.name||'Test Player',pgpId:roll,contact:f.people[roll]?.phone||'9876501234',batch:'2026-28'})}
function hold(f,roll='123456789'){return f.ctx.playerStart(f.sessionFor(roll),'',crypto.randomUUID(),details(f,roll))}
function sessionForReceipt(f,ticket){return f.sessionFor(f.st.attempts[ticket.split('.')[0]].roll)}
function status(f,ticket){return f.ctx.playerStatus(sessionForReceipt(f,ticket),ticket)}
function checkout(f,ticket){return f.ctx.playerCheckout(sessionForReceipt(f,ticket),ticket)}
test('upgrading an unused club desk opens signups once and respects later admin pauses',()=>{
  const {ctx,readSettings}=fixture(),rows=[['Setting','Value'],['Receiving UPI ID',''],['Recipient name',''],['Registration open','no']];
  const sheet={getRange(row,col,h,w){return {
    getDisplayValues:()=>Array.from({length:h},(_,i)=>Array.from({length:w},(_,j)=>rows[row+i-1]?.[col+j-1]||'')),
    setValues:values=>values.forEach((cells,i)=>{rows[row+i-1]=Array.from(cells)})
  }}};
  ctx.book_=()=>({getSheetByName:()=>sheet});ctx.settings_=readSettings;ctx.ensureStaffLinks_=()=>{};
  assert.equal(ctx.publicInfo().open,true);assert.equal(rows[3][1],'yes');assert.equal(rows[5][1],'no');
  rows[3][1]='no';assert.equal(ctx.publicInfo().open,false);assert.equal(rows[3][1],'no');
  rows.splice(4);rows[1][1]='old@example';rows[2][1]='Existing Club';
  assert.equal(ctx.publicInfo().open,false);assert.equal(rows[1][1],'old@example');
});
test('registration opens on 23 November even before payments and the walk-in desk opens at 7 PM on the 27th',()=>{
  const f=fixture(),settings={upi:'',name:'',open:true,qrFile:'',published:false};
  f.ctx.settings_=()=>settings;f.ctx.ensureStaffLinks_=()=>{};
  f.at('2026-11-22T23:59:59+05:30');
  assert.equal(f.ctx.publicInfo().open,false);assert.throws(()=>hold(f));
  f.at('2026-11-23T00:00:00+05:30');
  assert.equal(f.ctx.publicInfo().open,true);assert.equal(f.ctx.publicInfo().paymentsReady,false);
  assert.throws(()=>f.ctx.playerStart('123456789',''),/Sign in/);
  const pre=hold(f);assert.equal(pre.status,'REGISTERED');assert.equal(pre.fee,149);
  assert.throws(()=>f.ctx.playerStatus(pre.ticket),/Sign in/);
  assert.equal(pre.wave,0);assert.equal(pre.expires,0);assert.equal(pre.paymentQr,'');
  assert.equal(f.ctx.occupied_(f.st.attempts[pre.id],0),false);assert.equal(hold(f).id,pre.id);
  assert.equal(checkout(f,pre.ticket).status,'REGISTERED');assert.throws(()=>f.ctx.playerCheckout(''));
  f.at('2026-11-27T19:00:00+05:30');
  const walk=hold(f,'987654321');assert.equal(walk.fee,199);
  Object.assign(settings,{name:'Example Club',upi:'club@example',published:true});
  assert.equal(status(f,pre.ticket).status,'HOLD');
  const seat=checkout(f,pre.ticket);assert.equal(seat.status,'HOLD');assert.equal(seat.fee,199);assert.equal(seat.wave,0);
  assert.equal(checkout(f,pre.ticket).expires,seat.expires);
  settings.open=false;assert.equal(f.ctx.publicInfo().open,false);
  f.at('2026-11-27T23:00:00+05:30');settings.open=true;
  assert.equal(f.ctx.publicInfo().open,false);assert.equal(status(f,walk.ticket).checkoutEnded,false);
  assert.equal(checkout(f,walk.ticket).upi,'club@example');
  f.at('2026-11-28T04:00:00+05:30');assert.equal(status(f,walk.ticket).checkoutEnded,true);assert.equal(checkout(f,walk.ticket).upi,'');
});
test('an unpaid registration goes to the waitlist when all 216 qualifier places have proof',()=>{
  const f=fixture(),s={upi:'',name:'',open:true,published:false,qrFile:''};
  f.ctx.settings_=()=>s;const saved=hold(f);
  Object.assign(s,{upi:'club@example',name:'Club',published:true});
  for(let i=0;i<216;i++){const roll=String(400000000+i);f.people[roll]={email:roll+'@example.test'};pending(f,roll)}
  const r=checkout(f,saved.ticket);assert.equal(r.status,'WAITLIST');assert.equal(r.upi,'');assert.equal(r.paymentQr,'');
  assert.equal(checkout(f,saved.ticket).id,saved.id);
});
test('an on-site verification reuses a saved pre-registration and checks the quoted fee',()=>{
  const f=fixture();f.ctx.settings_=()=>({open:true,published:false,upi:'',name:'',qrFile:''});const saved=hold(f);
  f.at('2026-11-27T19:05:00+05:30');
  assert.throws(()=>f.ctx.deskPayment('desk','123456789','walk','012345678901',true,149));
  const pay=()=>f.ctx.deskPayment('desk','123456789','walk','012345678901',true,199);
  assert.equal(pay().id,saved.id);assert.equal(pay().id,saved.id);assert.equal(f.sent.length,1);
  assert.equal(status(f,saved.ticket).status,'PAID');assert.equal(f.st.attempts[saved.id].fee,199);
});
test('only admins can upload, publish, replace or remove the private payment QR',()=>{
  const f=fixture(),c=f.ctx,files=new Map();
  let s={upi:'',name:'',open:true,qrFile:'',published:false},writes=0;
  c.settings_=()=>s;c.writeSettings_=value=>{s={...value};writes++};
  c.SpreadsheetApp={flush(){}};
  const bytes=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),Buffer.alloc(24)]);
  const png='data:image/png;base64,'+bytes.toString('base64');
  c.Utilities.base64Decode=str=>Array.from(Buffer.from(str,'base64'));
  c.Utilities.base64Encode=arr=>Buffer.from(arr).toString('base64');
  c.Utilities.newBlob=(arr,mime,name)=>({getBytes:()=>arr,getContentType:()=>mime,getName:()=>name,getAs:()=>({getBytes:()=>arr})});
  c.readReceiverQr_=()=>'upi://pay?pa=club@example';
  c.CacheService={getScriptCache:()=>({get:()=>null,put:()=>{}})};
  c.DriveApp={getFileById:id=>files.get(id),getFolderById:()=>({createFile(blob){
    const id='asset'+(files.size+1);
    const file={getId:()=>id,getName:blob.getName,getBlob:()=>blob,setTrashed(flag){this.trashed=flag},
      getParents:()=>({hasNext:()=>true,next:()=>({getId:()=> 'folder'})})};files.set(id,file);return file;
  }})};
  const save=(role,overrides={},upi='')=>c.adminSettings(role,upi,'Example Club',true,
    {version:c.adminSettingsView_(s).version,published:true,...overrides});
  for(const role of ['desk','gate','floor']){assert.throws(()=>save(role,{qr:png}));assert.throws(()=>c.adminPaymentQr(role))}
  assert.throws(()=>save('admin'));assert.throws(()=>save('admin',{qr:'not a receipt'}));
  assert.equal(writes,0);assert.equal(files.size,0);
  const saved=hold(f);save('admin',{qr:png,published:false});assert.equal(c.adminPaymentQr('admin'),png);
  assert.equal(status(f,saved.ticket).paymentQr,'');assert.equal(status(f,saved.ticket).canCheckout,false);
  assert.throws(()=>save('admin',{version:'outdated',qr:png}));assert.equal(files.size,1);
  save('admin');const active=checkout(f,saved.ticket);
  assert.match(active.paymentQr,/^data:image\/gif;base64,/);assert.equal(active.upi,'');assert.equal(active.name,'Example Club');
  assert.ok(!JSON.stringify(active).includes('asset1'));assert.equal(c.adminSettingsView_(s).hasQr,true);
  save('admin',{qr:png},'club@example');assert.ok(files.get('asset1').trashed);assert.equal(status(f,saved.ticket).upi,'club@example');
  save('admin',{removeQr:true},'club@example');assert.ok(files.get('asset2').trashed);assert.equal(status(f,saved.ticket).paymentQr,'');
  save('admin',{published:false},'club@example');assert.equal(status(f,saved.ticket).upi,'');
});
test('the Pages transport returns public results, validates input, and excludes staff operations',()=>{
  const {ctx,st,sessionFor}=fixture();
  ctx.ContentService={MimeType:{JSON:'json'},createTextOutput:text=>({setMimeType:()=>JSON.parse(text)})};
  ctx.ensureStaffLinks_=()=>{};
  ctx.hash_=value=>crypto.createHash('sha256').update(value).digest('hex');
  const post=(action,args)=>ctx.doPost({postData:{contents:JSON.stringify({action,args})}});
  const malformed=ctx.doPost({postData:{contents:'{'}});
  assert.equal(malformed.validation,true);assert.equal(malformed.retryable,false);
  assert.equal(post('publicInfo',[]).value.open,true);
  assert.equal(post('liveFloor',[]).value.state,'Awaiting first seating');
  assert.equal(post('staffSnapshot',['admin']).ok,false);
  assert.equal(post('adminPaymentQr',['admin']).ok,false);
  assert.equal(post('completeDeskSignIn',['invite','ticket']).error,'Invalid event request.');
  assert.equal(post('playerStart',[]).ok,false);
  const session=sessionFor(),request=crypto.randomUUID(),args=[session,'',request,details({people:{}},'123456789')];
  const first=post('playerStart',args);
  assert.equal(post('playerSaveDetails',[session,first.value.ticket,'null']).validation,true);
  assert.ok(first.ok);assert.equal(post('playerStart',args).value.ticket,first.value.ticket);
  assert.equal(post('playerStatus',[session,first.value.ticket]).value.id,first.value.id);
  assert.equal(Object.keys(st.attempts).length,1);
  assert.ok(!JSON.stringify(st.attempts).includes(request));
  assert.equal(post('playerStart',['123456789','',crypto.randomUUID()]).ok,false);
  assert.equal(post('playerStart',['wrong','','']).validation,true);
  ctx.publicInfo=()=>{throw Error('private provider detail')};
  const fail=post('publicInfo',[]);assert.ok(!fail.ok&&!fail.validation&&!fail.error.includes('private provider detail'));
});
function pending(f,roll='123456789',tail='6789'){
  const r=hold(f,roll),a=f.st.attempts[r.id],allocation=f.ctx.pendingAllocation_(f.st,a,f.ctx.Date.now());
  Object.assign(a,{status:'REVIEW',...allocation,suffix:tail});return r;
}
test('roll and email resolve to one directory mailbox; unknown or shared addresses receive no code',()=>{
  const {ctx,loginMail,people,properties}=fixture();
  const reply=ctx.requestPlayerCode('123456789');
  assert.equal(loginMail[0][0],'sample@example.test');
  assert.deepEqual(ctx.requestPlayerCode('unlisted@example.test'),reply);
  assert.deepEqual(ctx.requestPlayerCode('222222222'),reply);
  ctx.requestPlayerCode(' SAMPLE@example.test ');assert.equal(loginMail.length,1);
  const code=mailDigits(loginMail);
  assert.throws(()=>ctx.verifyPlayerCode('second@example.test',code));
  const session=ctx.verifyPlayerCode('SAMPLE@example.test',code);
  assert.equal(ctx.playerRoll_(session.token),'123456789');
  assert.throws(()=>ctx.verifyPlayerCode('123456789',code));
  assert.ok(![...properties.values()].some(value=>value.includes('sample@example.test')||value.includes(session.token)));
  people['987654321'].email='sample@example.test';
  ctx.requestPlayerCode('987654321');ctx.requestPlayerCode('sample@example.test');assert.equal(loginMail.length,1);
});
test('wrong codes have five attempts and codes expire after ten minutes',()=>{
  const {ctx,loginMail,at}=fixture(),roll='123456789';
  ctx.requestPlayerCode(roll);
  const old=mailDigits(loginMail),wrong=old==='000000'?'111111':'000000';
  for(let i=0;i<5;i++)assert.throws(()=>ctx.verifyPlayerCode(roll,wrong),/incorrect or has expired/);
  assert.throws(()=>ctx.verifyPlayerCode(roll,old));
  at('2026-11-25T12:02:00+05:30');assert.throws(()=>ctx.requestPlayerCode(roll),/Too many incorrect/);assert.equal(loginMail.length,1);
  at('2026-11-25T12:11:00+05:30');ctx.requestPlayerCode(roll);
  const next=mailDigits(loginMail);
  at('2026-11-25T12:21:00+05:30');assert.throws(()=>ctx.verifyPlayerCode(roll,next));
});
test('a student can receive 20 sign-in emails per 24-hour window across all student sign-in routes',()=>{
  const {ctx,loginMail,at}=fixture(),roll='123456789',email='sample@example.test';
  const start=ctx.Date.now();
  for(let minute=0;minute<20;minute++){
    at(new Date(start+minute*60000).toISOString());
    if(minute<5)ctx.requestPlayerCode(roll);
    else if(minute===5)ctx.requestMatchedPlayerCode(roll,email);
    else ctx.requestEventCode(email);
    assert.equal(loginMail.length,minute+1);
    if(minute===4)ctx.playerLogout(ctx.verifyPlayerCode(roll,mailDigits(loginMail)).token);
  }
  at(new Date(start+20*60000).toISOString());
  assert.throws(()=>ctx.requestMatchedPlayerCode(roll,email),/sign-in email limit/);
  assert.equal(loginMail.length,20);
  const signed=ctx.signInEvent(roll,mailDigits(loginMail),'');
  assert.equal(ctx.playerRoll_(signed.session.token),roll);
  at('2026-11-26T11:59:59+05:30');
  assert.throws(()=>ctx.requestEventCode(email),/try again in about 1 minute/);
  at('2026-11-26T12:00:00+05:30');
  ctx.requestEventCode(email);assert.equal(loginMail.length,21);
});
test('failed mail can be retried, and the last available email is reserved for the owner',()=>{
  const {ctx,loginMail}=fixture(),deliver=ctx.MailApp.sendEmail;
  ctx.MailApp.sendEmail=()=>{throw Error('provider detail')};
  assert.throws(()=>ctx.requestPlayerCode('123456789'),/delivery is temporarily unavailable/);
  ctx.MailApp.sendEmail=deliver;ctx.requestPlayerCode('123456789');assert.equal(loginMail.length,1);
  ctx.MailApp.getRemainingDailyQuota=()=>1;
  for(const id of ['222222222','987654321'])assert.throws(()=>ctx.requestPlayerCode(id),/daily limit/);
});
test('a concurrent request shares the pending send and a delayed resend cannot revive a consumed code',()=>{
  const f=fixture(),{ctx,loginMail}=f,original=ctx.MailApp.sendEmail,roll='123456789',email='sample@example.test';
  ctx.MailApp.sendEmail=(...args)=>{
    assert.equal(ctx.requestMatchedPlayerCode(roll,email).delivery,'pending');original(...args);
  };
  assert.equal(ctx.requestMatchedPlayerCode(roll,email).delivery,'accepted');
  assert.equal(loginMail.length,1);const first=mailDigits(loginMail);
  f.at('2026-11-25T12:02:00+05:30');let verified;
  ctx.MailApp.sendEmail=(...args)=>{verified=ctx.verifyPlayerCode(roll,first);original(...args)};
  ctx.requestMatchedPlayerCode(roll,email);assert.ok(verified.token);assert.equal(mailDigits(loginMail),first);
  assert.throws(()=>ctx.verifyPlayerCode(roll,first));assert.throws(()=>ctx.requestPlayerCode(roll),/recently used/);
});
test('a failed resend leaves the original code usable, including when checkout is temporarily offline',()=>{
  const {ctx,loginMail,at}=fixture();ctx.requestPlayerCode('123456789');const code=mailDigits(loginMail);
  at('2026-11-25T12:02:00+05:30');ctx.MailApp.sendEmail=()=>{throw Error('Temporary failure')};
  assert.throws(()=>ctx.requestPlayerCode('123456789'),/temporarily unavailable/);
  ctx.ledger_=()=>{throw Error('Temporarily unavailable')};
  const signed=ctx.signInPlayer('123456789',code,'');assert.equal(signed.account,null);
  assert.equal(ctx.playerRoll_(signed.session.token),'123456789');
});
test('receipts and approved gate codes require the matching verified player across devices',()=>{
  const f=fixture(),{ctx}=f,attempt=pay(f),a=f.sessionFor(),b=f.sessionFor('987654321');
  const ticket=attempt.id+'.'+ctx.mac_('receipt:'+attempt.id);
  assert.equal(ctx.playerHome(a,'').receipt.ticket,ticket);
  assert.equal(ctx.playerHome(a,'').receipt.entryCode,ctx.pass_(attempt.id));
  assert.equal(ctx.playerHome(b,ticket).receipt,null);
  for(const token of [b,ticket,'123456789','']){
    assert.throws(()=>ctx.playerStatus(token,ticket));
    assert.throws(()=>ctx.playerCheckout(token,ticket));
    assert.throws(()=>ctx.playerUpload(token,ticket,'6789',''));
  }
  assert.throws(()=>ctx.playerStart('123456789',ticket,crypto.randomUUID()));
  ctx.gateAction('gate','admit',ctx.pass_(attempt.id),'fixture-logged-in');
  assert.equal(ctx.playerStatus(a,ticket).entryCode,'');
  ctx.playerLogout(a);assert.throws(()=>ctx.playerHome(a,''),/Sign in/);
  f.people['987654321'].email='updated@example.test';assert.throws(()=>ctx.playerHome(b,''),/Sign in/);
});
test('a student can remain signed in without activity for 30 days',()=>{
  const f=fixture(),session=f.sessionFor();f.at('2026-12-24T12:00:00+05:30');
  assert.equal(f.ctx.playerHome(session,'').player.roll,'123456789');f.at('2026-12-25T12:00:00+05:30');
  assert.throws(()=>f.ctx.playerHome(session,''),/Sign in/);
});
test('a lost verification response resumes only the same verified request and never restores a signed-out session',()=>{
  const f=fixture(),{ctx}=f,request=crypto.randomUUID();ctx.requestEventCode('123456789');
  const code=mailDigits(f.loginMail),first=ctx.signInEvent('123456789',code,'',request);
  assert.equal(ctx.signInEvent('123456789',code,'',request).session.token,first.session.token);
  assert.throws(()=>ctx.signInEvent('123456789',code,'',crypto.randomUUID()),/incorrect/);
  ctx.playerLogout(first.session.token);assert.throws(()=>ctx.signInEvent('123456789',code,'',request),/incorrect/);
});
test('an existing valid seven-day session is upgraded once while expired and revoked sessions stay closed',()=>{
  const f=fixture(),token=f.sessionFor(),key='AUTH_SESSION_'+f.ctx.hash_(token);
  const old=JSON.parse(f.properties.get(key));delete old.remembered;old.expires=f.ctx.Date.now()+1000;
  f.properties.set(key,JSON.stringify(old));const resumed=f.ctx.playerHome(token,'');
  assert.equal(resumed.sessionExpires,f.ctx.Date.now()+30*86400000);
  f.at('2026-12-03T12:00:00+05:30');assert.equal(f.ctx.playerHome(token,'').sessionExpires,resumed.sessionExpires);
  f.properties.set(key,JSON.stringify(old));assert.throws(()=>f.ctx.playerHome(token,''),/Sign in/);
  assert.equal(f.properties.has(key),false);
});
test('only the designated inbox can open admin settings; its private key alone is insufficient',()=>{
  const f=staffFixture(),{ctx,rows,loginMail}=f;
  const admin=['owner@example.test','admin','c'.repeat(40),'yes'];
  const other=['other@example.test','admin','d'.repeat(40),'yes'];
  rows.push(admin,other);
  const invite=ctx.staffInvite_(admin[2]),otherInvite=ctx.staffInvite_(other[2]);
  assert.equal(ctx.doGet({parameter:{view:'staff',invite}}).ownerLogin,true);
  assert.equal(ctx.doGet({parameter:{view:'staff',invite:otherInvite}}).title,'Page unavailable');
  assert.throws(()=>ctx.staffLogin(admin[2],invite));assert.throws(()=>ctx.requestOwnerCode(otherInvite));
  assert.throws(()=>ctx.requestOwnerCode(ctx.staffInvite_(rows[0][2])));
  ctx.requestPlayerCode('owner@example.test');assert.equal(loginMail.length,0);
  const volunteer=ctx.staffLogin(rows[0][2],ctx.staffInvite_(rows[0][2])).token;
  assert.throws(()=>ctx.staff_(volunteer,[]));assert.throws(()=>ctx.staff_(f.sessionFor(),[]));
  ctx.MailApp.getRemainingDailyQuota=()=>1;
  ctx.requestOwnerCode(invite);assert.equal(loginMail.at(-1)[0],admin[0]);
  const code=mailDigits(loginMail);
  assert.throws(()=>ctx.verifyOwnerCode(otherInvite,code));
  const signed=ctx.verifyOwnerCode(invite,code);
  assert.equal(ctx.staff_(signed.token,[]).role,'admin');assert.throws(()=>ctx.verifyOwnerCode(invite,code));
  assert.throws(()=>ctx.adminAddStaff(signed.token,'Other volunteer','admin'),/desk, gate or floor/);
  assert.throws(()=>ctx.playerHome(signed.token,''));
  admin[0]='different@example.test';assert.throws(()=>ctx.staff_(signed.token,[]));
  admin[0]='owner@example.test';ctx.staffLogout(signed.token);assert.throws(()=>ctx.staff_(signed.token,[]));
});
test('event sign-in issues one private desk transfer only after the configured owner verifies',()=>{
  const {ctx,rows,loginMail}=staffFixture(),owner=ctx.CLUB_RESOURCES.owner;
  const admin=[owner,'admin','c'.repeat(40),'yes'];rows.push(admin);
  const invite=ctx.staffInvite_(admin[2]);
  ctx.CLUB_RESOURCES.webAppUrl='https://script.google.com/macros/s/test-event/exec';
  const unknown=ctx.requestEventCode('unlisted@example.test');
  ctx.requestEventCode('123456789');
  assert.throws(()=>ctx.signInEvent(owner,mailDigits(loginMail),''),/incorrect/);
  const reply=ctx.requestEventCode('  '+owner.toUpperCase()+' ');
  assert.deepEqual(reply,unknown);
  const [recipient,subject,body,options]=loginMail.at(-1);
  assert.equal(recipient,owner);assert.equal(subject,'Poké Poker Night 2026 admin sign-in code');
  assert.match(body,/event sign-in page/);assert.doesNotMatch(body,/https?:\/\//);assert.equal(options.htmlBody,undefined);
  const code=mailDigits(loginMail);
  assert.throws(()=>ctx.verifyOwnerCode(invite,code),/incorrect/);
  assert.throws(()=>ctx.signInPlayer(owner,code,''),/incorrect/);
  const signed=ctx.signInEvent(owner,code,'');
  assert.deepEqual(Object.keys(signed),['continueUrl']);
  const link=new URL(signed.continueUrl),ticket=new URLSearchParams(link.hash.slice(1)).get('ticket');
  assert.equal(link.searchParams.get('invite'),invite);assert.equal(link.searchParams.get('entry'),'verified');
  assert.throws(()=>ctx.signInEvent(owner,code,''),/incorrect/);
  assert.throws(()=>ctx.staff_(ticket,[]));assert.throws(()=>ctx.playerHome(ticket,''));
  assert.throws(()=>ctx.completeDeskSignIn(ctx.staffInvite_(rows[0][2]),ticket));
  const session=ctx.completeDeskSignIn(invite,ticket);
  assert.equal(ctx.staff_(session.token,[]).role,'admin');
  assert.throws(()=>ctx.completeDeskSignIn(invite,ticket),/already used/);
});

test('desk transfers expire or revoke with the staff row and public sends preserve private mail capacity',()=>{
  const {ctx,rows,loginMail,at,people}=staffFixture(),owner=ctx.CLUB_RESOURCES.owner;
  const row=[owner,'admin','d'.repeat(40),'no'];rows.push(row);
  ctx.CLUB_RESOURCES.webAppUrl='https://script.google.com/macros/s/test-event/exec';
  ctx.requestEventCode(owner);assert.equal(loginMail.length,0);
  row[3]='yes';
  const invite=ctx.staffInvite_(row[2]);
  const transfer=()=>{
    ctx.requestEventCode(owner);
    const link=new URL(ctx.signInEvent(owner,mailDigits(loginMail),'').continueUrl);
    return new URLSearchParams(link.hash.slice(1)).get('ticket');
  };
  const expired=transfer();
  at('2026-11-25T12:03:00+05:30');
  assert.throws(()=>ctx.completeDeskSignIn(invite,expired),/expired/);
  const revoked=transfer();
  row[3]='no';assert.throws(()=>ctx.completeDeskSignIn(invite,revoked));row[3]='yes';
  row[2]='e'.repeat(40);
  assert.throws(()=>ctx.completeDeskSignIn(ctx.staffInvite_(row[2]),revoked),/expired/);
  people['123456789'].email=owner;
  ctx.requestEventCode('123456789');
  const student=ctx.signInEvent('123456789',mailDigits(loginMail),'');
  assert.equal(ctx.playerRoll_(student.session.token),'123456789');assert.equal(student.continueUrl,undefined);
  ctx.MailApp.getRemainingDailyQuota=()=>1;
  assert.throws(()=>ctx.requestEventCode(owner),/daily limit/);
  ctx.requestOwnerCode(ctx.staffInvite_(row[2]));assert.equal(loginMail.at(-1)[0],owner);
});

function pay(f,roll='123456789',ref='123456786789'){const r=pending(f,roll,ref.slice(-4));f.ctx.staffApprove('admin',r.id,ref,true);return f.st.attempts[r.id]}
test('ticket emails stay paused by default, including approval, forced resend and statement dispatch',()=>{
  const f=fixture();f.properties.delete('PASS_EMAIL_DELIVERY');
  const a=pay(f);a.bankRow='bank-credit';
  const before=JSON.stringify(a),audit=f.audit.length;
  assert.equal(f.sent.length,0);assert.equal(a.delivery,'Pending delivery');
  assert.equal(f.ctx.deliverPass_(a.id,'Test staff',true),'Email delivery paused');
  assert.equal(f.ctx.staffPass('desk',a.id,true).delivery,'Email delivery paused');
  const result=f.ctx.adminDispatchPasses('admin');
  assert.equal(result.paused,true);assert.equal(result.remaining,1);assert.equal(result.failed,0);
  assert.equal(f.sent.length,0);assert.equal(JSON.stringify(a),before);assert.equal(f.audit.length,audit);
  f.properties.set('PASS_EMAIL_DELIVERY','paused');assert.equal(f.ctx.deliverPass_(a.id,'Test staff'),'Email delivery paused');
  f.properties.set('PASS_EMAIL_DELIVERY','enabled');f.ctx.deliverPass_(a.id,'Test staff');
  assert.equal(f.sent.length,1);assert.match(f.sent[0][2],/allocated at the registration desk/);
  assert.doesNotMatch(f.sent[0][2],/wave\s+\d|round\s+\d|table\s+\d|seat\s+\d/i);
});
test('paid passes have no allocation until desk check-in and arrival order determines availability',()=>{
  const f=fixture();f.properties.delete('PASS_EMAIL_DELIVERY');
  const a=pay(f),b=pay(f,'987654321','123456780001');
  for(const item of [a,b]){
    assert.equal(item.wave,-1);assert.equal(item.capacityReserved,true);assert.ok(!item.seat&&!item.used);
    const pass=f.ctx.passInfo(f.ctx.pass_(item.id));assert.equal(pass.active,true);assert.equal(pass.wave,0);assert.equal(pass.allocation,'desk');
    const staff=f.ctx.staffPass('desk',item.id,false);assert.equal(staff.wave,0);assert.equal(staff.allocation,'desk');
  }
  // A legacy pass also remains valid when an earlier qualifier has closed.
  a.wave=0;f.st.game.next=2;
  const bIn=f.ctx.gateAction('gate','admit',f.ctx.pass_(b.id),'desk-second-paid-first');
  const aIn=f.ctx.gateAction('gate','admit',f.ctx.pass_(a.id),'desk-first-paid-second');
  assert.equal(bIn.wave,3);assert.equal(bIn.seat,1);assert.equal(aIn.wave,3);assert.equal(aIn.seat,2);
  assert.equal(f.ctx.passInfo(f.ctx.pass_(a.id)).allocation,'assigned');assert.equal(f.sent.length,0);
});
test('all sign-in and pass emails use plain text, with one private link and a gate code on each pass',()=>{
  const f=fixture(), {ctx,loginMail,sent}=f;
  const paid=pay(f);
  f.st.attempts[paid.id].status='ELIMINATED';f.st.game.next=1;
  f.at('2026-11-27T20:00:00+05:30');
  ctx.deskPayment('desk',paid.roll,'retry','000000001222',true);
  const admin=staffFixture(), row=['owner@example.test','admin','d'.repeat(40),'yes'];
  admin.rows.push(row);admin.ctx.requestOwnerCode(admin.ctx.staffInvite_(row[2]));
  admin.ctx.requestEventCode(row[0]);
  const signIns=[loginMail[0],...admin.loginMail];
  assert.deepEqual(signIns.map(m=>m[1]),['Poké Poker Night 2026 sign-in code','Poké Poker Night 2026 private desk sign-in code','Poké Poker Night 2026 admin sign-in code']);
  assert.equal(sent.length,2);
  for(const [to,subject,plain,options] of [...signIns,...sent]) {
    assert.ok(['sample@example.test','owner@example.test'].includes(to));
    assert.equal(options.name,'Poké Poker Night 2026');assert.equal(options.replyTo,'owner@example.test');
    assert.match(plain,/Entrepreneurship Cell, IMT Ghaziabad/);
    assert.equal(options.htmlBody,undefined);assert.equal(options.inlineImages,undefined);assert.equal(options.attachments,undefined);
    assert.doesNotMatch(plain,/<[a-z][^>]*>|cid:|data:image\//i);
    assert.doesNotMatch(subject,/\b\d{6}\b|PN-[A-Z0-9]{16}/);
  }
  for(const [,,plain] of signIns) {
    assert.match(plain,/^\d{6}$/m);assert.match(plain,/10 minutes/);assert.doesNotMatch(plain,/https?:\/\//i);
  }
  assert.match(signIns[1][2],/private E-Cell desk/);
  for(const [index,[,subject,plain]] of sent.entries()) {
    assert.equal(subject,'Poké Poker Night 2026 '+(index?'retry':'entry')+' pass');
    const code=plain.match(/^PN-[A-Z0-9]{16}$/m)[0];
    const url='https://pokernight.imtneversleeps.com/event.html?view=pass#code='+code;
    assert.deepEqual(plain.match(/https?:\/\/\S+/g),[url]);
  }
});
test('the Early Bird cutoff reprices an open registration in place and preserves submitted fees',()=>{
  const f=fixture(),c=f.ctx;f.at('2026-11-27T15:59:59+05:30');
  const early=hold(f),other=pending(f,'987654321','4444');assert.equal(early.offer.early,true);
  f.st.attempts[early.id].expires=early.offer.endsAt; // An older journal row.
  f.at('2026-11-27T16:00:00+05:30');
  const current=status(f,early.ticket);
  assert.equal(current.status,'HOLD');assert.equal(current.upi,'club@example');assert.equal(current.fee,199);
  assert.equal(current.ticket,early.ticket);assert.equal(current.offer.early,false);
  c.staffApprove('admin',other.id,'000000004444',true);assert.equal(status(f,other.ticket).fee,149);
});
test('unpaid, malformed and closed tickets produce the same gate result without consuming a seat',()=>{
  const f=fixture(),c=f.ctx,r=pending(f),op=crypto.randomUUID();
  for(const code of ['', 'unrelated', 'PN-ZZZZZZZZZZZZZZZZ', c.pass_(r.id)]){
    assert.equal(JSON.stringify(c.gateAction('gate','admit',code,op)),'{"status":"invalid"}');
  }
  c.staffApprove('admin',r.id,'123456786789',true);c.releaseSeat('desk',r.id,'no-show');
  assert.equal(c.gateAction('gate','admit',c.pass_(r.id),op).status,'invalid');
  assert.equal(f.audit.filter(([kind])=>kind==='Gate admit').length,0);
  assert.equal(Object.keys(f.st.venue).length,0);
});
test('legacy journal admissions retain the first time and seat across later snapshots and exits',()=>{
  const {ctx}=fixture(),st=ctx.fresh_(),time=12345678;
  const a={id:'a',roll:'123456789',wave:0,status:'PAID',used:true};
  ctx.apply_(st,{attempts:[{...a}]},'Gate admit',time);
  ctx.apply_(st,{attempts:[{...a,status:'QUALIFIED'}]},'Stage closed',time+1000);
  ctx.apply_(st,{attempts:[{...a,id:'b',roll:'987654321'}]},'Gate admit',time+2000);
  assert.equal(st.attempts.a.checkedInAt,time);assert.equal(st.attempts.a.seat,1);assert.equal(st.attempts.b.seat,2);
});
test('gate seating survives gaps and the qualifier draw cannot swap assigned seats',()=>{
  const f=fixture(),c=f.ctx;
  for(let i=1;i<=8;i++){
    const id='player'+i,roll=String(100000000+i);
    f.st.attempts[id]={id,roll,wave:0,used:true,seat:i,status:'PAID'};
    f.st.venue[roll]={where:i>=7?'IN':'OUT'};
  }
  const draft=c.gamePreview('floor');
  assert.equal(draft.tableNumbers[0],2);assert.equal(draft.seats.player7,7);
  assert.throws(()=>c.startStage('floor',0,[['player8','player7']]),/Gate seats/);
  c.startStage('floor',0,draft.tables);
  const board=c.publicFloor_(f.st);assert.equal(board.tables[0].name,'Tide');assert.deepEqual(Array.from(board.tables[0].seats),[7,8]);
  f.st.attempts.late={id:'late',roll:'999999999',wave:0,status:'PAID',used:false};
  const late=c.gateAction('gate','admit',c.pass_('late'),'late-ticket');
  assert.equal(late.status,'admitted');assert.equal(late.wave,2);assert.equal(late.seat,1);
  assert.equal(f.st.attempts.player7.seat,7);assert.equal(f.st.attempts.player8.seat,8);
});
test('a phone camera capability allows admission only while its issuing gate session is active',()=>{
  const {ctx,rows}=staffFixture(),key=rows[0][2];
  const session=ctx.staffLogin(key,ctx.staffInvite_(key));
  const access=new URLSearchParams(new URL(ctx.scannerLink_(session.token)).hash.slice(1)).get('access');
  const scan=()=>ctx.scanEntryTicket(access,'unknown','camera-test');
  assert.equal(scan().status,'invalid');assert.throws(()=>ctx.staff_(access,['gate']));assert.throws(()=>ctx.playerHome(access,''));
  assert.throws(()=>ctx.scanEntryTicket('bad','unknown','camera-test'),/sign in/i);
  rows[0][3]='no';assert.throws(scan);rows[0][3]='yes';ctx.staffLogout(session.token);assert.throws(scan,/sign in/i);
});
function staffFixture(){
  const f=fixture(),{ctx,actualStaff}=f;
  const rows=[['Volunteer A','gate','a'.repeat(40),'yes'],['Volunteer B','floor','b'.repeat(40),'yes']];
  ctx.Utilities.computeHmacSha256Signature=(message,key)=>crypto.createHmac('sha256',key).update(message).digest();
  ctx.Utilities.base64EncodeWebSafe=bytes=>Buffer.from(bytes).toString('base64url');
  ctx.hash_=value=>crypto.createHash('sha256').update(value).digest('base64url');
  ctx.staffList_=()=>rows;
  ctx.staff_=actualStaff;
  const page={evaluate(){return this},setTitle(title){this.title=title;return this},addMetaTag(){return this}};
  ctx.HtmlService={createHtmlOutput:html=>({...page,html}),createTemplateFromFile:()=>({...page})};
  return {...f,rows};
}
test('public views work without staff access and the old desk URL returns an unavailable page',()=>{
  const {ctx}=staffFixture();
  ctx.staffList_=()=>{throw Error('Unexpected staff directory read')};
  for(const view of ['register','board','pass'])assert.equal(ctx.doGet({parameter:{view}}).route,view);
  assert.equal(ctx.doGet({parameter:{view:'staff'}}).title,'Page unavailable');
  assert.equal(ctx.doGet({parameter:{view:'staff',invite:'invalid'}}).title,'Page unavailable');
});
test('private invitations are bound to the matching active staff key and role',()=>{
  const {ctx,rows}=staffFixture(),key=rows[0][2],invite=ctx.staffInvite_(key);
  const visit=()=>ctx.doGet({parameter:{view:'staff',invite}});
  assert.equal(visit().route,'staff');
  assert.equal(visit().invite,invite);
  assert.equal(ctx.doGet({parameter:{view:'staff',invite:'Z'.repeat(43)}}).title,'Page unavailable');
  assert.throws(()=>ctx.staffLogin(key));
  assert.throws(()=>ctx.staffLogin(rows[1][2],invite));
  const session=ctx.staffLogin(key,invite);
  assert.equal(ctx.staff_(session.token,['gate']).role,'gate');
  assert.throws(()=>ctx.staff_(session.token,['desk']));
  rows[0][3]='no';
  assert.equal(visit().title,'Page unavailable');
  assert.throws(()=>ctx.staffLogin(key,invite));
  assert.throws(()=>ctx.staff_(session.token,['gate']));
});
test('the one-time staff link migration can be retried and returns only public registration status',()=>{
  const {ctx}=fixture(),properties=new Map(),staff={};
  ctx.props_=()=>({getProperty:k=>properties.get(k),setProperty:(k,v)=>properties.set(k,v)});
  ctx.book_=()=>({getSheetByName:name=>name==='Staff'?staff:null});
  let runs=0;
  ctx.syncStaffLinks_=sheet=>{assert.equal(sheet,staff);return ++runs>1};
  for(let n=0;n<3;n++){
    const info=ctx.publicInfo(),offer=ctx.entryOffer_(ctx.Date.now());
    assert.equal(JSON.stringify(info),JSON.stringify({open:true,paymentsReady:true,offer,fee:offer.amount}));
  }
  assert.equal(runs,2);
});
test('existing staff receive private links alongside their keys without replacing other columns',()=>{
  const {ctx,rows}=staffFixture(),base='https://script.google.com/macros/s/example/exec';
  ctx.deskBaseUrl_=()=>base;
  const data=[['Label','Role','Private sign-in key','Active','Notes'],[...rows[0],'Keep'],[...rows[1],'Keep']];
  const sheet={
    getLastRow:()=>data.length,getLastColumn:()=>data[0].length,
    getRange(row,column,height=1,width=1){
      return {
        getDisplayValues:()=>Array.from({length:height},(_,r)=>Array.from({length:width},(_,c)=>data[row+r-1][column+c-1]||'')),
        setValue:value=>{data[row-1][column-1]=value},
        setValues:values=>values.forEach((cells,r)=>{data[row+r-1][column-1]=cells[0]})
      };
    }
  };
  ctx.syncStaffLinks_(sheet);ctx.syncStaffLinks_(sheet);
  assert.equal(data[0][5],'Private desk link');assert.equal(data[0].length,6);
  assert.equal(data[1][4],'Keep');assert.equal(data[1][2],rows[0][2]);
  assert.equal(data[1][5],base+'?view=staff&invite='+ctx.staffInvite_(rows[0][2]));
  assert.ok(!data[1][5].includes(rows[0][2]));assert.notEqual(data[1][5],data[2][5]);
  data[1][3]='no';ctx.syncStaffLinks_(sheet);assert.equal(data[1][5],'');
});
test('a verified student returns to one private checkout without reserving a numbered seat',()=>{
  const f=fixture(),r=hold(f);assert.equal(r.fee,149);assert.equal(r.wave,0);assert.ok(r.ticket);
  assert.ok(!('code' in r||'email' in r||'phone' in r));assert.equal(hold(f).id,r.id);
  assert.equal(f.ctx.playerStart(f.sessionFor(),r.ticket).id,r.id);assert.throws(()=>f.ctx.playerStatus(f.sessionFor(),r.id+'.forged'));
});
test('partial references never approve and a wrong visible suffix blocks approval',()=>{const f=fixture(),r=pending(f);for(const ref of ['6789','000000001234'])assert.throws(()=>f.ctx.staffApprove('admin',r.id,ref,true));assert.throws(()=>f.ctx.staffApprove('admin',r.id,'000000006789',false));assert.equal(f.sent.length,0)});
test('approval is idempotent, mails only registered contact and rejects a reused bank reference',()=>{const f=fixture(),a=pay(f);assert.equal(f.sent.length,1);assert.equal(f.sent[0][0],'sample@example.test');f.ctx.staffApprove('admin',a.id,a.utr,true);assert.equal(f.sent.length,1);const r=pending(f,'987654321');assert.throws(()=>f.ctx.staffApprove('admin',r.id,a.utr,true));assert.throws(()=>f.ctx.staffApprove('gate',r.id,a.utr,true))});
test('missing email preserves paid code for ID-checked desk delivery',()=>{const f=fixture(),r=pending(f,'987654321');f.people['987654321'].email='';f.ctx.staffApprove('admin',r.id,'123456786789',true);const a=f.st.attempts[r.id];assert.equal(a.delivery,'Desk delivery needed');assert.equal(f.sent.length,0);assert.equal(f.ctx.staffPass('desk',a.id,false).code,f.ctx.pass_(a.id))});
test('single use gate, exit and wristband return count one person and keep the original scan',()=>{
  const f=fixture(),a=pay(f),code=f.ctx.pass_(a.id);
  const admit=op=>f.ctx.gateAction('gate','admit',code,op);
  const first=admit('fixture-01');assert.equal(first.status,'admitted');assert.equal(first.seat,1);assert.equal(first.player,'Sample Player');
  f.at('2026-11-25T13:00:00+05:30');
  for(const op of ['fixture-01','fixture-02']){
    const repeat=admit(op);assert.equal(repeat.status,'used');assert.equal(repeat.checkedInAt,first.checkedInAt);assert.equal(repeat.seat,first.seat);
  }
  f.ctx.gateAction('gate','exit',a.roll,'fixture-03');f.ctx.gateAction('gate','return',a.roll,'fixture-04');
  assert.equal(Object.keys(f.st.venue).length,1);assert.equal(f.st.venue[a.roll].where,'IN');
  assert.equal(f.ctx.passInfo(code).code,'');assert.equal(f.ctx.passInfo(code).seat,1);
  assert.equal(f.audit.filter(([kind])=>kind==='Gate admit').length,1);
});
test('unpaid checkouts consume no capacity and 216 proofs reserve capacity without assigning waves',()=>{
  const f=fixture();
  for(let i=0;i<216;i++){const roll=String(200000000+i);f.people[roll]={email:roll+'@example.test'};assert.equal(hold(f,roll).wave,0)}
  assert.equal(hold(f).status,'HOLD');
  for(let i=0;i<216;i++){const roll=String(200000000+i),r=pending(f,roll);assert.equal(f.st.attempts[r.id].wave,-1);assert.equal(f.st.attempts[r.id].capacityReserved,true)}
  const r=hold(f);assert.equal(r.full,true);assert.equal(r.upi,'');assert.equal(r.paymentQr,'');
  const waiting=pending(f);assert.equal(f.st.attempts[waiting.id].wave,-1);assert.equal(f.st.attempts[waiting.id].capacityReserved,false);
});
test('an old expired checkout reopens on its original receipt and staff permissions still apply',()=>{
  const f=fixture(),r=hold(f);f.st.attempts[r.id].expires=f.ctx.Date.now()+900000;
  f.at('2026-11-25T15:16:00+05:30');assert.equal(status(f,r.ticket).status,'HOLD');assert.equal(hold(f).id,r.id);
  assert.throws(()=>f.ctx.proofImage('floor',r.id));assert.throws(()=>f.ctx.staffPass('gate',r.id,false));
});
test('walk-ins stop at 11, eliminated players can buy one later retry, reentry leaves inside count alone',()=>{const f=fixture(),a=pay(f);f.at('2026-11-27T23:12:00+05:30');assert.throws(()=>f.ctx.deskPayment('desk',a.roll,'retry','000000001222',true));f.ctx.gateAction('gate','admit',f.ctx.pass_(a.id),'fixture-in1');f.st.attempts[a.id].status='ELIMINATED';f.st.game.next=1;assert.throws(()=>f.ctx.deskPayment('desk','987654321','walk','000000001111',true));const k=f.ctx.deskPayment('desk',a.roll,'retry','000000001222',true);assert.equal(f.st.attempts[k.id].wave,-1);assert.equal(f.st.attempts[k.id].fee,149);assert.notEqual(f.ctx.pass_(k.id),f.ctx.pass_(a.id));f.ctx.gateAction('gate','admit',f.ctx.pass_(k.id),'fixture-in2');assert.equal(f.st.attempts[k.id].wave,1);assert.equal(Object.keys(f.st.venue).length,1)});
test('a full table result requires conserved chips and an explicit tiebreak; only the leader advances',()=>{const f=fixture(),a=pay(f),b=pay(f,'987654321','000000000001');for(const x of [a,b])f.ctx.gateAction('gate','admit',f.ctx.pass_(x.id),'admission-'+x.id);const draw=f.ctx.gamePreview('floor');f.ctx.startStage('floor',0,draw.tables);assert.equal(f.st.game.active.deadline-f.st.game.active.started,1800000);assert.throws(()=>f.ctx.tableResult('floor',0,0,{[a.id]:1,[b.id]:1},''));const values={[a.id]:10000,[b.id]:10000};assert.throws(()=>f.ctx.tableResult('floor',0,0,values,''));f.ctx.tableResult('floor',0,0,values,a.id);f.ctx.finishStage('floor',0);assert.equal(f.st.attempts[a.id].status,'QUALIFIED');assert.equal(f.st.attempts[b.id].status,'ELIMINATED');assert.ok(!JSON.stringify(f.ctx.liveFloor()).includes(a.roll));});
test('six full qualifiers yield 36 semifinalists, six finalists and one winner',()=>{const f=fixture();for(let wave=0;wave<6;wave++)for(let seat=0;seat<36;seat++){const id=wave.toString(16).padStart(2,'0')+seat.toString(16).padStart(3,'0')+'0'.repeat(11),roll=String(300000000+36*wave+seat);f.st.attempts[id]={id,roll,wave,status:'PAID',used:true,created:seat};f.st.venue[roll]={where:'IN'}}for(let n=0;n<8;n++){const d=f.ctx.gamePreview('floor');assert.equal(d.tables.flat().length,n===7?6:36);f.ctx.startStage('floor',n,d.tables);assert.equal(f.st.game.active.deadline-f.st.game.active.started,n===7?3600000:1800000);d.tables.forEach((ids,i)=>{const chips=Object.fromEntries(ids.map((id,j)=>[id,j===0?60000:0]));f.ctx.tableResult('floor',n,i,chips,'')});f.ctx.finishStage('floor',n)}assert.equal(Object.values(f.st.attempts).filter(x=>x.status==='WINNER').length,1);assert.equal(f.ctx.liveFloor().state,'Finished')});
