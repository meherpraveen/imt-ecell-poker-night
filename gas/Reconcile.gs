// Exact matches and manual decisions use the same server-side credit and admission checks.
function rowMentions_(row,utr){return !!utr&&(row.utr===utr||!row.utr&&(row.refs||String(row.raw||'').match(/\b\d{12}\b/g)||[]).includes(utr))}
function paidReceiver_(a){return a.claim?.paidReceiver||a.receiver}
// A statement can resolve the fee when the screenshot has no readable transfer time.
function bankFeeFitsScreenshot_(a,row){
  const minuteOrDay=row.time||row.date+'T00:00',start=Date.parse(minuteOrDay+':00+05:30');
  const end=row.time?start+59999:Date.parse(row.date+'T23:59:59.999+05:30');
  const latest=Math.min(end,a.submitted+60000,EVENT_END-1),quotedAt=a.quotedAt||a.created;
  return start<=latest&&[start,latest].some(t=>entryOffer_(Math.max(quotedAt,t),a.kind).amount*100===row.minor);
}
function bankRecipient_(st,a,row){
  // OCR is a hint. The administrator can identify the recipient from the original and bank row.
  return (a.claim?.source!=='screenshot'&&a.claim?.paidReceiver)||st.receivers[row.account];
}
function paymentBlock_(st,a,row,bank){
  if(!a.file)return 'A payment screenshot is required.';
  if(!validBatch_(a.details?.batch))return 'Ask the player to choose their batch in registration details. Their proof is saved.';
  const recipient=bankRecipient_(st,a,row);
  if(!recipient||row.account!==recipient.id||row.upi!==recipient.upi)return 'Bank credit belongs to a different account from the confirmed recipient.';
  if(row.issue||row.direction!=='CREDIT'||!row.utr)return row.issue||'No verified incoming credit.';
  if(a.claim?.source==='screenshot'){
    if(!bankFeeFitsScreenshot_(a,row))return 'Bank credit is outside the quoted fee or transfer window.';
  }else if(row.minor!==a.fee*100)return 'Bank credit differs from the server-quoted fee.';
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
  if(Date.now()>=EVENT_END||st.game.next+(st.game.active?1:0)>=WAVES)return 'Qualifier registration has closed. Review this payment with the desk.';
  if(waveFor_(st,a.roll,Date.now(),a.id)<0)return 'Event capacity is full. Review availability with the registration desk.';
  return '';
}
function autoReason_(st,a,row,bank){
  const block=paymentBlock_(st,a,row,bank);if(block)return block;
  if(row.ocr)return 'PDF extraction needs visual confirmation against the original statement.';
  const recipient=a.claim?.paidReceiver;
  if(!recipient||!a.receiver)return 'Compare the original screenshot with the receiving bank account.';
  if(recipient.id!==row.account||recipient.upi!==row.upi)return 'Screenshot recipient differs from the receiving bank account.';
  const screenshot=a.claim.source==='screenshot';
  if(screenshot&&!a.offeredReceivers?.some(option=>option.id===recipient.id))return 'The screenshot recipient was not listed at checkout.';
  if(!screenshot&&a.fairPlayVersion!==FAIR_PLAY_VERSION)return 'Review the original payment proof at the desk.';
  if(!screenshot&&recipient.id!==a.receiver.id)return 'Confirmed payment recipient differs from the receiver shown at checkout.';
  if(a.legacyReceiver)return 'The receiving account was supplied after the original checkout.';
  if(a.ocr?.payee&&a.ocr.payee!==recipient.upi)return 'Screenshot shows a different receiving UPI ID.';
  if(a.ocr?.uncertain)return 'Screenshot indicates an unsuccessful or pending transfer.';
  if(!a.ocr||!a.ocr.utr||!a.ocr.time||paise_(a.ocr.amount)===null)return 'Screenshot fields could not be independently read.';
  if(a.ocr.utr!==a.claim.utr||a.ocr.time!==a.claim.time||paise_(a.ocr.amount)!==a.claim.amount)return 'Student corrected the extracted payment details.';
  if(a.claim.amount!==row.minor)return 'Screenshot amount differs from the bank credit.';
  if(a.claim.time.slice(0,10)!==row.date)return 'Payment and statement dates differ.';
  const time=Date.parse(a.claim.time+':00+05:30');
  // A player can scan either displayed QR before saving the matching radio choice.
  const shownAtQuote=a.offeredReceivers?.some(option=>option.id===recipient.id);
  const firstShown=Math.max(a.quotedAt||a.created,shownAtQuote?0:a.receiverSelectedAt||0);
  if(time+60000<firstShown||time>=EVENT_END||time>a.submitted+60000)return 'Payment time falls outside this registration or the event.';
  const offer=entryOffer_(time,a.kind);
  if(row.minor!==offer.amount*100)return 'Bank credit differs from the fee at the screenshot transfer time.';
  const cutoffDate=new Date(offer.endsAt+19800000).toISOString().slice(0,10);
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
function statementPlan_(st,s,bank=bankRows_(st,s.id,true)){
  const own=bank.filter(r=>r.statement===s.id),pending=Object.values(st.attempts).filter(a=>a.status==='REVIEW'&&paidReceiver_(a)?.id===s.receiver.id);
  const matches=pending.map(a=>{
    // Only this statement's credits may be applied by this preview.
    const row=own.find(r=>r.utr&&r.utr===a.claim?.utr);
    const reason=row?autoReason_(st,a,row,bank):'No matching UTR in this statement.';
    return {id:a.id,version:a.proofVersion||0,roll:a.roll,utr:a.claim?.utr||'',row:row?.key||'',reason,fee:row&&!reason?row.minor/100:a.fee};
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
function bankRevision_(state){
  return JSON.stringify([state.statements,state.bankCorrections]);
}
function readBankEvidence_(state,includeStaged){
  return {revision:bankRevision_(state),rows:bankRows_(state,'',includeStaged)};
}
function adminApplyStatement(token,id,version){
  staff_(token,[]);
  const before=ledger_(),original=before.statements[id];must_(original,'Statement not found.');
  if(original.lastVersion===version&&original.applied)return original.lastResult;
  const evidence=readBankEvidence_(before,true);
  return locked_(()=>{
    const admin=staff_(token,[]);
    const st=ledger_(),s=st.statements[id];must_(s,'Statement not found.');
    if(s.lastVersion===version&&s.applied)return s.lastResult;
    must_(evidence.revision===bankRevision_(st),'The preview changed. Open a fresh preview before applying.');
    const plan=statementPlan_(st,s,evidence.rows);
    must_(plan.version===version,'The preview changed. Open a fresh preview before applying.');
    const decisions=plan.matches.filter(m=>!m.reason).map(m=>({id:m.id,row:m.row,utr:m.utr,fee:m.fee}));
    const flagged=plan.matches.filter(m=>m.reason&&st.attempts[m.id].reviewReason!==m.reason).map(m=>[m.id,m.reason]);
    const now=Date.now(),result={authorized:decisions.length,review:plan.matches.length-decisions.length};
    // A single journal append commits this batch and all UTR consumption, including on retry.
    if(!s.applied||decisions.length||flagged.length)commit_(st,'Statement applied',admin.name,{
      statements:[{...s,applied:true,lastVersion:version,lastResult:result}],bankDecisions:decisions,bankFlags:flagged,bankTime:now,bankStatement:id,
      note:s.name+' · '+result.authorized+' authorized · '+result.review+' for review'
    });
    return result;
  },false);
}
function adminDispatchPasses(token){
  const admin=staff_(token,[]),items=Object.values(ledger_().attempts).filter(a=>a.bankRow&&a.delivery==='Pending delivery');
  if(passEmailsPaused_())return {remaining:items.length,failed:0,paused:true};
  let failed=0;
  for(const a of items.slice(0,4))if(deliverPass_(a.id,admin.name)==='Desk delivery needed')failed++;
  return {remaining:Math.max(0,items.length-4),failed};
}
function reviewCandidates_(a,bank){
  const rank=r=>(r.key===a.linkedRow?200:0)+(r.utr&&r.utr===a.claim?.utr?100:0)+(r.utr&&a.suffix&&r.utr.endsWith(a.suffix)?18:0)+(r.account===paidReceiver_(a)?.id?10:0)+(r.minor===a.fee*100?5:0)+(r.date&&a.claim?.time?.startsWith(r.date)?2:0);
  return bank.map(r=>({r,rank:rank(r)})).filter(v=>v.rank>=10).sort((a,b)=>b.rank-a.rank||a.r.key.localeCompare(b.r.key)).slice(0,10).map(v=>v.r);
}
function adminPaymentDetail(token,id,lookup){
  staff_(token,[]);const st=ledger_(),a=st.attempts[id];must_(a&&(a.receiver||a.file&&usesBankVerification_(st)),'Payment not found.');
  const query=String(lookup||'').trim();
  must_(!query||ref_(query),'Search with a full 12-digit UTR.');
  const bank=bankRows_(st,'',true),available=bank.filter(r=>r.applied);
  const rows=query?available.filter(r=>rowMentions_(r,query)).slice(0,40):reviewCandidates_(a,available);
  return {version:a.proofVersion||0,canReadReference:a.status==='REVIEW'&&!!a.file,
    linked:a.linkedRow||'',claim:a.claim||null,ocr:a.ocr||null,
    receiver:a.receiver?.name||'Unknown',confirmedRecipient:a.claim?.paidReceiver?.name||'',details:a.details||null,reason:paymentMatch_(st,a,bank).reason||'Exact match available.',rows:rows.map(r=>({...r,sourceUrl:'https://drive.google.com/open?id='+encodeURIComponent(st.statements[r.statement].original)}))};
}
function adminReviewPayment(token,id,action,rowKey,reason,revision){
  const admin=staff_(token,[]);reason=String(reason||'').trim();
  must_(['approve','link','reject'].includes(action)&&reason.length>=3&&reason.length<=240,'Enter a reason for this decision (3–240 characters).');
  let evidence;
  if(action!=='reject'){
    const before=ledger_(),a=before.attempts[id];
    if(a?.status==='REVIEW'&&revision===(a.proofVersion||0))evidence=readBankEvidence_(before,true);
  }
  const result=locked_(()=>{
    if(evidence)staff_(token,[]);
    const st=ledger_(),a=st.attempts[id];must_(a&&(a.receiver||a.file&&usesBankVerification_(st)),'Payment not found.');
    if(action==='approve'&&issued_(a)&&a.bankRow===rowKey)return null;
    if(action==='reject'&&a.status==='REJECTED'&&a.reason===reason&&revision===(a.proofVersion||0))return {status:'Rejected'};
    must_(a.status==='REVIEW'&&revision===(a.proofVersion||0),'The payment has changed. Reopen it before deciding.');
    if(action==='reject'){commit_(st,'Proof rejected',admin.name,{attempts:[{...a,status:'REJECTED',paymentStatus:'PENDING',reason,linkedRow:'',reviewReason:reason}],note:id});return {status:'Rejected'}}
    must_(evidence&&evidence.revision===bankRevision_(st),'The bank evidence changed. Reopen the payment before deciding.');
    const bank=evidence.rows,row=bank.find(r=>r.applied&&r.key===rowKey);must_(row,'Choose an applied statement row.');
    if(action==='link'){
      const recipient=bankRecipient_(st,a,row);
      must_(recipient&&row.account===recipient.id&&row.upi===recipient.upi,'Select a row from the receiving account.');
      must_(!Object.values(st.attempts).some(x=>x.id!==id&&row.utr&&x.utr===row.utr),'This bank credit has already funded an entry.');
      if(a.linkedRow!==rowKey||a.linkReason!==reason)commit_(st,'Statement row linked',admin.name,{attempts:[{...a,linkedRow:rowKey,linkReason:reason}],note:id});
      return {status:'Linked · payment pending'};
    }
    const block=paymentBlock_(st,a,row,bank);must_(!block,block);
    must_(!Object.values(st.attempts).some(x=>x.id!==id&&x.status==='REVIEW'&&x.claim?.utr===row.utr),'Another student claims this UTR. Resolve that claim first.');
    commit_(st,'Payment manually authorized',admin.name,{bankDecisions:[{id,row:row.key,utr:row.utr,fee:row.minor/100,reason}],bankTime:Date.now(),bankStatement:row.statement,note:id});
    return null;
  },false);
  return result||{status:deliverPass_(id,admin.name)};
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
  staff_(token,[]);const v=values||{};
  must_(v.confirmed===true&&typeof v.reason==='string'&&v.reason.trim().length>=3&&v.reason.length<=240,'Open the original PDF and record why this is an incoming credit.');
  const evidence=readBankEvidence_(ledger_(),false);
  return locked_(()=>{
    const admin=staff_(token,[]),st=ledger_();
    must_(evidence.revision===bankRevision_(st),'The bank evidence changed. Reopen the payment before transcribing.');
    const row=evidence.rows.find(r=>r.key===key);
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
  const managed=usesBankVerification_(st);
  const payments=attempts.filter(a=>a.status==='REVIEW'&&(a.receiver||managed&&a.file)).map(a=>paymentMatch_(st,a,bank));
  const spent=new Map(attempts.filter(a=>a.utr).map(a=>[a.utr,a]));
  const claims=new Set(payments.map(p=>p.row));
  const byKey=new Map(bank.map(row=>[row.key,row]));
  const rows=[];
  for(const row of bank){
    if(!row.applied||claims.has(row.key))continue;
    const used=spent.get(row.utr),original=used&&byKey.get(used.bankRow);
    if(used&&!row.issue&&row.direction==='CREDIT'&&original&&original.account===row.account&&original.minor===row.minor&&original.date===row.date)continue;
    let reason=row.issue||'Bank credit has no matching student proof.';
    if(used)reason='Already authorized for '+used.roll+'. '+(row.issue||'Check this additional bank entry.');
    rows.push({key:row.key,line:row.line,utr:row.utr,minor:row.minor,source:row.source,reason,sourceUrl:'https://drive.google.com/open?id='+encodeURIComponent(st.statements[row.statement].original)});
  }
  return {payments,rows};
}
