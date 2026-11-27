function staffSnapshot(token,knownRevision){
  const staff=staff_(token,['desk','gate','floor']);
  if(staff.role==='admin')loadInitialReceivers_();
  const journal=book_().getSheetByName('Journal'),end=journal.getLastRow(),now=Date.now(),offer=entryOffer_(now);
  const settings=staff.role==='admin'?adminSettingsView_(settings_()):null;
  // A periodic full read also picks up direct directory edits and expiring mail-delivery statuses.
  const revision=JSON.stringify([end,staff.role,staff.name,settings?.version||'',offer.amount,Math.floor(now/60000)]);
  if(knownRevision===revision)return {unchanged:true};
  const st=ledger_(journal,end),as=Object.values(st.attempts),places=Object.values(st.venue);
  const finance=['admin','desk'].includes(staff.role),floor=['admin','floor'].includes(staff.role);
  const students=as.some(a=>!a.details)?roster_():{},digestHits={},suffixHits={},latestByRoll=new Map();
  for(const a of as){
    const latest=latestByRoll.get(a.roll);if(!latest||a.created>=latest.created)latestByRoll.set(a.roll,a);
    if(a.digest)digestHits[a.digest]=(digestHits[a.digest]||0)+1}
  for(const a of as){if(!a.suffix)continue;const end=a.suffix.slice(-4);suffixHits[end]=(suffixHits[end]||0)+1}
  const managed=usesBankVerification_(st);
  const records=as.slice().reverse().filter(a=>finance||issued_(a)).map(a=>{
    const r={id:a.id,roll:a.roll,name:a.details?.fullName||students[a.roll]?.name||'',kind:a.kind,status:a.status==='HOLD'&&latestByRoll.get(a.roll).id!==a.id?'RELEASED':a.status,wave:a.used?a.wave+1:0,allocation:a.used?'assigned':'desk',used:a.used,seat:a.seat||null,where:st.venue[a.roll]?.where||'NEVER'};
    if(finance||staff.role==='gate')r.phone=a.details?a.details.contact.replace(/\D/g,''):students[a.roll]?.phone||'';
    if(finance)Object.assign(r,{batch:a.details?.batch||'',fee:quotedFee_(a,now),suffix:a.suffix||'',utr:a.utr||a.claim?.utr||a.ocr?.utr||'',managed:!!a.receiver||managed&&!!a.file,issue:a.reviewReason||a.reason||'',image:!!a.file,sameImage:!!(a.digest&&digestHits[a.digest]>1),sameTail:!!(a.suffix&&suffixHits[a.suffix.slice(-4)]>1),delivery:a.mailUntil>now?'Sending email':a.delivery||''});
    return r;
  });
  return {revision,role:staff.role,label:staff.name,records,managed,stats:{checked:places.length,inside:places.filter(v=>v.where==='IN').length,out:places.filter(v=>v.where==='OUT').length,
    noShow:new Set(as.filter(a=>a.status==='NO_SHOW').map(a=>a.roll)).size,pending:as.filter(a=>a.status==='REVIEW').length},
    scannerUrl:finance||staff.role==='gate'?scannerLink_(token):'',offer,retryFee:ENTRY_PRICING.retry,
    board:publicFloor_(st),game:floor?{next:st.game.next,active:st.game.active}:null,
    settings:settings?{...settings,receivers:receivers_(st).map(receiverView_),statements:Object.values(st.statements).map(statementView_).reverse(),unsent:as.filter(a=>a.bankRow&&a.delivery==='Pending delivery').length}:null,audit:staff.role==='admin'?st.audit.slice().reverse():[]};
}
function adminSettingsView_(s){
  const version=mac_('payment-settings:'+JSON.stringify([s.upi,s.name,s.open,s.qrFile,s.published]));
  return {upi:s.upi,name:s.name,open:s.open,hasQr:!!s.qrFile,published:s.published,version};
}
function paymentQrFile_(id){
  const file=DriveApp.getFileById(id);
  must_(/^event-payment-qr-[a-f0-9]{32}\.(png|jpg)$/.test(file.getName()),'The payment QR is unavailable.');
  const folderId=props_().getProperty('FOLDER'),parents=file.getParents();
  while(parents.hasNext()){if(parents.next().getId()===folderId)return file}
  throw Error('The payment QR is outside the club folder.');
}
function paymentQrData_(id){
  const blob=paymentQrFile_(id).getBlob(),mime=blob.getContentType();
  must_(mime==='image/png'||mime==='image/jpeg','The payment QR is unavailable.');
  return 'data:'+mime+';base64,'+Utilities.base64Encode(blob.getBytes());
}
function adminPaymentQr(token){
  staff_(token,[]);
  return locked_(()=>{const id=settings_().qrFile;return id?paymentQrData_(id):''});
}
function adminSettings(token,upi,name,open,options){
  const admin=staff_(token,[]);upi=String(upi||'').trim().toLowerCase();name=String(name||'').trim();
  must_(!upi||/^[a-z0-9][a-z0-9._-]{1,127}@[a-z][a-z0-9.-]{1,63}$/.test(upi),'Check the receiving UPI ID.');
  must_(typeof open==='boolean'&&name.length<=100&&!/^[=+@-]/.test(name),'Check the recipient name and registration setting.');
  const change=options||{};
  must_(!options||(typeof change.published==='boolean'&&typeof change.version==='string'),'Refresh payment settings before saving.');
  must_(!change.qr||(typeof change.qr==='string'&&change.qr.length<=720000&&!change.removeQr),'Choose one payment QR image under 525 KB.');
  let qrBlob;
  if(change.qr){
    const image=imageBytes_(change.qr);
    qrBlob=Utilities.newBlob(image.bytes,image.mime,'event-payment-qr-'+rand_()+'.'+image.ext);
    verifyReceiverBlob_(qrBlob,upi);
  }
  return locked_(()=>{
    const old=settings_();
    must_(!usesBankVerification_(ledger_())||upi===old.upi&&name===old.name&&!change.qr&&!change.removeQr&&change.published===old.published,'Use receiver settings to change the active payment accounts.');
    must_(!options||change.version===adminSettingsView_(old).version,'Payment settings changed. Refresh before saving.');
    const published=options?change.published:!!(open&&name&&(upi||old.qrFile));
    const keep=change.removeQr?'':old.qrFile;
    must_(!published||(name&&(upi||keep||change.qr)),'To publish payments, enter the recipient name and add a UPI ID or payment QR.');
    must_(!open||Object.keys(roster_()).length,'Import the student directory before opening.');
    let added;
    if(qrBlob)added=DriveApp.getFolderById(props_().getProperty('FOLDER')).createFile(qrBlob);
    const next={upi,name,open,published,qrFile:added?added.getId():keep};
    try{writeSettings_(next);SpreadsheetApp.flush()}
    catch(error){if(added&&settings_().qrFile!==added.getId())added.setTrashed(true);throw error}
    if(old.qrFile&&old.qrFile!==next.qrFile){
      try{paymentQrFile_(old.qrFile).setTrashed(true)}catch{console.warn('Could not archive a superseded payment QR.')}
    }
    commit_(ledger_(),'Payment settings updated',admin.name,{note:published?'Payment details published':'Payments paused'});
    return true;
  });
}
function adminAddStaff(token,label,role,includeLink){
  const s=staff_(token,[]);label=String(label||'').trim();must_(/^[\p{L}\p{N}][\p{L}\p{N} ._-]{1,60}$/u.test(label)&&['desk','gate','floor'].includes(role),'Choose a desk, gate or floor role for the volunteer.');
  return locked_(()=>{
    const base=deskBaseUrl_();
    must_(base,'Publish the web app before inviting staff.');
    const key=rand_()+rand_().slice(0,8),sheet=book_().getSheetByName('Staff');
    sheet.appendRow([label,role,key,'yes']);
    syncStaffLinks_(sheet);
    commit_(ledger_(),'Staff key issued',s.name,{note:role});
    return includeLink===true?{key,url:staffDeskLink_(base,key)}:key;
  });
}

