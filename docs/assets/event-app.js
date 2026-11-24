window.POKER_NIGHT_WEB_APP = 'https://script.google.com/macros/s/AKfycbzPn65IjbFTE6QL8uCKfiwOuMZvTfhthGgsrVs0yvSiLr4i25lCwA6UQNJN1Pcx9Xa96Q/exec';

;
'use strict';
const view=new URLSearchParams(location.search).get('view')||'register';
document.body.dataset.mode=['register','board','pass','scan'].includes(view)?view:'unavailable';
document.title=document.body.dataset.mode==='unavailable'?'Page unavailable · Poké Poker Night':view==='board'?'Live floor · Poké Poker Night':view==='pass'?'Entry pass · Poké Poker Night':view==='scan'?'Gate scanner · Poké Poker Night':'Registration · Poké Poker Night';
const fragment=new URLSearchParams(location.hash.slice(1));
const receipt=fragment.get('receipt')||'';
const incomingReceipt=/^[a-f0-9]{16}\.[A-Za-z0-9_-]{43}$/.test(receipt)?receipt:'';
if(view==='pass'){
  const code=fragment.get('code')||'';
  document.body.dataset.pass=code;
  try{
    if(code)sessionStorage.setItem('pn26:entry-pass',code);
    else document.body.dataset.pass=sessionStorage.getItem('pn26:entry-pass')||'';
  }catch{}
}
let scannerAccess='';
if(view==='scan'){
  scannerAccess=fragment.get('access')||'';
  try{
    if(scannerAccess)sessionStorage.setItem('pn26:camera-access',scannerAccess);
    else scannerAccess=sessionStorage.getItem('pn26:camera-access')||'';
  }catch{}
}
if(fragment.has('receipt')||fragment.has('code')||fragment.has('access'))history.replaceState(null,'',location.pathname+location.search);

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

