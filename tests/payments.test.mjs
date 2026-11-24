import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createEvent} from './e2e/event-runtime.mjs';
import {club,credit,csvHeader,day,image,jpegQr,paidAt,receiptText,testUpi,utr} from './payment-fixtures.mjs';

function start(){
  const event=createEvent(),api=club(event),receiver=api.makeReceiver(),p=api.student();
  return {...api,event,receiver,p};
}
test('managed checkout pins the server quote and receiver, validates QR and preserves old account revisions',()=>{
  const f=start(),{rpc,admin,p,receiver,event}=f;
  assert.equal(p.hold.fee,149);assert.equal(p.hold.paymentStatus,'PENDING');assert.equal(p.hold.receiver.id,receiver.id);
  assert.ok(p.hold.paymentQr.startsWith('data:image/jpeg'));assert.equal(p.hold.entryCode,'');
  const change={...receiver,upi:'new@samplebank',active:true};
  assert.throws(()=>rpc('adminSaveReceiver',admin,{...change,qr:image}),/different UPI/);
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
test('failed OCR, tampered OCR, a different payee, or an expired quote always require review',()=>{
  for(const kind of ['unavailable','tampered','payee','late']){
    const f=start();
    if(kind==='late')f.event.advance(16*60*1000);
    const raw=kind==='unavailable'?null:receiptText(utr,'149.00',kind==='payee'?'different@samplebank':testUpi);
    const s=f.submission(f.p,{},image,raw);
    if(kind==='tampered')s.values.ocr={...s.values.ocr,seal:'invalid'};
    f.submit(f.p,s);const plan=f.statement(f.receiver);
    assert.match(plan.matches[0].reason,/read|different receiving|expired/i,kind);assert.equal(f.apply(plan).authorized,0);
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
  f.makeReceiver();assert.equal(p.status().canCheckout,true);
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
