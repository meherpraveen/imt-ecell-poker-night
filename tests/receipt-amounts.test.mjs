import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createEvent} from './e2e/event-runtime.mjs';
import {club,image,utr,receiptText} from './payment-fixtures.mjs';

// Synthetic layouts; original student screenshots and OCR stay outside the repo.
const phonePe=amount=>['Transaction Successful','Paid to','SAMPLE RECEIVER',amount,'******1234@yapl',
  'PhonePe Transaction ID','T0123456789012345678901','Debited from','XX1234','UTR: '+utr,amount,
  'Send Again','Enjoy seamless and safer, payments up to ₹10,000.'].join('\n');

test('receipt layouts recover a lost glyph without assuming the entry price',()=>{
  const event=createEvent(),read=text=>event.staff('readPaymentText_',[text]).amount;
  for(const value of ['10','99','113','149','199','149.50']){
    const expected=Number(value).toFixed(2);
    for(const layout of [
      phonePe(value),
      'You Paid\n'+value+'\nto SAMPLE RECEIVER\nReceived By\nclub@samplebank',
      'To SAMPLE RECEIVER\n'+value+'\nPay again\nCompleted',
      '*'+value+'\nPaid to\nSAMPLE RECEIVER',
      'Amount\n'+value,
      'Paytm\nUPI ID: ******1234@samplebank\n'+value+'\n:\n25 Nov, 1:34 AM • Ref. No: '+utr,
      'super.money\n'+value+'\nSAMPLE RECEIVER\nNovember 25, 2026 at 1:33 AM • Ref ID: '+utr+'\nCashback earned ₹0.03'
    ])assert.equal(read(layout),expected,layout);
  }
  for(const text of ['149\nRupees One Hundred Forty Nine\nOnly','149\nRupees One Hundred Forty Nine Only',
    '₹१४९','INR 149.00','Rs.149','₹\n149','149/-\nOne Hundred Forty Nine Rupees'])assert.equal(read(text),'149.00',text);
  for(const [text,expected] of [['₹1,000','1000.00'],['INR 1,49,000.50','149000.50'],['₹0.50','0.50'],['₹1','1.00']])assert.equal(read(text),expected);
});

test('ambiguous, unrelated and malformed numbers cannot supply partial amounts',()=>{
  const event=createEvent(),read=text=>event.staff('readPaymentText_',[text]).amount;
  for(const text of ['7\nPaid to\nExample\n7','Wallet closing balance\n₹408','Service charge ₹10',
    'Available balance\n149','Order ID: 149','Account Number: 149','149\nPaid Successfully',
    '10\nOne Hundred Forty Nine Rupees','149\nRupees One Hundred Fifty',
    phonePe('149').replace('XX1234','XX1234\n₹199'),phonePe('149').replaceAll('\n149','\n7')])assert.equal(read(text),'',text);
  // Exercise the old regex's backtracking across separators and decimal tails.
  for(const value of ['10','149','199','408','10,000']){
    for(const suffix of ['.','.001',',','abc',':35','%',' 00'])assert.equal(read('₹'+value+suffix),'','₹'+value+suffix);
    for(const label of ['Rewards earned','Cashback','Closing balance','Offer up to','Processing fee','Discount'])
      assert.equal(read(label+' ₹'+value),'',label+' '+value);
  }
  assert.equal(read('Paid ₹149\nCashback ₹10\nClosing Balance ₹408'),'149.00');
});

function submitted(options={}){
  const event=createEvent(options),api=club(event);api.makeReceiver();const p=api.student();
  event.ocr(receiptText(utr,'10'));
  api.publicRpc('playerSubmitScreenshot',p.token,p.hold.ticket,image,'0');
  return {...api,event,p,id:p.hold.id,read:()=>event.staff('ledger_',[]).attempts[p.hold.id]};
}