;
'use strict';
const el=id=>document.getElementById(id);
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const val=id=>el(id)?.value.trim()||'';
const durable={get(k){try{return localStorage.getItem('pn26:'+k)||''}catch{return ''}},set(k,v){try{localStorage.setItem('pn26:'+k,v)}catch{}}};
let clockEnd=0,busy=false;
function msg(t='',bad=false){el('msg').textContent=t;el('msg').className='note'+(bad?' error':'')}
function btn(action,label,cls='',id=''){return '<button type="button" data-do="'+action+'" data-id="'+esc(id)+'" class="'+cls+'">'+esc(label)+'</button>'}
function input(id,label,extra=''){return '<label for="'+id+'">'+label+'</label><input id="'+id+'" '+extra+'>'}
function checkbox(id,t){return '<label class="check"><input type="checkbox" id="'+id+'">'+esc(t)+'</label>'}
function panel(t,body){return '<section class="panel"><h2>'+esc(t)+'</h2>'+body+'</section>'}
function rollField(id){return input(id,'College roll number','inputmode="numeric" pattern="[0-9]{9}" maxlength="9" autocomplete="off" placeholder="Nine-digit roll number"')}
function signInForm(action,body,label){
  return '<form data-action="'+action+'">'+body+'<button class="primary" type="submit">'+label+'</button></form>';
}
function codeInput(){
  return input('loginCode','Six-digit code','type="text" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" minlength="6" maxlength="6" required placeholder="000000"');
}
let resendTimer;
function startResendTimer(until){
  clearInterval(resendTimer);
  function update(){
    const button=document.querySelector('[data-do="resendCode"]');
    if(!button){clearInterval(resendTimer);return}
    const seconds=Math.max(0,Math.ceil((until-Date.now())/1000));
    button.disabled=seconds>0;
    button.textContent=seconds?'Resend in '+seconds+'s':'Resend code';
    if(!seconds)clearInterval(resendTimer);
  }
  resendTimer=setInterval(update,1000);update();
}
async function picture(file,forPaymentQr=false){
  if(!file||!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size>15*1024*1024)throw Error('Choose a JPEG, PNG or WebP image under 15 MB.');
  const url=URL.createObjectURL(file);
  try{
    const image=new Image();image.src=url;await image.decode();
    const limit=forPaymentQr?1100:1800,scale=Math.min(1,limit/Math.max(image.width,image.height));
    const canvas=document.createElement('canvas');
    canvas.width=Math.max(1,Math.round(image.width*scale));canvas.height=Math.max(1,Math.round(image.height*scale));
    const ctx=canvas.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(image,0,0,canvas.width,canvas.height);
    let data=forPaymentQr?canvas.toDataURL('image/png'):canvas.toDataURL('image/jpeg',.83);
    if(forPaymentQr&&data.length>720000)data=canvas.toDataURL('image/jpeg',.9);
    if(data.length>(forPaymentQr?720000:2400000))throw Error(forPaymentQr?'Crop the image around the payment QR and try again.':'Crop the payment receipt and upload a smaller image.');
    return data;
  }finally{URL.revokeObjectURL(url)}
}
function heading(k,t){el('kicker').textContent=k;el('title').textContent=t}
function ticketMatrix(code){const q=qrcode(0,'M');q.addData(code);q.make();return q}
function qr(code){return '<div class="qr">'+ticketMatrix(code).createImgTag(8,32,'Single-use entry QR')+'</div>'}
function localTime(t){return new Date(t).toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit',timeZone:'Asia/Kolkata'})}
function scanTime(t){return new Date(t).toLocaleString('en-IN',{day:'numeric',month:'short',hour:'numeric',minute:'2-digit',second:'2-digit',timeZone:'Asia/Kolkata'})+' IST'}
function seatLabel(seat){return 'Seat '+String(seat).padStart(2,'0')}
function seatLocation(wave,seat){return 'Wave '+wave+' · Table '+Math.ceil(seat/6)}
function skeleton(label){return '<div class="narrow skeleton" role="status"><span class="sr-only">'+esc(label)+'</span><i></i><i></i><i></i></div>'}
function gateResultHtml(result,nextButton){
  const valid=result.status==='admitted',used=result.status==='used';
  const title=valid?'Checked in':used?'Already used':'Invalid ticket';
  return '<section class="gate-result '+(valid?'accepted':'denied')+'" role="status"><div class="result-mark" aria-hidden="true">'+(valid?'✓':'×')+'</div>'+
    '<h2 id="scanResultTitle" tabindex="-1">'+title+'</h2>'+
    (valid||used?'<p class="gate-player">'+esc(result.player)+'</p><div class="seat-result"><strong>'+seatLabel(result.seat)+'</strong><span>'+seatLocation(result.wave,result.seat)+'</span></div>'+
      (used?'<p>First scan · '+esc(scanTime(result.checkedInAt))+'</p>':''):
      '<p>Ask the player to open their verified entry ticket.</p>')+nextButton+'</section>';
}
function fieldError(id,message){
  const field=el(id);if(!field)return;
  let error=el(id+'Error');
  if(!error){error=document.createElement('span');error.className='field-error';error.setAttribute('role','alert');error.id=id+'Error';(field.closest('label.check')||field).after(error)}
  error.textContent=message;field.setAttribute('aria-invalid','true');field.setAttribute('aria-describedby',error.id);field.focus();
}
document.addEventListener('input',e=>{
  const field=e.target;
  if(field.getAttribute('aria-invalid')==='true'){field.removeAttribute('aria-invalid');field.removeAttribute('aria-describedby');el(field.id+'Error')?.remove()}
});
document.addEventListener('invalid',e=>{
  const messages={identifier:'Enter your roll number or registered email.',loginCode:'Enter all six digits from your email.',matchRoll:'Enter your nine-digit roll number.',matchEmail:'Enter the email on your student record.'};
  if(messages[e.target.id]){e.preventDefault();fieldError(e.target.id,messages[e.target.id])}
},true);
function board(b){clockEnd=b.deadline;return '<div class="row"><div><p class="tag">'+esc(b.state)+'</p><h2>'+esc(b.title)+'</h2></div><div class="timer" id="clock"></div></div>'+(b.champion?'<p class="note">Winner · '+esc(b.champion)+'</p>':'')+
  (b.tables.length?'<div class="cols">'+b.tables.map(t=>panel(t.name,'<ol class="board-list">'+t.players.map((p,i)=>'<li'+(t.seats?.[i]?' value="'+t.seats[i]+'"':'')+'>'+esc(p)+'</li>').join('')+'</ol>')).join('')+'</div>':'<p class="sub">The floor manager will publish table assignments when seating starts.</p>')+
  (b.leaderboard.length?panel('Chip leaderboard','<ol>'+b.leaderboard.map(x=>'<li>'+esc(x.alias)+' · '+x.chips.toLocaleString('en-IN')+'</li>').join('')+'</ol>'):'');
}
function tick(){const c=el('clock');if(!c)return;const left=Math.max(0,Math.ceil((clockEnd-Date.now())/1000));c.textContent=clockEnd?Math.floor(left/60)+':'+String(left%60).padStart(2,'0'):'—'}
async function runAction(b,name){
  if(!b||busy)return;
  busy=true;b.disabled=true;b.setAttribute('aria-busy','true');msg();
  const label=b.textContent,progress={requestCode:'Sending code…',resendCode:'Sending…',matchMail:'Checking your details…',ownerCode:'Sending code…',verifyCode:'Verifying…',verifyOwner:'Verifying…',upload:'Submitting…',start:'Saving…',checkout:'Opening payment…',approve:'Saving approval…',save:'Saving…'};
  if(progress[name])b.textContent=progress[name];
  try{await action(name,b.dataset.id)}
  catch(err){msg(err.message||'Connection failed. Try again.',true);if(el('dialog')?.open){let n=el('detail').querySelector('[data-error]');if(!n){n=document.createElement('p');n.className='note error';n.dataset.error='1';el('detail').prepend(n)}n.textContent=err.message}}
  finally{busy=false;b.disabled=false;b.removeAttribute('aria-busy');if(progress[name]&&b.isConnected)b.textContent=label}
}
document.addEventListener('click',e=>{const b=e.target.closest('[data-do]');if(b)runAction(b,b.dataset.do)});
document.addEventListener('submit',e=>{
  const f=e.target.closest('form[data-action]');if(!f)return;
  e.preventDefault();runAction(f.querySelector('[type="submit"]'),f.dataset.action);
});
setInterval(tick,1000);

;
'use strict';
function scriptAsset(src){
  return new Promise((resolve,reject)=>{
    const script=document.createElement('script');script.onload=resolve;script.onerror=()=>{script.remove();reject(Error('Could not load this part of the ticket. Please try again.'))};
    script.src=src;document.head.append(script);
  });
}
function walletCard(r,player,standalone){
  const code=r.entryCode||r.code,used=!!r.checkedInAt;
  const wordmark=document.querySelector('.appbar .event-wordmark');
  const name=wordmark?'<img class="wallet-wordmark" src="'+esc(wordmark.getAttribute('src'))+'" width="360" height="126" alt="Poké Poker Night">':'Poké Poker Night';
  const header='<header class="wallet-head"><div><p class="wallet-issuer">E-Cell · IMT Ghaziabad</p><h2>'+name+'</h2></div><span class="suit" aria-hidden="true">♠</span></header>';
  const details='<dl class="wallet-facts"><div><dt>Event date</dt><dd>27 Nov 2026</dd></div><div><dt>Qualifier</dt><dd>Wave '+r.wave+'</dd></div></dl>';
  const title=used?(standalone?'Pass already scanned':'Checked in'):(standalone?'Show at the gate':'Payment verified');
  const passUrl=(document.body.dataset.host==='pages'?'event.html':'https://meherpraveen.github.io/imt-ecell-poker-night/event.html')+'?view=pass#code='+encodeURIComponent(code||'');
  const admission=used?'<strong class="wallet-seat">'+seatLabel(r.seat)+'</strong><p>'+seatLocation(r.wave,r.seat)+'</p><p class="sub">Checked in '+esc(scanTime(r.checkedInAt))+'</p>':
    '<div id="passImage" class="pass-image" aria-busy="true"></div><p class="ticket-code">'+esc(code)+'</p><p class="sub">Show this QR with your college ID.</p>';
  const action=used?'':standalone?'<a id="savePass" class="button primary wide" hidden>Save pass to phone</a>':
    '<a class="button primary wide" href="'+esc(passUrl)+'">Open phone pass</a>';
  return '<article class="wallet">'+header+details+'<div class="wallet-body"><h3>'+title+'</h3>'+
    (player?'<p class="wallet-player">'+esc(player)+'</p>':'')+admission+action+'</div></article>';
}
function passPng(code,wave){
  const canvas=document.createElement('canvas');canvas.width=720;canvas.height=980;
  const ctx=canvas.getContext('2d');
  ctx.fillStyle='#ffffff';ctx.fillRect(0,0,720,980);
  const theme=getComputedStyle(document.documentElement);
  ctx.fillStyle=theme.getPropertyValue('--navy').trim();ctx.fillRect(0,0,720,214);
  ctx.fillStyle=theme.getPropertyValue('--poke-red').trim();ctx.fillRect(0,0,720,9);
  ctx.fillStyle='#d2e0f4';ctx.font='28px system-ui';ctx.fillText('E-Cell · IMT Ghaziabad',48,62);
  const wordmark=document.querySelector('.appbar .event-wordmark');
  if(wordmark?.complete&&wordmark.naturalWidth)ctx.drawImage(wordmark,48,80,320,112);
  else {ctx.fillStyle=theme.getPropertyValue('--poke-yellow').trim();ctx.font='bold 55px system-ui';ctx.fillText('Poké Poker Night',48,160)}
  ctx.fillStyle='#162b48';ctx.font='bold 32px system-ui';ctx.fillText('27 Nov 2026',48,285);
  ctx.textAlign='right';ctx.fillText('Wave '+wave,672,285);
  ctx.strokeStyle='#a4b4c9';ctx.setLineDash([8,8]);ctx.beginPath();ctx.moveTo(0,335);ctx.lineTo(720,335);ctx.stroke();
  const matrix=ticketMatrix(code),count=matrix.getModuleCount(),cell=Math.floor(492/(count+8));
  const left=Math.floor((canvas.width-count*cell)/2),top=370+4*cell;
  ctx.fillStyle='#000000';
  for(let row=0;row<count;row++)for(let col=0;col<count;col++)if(matrix.isDark(row,col))ctx.fillRect(left+col*cell,top+row*cell,cell,cell);
  ctx.textAlign='center';ctx.fillStyle='#162b48';ctx.font='bold 33px monospace';ctx.fillText(code,360,862);
  ctx.fillStyle='#4e5f77';ctx.font='26px system-ui';ctx.fillText('Show this pass with your college ID.',360,924);
  return canvas.toDataURL('image/png');
}
async function fillTicketQr(code,wave){
  const slot=el('passImage');if(!slot)return;
  try{
    if(typeof qrcode!=='function'){
      qrLibrary=qrLibrary||scriptAsset('assets/qrcode-1.4.4.js').catch(error=>{qrLibrary=null;throw error});
      await qrLibrary;
    }
    if(!slot.isConnected)return;
    slot.innerHTML=qr(code);
    const save=el('savePass');
    if(save){save.href=passPng(code,wave);save.download='Poke-Poker-Night-Wave-'+wave+'.png';save.hidden=false}
  }catch{if(slot.isConnected)slot.textContent='Show the entry code below at the gate.'}
  finally{slot.removeAttribute('aria-busy')}
}
function drawPass(pass){
  currentPass=pass;
  el('content').innerHTML='<div class="narrow">'+(pass.active||pass.used?walletCard(pass,'',true):panel('Attempt closed','<p>This pass has closed. Speak to the event desk.</p>'))+'</div>';
  if(pass.active)fillTicketQr(pass.code,pass.wave);
  scheduleTicketUpdate();
}
function scheduleTicketUpdate(){
  clearTimeout(ticketTimer);
  if(document.hidden||!navigator.onLine)return;
  const paid=currentReceipt?.entryCode||currentPass?.active;
  const waiting=['REGISTERED','REVIEW','WAITLIST'].includes(currentReceipt?.status);
  if(paid||waiting)ticketTimer=setTimeout(updateTicket,paid?6000:18000);
}
let ticketUpdating=false;
async function updateTicket(){
  if(ticketUpdating||document.hidden||!navigator.onLine)return;
  if(busy){scheduleTicketUpdate();return}
  ticketUpdating=true;
  try{
    if(currentPass?.active||currentReceipt?.entryCode){
      const before=currentReceipt,code=mode==='pass'?document.body.dataset.pass:before.entryCode;
      const next=await api('passInfo',code);
      if(next.used||!next.active){
        if(mode==='pass')drawPass(next);
        else if(currentReceipt===before)showReceipt({...before,entryCode:'',seat:next.seat,checkedInAt:next.checkedInAt});
        if(next.seat&&(mode==='pass'||playerSession))el('ticketAnnouncement').textContent='Checked in. '+seatLabel(next.seat)+'. '+seatLocation(next.wave,next.seat);
      }
    }else if(currentReceipt&&['REGISTERED','REVIEW','WAITLIST'].includes(currentReceipt.status)){
      const before=currentReceipt,next=await playerApi('playerStatus',before.ticket);
      if(currentReceipt===before&&(before.status!==next.status||before.canCheckout!==next.canCheckout||before.checkoutEnded!==next.checkoutEnded)){
        showReceipt(next);
        el('ticketAnnouncement').textContent=next.entryCode?'Payment verified. Your ticket is ready.':'Your registration status has changed.';
      }
    }
    el('net').textContent='';
  }catch{el('net').textContent='Connection interrupted. Reconnecting for ticket updates.'}
  finally{ticketUpdating=false;scheduleTicketUpdate()}
}
function expireCheckout(){
  if(currentReceipt?.status==='HOLD'&&eventNow()>=currentReceipt.expires){
    showReceipt({...currentReceipt,status:'EXPIRED',upi:'',paymentQr:''});return true;
  }
  return false;
}

'use strict';
const mode=document.body.dataset.mode;
function tabValue(key,value){
  try{
    if(value===undefined)return sessionStorage.getItem('pn26:'+key)||'';
    if(value)sessionStorage.setItem('pn26:'+key,value);else sessionStorage.removeItem('pn26:'+key);
  }catch{}
  return '';
}
function unpack(value){try{return JSON.parse(value)}catch{return null}}
let playerSession=unpack(tabValue('player-login')||durable.get('player-login'));
let challenge=unpack(tabValue('email-step')), pendingRequest=tabValue('seat-request'), accountInfo;
let preferredReceipt=incomingReceipt||tabValue('receipt-link')||'';
let currentReceipt=null,currentPass=null,ticketTimer,qrLibrary;
if(incomingReceipt)tabValue('receipt-link',incomingReceipt);
function signInPage(keepForm=false){
  challenge=null;tabValue('email-step','');heading('','Event registration');
  if(keepForm&&el('identifier')&&document.documentElement.dataset.entry==='register')return;
  const entry=signInForm('requestCode','<p>Use your roll number or account email to receive a six-digit code.</p>'+
    input('identifier','Roll number or registered email','type="text" autocomplete="username" autocapitalize="none" spellcheck="false" maxlength="254" required placeholder="Nine-digit roll number or email"'),'Send code');
  el('content').innerHTML='<div class="narrow login-card">'+panel('Email sign-in','<div data-entry-price class="offer"></div>'+entry)+'</div>';
  updatePrices();
}
function codePage(){
  heading('','Check your email');
  const mailbox=/^\d{9}$/.test(challenge.identifier)?'the email on your student record':'<strong>'+esc(challenge.identifier)+'</strong>';
  const form=signInForm('verifyCode','<p>Check '+mailbox+' for a six-digit code from <strong>Poké Poker Night 2026</strong>. Enter it here within 10 minutes.</p>'+
    '<p class="mail-folder"><a href="https://outlook.office.com/mail/junkemail" target="_blank" rel="noopener noreferrer">Open Outlook Junk Email</a> if the code is missing from your inbox. In Gmail, check Spam. You can use the code straight from either folder.</p>'+
    codeInput()+checkbox('remember','Remember my student sign-in for 7 days'),'Verify and continue');
  const help='<details><summary>Email hasn’t arrived?</summary><p>Check that your roll number matches the email on your student record. A resend keeps the same active code.</p>'+
    signInForm('matchMail',rollField('matchRoll')+input('matchEmail','Email on your student record','type="email" autocomplete="email" required maxlength="254"'),'Check details and send code')+'</details>';
  el('content').innerHTML='<div class="narrow login-card">'+panel('Enter your sign-in code',form+btn('resendCode','Resend code')+btn('changeLogin','Change roll number or email')+help)+'</div>';
  if(/^\d{9}$/.test(challenge.identifier))el('matchRoll').value=challenge.identifier;else el('matchEmail').value=challenge.identifier;
  startResendTimer(challenge.resendAt);el('loginCode').focus();
}
function clearPlayer(){
  clearTimeout(ticketTimer);currentReceipt=null;
  playerSession=null;challenge=null;pendingRequest='';preferredReceipt='';accountInfo=null;
  for(const key of ['player-login','seat-request','email-step','receipt-link'])tabValue(key,'');
  for(const key of ['player-login','receipt','pending-seat'])durable.set(key,'');
}
async function playerApi(method,...args){
  try{const result=await api(method,playerSession?.token||'',...args);if(result?.offer)syncOffer(result.offer);return result}
  catch(e){if(String(e.message).includes('Sign in with your registered email')){clearPlayer();signInPage()}throw e}
}
function progress(step){
  return '<ol class="progress" aria-label="Registration progress">'+['Details','Pay','Ticket'].map((label,i)=>
    '<li class="'+(i<step?'done':'')+'"'+(i===step?' aria-current="step"':'')+'><span aria-hidden="true">'+(i<step?'✓':i+1)+'</span>'+label+'</li>').join('')+'</ol>';
}
function accountScreen(step,body){
  el('content').innerHTML='<div class="narrow">'+progress(step)+body+'<div class="account-actions">'+btn('logout','Sign out','quiet')+'</div></div>';
  updatePrices();
  if(busy){const title=el('title');title.tabIndex=-1;title.focus({preventScroll:true});title.scrollIntoView({block:'nearest'})}
}
function registrationPage(){
  currentReceipt=null;clearTimeout(ticketTimer);heading('Poké Poker Night','Your registration');
  const info=accountInfo,person=info.player||{};
  const details='<dl class="details-list"><div><dt>Player</dt><dd>'+esc(person.name||'Registered student')+'</dd></div><div><dt>Roll number</dt><dd>'+esc(person.roll)+'</dd></div></dl>';
  const next=info.paymentsReady?'Continue to payment to hold your place in a qualifier wave.':'Save your details now. You can pay here when E-Cell opens checkout.';
  accountScreen(0,panel(info.open?'Entry details':'Registration closed',details+(info.open?
    '<div data-entry-price class="offer"></div><p class="sub">'+next+'</p>'+btn('start',info.paymentsReady?'Request a seat':'Save my registration','primary wide'):
    '<p>'+esc(info.message)+'</p>')));
}
async function loadAccount(){
  renderAccount(await playerApi('playerHome',preferredReceipt||''));
}
function renderAccount(info){
  accountInfo=info;syncOffer(info.offer);
  tabValue('receipt-link','');
  if(accountInfo.receipt)showReceipt(accountInfo.receipt);else{preferredReceipt='';durable.set('receipt','');registrationPage()}
}
function showReceipt(r){
  currentReceipt=r;preferredReceipt=r.ticket;durable.set('receipt',r.ticket);
  const ticket=!!(r.entryCode||r.checkedInAt);
  heading('Poké Poker Night',ticket?'Your ticket':'Your registration');
  let body='';
  if(r.status==='REGISTERED'){
    const next=r.checkoutEnded?'Online checkout has ended. Contact E-Cell if you already paid.':r.canCheckout?'Payment is open. Continue to hold your place and see where to pay.':'Your details are saved. Return here when E-Cell opens payment.';
    body=panel('Registration saved','<p>'+next+'</p>'+(r.checkoutEnded?'':'<div data-entry-price class="offer"></div>')+
      (r.checkoutEnded?'':r.canCheckout?btn('checkout','Continue to payment','primary wide'):btn('receipt','Check payment availability','primary wide'))+
      btn('copyReceipt','Copy private receipt link','quiet')+'<div id="copyReceiptFallback"></div>');
  }else if(r.status==='HOLD'){
    let instructions='<div data-entry-price class="offer"></div><p class="hold-line">Wave '+r.wave+' · Pay and submit before <strong>'+localTime(r.expires)+' IST</strong></p>';
    if(r.upi||r.paymentQr){
      instructions+='<p>Pay <strong>'+esc(r.name)+'</strong> using UPI.</p>';
      if(r.upi){
        const params=new URLSearchParams({pa:r.upi,pn:r.name,am:Number(r.fee).toFixed(2),cu:r.offer?.currency||ENTRY_PRICING.currency,tn:'Poké Poker Night '+r.id});
        instructions+='<p><code>'+esc(r.upi)+'</code></p><a class="button" data-payment-link target="_blank" rel="noopener" href="upi://pay?'+esc(params.toString().replace(/\+/g,'%20'))+'">Open UPI app</a>';
      }
      if(r.paymentQr){
        const fileName=r.paymentQr.startsWith('data:image/png;')?'payment-qr.png':'payment-qr.jpg';
        instructions+='<figure class="payment-qr"><img alt="Coordinator’s UPI payment QR" src="'+esc(r.paymentQr)+'"><figcaption>Scan in your UPI app or <a download="'+fileName+'" href="'+esc(r.paymentQr)+'">save the QR image</a>.</figcaption></figure>';
      }
      body+=panel('Pay '+formatFee_(r.fee),instructions);
    }else body+=panel('Payments paused',instructions+'<p>If you already paid, upload your proof below.</p>'+btn('receipt','Refresh payment details'));
    body+=panel('Upload payment proof','<form data-action="upload" novalidate><label for="shot">Payment screenshot</label><input id="shot" type="file" accept="image/jpeg,image/png,image/webp">'+input('tail','Visible final digits of the UPI reference (optional)','inputmode="numeric" maxlength="12" placeholder="Last 4–12 digits"')+'<p class="sub">Keep the amount, recipient and reference visible.</p>'+checkbox('consent','I agree to share this proof with the E-Cell payment desk for verification.')+'<button class="primary wide" type="submit">Submit for review</button></form>');
  }else if(ticket){
    body=walletCard(r,accountInfo?.player?.name,false);
  }else{
    const labels={REVIEW:['Payment under review','The desk will check the coordinator’s incoming payment. Keep this page. Please pay only once.'],WAITLIST:['On the waitlist','All available seats are held. Wait for a seat offer here before paying.'],EXPIRED:['Hold expired','If you paid, bring your bank reference to the desk before making another payment.'],REJECTED:['Proof needs attention',r.reason||'Contact the desk with your receipt.'],NO_SHOW:['No-show recorded','Speak to the desk if you are at the venue.'],RELEASED:['Offer released','Speak to the desk for your current attempt.']};
    const [title,bodyText]=labels[r.status]||['Entry closed','This qualifier is closed. Speak to the event desk about your ticket.'];
    const renew=['EXPIRED','RELEASED','REJECTED'].includes(r.status)&&accountInfo?.open;
    body+=panel(title,'<p>'+esc(bodyText)+'</p>'+(r.wave?'<p class="sub">Round 1 · Wave '+r.wave+'</p>':'')+
      (renew?btn('renew','Request another seat','primary wide'):btn('receipt','Refresh status','primary wide')));
  }
  accountScreen(ticket||['PAID','NO_SHOW','QUALIFIED','ELIMINATED','WINNER'].includes(r.status)?2:1,body);
  if(r.entryCode)fillTicketQr(r.entryCode,r.wave);
  scheduleTicketUpdate();
  if(document.body.dataset.host!=='pages'){
    const link=document.createElement('a');
    link.href='https://meherpraveen.github.io/imt-ecell-poker-night/event.html?view=register#receipt='+encodeURIComponent(r.ticket);
    link.rel='noreferrer';
    link.textContent='Open this receipt on the event site';
    el('content').querySelector('.narrow').append(link);
  }
}
async function action(name){
  if(mode==='scan')return name==='reloadScanner'?launch():scannerAction(name);
  if(name==='reloadPass'){await renderPass();return}
  if(name==='changeLogin'){signInPage();el('identifier').focus();return}
  if(name==='requestCode'||name==='resendCode'||name==='matchMail'){
    const identifier=name==='resendCode'?challenge.identifier:name==='matchMail'?val('matchRoll'):val('identifier');
    if(!/^\d{9}$/.test(identifier)&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(identifier)){
      const message='Enter your nine-digit roll number or your registered email address.';
      fieldError(name==='matchMail'?'matchRoll':'identifier',message);return;
    }
    const reply=name==='matchMail'?await api('requestMatchedPlayerCode',identifier,val('matchEmail')):await api('requestEventCode',identifier);
    challenge={identifier,resendAt:Date.now()+reply.resendAfter*1000,expires:Date.now()+(reply.expiresIn??600)*1000};
    tabValue('email-step',JSON.stringify(challenge));codePage();
    if(name==='matchMail')msg(reply.delivery==='accepted'?'Your details match. Google accepted the email for delivery.':reply.delivery==='existing'?'Your details match. Your existing email code is still active.':'Your details match. A send is already in progress.');
    return;
  }
  if(name==='verifyCode'){
    const remember=el('remember').checked;
    let signed;
    try{signed=await api('signInEvent',challenge.identifier,val('loginCode'),preferredReceipt||'')}
    catch(e){if(/incorrect or has expired/.test(e.message)){fieldError('loginCode',e.message);return}throw e}
    if(signed.continueUrl){
      const next=new URL(signed.continueUrl);
      if(next.origin!=='https://script.google.com' || !next.pathname.endsWith('/exec') ||
        (window.POKER_NIGHT_WEB_APP && next.origin+next.pathname!==window.POKER_NIGHT_WEB_APP))throw Error('Open the private desk link from the club Sheet.');
      clearPlayer();heading('EVENT ACCESS','Opening your admin desk');
      el('content').innerHTML='<div class="narrow">'+panel('Club account verified','<a href="'+esc(next.href)+'" target="_top" rel="noreferrer">Open admin desk</a>')+'</div>';
      if(window===window.top)location.replace(next.href);
      return;
    }
    playerSession=signed.session;
    durable.set('player-login','');tabValue('player-login','');
    (remember?durable.set:tabValue)('player-login',JSON.stringify(playerSession));
    tabValue('email-step','');challenge=null;
    if(signed.account){renderAccount(signed.account);return}
    heading('PLAYER REGISTRATION','Signed in');
    el('content').innerHTML='<div class="narrow">'+panel('Your account',btn('account','Open registration','primary')+btn('logout','Sign out'))+'</div>';
    msg('Your sign-in was saved. Open registration to retry loading your receipt.');return;
  }
  if(name==='account'){await loadAccount();return}
  if(name==='refreshBoard'){await refreshBoard();return}
  if(name==='logout'){const token=playerSession?.token;clearPlayer();signInPage();if(token)await api('playerLogout',token);return}
  if(name==='renew'){preferredReceipt='';pendingRequest='';tabValue('seat-request','');durable.set('receipt','');registrationPage();return}
  if(name==='start'){
    if(!pendingRequest){pendingRequest=globalThis.crypto?.randomUUID?.()||'';tabValue('seat-request',pendingRequest)}
    showReceipt(await playerApi('playerStart',preferredReceipt||'',pendingRequest));
    pendingRequest='';tabValue('seat-request','');return;
  }
  if(name==='receipt'){showReceipt(await playerApi('playerStatus',preferredReceipt));return}
  if(name==='checkout'){showReceipt(await playerApi('playerCheckout',preferredReceipt));return}
  if(name==='copyReceipt'){
    const ticket=preferredReceipt;
    if(!ticket)throw Error('Open your saved receipt first.');
    const url='https://meherpraveen.github.io/imt-ecell-poker-night/event.html?view=register#receipt='+encodeURIComponent(ticket);
    try{await navigator.clipboard.writeText(url);msg('Private receipt link copied. Keep it for your payment.')}
    catch{el('copyReceiptFallback').innerHTML=input('receiptUrl','Copy your private receipt link','readonly value="'+esc(url)+'"');el('receiptUrl').select()}
    return;
  }
  if(name==='upload'){
    if(expireCheckout())return;
    const file=el('shot').files[0],tail=val('tail');
    if(!file){fieldError('shot','Choose a screenshot of your payment.');return}
    if(tail&&!/^\d{4,12}$/.test(tail)){fieldError('tail','Enter the last 4–12 digits, or leave this blank.');return}
    if(!el('consent').checked){fieldError('consent','Confirm that the desk may review your screenshot.');return}
    let data;try{data=await picture(file)}catch(e){fieldError('shot',e.message);return}
    if(!expireCheckout())showReceipt(await playerApi('playerUpload',preferredReceipt,tail,data));
  }
}
let boardRequest,boardFingerprint='',boardTimer;
function paintBoard(data,received){
  const {now,...display}=data,fingerprint=JSON.stringify(display);
  if(fingerprint!==boardFingerprint){el('content').innerHTML=board(data);boardFingerprint=fingerprint}
  clockEnd=data.deadline?received+(data.deadline-now):0;tick();
}
function updateBoardLater(){
  clearTimeout(boardTimer);
  if(!document.hidden&&navigator.onLine)boardTimer=setTimeout(refreshBoard,15000);
}
function refreshBoard(){
  if(boardRequest)return boardRequest;
  clearTimeout(boardTimer);
  boardRequest=(async()=>{
    try{
      const data=await api('liveFloor'),received=Date.now();
      paintBoard(data,received);tabValue('floor-snapshot',JSON.stringify({data,received}));el('net').textContent='';
    }catch{
      el('net').textContent=boardFingerprint?'Connection interrupted. Showing the last update.':'The floor could not load. Check your connection.';
      if(!boardFingerprint)el('content').innerHTML=btn('refreshBoard','Retry live floor');
    }finally{boardRequest=null;updateBoardLater()}
  })();
  return boardRequest;
}
async function renderPass(){
  heading('Poké Poker Night','Your entry pass');
  const code=document.body.dataset.pass;
  if(!/^PN-[A-Z0-9]{16}$/.test(code||'')){el('content').replaceChildren();throw Error('Open the complete pass link from your email or registration.')}
  el('content').innerHTML=skeleton('Opening your ticket');
  try{drawPass(await api('passInfo',code))}
  catch(e){el('content').innerHTML=btn('reloadPass','Retry opening pass');throw e}
}
async function launch(){try{
  if(mode==='unavailable'){
    heading('Poké Poker Night','Page unavailable');
    const home=document.querySelector('.appbar .brand').href;
    el('content').innerHTML='<a class="button primary" href="'+esc(home)+'">Return to event home</a>';return;
  }
  if(mode==='scan'){
    heading('Poké Poker Night','Gate scanner');
    if(!/^[\w-]{43}\.[\w-]{43}$/.test(scannerAccess)){el('content').innerHTML=panel('Staff sign-in required','<p>Open the camera from your signed-in gate desk.</p>');return}
    el('content').innerHTML=skeleton('Opening the gate scanner');
    try{await scriptAsset('assets/gate-camera.js?v=84739536d91f');launchScanner()}
    catch(e){el('content').innerHTML=panel('Scanner unavailable',btn('reloadScanner','Retry opening scanner','primary'));throw e}
    return;
  }
  if(mode==='board'){
    heading('LIVE FLOOR','Tournament floor');
    const cached=unpack(tabValue('floor-snapshot'));
    if(cached?.data&&Date.now()-cached.received<120000){paintBoard(cached.data,cached.received);el('net').textContent='Updating the live floor…'}
    await refreshBoard();return;
  }
  if(mode==='pass'){await renderPass();return}
  if(playerSession?.expires>Date.now()){
    heading('PLAYER REGISTRATION','Your registration');
    el('content').innerHTML=skeleton('Opening your registration');
    try{await loadAccount()}catch(e){if(playerSession)el('content').innerHTML='<div class="narrow">'+panel('Your account',btn('account','Open registration','primary')+btn('logout','Sign out'))+'</div>';throw e}return;
  }
  if(challenge?.expires>Date.now()){codePage();return}
  signInPage(true);
  if(window.pendingPokerSignIn){window.pendingPokerSignIn=false;el('identifier').form.requestSubmit()}
}catch(e){msg(e.message||'The club desk is temporarily unavailable.',true)}}
addEventListener('online',()=>{el('net').textContent='';if(mode==='board')refreshBoard()});
addEventListener('offline',()=>{el('net').textContent='Offline. Reconnect for updates.'});
if(mode==='board')document.addEventListener('visibilitychange',()=>{if(document.hidden)clearTimeout(boardTimer);else if(navigator.onLine)refreshBoard()});
if(mode==='register'||mode==='pass'){
  setInterval(expireCheckout,1000);
  document.addEventListener('click',e=>{if(e.target.closest('[data-payment-link]')&&expireCheckout())e.preventDefault()},true);
  document.addEventListener('visibilitychange',()=>{if(document.hidden)clearTimeout(ticketTimer);else{expireCheckout();updateTicket()}});
  addEventListener('online',updateTicket);
  addEventListener('pageshow',()=>{expireCheckout();if(currentPass||currentReceipt)updateTicket()});
}
window.pokerReady=true;
launch();
