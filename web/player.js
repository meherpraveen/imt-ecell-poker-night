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
let playerSession=unpack(deviceValue('player-login')),sharedSession=!!durable.get('player-login');
let challenge=unpack(deviceValue('email-step')), pendingRequest=tabValue('seat-request'),accountInfo,accountLoad;
let preferredReceipt=incomingReceipt||tabValue('receipt-link')||'';
let currentReceipt=null,currentPass=null,ticketTimer,qrLibrary,proofRead=null,paymentLibrary;
function loadPaymentForm(){
  if(typeof proofForm==='function')return Promise.resolve();
  if(!paymentLibrary)paymentLibrary=scriptAsset('assets/payment-form.js?v=__PAYMENT_VERSION__').catch(error=>{paymentLibrary=null;throw error});
  return paymentLibrary;
}
function warmPaymentForm(){loadPaymentForm().catch(()=>{})}
if(incomingReceipt)tabValue('receipt-link',incomingReceipt);
function signInPage(keepForm=false,hint=deviceValue('email-hint')){
  challenge=null;saveDeviceValue('email-step','');heading('','Event registration');
  if(keepForm&&el('identifier')&&document.documentElement.dataset.entry==='register'){
    if(!el('identifier').value)el('identifier').value=hint||'';return;
  }
  const entry=signInForm('requestCode','<p>Use your roll number or account email to receive a six-digit code.</p>'+
    input('identifier','Roll number or registered email','type="text" autocomplete="username" autocapitalize="none" spellcheck="false" maxlength="254" required placeholder="Nine-digit roll number or email" value="'+esc(hint)+'"'),'Send code');
  el('content').innerHTML='<div class="narrow login-card">'+panel('Email sign-in','<div data-entry-price class="offer"></div>'+entry)+'</div>';
  updatePrices();
}
function codePage(){
  heading('','Check your email');
  const mailbox=/^\d{9}$/.test(challenge.identifier)?'the email on your student record':'<strong>'+esc(challenge.identifier)+'</strong>';
  if(challenge.expires<=Date.now()){
    clearInterval(resendTimer);
    el('content').innerHTML='<div class="narrow login-card">'+panel('Get a new sign-in code','<p>Your previous code expired. Send a new one to '+mailbox+' to continue.</p>'+btn('resendCode','Send a new code','primary wide')+btn('changeLogin','Change roll number or email'))+'</div>';return;
  }
  const form=signInForm('verifyCode','<p>Check '+mailbox+' for a six-digit code from <strong>Poké Poker Night 2026</strong>. Enter it here within 10 minutes.</p>'+
    '<p class="mail-folder"><a href="https://outlook.office.com/mail/junkemail" target="_blank" rel="noopener noreferrer">Open Outlook Junk Email</a> if the code is missing from your inbox. In Gmail, check Spam. You can use the code straight from either folder.</p>'+
    codeInput()+'<p class="sub">Student sign-in is saved on this device for 30 days.</p>','Verify and continue');
  const help='<details><summary>Email hasn’t arrived?</summary><p>Check that your roll number matches the email on your student record. A resend keeps the same active code.</p>'+
    signInForm('matchMail',rollField('matchRoll')+input('matchEmail','Email on your student record','type="email" autocomplete="email" required maxlength="254"'),'Check details and send code')+'</details>';
  el('content').innerHTML='<div class="narrow login-card">'+panel('Enter your sign-in code',form+btn('resendCode','Resend code')+btn('changeLogin','Change roll number or email')+help)+'</div>';
  if(/^\d{9}$/.test(challenge.identifier))el('matchRoll').value=challenge.identifier;else el('matchEmail').value=challenge.identifier;
  startResendTimer(challenge.resendAt);el('loginCode').focus({preventScroll:true});
}
function resetPlayerView(){
  clearTimeout(ticketTimer);clearTimeout(checkoutTimer);clearInterval(resendTimer);
  proofRead=null;currentReceipt=null;playerSession=null;challenge=null;pendingRequest='';preferredReceipt='';accountInfo=null;accountLoad=null;
  for(const key of ['player-login','seat-request','email-step','receipt-link'])tabValue(key,'');
}
function clearPlayer(forgetDrafts=false){
  const roll=accountInfo?.player?.roll||playerSession?.roll,shared=unpack(durable.get('player-login'));
  const other=shared?.token&&playerSession?.token&&shared.token!==playerSession.token;
  if(forgetDrafts)dropAccountDrafts(roll);
  resetPlayerView();sharedSession=false;
  if(!other)for(const key of ['player-login','receipt','pending-seat','email-step','email-hint'])saveDeviceValue(key,'');
}
function rememberPlayer(session,roll){
  playerSession={...session,roll:roll||session.roll||''};
  const value=JSON.stringify(playerSession);
  sharedSession=durable.get('player-login')===value||saveDeviceValue('player-login',value);
}
function syncDeviceSession(){
  let saved;try{saved=unpack(localStorage.getItem('pn26:player-login'))}catch{return false}
  if((!saved?.token&&!sharedSession)||saved?.token===playerSession?.token)return false;
  resetPlayerView();playerSession=saved;sharedSession=!!saved?.token;
  if(sharedSession)launch();else signInPage();return true;
}
async function playerApi(method,...args){
  const token=playerSession?.token;
  try{
    const result=await api(method,token||'',...args);
    if(token!==playerSession?.token)throw Error('The signed-in account changed.');
    if(result?.offer)syncOffer(result.offer);return result;
  }catch(e){
    if(token&&token===playerSession?.token&&String(e.message).includes('Sign in with your registered email')){
      const hint=accountInfo?.player?.roll||playerSession.roll;clearPlayer();signInPage(false,hint);
    }
    throw e;
  }
}
function progress(step){
  return '<ol class="progress" aria-label="Registration progress">'+['Details','Pay','Ticket'].map((label,i)=>
    '<li class="'+(i<step?'done':'')+'"'+(i===step?' aria-current="step"':'')+'><span aria-hidden="true">'+(i<step?'✓':i+1)+'</span>'+label+'</li>').join('')+'</ol>';
}
function accountScreen(step,body){
  el('content').innerHTML='<div class="narrow">'+progress(step)+(step&&currentReceipt?detailsEditor(currentReceipt):'')+body+'<div class="account-actions">'+btn('logout','Sign out','quiet')+'</div></div>';
  mountDetailsDraft();updatePrices();
  if(playerSession&&!sharedSession)el('net').textContent='This browser is blocking saved sign-in. Keep this tab open to stay signed in.';
  if(busy){const title=el('title');title.tabIndex=-1;title.focus({preventScroll:true});title.scrollIntoView({block:'nearest'})}
}
function registrationForm(person,action,label,fee,next){
  return '<form data-action="'+action+'" novalidate>'+
    input('regName','Full Name','autocomplete="name" required maxlength="100" value="'+esc(person.fullName??person.name??'')+'"')+
    input('regPgp','PGP ID','readonly required aria-describedby="pgpHint" value="'+esc(person.pgpId||person.roll||'')+'"')+
    '<p class="sub" id="pgpHint">Your PGP ID was verified at sign-in.</p>'+
    phoneField('regContact',person.contact||person.phone||'')+
    batchField('regBatch',person.batch)+
    (fee?'<div data-entry-price class="offer"></div>':'')+(next?'<p class="sub">'+esc(next)+'</p>':'')+
    '<button class="primary wide" type="submit">'+esc(label)+'</button><p class="sub draft-note" id="detailDraftNote"></p></form>';
}
function registrationPerson(r){return {...(accountInfo?.player||{}),...r.details,pgpId:r.beneficiary}}
function detailsEditor(r){
  return '<details id="registrationEditor" class="registration-editor"><summary>Edit registration details<span id="detailsSaved" aria-hidden="true"></span></summary>'+
    registrationForm(registrationPerson(r),'saveDetails','Save changes',false,'')+'<p class="sub" id="detailsFeedback" role="status"></p></details>';
}
function enteredDetails(){
  const fullName=val('regName'),contact=val('regContact');
  if(!fullName){fieldError('regName','Enter your full name.');return}
  if(!validPhone(contact)){fieldError('regContact',contact?'Enter a phone number with 7–15 digits.':'Enter your phone number.');return}
  const batch=val('regBatch');if(!batch){fieldError('regBatch','Choose your batch to continue.');return}
  return {fullName,pgpId:val('regPgp'),contact,batch};
}
function registrationPage(){
  currentReceipt=null;clearTimeout(ticketTimer);heading('Poké Poker Night','Your registration');
  const info=accountInfo,person=info.player||{};
  const next=info.paymentsReady?'':'You can pay here when E-Cell opens checkout.';
  const form=registrationForm(person,'start',info.paymentsReady?'Continue to payment':'Save my registration',true,next);
  accountScreen(0,panel(info.open?'Entry details':'Registration closed',info.open?form:'<p>'+esc(info.message)+'</p>'));
}
function loadAccount(){
  if(accountLoad)return accountLoad;
  const session=playerSession;
  const request=playerApi('playerHome',preferredReceipt||'').then(info=>{
    if(session?.token!==playerSession?.token||syncDeviceSession())return;
    rememberPlayer({...session,expires:info.sessionExpires||session.expires},info.player.roll);
    msg();el('net').textContent='';renderAccount(info);
  }).finally(()=>{if(accountLoad===request)accountLoad=null});
  accountLoad=request;return request;
}
function renderAccount(info){
  accountInfo=info;syncOffer(info.offer);
  tabValue('receipt-link','');
  if(accountInfo.receipt)showReceipt(accountInfo.receipt);else{preferredReceipt='';durable.set('receipt','');registrationPage()}
}
function checkoutPanel(r){
  const price='<div data-entry-price class="offer"></div>';
  if(r.checkoutEnded||r.full)return panel(r.checkoutEnded?'Payments closed':'All waves are full','<p>If you already paid, submit your screenshot below for review.</p>');
  let instructions=price;
  if(r.receiver&&Array.isArray(r.checkoutReceivers))return panel('Pay '+formatFee_(r.fee),instructions+choosePaymentReceiver(r));
  if(r.upi||r.paymentQr){
    instructions+='<div data-payment-target><p>Pay <strong>'+esc(r.name)+'</strong> using UPI.</p>';
    if(r.upi){
      const params=new URLSearchParams({pa:r.upi,pn:r.name,am:Number(r.fee).toFixed(2),cu:r.offer.currency,tn:'Poké Poker Night '+r.id});
      instructions+='<p><code>'+esc(r.upi)+'</code></p><a class="button" data-payment-link target="_blank" rel="noopener" href="upi://pay?'+esc(params.toString().replace(/\+/g,'%20'))+'">Open UPI app</a>';
    }
    if(r.receiver?.number)instructions+='<p class="sub">UPI number · '+esc(r.receiver.number)+'</p>';
    if(r.paymentQr){
      const fileName=r.paymentQr.startsWith('data:image/png;')?'payment-qr.png':'payment-qr.jpg';
      instructions+='<figure class="payment-qr"><img alt="Coordinator’s UPI payment QR" src="'+esc(r.paymentQr)+'"><figcaption>Scan in your UPI app or <a download="'+fileName+'" href="'+esc(r.paymentQr)+'">save the QR image</a>.</figcaption></figure>';
    }
    return panel('Pay '+formatFee_(r.fee),instructions+'</div>');
  }
  return panel('Payments paused',instructions+'<p>If you already paid, upload your proof below.</p>'+btn('receipt','Refresh payment details'));
}
function showReceipt(r){
  proofRead=null;currentReceipt=r;clearTimeout(checkoutTimer);preferredReceipt=r.ticket;durable.set('receipt',r.ticket);
  adoptInitialDetailsDraft(r);
  const proofKey=draftKey('proof',r.beneficiary,r.id),priorProof=draftValue(proofKey);
  if(priorProof&&(priorProof.revision!==(r.proofVersion||0)||!['HOLD','REVIEW','REJECTED'].includes(r.status)))removeProofDraft(proofKey,priorProof.marker);
  const needsDetails=!r.details?.batch||!validPhone(r.details?.contact);
  if(needsDetails&&['REGISTERED','WAITLIST','HOLD','REVIEW','REJECTED'].includes(r.status)){
    heading('Poké Poker Night','Your registration');
    const note=r.status==='REVIEW'?'Your payment proof is saved. Complete your details here.':'';
    accountScreen(0,panel('Registration details',registrationForm(registrationPerson(r),'saveDetails','Save and continue',false,note)));return;
  }
  if(typeof proofForm!=='function'&&(r.status==='HOLD'||(r.receiver||r.identifyReceivers?.length)&&['REVIEW','REJECTED'].includes(r.status))){
    el('content').innerHTML=skeleton('Opening payment details');
    loadPaymentForm().then(()=>{if(currentReceipt===r)showReceipt(r)}).catch(()=>{
      if(currentReceipt===r)accountScreen(1,panel('Payment details unavailable','<p>Check your connection and try again.</p>'+btn('receipt','Retry opening payment','primary wide')));
    });
    return;
  }
  const ticket=!!(r.entryCode||r.checkedInAt);
  heading('Poké Poker Night',ticket?'Your ticket':'Your registration');
  let body='';
  if(r.identifyReceivers?.length){body=receiverRecovery(r)}else if(r.status==='REGISTERED'){
    const next=r.checkoutEnded?'Online checkout has ended. Contact E-Cell if you already paid.':r.canCheckout?'Payment is open for your registration.':'Your details are saved. Return here when E-Cell opens payment.';
    body=panel('Registration saved','<p>'+next+'</p>'+(r.checkoutEnded?'':'<div data-entry-price class="offer"></div>')+
      (r.checkoutEnded?'':r.canCheckout?btn('checkout','Continue to payment','primary wide'):btn('receipt','Check payment availability','primary wide'))+
      btn('copyReceipt','Copy private receipt link','quiet')+'<div id="copyReceiptFallback"></div>');
  }else if(r.status==='HOLD'){
    body='<div id="checkoutPayment">'+checkoutPanel(r)+'</div><div id="checkoutUpdate" class="sub" role="status" hidden></div>';
    body+=r.receiver?proofForm(r):panel('Upload payment proof','<form data-action="upload" novalidate><label for="shot">Payment screenshot</label><input id="shot" type="file" accept="image/jpeg,image/png,image/webp" required><p class="sub draft-note" id="proofDraftNote"></p>'+input('tail','Visible final digits of the UPI reference (optional)','inputmode="numeric" maxlength="12" placeholder="Last 4–12 digits"')+'<p class="sub">Keep the amount, recipient and reference visible.</p>'+checkbox('consent','I agree to share this proof with the E-Cell payment desk for verification.')+'<button class="primary wide" type="submit">Submit for review</button></form>');
  }else if(r.receiver&&['REVIEW','REJECTED'].includes(r.status)){
    const issue=r.issue||'Your screenshot is saved. Your pass will appear when the bank credit is authorized.';
    body=panel(r.status==='REJECTED'?'Proof needs attention':'Payment pending','<p>'+esc(issue)+'</p><p class="sub">Receiver · '+esc(r.receiver.name)+'</p>'+btn('receipt','Refresh status'));
    if(r.status==='REVIEW')body+='<details'+(r.needsConfirmation?' open':'')+'><summary>'+ (r.needsConfirmation?'Confirm your payment details':'Replace my screenshot')+'</summary>'+proofForm(r)+'</details>';else body+=proofForm(r);
  }else if(ticket){
    body=walletCard(r,r.details?.fullName||accountInfo?.player?.name,false);
  }else{
    const labels={REVIEW:['Payment under review','The desk will check the coordinator’s incoming payment. Keep this page. Please pay only once.'],WAITLIST:['On the waitlist','All qualifier waves are full. Payment will open here if a place becomes available.'],REJECTED:['Proof needs attention',r.reason||'Contact the desk with your receipt.'],NO_SHOW:['No-show recorded','Speak to the desk if you are at the venue.'],RELEASED:['Offer released','Speak to the desk for your current attempt.']};
    const [title,bodyText]=labels[r.status]||['Entry closed','This qualifier is closed. Speak to the event desk about your ticket.'];
    const renew=['RELEASED','REJECTED'].includes(r.status)&&accountInfo?.open;
    body+=panel(title,'<p>'+esc(bodyText)+'</p>'+(r.wave?'<p class="sub">Round 1 · Wave '+r.wave+'</p>':'')+
      (renew?btn('renew','Request another seat','primary wide'):btn('receipt','Refresh status','primary wide')));
  }
  accountScreen(ticket||['PAID','NO_SHOW','QUALIFIED','ELIMINATED','WINNER'].includes(r.status)?2:1,body);
  if(typeof mountPaymentDraft==='function')mountPaymentDraft(r);
  if(r.entryCode)fillTicketQr(r.entryCode,r.wave);
  scheduleTicketUpdate();scheduleCheckoutUpdate();
  if(document.body.dataset.host!=='pages'){
    const link=document.createElement('a');
    link.href='https://meherpraveen.github.io/imt-ecell-poker-night/event.html?view=register#receipt='+encodeURIComponent(r.ticket);
    link.rel='noreferrer';
    link.textContent='Open this receipt on the event site';
    el('content').querySelector('.narrow').append(link);
  }
}
async function action(name){
  if(name==='submitPayment'){await submitPaymentProof();return}
  if(name==='identifyReceiver'){if(!val('originalReceiver'))return fieldError('originalReceiver','Choose the receiver you paid.');showReceipt(await playerApi('playerIdentifyReceiver',currentReceipt.ticket,val('originalReceiver')));return}
  if(mode==='scan')return name==='reloadScanner'?launch():scannerAction(name);
  if(name==='reloadPass'){await renderPass();return}
  if(name==='changeLogin'){saveDeviceValue('email-hint','');signInPage(false,'');el('identifier').focus();return}
  if(name==='requestCode'||name==='resendCode'||name==='matchMail'){
    const identifier=name==='resendCode'?challenge.identifier:name==='matchMail'?val('matchRoll'):val('identifier');
    if(!/^\d{9}$/.test(identifier)&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(identifier)){
      const message='Enter your nine-digit roll number or your registered email address.';
      fieldError(name==='matchMail'?'matchRoll':'identifier',message);return;
    }
    saveDeviceValue('email-hint',identifier);
    // Mail can arrive before the browser receives the response, especially when switching apps.
    const waiting=name==='requestCode'?{identifier,resendAt:0,expires:Date.now()+600000,requestId:crypto.randomUUID()}:null;
    if(waiting)saveDeviceValue('email-step',JSON.stringify(waiting));
    let reply;
    try{reply=name==='matchMail'?await api('requestMatchedPlayerCode',identifier,val('matchEmail')):await api('requestEventCode',identifier)}
    catch(error){
      if(waiting&&!playerSession){
        if(error.message.includes('Could not reach')){
          challenge=waiting;codePage();msg('If your email arrived, enter its code. You can also resend it here.');return;
        }
        if(unpack(deviceValue('email-step'))?.requestId===waiting.requestId)saveDeviceValue('email-step','');
      }
      throw error;
    }
    if(playerSession)return;
    const requestId=waiting?.requestId||(challenge?.identifier===identifier&&challenge.expires>Date.now()&&challenge.requestId)||crypto.randomUUID();
    challenge={identifier,resendAt:Date.now()+reply.resendAfter*1000,expires:Date.now()+(reply.expiresIn??600)*1000,requestId};
    saveDeviceValue('email-step',JSON.stringify(challenge));codePage();
    if(name==='matchMail')msg(reply.delivery==='accepted'?'Your details match. Google accepted the email for delivery.':reply.delivery==='existing'?'Your details match. Your existing email code is still active.':'Your details match. A send is already in progress.');
    return;
  }
  if(name==='verifyCode'){
    if(!challenge.requestId){challenge.requestId=crypto.randomUUID();saveDeviceValue('email-step',JSON.stringify(challenge))}
    const step=challenge;let signed;
    try{signed=await api('signInEvent',step.identifier,val('loginCode'),preferredReceipt||'',step.requestId)}
    catch(e){if(/incorrect or has expired/.test(e.message)){fieldError('loginCode',e.message);return}throw e}
    if(challenge!==step)return;
    if(signed.continueUrl){
      const next=new URL(signed.continueUrl);
      if(next.origin!=='https://script.google.com' || !next.pathname.endsWith('/exec') ||
        (window.POKER_NIGHT_WEB_APP && next.origin+next.pathname!==window.POKER_NIGHT_WEB_APP))throw Error('Open the private desk link from the club Sheet.');
      clearPlayer();heading('EVENT ACCESS','Opening your admin desk');
      el('content').innerHTML='<div class="narrow">'+panel('Club account verified','<a href="'+esc(next.href)+'" target="_top" rel="noreferrer">Open admin desk</a>')+'</div>';
      if(window===window.top)location.replace(next.href);
      return;
    }
    rememberPlayer(signed.session,signed.account?.player?.roll);
    saveDeviceValue('email-step','');saveDeviceValue('email-hint','');challenge=null;
    if(signed.account){renderAccount(signed.account);return}
    heading('PLAYER REGISTRATION','Signed in');
    el('content').innerHTML='<div class="narrow">'+panel('Your account',btn('account','Open registration','primary')+btn('logout','Sign out'))+'</div>';
    msg('Your sign-in was saved. Open registration to retry loading your receipt.');return;
  }
  if(name==='account'){await loadAccount();return}
  if(name==='refreshBoard'){await refreshBoard();return}
  if(name==='logout'){const token=playerSession?.token;clearPlayer(true);signInPage();if(token)await api('playerLogout',token);return}
  if(name==='renew'){preferredReceipt='';pendingRequest='';tabValue('seat-request','');durable.set('receipt','');registrationPage();return}
  if(name==='refreshQuote'){await refreshCheckoutQuote();return}
  if(name==='saveDetails'){
    const d=enteredDetails();if(!d)return;
    const r=currentReceipt,editor=el('registrationEditor'),previousName=r.details?.fullName||accountInfo?.player?.name||'';
    const saved=await playerApi('playerSaveDetails',r.ticket,JSON.stringify({...d,revision:r.detailsRevision||0}));
    if(currentReceipt!==r)return;
    r.detailsRevision=saved.detailsRevision;r.details=saved.details;
    if(saved.detailsConflict){
      const text='Another tab saved '+[saved.details.fullName,saved.details.batch,saved.details.contact].filter(Boolean).join(' · ')+'. Check your changes and save again.';
      if(editor)el('detailsFeedback').textContent=text;else msg(text,true);return;
    }
    finishDetailsDraft(el('regName').form,saved);
    if(!editor||r.status!==saved.status){showReceipt(saved);return}
    if(el('paymentPayer')&&el('paymentPayer').value===previousName)el('paymentPayer').value=d.fullName;
    if(el('beneficiaryName'))el('beneficiaryName').value=d.fullName+' · '+r.beneficiary;
    const walletName=document.querySelector('.wallet-player');if(walletName)walletName.textContent=d.fullName;
    editor.open=!!draftValue(el('regName').form.dataset.draftKey);
    if(!editor.open)editor.querySelector('summary').focus({preventScroll:true});
    el('detailsFeedback').textContent='';el('detailsSaved').textContent='Saved';el('ticketAnnouncement').textContent='Registration details saved.';
    return;
  }
  if(name==='start'){
    const details=enteredDetails();if(!details)return;
    if(accountInfo.paymentsReady)warmPaymentForm();
    if(!pendingRequest){pendingRequest=globalThis.crypto?.randomUUID?.()||'';tabValue('seat-request',pendingRequest)}
    const form=el('regName').form,saved=await playerApi('playerStart',preferredReceipt||'',pendingRequest,JSON.stringify(details));
    finishDetailsDraft(form,saved);showReceipt(saved);
    pendingRequest='';tabValue('seat-request','');return;
  }
  if(name==='receipt'){showReceipt(await playerApi('playerStatus',preferredReceipt));return}
  if(name==='checkout'){warmPaymentForm();showReceipt(await playerApi('playerCheckout',preferredReceipt));return}
  if(name==='copyReceipt'){
    const ticket=preferredReceipt;
    if(!ticket)throw Error('Open your saved receipt first.');
    const url='https://meherpraveen.github.io/imt-ecell-poker-night/event.html?view=register#receipt='+encodeURIComponent(ticket);
    try{await navigator.clipboard.writeText(url);msg('Private receipt link copied. Keep it for your payment.')}
    catch{el('copyReceiptFallback').innerHTML=input('receiptUrl','Copy your private receipt link','readonly value="'+esc(url)+'"');el('receiptUrl').select()}
    return;
  }
  if(name==='upload'){
    const shot=el('shot'),file=shot.files[0]||shot.form.savedFile,tail=val('tail');
    if(!file){fieldError('shot','Choose a screenshot of your payment.');return}
    if(tail&&!/^\d{4,12}$/.test(tail)){fieldError('tail','Enter the last 4–12 digits, or leave this blank.');return}
    if(!el('consent').checked){fieldError('consent','Confirm that the desk may review your screenshot.');return}
    let data;try{data=await picture(file)}catch(e){fieldError('shot',e.message);return}
    const saved=await playerApi('playerUpload',preferredReceipt,tail,data);
    removeProofDraft(shot.form.dataset.proofKey,shot.form.proofDraft?.marker);showReceipt(saved);
  }
}
function pollDelay(base,failures){return Math.min(90000,base*2**Math.min(failures,3))*(1+Math.random()*.3)}
let boardRequest,boardFingerprint='',boardTimer,boardFailures=0;
function paintBoard(data,received){
  const {now,...display}=data,fingerprint=JSON.stringify(display);
  if(fingerprint!==boardFingerprint){el('content').innerHTML=board(data);boardFingerprint=fingerprint}
  clockEnd=data.deadline?received+(data.deadline-now):0;tick();
}
function updateBoardLater(){
  clearTimeout(boardTimer);
  if(!document.hidden&&navigator.onLine)boardTimer=setTimeout(refreshBoard,pollDelay(15000,boardFailures));
}
function refreshBoard(){
  if(boardRequest)return boardRequest;
  clearTimeout(boardTimer);
  boardRequest=(async()=>{
    try{
      const data=await api('liveFloor'),received=Date.now();
      boardFailures=0;paintBoard(data,received);tabValue('floor-snapshot',JSON.stringify({data,received}));el('net').textContent='';
    }catch{
      boardFailures++;el('net').textContent=boardFingerprint?'Connection interrupted. Showing the last update.':'The floor could not load. Check your connection.';
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
  if(playerSession?.token){
    if(preferredReceipt)warmPaymentForm();
    heading('Poké Poker Night','Your registration');
    el('content').innerHTML=skeleton('Opening your registration');
    try{await loadAccount()}catch(e){if(playerSession)el('content').innerHTML='<div class="narrow">'+panel('Your account',btn('account','Open registration','primary')+btn('logout','Sign out'))+'</div>';throw e}return;
  }
  if(challenge?.identifier){codePage();return}
  signInPage(true);
  if(window.pendingPokerSignIn){
    window.pendingPokerSignIn=false;
    const form=el('identifier').form,button=form.querySelector('button');
    button.disabled=false;button.removeAttribute('aria-busy');button.textContent='Send code';form.requestSubmit();
  }
}catch(e){msg(e.message||'The club desk is temporarily unavailable.',true)}}
addEventListener('online',()=>{el('net').textContent='';if(mode==='board')refreshBoard()});
addEventListener('offline',()=>{el('net').textContent='Offline. Reconnect for updates.'});
if(mode==='board')document.addEventListener('visibilitychange',()=>{if(document.hidden)clearTimeout(boardTimer);else if(navigator.onLine)refreshBoard()});
if(mode==='register'){
  document.addEventListener('input',e=>{if(e.target.id==='identifier')saveDeviceValue('email-hint',e.target.value)});
  addEventListener('storage',e=>{if(e.key==='pn26:player-login'||e.key===null)syncDeviceSession()});
  const resume=()=>{
    if(document.hidden||syncDeviceSession())return;
    if(playerSession&&!accountInfo&&navigator.onLine)loadAccount().catch(e=>msg(e.message,true));
    else if(!playerSession&&challenge?.expires<=Date.now()&&el('loginCode'))codePage();
  };
  addEventListener('online',resume);addEventListener('pageshow',resume);document.addEventListener('visibilitychange',resume);
}
if(mode==='register'||mode==='pass'){
  document.addEventListener('click',e=>{if(e.target.closest('#checkoutPayment a')&&checkoutNeedsUpdate()){e.preventDefault();refreshCheckoutQuote()}},true);
  document.addEventListener('visibilitychange',()=>{if(document.hidden)clearTimeout(ticketTimer);else{checkCheckoutTime();updateTicket()}});
  addEventListener('online',()=>{checkCheckoutTime();updateTicket()});
  addEventListener('pageshow',()=>{checkCheckoutTime();if(currentPass||currentReceipt)updateTicket()});
}
window.pokerReady=true;
launch();
