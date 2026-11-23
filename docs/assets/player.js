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
if(incomingReceipt)tabValue('receipt-link',incomingReceipt);
function signInPage(){
  challenge=null;tabValue('email-step','');heading('PLAYER REGISTRATION','Sign in to Poker Night');
  const entry=signInForm('requestCode','<p>We’ll send a six-digit code to the email on your student record.</p>'+
    input('identifier','Roll number or registered email','type="text" autocomplete="username" autocapitalize="none" spellcheck="false" maxlength="254" required placeholder="Nine-digit roll number or email"'),'Send code');
  el('content').innerHTML='<div class="narrow login-card">'+panel('Student sign-in',entry)+'</div>';
}
function codePage(){
  heading('PLAYER REGISTRATION','Check your email');
  const form=signInForm('verifyCode','<p>If your details match the student record, your code will arrive in that inbox. Use the latest code within 10 minutes.</p>'+
    codeInput()+checkbox('remember','Remember this device for 7 days'),'Verify and continue');
  el('content').innerHTML='<div class="narrow login-card">'+panel('Enter your sign-in code',form+btn('resendCode','Resend code')+btn('changeLogin','Change roll number or email')+
    '<p class="sub">Check Spam if the email hasn’t arrived. E-Cell can help if your registered address has changed.</p>')+'</div>';
  startResendTimer(challenge.resendAt);el('loginCode').focus();
}
function clearPlayer(){
  playerSession=null;challenge=null;pendingRequest='';preferredReceipt='';accountInfo=null;
  for(const key of ['player-login','seat-request','email-step','receipt-link'])tabValue(key,'');
  for(const key of ['player-login','receipt','pending-seat'])durable.set(key,'');
}
async function playerApi(method,...args){
  try{return await api(method,playerSession?.token||'',...args)}
  catch(e){if(String(e.message).includes('Sign in with your registered email')){clearPlayer();signInPage()}throw e}
}
function registrationPage(){
  heading('PLAYER REGISTRATION','Your registration');
  const info=accountInfo;
  const title=info.open?'Register for ₹'+info.fee:'Registration closed';
  const next=info.open?(info.paymentsReady?'Request a seat to see the available wave and payment instructions.':'Save your registration now. You can return here to pay when E-Cell publishes the payment details.'):(info.message||'Contact E-Cell for help with registration.');
  el('content').innerHTML='<div class="narrow">'+panel(title,'<p>'+esc(next)+'</p>'+(info.open?btn('start',info.paymentsReady?'Request a seat':'Save my registration','primary'):''))+btn('logout','Sign out')+'</div>';
}
async function loadAccount(){
  accountInfo=await playerApi('playerHome',preferredReceipt||'');
  tabValue('receipt-link','');
  if(accountInfo.receipt)showReceipt(accountInfo.receipt);else{preferredReceipt='';durable.set('receipt','');registrationPage()}
}
function showReceipt(r){
  preferredReceipt=r.ticket;durable.set('receipt',r.ticket);heading('PLAYER REGISTRATION','Your registration');
  let body='<p class="tag">ATTEMPT '+esc(r.id.toUpperCase())+'</p>';
  if(r.status==='REGISTERED'){
    const next=r.checkoutEnded?'Online checkout has ended. Contact E-Cell if you already paid.':r.canCheckout?'Payment is available. Continue to start a 15-minute seat hold.':'Keep this receipt. Return here for payment instructions when E-Cell publishes them.';
    body+=panel('Registration saved','<p>Your entry fee is <b>₹'+r.fee+'</b>. E-Cell confirms your seat after verifying payment.</p><p>'+next+'</p>'+
      (r.checkoutEnded?'':r.canCheckout?btn('checkout','Continue to payment','primary'):btn('receipt','Check payment availability'))+
      btn('copyReceipt','Copy private receipt link')+'<div id="copyReceiptFallback"></div>');
  }else if(r.status==='HOLD'){
    let instructions='<p>Round 1 · Wave '+r.wave+' · Hold until <b>'+localTime(r.expires)+' IST</b></p>';
    if(r.upi||r.paymentQr){
      instructions+='<p>Confirm the recipient <b>'+esc(r.name)+'</b> in your UPI app and pay exactly ₹'+r.fee+'.</p>';
      if(r.upi){
        const params=new URLSearchParams({pa:r.upi,pn:r.name,am:r.fee+'.00',cu:'INR',tn:'Poker Night '+r.id});
        instructions+='<p><code>'+esc(r.upi)+'</code></p><a class="button primary" target="_blank" rel="noopener" href="upi://pay?'+esc(params.toString().replace(/\+/g,'%20'))+'">Open UPI app</a>';
      }
      if(r.paymentQr){
        const fileName=r.paymentQr.startsWith('data:image/png;')?'payment-qr.png':'payment-qr.jpg';
        instructions+='<figure class="payment-qr"><img alt="Coordinator’s UPI payment QR" src="'+esc(r.paymentQr)+'"><figcaption>Scan in your UPI app or <a download="'+fileName+'" href="'+esc(r.paymentQr)+'">save the QR image</a>.</figcaption></figure>';
      }
      body+=panel('Pay ₹'+r.fee,instructions);
    }else body+=panel('Payments paused',instructions+'<p>If you already paid, upload your proof below.</p>'+btn('receipt','Refresh payment details'));
    body+=panel('Upload payment proof','<label for="shot">Payment screenshot</label><input id="shot" type="file" accept="image/jpeg,image/png,image/webp">'+input('tail','Visible final digits of the UPI reference (optional)','inputmode="numeric" maxlength="12" placeholder="Last 4–12 visible digits"')+'<p class="sub">Keep the amount, recipient and reference visible. You may crop your balance and unrelated transactions.</p>'+checkbox('consent','I agree to share this proof with the E-Cell payment desk for verification.')+btn('upload','Submit for review','primary'));
  }else{
    const labels={REVIEW:['Payment under review','The desk will check the coordinator’s incoming payment. Keep this page. Please pay only once.'],WAITLIST:['On the waitlist','All available seats are held. Wait for a seat offer here before paying.'],EXPIRED:['Hold expired','If you paid, bring your bank reference to the desk before making another payment.'],REJECTED:['Proof needs attention',r.reason||'Contact the desk with your receipt.'],NO_SHOW:['No-show recorded','Speak to the desk if you are at the venue.'],RELEASED:['Offer released','Speak to the desk for your current attempt.']};
    const [title,bodyText]=labels[r.status]||['Payment verified',r.delivery==='Email sent'?'Your entry code was emailed to your registered address. Bring your college ID.':'The desk can deliver your code using your registered contact or college ID.'];
    body+=panel(title,'<p>'+esc(bodyText)+'</p>'+(r.wave?'<p>Round 1 · Wave '+r.wave+'</p>':'')+
      (r.entryCode?'<p>Show this entry code with your college ID at the gate.</p><p><code>'+esc(r.entryCode)+'</code></p>':'')+btn('receipt','Refresh status'));
    if(['EXPIRED','RELEASED','REJECTED'].includes(r.status)&&accountInfo?.open)body+=btn('renew','Request another seat');
  }
  el('content').innerHTML='<div class="narrow">'+body+btn('logout','Sign out')+'</div>';
  if(document.body.dataset.host!=='pages'){
    const link=document.createElement('a');
    link.href='https://meherpraveen.github.io/imt-ecell-poker-night/event.html?view=register#receipt='+encodeURIComponent(r.ticket);
    link.rel='noreferrer';
    link.textContent='Open this receipt on the event site';
    el('content').querySelector('.narrow').append(link);
  }
}
async function action(name){
  if(name==='changeLogin'){signInPage();el('identifier').focus();return}
  if(name==='requestCode'||name==='resendCode'){
    const identifier=name==='resendCode'?challenge.identifier:val('identifier');
    if(!/^\d{9}$/.test(identifier)&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(identifier))throw Error('Enter your nine-digit roll number or your registered email address.');
    const reply=await api('requestPlayerCode',identifier);
    challenge={identifier,resendAt:Date.now()+reply.resendAfter*1000,expires:Date.now()+600000};
    tabValue('email-step',JSON.stringify(challenge));codePage();return;
  }
  if(name==='verifyCode'){
    const remember=el('remember').checked;
    playerSession=await api('verifyPlayerCode',challenge.identifier,val('loginCode'));
    (remember?durable.set:tabValue)('player-login',JSON.stringify(playerSession));
    tabValue('email-step','');challenge=null;
    heading('PLAYER REGISTRATION','Signed in');
    el('content').innerHTML='<div class="narrow">'+panel('Your account',btn('account','Open registration','primary')+btn('logout','Sign out'))+'</div>';
    await loadAccount();return;
  }
  if(name==='account'){await loadAccount();return}
  if(name==='logout'){const token=playerSession?.token;clearPlayer();signInPage();if(token)await api('playerLogout',token);return}
  if(name==='renew'){preferredReceipt='';durable.set('receipt','');registrationPage();return}
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
  if(name==='upload'){if(!el('consent').checked)throw Error('Please confirm proof sharing before continuing.');const data=await picture(el('shot').files[0]);showReceipt(await playerApi('playerUpload',preferredReceipt,val('tail'),data));return}
}
async function launch(){try{
  if(mode==='unavailable'){heading('POKER NIGHT','Page unavailable');el('content').replaceChildren();return}
  if(mode==='board'){heading('LIVE FLOOR','Tournament floor');el('content').innerHTML=board(await api('liveFloor'));tick();return}
  if(mode==='pass'){heading('TRAINER PASS','Your entry pass');const code=document.body.dataset.pass;if(!/^PN-[A-Z0-9]{16}$/.test(code))throw Error('Open the complete pass link from your email.');const pass=await api('passInfo',code);el('content').innerHTML='<div class="narrow">'+panel(pass.used?'Pass already scanned':pass.active?'Show at the gate':'Attempt closed',(pass.active&&!pass.used?qr(pass.code)+'<p><code>'+esc(pass.code)+'</code></p>':'')+'<p>Round 1 · Wave '+pass.wave+'. Bring your college ID. Use your wristband for a venue return.</p>')+'</div>';return}
  if(playerSession?.expires>Date.now()){
    heading('PLAYER REGISTRATION','Your account');el('content').innerHTML='<div class="narrow">'+panel('Registration',btn('account','Open registration','primary')+btn('logout','Sign out'))+'</div>';
    await loadAccount();return;
  }
  if(challenge?.expires>Date.now()){codePage();return}
  signInPage();
  const p=await api('publicInfo');
  if(el('identifier')&&!p.open)msg(p.message||'Online registration is currently closed.');
}catch(e){msg(e.message||'The club desk is temporarily unavailable.',true)}}
addEventListener('online',()=>{el('net').textContent=''});
addEventListener('offline',()=>{el('net').textContent='Offline. Reconnect for updates.'});
if(mode==='board')setInterval(async()=>{
  if(document.hidden||!navigator.onLine)return;
  try{el('content').innerHTML=board(await api('liveFloor'));tick()}
  catch{el('net').textContent='Connection interrupted. Showing the last update.'}
},15000);
launch();
