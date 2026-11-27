// Receiver revisions and proof submissions live in the private, append-only event journal.
const FAIR_PLAY_VERSION='imt-ecell-2026-v2';
const FAIR_PLAY_DECLARATION='I agree to play fair, respect the rules, and accept all decisions made by E-Cell, IMT Ghaziabad.';
const PROOF_MAX_BYTES=10*1024*1024;
function validBatch_(batch){return ['2025-27','2026-28'].includes(batch)}
function validContact_(value){return typeof value==='string'&&/^\+?[\d ()-]{7,24}$/.test(value)&&/^\d{7,15}$/.test(value.replace(/\D/g,''))}
function missingDetail_(details){
  if(!validContact_(details?.contact))return 'phone number';
  return validBatch_(details?.batch)?'':'batch';
}
function requirePlayerDetails_(details){
  const missing=missingDetail_(details);must_(!missing,'Complete your '+missing+' in registration details to continue.');
}
function registrationDetails_(roll,value){
  const v=typeof value==='string'?parseObject_(value,'Check your registration details.'):value||{};
  must_(v&&typeof v==='object'&&!Array.isArray(v),'Check your registration details.');
  const fullName=String(v.fullName||'').trim(),contact=String(v.contact||'').trim(),batch=String(v.batch||'');
  must_(fullName&&fullName.length<=100&&!/[\x00-\x1f]/.test(fullName),'Enter your full name.');
  must_(roll_(v.pgpId)===roll,'Use the PGP ID verified at sign-in.');
  must_(contact,'Enter your phone number.');
  must_(validContact_(contact),'Enter a phone number with 7–15 digits, including your country code if needed.');
  must_(validBatch_(batch),'Choose your batch to continue.');
  return {fullName,pgpId:roll,contact,batch};
}
function playerSaveDetails(session,ticket,json){
  const roll=playerRoll_(session),input=parseObject_(json||'{}','Check your registration details.'),details=registrationDetails_(roll,input);
  const result=locked_(()=>{
    const st=ledger_(),set=settings_(),a=ownReceipt_(st,ticket,roll);
    must_(currentRegistration_(st,a).id===a.id,'Open your current registration to edit its details.');
    const revision=a.detailsRevision||0;
    if(JSON.stringify(a.details)!==JSON.stringify(details)){
      if((input.revision??0)!==revision)return {a,set,st,conflict:true};
      commit_(st,a.details?'Registration details updated':'Registration details confirmed',roll,{attempts:[{...a,details,detailsRevision:revision+1}],note:a.id});
    }
    return {a:openSavedCheckout_(st.attempts[a.id],set,st,Date.now()),set,st};
  },false);
  return {...receipt_(result.a,result.set,result.st),detailsConflict:!!result.conflict};
}
function proofImageBytes_(data){
  must_(typeof data==='string'&&data.length<=4*Math.ceil(PROOF_MAX_BYTES/3)+64,'Choose one payment screenshot up to 10 MB.');
  const prefix=/^data:image\/(jpeg|png|webp);base64,/.exec(data);
  must_(prefix,'Choose a JPEG, PNG or WebP payment screenshot.');
  const base64=data.slice(prefix[0].length);
  must_(base64.length>0&&base64.length%4===0&&!/[^A-Za-z0-9+/=]/.test(base64),'This screenshot could not be read. Choose the image again.');
  const bytes=Utilities.base64Decode(base64),head=bytes.slice(0,12).map(n=>n&255);
  const match=(at,signature)=>signature.every((v,i)=>head[at+i]===v);
  const kind=prefix[1],valid=kind==='jpeg'?match(0,[255,216,255]):kind==='png'?match(0,[137,80,78,71,13,10,26,10]):match(0,[82,73,70,70])&&match(8,[87,69,66,80]);
  must_(valid&&bytes.length>=20&&bytes.length<=PROOF_MAX_BYTES,'Choose one valid payment screenshot up to 10 MB.');
  return {bytes,mime:'image/'+kind,ext:kind==='jpeg'?'jpg':kind};
}

