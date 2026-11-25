import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createEvent} from './e2e/event-runtime.mjs';
import {club,credit,csvHeader,day,image,jpegQr,paidAt,receiptText,testUpi,utr} from './payment-fixtures.mjs';

function start(){
  const event=createEvent(),api=club(event),receiver=api.makeReceiver(),p=api.student();
  return {...api,event,receiver,p};
}
test('receipt references prefer bank labels, preserve zeroes and handle unlabeled OCR without guessing among competing IDs',()=>{
  const event=createEvent(),read=text=>event.staff('readPaymentText_',[text]);
  const ref='012345678901',other='987654321012';
  for(const text of [
    'UPI Ref No.:\n012345678901','Bank Reference Number\n0123 4567 8901','RRN: 012345-678901',
    'UTR Number: 012 345 678 901','UPI Txn ID: 0123\n4567\n8901','UPI Ref. No. ०१२३४५६७८९०१',
    'Payment successful\n'+ref+'\nShare receipt','UPI Transaction ID: '+ref+'\nOrder ID: '+other,
    'Transaction ID: '+other+'\nBank ref. no: '+ref,'Order ID: '+other+'\n'+ref,'Reference Number: '+ref,
    'Bank Ref: '+ref+' 25 Nov 2026','UTR '+ref+' 15:36 IST'
  ])assert.equal(read(text).utr,ref,text);
  for(const text of ['Order ID: '+other,'Account No: '+other,'ACME123456789012','VPA: '+other+'@bank',
    'Card 1234 5678 9012 3456','UPI Ref No: 123456789012345','Mobile: +919876543210','₹123456789012.50'])
    assert.equal(read(text).utr,'',text);
  assert.equal(read(ref+'\n'+ref).utr,ref);
  for(const text of [ref+'\n'+other,ref+' '+other,'UPI Ref No: '+ref+'\nUTR: '+other]){
    const result=read(text);assert.equal(result.utr,'');assert.deepEqual(Array.from(result.utrCandidates),[ref,other]);
  }
});

test('an administrator can reread an existing original without replacing it, overriding a payer or authorizing an entry',()=>{
  const f=start(),id=f.p.hold.id,admin=f.admin;
  f.event.ocr(null);f.publicRpc('playerSubmitScreenshot',f.p.token,f.p.hold.ticket,image,'0');
  const original=f.event.staff('ledger_',[]).attempts[id].file;
  const before=f.rpc('adminPaymentDetail',admin,id,'');assert.equal(before.canReadReference,true);
  const gate=f.rpc('staffLogin',f.event.team.gate,f.event.invite('gate')).token;
  assert.throws(()=>f.rpc('adminReadScreenshotReference',gate,id,1),/role/);
  f.event.ocr('UPI Ref No: 012345678901\nUTR: 987654321012');
  assert.equal(f.rpc('adminReadScreenshotReference',admin,id,1).found,false);
  let detail=f.rpc('adminPaymentDetail',admin,id,'');
  assert.equal(detail.version,2);assert.equal(detail.claim.utr,'');assert.equal(detail.ocr.utrCandidates.length,2);
  f.event.ocr('Payment successful\n'+utr);
  assert.throws(()=>f.rpc('adminReadScreenshotReference',admin,id,1),/changed/);
  assert.equal(f.rpc('adminReadScreenshotReference',admin,id,2).found,true);
  detail=f.rpc('adminPaymentDetail',admin,id,'');
  assert.equal(detail.claim.utr,utr);assert.equal(detail.canReadReference,true);
  const saved=f.event.staff('ledger_',[]).attempts[id];
  assert.equal(saved.file,original);assert.equal(saved.status,'REVIEW');assert.equal(saved.utr||'','');
  assert.equal(f.rpc('proofImage',admin,id,true).version,detail.version);
  assert.equal(f.rpc('staffSnapshot',admin).records.find(r=>r.id===id).utr,utr);
  assert.equal(f.p.status().entryCode,'');
  const g=start();g.event.ocr(null);g.submit(g.p,g.submission(g.p,{},image,'No reference'));
  g.event.ocr('Bank Reference: 987654321012');
  g.rpc('adminReadScreenshotReference',g.admin,g.p.hold.id,1);
  const legacy=g.rpc('adminPaymentDetail',g.admin,g.p.hold.id,'');
  assert.equal(legacy.ocr.utr,'987654321012');assert.equal(legacy.claim.utr,utr);
});

test('Paytm Ref No outranks an app ID and a damaged rupee glyph needs matching written currency',()=>{
  const event=createEvent(),read=text=>event.staff('readPaymentText_',[text]);
  const receipt=(amount,words='One Hundred Forty Nine Rupees')=>
    ['Paytm','Example Receiver','******1234@samplebank on Paytm',amount,words,'Paid Successfully','From','Sample Student',
      'Bank Of Example - 2276','25 Nov, 02:52 AM | Ref No: 0123 4567 8901','Transaction ID: 987654321012'].join('\r\n');
  for(const amount of ['149','$149','₹149','149.00']){
    const fields=read(receipt(amount));assert.equal(fields.utr,utr);assert.equal(fields.amount,'149.00');
    assert.equal(fields.time,'');assert.equal(fields.payee,'');
  }
  assert.equal(read(receipt('199','One Hundred and Ninety-Nine Rupees Only')).amount,'199.00');
  assert.equal(read(receipt('$149','One Hundred Fifty Rupees')).amount,'');
  assert.equal(read(receipt('149','One Hundred Forty Nine Dollars')).amount,'');
  assert.equal(read('Bank account: 149\nOne Hundred Forty Nine Rupees').amount,'');
  assert.equal(read('$149\nPaid Successfully').amount,'');
  assert.equal(read(receipt('149')+'\nINR 199').amount,'');
  assert.equal(read(receipt('149')+'\nPayment pending').uncertain,true);
  assert.equal(read(receipt('149')+'\nRef No: 987654321012').utr,'');
});

