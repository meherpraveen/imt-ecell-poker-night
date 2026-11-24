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
    try{await scriptAsset('assets/gate-camera.js?v=__SCANNER_VERSION__');launchScanner()}
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
