'use strict';
const mode=document.body.dataset.mode;
const studentSignInMode=document.documentElement.dataset.studentSignIn||document.body.dataset.studentSignIn||'__STUDENT_SIGN_IN_MODE__';
const assetRequests=new Map();
function scriptAsset(src){
  if(assetRequests.has(src))return assetRequests.get(src);
  const request=new Promise((resolve,reject)=>{
    const script=document.createElement('script');script.onload=resolve;script.onerror=()=>{script.remove();reject(Error('Part of the event page could not load. Check your connection and try again.'))};
    script.src=src;document.head.append(script);
  }).catch(error=>{assetRequests.delete(src);throw error});
  assetRequests.set(src,request);
  return request;
}
let playerSession=unpack(deviceValue('player-login')),sharedSession=!!durable.get('player-login');
let challenge=unpack(deviceValue('email-step')), pendingRequest=tabValue('seat-request'),accountInfo,accountLoad;
let studentAttempt=unpack(deviceValue('student-sign-in'));
let preferredReceipt=incomingReceipt||tabValue('receipt-link')||'';
let currentReceipt=null,currentPass=null,ticketTimer,checkoutTimer;
// Cached account bundles also use this binding when loading the ticket encoder.
let qrLibrary;
function loadAccountTools(){
  if(typeof renderAccount==='function')return Promise.resolve();
  return scriptAsset('assets/player-account.js?v=__ACCOUNT_VERSION__');
}
function loadPaymentForm(){
  if(typeof proofForm==='function')return Promise.resolve();
  return scriptAsset('assets/payment-form.js?v=__PAYMENT_VERSION__');
}
function warmPaymentForm(){loadPaymentForm().catch(()=>{})}
if(incomingReceipt)tabValue('receipt-link',incomingReceipt);
function signInPage(keepForm=false,hint=deviceValue('email-hint'),emailOnly=false){
  challenge=null;saveDeviceValue('email-step','');heading('','Event registration');
  if(keepForm)document.querySelector(studentSignInMode==='directory'?'.student-email':'.student-directory')?.remove();
  if(studentSignInMode==='directory'&&!emailOnly){
    clearInterval(resendTimer);
    if(keepForm&&el('studentRoll')&&document.documentElement.dataset.entry==='register')return;
    const form=signInForm('signInDetails','<p>Enter the roll number and college email on your student record. No email code is needed.</p>'+
      rollField('studentRoll')+input('studentEmail','College email','type="email" autocomplete="email" autocapitalize="none" spellcheck="false" maxlength="254" required')+
      '<p class="sub">Student sign-in is saved on this device for 30 days.</p>','Sign in');
    el('content').innerHTML='<div class="narrow login-card">'+panel('Student sign-in','<div data-entry-price class="offer"></div>'+form+btn('clubSignIn','Club account sign-in','quiet'))+'</div>';
    el('studentRoll').value=studentAttempt?.roll||(/^\d{9}$/.test(hint)?hint:'');el('studentEmail').value=studentAttempt?.email||'';
    updatePrices();return;
  }
  if(keepForm&&el('identifier')&&document.documentElement.dataset.entry==='register'){
    if(!el('identifier').value)el('identifier').value=hint||'';return;
  }
  const entry=signInForm('requestCode','<p>Use your roll number or account email to receive a six-digit code.</p>'+
    input('identifier','Roll number or registered email','type="text" autocomplete="username" autocapitalize="none" spellcheck="false" maxlength="254" required placeholder="Nine-digit roll number or email" value="'+esc(hint)+'"'),'Send code');
  el('content').innerHTML='<div class="narrow login-card">'+panel('Email sign-in','<div data-entry-price class="offer"></div>'+entry)+'</div>';
  updatePrices();
}
async function codePage(){
  if(typeof renderEmailCodePage!=='function')await scriptAsset('assets/email-code.js?v=__EMAIL_CODE_VERSION__');
  if(!playerSession&&challenge?.identifier)renderEmailCodePage();
}