test('rereading a saved screenshot fills its missing amount even when its UTR is already known',()=>{
  const f=start(),id=f.p.hold.id;
  f.event.ocr('Ref No: '+utr);
  f.publicRpc('playerSubmitScreenshot',f.p.token,f.p.hold.ticket,image,'0');
  const before=f.event.staff('ledger_',[]).attempts[id];
  assert.equal(before.claim.amount,null);
  assert.equal(f.rpc('adminPaymentDetail',f.admin,id,'').canReadReference,true);
  f.event.ocr('Paytm\n149\nOne Hundred Forty Nine Rupees\nRef No: '+utr);
  assert.equal(f.rpc('adminReadScreenshotReference',f.admin,id,1).updated,true);
  const saved=f.event.staff('ledger_',[]).attempts[id];
  assert.equal(saved.claim.amount,14900);assert.equal(saved.ocr.amount,'149.00');
  assert.equal(saved.file,before.file);assert.equal(saved.status,'REVIEW');assert.equal(saved.proofVersion,2);
  assert.equal(f.rpc('adminPaymentDetail',f.admin,id,'').canReadReference,false);
  assert.equal(f.rpc('adminReadScreenshotReference',f.admin,id,2).updated,false);
  assert.equal(f.event.staff('ledger_',[]).attempts[id].proofVersion,2);
});

