// Exact matches and manual decisions use the same server-side credit and admission checks.
function rowMentions_(row,utr){return !!utr&&(row.utr===utr||!row.utr&&(row.refs||String(row.raw||'').match(/\b\d{12}\b/g)||[]).includes(utr))}
function paidReceiver_(a){return a.claim?.paidReceiver||a.receiver}
function paymentBlock_(st,a,row,bank){
  if(!a.file||!a.claim||!a.receiver)return 'Missing structured proof or receiver. Ask the player to upload again.';
  if(!validBatch_(a.details?.batch))return 'Ask the player to choose their batch in registration details. Their proof is saved.';
  if(!a.claim.paidReceiver||a.fairPlayVersion!==FAIR_PLAY_VERSION)return 'Ask the player to confirm their registration, payment recipient and fair-play declaration.';
  const recipient=paidReceiver_(a);
  if(row.account!==recipient.id||row.upi!==recipient.upi)return 'Bank credit belongs to a different account from the confirmed recipient.';
  if(row.issue||row.direction!=='CREDIT'||!row.utr)return row.issue||'No verified incoming credit.';
  if(row.minor!==a.fee*100)return 'Bank credit differs from the server-quoted fee.';
  const same=bank.filter(r=>rowMentions_(r,row.utr));
  if(same.some(r=>r.account!==row.account||r.upi!==row.upi||r.minor!==row.minor||r.date!==row.date||r.direction!==row.direction||r.issue))return 'The UTR has conflicting entries, a debit or a reversal.';
  for(const credit of same){
    const bankTime=Date.parse((credit.time||credit.date+'T00:00')+':00+05:30');
    if(Number.isFinite(bankTime)&&row.minor<entryOffer_(bankTime,a.kind).amount*100)return 'Bank credit is below the entry fee at the recorded transfer time.';
  }
  if(new Set(same.map(r=>r.statement)).size!==same.length)return 'The UTR appears more than once in the same statement.';
  const attempts=Object.values(st.attempts);
  if(attempts.some(x=>x.id!==a.id&&x.utr===row.utr))return 'This bank UTR already funded an entry.';
  if(attempts.some(x=>x.id!==a.id&&x.status==='REVIEW'&&(x.claim?.utr===row.utr||x.digest&&x.digest===a.digest)))return 'Multiple registrations claim this credit or screenshot.';
  if(attempts.some(x=>x.id!==a.id&&x.digest===a.digest&&issued_(x)))return 'This screenshot already funded an entry.';
  if(attempts.some(x=>x.id!==a.id&&x.roll===a.roll&&['PAID','QUALIFIED','WINNER'].includes(x.status)))return 'This player already has an active entry.';
  if(a.wave<st.game.next+(st.game.active?1:0)||a.wave<0||a.wave>=WAVES||Date.now()>=EVENT_END)return 'The booked wave has closed. Review seating with the floor.';
  if(attempts.filter(x=>x.id!==a.id&&x.wave===a.wave&&occupied_(x,Date.now())).length>=CAP)return 'The wave is full. Move this payment to an available wave.';
  return '';
}
function autoReason_(st,a,row,bank){
  const block=paymentBlock_(st,a,row,bank);if(block)return block;
  if(row.ocr)return 'PDF extraction needs visual confirmation against the original statement.';
  if(a.claim.paidReceiver.id!==a.receiver.id)return 'Confirmed payment recipient differs from the receiver shown at checkout.';
  if(a.legacyReceiver)return 'The receiving account was supplied after the original checkout.';
  if(a.ocr?.payee&&a.ocr.payee!==a.receiver.upi)return 'Screenshot shows a different receiving UPI ID.';
  if(a.ocr?.uncertain)return 'Screenshot indicates an unsuccessful or pending transfer.';
  if(!a.ocr||!a.ocr.utr||!a.ocr.time||paise_(a.ocr.amount)===null)return 'Screenshot fields could not be independently read.';
  if(a.ocr.utr!==a.claim.utr||a.ocr.time!==a.claim.time||paise_(a.ocr.amount)!==a.claim.amount)return 'Student corrected the extracted payment details.';
  if(a.claim.amount!==row.minor)return 'Screenshot amount differs from the bank credit.';
  if(a.claim.time.slice(0,10)!==row.date)return 'Payment and statement dates differ.';
  const time=Date.parse(a.claim.time+':00+05:30');
  // A player can scan either displayed QR before saving the matching radio choice.
  const shownAtQuote=a.offeredReceivers?.some(option=>option.id===a.receiver.id);
  const firstShown=Math.max(a.quotedAt||a.created,shownAtQuote?0:a.receiverSelectedAt||0);
  if(time+60000<firstShown||time>=EVENT_END||time>a.submitted+60000)return 'Payment time falls outside this registration or the event.';
  const offer=entryOffer_(time,a.kind),cutoffDate=new Date(offer.endsAt+19800000).toISOString().slice(0,10);
  if(offer.early&&a.submitted>=offer.endsAt&&row.date===cutoffDate){
    const confirmedTime=bank.some(r=>r.utr===row.utr&&r.time&&(r.statement===row.statement||r.applied));
    if(!confirmedTime)return 'The statement shows only the cutoff date. Check the bank transfer time before authorizing the Early Bird fee.';
  }
  return '';
}
function paymentMatch_(st,a,bank){
  const exact=bank.filter(r=>r.applied&&r.utr&&r.utr===a.claim?.utr);
  const row=exact.find(r=>r.account===paidReceiver_(a)?.id)||exact[0];
  const staged=bank.some(r=>!r.applied&&r.account===paidReceiver_(a)?.id&&rowMentions_(r,a.claim?.utr));
  const reason=row?autoReason_(st,a,row,bank):staged?'Matching UTR in a staged statement. Check and apply its preview.':'No matching bank UTR. Check the receiver statement.';
  return {id:a.id,version:a.proofVersion||0,roll:a.roll,utr:a.claim?.utr||'',row:row?.key||'',reason,fee:a.fee};
}
function statementPlan_(st,s){
  const bank=bankRows_(st,s.id,true),own=bank.filter(r=>r.statement===s.id),pending=Object.values(st.attempts).filter(a=>a.status==='REVIEW'&&paidReceiver_(a)?.id===s.receiver.id);
  const matches=pending.map(a=>{
    // Only this statement's credits may be applied by this preview.
    const row=own.find(r=>r.utr&&r.utr===a.claim?.utr);
    const reason=row?autoReason_(st,a,row,bank):'No matching UTR in this statement.';
    return {id:a.id,version:a.proofVersion||0,roll:a.roll,utr:a.claim?.utr||'',row:row?.key||'',reason,fee:a.fee};
  });
  const projected=new Map();
  for(const m of matches.filter(m=>!m.reason)){
    const a=st.attempts[m.id],key=a.roll;
    if(projected.has(key)){m.reason='Multiple entries for the same player.';projected.get(key).reason=m.reason}else projected.set(key,m);
  }
  const spent=new Set(Object.values(st.attempts).map(a=>a.utr).filter(Boolean)),claimed=new Set(matches.map(m=>m.row));
  const unassigned=own.filter(row=>!claimed.has(row.key)).map(row=>({line:row.line,utr:row.utr,minor:row.minor,reason:row.issue||(spent.has(row.utr)?'Previously authorized':'No matching student proof')}));
  const version=mac_('bank-preview:'+JSON.stringify([s.id,s.applied||false,matches,unassigned]));
  return {version,statement:statementView_(s),matches,unassigned};
}
function adminStatementPreview(token,id){
  staff_(token,[]);const st=ledger_(),s=st.statements[id];must_(s,'Statement not found.');return statementPlan_(st,s);
}
function adminApplyStatement(token,id,version){
  const admin=staff_(token,[]);
  return locked_(()=>{
    const st=ledger_(),s=st.statements[id];must_(s,'Statement not found.');
    if(s.lastVersion===version)return s.lastResult;
    const plan=statementPlan_(st,s);
    must_(plan.version===version,'The preview changed. Open a fresh preview before applying.');
    const decisions=plan.matches.filter(m=>!m.reason).map(m=>({id:m.id,row:m.row,utr:m.utr}));
    const flagged=plan.matches.filter(m=>m.reason&&st.attempts[m.id].reviewReason!==m.reason).map(m=>[m.id,m.reason]);
    const now=Date.now(),result={authorized:decisions.length,review:plan.matches.length-decisions.length};
    // A single journal append commits this batch and all UTR consumption, including on retry.
    if(!s.applied||decisions.length||flagged.length)commit_(st,'Statement applied',admin.name,{
      statements:[{...s,applied:true,lastVersion:version,lastResult:result}],bankDecisions:decisions,bankFlags:flagged,bankTime:now,bankStatement:id,
      note:s.name+' · '+result.authorized+' authorized · '+result.review+' for review'
    });
    return result;
  });
}
function adminDispatchPasses(token){
  const admin=staff_(token,[]);
  return locked_(()=>{
    const st=ledger_(),items=Object.values(st.attempts).filter(a=>a.bankRow&&a.delivery==='Pending delivery'),people=items.length?roster_():{};
    let failed=0;
    for(const a of items.slice(0,4))if(mailCode_(st,a,people[a.roll],admin.name).delivery!=='Email sent')failed++;
    return {remaining:Math.max(0,items.length-4),failed};
  });
}
function reviewCandidates_(a,bank){
  const rank=r=>(r.key===a.linkedRow?200:0)+(r.utr&&r.utr===a.claim?.utr?100:0)+(r.utr&&a.suffix&&r.utr.endsWith(a.suffix)?18:0)+(r.account===paidReceiver_(a)?.id?10:0)+(r.minor===a.fee*100?5:0)+(r.date&&a.claim?.time.startsWith(r.date)?2:0);
  return bank.map(r=>({r,rank:rank(r)})).filter(v=>v.rank>=10).sort((a,b)=>b.rank-a.rank||a.r.key.localeCompare(b.r.key)).slice(0,10).map(v=>v.r);
}
function adminPaymentDetail(token,id,lookup){
  staff_(token,[]);const st=ledger_(),a=st.attempts[id];must_(a&&a.receiver,'This payment has no saved receiver.');
  const bank=bankRows_(st,'',true),available=bank.filter(r=>r.applied),query=String(lookup||'').trim();
  must_(!query||ref_(query),'Search with a full 12-digit UTR.');
  const rows=query?available.filter(r=>rowMentions_(r,query)).slice(0,40):reviewCandidates_(a,available);
  return {version:a.proofVersion||0,linked:a.linkedRow||'',claim:a.claim||null,ocr:a.ocr||null,
    receiver:a.receiver.name,confirmedRecipient:a.claim?.paidReceiver?.name||'',details:a.details||null,reason:paymentMatch_(st,a,bank).reason||'Exact match available.',rows:rows.map(r=>({...r,sourceUrl:'https://drive.google.com/open?id='+encodeURIComponent(st.statements[r.statement].original)}))};
}
function adminReviewPayment(token,id,action,rowKey,reason,revision){
  const admin=staff_(token,[]);reason=String(reason||'').trim();
  must_(['approve','link','reject'].includes(action)&&reason.length>=3&&reason.length<=240,'Enter a reason for this decision (3–240 characters).');
  return locked_(()=>{
    const st=ledger_(),a=st.attempts[id];must_(a&&a.receiver,'Payment not found.');
    if(action==='approve'&&issued_(a)&&a.bankRow===rowKey)return {status:a.delivery};
    if(action==='reject'&&a.status==='REJECTED'&&a.reason===reason&&revision===a.proofVersion)return {status:'Rejected'};
    must_(a.status==='REVIEW'&&revision===a.proofVersion,'The payment has changed. Reopen it before deciding.');
    if(action==='reject'){commit_(st,'Proof rejected',admin.name,{attempts:[{...a,status:'REJECTED',paymentStatus:'PENDING',reason,linkedRow:'',reviewReason:reason}],note:id});return {status:'Rejected'}}
    const bank=bankRows_(st,'',true),row=bank.find(r=>r.applied&&r.key===rowKey);must_(row,'Choose an applied statement row.');
    if(action==='link'){
      must_(row.account===paidReceiver_(a)?.id,'Select a row from the confirmed receiving account.');
      must_(!Object.values(st.attempts).some(x=>x.id!==id&&row.utr&&x.utr===row.utr),'This bank credit has already funded an entry.');
      if(a.linkedRow!==rowKey||a.linkReason!==reason)commit_(st,'Statement row linked',admin.name,{attempts:[{...a,linkedRow:rowKey,linkReason:reason}],note:id});
      return {status:'Linked · payment pending'};
    }
    const block=paymentBlock_(st,a,row,bank);must_(!block,block);
    must_(!Object.values(st.attempts).some(x=>x.id!==id&&x.status==='REVIEW'&&x.claim?.utr===row.utr),'Another student claims this UTR. Resolve that claim first.');
    commit_(st,'Payment manually authorized',admin.name,{bankDecisions:[{id,row:row.key,utr:row.utr,reason}],bankTime:Date.now(),bankStatement:row.statement,note:id});
    return {status:mailCode_(st,st.attempts[id],roster_()[a.roll],admin.name).delivery};
  });
}
function adminOpenDeskPayment(token,roll,kind){
  const user=staff_(token,['desk']);roll=roll_(roll);
  must_(['walk','retry'].includes(kind),'Choose entry or retry.');
  return locked_(()=>{
    const st=ledger_(),now=Date.now();must_(roster_()[roll],'This roll is missing from the private directory.');
    const active=Object.values(st.attempts).find(a=>a.roll===roll&&['REVIEW','HOLD'].includes(a.status)&&currentRegistration_(st,a).id===a.id);
    if(active)return {id:active.id,status:'This player already has a payment in progress.'};
    const saved=Object.values(st.attempts).find(a=>a.roll===roll&&['REGISTERED','WAITLIST'].includes(a.status)&&a.kind!=='retry'&&kind==='walk');
    eligibility_(st,roll,kind,now,saved?.id);const wave=waveFor_(st,roll,now);must_(wave>=0,'No later qualifier seat is available.');
    const details=saved?.details||latestRegistration_(st,roll)?.details||null;
    const a=attachReceiver_({...newAttempt_(roll,kind,wave,now),...(saved?{id:saved.id}:{}),details,detailsRevision:saved?.detailsRevision||(details?1:0),status:'HOLD'},st,now);
    must_(a.receiver,'Configure a receiving account first.');
    commit_(st,'Desk payment opened',user.name,{attempts:[a],note:a.id});
    return {id:a.id,status:'Payment pending. The player can sign in to see their receiver and upload proof.'};
  });
}

