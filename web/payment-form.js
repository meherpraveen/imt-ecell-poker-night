'use strict';
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
  const selected=options.find(x=>x.id===r.chosenReceiverId)||options.find(x=>x.qr)||options[0];
  const cards=options.map(x=>{
    const checked=selected.id===x.id;
    const radio='<input type="radio" name="checkoutReceiver" value="'+esc(x.id)+'" aria-label="'+esc(x.name)+'"'+(checked?' checked':'')+(x.qr||x.upi||x.number?'':' disabled')+'>';
    const code=x.qr?'<img id="upi-qr-'+esc(x.id)+'" width="192" height="192" alt="UPI payment QR for '+esc(x.name)+'" src="'+esc(x.qr)+'">':'<span class="qr-unavailable">QR unavailable</span>';
    return '<label class="receiver-card">'+code+'<span class="receiver-name">'+radio+'<strong>'+esc(x.name)+'</strong></span><small>'+esc(x.upi)+'</small>'+(x.number?'<small>UPI no. '+esc(x.number)+'</small>':'')+'</label>';
  }).join('');
  const help='Selected · '+selected.name;
  const refresh=options.some(x=>!x.qr)?btn('receipt','Refresh unavailable QR','quiet'):'';
  return '<fieldset id="receiverChoices" class="receiver-choices" aria-describedby="receiverFeedback"><legend>Payment QR</legend><div class="receiver-grid">'+cards+'</div></fieldset>'+
    '<p id="receiverFeedback" class="sub receiver-feedback" role="status">'+esc(help)+'</p><div id="receiverActions" class="receiver-actions">'+receiverActions(r,selected.id)+'</div>'+refresh;
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
function proofForm(){
  return panel('Upload your payment screenshot','<form data-action="submitPayment" novalidate>'+
    '<label for="shot">Payment screenshot</label><input id="shot" type="file" accept="image/jpeg,image/png,image/webp" required aria-describedby="proofLimit proofDraftNote">'+
    '<p id="proofLimit" class="sub">JPEG, PNG or WebP, up to 10 MB.</p><p id="proofDraftNote" class="sub draft-note" role="status"></p>'+
    '<button class="primary wide" type="submit">Submit screenshot</button></form>');
}
function stageDraftFile(input,file){
  const form=input.form,key=form.dataset.proofKey,old=form.proofDraft;
  form.savedFile=null;form.proofDraft=null;
  if(!file||!['image/jpeg','image/png','image/webp'].includes(file.type)||!file.size||file.size>10*1024*1024){
    if(old)removeProofDraft(key,old.marker);
    if(file)fieldError('shot','Choose one JPEG, PNG or WebP screenshot up to 10 MB.');
    return;
  }
  const owner=currentReceipt.beneficiary;
  const state={marker:crypto.randomUUID(),revision:currentReceipt.proofVersion||0,name:file.name,size:file.size,type:file.type};
  form.proofDraft=state;saveDeviceValue(key,JSON.stringify(state));
  file.arrayBuffer().then(bytes=>proofStore('readwrite',store=>{
    if(draftValue(key)?.marker===state.marker)return store.put({key,owner,marker:state.marker,bytes});
  })).then(savedKey=>{
    if(!form.isConnected||form.proofDraft!==state)return;
    el('proofDraftNote').textContent=savedKey===key&&unpack(durable.get(key))?.marker===state.marker?'Screenshot saved on this device.':'Keep the original screenshot. This browser could not save a copy for your return.';
  }).catch(()=>{
    if(form.isConnected&&form.proofDraft===state)el('proofDraftNote').textContent='Keep the original screenshot. This browser could not save a copy for your return.';
  });
}
async function mountPaymentDraft(r){
  const key=draftKey('proof',r.beneficiary,r.id),saved=draftValue(key),input=el('shot');
  if(saved&&(saved.revision!==(r.proofVersion||0)||!input)){
    removeProofDraft(key,saved.marker);return;
  }
  if(!input)return;
  const form=input.form;form.dataset.proofKey=key;
  if(!saved){openProofDatabase().catch(()=>{});return}
  form.proofDraft=saved;
  const disclosure=input.closest('details');if(disclosure)disclosure.open=true;
  const note=el('proofDraftNote');note.textContent='Restoring your screenshot…';
  let record;try{record=await proofStore('readonly',store=>store.get(key))}catch{}
  if(!form.isConnected||form.proofDraft!==saved||input.files?.length)return;
  const original=record?.bytes||record?.file;
  if(!original||record.marker!==saved.marker){
    note.textContent='Choose your screenshot again to submit it.';return;
  }
  const file=original instanceof File?original:new File([original],saved.name,{type:saved.type});
  form.savedFile=file;
  try{const transfer=new DataTransfer();transfer.items.add(file);input.files=transfer.files}catch{}
  note.textContent='Restored screenshot · '+file.name;
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
document.addEventListener('change',event=>{
  if(event.target.id!=='shot')return;
  el('proofDraftNote').textContent='';
  stageDraftFile(event.target,event.target.files[0]);
});
async function submitPaymentProof(){
  const r=currentReceipt,shot=el('shot'),form=shot.form,file=shot.files[0]||form.savedFile;
  if(!file){fieldError('shot','Choose your payment screenshot.');return}
  shot.disabled=true;
  try{
    let data;
    try{data=await originalScreenshot(file)}catch(error){fieldError('shot',error.message);return}
    const saved=await playerApi('playerSubmitScreenshot',r.ticket,data,String(r.proofVersion||0));
    if(currentReceipt!==r)return;
    removeProofDraft(form.dataset.proofKey,form.proofDraft?.marker);
    showReceipt(saved);
  }finally{if(shot.isConnected)shot.disabled=false}
}