test('managed checkout pins the server quote and receiver, validates QR and preserves old account revisions',()=>{
  const f=start(),{rpc,admin,p,receiver,event}=f;
  assert.equal(p.hold.fee,149);assert.equal(p.hold.paymentStatus,'PENDING');assert.equal(p.hold.receiver.id,receiver.id);
  assert.ok(p.hold.paymentQr.startsWith('data:image/gif;base64,'));assert.equal(p.hold.entryCode,'');
  const change={...receiver,upi:'new@samplebank',active:true};
  assert.throws(()=>rpc('adminSaveReceiver',admin,{...change,qr:image}),/different UPI/);
  assert.throws(()=>event.staff('verifyUpiQr_',[Array.from(jpegQr(testUpi+'=extra')),testUpi]),/different UPI/);
  assert.throws(()=>rpc('adminSaveReceiver',admin,change),/matching QR/);
  const next=rpc('adminSaveReceiver',admin,{...change,qr:'data:image/jpeg;base64,'+jpegQr(change.upi).toString('base64')});
  assert.notEqual(next.id,receiver.id);
  const old=p.status();assert.equal(old.receiver.upi,testUpi);assert.equal(old.upi,'');
  assert.equal(f.student('223456789','second@example.test').hold.receiver.id,next.id);
  assert.throws(()=>rpc('adminSaveReceiver',admin,{...receiver,active:false}),/changed/);
  const snap=rpc('staffSnapshot',admin);
  assert.equal(snap.settings.receivers.length,2);assert.equal(snap.settings.receivers.find(r=>r.id===receiver.id).active,false);
  const gate=rpc('staffLogin',event.team.gate,event.invite('gate')).token;
  assert.throws(()=>rpc('adminNeedsReview',gate),/role/);assert.equal(rpc('staffSnapshot',gate).settings,null);
  assert.equal(event.post({action:'adminApplyStatement',args:[]}).ok,false);
  assert.throws(()=>rpc('staffApprove',admin,p.hold.id,utr,true));
});
test('proof is mandatory and owner bound; edits, server OCR evidence and replays are versioned',()=>{
  const f=start(),{p}=f;
  const s=f.submission(p);assert.equal(s.values.ocr.utr,utr);assert.equal(s.values.ocr.time,paidAt);assert.equal(s.values.ocr.payee,testUpi);
  for(const edits of [{utr:'1234'},{time:'2026-02-30T15:00'},{amount:'2.125'},{beneficiary:'223456789'},{fairPlay:false},{receiver:'wrong'}]){
    assert.throws(()=>f.submit(p,{...s,values:{...s.values,...edits}}));
  }
  assert.throws(()=>f.submit(p,{...s,proof:''}));
  const other=f.student('223456789','second@example.test');
  assert.throws(()=>f.publicRpc('playerSubmitPayment',other.token,p.hold.ticket,s.proof,JSON.stringify({...s.values,beneficiary:other.hold.beneficiary})),/unavailable for your account/);
  const first=f.submit(p,s);assert.equal(first.paymentStatus,'PENDING');assert.equal(first.proofVersion,1);
  assert.equal(f.submit(p,s).proofVersion,1);
  assert.throws(()=>f.submit(p,{...s,values:{...s.values,payer:'Changed payer'}}),/proof changed/);
  const replacement=f.submission(p,{payer:'Another payer'});assert.equal(f.submit(p,replacement).proofVersion,2);
  assert.deepEqual(f.event.rows.Journal.filter(r=>/^Proof (submitted|replaced)$/.test(r[1])).map(r=>r[1]),['Proof submitted','Proof replaced']);
});
test('preview, single journal authorization, retry, parallel claims on one code, gate and a later reversal',()=>{
  const f=start(),{p,receiver,rpc,admin,event}=f;f.submit(p,f.submission(p,{fee:'0.01'}));
  const plan=f.statement(receiver);assert.equal(plan.matches[0].reason,'');assert.equal(p.status().entryCode,'');
  assert.equal(rpc('gateAction',admin,'admit',rpc('pass_',p.hold.id),randomUUID()).status,'invalid');
  assert.equal(f.apply(plan).authorized,1);assert.equal(f.apply(plan).authorized,1);assert.equal(p.status().paymentStatus,'AUTHORIZED');
  assert.equal(f.statement(receiver,[credit()],'renamed.csv').statement.id,plan.statement.id);
  const overlapping=f.statement(receiver,[credit(),credit('012345678902')],'overlap.csv');assert.equal(f.apply(overlapping).authorized,0);
  assert.equal(event.rows.Journal.filter(r=>r[1]==='Statement applied'&&JSON.parse(r[3]).bankDecisions.length).length,1);
  assert.equal(rpc('adminDispatchPasses',admin).remaining,0);assert.equal(rpc('adminDispatchPasses',admin).failed,0);
  assert.equal(event.mail.filter(m=>m.subject.endsWith('entry pass')).length,1);
  const code=p.status().entryCode,one=rpc('gateAction',admin,'admit',code,randomUUID()),two=rpc('gateAction',admin,'admit',code,randomUUID());
  assert.equal(one.status,'admitted');assert.equal(two.status,'used');assert.equal(one.seat,two.seat);assert.equal(p.status().seat,one.seat);assert.equal(p.status().entryCode,'');
  const reversed=f.statement(receiver,[[day,utr,'','149',testUpi,'Refund'].join(',')],'reversal.csv');f.apply(reversed);
  const queue=rpc('adminNeedsReview',admin);
  assert.ok(queue.rows.some(r=>r.reason.includes('Already authorized')&&r.reason.includes('Debit')));
  assert.ok(queue.rows.some(r=>r.utr==='012345678902'&&r.reason.includes('no matching')));
});
test('a stale preview cannot authorize a changed proof; linking keeps it pending until an audited decision',()=>{
  const f=start(),{p,receiver,rpc,admin}=f;f.submit(p,f.submission(p));
  const stale=f.statement(receiver);
  f.submit(p,f.submission(p,{amount:'140'}));
  assert.throws(()=>f.apply(stale),/preview changed/);
  const plan=rpc('adminStatementPreview',admin,stale.statement.id);assert.match(plan.matches[0].reason,/corrected/);assert.equal(f.apply(plan).authorized,0);
  const detail=rpc('adminPaymentDetail',admin,p.hold.id,'');assert.equal(detail.claim.amount,14000);assert.equal(detail.ocr.amount,'149.00');
  const row=detail.rows[0].key;
  assert.throws(()=>rpc('adminReviewPayment',admin,p.hold.id,'approve',row,'',detail.version),/reason/);
  rpc('adminReviewPayment',admin,p.hold.id,'link',row,'Compared original bank credit',detail.version);
  assert.equal(p.status().paymentStatus,'PENDING');
  assert.throws(()=>rpc('adminReviewPayment',admin,p.hold.id,'approve',row,'Original image read',1),/changed/);
  rpc('adminReviewPayment',admin,p.hold.id,'approve',row,'Original screenshot shows the quoted amount',detail.version);
  rpc('adminReviewPayment',admin,p.hold.id,'approve',row,'Original screenshot shows the quoted amount',detail.version);
  assert.equal(p.status().paymentStatus,'AUTHORIZED');assert.equal(f.event.rows.Journal.filter(row=>row[1]==='Payment manually authorized').length,1);
});
test('competing claims and screenshot reuse hold both registrations; rejecting one permits the genuine credit',()=>{
  const f=start(),q=f.student('223456789','second@example.test');f.submit(f.p,f.submission(f.p));f.submit(q,f.submission(q));
  const plan=f.statement(f.receiver);assert.ok(plan.matches.every(m=>m.reason.includes('Multiple registrations')));assert.equal(f.apply(plan).authorized,0);
  const detail=f.rpc('adminPaymentDetail',f.admin,q.hold.id,'');
  assert.throws(()=>f.rpc('adminReviewPayment',f.admin,q.hold.id,'approve',detail.rows[0].key,'Check original credit',1),/Multiple registrations/);
  f.rpc('adminReviewPayment',f.admin,q.hold.id,'reject','','Duplicate receipt confirmed',1);
  assert.equal(q.status().paymentStatus,'PENDING');assert.match(q.status().issue,/Duplicate/);
  assert.equal(f.apply(f.rpc('adminStatementPreview',f.admin,plan.statement.id)).authorized,1);
  f.submit(q,f.submission(q));const replay=f.statement(f.receiver);
  assert.match(replay.matches[0].reason,/already funded/);assert.equal(f.apply(replay).authorized,0);
});
test('failed OCR, tampered OCR and a different payee require review while a later upload can match',()=>{
  for(const kind of ['unavailable','tampered','payee','late']){
    const f=start();
    if(kind==='late')f.event.advance(16*60*1000);
    const raw=kind==='unavailable'?null:receiptText(utr,'149.00',kind==='payee'?'different@samplebank':testUpi);
    const s=f.submission(f.p,{},image,raw);
    if(kind==='tampered')s.values.ocr={...s.values.ocr,seal:'invalid'};
    f.submit(f.p,s);const plan=f.statement(f.receiver);
    if(kind==='late'){assert.equal(plan.matches[0].reason,'');assert.equal(f.apply(plan).authorized,1)}
    else{assert.match(plan.matches[0].reason,/read|different receiving/i,kind);assert.equal(f.apply(plan).authorized,0)}
  }
});
test('bank parser blocks wrong account, amounts, debit, contradictions, formulas, reused and ambiguous UTRs',()=>{
  const f=start();f.submit(f.p,f.submission(f.p));
  const invalid=[
    [[credit(utr,'0.01')],/fee/],[[credit(utr,'149','other@samplebank')],/receiver/i],
    [[[day,utr,'','149',testUpi,'bank'].join(',')],/debit/i],
    [[credit(),[day,utr,'','149',testUpi,'reversal'].join(',')],/conflicting|reversal/],
    [[credit(),credit()],/more than once/],[[credit(),credit().replace('UPI credit','also 888888888888')],/conflicting/],
    [[credit().replace('UPI credit','=SUM(1)')],/Formula/],[[credit().replace('UPI credit','pending')],/unconfirmed/]
  ];
  for(const [lines,pattern] of invalid){const single=start();single.submit(single.p,single.submission(single.p));const plan=single.statement(single.receiver,lines);assert.match(plan.matches[0].reason,pattern);assert.equal(single.p.status().entryCode,'')}
  f.statement(f.receiver,[credit(utr,'0.01')]);
  const other=f.makeReceiver('second@samplebank','Second receiver');assert.throws(()=>f.statement(other,[credit(utr,'0.01')]),/another receiver/);
  assert.throws(()=>f.importFile(f.receiver.id,'bank.xlsx',Buffer.from('plain text')),/extension/);
  assert.throws(()=>f.importFile(f.receiver.id,'bank.csv','random,columns\nabc,def'),/header/);
  const clean=start();clean.submit(clean.p,clean.submission(clean.p));
  const quoted=clean.importFile(clean.receiver.id,'regional.csv','Cover page\r\n'+csvHeader.replaceAll(',',';')+'\r\n'+credit().replaceAll(',',';').replace('UPI credit','"details; ""credit"""'));
  assert.equal(quoted.matches[0].reason,'');assert.ok(quoted.unassigned.some(r=>r.reason.includes('Unrecognized')));
});
test('Excel records carry formulas and account ownership; unreadable PDFs require original-source manual certification',()=>{
  const x=start();x.submit(x.p,x.submission(x.p));
  const cells=[csvHeader.split(','),credit().split(',')],xlsx=Buffer.from([80,75,3,4,0]),xls=Buffer.from([208,207,17,224,161,177,26,225,0]);
  x.event.excel([{name:'Bank',cells}]);assert.equal(x.importFile(x.receiver.id,'bank.xlsx',xlsx).matches[0].reason,'');
  x.event.excel([{name:'Bank',cells,formulas:[cells[0].map(()=>''),['','','','','','=FORMULA']]}]);assert.match(x.importFile(x.receiver.id,'bank.xls',xls).matches[0].reason,/Formula/);
  const f=start();f.submit(f.p,f.submission(f.p));
  f.event.ocr('Incoming payment '+utr+' INR 149 23 Nov 2026');const pdf=f.importFile(f.receiver.id,'bank.pdf',Buffer.from('%PDF-1.5 synthetic'));
  assert.ok(pdf.matches[0].reason);assert.equal(f.apply(pdf).authorized,0);
  const row=f.rpc('adminPaymentDetail',f.admin,f.p.hold.id,utr).rows[0];assert.equal(row.ocr,true);
  const fix={confirmed:true,reason:'Checked labelled credit on original PDF',utr,amount:'149',date:day};
  assert.throws(()=>f.rpc('adminCertifyPdfRow',f.admin,row.key,{...fix,utr:'012345678902'}));
  f.rpc('adminCertifyPdfRow',f.admin,row.key,fix);
  const checked=f.rpc('adminStatementPreview',f.admin,pdf.statement.id);
  assert.match(checked.matches[0].reason,/visual confirmation/);assert.equal(f.apply(checked).authorized,0);
  f.rpc('adminReviewPayment',f.admin,f.p.hold.id,'approve',row.key,'Verified original statement and proof',1);assert.equal(f.p.status().paymentStatus,'AUTHORIZED');
});
test('an applied statement can later match new proof and mail failure leaves an accessible pass and a visible delivery task',()=>{
  const f=start();const plan=f.statement(f.receiver);assert.equal(f.apply(plan).authorized,0);f.submit(f.p,f.submission(f.p));
  const ready=f.rpc('adminNeedsReview',f.admin).payments;assert.equal(ready[0].reason,'');
  assert.equal(f.apply(f.rpc('adminStatementPreview',f.admin,plan.statement.id)).authorized,1);
  f.event.mailFailure(true);const delivery=f.rpc('adminDispatchPasses',f.admin);assert.equal(delivery.failed,1);
  assert.equal(f.p.status().delivery,'Desk delivery needed');assert.ok(f.p.status().entryCode);
});