function adminCertifyPdfRow(token,key,values){
  const admin=staff_(token,[]),v=values||{};
  must_(v.confirmed===true&&String(v.reason||'').trim().length>=3&&String(v.reason).length<=240,'Open the original PDF and record why this is an incoming credit.');
  return locked_(()=>{
    const st=ledger_(),bank=bankRows_(st),row=bank.find(r=>r.key===key);
    must_(row?.ocr&&row.direction!=='DEBIT'&&!/debit, not|reversal|foreign currency|receiver differs/i.test(row.issue)&&!/\b(?:debit(?:ed)?|dr|withdrawal|refund(?:ed)?|revers(?:al|ed)|chargeback|declined|pending|cancelled|failed)\b/i.test(row.raw),'Only an unclear PDF credit can be transcribed.');
    const utr=ref_(v.utr),minor=paise_(v.amount),date=bankDate_(v.date);
    must_(utr&&row.raw.includes(utr)&&(!row.utr||row.utr===utr)&&minor>0&&date,'Enter the UTR visible on this line, the credit amount and its bank date.');
    must_(!Object.values(st.attempts).some(a=>a.utr===utr||a.bankRow===key),'This credit has already funded an entry.');
    must_(!row.minor||row.minor===minor,'The extracted amount differs. Obtain a structured statement.');
    const fix={key,values:{utr,minor,date,direction:'CREDIT',issue:'',ocr:true},reason:v.reason.trim(),actor:admin.name};
    commit_(st,'PDF credit transcribed',admin.name,{bankCorrection:fix,note:row.source+' · '+row.line});return true;
  });
}

function adminNeedsReview(token){
  staff_(token,[]);
  const st=ledger_(),bank=bankRows_(st,'',true),attempts=Object.values(st.attempts);
  const payments=attempts.filter(a=>a.status==='REVIEW'&&a.receiver).map(a=>paymentMatch_(st,a,bank));
  const spent=new Map(attempts.filter(a=>a.utr).map(a=>[a.utr,a]));
  const claims=new Set(payments.map(p=>p.row));
  const rows=[];
  for(const row of bank){
    if(!row.applied||claims.has(row.key))continue;
    const used=spent.get(row.utr),original=used&&bank.find(r=>r.key===used.bankRow);
    if(used&&!row.issue&&row.direction==='CREDIT'&&original&&original.account===row.account&&original.minor===row.minor&&original.date===row.date)continue;
    let reason=row.issue||'Bank credit has no matching student proof.';
    if(used)reason='Already authorized for '+used.roll+'. '+(row.issue||'Check this additional bank entry.');
    rows.push({key:row.key,line:row.line,utr:row.utr,minor:row.minor,source:row.source,reason,sourceUrl:'https://drive.google.com/open?id='+encodeURIComponent(st.statements[row.statement].original)});
  }
  return {payments,rows};
}