test('reread corrects a complete automatic amount, preserves the original and is idempotent',()=>{
  for(const oldAmount of ['10.00','408.00']){
    const f=submitted(),st=f.event.staff('ledger_',[]),before=f.read();
    f.event.staff('commit_',[st,'Synthetic old extraction','test',{attempts:[{...before,ocr:{...before.ocr,amount:oldAmount},claim:{...before.claim,amount:Number(oldAmount)*100}}]}]);
    const original=f.read(),mailBefore=f.event.mail.length;
    f.event.ocr(phonePe('149'));
    assert.equal(f.rpc('adminReadScreenshotReference',f.admin,f.id,1).updated,true);
    const saved=f.read();
    assert.equal(saved.ocr.amount,'149.00');assert.equal(saved.claim.amount,14900);assert.equal(saved.proofVersion,2);
    for(const key of ['file','digest','status','paymentStatus','fee','submitted','receiver','details','linkedRow'])
      assert.deepEqual(saved[key],original[key],key);
    assert.equal(f.p.status().entryCode,'');assert.equal(f.event.mail.length,mailBefore);
    const journalLength=f.event.rows.Journal.length;
    assert.equal(f.rpc('adminReadScreenshotReference',f.admin,f.id,2).updated,false);
    assert.equal(f.event.rows.Journal.length,journalLength);assert.equal(f.read().proofVersion,2);
  }
});

test('ambiguous rereading clears an automatic amount and never grants entry',()=>{
  const f=submitted();f.event.ocr('₹149\nAmount paid ₹199\nRef No: '+utr);
  assert.equal(f.rpc('adminReadScreenshotReference',f.admin,f.id,1).updated,true);
  assert.equal(f.read().ocr.amount,'');assert.equal(f.read().claim.amount,null);
  assert.equal(f.read().claim.utr,utr);assert.equal(f.read().status,'REVIEW');assert.equal(f.p.status().entryCode,'');
});

test('rereading preserves payer amounts, explicit corrections and owner-transcribed amounts',()=>{
  const event=createEvent(),fields=event.staff('readPaymentText_',[phonePe('149')]);
  for(const edits of [{claim:{amount:1000}}, {claim:{source:'screenshot',amount:11300}},
    {claim:{source:'screenshot',amount:1000},proofImportKey:'owner-verified'}]){
    const a={id:'synthetic',status:'REVIEW',proofVersion:3,ocr:{amount:'10.00'},...edits};
    const saved=event.staff('rereadScreenshotFields_',[a,fields]);
    assert.equal(saved.ocr.amount,'149.00');assert.equal(saved.claim.amount,edits.claim.amount);assert.equal(saved.status,'REVIEW');
    assert.equal(a.ocr.amount,'10.00'); // Pure calculation: no in-place mutation.
  }
});

test('rereading rejects concurrent changes and OCR failures without changing saved evidence',()=>{
  let f,armed=false;
  f=submitted({onFileRead(){
    if(!armed)return;armed=false;
    const st=f.event.staff('ledger_',[]),a=st.attempts[f.id];
    f.event.staff('commit_',[st,'Synthetic concurrent update','test',{attempts:[{...a,proofVersion:2}]}]);
  }});
  const original=f.read();f.event.ocr(phonePe('149'));armed=true;
  assert.throws(()=>f.rpc('adminReadScreenshotReference',f.admin,f.id,1),/changed/);
  assert.equal(f.read().ocr.amount,original.ocr.amount);assert.equal(f.read().proofVersion,2);
  const count=f.event.rows.Journal.length;f.event.ocr(null);
  assert.throws(()=>f.rpc('adminReadScreenshotReference',f.admin,f.id,2),/could not be read/);
  assert.equal(f.event.rows.Journal.length,count);assert.equal(f.read().claim.amount,1000);
  f.rpc('adminReviewPayment',f.admin,f.id,'reject','','Synthetic wrong receipt',2);
  assert.equal(f.rpc('adminPaymentDetail',f.admin,f.id,'').canReadReference,false);
  assert.throws(()=>f.rpc('adminReadScreenshotReference',f.admin,f.id,2),/changed/);
});

test('new screenshot reads bypass stale cached amounts and reuse new results',()=>{
  const f=submitted(),digest=f.event.staff('proofDigest_',[Array.from(Buffer.from(image.split(',')[1],'base64'))]);
  f.event.cache.set('ocr:'+f.id+':'+digest,JSON.stringify({amount:'10.00'}));
  f.event.ocr(phonePe('149'));
  const read=()=>f.publicRpc('playerReadProof',f.p.token,f.p.hold.ticket,image);
  assert.equal(read().amount,'149.00');f.event.ocr(null);assert.equal(read().amount,'149.00');
});