test('fresh installation requires receiver verification even before the first account is enabled',()=>{
  const event=createEvent({freshInstall:true}),f=club(event);
  assert.equal(f.rpc('staffSnapshot',f.admin).managed,true);
  assert.throws(()=>f.rpc('deskPayment',f.admin,'123456789','walk',utr,true,149),/upload proof/);
  const p=f.student();assert.equal(p.hold.status,'REGISTERED');assert.equal(p.hold.canCheckout,false);
  f.makeReceiver();assert.equal(p.status().status,'HOLD');assert.ok(p.status().paymentQr);
});
test('clear PDF columns with explicit incoming direction can authorize; negative text cannot be transcribed as credit',()=>{
  const f=start();f.submit(f.p,f.submission(f.p));
  f.event.ocr(['Date | UTR | Amount | Type | Receiver UPI',[day,utr,'149','CREDIT',testUpi].join(' | ')].join('\n'));
  const parsed=f.importFile(f.receiver.id,'printed.pdf','%PDF-1.5 printed');assert.equal(parsed.matches[0].reason,'');
  f.event.ocr('Refund sent back for '+utr+' INR 149');const reverse=f.importFile(f.receiver.id,'unclear.pdf','%PDF-1.5 OCR debit');
  assert.equal(f.apply(reverse).authorized,0);
  const row=f.rpc('adminPaymentDetail',f.admin,f.p.hold.id,utr).rows[0];
  assert.throws(()=>f.rpc('adminCertifyPdfRow',f.admin,row.key,{confirmed:true,reason:'Original reviewed',utr,amount:'149',date:day}),/Only an unclear/);
});