function imageBytes_(data){
  must_(typeof data==='string'&&data.length<=2400000,'Choose an image under 1.7 MB after compression.');
  const m=/^data:image\/(png|jpeg);base64,([A-Za-z0-9+/=]+)$/.exec(data);must_(m,'Upload a JPEG or PNG screenshot.');
  const bytes=Utilities.base64Decode(m[2]),head=bytes.slice(0,8).map(b=>b&255);
  must_(bytes.length>=20&&bytes.length<=1800000&&(m[1]==='png'?head.join(',')==='137,80,78,71,13,10,26,10':head[0]===255&&head[1]===216&&head[2]===255),'The image format is invalid.');
  return {bytes,mime:'image/'+m[1],ext:m[1]==='png'?'png':'jpg'};
}
function playerUpload(session,ticket,suffix,data){
  const roll=playerRoll_(session);
  suffix=String(suffix||'').trim();must_(!suffix||/^\d{4,12}$/.test(suffix),'Enter the final 4–12 visible bank-reference digits, or leave the field blank.');
  const im=imageBytes_(data),digest=proofDigest_(im.bytes);
  return saveProofFile_(roll,ticket,im,'proof',(st,a)=>{
    must_(!usesBankVerification_(st),'Refresh the event page to submit the full payment details.');
    if(a.status==='REVIEW'||issued_(a))return null;
    must_(a.status==='HOLD'&&currentRegistration_(st,a).id===a.id,'Open your current registration to submit proof.');
    requirePlayerDetails_(a.details);
    const now=Date.now();
    return {status:'REVIEW',...pendingAllocation_(st,a,now),fee:quotedFee_(a,now),digest,suffix,submitted:now};
  });
}

function proofImage(token,id,withVersion){
  staff_(token,['desk']);
  const a=ledger_().attempts[id];must_(a&&a.file,'No screenshot was uploaded for this attempt.');
  const blob=DriveApp.getFileById(a.file).getBlob(),data='data:'+blob.getContentType()+';base64,'+Utilities.base64Encode(blob.getBytes());
  return withVersion===true?{data,version:a.proofVersion||0}:data;
}

// MailApp supplies the executing club account as From. All event mail shares its identity.

