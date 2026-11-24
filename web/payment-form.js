'use strict';
let readGeneration=0;
function receiverRecovery(r){
  return panel('Confirm your original receiver','<p>This registration predates the receiver list. Select the account shown on your payment receipt.</p><label for="originalReceiver">Who did you pay?</label><select id="originalReceiver"><option value="">Choose the receiver</option>'+
    r.identifyReceivers.map(x=>'<option value="'+esc(x.id)+'">'+esc(x.name+' · '+x.upi)+'</option>').join('')+'</select>'+btn('identifyReceiver','Save receiver','primary'));
}
function upiLink(r,receiver){
  const params=new URLSearchParams({pa:receiver.upi,pn:receiver.name,am:Number(r.fee).toFixed(2),cu:r.offer.currency,tn:'Poké Poker Night '+r.id});
  return 'upi://pay?'+params.toString().replace(/\+/g,'%20');
}
function receiverActions(r,id){
  const x=r.checkoutReceivers.find(option=>option.id===id&&option.qr);
  if(!x)return '<button class="primary" type="button" aria-describedby="receiverFeedback" disabled>Open UPI app</button>';
  return '<a class="button primary" data-payment-link target="_blank" rel="noopener" href="'+esc(upiLink(r,x))+'">Open UPI app<span class="sr-only"> to pay '+esc(x.name)+'</span></a>'+
    '<a class="qr-save" download="payment-qr.gif" href="'+esc(x.qr)+'">Save QR<span class="sr-only"> for '+esc(x.name)+'</span></a>';
}
function choosePaymentReceiver(r){
  const options=r.checkoutReceivers;
  if(!options.length)return '<p>Payment is paused. If you already paid, upload your screenshot below.</p>'+btn('receipt','Refresh payment details');
  const cards=options.map(x=>{
    const checked=r.chosenReceiverId===x.id;
    const radio='<input type="radio" name="checkoutReceiver" value="'+esc(x.id)+'" aria-label="'+esc(x.name)+'"'+(checked?' checked':'')+(x.qr?'':' disabled')+'>';
    const code=x.qr?'<img width="192" height="192" alt="UPI payment QR for '+esc(x.name)+'" src="'+esc(x.qr)+'">':'<span class="qr-unavailable">QR unavailable</span>';
    return '<label class="receiver-card">'+code+'<span class="receiver-name">'+radio+'<strong>'+esc(x.name)+'</strong></span><small>'+esc(x.upi)+'</small>'+(x.number?'<small>UPI no. '+esc(x.number)+'</small>':'')+'</label>';
  }).join('');
  const help=r.chosenReceiverId?'Selected · '+options.find(x=>x.id===r.chosenReceiverId).name:'Choose the account you will pay.';
  const refresh=options.some(x=>!x.qr)?btn('receipt','Refresh unavailable QR','quiet'):'';
  return '<fieldset id="receiverChoices" class="receiver-choices" aria-describedby="receiverFeedback"><legend>Who would you like to pay?</legend><div class="receiver-grid">'+cards+'</div></fieldset>'+
    '<p id="receiverFeedback" class="sub receiver-feedback" role="status">'+esc(help)+'</p><div id="receiverActions" class="receiver-actions">'+receiverActions(r,r.chosenReceiverId)+'</div>'+refresh;
}
async function saveReceiverChoice(r,group){
  const feedback=el('receiverFeedback'),actions=el('receiverActions');
  feedback.textContent='Saving your choice…';actions.innerHTML=receiverActions(r,'');
  try{
    while(group.isConnected&&r===currentReceipt){
      const wanted=group.dataset.wanted;
      const saved=await playerApi('playerSelectReceiver',r.ticket,wanted,String(r.receiverChoiceVersion));
      if(!group.isConnected||r!==currentReceipt)return;
      if(saved.unavailable){
        const option=Array.from(group.querySelectorAll('input')).find(input=>input.value===wanted);
        option?.closest('label').remove();
        r.checkoutReceivers=r.checkoutReceivers.filter(x=>x.id!==wanted);
        if(group.dataset.wanted!==wanted)continue;
        r.chosenReceiverId='';feedback.textContent=r.checkoutReceivers.length?'That receiver is unavailable. Choose another account.':'Payments are paused. You can still submit proof if you already paid.';
        return;
      }
      r.receiverChoiceVersion=saved.receiverChoiceVersion;r.receiver=saved.receiver;
      if(saved.conflict)throw Error('Your choice changed in another window.');
      r.chosenReceiverId=saved.receiver.id;
      if(group.dataset.wanted!==wanted)continue;
      actions.innerHTML=receiverActions(r,wanted);feedback.textContent='Selected · '+saved.receiver.name;
      return;
    }
  }catch(error){
    if(group.isConnected&&r===currentReceipt){
      r.chosenReceiverId='';
      for(const radio of group.querySelectorAll('input'))radio.checked=false;
      feedback.textContent=error.message+' Choose again to retry.';
    }
  }finally{delete group.pendingChoice}
}
document.addEventListener('change',e=>{
  const input=e.target;
  if(input.name!=='checkoutReceiver'||!input.checked)return;
  const group=input.closest('fieldset');group.dataset.wanted=input.value;
  group.pendingChoice??=saveReceiverChoice(currentReceipt,group);
  if(checkoutNeedsUpdate())refreshCheckoutQuote();
});
function proofForm(r){
  const c=r.claim||{},person=accountInfo?.player||{},name=r.details?.fullName||person.name||'';
  const recipients=(r.paymentRecipients||[]).map(x=>'<option value="'+esc(x.id)+'">'+esc(x.name)+'</option>').join('');
  return panel(r.proofVersion?'Replace payment proof':'Payment proof','<form data-action="submitPayment" novalidate>'+
    '<label for="shot">Payment screenshot</label><input id="shot" type="file" accept="image/jpeg,image/png,image/webp" required aria-describedby="proofLimit proofHint"><p id="proofLimit" class="sub">One JPEG, PNG or WebP image, up to 10 MB.</p><p id="proofHint" class="sub">Keep the UTR / UPI Transaction ID visible in your screenshot.</p>'+
    '<p class="sub draft-note" id="proofDraftNote"></p><p id="ocrFeedback" class="sub" role="status">Choose a screenshot to read its payment details.</p>'+
    '<div id="proofFields" hidden>'+input('paymentUtr','UTR / UPI Transaction ID','inputmode="numeric" maxlength="12" required value="'+esc(c.utr||'')+'"')+
    input('paymentAmount','Amount paid (₹)','inputmode="decimal" required value="'+esc(c.amount?(c.amount/100).toFixed(2):'')+'"')+
    input('paymentTime','Payment time (IST)','type="datetime-local" required value="'+esc(c.time||'')+'"')+
    '<label for="paidReceiver">Please confirm the recipient of your payment</label><select id="paidReceiver" required><option value="">Choose who received the payment</option>'+recipients+'</select>'+input('paymentPayer','Who made the payment?','maxlength="90" autocomplete="name" required value="'+esc(c.payer||name)+'"')+
    '<label for="beneficiaryName">Who was the payment for?</label><input id="beneficiaryName" readonly value="'+esc([name,r.beneficiary].filter(Boolean).join(' · '))+'"><input type="hidden" id="beneficiary" value="'+esc(r.beneficiary)+'">'+
    '<p class="sub">If you paid for a friend, they can submit your screenshot from their own registration.</p>'+
    checkbox('fairPlay',r.fairPlay)+'</div>'+
    '<button class="primary wide" type="submit">Submit for verification</button></form>');
}
const paymentFields=['paymentUtr','paymentAmount','paymentTime','paidReceiver','paymentPayer','fairPlay','tail','consent'];
function rememberPaymentFields(form){
  const state=form?.proofDraft;
  if(!state||!form.isConnected||draftValue(form.dataset.proofKey)?.marker!==state.marker)return;
  for(const id of paymentFields){
    const field=el(id);if(field)state.fields[id]=field.type==='checkbox'?field.checked:field.value;
  }
  state.edited=['paymentUtr','paymentAmount','paymentTime'].filter(id=>el(id)?.dataset.edited);
  saveDeviceValue(form.dataset.proofKey,JSON.stringify(state));
}
function stageDraftFile(input,file){
  const form=input.form,key=form.dataset.proofKey,old=form.proofDraft;
  form.savedFile=null;form.proofDraft=null;
  if(!file||!['image/jpeg','image/png','image/webp'].includes(file.type)||!file.size||file.size>10*1024*1024){
    if(old)removeProofDraft(key,old.marker);return;
  }
  const owner=currentReceipt.beneficiary;
  const state={marker:crypto.randomUUID(),revision:currentReceipt.proofVersion||0,agreement:currentReceipt.fairPlayVersion,name:file.name,size:file.size,type:file.type,fields:{},edited:[]};
  form.proofDraft=state;saveDeviceValue(key,JSON.stringify(state));rememberPaymentFields(form);
  proofStore('readwrite',store=>{
    if(draftValue(key)?.marker===state.marker)return store.put({key,owner,marker:state.marker,file});
  }).then(savedKey=>{
    if(!form.isConnected||form.proofDraft!==state)return;
    el('proofDraftNote').textContent=savedKey===key&&unpack(durable.get(key))?.marker===state.marker?'Screenshot saved on this device.':'Keep the original screenshot. This browser could not save a copy for your return.';
  }).catch(()=>{
    if(form.isConnected&&form.proofDraft===state)el('proofDraftNote').textContent='Keep the original screenshot. This browser could not save a copy for your return.';
  });
}
async function mountPaymentDraft(r){
  const key=draftKey('proof',r.beneficiary,r.id),saved=draftValue(key),input=el('shot');
  if(saved&&(saved.revision!==(r.proofVersion||0)||saved.agreement!==r.fairPlayVersion||!input)){
    removeProofDraft(key,saved.marker);return;
  }
  if(!input)return;
  const form=input.form;form.dataset.proofKey=key;
  if(!saved){openProofDatabase().catch(()=>{});return}
  form.proofDraft=saved;
  const disclosure=input.closest('details');if(disclosure)disclosure.open=true;
  for(const [id,value] of Object.entries(saved.fields||{})){
    const field=paymentFields.includes(id)&&el(id);if(!field)continue;
    if(field.type==='checkbox')field.checked=value===true;else field.value=value;
    if(saved.edited?.includes(id))field.dataset.edited='yes';
  }
  if(el('proofFields'))el('proofFields').hidden=false;
  const note=el('proofDraftNote');note.textContent='Restoring your screenshot…';
  let record;try{record=await proofStore('readonly',store=>store.get(key))}catch{}
  if(!form.isConnected||form.proofDraft!==saved||input.files?.length)return;
  if(!record?.file||record.marker!==saved.marker){
    form.needsFile=true;note.textContent='Your payment details are restored. Attach your screenshot to submit them.';return;
  }
  const file=record.file instanceof File?record.file:new File([record.file],saved.name,{type:record.file.type});
  form.savedFile=file;
  try{const transfer=new DataTransfer();transfer.items.add(file);input.files=transfer.files}catch{}
  note.textContent='Restored screenshot · '+file.name;
  if(el('proofFields'))await readSelectedProof(input,true);
}
function originalScreenshot(file){
  if(!file||!['image/png','image/jpeg','image/webp'].includes(file.type)||file.size<1||file.size>10*1024*1024)throw Error('Choose one JPEG, PNG or WebP screenshot up to 10 MB.');
  return new Promise((resolve,reject)=>{
    const reader=new FileReader();
    reader.onerror=()=>reject(Error('Could not read this screenshot. Choose the file again.'));
    reader.onload=()=>resolve(reader.result);
    reader.readAsDataURL(file);
  });
}
async function readSelectedProof(input,restoring=false){
  const form=input.form,file=input.files[0]||(restoring?form.savedFile:null),generation=++readGeneration,ticket=currentReceipt?.ticket;
  const feedback=el('ocrFeedback'),fields=el('proofFields'),submit=input.form.querySelector('button[type=submit]');
  const readFields={utr:el('paymentUtr'),amount:el('paymentAmount'),time:el('paymentTime')};
  if(!restoring){
    const saved=form.proofDraft,reattached=form.needsFile&&file&&file.name===saved?.name&&file.size===saved.size&&file.type===saved.type;
    if(!reattached)for(const field of Object.values(readFields)){field.value='';delete field.dataset.edited}
    form.needsFile=false;
    el('proofDraftNote').textContent='';stageDraftFile(input,file);
  }
  const draft=form.proofDraft;
  proofRead=null;fields.hidden=!restoring;submit.disabled=false;
  if(!file){feedback.textContent='Choose a screenshot to read its payment details.';return}
  submit.disabled=true;feedback.textContent='Reading your screenshot… You can fill in the payment details now.';
  const current=()=>generation===readGeneration&&input.isConnected;
  try{
    const data=await originalScreenshot(file);
    if(!current())return;
    fields.hidden=false;
    let ocr;
    try{ocr=restoring&&draft?.ocr?draft.ocr:await playerApi('playerReadProof',ticket,data)}
    catch(error){ocr={message:'Enter the details for manual review. '+error.message}}
    if(!current())return;
    proofRead={data,ocr,ticket,file};
    for(const [key,field] of Object.entries(readFields))if(!field.dataset.edited)field.value=ocr[key]||'';
    feedback.textContent=ocr.message;
    if(draft){if(ocr.seal)draft.ocr=ocr;rememberPaymentFields(form)}
  }catch(error){if(current()){feedback.textContent=error.message;fieldError('shot',error.message)}}
  finally{if(current())submit.disabled=false}
}
document.addEventListener('input',e=>{
  if(['paymentUtr','paymentAmount','paymentTime'].includes(e.target.id))e.target.dataset.edited='yes';
  if(paymentFields.includes(e.target.id))rememberPaymentFields(e.target.form);
});
document.addEventListener('change',e=>{
  if(e.target.id==='shot'){
    if(el('proofFields'))readSelectedProof(e.target);else{el('proofDraftNote').textContent='';stageDraftFile(e.target,e.target.files[0])}
  }else if(paymentFields.includes(e.target.id))rememberPaymentFields(e.target.form);
});
async function submitPaymentProof(){
  const r=currentReceipt,shot=el('shot'),choices=el('receiverChoices');
  if(choices&&!el('checkoutPayment')?.hidden&&choices.querySelector('input:enabled')&&(!r.chosenReceiverId||choices.pendingChoice)){
    el('receiverFeedback').textContent=choices.pendingChoice?'Saving your choice. Submit after it is confirmed.':'Choose the receiver you paid before submitting.';
    choices.querySelector('input:enabled').focus();return;
  }
  if(!proofRead||proofRead.file!==(shot?.files[0]||shot?.form.savedFile)||proofRead.ticket!==r.ticket){fieldError('shot','Choose a screenshot and wait for it to be read.');return}
  const fields=[['paymentUtr',/^\d{12}$/,'Enter the full 12-digit bank UTR.'],['paymentAmount',/^\d+(?:\.\d{1,2})?$/,'Enter the amount shown on the receipt.'],['paymentTime',/.+/,'Enter the date and time from the receipt.'],['paidReceiver',/.+/,'Select the person who received your payment.'],['paymentPayer',/^.{2,90}$/,'Enter the name of the person who paid.'],['beneficiary',/.+/,'Choose the player this payment was for.']];
  for(const [id,pattern,message] of fields)if(!pattern.test(val(id))){fieldError(id,message);return}
  if(!el('fairPlay').checked){fieldError('fairPlay','Confirm the fair-play declaration to continue.');return}
  const form={utr:val('paymentUtr'),amount:val('paymentAmount'),time:val('paymentTime'),payer:val('paymentPayer'),beneficiary:val('beneficiary'),receiver:r.receiver.id,receiverChoiceVersion:r.receiverChoiceVersion,paidReceiver:val('paidReceiver'),agreementVersion:r.fairPlayVersion,revision:r.proofVersion,fairPlay:true,ocr:proofRead.ocr};
  if(choices)choices.disabled=true;
  const proof=proofRead,details=JSON.stringify(form);
  try{
    let saved=await playerApi('playerSubmitPayment',r.ticket,proof.ocr.uploadRef||proof.data,details);
    if(saved.uploadRequired)saved=await playerApi('playerSubmitPayment',r.ticket,proof.data,details);
    if(currentReceipt===r){removeProofDraft(shot.form.dataset.proofKey,shot.form.proofDraft?.marker);showReceipt(saved)}
  }
  finally{if(choices?.isConnected)choices.disabled=false}
}