test('a staged reversal invalidates an earlier exact preview before it can consume the credit',()=>{
  const f=start();f.submit(f.p,f.submission(f.p));const first=f.statement(f.receiver);
  assert.equal(first.matches[0].reason,'');
  f.statement(f.receiver,[[day,utr,'',149,testUpi,'Reversal'].join(',')],'later.csv');
  assert.throws(()=>f.apply(first),/preview changed/);
  const reviewed=f.rpc('adminStatementPreview',f.admin,first.statement.id);
  assert.match(reviewed.matches[0].reason,/conflicting/);assert.equal(f.apply(reviewed).authorized,0);
  assert.throws(()=>f.rpc('adminReviewPayment',f.admin,f.p.hold.id,'approve',reviewed.matches[0].row,'Check original evidence',1),/conflicting/);
});

test('form fields are stored against verified PGP ID, with a required phone number and batch',()=>{
  const event=createEvent(),f=club(event),r=f.makeReceiver();
  f.publicRpc('requestEventCode','123456789');
  const token=f.publicRpc('signInEvent','123456789',event.code('player@example.test'),'').session.token;
  const valid={pgpId:'123456789',fullName:'Sample Full Name',contact:'+91 98765 43210',batch:'2026-28'};
  for(const overrides of [{pgpId:'223456789'},{fullName:'  '},{contact:'call me'},{contact:''},{contact:undefined},{contact:'123'},{contact:'+'.padEnd(20,'9')},{batch:'2024-26'},{batch:''},{batch:undefined}]){
    assert.throws(()=>f.publicRpc('playerStart',token,'',randomUUID(),JSON.stringify({...valid,...overrides})));
  }
  const saved=f.publicRpc('playerStart',token,'',randomUUID(),JSON.stringify(valid));
  assert.deepEqual(JSON.parse(JSON.stringify(saved.details)),valid);assert.equal(saved.receiver.id,r.id);
  assert.equal(saved.fairPlay,'I agree to play fair, respect the rules, and accept all decisions made by E-Cell, IMT Ghaziabad.');
  const current=f.publicRpc('playerStatus',token,saved.ticket);assert.equal(current.details.batch,'2026-28');
});
test('both receiver options preserve the quote; a payment sent to a different confirmed account requires review',()=>{
  const f=start(),{p,receiver,admin}=f,next=f.makeReceiver('backup@samplebank','Second Treasurer');
  const first=p.status();assert.deepEqual(Array.from(first.paymentRecipients,r=>r.name).sort(),['Second Treasurer','Test receiver']);
  const switched=f.publicRpc('playerSelectReceiver',p.token,p.hold.ticket,next.id);
  assert.equal(switched.upi,next.upi);assert.equal(switched.fee,first.fee);assert.equal(switched.expires,first.expires);
  p.hold=switched;
  const proof=f.submission(p,{paidReceiver:receiver.id});
  assert.throws(()=>f.submit(p,{...proof,values:{...proof.values,paidReceiver:''}}),/recipient/);
  assert.throws(()=>f.submit(p,{...proof,values:{...proof.values,agreementVersion:'old'}}),/fair-play/);
  f.submit(p,proof);
  assert.throws(()=>f.publicRpc('playerSelectReceiver',p.token,p.hold.ticket,receiver.id),/current checkout/);
  const plan=f.statement(receiver);assert.match(plan.matches[0].reason,/differs from the receiver shown/);assert.equal(f.apply(plan).authorized,0);
  const v=f.rpc('adminPaymentDetail',admin,p.hold.id,'');assert.equal(v.receiver,next.name);assert.equal(v.confirmedRecipient,receiver.name);
  f.rpc('adminReviewPayment',admin,p.hold.id,'approve',v.rows[0].key,'Verified the confirmed alternate receiver’s original bank credit',1);
  assert.equal(p.status().paymentStatus,'AUTHORIZED');
});
test('both codes are private to an open hold and receiver choices are audited, small and safe to retry',()=>{
  const event=createEvent(),clubApi=club(event);
  const first=clubApi.makeReceiver(),second=clubApi.makeReceiver('other@samplebank','Second receiver');
  const student=clubApi.student(),{ticket}=student.hold;
  const select=(id,version)=>clubApi.publicRpc('playerSelectReceiver',student.token,ticket,id,String(version));
  assert.equal(student.hold.chosenReceiverId,'');
  assert.deepEqual(Array.from(student.hold.checkoutReceivers,r=>r.id),[first.id,second.id]);
  assert.ok(student.hold.checkoutReceivers.every(r=>r.qr.startsWith('data:image/gif;base64,')&&r.qr.length<image.length));
  const journal=()=>event.rows.Journal.filter(row=>row[1]==='Player selected payment receiver');
  const reservation=event.staff('ledger_',[]).attempts[student.hold.id];
  assert.deepEqual(Array.from(reservation.offeredReceivers,r=>r.id),[first.id,second.id]);
  assert.throws(()=>clubApi.submit(student,clubApi.submission(student)),/Choose your payment receiver/);
  const ack=select(first.id,0);
  assert.equal(ack.receiverChoiceVersion,1);assert.ok(JSON.stringify(ack).length<512);
  assert.equal(select(first.id,0).receiverChoiceVersion,1);
  const stale=select(second.id,0);assert.equal(stale.conflict,true);assert.equal(stale.receiver.id,first.id);
  assert.equal(journal().length,1);assert.equal(select(second.id,1).receiverChoiceVersion,2);
  assert.equal(student.status().chosenReceiverId,second.id);assert.equal(journal().length,2);
  assert.equal(event.post({action:'playerStatus',args:['',ticket]}).ok,false);
  const other=clubApi.student('223456789','second@example.test');
  assert.throws(()=>clubApi.publicRpc('playerSelectReceiver',other.token,ticket,first.id,'2'),/unavailable for your account/);
  assert.ok(!JSON.stringify(clubApi.publicRpc('publicInfo')).includes('samplebank'));
  clubApi.rpc('adminSaveReceiver',clubApi.admin,{...first,active:false});
  assert.equal(select(first.id,2).unavailable,true);assert.deepEqual(Array.from(student.status().checkoutReceivers,r=>r.id),[second.id]);
  event.advance(student.hold.paymentsCloseAt-event.now()+1);
  const expired=student.status();assert.equal(expired.checkoutEnded,true);assert.equal(expired.checkoutReceivers.length,0);
  assert.equal(expired.paymentQr,'');assert.throws(()=>select(second.id,2),/closed/);
});
test('a genuine credit can precede the radio choice when its QR was displayed with the quote',()=>{
  const event=createEvent(),f=club(event);
  f.makeReceiver();const second=f.makeReceiver('second@samplebank','Second receiver'),p=f.student();
  event.advance(3*60000);
  p.hold=f.publicRpc('playerSelectReceiver',p.token,p.hold.ticket,second.id);
  const proof=f.submission(p,{},image,receiptText(utr,'149.00',second.upi));
  f.submit(p,proof);
  const result=f.statement(second,[credit(utr,'149',second.upi)]);
  assert.equal(result.matches[0].reason,'');assert.equal(f.apply(result).authorized,1);
});
test('older receiver records regenerate a compact code from the verified private original',()=>{
  const f=start(),st=f.event.staff('ledger_',[]),original=st.receivers[f.receiver.id];
  const legacy={...original};delete legacy.qrPayload;
  // Store a fresh copy of this fixture image to exercise an uncached, older revision.
  const file=f.event.staff('privateBlob_',[Array.from(jpegQr()),'image/jpeg','event-payment-qr-'+ 'f'.repeat(32)+'.jpg']);
  legacy.qrFile=file.getId();
  assert.equal(f.event.staff('checkoutQr_',[legacy]),f.p.hold.checkoutReceivers[0].qr);
  assert.throws(()=>f.event.staff('checkoutQr_',[{...legacy,upi:'different@samplebank'}]),/different UPI/);
});
test('a later submission uses the transfer-time price and a conflicting bank timestamp blocks the discount',()=>{
  for(const [clock,paid,bankClock,eligible] of [
    ['18:59','149','18:59',true],['19:00','199','19:00',true],
    ['19:00','149','19:00',false],['18:59','149','19:00',false],['18:59','149','',false]
  ]){
    const event=createEvent();event.at('2026-11-27T17:00:00+05:30');
    const f=club(event),receiver=f.makeReceiver(),p=f.student();
    event.at('2026-11-27T21:00:00+05:30');
    assert.equal(p.status().fee,199);assert.equal(p.status().ticket,p.hold.ticket);
    const date='2026-11-27',raw=receiptText(utr,paid).replace('23 Nov 2026 3:00 PM',date+' '+clock);
    const proof=f.submission(p,{amount:paid,time:date+'T'+clock},image,raw);f.submit(p,proof);
    const plan=f.statement(receiver,[credit(utr,paid).replace(day,date+' '+bankClock)]);
    assert.equal(f.apply(plan).authorized,eligible?1:0);
    if(!eligible)assert.match(plan.matches[0].reason,/fee/);
  }
});
test('old and new details edits are owner-bound, versioned and preserve proof, payment and admission',()=>{
  const {p,receiver,event,...f}=start(),other=f.student('223456789','second@example.test');
  const edit=(details,revision,token=p.token)=>f.publicRpc('playerSaveDetails',token,p.hold.ticket,JSON.stringify({...details,revision}));
  const original=p.hold.details,changed={...original,fullName:'Updated Student',batch:'2025-27',contact:'9876543210'};
  assert.throws(()=>edit({...changed,batch:''},1),/batch/);
  assert.throws(()=>edit({...changed,pgpId:other.hold.beneficiary},1),/verified/);
  assert.throws(()=>edit({...changed,pgpId:other.hold.beneficiary},1,other.token),/your account/);
  const first=edit(changed,1);assert.equal(first.detailsRevision,2);
  assert.equal(edit(changed,1).detailsRevision,2);
  assert.equal(edit(original,1).detailsConflict,true);assert.equal(p.status().details.fullName,changed.fullName);
  f.submit(p,f.submission(p));const pending=p.status();
  const old=event.staff('ledger_',[]).attempts[p.hold.id];
  event.rows.Journal.push([event.now(),'Previous release','Fixture',JSON.stringify({attempts:[{...old,details:{...changed,batch:''},detailsRevision:0}]})]);
  const missing=f.statement(receiver);assert.match(missing.matches[0].reason,/batch/);
  const saved=edit(changed,0);assert.equal(saved.paymentStatus,'PENDING');assert.equal(saved.proofVersion,pending.proofVersion);
  const exact=f.statement(receiver);assert.equal(f.apply(exact).authorized,1);
  assert.throws(()=>edit({...changed,contact:''},1),/phone/);
  const ticket=p.status(),after=edit({...changed,contact:'9876501288'},1);
  assert.equal(after.entryCode,ticket.entryCode);assert.equal(after.paymentStatus,'AUTHORIZED');
  const scan=f.rpc('gateAction',f.admin,'admit',ticket.entryCode,randomUUID());
  assert.equal(scan.player,changed.fullName);
  const checked=edit({...changed,fullName:'Corrected Name'},2);
  assert.equal(checked.seat,scan.seat);assert.equal(checked.checkedInAt,scan.checkedInAt);assert.equal(checked.entryCode,'');
});
test('a saved checkout with no batch reopens on its original receipt after selecting a batch',()=>{
  const f=start(),{p,event}=f,st=event.staff('ledger_',[]),old=st.attempts[p.hold.id];
  event.rows.Journal.push([event.now(),'Previous release','Fixture',JSON.stringify({attempts:[{...old,details:{...old.details,batch:''},detailsRevision:0,expires:event.now()+60000}]})]);
  event.advance(90*60000);const missing=p.status();assert.equal(missing.ticket,p.hold.ticket);assert.equal(missing.checkoutReceivers.length,0);
  assert.throws(()=>f.submit(p,f.submission(p)),/batch/);
  const saved=f.publicRpc('playerSaveDetails',p.token,p.hold.ticket,JSON.stringify({...old.details,batch:'2025-27',revision:0}));
  assert.equal(saved.id,old.id);assert.equal(saved.chosenReceiverId,old.receiver.id);assert.ok(saved.paymentQr);
  assert.equal(Object.keys(event.staff('ledger_',[]).attempts).length,1);
});
test('payment screenshot accepts exactly 10 MB and rejects larger or unsupported uploads',()=>{
  const event=createEvent(),bytes=Buffer.alloc(10*1024*1024);bytes.set([137,80,78,71,13,10,26,10]);
  const prefix='data:image/png;base64,';
  assert.equal(event.staff('proofImageBytes_',[prefix+bytes.toString('base64')]).bytes.length,bytes.length);
  assert.throws(()=>event.staff('proofImageBytes_',[prefix+Buffer.concat([bytes,Buffer.alloc(1)]).toString('base64')]),/10 MB/);
  assert.throws(()=>event.staff('proofImageBytes_',['data:text/plain;base64,QUJD']),/screenshot/);
});

