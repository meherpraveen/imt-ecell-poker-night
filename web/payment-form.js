'use strict';
let readGeneration=0;
function receiverRecovery(r){
  return panel('Confirm your original receiver','<p>This registration predates the receiver list. Select the account shown on your payment receipt.</p><label for="originalReceiver">Who did you pay?</label><select id="originalReceiver"><option value="">Choose the receiver</option>'+
    r.identifyReceivers.map(x=>'<option value="'+esc(x.id)+'">'+esc(x.name+' · '+x.upi)+'</option>').join('')+'</select>'+btn('identifyReceiver','Save receiver','primary'));
}
function paymentTools(receiver,qrImageId){
  if(!receiver)return '';
  const name=esc(receiver.name),suffix='<span class="sr-only"> for '+name+'</span>';
  const copy=(label,value)=>value?'<button type="button" data-payment-copy="'+label+'" data-value="'+esc(value)+'">Copy '+label+suffix+'</button>':'';
  const mime=/^data:image\/(gif|png|jpeg);base64,/.exec(receiver.qr||'');
  const stem=receiver.name.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'')||'receiver';
  const save=mime?'<a class="button" data-save-qr="'+esc(qrImageId)+'" download="payment-qr-'+stem+'.'+(mime[1]==='jpeg'?'jpg':mime[1])+'" href="'+esc(receiver.qr)+'">Save QR'+suffix+'</a>':'';
  return '<div class="payment-tools" role="group" aria-label="Payment details for '+name+'"><div class="payment-buttons">'+
    copy('UPI ID',receiver.upi)+save+copy('number',receiver.number)+'</div><p class="sub payment-feedback" role="status"></p>'+
    '<input class="payment-copy-field" aria-label="Payment detail to copy" readonly inputmode="none" spellcheck="false" hidden></div>';
}
function receiverActions(r,id){
  const receiver=r.checkoutReceivers.find(option=>option.id===id);
  return receiver?paymentTools(receiver,'upi-qr-'+receiver.id):'';
}
async function copyPaymentDetail(button){
  const box=button.closest('.payment-tools'),status=box.querySelector('[role=status]'),field=box.querySelector('input');
  const value=button.dataset.value,label=button.dataset.paymentCopy==='number'?'UPI number':'UPI ID';
  const request=box.copyRequest={};
  field.hidden=true;status.textContent='';
  try{
    await navigator.clipboard.writeText(value);
    if(box.isConnected&&box.copyRequest===request)status.textContent=label+' copied.';
  }catch{
    if(!box.isConnected||box.copyRequest!==request)return;
    field.setAttribute('aria-label',label+' to copy');field.value=value;field.hidden=false;
    field.focus();field.select();field.setSelectionRange(0,value.length);
    status.textContent='Touch and hold or use your keyboard to copy the selected '+label+'.';
  }
}
function prepareQrDownload(link,img){
  // Keep the verified pixels and quiet zone. PNG can be imported from a mobile photo library.
  if(!link.href.startsWith('data:image/gif;'))return;
  const factor=Math.max(1,Math.ceil(512/Math.max(img.naturalWidth,img.naturalHeight)));
  const canvas=document.createElement('canvas');
  canvas.width=img.naturalWidth*factor;canvas.height=img.naturalHeight*factor;
  const ctx=canvas.getContext('2d');ctx.imageSmoothingEnabled=false;ctx.drawImage(img,0,0,canvas.width,canvas.height);
  link.href=canvas.toDataURL('image/png');link.download=link.download.replace(/\.gif$/,'.png');
}
function offerQrDownload(link,status,message){
  if(!link.isConnected)return;
  const fallback=document.createElement('a');fallback.href=link.href;fallback.download=link.download;fallback.textContent='Download QR image';
  status.replaceChildren(document.createTextNode(message+' '),fallback);
}
async function savePaymentQr(event,link){
  const box=link.closest('.payment-tools'),status=box.querySelector('[role=status]'),img=el(link.dataset.saveQr);
  if(link.href.startsWith('data:image/gif;')&&img&&!img.naturalWidth){
    event.preventDefault();status.textContent='Preparing the QR image…';
    try{await img.decode();if(!link.isConnected)return;prepareQrDownload(link,img)}catch{}
    offerQrDownload(link,status,'Tap to save the QR.');return;
  }
  if(img?.naturalWidth){try{prepareQrDownload(link,img)}catch{/* The original image is still downloadable. */}}
  const appleMobile=/iPhone|iPad|iPod/.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);
  if(appleMobile&&navigator.canShare&&navigator.share){
    try{
      const url=link.href,comma=url.indexOf(','),bytes=Uint8Array.from(atob(url.slice(comma+1)),c=>c.charCodeAt(0));
      const file=new File([bytes],link.download,{type:url.slice(5,url.indexOf(';'))});
      if(navigator.canShare({files:[file]})){
        event.preventDefault();
        status.textContent='Choose Save Image or Save to Files in the share sheet.';
        try{await navigator.share({files:[file]})}
        catch(error){offerQrDownload(link,status,error.name==='AbortError'?'Save cancelled.':'You can download the image or touch and hold the QR.');return}
        if(link.isConnected)status.textContent='';
        return;
      }
    }catch{/* Use the browser download when file sharing is unavailable. */}
  }
  status.textContent='Look in your downloads for the QR image. You can also touch and hold the QR to save it.';
}
document.addEventListener('click',event=>{
  const control=event.target.closest('[data-payment-copy],[data-save-qr]');
  if(!control||event.defaultPrevented)return;
  if(checkoutNeedsUpdate()){event.preventDefault();refreshCheckoutQuote();return}
  if(control.hasAttribute('data-payment-copy'))copyPaymentDetail(control);else savePaymentQr(event,control);
});
function choosePaymentReceiver(r){
  const options=r.checkoutReceivers;
  if(!options.length)return '<p>Payment is paused. If you already paid, upload your screenshot below.</p>'+btn('receipt','Refresh payment details');
  const cards=options.map(x=>{
    const checked=r.chosenReceiverId===x.id;
    const radio='<input type="radio" name="checkoutReceiver" value="'+esc(x.id)+'" aria-label="'+esc(x.name)+'"'+(checked?' checked':'')+(x.qr||x.upi||x.number?'':' disabled')+'>';
    const code=x.qr?'<img id="upi-qr-'+esc(x.id)+'" width="192" height="192" alt="UPI payment QR for '+esc(x.name)+'" src="'+esc(x.qr)+'">':'<span class="qr-unavailable">QR unavailable</span>';
    return '<label class="receiver-card">'+code+'<span class="receiver-name">'+radio+'<strong>'+esc(x.name)+'</strong></span><small>'+esc(x.upi)+'</small>'+(x.number?'<small>UPI no. '+esc(x.number)+'</small>':'')+'</label>';
  }).join('');
  const selected=options.find(x=>x.id===r.chosenReceiverId);
  const help=selected?'Selected · '+selected.name:'Choose the account you will pay.';
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
      const shown=r.checkoutReceivers.find(option=>option.id===wanted);
      if(shown?.revision!==saved.receiver.revision){refreshCheckoutQuote();return}
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