function resetPlayerView(){
  clearTimeout(ticketTimer);clearTimeout(checkoutTimer);clearInterval(resendTimer);
  currentReceipt=null;playerSession=null;challenge=null;studentAttempt=null;pendingRequest='';preferredReceipt='';accountInfo=null;accountLoad=null;
  for(const key of ['player-login','seat-request','email-step','receipt-link'])tabValue(key,'');
}
function clearPlayer(forgetDrafts=false){
  const roll=accountInfo?.player?.roll||playerSession?.roll,shared=unpack(durable.get('player-login'));
  const other=shared?.token&&playerSession?.token&&shared.token!==playerSession.token;
  if(forgetDrafts)dropAccountDrafts(roll);
  resetPlayerView();sharedSession=false;
  if(!other)for(const key of ['player-login','receipt','pending-seat','email-step','email-hint','student-sign-in'])saveDeviceValue(key,'');
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
      const hint=accountInfo?.player?.roll||playerSession.roll;clearPlayer();signInPage(false,hint);msg(e.message,true);
    }
    throw e;
  }
}
function loadAccount(){
  if(accountLoad)return accountLoad;
  const session=playerSession;
  const request=Promise.all([playerApi('playerHome',preferredReceipt||''),loadAccountTools()]).then(([info])=>{
    if(session?.token!==playerSession?.token||syncDeviceSession())return;
    rememberPlayer({...session,expires:info.sessionExpires||session.expires},info.player.roll);
    msg();el('net').textContent='';renderAccount(info);
  }).catch(error=>{
    if(session?.token===playerSession?.token)throw error;
  }).finally(()=>{if(accountLoad===request)accountLoad=null});
  accountLoad=request;return request;
}
function accountRetry(){
  el('content').innerHTML='<div class="narrow">'+panel('Your account',btn('account','Open registration','primary')+btn('logout','Sign out'))+'</div>';
}
async function openSignedInPlayer(signed){
  rememberPlayer(signed.session,signed.account?.player?.roll);
  for(const key of ['email-step','email-hint','student-sign-in'])saveDeviceValue(key,'');challenge=null;studentAttempt=null;
  if(signed.account){
    try{await loadAccountTools()}catch(error){if(playerSession?.token===signed.session.token)accountRetry();throw error}
    if(playerSession?.token===signed.session.token)renderAccount(signed.account);
    return;
  }
  heading('PLAYER REGISTRATION','Signed in');accountRetry();
  msg('Your sign-in was saved. Open registration to retry loading your receipt.');
}
async function action(name){
  if(mode==='scan')return name==='reloadScanner'?launch():scannerAction(name);
  if(name==='reloadPass'){await renderPass();return}
  if(name==='clubSignIn'){signInPage(false,'',true);el('identifier').focus();return}
  if(name==='changeLogin'){saveDeviceValue('email-hint','');signInPage(false,'');(el('studentRoll')||el('identifier')).focus();return}
  if(name==='signInDetails'){
    const roll=val('studentRoll'),email=val('studentEmail').toLowerCase();
    if(!/^\d{9}$/.test(roll)){fieldError('studentRoll','Enter your nine-digit roll number.');return}
    if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)){fieldError('studentEmail','Enter your registered college email.');return}
    if(studentAttempt?.roll!==roll||studentAttempt?.email!==email||!studentAttempt?.requestId)studentAttempt={roll,email,requestId:crypto.randomUUID()};
    const attempt=studentAttempt;saveDeviceValue('student-sign-in',JSON.stringify(attempt));
    const signed=await api('signInWithStudentDetails',roll,email,preferredReceipt||'',attempt.requestId);
    if(studentAttempt===attempt&&!playerSession)await openSignedInPlayer(signed);
    return;
  }
  if(name==='requestCode'||name==='resendCode'||name==='matchMail'){
    const identifier=name==='resendCode'?challenge.identifier:name==='matchMail'?val('matchRoll'):val('identifier');
    if(!/^\d{9}$/.test(identifier)&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(identifier)){
      const message='Enter your nine-digit roll number or your registered email address.';
      fieldError(name==='matchMail'?'matchRoll':'identifier',message);return;
    }
    saveDeviceValue('email-hint',identifier);
    // Mail can arrive before the browser receives the response, especially when switching apps.
    const waiting=name==='requestCode'?{identifier,resendAt:0,expires:Date.now()+600000,requestId:crypto.randomUUID(),adminEntry:studentSignInMode==='directory'}:null;
    if(waiting)saveDeviceValue('email-step',JSON.stringify(waiting));
    let reply;
    try{reply=name==='matchMail'?await api('requestMatchedPlayerCode',identifier,val('matchEmail')):await api('requestEventCode',identifier)}
    catch(error){
      if(waiting&&!playerSession){
        if(error.message.includes('Could not reach')){
          challenge=waiting;await codePage();msg('If your email arrived, enter its code. You can also resend it here.');return;
        }
        if(unpack(deviceValue('email-step'))?.requestId===waiting.requestId)saveDeviceValue('email-step','');
      }
      throw error;
    }
    if(playerSession)return;
    const requestId=waiting?.requestId||(challenge?.identifier===identifier&&challenge.expires>Date.now()&&challenge.requestId)||crypto.randomUUID();
    challenge={identifier,resendAt:Date.now()+reply.resendAfter*1000,expires:Date.now()+(reply.expiresIn??600)*1000,requestId,adminEntry:waiting?.adminEntry||challenge?.adminEntry||false};
    saveDeviceValue('email-step',JSON.stringify(challenge));await codePage();
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
    await openSignedInPlayer(signed);return;
  }
  if(name==='account'){await loadAccount();return}
  if(name==='refreshBoard'){await refreshBoard();return}
  if(name==='logout'){const token=playerSession?.token;clearPlayer(true);signInPage();if(token)await api('playerLogout',token);return}
  if(playerSession)await accountAction(name);
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
      const pending=window.firstFloorRead;window.firstFloorRead=null;
      const data=await (pending||api('liveFloor')),received=Date.now();
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
  try{
    const [pass]=await Promise.all([api('passInfo',code),loadAccountTools()]);
    drawPass(pass);
  }
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
    const age=Date.now()-cached?.received;
    if(age>=0&&age<120000){
      try{paintBoard(cached.data,cached.received);el('net').textContent='Updating the live floor…'}
      catch{tabValue('floor-snapshot','')}
    }
    await refreshBoard();return;
  }
  if(mode==='pass'){await renderPass();return}
  if(playerSession?.token){
    if(preferredReceipt)warmPaymentForm();
    heading('Poké Poker Night','Your registration');
    el('content').innerHTML=skeleton('Opening your registration');
    try{await loadAccount()}catch(e){if(playerSession)accountRetry();throw e}return;
  }
  if(challenge?.identifier&&(studentSignInMode!=='directory'||challenge.adminEntry)){await codePage();return}
  signInPage(true);
  if(window.pendingPokerSignIn){
    window.pendingPokerSignIn=false;
    const form=(studentSignInMode==='directory'?el('studentRoll'):el('identifier')).form,button=form.querySelector('button');
    for(const field of form.querySelectorAll('input'))field.readOnly=false;
    button.disabled=false;button.removeAttribute('aria-busy');button.textContent=studentSignInMode==='directory'?'Sign in':'Send code';form.requestSubmit();
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
    else if(!playerSession&&challenge?.expires<=Date.now()&&el('loginCode'))codePage().catch(e=>msg(e.message,true));
  };
  addEventListener('online',resume);addEventListener('pageshow',resume);document.addEventListener('visibilitychange',resume);
}
window.pokerReady=true;
launch();