function staffApprove(token,id,fullRef,confirmed){
  const staff=staff_(token,['desk']);fullRef=ref_(fullRef);must_(confirmed===true&&fullRef,'Confirm the receiving-account credit and enter its full 12-digit UPI reference.');
  locked_(()=>{const st=ledger_(),a=st.attempts[id];must_(a,'Attempt missing.');
    if(issued_(a)&&a.utr===fullRef)return;
    must_(!usesBankVerification_(st),'Use the admin statement review to authorize this payment.');
    must_(a.status==='REVIEW','This attempt is not awaiting review.');
    must_(validBatch_(a.details?.batch),'Ask the player to choose their batch in registration details. Their proof is saved.');
    must_(!a.suffix||fullRef.endsWith(a.suffix),'The visible receipt digits do not match this bank reference. Check the credit and proof again.');
    must_(!Object.values(st.attempts).some(v=>v.id!==id&&v.utr===fullRef),'This bank reference has already paid for another attempt.');
    must_(Date.now()<EVENT_END&&waveFor_(st,a.roll,Date.now(),a.id)>=0,'Event capacity is full. Check availability at the registration desk.');
    const paid={...a,wave:-1,capacityReserved:true,status:'PAID',utr:fullRef,verified:Date.now(),delivery:'Pending delivery'};
    commit_(st,'Payment approved',staff.name,{attempts:[paid],note:id});
  },false);
  return {status:deliverPass_(id,staff.name)};
}
function staffReject(token,id,why){const s=staff_(token,['desk']);why=String(why||'').trim().slice(0,180);must_(why,'Add a short reason for the player.');return locked_(()=>{const st=ledger_(),a=st.attempts[id];must_(!usesBankVerification_(st),'Use the admin statement review to reject this proof.');must_(a&&a.status==='REVIEW','Only pending proofs can be rejected.');commit_(st,'Proof rejected',s.name,{attempts:[{...a,status:'REJECTED',reason:why}],note:id});return true})}
function deskPayment(token,roll,kind,full,confirmed,verifiedFee,batch,phone){
  const s=staff_(token,['desk']);roll=roll_(roll);full=ref_(full);must_(['walk','retry'].includes(kind)&&full&&confirmed===true,'Check college ID and receiving-account credit, then enter the full UPI reference.');
  const id=locked_(()=>{const st=ledger_(),people=roster_(),now=Date.now();must_(!usesBankVerification_(st),'Open a desk payment and have the player upload proof.');must_(people[roll],'This roll is missing from the private directory.');
    const used=Object.values(st.attempts).find(a=>a.utr===full);
    if(used&&used.roll===roll&&(used.kind===kind||(kind==='walk'&&used.kind==='pre')))return used.id;
    must_(!used,'This reference has already been used.');
    const existing=Object.values(st.attempts).find(a=>a.roll===roll&&(a.kind===kind||(kind==='walk'&&a.kind==='pre'))&&
      ['REGISTERED','WAITLIST','HOLD'].includes(a.status)&&currentRegistration_(st,a).id===a.id);
    const fee=existing?quotedFee_(existing,now):entryOffer_(now,kind).amount;
    must_(verifiedFee===undefined||verifiedFee===fee,'The expected fee has changed. Refresh the player record and check the credit.');
    if(kind==='walk')must_(now>=DESK_OPENS&&now<NEW_CLOSE,'Walk-in purchases run from 7 to 11 PM IST.');
    eligibility_(st,roll,kind,now,existing?.id);
    const wave=waveFor_(st,roll,now);must_(wave>=0,'No later Round 1 seat is available. Do not collect a payment.');
    const saved=existing?.details||latestRegistration_(st,roll)?.details;
    const details=registrationDetails_(roll,{fullName:saved?.fullName||people[roll].name,pgpId:roll,contact:validContact_(saved?.contact)?saved.contact:phone||people[roll].phone,batch:validBatch_(saved?.batch)?saved.batch:batch});
    const a={...(existing||newAttempt_(roll,kind,wave,now)),details,detailsRevision:existing?.detailsRevision||1,fee,wave:-1,capacityReserved:true,status:'PAID',utr:full,verified:now,delivery:'Pending delivery'};
    const oldWait=Object.values(st.attempts).filter(v=>v.roll===roll&&v.id!==a.id&&v.status==='WAITLIST').map(v=>({...v,status:'RELEASED'}));
    commit_(st,'Desk payment verified',s.name,{attempts:[...oldWait,a],note:a.id});return a.id;
  },false);
  return {status:deliverPass_(id,s.name),id};
}