test('legacy receipts require a phone for new submissions and honor proof already accepted for review',()=>{
  const f=start(),{p,event,receiver}=f,s=f.submission(p);
  const oldDetails=()=>{
    const existing=event.staff('ledger_',[]).attempts[p.hold.id];
    event.rows.Journal.push([event.now(),'Earlier release','Fixture',JSON.stringify({attempts:[{...existing,details:{...existing.details,contact:''}}]})]);
  };
  oldDetails();
  assert.equal(p.status().checkoutReceivers.length,0);
  assert.throws(()=>f.publicRpc('playerSelectReceiver',p.token,p.hold.ticket,receiver.id),/phone number/);
  assert.throws(()=>f.submit(p,s),/phone number/);
  f.publicRpc('playerSaveDetails',p.token,p.hold.ticket,JSON.stringify({...p.hold.details,revision:p.status().detailsRevision}));
  f.submit(p,s);oldDetails();
  assert.equal(p.status().proofVersion,1);
  assert.equal(f.apply(f.statement(receiver)).authorized,1);
  const ticket=p.status();assert.equal(ticket.ticket,p.hold.ticket);
  assert.equal(f.rpc('gateAction',f.admin,'admit',ticket.entryCode,randomUUID()).status,'admitted');
  assert.ok(p.status().seat);
});

