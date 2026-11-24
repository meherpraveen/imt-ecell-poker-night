'use strict';
let statementPreview,reviewPayment,receiverEdit;
function receiverSettings(p){
  const lines=p.receivers.map(r=>'<li>'+btn('bankReceiver',r.name+' · '+(r.active?'Active':'Disabled'),'',r.id)+'<small>'+esc(r.upi)+'</small></li>').join('');
  return '<div class="desk-form-group"><h3>UPI receivers</h3><p class="desk-hint">New checkouts use an active receiver. Each player keeps the account and fee they were shown.</p>'+
    (lines?'<ul class="bank-list">'+lines+'</ul>':'')+btn('bankReceiver','Add receiver')+'</div>';
}
function receiverDialog(id){
  receiverEdit=snapshot.settings.receivers.find(x=>x.id===id)||null;
  const r=receiverEdit||{};
  detail('<h2>'+(r.id?'Edit receiver':'Add receiver')+'</h2>'+input('receiverName','Receiver name','maxlength="80" value="'+esc(r.name||'')+'"')+
    input('receiverUpi','UPI ID','autocapitalize="none" value="'+esc(r.upi||'')+'"')+input('receiverNumber','UPI number (optional)','inputmode="numeric" maxlength="10" value="'+esc(r.number||'')+'"')+
    '<label for="receiverQr">Payment QR image</label><input id="receiverQr" type="file" accept="image/png,image/jpeg,image/webp">'+
    '<p class="desk-hint">The QR must pay this UPI ID with a blank amount and payment note.</p>'+deskSwitch('receiverActive','Active for new checkouts',r.active!==false)+btn('bankSaveReceiver','Save receiver','primary wide'));
}
function bankDeskLinks(){
  if(!snapshot.settings||!snapshot.managed)return '';
  return deskLink('bankStatements','Bank statements','credit-card')+deskLink('bankQueue','Needs Review','inbox')+
    (snapshot.settings.unsent?deskLink('bankDispatch','Send pending passes ('+snapshot.settings.unsent+')','arrow-right'):'');
}
function bankStatementsDialog(){
  const p=snapshot.settings,options=p.receivers.map(r=>'<option value="'+esc(r.id)+'">'+esc(r.name+' · '+r.upi)+'</option>').join('');
  const old=p.statements.map(s=>'<li>'+btn('bankPreview',s.name,'',s.id)+'<small>'+esc(s.receiver)+' · '+(s.applied?'Applied':'Preview only')+'</small></li>').join('');
  detail('<h2>Bank statements</h2><label for="bankReceiverId">Receiving account on the statement</label><select id="bankReceiverId"><option value="">Select a receiver</option>'+options+'</select>'+
    '<label for="bankFile">Statement file</label><input id="bankFile" type="file" accept=".csv,.xls,.xlsx,.pdf"><p class="desk-hint">CSV, Excel or unlocked PDF, up to 6 MB. Include the bank date, UTR, amount and credit/debit direction.</p>'+
    checkbox('bankAccountChecked','I checked that this statement belongs to the selected receiving account.')+btn('bankUpload','Preview matches','primary wide')+
    (old?'<h3>Recent statements</h3><ul class="bank-list">'+old+'</ul>':''));
}
function bankFileBase64(file){
  return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onerror=()=>reject(Error('Could not read this file. Select it again.'));reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.readAsDataURL(file)});
}
function bankPlanDialog(plan){
  statementPreview=plan;const good=plan.matches.filter(m=>!m.reason),review=plan.matches.filter(m=>m.reason);
  const list=items=>'<ul class="bank-list">'+items.map(m=>'<li><strong>'+esc(m.roll||m.line)+'</strong><small>'+esc([m.utr,m.reason||'Exact unused credit'].filter(Boolean).join(' · '))+'</small></li>').join('')+'</ul>';
  detail('<h2>Statement preview</h2><p>'+esc(plan.statement.name)+' · '+esc(plan.statement.receiver)+'</p><dl class="details-list"><div><dt>Ready to authorize</dt><dd>'+good.length+'</dd></div><div><dt>Needs Review</dt><dd>'+review.length+'</dd></div><div><dt>Other statement rows</dt><dd>'+plan.unassigned.length+'</dd></div></dl>'+
    (good.length?'<details><summary>Matched students</summary>'+list(good)+'</details>':'')+(review.length?'<details open><summary>Needs Review</summary>'+list(review)+'</details>':'')+
    (plan.unassigned.length?'<details><summary>Other statement rows</summary>'+list(plan.unassigned)+'</details>':'')+
    btn('bankApply','Apply preview','primary wide')+btn('bankPreview','Refresh preview','',plan.statement.id));
}
async function dispatchBankPasses(){
  let failed=0,result;
  do{result=await deskApi('adminDispatchPasses',token);failed+=result.failed}while(result.remaining);
  return failed?failed+' pass email(s) need desk delivery.':'Pass delivery is up to date.';
}
function bankReviewDialog(id,query=''){
  const previous=el('dialog').open&&reviewPayment?.id===id?reviewPayment:null;
  const reason=previous?el('bankReason')?.value||'':'';
  const review={id,proofVisible:false};
  reviewPayment=review;opened=id;
  detail('<h2>Review payment</h2><p role="status">Loading payment details…</p>');
  // Read the image alongside the statement lookup. A slow image must never lock the desk.
  const readImage=()=>deskApi('proofImage',token,id,true).then(value=>({value}),error=>({error}));
  review.image=previous?.image||readImage();
  const current=()=>reviewPayment===review&&opened===id&&el('dialog').open;
  async function load(){
    const r=await deskApi('adminPaymentDetail',token,id,query);
    if(!current())return;
    Object.assign(review,r);
    renderBankReview(r,query);
    if(previous?.version===r.version&&reason)el('bankReason').value=reason;
    let image=await review.image;
    if(!current())return;
    if(image.value&&image.value.version!==r.version){review.image=readImage();image=await review.image}
    if(!current())return;
    const slot=el('bankProofImage');
    if(image.error||image.value?.version!==r.version){
      review.image=null;
      slot.textContent=image.error?'The screenshot could not be loaded. ':'The screenshot changed. ';
      slot.insertAdjacentHTML('beforeend',btn('bankReview','Reload payment','',id));return;
    }
    const picture=new Image();picture.className='shot';picture.alt='Student payment screenshot';picture.src=image.value.data;
    try{await picture.decode()}catch{if(current()){review.image=null;slot.textContent='The image could not be opened. ';slot.insertAdjacentHTML('beforeend',btn('bankReview','Reload payment','',id))}return}
    if(!current())return;
    const zoom=document.createElement('button');zoom.type='button';zoom.className='bank-proof-zoom';
    zoom.setAttribute('aria-label','Enlarge payment screenshot');zoom.setAttribute('aria-pressed','false');
    zoom.addEventListener('click',()=>{
      const enlarge=zoom.getAttribute('aria-pressed')==='false';
      zoom.setAttribute('aria-pressed',String(enlarge));zoom.setAttribute('aria-label',enlarge?'Fit payment screenshot':'Enlarge payment screenshot');
      slot.scrollTo(0,0);
    });
    zoom.append(picture);slot.replaceChildren(zoom);review.proofVisible=true;
  }
  load().catch(error=>{
    if(current())detail('<h2>Review payment</h2><p role="alert">'+esc(error.message||'Payment details could not be loaded.')+'</p>'+btn('bankReview','Retry loading payment','',id));
  });
}
function renderBankReview(r,query){
  const c=r.claim||{},money=n=>n==null?'Unknown':formatFee_(n/100),options=r.rows.map(x=>'<option value="'+esc(x.key)+'"'+(x.key===r.linked?' selected':'')+'>'+esc([x.source,x.line,x.utr||'No UTR',money(x.minor)].join(' · '))+'</option>').join('');
  const rows=r.rows.map(x=>'<li><strong>'+esc(x.line+' · '+x.source)+'</strong><small>'+esc(x.raw)+'</small><small>'+esc(x.issue||x.direction)+' · '+esc(x.date)+'</small>'+
    '<a href="'+esc(x.sourceUrl)+'" target="_blank" rel="noopener">Open original statement</a></li>').join('');
  const contact=[['Contact No.',r.details?.contact],['Batch',r.details?.batch]].filter(([,v])=>v).map(([k,v])=>'<div><dt>'+k+'</dt><dd>'+esc(v)+'</dd></div>').join('');
  detail('<h2>Review payment</h2><p>'+esc(r.reason)+'</p><dl class="details-list"><div><dt>Receiver shown</dt><dd>'+esc(r.receiver)+'</dd></div><div><dt>Payment recipient</dt><dd>'+esc(r.confirmedRecipient||'Check original screenshot')+'</dd></div><div><dt>Paid for</dt><dd>'+esc([r.details?.fullName,c.beneficiary].filter(Boolean).join(' · '))+'</dd></div>'+contact+(c.payer?'<div><dt>Paid by</dt><dd>'+esc(c.payer)+'</dd></div>':'')+'<div><dt>Payment UTR</dt><dd>'+esc(c.utr||r.ocr?.utr||'Unreadable')+'</dd></div><div><dt>Receipt amount</dt><dd>'+esc(money(c.amount))+'</dd></div><div><dt>Paid at (IST)</dt><dd>'+esc(c.time||'Unreadable')+'</dd></div></dl>'+
    '<details><summary>Original OCR values</summary><p>'+esc([r.ocr?.utr||'UTR unreadable',r.ocr?.amount||'Amount unreadable',r.ocr?.time||'Time unreadable'].join(' · '))+'</p></details>'+
    (r.ocr?.utrCandidates?.length?'<p>Possible references from the screenshot</p><div class="bank-candidates">'+r.ocr.utrCandidates.map(ref=>btn('bankFind',ref,'',ref)).join('')+'</div>':'')+
    (r.canReadReference?btn('bankReadReference','Read screenshot reference again'):'')+
    '<div id="bankProofImage" role="status">Loading private screenshot…</div><h3>Closest statement rows</h3>'+
    input('bankLookup','Find another row by full UTR','inputmode="numeric" maxlength="12" value="'+esc(query)+'"')+btn('bankFind','Find row')+
    (rows?'<ul class="bank-list">'+rows+'</ul><label for="bankRow">Statement row to use</label><select id="bankRow"><option value="">Choose a row</option>'+options+'</select>':'<p>No matching applied statement rows. Upload or apply the receiver statement first.</p>')+
    input('bankReason','Reason for your decision','maxlength="240"')+
    (rows?checkbox('bankVerified','I checked the screenshot and the original bank credit.')+btn('bankApprove','Approve payment','primary wide')+btn('bankLink','Link row and keep pending'):'')+
    btn('bankReject','Reject proof')+btn('move','Move to an open wave')+
    (r.rows.some(x=>x.ocr)?'<details><summary>Transcribe an unclear PDF credit</summary><p>Choose the original line above and verify it in the PDF.</p>'+input('pdfUtr','Full UTR on the PDF line','inputmode="numeric" maxlength="12"')+input('pdfAmount','Incoming amount on the PDF','inputmode="decimal"')+input('pdfDate','Bank credit date','type="date"')+btn('bankTranscribe','Record verified PDF values')+'</details>':''));

}
async function bankAction(name,id){
  if(name==='bankReceiver'){receiverDialog(id);return}
  if(name==='bankSaveReceiver'){
    const file=el('receiverQr').files[0],r=receiverEdit||{};
    await deskApi('adminSaveReceiver',token,{id:r.id||'',revision:r.revision||0,name:val('receiverName'),upi:val('receiverUpi'),number:val('receiverNumber'),active:el('receiverActive').checked,qr:file?await picture(file,'receiver'):''});
    await finishDeskChange(true);msg('Receiver saved.');return;
  }
  if(name==='bankStatements'){bankStatementsDialog();return}
  if(name==='bankUpload'){
    const file=el('bankFile').files[0];if(!val('bankReceiverId')||!el('bankAccountChecked').checked)throw Error('Choose and confirm the statement’s receiving account.');
    if(!file||file.size>6*1024*1024)throw Error('Choose a statement under 6 MB.');
    bankPlanDialog(await deskApi('adminImportStatement',token,val('bankReceiverId'),file.name,await bankFileBase64(file)));return;
  }
  if(name==='bankPreview'){bankPlanDialog(await deskApi('adminStatementPreview',token,id));return}
  if(name==='bankApply'){
    const plan=statementPreview,result=await deskApi('adminApplyStatement',token,plan.statement.id,plan.version);
    const summary=result.authorized+' authorized · '+result.review+' for review.';
    detail('<h2>Statement applied</h2><p role="status">'+esc(summary)+' Checking pass delivery…</p>');
    let delivery;
    try{delivery=await dispatchBankPasses()}finally{await finishDeskChange(true)}
    msg(summary+' '+delivery);return;
  }
  if(name==='bankDispatch'){const delivery=await dispatchBankPasses();await refresh(false,true);msg(delivery);return}
  if(name==='bankQueue'){
    const queue=await deskApi('adminNeedsReview',token);
    const payments=queue.payments.map(a=>'<li>'+btn('bankReview',a.roll,'',a.id)+'<small>'+esc(a.reason||'Exact credit available. Refresh its statement preview to authorize.')+'</small></li>').join('');
    const rows=queue.rows.map(r=>'<li><strong>'+esc(r.source+' · '+r.line)+'</strong><small>'+esc([r.utr,r.minor==null?'':formatFee_(r.minor/100),r.reason].filter(Boolean).join(' · '))+'</small><a href="'+esc(r.sourceUrl)+'" target="_blank" rel="noopener">Open original statement</a></li>').join('');
    detail('<h2>Needs Review</h2>'+(payments?'<h3>Student payments</h3><ul class="bank-list">'+payments+'</ul>':'')+(rows?'<h3>Statement rows</h3><ul class="bank-list">'+rows+'</ul>':'')+(!payments&&!rows?'<p>No payments or bank rows need review.</p>':''));return;
  }
  if(name==='bankReview'){bankReviewDialog(id);return}
  if(name==='bankFind'){bankReviewDialog(reviewPayment.id,id||val('bankLookup'));return}
  if(name==='bankReadReference'){
    const review=reviewPayment,button=el('detail').querySelector('[data-do="bankReadReference"]');
    const feedback=document.createElement('p');feedback.setAttribute('role','status');feedback.textContent='Reading the original screenshot…';
    button.replaceWith(feedback);
    deskApi('adminReadScreenshotReference',token,review.id,review.version).then(result=>{
      if(reviewPayment===review&&el('dialog').open){
        bankReviewDialog(review.id);
        msg(result.found?'Reference found in the screenshot.':'Check the original screenshot for the bank reference.');
      }
    }).catch(error=>{
      if(reviewPayment===review&&feedback.isConnected){feedback.textContent=error.message+' ';feedback.append(button)}
    });
    return;
  }
  if(name==='bankTranscribe'){
    await deskApi('adminCertifyPdfRow',token,val('bankRow'),{utr:val('pdfUtr'),amount:val('pdfAmount'),date:val('pdfDate'),reason:val('bankReason'),confirmed:!!el('bankVerified')?.checked});
    await bankReviewDialog(reviewPayment.id);return;
  }
  if(name==='bankApprove'||name==='bankLink'||name==='bankReject'){
    if(name==='bankApprove'&&!reviewPayment.proofVisible)throw Error('Open the readable payment screenshot before approving.');
    if(name==='bankApprove'&&!el('bankVerified')?.checked)throw Error('Confirm the original bank credit and screenshot before approving.');
    const decision={bankApprove:'approve',bankLink:'link',bankReject:'reject'}[name];
    const result=await deskApi('adminReviewPayment',token,reviewPayment.id,decision,val('bankRow'),val('bankReason'),reviewPayment.version);await finishDeskChange();msg(result.status);return;
  }
  if(name==='bankOpenDesk'){
    const result=await deskApi('adminOpenDeskPayment',token,val('deskroll'),val('kind'));await finishDeskChange();msg(result.status);return;
  }
}
