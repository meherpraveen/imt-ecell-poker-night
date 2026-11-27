function receivers_(st){return Object.values(st.receivers||{})}
function receiverView_(r){return {id:r.id,name:r.name,upi:r.upi,number:r.number||'',active:r.active,revision:r.revision}}
function verifyUpiQr_(bytes,upi){
  return validatePaymentQr_(readReceiverQr_(bytes),upi);
}
function verifyReceiverBlob_(blob,upi){
  const jpeg=blob.getContentType()==='image/png'?blob.getAs('image/jpeg'):blob;
  return verifyUpiQr_(jpeg.getBytes(),upi);
}
function validatePaymentQr_(payload,upi){
  must_(payload&&/^upi:\/\/pay\?/i.test(payload),'This image must contain one readable UPI payment QR.');
  let query;
  try{
    query=payload.slice(payload.indexOf('?')+1).split('&').map(pair=>{
      const split=pair.indexOf('='),parts=split<0?[pair,'']:[pair.slice(0,split),pair.slice(split+1)];
      return parts.map(value=>decodeURIComponent(value.replace(/\+/g,' ')));
    });
  }catch{must_(false,'The UPI QR contains an unreadable payment address.')}
  const values=key=>query.filter(p=>p[0].toLowerCase()===key).map(p=>p[1]||'');
  const addresses=values('pa');
  must_(addresses.length===1&&/^[a-z0-9][a-z0-9._-]{1,127}@[a-z][a-z0-9.-]{1,63}$/i.test(addresses[0])&&(!upi||addresses[0].toLowerCase()===upi),'The image pays a different UPI ID. Check the QR and receiver.');
  must_(values('am').every(x=>!x)&&values('mam').every(x=>!x)&&values('cu').every(x=>x.toUpperCase()==='INR'),'Use an INR QR with no preset amount.');
  must_(values('tn').every(x=>!x.trim()),'Use the original payment QR with a blank payment note.');
  return payload;
}
// An existing club can stage its organizer-supplied QRs in its owner-only setup folder.
function loadInitialReceivers_(){
  const folder=typeof CLUB_RESOURCES==='object'&&CLUB_RESOURCES.folder;
  if(!folder||props_().getProperty('INITIAL_RECEIVERS_LOADED'))return;
  const cache=CacheService.getScriptCache(),key='initial-receivers-absent';
  if(cache.get(key))return;
  const source=DriveApp.getFolderById(folder).getFilesByName('initial-payment-receivers.json');
  if(!source.hasNext()){cache.put(key,'yes',120);return}
  const document=source.next();must_(!source.hasNext()&&document.getSize()<32000,'Check the private receiver setup file.');
  const config=JSON.parse(document.getBlob().getDataAsString());
  must_(config.version===1&&Array.isArray(config.receivers)&&config.receivers.length>0&&config.receivers.length<=12,'Check the private receiver list.');
  return locked_(()=>{
    if(props_().getProperty('INITIAL_RECEIVERS_LOADED'))return;
    const st=ledger_(),added=[],expected=new Set();
    for(const item of config.receivers){
      const {id,upi,name,number,qrFile}=item;
      must_(/^[a-f0-9]{32}$/.test(id)&&/^[a-z0-9][a-z0-9._-]{1,127}@[a-z][a-z0-9.-]{1,63}$/.test(upi)&&typeof name==='string'&&name.length>=2&&name.length<=80&&/^\d{10}$/.test(number)&&!expected.has(upi),'Invalid initial receiver details.');
      expected.add(upi);
      const old=receivers_(st).find(r=>r.id===id||r.upi===upi);
      if(old){must_(old.id===id&&old.upi===upi,'A receiver address conflicts with the private setup file.');continue}
      const file=paymentQrFile_(qrFile),blob=file.getBlob();must_(blob.getContentType()==='image/jpeg','Initial receiver QR must be a JPEG.');
      const qrPayload=verifyUpiQr_(blob.getBytes(),upi);
      added.push({id,upi,name,number,qrFile,qrPayload,revision:1,active:true});
    }
    if(added.length)commit_(st,'Payment receivers configured',clubOwner_(),{receivers:added,note:added.map(r=>r.name).join(' · ')});
    props_().setProperty('INITIAL_RECEIVERS_LOADED','yes');
  });
}
function adminSaveReceiver(token,input){
  const admin=staff_(token,[]),v=input||{},name=String(v.name||'').trim(),upi=String(v.upi||'').trim().toLowerCase(),number=String(v.number||'').trim();
  must_(name.length>=2&&name.length<=80&&!/[\x00-\x1f]/.test(name)&&/^[a-z0-9][a-z0-9._-]{1,127}@[a-z][a-z0-9.-]{1,63}$/.test(upi),'Enter the receiver name and a valid UPI ID.');
  must_(!number||/^\d{10}$/.test(number),'Enter a ten-digit UPI number or leave it blank.');
  must_(typeof v.active==='boolean','Select the receiver status.');
  let image;
  if(v.qr){
    must_(typeof v.qr==='string'&&v.qr.length<=850000,'Choose a smaller QR image.');
    image=imageBytes_(v.qr);
    must_(image.mime==='image/jpeg','Upload the QR again using the receiver form.');
    image.payload=verifyUpiQr_(image.bytes,upi);
  }
  return locked_(()=>{
    const st=ledger_(),old=v.id&&st.receivers[v.id];
    must_(!v.id||old&&old.revision===v.revision,'The receiver changed. Reopen it and try again.');
    must_(!receivers_(st).some(r=>r.upi===upi&&r.id!==v.id),'This UPI ID is already listed.');
    must_(image||old?.qrFile&&old.upi===upi,'Upload the matching QR when adding or changing a UPI ID.');
    const changedAddress=old&&old.upi!==upi;
    const id=old&&!changedAddress?old.id:rand_(),qrFile=image?privateBlob_(image.bytes,image.mime,'event-payment-qr-'+rand_()+'.jpg').getId():old.qrFile;
    const receiver={id,revision:old&&!changedAddress?old.revision+1:1,name,upi,number,qrFile,qrPayload:image?.payload||old?.qrPayload||"",active:v.active};
    commit_(st,old?'Receiver updated':'Receiver added',admin.name,{receivers:changedAddress?[{...old,active:false,revision:old.revision+1},receiver]:[receiver],note:name+(v.active?' · active':' · disabled')});
    return receiverView_(receiver);
  });
}
function privateBlob_(bytes,mime,name){
  return DriveApp.getFolderById(props_().getProperty('FOLDER')).createFile(Utilities.newBlob(bytes,mime,name));
}
function attachReceiver_(a,st,now){
  const all=receivers_(st);
  if(!all.length||a.status!=='HOLD')return a;
  const active=all.filter(r=>r.active);
  must_(active.length,'No payment receiver is available. Save your registration and check again later.');
  return {...a,receiver:receiverView_(active[0]),offeredReceivers:active.map(r=>({id:r.id,revision:r.revision})),quotedAt:now};
}
function checkoutQr_(r){
  const cache=CacheService.getScriptCache(),key="upi-qr-note-free:"+hash_(r.qrFile+":"+r.upi);
  const cached=cache.get(key);if(cached)return cached;
  // Older receiver revisions only contain the original private Drive image.
  let payload=r.qrPayload;
  if(!payload){
    const props=props_(),propKey="verified-qr:"+r.id,stored=props.getProperty(propKey);
    const prior=stored&&JSON.parse(stored);
    if(prior&&prior.key===key)payload=prior.payload;
    else{payload=verifyReceiverBlob_(paymentQrFile_(r.qrFile).getBlob(),r.upi);props.setProperty(propKey,JSON.stringify({key,payload}))}
  }
  validatePaymentQr_(payload,r.upi);
  // The encoder's default byte mode accepts one byte per JavaScript character.
  const qr=ticketQrEncoder_(0,'M');qr.addData(unescape(encodeURIComponent(payload)));qr.make();
  const image=qr.createDataURL(4,16);cache.put(key,image,21600);return image;
}
function checkoutOptions_(a,st){
  const eligible=a.legacyReceiver?receivers_(st).filter(r=>r.id===a.receiver.id):receivers_(st);
  return eligible.filter(r=>r.active).map(r=>{
    try{return {...receiverView_(r),qr:checkoutQr_(r)}}
    catch(error){console.warn("Payment QR unavailable for receiver "+r.id);return {...receiverView_(r),qr:""}}
  });
}
function chosenReceiver_(a,options){
  const pinned=options.find(r=>r.id===a.receiver?.id&&(r.upi||r.number||r.qr));
  return pinned&&(a.receiverSelectedAt||a.legacyReceiver||options.length===1)?pinned.id:"";
}
function playerSelectReceiver(session,ticket,id,expectedVersion){
  const roll=playerRoll_(session),compact=expectedVersion!==undefined;
  if(compact)must_(/^\d{1,9}$/.test(expectedVersion),"Refresh your checkout and try again.");
  const result=locked_(()=>{
    const st=ledger_(),a=ownReceipt_(st,ticket,roll),receiver=st.receivers[id];
    requirePlayerPaymentOpen_(a,Date.now());
    must_(a.status==='HOLD'&&!a.file&&!a.legacyReceiver&&currentRegistration_(st,a).id===a.id,'Open your current checkout to select a receiver.');
    requirePlayerDetails_(a.details);
    must_(Date.now()<EVENT_END&&waveFor_(st,roll,Date.now())>=0,'Payments have closed or the event is full. If you already paid, submit your screenshot.');
    if(compact&&Object.hasOwn(st.receivers,id)&&!receiver.active)return {unavailable:true};
    must_(Object.hasOwn(st.receivers,id)&&receiver.active,"This receiver is unavailable. Refresh to choose an active account.");
    const version=a.receiverChoiceVersion||0,already=a.receiverSelectedAt&&a.receiver?.id===id;
    if(compact&&!already&&Number(expectedVersion)!==version)return {conflict:true,receiverChoiceVersion:version,receiver:a.receiver&&receiverView_(a.receiver)};
    if(!already){
      const next={...a,receiver:receiverView_(receiver),receiverSelectedAt:Date.now(),receiverChoiceVersion:version+1};
      commit_(st,"Player selected payment receiver",roll,{attempts:[next],note:a.id});
    }
    const saved=st.attempts[a.id];
    return compact?{receiver:receiverView_(receiver),receiverChoiceVersion:saved.receiverChoiceVersion||0}:{a:saved,st};
  },false);
  return compact?result:receipt_(result.a,settings_(),result.st);
}
function playerIdentifyReceiver(session,ticket,id){
  const roll=playerRoll_(session);return locked_(()=>{
    const st=ledger_(),a=ownReceipt_(st,ticket,roll),r=st.receivers[id];
    requirePlayerPaymentOpen_(a,Date.now());
    must_(r&&['HOLD','REVIEW','REJECTED'].includes(a.status),'Choose the receiver from your original payment.');
    if(a.receiver){must_(a.receiver.id===id,'The payment receiver is already recorded.');return receipt_(a,settings_(),st)}
    const next={...a,receiver:receiverView_(r),legacyReceiver:true};commit_(st,'Original receiver identified by player',roll,{attempts:[next],note:a.id});return receipt_(next,settings_(),st);
  });
}