test('receiver QR configuration and cached revisions require an open amount and a blank note',()=>{
  const f=start(),{event,receiver}=f,original=event.staff('ledger_',[]).receivers[receiver.id];
  for(const [parameter,error] of [['tn=Registration',/blank payment note/],['TN=Booking%20note',/blank payment note/],['am=149',/no preset amount/],['mam=1',/no preset amount/]]){
    const bad=testUpi+'&'+parameter,qr='data:image/jpeg;base64,'+jpegQr(bad).toString('base64');
    assert.throws(()=>f.rpc('adminSaveReceiver',f.admin,{...receiver,qr}),error);
    const file='old-'+parameter;
    event.cache.set('upi-qr:'+event.staff('hash_',[file+':'+testUpi]),'cached-before-update');
    assert.throws(()=>event.staff('checkoutQr_',[{...original,qrFile:file,qrPayload:'upi://pay?pa='+bad}]),error);
  }
  const bankQr='upi://pay?pa='+testUpi+'&pn=Club%20Receiver&cu=INR&tn=&mc=1234&sign=example';
  assert.equal(event.staff('validatePaymentQr_',[bankQr,testUpi]),bankQr);
});

test('screenshot-only proof is owner-bound, idempotent and matches either displayed receiver without choosing one',()=>{
  const event=createEvent(),f=club(event);
  f.makeReceiver();const receiver=f.makeReceiver('second@samplebank','Second'),p=f.student(),other=f.student('223456789','second@example.test');
  const submit=(data,version,token=p.token)=>f.publicRpc('playerSubmitScreenshot',token,p.hold.ticket,data,version);
  assert.equal(p.hold.chosenReceiverId,'');
  assert.throws(()=>submit(image,'0',other.token),/your account/);
  assert.throws(()=>submit('','0'),/screenshot/);
  assert.throws(()=>submit(image,'1'),/another window/);
  event.ocr(receiptText(utr,'149.00',receiver.upi));
  const saved=submit(image,'0'),replay=submit(image,'0');
  assert.equal(replay.proofVersion,1);assert.equal(saved.claim.source,'screenshot');
  assert.equal(saved.claim.paidReceiver.id,receiver.id);assert.equal(saved.claim.beneficiary,p.hold.beneficiary);
  assert.equal(saved.claim.fairPlay,undefined);assert.equal(saved.claim.payer,undefined);
  assert.equal(saved.entryCode,'');assert.equal(saved.needsConfirmation,false);
  assert.throws(()=>submit('data:image/jpeg;base64,'+jpegQr('x@samplebank').toString('base64'),'0'),/another window/);
  assert.equal(event.rows.Journal.filter(r=>r[1]==='Proof submitted').length,1);
  assert.equal(f.apply(f.statement(receiver,[credit(utr,'149',receiver.upi)])).authorized,1);
  assert.ok(p.status().entryCode);
  assert.equal(submit(image,'0').entryCode,p.status().entryCode);
});