function releaseSeat(token,id,mode){
  const s=staff_(token,['desk','floor']);return locked_(()=>{const st=ledger_(),a=st.attempts[id];must_(a,'Attempt missing.');
    if(mode==='no-show'){must_(a.status==='PAID'&&!a.used,'Only an unused paid pass can be marked no-show.');commit_(st,'No-show',s.name,{attempts:[{...a,status:'NO_SHOW'}],note:id})}
    else if(mode==='move'){must_(['REVIEW','WAITLIST'].includes(a.status),'Only a pending or waitlisted attempt can move.');const now=Date.now(),w=waveFor_(st,a.roll,now,a.id);must_(w>=0,'No event capacity is available.');const moved={...a,wave:-1,capacityReserved:a.status==='REVIEW',reservedAfterReview:a.status==='REVIEW'};if(a.status==='WAITLIST'){must_(paymentReadyFor_(settings_(),st)&&now<EVENT_END,'Checkout is currently unavailable.');Object.assign(moved,{fee:entryOffer_(now,a.kind).amount,status:'HOLD'})}commit_(st,'Registration capacity offered',s.name,{attempts:[a.status==='WAITLIST'?attachReceiver_(moved,st,now):moved],note:id})}
    else throw Error('Unknown seat action.');return true;
  });
}
