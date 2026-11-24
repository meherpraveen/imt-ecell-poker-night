'use strict';
const mem={get(k){try{return sessionStorage.getItem('pn26:'+k)||''}catch{return ''}},set(k,v){try{sessionStorage.setItem('pn26:'+k,v)}catch{}}};
const invite=document.body.dataset.invite,sessionKey='staff:'+invite;
let token=mem.get(sessionKey),snapshot,tab='Review',opened,draft,refreshVersion=0,polling=false;
function reference(id){return input(id,'Full UPI bank reference','inputmode="numeric" maxlength="12" placeholder="12 digits from the coordinator’s history"')}
let dialogTrigger;
document.addEventListener('click',event=>{
  const button=event.target.closest('[data-do]');
  if(button&&!el('dialog').open)dialogTrigger=button;
  else if(button&&el('dialog').open){const error=el('detail').querySelector('[data-error]');if(error)error.textContent=''}
},true);
function detail(html){
  const d=el('dialog');
  d.classList.remove('gate-dialog');
  el('detail').innerHTML='<div class="note error" role="alert" data-error></div>'+html;
  const title=el('detail').querySelector('h2');
  if(!title.id)title.id='deskDialogTitle';
  d.setAttribute('aria-labelledby',title.id);title.tabIndex=-1;
  if(!d.open)d.showModal();
  d.scrollTop=0;title.focus({preventScroll:true});
}
function closeDetail(){el('dialog').close();opened=null}
function nameOf(k){return {pre:'Pre-registration',walk:'Walk-in',retry:'Round 1 retry'}[k]||k}
function login(){
  clearDeskShell();tab='Review';
  heading('Staff access','Event desk');
  const owner=document.body.dataset.ownerLogin==='yes';
  const body=owner?signInForm('ownerCode','<p>Send a six-digit sign-in code to <strong>'+esc(document.body.dataset.ownerEmail)+'</strong>.</p>','Send code to club email'):
    signInForm('login',input('staffkey','Private staff key','type="password" required autocomplete="current-password"')+'<p class="sub">Use the individual key issued by the coordinator.</p>','Sign in');
  el('content').innerHTML='<div class="narrow login-card">'+panel(owner?'Admin sign-in':'Staff sign-in',body)+'</div>';
}
function ownerCodePage(delay){
  const form=signInForm('verifyOwner','<p>Look for <strong>Poké Poker Night 2026 private desk sign-in code</strong> in the club inbox or Spam. The code expires in 10 minutes.</p>'+codeInput(),'Verify and open desk');
  el('content').innerHTML='<div class="narrow login-card">'+panel('Check the club inbox',form+btn('resendCode','Resend code'))+'</div>';
  startResendTimer(Date.now()+delay*1000);el('loginCode').focus();
}
function updateDesk(previous,next,reloadSettings,background){
  if(!previous||previous.role!==next.role){staffView();return}
  for(const value of document.querySelectorAll('[data-stat]'))if(value.textContent!==String(next.stats[value.dataset.stat]))value.textContent=next.stats[value.dataset.stat];
  const changed=(a,b)=>JSON.stringify(a)!==JSON.stringify(b);
  if(tab==='Review'||tab==='Gate'){
    if(changed(previous.records,next.records))filterRecords();
    if(tab==='Review')setPaymentAction();
    else queueLabel();
    return;
  }
  if(tab==='Settings'){
    const stale=next.settings.version!==previous.settings.version||changed(previous.settings.receivers,next.settings.receivers);
    if(!reloadSettings&&el('content').dataset.modified==='yes'&&(background||!stale)){
      if(stale)el('net').textContent='Payment settings changed on another device. Refresh to load the saved settings.';
      // A save must still detect conflicting edits while this form is being filled in.
      snapshot.settings=previous.settings;
      return;
    }
    if(!reloadSettings&&!stale)return;
  }
  if(tab==='Tables')syncFloorClock(next.board);
  if(tab==='Tables'&&!changed(previous.game,next.game)&&!changed(previous.board.tables,next.board.tables)&&
    previous.board.champion===next.board.champion&&!changed(previous.board.leaderboard,next.board.leaderboard))return;
  if(tab==='Audit'&&!changed(previous.audit,next.audit))return;
  const focus=document.activeElement,wasInside=el('content').contains(focus);
  const openTables=Array.from(document.querySelectorAll('.desk-table details')).map(details=>details.open);
  staffView();
  if(tab==='Tables'&&previous.game.active?.n===next.game.active?.n&&previous.game.next===next.game.next){
    document.querySelectorAll('.desk-table details').forEach((details,i)=>{details.open=!!openTables[i]});
  }
  if(wasInside){
    const restored=(focus.id&&el(focus.id))||Array.from(el('content').querySelectorAll('[data-do]')).find(b=>
      b.dataset.do===focus.dataset.do&&b.dataset.id===focus.dataset.id);
    (restored||el('title')).focus({preventScroll:true});
  }
}
async function refresh(background=false,reloadSettings=false){
  if(background&&(polling||busy||el('dialog').open))return;
  const session=token,version=++refreshVersion;
  if(background)polling=true;
  try{
    const next=await api('staffSnapshot',session);
    if(session!==token||version!==refreshVersion||(background&&(busy||el('dialog').open)))return;
    const previous=snapshot;snapshot=next;syncOffer(next.offer);el('net').textContent='';
    updateDesk(previous,next,reloadSettings,background);
  }finally{if(background)polling=false}
}
async function inspect(id){
  const r=snapshot.records.find(x=>x.id===id);
  if(!r)throw Error('This payment has changed. Refresh the queue and open it again.');
  opened=id;
  if(r.status==='REVIEW'&&r.managed&&snapshot.role==='admin'){await bankReviewDialog(id);return}
  const facts='<div class="desk-payment-facts"><div><small>Entry fee</small><strong>'+esc(formatFee_(r.fee))+'</strong></div>'+paymentBadge(r)+'</div>';
  let s='<h2>'+esc(r.name||r.roll)+'</h2><p class="sub">'+esc([r.roll,nameOf(r.kind),waveText(r)].filter(Boolean).join(' · '))+'</p>'+facts;
  if(r.suffix)s+='<p>Reference ending <code>'+esc(r.suffix)+'</code></p>';
  if(r.sameImage||r.sameTail)s+='<p class="note error">Possible duplicate. Compare the full reference and incoming amount in the coordinator’s account.</p>';
  if(r.image)s+=btn('image','View private screenshot')+'<div id="imgslot"></div>';
  if(r.status==='REVIEW'&&snapshot.managed){s+='<p>Payment pending. The administrator reconciles this proof against the receiver statement.</p>'}
  if(r.status==='REVIEW'&&!snapshot.managed){
    s+=reference('full')+'<small id="matchTail" role="status"></small>'+checkbox('verified','I checked the incoming credit, exact fee and payer in the coordinator’s account.')+
      btn('approve','Approve and send code','primary wide')+'<details class="desk-disclosure"><summary>Other payment actions'+deskIcon('chevron-down')+'</summary><div>'+
      btn('move','Move to an open wave')+input('reason','Reason if rejecting proof')+btn('reject','Reject proof')+'</div></details>';
  }
  if(r.status==='WAITLIST')s+=btn('move','Offer next available seat','primary');
  if(r.seat)s+='<p>'+esc(seatLabel(r.seat))+' · '+esc(seatLocation(r.wave,r.seat))+'</p>';
  if(r.status==='PAID'&&!r.used)s+='<p>'+esc(r.delivery)+'</p>'+btn('pass','View code and delivery options','primary')+btn('no-show','Mark no-show');
  detail(s);
}
function deskForm(){if(snapshot.managed){detail('<h2>Open a payment</h2>'+rollField('deskroll')+'<label for="kind">Purchase</label><select id="kind"><option value="walk">Event entry</option><option value="retry">Round 1 retry</option></select><p>The player signs in to pay their chosen receiver and upload proof.</p>'+btn('bankOpenDesk','Open player checkout','primary'));return}detail('<h2>Verify a desk payment</h2>'+rollField('deskroll')+'<label for="kind">Purchase</label><select id="kind"><option value="walk">Event entry</option><option value="retry">Round 1 retry</option></select><div id="deskBatchField">'+batchField('deskBatch')+'</div><div id="deskPhoneField">'+phoneField('deskPhone')+'</div><p id="deskFee" role="status"></p>'+reference('deskref')+checkbox('deskcheck','I checked the college ID, the exact fee and the full incoming payment.')+btn('deskpay','Approve and send code','primary'));deskFee()}
function deskFee(){
  if(!el('deskFee'))return;
  const retry=val('kind')==='retry',fee=retry?snapshot.retryFee:snapshot.offer.amount;
  const roll=val('deskroll'),group=el('deskBatchField'),known=snapshot.records.find(r=>r.roll===roll&&r.batch);
  if(group.dataset.roll!==roll){el('deskBatch').value=known?.batch||'';group.dataset.roll=roll}
  group.hidden=roll.length!==9||!!known;
  const phone=snapshot.records.find(r=>r.roll===roll&&validPhone(r.phone))?.phone||'',phoneGroup=el('deskPhoneField');
  if(phoneGroup.dataset.roll!==roll){el('deskPhone').value=phone;phoneGroup.dataset.roll=roll}
  phoneGroup.hidden=roll.length!==9||!!phone;
  el('deskFee').dataset.fee=String(fee);
  el('deskFee').textContent=(retry?'Retry fee':'Entry fee')+' '+formatFee_(fee);
}
function queueKey(){return 'gate-queue-'+String(token).split('.')[0]}
function qread(key=queueKey()){try{return JSON.parse(durable.get(key)||'[]')}catch{return []}}
function qsave(list,key=queueKey()){durable.set(key,JSON.stringify(list))}
function queueLabel(){el('pending').textContent=qread().length?qread().length+' unsynced gate actions. Wait for confirmation before admitting.':''}
let gateSync=null;
const gateResults=[];
function nextGateResult(){
  if(!gateResults.length){closeDetail();return}
  const result=gateResults.shift();
  detail(gateResultHtml(result,btn('nextGateResult',gateResults.length?'Next result':'Done','primary wide')));
  el('dialog').classList.add('gate-dialog');el('scanResultTitle').focus();
}
function presentGateReply(reply){
  if(typeof reply==='string'){msg(reply);return}
  gateResults.push(reply);
  if(gateResults.length&&!el('dialog').open)nextGateResult();
}
el('dialog').addEventListener('close',()=>{
  if(el('dialog').open)return;
  opened=null;
  if(token&&gateResults.length){nextGateResult();return}
  const target=dialogTrigger?.isConnected?dialogTrigger:el('deskMainAction')?.querySelector('button')||el('title');
  target?.focus({preventScroll:true});
});
function transient(e){return !navigator.onLine||/network|offline|connection|timeout|timed out|temporar|service unavailable|failed to fetch|server error|lock timeout/i.test(e?.message||'')}
async function syncGate(){
  if(!token||!navigator.onLine)return;if(gateSync)return gateSync;
  const owner=token,key=queueKey();
  gateSync=(async()=>{
    while(token===owner){
    const a=qread(key)[0];if(!a)break;
    let reply;
    try{reply=await api('gateAction',owner,a.mode,a.value,a.id)}
    catch(e){if(transient(e)){msg('Queued on this device. Wait for server confirmation.');break}
      if(/sign in|staff role/i.test(e.message))throw e;
      qsave(qread(key).filter(x=>x.id!==a.id),key);throw e}
    qsave(qread(key).filter(x=>x.id!==a.id),key);if(token===owner)presentGateReply(reply);
  }})();try{return await gateSync}finally{gateSync=null;if(el('pending'))queueLabel()}
}
async function gateOp(){
  const a={mode:val('gateMode'),value:val('gateValue'),id:crypto.randomUUID()};
  if(!a.value)return fieldError('gateValue','Enter the ticket code or the player’s roll number.');
  if(!el('gateID').checked)return fieldError('gateID','Check the college ID or wristband before recording this action.');
  const queued=qread();if(!queued.some(v=>v.mode===a.mode&&v.value===a.value))qsave([...queued,a]);queueLabel();
  if(!qread().some(v=>v.mode===a.mode&&v.value===a.value)){
    if(!navigator.onLine)throw Error('Reconnect to check this ticket. This browser could not save an offline action.');
    presentGateReply(await api('gateAction',token,a.mode,a.value,a.id));return;
  }
  if(!navigator.onLine){msg('Queued on this device. Entry is pending until sync.');return}
  await syncGate();
  if(!qread().length)refresh().catch(()=>{el('net').textContent='Attendance will update when the connection returns.'});
}
function previewDraw(){
  const options=draft.tables.flat(),qualifier=draft.n<6;
  const tables=draft.tables.map((table,i)=>{
    const seats=table.map((id,j)=>{
      if(qualifier)return '<li><span>'+esc(seatLabel(draft.seats[id]))+'</span><strong>'+esc(draft.names[id])+'</strong></li>';
      const field='s'+i+'-'+j;
      return '<li><label for="'+field+'">Seat '+(j+1)+'</label><select id="'+field+'">'+options.map(x=>
        '<option value="'+esc(x)+'"'+(x===id?' selected':'')+'>'+esc(draft.names[x])+'</option>').join('')+'</select></li>';
    }).join('');
    return '<details class="desk-draw-table desk-disclosure"'+(i===0?' open':'')+'><summary>Table '+draft.tableNumbers[i]+
      '<span>'+table.length+(table.length===1?' player':' players')+'</span>'+deskIcon('chevron-down')+'</summary><ul>'+seats+'</ul></details>';
  }).join('');
  const hint=options.length?(qualifier?'Players keep the seats assigned at the gate.':'To swap seats, change both player selections.'):'No eligible players are checked in for this stage.';
  const action=options.length?btn('startStage','Start all tables','primary wide'):qualifier?btn('skip','Close empty wave','wide'):'';
  detail('<h2>'+esc(draft.title)+'</h2><p class="sub">'+hint+'</p>'+tables+action);
}
function score(index){
  const h=snapshot.game.active,t=h.tables[index],no=h.tableNumbers?.[index]||index+1;
  const name=id=>snapshot.records.find(r=>r.id===id)?.name||id;
  opened=index;
  const fields=t.map(id=>'<div class="desk-score-row">'+input('c'+id,esc(name(id)),
    'class="desk-chips" type="number" inputmode="numeric" min="0" step="1" placeholder="0" value="'+(h.chips[id]??'')+'"')+'</div>').join('');
  const names=t.map(id=>'<option value="'+esc(id)+'"'+(h.winners.includes(id)?' selected':'')+'>'+esc(name(id))+'</option>').join('');
  detail('<h2>Table '+no+' chip counts</h2><p class="sub">Enter each player’s final chip count.</p>'+fields+
    '<div id="deskTie" hidden><label for="tie">Witnessed tiebreak winner</label><select id="tie"><option value="">Choose the winner</option>'+names+'</select></div>'+
    btn('score','Save table result','primary wide'));
  updateTiebreak();
}
function updateTiebreak(){
  const fields=Array.from(el('detail').querySelectorAll('.desk-chips'));
  const scores=fields.map(field=>field.valueAsNumber);
  const leaders=fields.filter((field,i)=>scores[i]===Math.max(...scores)).map(field=>field.id.slice(1));
  const tied=scores.every(n=>Number.isSafeInteger(n)&&n>=0)&&leaders.length>1;
  el('deskTie').hidden=!tied;
  for(const option of el('tie').options)option.disabled=!!option.value&&!leaders.includes(option.value);
  if(!tied||!leaders.includes(val('tie')))el('tie').value='';
}
async function action(name,id){
  if(name.startsWith('bank'))return bankAction(name,id);
  if(name==='close'){closeDetail();return}
  if(name==='tab'){
    if(tab===id||!deskPages[id]?.roles.includes(snapshot.role))return;
    tab=id;staffView();window.scrollTo({top:0,behavior:'instant'});el('title').focus({preventScroll:true});return;
  }
  if(name==='nextPayment'){
    const next=snapshot.records.slice().reverse().find(r=>r.status==='REVIEW');
    if(next)await inspect(next.id);return;
  }
  if(name==='ownerCode'||name==='resendCode'){const reply=await api('requestOwnerCode',invite);mem.set(sessionKey+':code',JSON.stringify({resend:Date.now()+reply.resendAfter*1000,expires:Date.now()+(reply.expiresIn??600)*1000}));ownerCodePage(reply.resendAfter);return}
  if(name==='verifyOwner'||name==='login'){
    const auth=name==='verifyOwner'?await api('verifyOwnerCode',invite,val('loginCode')):await api('staffLogin',val('staffkey'),invite);
    await enterDesk(auth);return;
  }
  if(name==='logout'){const old=token;mem.set(sessionKey,'');token='';snapshot=null;login();await api('staffLogout',old);return}
  if(name==='refresh'){await openDesk();return}if(name==='inspect'){await inspect(id);return}if(name==='deskform'){deskForm();return}
  if(name==='studentform'){detail('<h2>Verify directory details</h2>'+rollField('newroll')+input('newname','Name on college ID')+input('newmail','Delivery email','type="email"')+input('newphone','WhatsApp number','type="tel"')+checkbox('newid','I verified the college ID and the contact with the student.')+btn('student','Save missing details','primary'));return}
  if(name==='student'){await api('deskStudent',token,val('newroll'),val('newname'),val('newmail'),val('newphone'),el('newid').checked);closeDetail();msg('Directory details saved.');await refresh();return}
  if(name==='image'){const pic=await api('proofImage',token,opened);const im=document.createElement('img');im.className='shot';im.alt='Private payment screenshot';im.src=pic;el('imgslot').replaceChildren(im);return}
  if(name==='approve'){
    if(!/^\d{12}$/.test(val('full')))return fieldError('full','Enter the 12 digits from the incoming payment.');
    if(!el('verified').checked)return fieldError('verified','Confirm the credit in the coordinator’s account first.');
    const r=await api('staffApprove',token,opened,val('full'),true);
    closeDetail();msg('Payment approved. '+r.status);await refresh();return;
  }
  if(name==='deskpay'){
    if(!/^\d{9}$/.test(val('deskroll')))return fieldError('deskroll','Enter the nine-digit college roll number.');
    if(!el('deskBatchField').hidden&&!val('deskBatch'))return fieldError('deskBatch','Choose the player’s batch.');
    if(!validPhone(val('deskPhone')))return fieldError('deskPhone','Enter the player’s phone number with 7–15 digits.');
    if(!/^\d{12}$/.test(val('deskref')))return fieldError('deskref','Enter the 12 digits from the incoming payment.');
    if(!el('deskcheck').checked)return fieldError('deskcheck','Confirm the ID, fee and incoming payment first.');
    const quoted=Number(el('deskFee').dataset.fee);deskFee();
    if(Number(el('deskFee').dataset.fee)!==quoted){el('deskcheck').checked=false;throw Error('The fee has changed. Check the new amount against the incoming payment.')}
    const r=await api('deskPayment',token,val('deskroll'),val('kind'),val('deskref'),el('deskcheck').checked,quoted,val('deskBatch'),val('deskPhone'));
    closeDetail();msg('Attempt verified. '+r.status);await refresh();return;
  }
  if(name==='reject'){await api('staffReject',token,opened,val('reason'));closeDetail();msg('Proof rejected. The reason is on the player’s receipt page.');await refresh();return}
  if(name==='move'||name==='no-show'){if(name==='no-show'&&!confirm('Mark this paid player as a no-show and release their seat?'))return;await api('releaseSeat',token,opened,name);closeDetail();msg('Seat updated.');await refresh();return}
  if(name==='pass'||name==='resend'){if(name==='resend'&&!confirm('Email the same code again to the registered address?'))return;
    const p=await api('staffPass',token,opened,name==='resend');const phone=p.phone.length===10?'91'+p.phone:p.phone;
    const share='E-Cell Poké Poker Night: your Round 1 wave '+p.wave+' code is '+p.code+'. Bring your college ID.';
    detail('<h2>Player pass</h2><p>'+esc(p.name)+' · Wave '+p.wave+'</p>'+qr(p.code)+'<p><code>'+esc(p.code)+'</code></p><p>'+esc(p.delivery)+'</p>'+btn('resend','Resend email')+(/^\d{10,15}$/.test(phone)?'<a class="button" href="https://wa.me/'+phone+'?text='+encodeURIComponent(share)+'" target="_blank" rel="noopener noreferrer">Send via WhatsApp</a>':'')+'<p class="sub">For in-person delivery, verify the college ID.</p>');return}
  if(name==='gate'){await gateOp();return}if(name==='nextGateResult'){nextGateResult();return}
  if(name==='preview'){draft=await api('gamePreview',token);previewDraw();return}
  if(name==='startStage'||name==='skip'){if(!confirm(name==='skip'?'Close this empty wave?':'Lock this draw and start all tables?'))return;
    if(name==='skip')await api('skipEmptyWave',token,draft.n);else await api('startStage',token,draft.n,draft.n<6?draft.tables:draft.tables.map((t,i)=>t.map((_,j)=>val('s'+i+'-'+j))));closeDetail();await refresh();return}
  if(name==='table'){score(Number(id));return}
  if(name==='score'){
    const h=snapshot.game.active,values={};
    for(const player of h.tables[opened]){
      const field=el('c'+player),amount=field.valueAsNumber;
      if(!Number.isSafeInteger(amount)||amount<0)return fieldError(field.id,'Enter a whole chip count of zero or more.');
      values[player]=amount;
    }
    if(!el('deskTie').hidden&&!val('tie'))return fieldError('tie','Select the winner of the witnessed tiebreak.');
    await api('tableResult',token,h.n,opened,values,val('tie'));closeDetail();await refresh();return;
  }
  if(name==='finish'){if(!confirm('Close this stage and advance only the winning player at each table?'))return;await api('finishStage',token,snapshot.game.next);await refresh();return}
  if(name==='showPaymentQr'){const preview=el('qrPreview'),data=await api('adminPaymentQr',token);preview.hidden=!data;if(data)preview.src=data;else preview.removeAttribute('src');return}
  if(name==='save'){
    if(snapshot.managed){const s=snapshot.settings;await api('adminSettings',token,s.upi,s.name,el('open').checked,{version:s.version,published:s.published,removeQr:false,qr:''});await refresh(false,true);msg('Registration setting saved.');return}
    const file=el('paymentQr').files[0],removeQr=!!el('removeQr')?.checked;
    if(file&&removeQr)throw Error('Choose a replacement QR or remove the saved QR.');
    const options={version:snapshot.settings.version,published:el('publish').checked,removeQr,qr:file?await picture(file,true):''};
    await api('adminSettings',token,val('upi'),val('payname'),el('open').checked,options);
    msg('Payment settings saved.');await refresh(false,true);return;
  }
  if(name==='newkey'){
    if(!val('label'))return fieldError('label','Enter the name of the volunteer receiving this invitation.');
    const access=await api('adminAddStaff',token,val('label'),val('role'),true);
    detail('<h2>Volunteer invitation</h2><p>Share both items privately with the named volunteer.</p>'+input('inviteUrl','Private desk link','readonly value="'+esc(access.url)+'"')+input('inviteKey','Sign-in key','readonly value="'+esc(access.key)+'"'));
  }
}
function markSettingsEdit(event){
  if(tab==='Settings'&&el('content').contains(event.target))el('content').dataset.modified='yes';
}
document.addEventListener('input',e=>{markSettingsEdit(e);
 if(e.target.classList.contains('desk-chips'))updateTiebreak();
 if(e.target.id==='gateValue')el('gateID').checked=false;
 if(e.target.id==='deskroll')deskFee();if(e.target.id==='find')filterRecords();if(e.target.id==='full'){
 const r=snapshot.records.find(a=>a.id===opened),v=val('full');el('matchTail').textContent=v.length===12&&r.suffix?(v.endsWith(r.suffix)?'The visible receipt digits match.':'The visible digits differ. Check the bank record.'):'';
}});document.addEventListener('change',e=>{
  markSettingsEdit(e);
  if(e.target.id==='filter')filterRecords();
  if(e.target.id==='gateMode')el('gateID').checked=false;
  if(e.target.id==='kind')deskFee();
  if(e.target.id==='paymentQr'){
    const file=e.target.files[0],preview=el('qrPreview');
    preview.hidden=!file;
    if(file){
      const url=URL.createObjectURL(file);
      preview.onload=preview.onerror=()=>URL.revokeObjectURL(url);preview.src=url;
      if(el('removeQr'))el('removeQr').checked=false;
    }
  }
});
async function openDesk(){
  try{await refresh()}catch(e){
    if(/sign in|staff role/i.test(e.message)){mem.set(sessionKey,'');token='';snapshot=null;login()}
    else if(!snapshot)el('content').innerHTML='<div class="narrow">'+panel('Event desk',btn('refresh','Retry opening desk','primary')+btn('logout','Sign out'))+'</div>';
    msg(e.message||'The desk could not load. Try again.',true);
  }
}
async function enterDesk(auth){
  token=auth.token;mem.set(sessionKey,token);mem.set(sessionKey+':code','');
  deskLoading();
  await openDesk();
}
function deskLoading(){
  heading('Staff access','Opening workspace');el('content').innerHTML=skeleton('Loading your staff workspace');
}
async function launch(){
  if(document.body.dataset.verifiedEntry==='yes'){
    deskLoading();
    try{
      const locationInfo=await new Promise(resolve=>google.script.url.getLocation(resolve));
      const ticket=new URLSearchParams(locationInfo.hash).get('ticket')||'';
      const auth=await api('completeDeskSignIn',invite,ticket);
      try{google.script.history.replace(null,{view:'staff',invite},'')}catch{}
      await enterDesk(auth);
    }catch(error){
      if(token){await openDesk();return}
      login();msg(error.message||'Send a new code to the club email to open the desk.',true);
    }
    return;
  }
  if(token){deskLoading();await openDesk();return}
  if(document.body.dataset.ownerLogin==='yes'){
    let saved;try{saved=JSON.parse(mem.get(sessionKey+':code')||'null')}catch{}
    if(saved?.expires>Date.now()){heading('STAFF ACCESS','Event desk');ownerCodePage(Math.max(0,(saved.resend-Date.now())/1000));return}
  }
  login();
}
addEventListener('online',()=>{el('net').textContent='';syncGate().catch(e=>msg(e.message,true))});
addEventListener('offline',()=>{el('net').textContent='Offline. Payment approvals and admission confirmations need a connection.'});
setInterval(async()=>{
  if(document.hidden||busy||el('dialog').open||!navigator.onLine||!token)return;
  try{
    if(qread().length)await syncGate();
    else await refresh(true);
  }catch{el('net').textContent='Connection interrupted. Showing the last update.'}
},15000);
launch();