test('unreadable proof stays pending, including on a legacy hold with no receiver, and the desk can match an applied credit',()=>{
  const event=createEvent(),f=club(event);
  event.rows.Settings[1][1]=testUpi;event.rows.Settings[2][1]='Legacy Club';event.rows.Settings[5][1]='yes';
  const p=f.student(),receiver=f.makeReceiver();assert.equal(p.hold.receiver,null);
  event.ocr(null);
  const saved=f.publicRpc('playerSubmitScreenshot',p.token,p.hold.ticket,image,'0');
  assert.equal(saved.status,'REVIEW');assert.equal(saved.claim.utr,'');assert.equal(saved.claim.paidReceiver,null);assert.equal(saved.issue,'');
  assert.equal(f.rpc('adminNeedsReview',f.admin).payments[0].id,p.hold.id);
  const plan=f.statement(receiver);assert.equal(f.apply(plan).authorized,0);
  const detail=f.rpc('adminPaymentDetail',f.admin,p.hold.id,utr);
  assert.equal(detail.rows.length,1);assert.equal(detail.rows[0].utr,utr);
  const approve=()=>f.rpc('adminReviewPayment',f.admin,p.hold.id,'approve',detail.rows[0].key,'Matched screenshot and original bank credit.',1);
  approve();approve();assert.ok(p.status().entryCode);
  assert.equal(event.rows.Journal.filter(r=>r[1]==='Payment manually authorized').length,1);
});

test('a screenshot alone cannot authorize failed, duplicate or underpaid transfers',()=>{
  const f=start(),{p,event}=f,receiver=f.receiver,other=f.student('223456789','second@example.test');
  event.ocr(receiptText()+'\nPayment failed');
  const submit=student=>f.publicRpc('playerSubmitScreenshot',student.token,student.hold.ticket,image,'0');
  submit(p);
  const first=f.statement(receiver);assert.match(first.matches[0].reason,/unsuccessful/);assert.equal(f.apply(first).authorized,0);
  submit(other);
  const duplicate=f.statement(receiver);assert.match(duplicate.matches[0].reason,/Multiple registrations/);
  const row=f.rpc('adminPaymentDetail',f.admin,p.hold.id,utr).rows[0];
  assert.throws(()=>f.rpc('adminReviewPayment',f.admin,p.hold.id,'approve',row.key,'Checked original credit.',1),/Multiple registrations/);
  assert.equal(p.status().entryCode,'');assert.equal(other.status().entryCode,'');
  const g=start();g.event.ocr(null);g.publicRpc('playerSubmitScreenshot',g.p.token,g.p.hold.ticket,image,'0');
  g.apply(g.statement(g.receiver,[credit(utr,'100')]));
  const short=g.rpc('adminPaymentDetail',g.admin,g.p.hold.id,utr).rows[0];
  assert.throws(()=>g.rpc('adminReviewPayment',g.admin,g.p.hold.id,'approve',short.key,'Checked original credit.',1),/fee/);
});

test('statement time resolves an unreadable screenshot across the Early Bird boundary',()=>{
  const event=createEvent();event.at('2026-11-27T18:50:00+05:30');
  const f=club(event),receiver=f.makeReceiver(),p=f.student();event.advance(20*60000);event.ocr(null);
  assert.equal(f.publicRpc('playerSubmitScreenshot',p.token,p.hold.ticket,image,'0').fee,199);
  const raw='Date,Time,UTR,Credit,Debit,Receiver UPI,Description\r\n2026-11-27,18:59,'+utr+',149,,'+testUpi+',UPI credit';
  const plan=f.importFile(receiver.id,'bank.csv',raw);assert.equal(f.apply(plan).authorized,0);
  const detail=f.rpc('adminPaymentDetail',f.admin,p.hold.id,utr);
  f.rpc('adminReviewPayment',f.admin,p.hold.id,'approve',detail.rows[0].key,'Verified original credit before the cutoff.',1);
  assert.equal(p.status().fee,149);assert.ok(p.status().entryCode);
});

test('the desk can reconcile a previously uploaded legacy screenshot without asking for a new one',()=>{
  const event=createEvent(),f=club(event);
  event.rows.Settings[1][1]=testUpi;event.rows.Settings[2][1]='Legacy Club';event.rows.Settings[5][1]='yes';
  const p=f.student();f.publicRpc('playerUpload',p.token,p.hold.ticket,'',image);
  const receiver=f.makeReceiver();f.apply(f.statement(receiver));
  const detail=f.rpc('adminPaymentDetail',f.admin,p.hold.id,utr);assert.equal(detail.version,0);
  f.rpc('adminReviewPayment',f.admin,p.hold.id,'approve',detail.rows[0].key,'Verified the original legacy receipt and bank credit.',detail.version);
  assert.ok(p.status().entryCode);
});

test('only a desk decision can resolve a screenshot reader assigning the wrong receiving account',()=>{
  const event=createEvent(),f=club(event),actual=f.makeReceiver(),misread=f.makeReceiver('other@samplebank','Other'),p=f.student();
  event.ocr(receiptText(utr,'149',misread.upi));f.publicRpc('playerSubmitScreenshot',p.token,p.hold.ticket,image,'0');
  assert.equal(f.apply(f.statement(actual)).authorized,0);
  const detail=f.rpc('adminPaymentDetail',f.admin,p.hold.id,utr);assert.match(detail.reason,/different|differs/);
  f.rpc('adminReviewPayment',f.admin,p.hold.id,'approve',detail.rows[0].key,'Verified original account and incoming UTR.',detail.version);
  assert.ok(p.status().entryCode);
});
