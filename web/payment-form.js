'use strict';
let proofRead=null,readGeneration=0;
function receiverRecovery(r){
  return panel('Confirm your original receiver','<p>This registration predates the receiver list. Select the account shown on your payment receipt.</p><label for="originalReceiver">Who did you pay?</label><select id="originalReceiver"><option value="">Choose the receiver</option>'+
    r.identifyReceivers.map(x=>'<option value="'+esc(x.id)+'">'+esc(x.name+' · '+x.upi)+'</option>').join('')+'</select>'+btn('identifyReceiver','Save receiver','primary'));
}
function choosePaymentReceiver(r){
  const active=(r.paymentRecipients||[]).filter(x=>x.active);
  if(!r.canChooseReceiver||!active.some(x=>x.id!==r.receiver.id))return '';
  const options=active.map(x=>'<option value="'+esc(x.id)+'"'+(x.id===r.receiver.id?' selected':'')+'>'+esc(x.name)+'</option>').join('');
  return '<details><summary>Choose a payment receiver</summary><label for="checkoutReceiver">Who would you like to pay?</label><select id="checkoutReceiver">'+options+'</select>'+btn('selectReceiver','Show selected QR')+'</details>';
}
function proofForm(r){
  const c=r.claim||{},person=accountInfo?.player||{},name=r.details?.fullName||person.name||'';
  const recipients=(r.paymentRecipients||[]).map(x=>'<option value="'+esc(x.id)+'">'+esc(x.name)+'</option>').join('');
  return panel(r.proofVersion?'Replace payment proof':'Payment proof','<form data-action="submitPayment" novalidate>'+
    '<label for="shot">Payment screenshot</label><input id="shot" type="file" accept="image/jpeg,image/png,image/webp" required aria-describedby="proofLimit proofHint"><p id="proofLimit" class="sub">One JPEG, PNG or WebP image, up to 10 MB.</p><p id="proofHint" class="sub">Keep the UTR / UPI Transaction ID visible in your screenshot.</p>'+
    '<p id="ocrFeedback" class="sub" role="status">Choose a screenshot to read its payment details.</p>'+
    '<div id="proofFields" hidden>'+input('paymentUtr','UTR / UPI Transaction ID','inputmode="numeric" maxlength="12" required value="'+esc(c.utr||'')+'"')+
    input('paymentAmount','Amount paid (₹)','inputmode="decimal" required value="'+esc(c.amount?(c.amount/100).toFixed(2):'')+'"')+
    input('paymentTime','Payment time (IST)','type="datetime-local" required value="'+esc(c.time||'')+'"')+
    '<label for="paidReceiver">Please confirm the recipient of your payment</label><select id="paidReceiver" required><option value="">Choose who received the payment</option>'+recipients+'</select>'+input('paymentPayer','Who made the payment?','maxlength="90" autocomplete="name" required value="'+esc(c.payer||name)+'"')+
    '<label for="beneficiary">Who was the payment for?</label><select id="beneficiary" required><option value="">Choose the player</option><option value="'+esc(r.beneficiary)+'">'+esc([name,r.beneficiary].filter(Boolean).join(' · '))+'</option></select>'+
    '<p class="sub">If you paid for a friend, they can submit your screenshot from their own registration.</p>'+
    checkbox('fairPlay',r.fairPlay)+'</div>'+
    '<button class="primary wide" type="submit">Submit for verification</button></form>');
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
async function readSelectedProof(input){
  const file=input.files[0],generation=++readGeneration,ticket=currentReceipt?.ticket;
  proofRead=null;
  if(!file)return;
  const feedback=el('ocrFeedback'),fields=el('proofFields'),submit=input.form.querySelector('button[type=submit]');
  fields.hidden=true;submit.disabled=true;feedback.textContent='Reading the payment screenshot…';
  try{
    const data=await originalScreenshot(file);let ocr;
    try{ocr=await playerApi('playerReadProof',ticket,data)}catch(error){ocr={message:'Automatic reading was unsuccessful. Enter the details for manual review. '+error.message}}
    if(generation!==readGeneration||!input.isConnected)return;
    proofRead={data,ocr,ticket,file};
    for(const [key,id] of [['utr','paymentUtr'],['amount','paymentAmount'],['time','paymentTime']])el(id).value=ocr[key]||'';
    feedback.textContent=ocr.message;fields.hidden=false;
  }catch(error){if(input.isConnected&&generation===readGeneration){feedback.textContent=error.message;fieldError('shot',error.message)}}
  finally{if(input.isConnected&&generation===readGeneration)submit.disabled=false}
}
document.addEventListener('change',e=>{if(e.target.id==='shot'&&el('proofFields'))readSelectedProof(e.target)});
async function submitPaymentProof(){
  const r=currentReceipt,shot=el('shot');
  if(!shot?.files[0]||proofRead?.file!==shot.files[0]||proofRead.ticket!==r.ticket){fieldError('shot','Choose a screenshot and wait for it to be read.');return}
  const fields=[['paymentUtr',/^\d{12}$/,'Enter the full 12-digit bank UTR.'],['paymentAmount',/^\d+(?:\.\d{1,2})?$/,'Enter the amount shown on the receipt.'],['paymentTime',/.+/,'Enter the date and time from the receipt.'],['paidReceiver',/.+/,'Select the person who received your payment.'],['paymentPayer',/^.{2,90}$/,'Enter the name of the person who paid.'],['beneficiary',/.+/,'Choose the player this payment was for.']];
  for(const [id,pattern,message] of fields)if(!pattern.test(val(id))){fieldError(id,message);return}
  if(!el('fairPlay').checked){fieldError('fairPlay','Confirm the fair-play declaration to continue.');return}
  const form={utr:val('paymentUtr'),amount:val('paymentAmount'),time:val('paymentTime'),payer:val('paymentPayer'),beneficiary:val('beneficiary'),receiver:r.receiver.id,paidReceiver:val('paidReceiver'),agreementVersion:r.fairPlayVersion,revision:r.proofVersion,fairPlay:true,ocr:proofRead.ocr};
  const saved=await playerApi('playerSubmitPayment',r.ticket,proofRead.data,JSON.stringify(form));proofRead=null;showReceipt(saved);
}