function proofDigest_(bytes){return Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,bytes))}
function paise_(value){
  const s=String(value??'').trim().replace(/^(?:INR|Rs\.?|₹)\s*/i,'');
  if(!/^(?:\d+|\d{1,3}(?:,\d{3})+|\d{1,2}(?:,\d{2})*,\d{3})(?:\.\d{1,2})?$/.test(s))return null;
  const [whole,part='']=s.replace(/,/g,'').split('.'),n=Number(whole)*100+Number((part+'00').slice(0,2));
  return Number.isSafeInteger(n)&&n<=100000000000?n:null;
}
function localPaidTime_(text){
  const s=String(text||'').trim();
  if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(s))return '';
  const time=Date.parse(s+':00+05:30');
  return Number.isFinite(time)&&new Date(time+19800000).toISOString().slice(0,16)===s?s:'';
}
// Keep digits as text, including leading zeroes. A bank reference outranks an app transaction ID.
function screenshotReferences_(text){
  const bank=new Set(),transaction=new Set(),unlabelled=new Set();
  const suffix=/(?:\b(?:u[\s.]?t[\s.]?r|r[\s.]?r[\s.]?n)|\b(?:upi|bank)\s*(?:(?:transaction|txn)\s*)?ref(?:erence)?|\bref(?:erence)?\.?\s+(?:no|num(?:ber)?)\b|\bretrieval\s+reference|\bupi\s*(?:transaction|txn))[\s.:#№-]*(?:(?:no|num(?:ber)?|id|code)\b[\s.:#№-]*)?$/i;
  const generic=/\b(?:trans(?:action)?|txn|ref(?:erence)?)[\s.:#-]*(?:id|no|num(?:ber)?|code)?[\s.:#-]*$/i;
  const unrelated=/(?:\b(?:order|invoice|customer|mobile|phone|card|account|a\/c|aadhaar|aadhar|wallet|merchant|upi\s*(?:id|number))[\s.:#-]*(?:(?:ref(?:erence)?|no|num(?:ber)?|id)[\s.:#-]*)*|(?:₹|\b(?:INR|Rs))[\s.:]*)$/i;
  const digits=/[0-9]{12}|[0-9]{4}(?:[\s-]+[0-9]{4}){2}|[0-9]{6}[\s-]+[0-9]{6}|[0-9]{3}(?:[\s-]+[0-9]{3}){3}/g;
  for(const m of text.matchAll(digits)){
    const before=text.slice(Math.max(0,m.index-96),m.index),after=text.slice(m.index+m[0].length,m.index+m[0].length+12);
    const labelled=suffix.test(before),weak=generic.test(before);
    if(unrelated.test(before)||/[\d@_+]$/.test(before)||/^[\w@]/.test(after)||/^[.]\d/.test(after))continue;
    if(!labelled&&!weak&&(/[a-z]$/i.test(before)||m[0].includes('\n')))continue;
    // A grouped bank account/card or a longer continuous identifier must not yield a 12-digit substring.
    const grouped=/\D/.test(m[0]);
    if(grouped&&(/\d[ \t-]+$/.test(before)||/^[ \t-]+\d{3}/.test(after)))continue;
    if(!grouped&&(/\d-$/.test(before)||/^-\d/.test(after)))continue;
    const value=m[0].replace(/\D/g,'');
    (labelled?bank:weak?transaction:unlabelled).add(value);
  }
  const best=bank.size?bank:transaction.size?transaction:unlabelled,values=[...best];
  return {utr:values.length===1?values[0]:'',utrCandidates:values.length>1?values.slice(0,8):[]};
}
// A damaged currency glyph can be recovered when the adjacent amount in words agrees.
// Larger or fractional word amounts stay available for manual review.
function receiptRupeesInWords_(text){
  const small=['zero','one','two','three','four','five','six','seven','eight','nine','ten','eleven','twelve','thirteen','fourteen','fifteen','sixteen','seventeen','eighteen','nineteen'];
  const tens=['twenty','thirty','forty','fifty','sixty','seventy','eighty','ninety'];
  let words=text.toLowerCase().trim().replace(/-/g,' ').split(/\s+/),amount=0;
  if(words[1]==='hundred'){
    const hundreds=small.indexOf(words[0]);if(hundreds<1||hundreds>9)return null;
    amount=hundreds*100;words=words.slice(2);
    if(words[0]==='and'){words=words.slice(1);if(!words.length)return null}
  }
  if(!words.length)return amount*100;
  if(words.length===1&&small.includes(words[0]))return (amount+small.indexOf(words[0]))*100;
  const ten=tens.indexOf(words[0]),unit=words.length===2?small.indexOf(words[1]):0;
  return ten>=0&&words.length<=2&&unit>=0&&unit<10&&(words.length===1||unit>0)?(amount+(ten+2)*10+unit)*100:null;
}
function readPaymentText_(text){
  const s=String(text||'').normalize('NFKC').replace(/[\u200b-\u200f\ufeff]/g,'').replace(/[\u2010-\u2014]/g,'-')
    .replace(/[०-९]/g,c=>String(c.charCodeAt(0)-0x966));
  function unique(values){const options=[...new Set(values)];return options.length===1?options[0]:''}
  const references=screenshotReferences_(s);
  const amount=screenshotAmount_(s),months=['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
  const dates=[],times=[];
  for(const m of s.matchAll(/\b(\d{4})-(\d{2})-(\d{2})\b/g))dates.push(m[1]+'-'+m[2]+'-'+m[3]);
  for(const m of s.matchAll(/\b(\d{1,2})[\s/.-]+([A-Za-z]{3,9}|\d{1,2})[\s,./-]+(\d{4})\b/g)){
    const month=/^\d+$/.test(m[2])?Number(m[2]):months.indexOf(m[2].slice(0,3).toLowerCase())+1;
    if(month>=1&&month<=12)dates.push(m[3]+'-'+String(month).padStart(2,'0')+'-'+m[1].padStart(2,'0'));
  }
  for(const m of s.matchAll(/\b(\d{1,2}):(\d{2})(?::\d{2})?\s*(am|pm)?\b/gi)){
    let h=Number(m[1]);if(m[3]){if(h<1||h>12)continue;h=h%12+(m[3].toLowerCase()==='pm'?12:0)}
    if(h<=23&&Number(m[2])<60)times.push(String(h).padStart(2,'0')+':'+m[2]);
  }
  const payees=Array.from(s.matchAll(/(?:paid to|payee(?:\s+(?:upi\s*id|vpa))?|receiver(?:\s+upi\s*id)?|beneficiary(?:\s+upi\s*id)?)\s*[:\s-]*(?:[^@\n]{1,65}\n\s*)?([a-z0-9._-]+@[a-z][a-z0-9.-]+)/gi),m=>m[1].toLowerCase());
  return {...references,payee:unique(payees),amount,time:localPaidTime_(unique(dates)+'T'+unique(times)),
    uncertain:new Set(payees).size>1||/\b(?:failed|pending|reversed|refunded|declined|unsuccessful)\b/i.test(s)};
}
function convertPaymentFile_(blob,mime,read){
  const converted=Drive.Files.create({name:'Temporary payment extraction',mimeType:mime,parents:[props_().getProperty('FOLDER')]},blob,{ocrLanguage:'en',fields:'id'});
  try{return read(converted.id)}
  finally{DriveApp.getFileById(converted.id).setTrashed(true)}
}
function paymentDocument_(blob){
  return convertPaymentFile_(blob,'application/vnd.google-apps.document',id=>{
    let doc;
    try{doc=Docs.Documents.get(id)}catch(error){
      let text;
      try{const plain=Drive.Files.export(id,'text/plain',{alt:'media'});text=typeof plain==='string'?plain:plain.getDataAsString()}
      catch(exportError){text=DriveApp.getFileById(id).getAs('text/markdown').getDataAsString().replace(/^.*data:image\/[^\n]+$/gm,'')}
      return {text,tables:[]};
    }
    const lines=[],tables=[],paragraphs=[];
    function values(nodes){return (nodes||[]).map(n=>(n.paragraph?.elements||[]).map(e=>e.textRun?.content||'').join('')).join('').trim()}
    for(const block of doc.body.content||[]){
      if(block.paragraph){const value=values([block]);lines.push(value);paragraphs.push(value)}
      if(block.table){const rows=block.table.tableRows.map(row=>row.tableCells.map(cell=>values(cell.content)));tables.push(rows);for(const row of rows)lines.push(row.join('\t'))}
    }
    return {text:lines.join('\n'),tables,paragraphs};
  });
}
function proofSeal_(id,digest,fields){return mac_('proof-ocr-v1:'+JSON.stringify([id,digest,fields.utr,fields.amount,fields.time,fields.payee||'',!!fields.uncertain]))}
// Reuse the exact bytes already supplied for OCR. Drive only receives submitted evidence.
const PROOF_CACHE_CHUNK=84000,PROOF_CACHE_PARTS=12;
function rememberProof_(cache,id,digest,data){
  const count=Math.ceil(data.length/PROOF_CACHE_CHUNK);
  if(count>PROOF_CACHE_PARTS)return '';
  try{
    const parts={};
    for(let i=0;i<count;i++)parts['proof-bytes:'+id+':'+digest+':'+i]=data.slice(i*PROOF_CACHE_CHUNK,(i+1)*PROOF_CACHE_CHUNK);
    cache.putAll(parts,600);return 'proof:'+count+':'+digest;
  }catch{return ''}
}
function recalledProof_(id,ref){
  const match=/^proof:(\d{1,2}):([\w-]{43}=?)$/.exec(ref);
  must_(match&&Number(match[1])>0&&Number(match[1])<=PROOF_CACHE_PARTS,'Choose your payment screenshot again.');
  const keys=Array.from({length:Number(match[1])},(_,i)=>'proof-bytes:'+id+':'+match[2]+':'+i);
  try{
    const parts=CacheService.getScriptCache().getAll(keys);
    return keys.every(key=>typeof parts[key]==='string')?keys.map(key=>parts[key]).join(''):'';
  }catch{return ''}
}
function reserveScreenshotRead_(roll){
  const cache=CacheService.getScriptCache(),key='ocr-count:'+roll,bucket=Math.floor(Date.now()/600000);
  return locked_(()=>{
    const prior=JSON.parse(cache.get(key)||'null'),count=prior?.bucket===bucket?prior.count:0;
    if(count>=10)return false;
    cache.put(key,JSON.stringify({bucket,count:count+1}),610);
    return true;
  },false);
}
function extractScreenshot_(a,image){
  try{return readPaymentText_(paymentDocument_(Utilities.newBlob(image.bytes,image.mime,'receipt.'+image.ext)).text)}
  catch{console.warn('Receipt text extraction failed for '+a.id);return null}
}
// Refresh machine-read amounts without overwriting a payer's entered amount or
// an owner-transcribed receipt. Clearing ambiguous OCR keeps it in review.
function rereadScreenshotFields_(a,extracted){
  const previous=a.ocr||{},ocr={...previous,amount:extracted.amount||''};
  for(const field of ['utr','time','payee'])ocr[field]=previous[field]||extracted[field]||'';
  ocr.utrCandidates=ocr.utr?[]:extracted.utrCandidates||[];
  ocr.uncertain=!!(previous.uncertain||extracted.uncertain);
  const updated={...a,ocr};
  if(a.claim?.source==='screenshot'){
    updated.claim={...a.claim,utr:a.claim.utr||ocr.utr,time:a.claim.time||ocr.time};
    if(!a.proofImportKey&&(a.claim.amount==null||a.claim.amount===paise_(previous.amount)))updated.claim.amount=paise_(ocr.amount);
    updated.suffix=updated.claim.utr.slice(-4);
  }
  if(JSON.stringify(a)===JSON.stringify(updated))return null;
  return {...updated,proofVersion:(a.proofVersion||0)+1};
}
// Older uploads keep their original evidence. An administrator can read it again without a student resubmission.
function adminReadScreenshotReference(token,id,version){
  const admin=staff_(token,[]),original=ledger_().attempts[id];
  const eligible=a=>a?.status==='REVIEW'&&a.file&&(a.proofVersion||0)===version;
  must_(eligible(original),'The payment changed. Reopen it before reading its screenshot.');
  let extracted;
  try{
    const originalImage=DriveApp.getFileById(original.file).getBlob();
    extracted=readPaymentText_(paymentDocument_(originalImage).text);
  }catch{throw Error('The original screenshot could not be read. Try again or look up the bank credit.')}
  return locked_(()=>{
    const st=ledger_(),a=st.attempts[id];
    must_(eligible(a)&&a.file===original.file,'The screenshot changed. Reopen the payment.');
    const updated=rereadScreenshotFields_(a,extracted);
    if(!updated)return {found:!!a.ocr?.utr,updated:false};
    commit_(st,'Screenshot details reread',admin.name,{attempts:[updated],note:id});
    return {found:!!updated.ocr.utr,updated:true};
  },false);
}
function playerReadProof(session,ticket,data){
  const roll=playerRoll_(session),a=ownReceipt_(ledger_(),ticket,roll),image=proofImageBytes_(data),digest=proofDigest_(image.bytes);
  requirePlayerPaymentOpen_(a,Date.now());
  must_(!issued_(a)&&['HOLD','REVIEW','REJECTED'].includes(a.status),'This receipt is not accepting proof.');
  const cache=CacheService.getScriptCache(),key='ocr:amount-v2:'+a.id+':'+digest;
  const cached=cache.get(key);if(cached)return JSON.parse(cached);
  must_(reserveScreenshotRead_(roll),'Too many screenshot reads. Try again in ten minutes.');
  const extracted=extractScreenshot_(a,image),fields=extracted||readPaymentText_('');
  requirePlayerPaymentOpen_(a,Date.now());
  const message=extracted?'':'Automatic reading is unavailable. Enter the details from your screenshot for manual review.';
  const result={...fields,uploadRef:rememberProof_(cache,a.id,digest,data),seal:proofSeal_(a.id,digest,fields),message:message||(!fields.utr||!fields.amount||!fields.time?'Some details could not be read. Check the fields below.':'Check the details read from your screenshot.')};
  cache.put(key,JSON.stringify(result),600);return result;
}
function discardStagedFile_(file){
  if(file)try{file.setTrashed(true)}catch{console.warn('Could not discard staged event file '+file.getId())}
}
function saveProofFile_(roll,ticket,image,filename,changesFor,prepare){
  const check=st=>{const a=ownReceipt_(st,ticket,roll),changes=changesFor(st,a);if(changes)requirePlayerPaymentOpen_(a,Date.now());return {st,a,changes}};
  const before=check(ledger_());
  if(!before.changes)return receipt_(before.a,settings_(),before.st);
  if(prepare)prepare(before.st,before.a);
  requirePlayerPaymentOpen_(before.a,Date.now());
  const file=privateBlob_(image.bytes,image.mime,before.a.id+'-'+filename+'.'+image.ext);
  let journalAttempted=false;
  try{
    const saved=locked_(()=>{
      const {st,a,changes}=check(ledger_());
      if(!changes)return {a,st};
      const updated={...a,...changes,file:file.getId()};
      // If Sheets loses the acknowledgement, the journal may still reference this file.
      journalAttempted=true;
      commit_(st,a.file?'Proof replaced':'Proof submitted',roll,{attempts:[updated],note:a.id});
      return {a:updated,st};
    },false);
    return receipt_(saved.a,settings_(),saved.st);
  }finally{
    if(!journalAttempted)discardStagedFile_(file);
  }
}
function playerSubmitPayment(session,ticket,data,json){
  const roll=playerRoll_(session),form=parseObject_(json||'{}','Check your payment details.'),ref=String(data).startsWith('proof:')?data:'';
  if(ref){
    const a=ownReceipt_(ledger_(),ticket,roll);
    data=recalledProof_(a.id,ref);if(!data)return {uploadRequired:true};
  }
  const im=proofImageBytes_(data),digest=proofDigest_(im.bytes);
  if(ref&&!ref.endsWith(':'+digest))return {uploadRequired:true};
  const claim={utr:ref_(form.utr),amount:paise_(form.amount),time:localPaidTime_(form.time),payer:String(form.payer||'').trim(),beneficiary:roll_(form.beneficiary),fairPlay:form.fairPlay===true};
  must_(claim.utr&&claim.amount>0&&claim.time,'Check the full 12-digit UTR, amount paid and payment time (IST).');
  must_(claim.beneficiary===roll,'Submit proof from the account of the player this payment is for.');
  must_(claim.payer.length>=2&&claim.payer.length<=90&&!/[\x00-\x1f]/.test(claim.payer),'Enter the name of the person who made the payment.');
  must_(claim.fairPlay&&form.agreementVersion===FAIR_PLAY_VERSION,'Review the current fair-play declaration before submitting.');
  return saveProofFile_(roll,ticket,im,'proof-'+(form.revision+1),(st,a)=>{
    const now=Date.now();
    if(issued_(a))return null;
    must_(a.receiver&&a.receiver.id===form.receiver,'Reload your saved receiver before submitting payment proof.');
    must_(currentRegistration_(st,a).id===a.id,'Open your current registration to submit proof.');
    if(a.status==='HOLD'&&now<EVENT_END&&waveFor_(st,roll,now)>=0){
      const hasMultiple=a.offeredReceivers?.length>1&&receivers_(st).filter(r=>r.active).length>1;
      must_(!hasMultiple||a.receiverSelectedAt,'Choose your payment receiver before submitting proof.');
      must_(form.receiverChoiceVersion===undefined||form.receiverChoiceVersion===(a.receiverChoiceVersion||0),'The receiver changed in another window. Check your selection before submitting.');
    }
    requirePlayerDetails_(a.details);
    const paid=st.receivers[form.paidReceiver];must_(Object.hasOwn(st.receivers,form.paidReceiver)&&paid,'Confirm the recipient who received this payment.');
    claim.paidReceiver=a.claim?.paidReceiver?.id===paid.id?a.claim.paidReceiver:{id:paid.id,name:paid.name,upi:paid.upi};
    const o=form.ocr||{},trusted=o.seal&&o.seal===proofSeal_(a.id,digest,o)?{utr:o.utr,amount:o.amount,time:o.time,payee:o.payee||'',uncertain:!!o.uncertain}:null;
    if(a.status==='REVIEW'&&a.digest===digest&&JSON.stringify(a.claim)===JSON.stringify(claim))return null;
    must_(Number.isInteger(form.revision)&&form.revision===(a.proofVersion||0),'Your proof changed. Refresh before replacing it.');
    must_(['HOLD','REVIEW','REJECTED'].includes(a.status),'This registration cannot accept a payment. Contact the event desk.');
    const transferTime=Date.parse(claim.time+':00+05:30');
    const fee=entryOffer_(Math.max(a.quotedAt||a.created,Math.min(transferTime,now)),a.kind).amount;
    return {...pendingAllocation_(st,a,now),fee,digest,claim,ocr:trusted,suffix:claim.utr.slice(-4),proofVersion:form.revision+1,status:'REVIEW',paymentStatus:'PENDING',submitted:now,
      late:false,reason:'',reviewReason:'',linkedRow:'',linkReason:'',fairPlayVersion:FAIR_PLAY_VERSION,agreement:FAIR_PLAY_DECLARATION};
  });
}

function playerSubmitScreenshot(session,ticket,data,expectedRevision){
  const roll=playerRoll_(session);
  must_(/^\d{1,9}$/.test(expectedRevision),'Refresh your registration before submitting a screenshot.');
  const revision=Number(expectedRevision),image=proofImageBytes_(data),digest=proofDigest_(image.bytes);
  let ocr=null;
  return saveProofFile_(roll,ticket,image,'proof-'+(revision+1),(st,a)=>{
    if(issued_(a)||a.status==='REVIEW'&&a.digest===digest&&a.claim?.source==='screenshot')return null;
    must_(currentRegistration_(st,a).id===a.id&&['HOLD','REVIEW','REJECTED'].includes(a.status),'Open your current registration to submit a screenshot.');
    must_(revision===(a.proofVersion||0),'Your screenshot changed in another window. Refresh before replacing it.');
    requirePlayerDetails_(a.details);
    const now=Date.now(),paidAt=ocr?.time&&Date.parse(ocr.time+':00+05:30');
    const fee=entryOffer_(Math.max(a.quotedAt||a.created,Math.min(paidAt||now,now)),a.kind).amount;
    const receiver=ocr?.payee&&receivers_(st).find(r=>r.upi===ocr.payee);
    const claim={source:'screenshot',beneficiary:roll,utr:ocr?.utr||'',amount:paise_(ocr?.amount),time:ocr?.time||'',
      paidReceiver:receiver?{id:receiver.id,name:receiver.name,upi:receiver.upi}:null};
    return {status:'REVIEW',paymentStatus:'PENDING',proofVersion:revision+1,submitted:now,...pendingAllocation_(st,a,now),fee,digest,ocr,claim,
      suffix:claim.utr.slice(-4),reason:'',reviewReason:'',linkedRow:'',linkReason:'',late:false,fairPlayVersion:'',agreement:''};
  },(st,a)=>{
    if(!usesBankVerification_(st))return;
    // Extraction is optional and runs outside the journal lock. The desk can read the original.
    try{if(reserveScreenshotRead_(roll))ocr=extractScreenshot_(a,image)}catch{console.warn('Receipt extraction unavailable for '+a.id)}
  });
}
