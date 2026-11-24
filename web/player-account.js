'use strict';
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
      instructions+='<p><code>'+esc(r.upi)+'</code></p>'+paymentAppActions(r,{upi:r.upi,name:r.name});
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
    link.href=publicEventLink('register','receipt',r.ticket);
    link.rel='noreferrer';
    link.textContent='Open this receipt on the event site';
    el('content').querySelector('.narrow').append(link);
  }
}
async function accountAction(name){
  if(name==='copyUpi')return copyPaymentUpi();
  if(name==='submitPayment'){await submitPaymentProof();return}
  if(name==='identifyReceiver'){if(!val('originalReceiver'))return fieldError('originalReceiver','Choose the receiver you paid.');showReceipt(await playerApi('playerIdentifyReceiver',currentReceipt.ticket,val('originalReceiver')));return}
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
    const url=publicEventLink('register','receipt',ticket);
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
