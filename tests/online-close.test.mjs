import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createEvent} from './e2e/event-runtime.mjs';
import {club,credit,image,receiptText} from './payment-fixtures.mjs';

const close='2026-11-27T16:00:00+05:30',desk='2026-11-27T19:00:00+05:30';
function setup(options={}){
  const event=createEvent(options);event.at('2026-11-27T15:59:59.999+05:30');
  const api=club(event),receiver=api.makeReceiver(),p=api.student();
  return {...api,event,receiver,p};
}

test('the exact 4 PM boundary closes new and existing public checkouts without rewriting their records',()=>{
  const f=setup(),{event,p}=f,before=JSON.stringify(event.rows.Journal);
  assert.equal(f.publicRpc('publicInfo').open,true);assert.ok(p.status().checkoutReceivers.length);
  event.at(close);
  const info=f.publicRpc('publicInfo');assert.equal(info.open,false);assert.match(info.message,/Amphitheater from 7 PM IST/);
  const closed=p.status();assert.equal(closed.id,p.hold.id);assert.equal(closed.checkoutEnded,true);assert.equal(closed.onlineClosed,true);
  assert.equal(closed.upi,'');assert.equal(closed.paymentQr,'');assert.equal(closed.checkoutReceivers.length,0);
  assert.equal(f.publicRpc('playerCheckout',p.token,p.hold.ticket).checkoutEnded,true);
  assert.equal(f.publicRpc('playerStart',p.token,'',randomUUID(),JSON.stringify(p.hold.details)).id,p.hold.id);
  assert.throws(()=>f.student('223456789','second@example.test'),/4 PM/);
  assert.throws(()=>f.publicRpc('playerSelectReceiver',p.token,p.hold.ticket,f.receiver.id),/4 PM/);
  assert.equal(JSON.stringify(event.rows.Journal),before);
  event.at(desk);assert.throws(()=>f.student('223456789','second@example.test'),/4 PM/);
});

test('all screenshot submission paths reject fresh evidence after 4 PM without storing a file',()=>{
  const f=setup(),{event,p}=f,proof=f.submission(p),rows=event.rows.Journal.length,files=event.files.size;
  event.at(close);
  for(const run of [
    ()=>f.publicRpc('playerReadProof',p.token,p.hold.ticket,image),
    ()=>f.submit(p,proof),
    ()=>f.publicRpc('playerSubmitScreenshot',p.token,p.hold.ticket,image,'0')
  ])assert.throws(run,/4 PM/);
  assert.throws(()=>f.publicRpc('playerUpload',p.token,p.hold.ticket,'8901',image),/Refresh|4 PM/);
  assert.equal(event.rows.Journal.length,rows);assert.equal(event.files.size,files);
  assert.equal(p.status().status,'HOLD');
});

test('an upload that crosses 4 PM discards its staged file and leaves the journal unchanged',()=>{
  let event,armed=false,staged=0;
  const f=setup({onFileCreate({name,locked}){if(armed&&name.includes('-proof-')){assert.equal(locked,false);staged++;event.at(close)}}});
  event=f.event;const proof=f.submission(f.p),rows=event.rows.Journal.length,files=event.files.size;armed=true;
  assert.throws(()=>f.submit(f.p,proof),/4 PM/);
  assert.equal(staged,1);assert.equal(event.files.size,files);assert.equal(event.rows.Journal.length,rows);
});

test('the legacy screenshot endpoint also enforces the cutoff when legacy payments are configured',()=>{
  const event=createEvent();event.at('2026-11-27T15:59:59+05:30');const f=club(event);
  event.rows.Settings[1][1]='club@example';event.rows.Settings[2][1]='Club';event.rows.Settings[5][1]='yes';
  const p=f.student(),before=JSON.stringify(event.rows.Journal),files=event.files.size;event.at(close);
  assert.throws(()=>f.publicRpc('playerUpload',p.token,p.hold.ticket,'8901',image),/4 PM/);
  assert.equal(JSON.stringify(event.rows.Journal),before);assert.equal(event.files.size,files);
});

test('a screenshot read crossing 4 PM cannot produce a submission token or retain its temporary file',()=>{
  let event,armed=false;
  const f=setup({onFileCreate(){if(armed)event.at(close)}});event=f.event;
  const rows=event.rows.Journal.length,files=event.files.size;armed=true;event.ocr(receiptText());
  assert.throws(()=>f.publicRpc('playerReadProof',f.p.token,f.p.hold.ticket,image),/4 PM/);
  assert.equal(event.files.size,files);assert.equal(event.rows.Journal.length,rows);
});

test('submitted evidence stays readable and a lost acknowledgement is idempotent after closing',()=>{
  const f=setup(),proof=f.submission(f.p);f.submit(f.p,proof);
  const before=JSON.stringify(f.event.rows.Journal),files=f.event.files.size;
  f.event.at(close);
  assert.equal(f.p.status().status,'REVIEW');assert.equal(f.p.status().onlineClosed,true);
  assert.equal(f.submit(f.p,proof).status,'REVIEW');
  assert.equal(JSON.stringify(f.event.rows.Journal),before);assert.equal(f.event.files.size,files);
});

test('only staff can reopen an old checkout at the 7 PM desk and it retains its private receipt and original quote time',()=>{
  const f=setup(),{event,p}=f,old=event.staff('ledger_',[]).attempts[p.hold.id],quote=old.quotedAt;
  event.at('2026-11-27T18:59:59.999+05:30');
  assert.throws(()=>f.rpc('adminOpenDeskPayment',f.admin,p.hold.beneficiary,'walk'),/7 PM/);
  event.at(desk);
  assert.throws(()=>f.rpc('adminOpenDeskPayment',p.token,p.hold.beneficiary,'walk'));
  const rows=event.rows.Journal.length;
  assert.equal(f.rpc('adminOpenDeskPayment',f.admin,p.hold.beneficiary,'walk').id,p.hold.id);
  const a=event.staff('ledger_',[]).attempts[p.hold.id];assert.equal(a.quotedAt,quote);assert.equal(a.deskOpenedAt,event.now());assert.equal(a.wave,-1);
  assert.equal(p.status().checkoutEnded,false);assert.equal(p.status().ticket,p.hold.ticket);assert.equal(p.status().fee,199);
  f.rpc('adminOpenDeskPayment',f.admin,p.hold.beneficiary,'walk');assert.equal(event.rows.Journal.length,rows+1);
  event.ocr(receiptText());assert.equal(f.publicRpc('playerSubmitScreenshot',p.token,p.hold.ticket,image,'0').status,'REVIEW');
});

test('staff can open a new walk-in after 7 PM, but new desk registrations stop at 11 PM',()=>{
  const event=createEvent();event.at(desk);const f=club(event);f.makeReceiver();
  const opened=f.rpc('adminOpenDeskPayment',f.admin,'123456789','walk'),p=f.student();
  assert.equal(p.hold.id,opened.id);assert.equal(p.hold.fee,199);assert.equal(p.hold.checkoutEnded,false);
  event.at('2026-11-27T23:00:00+05:30');
  assert.throws(()=>f.rpc('adminOpenDeskPayment',f.admin,'223456789','walk'),/11 PM/);
  assert.equal(p.status().checkoutEnded,false);
  event.at('2026-11-28T04:00:00+05:30');assert.equal(p.status().checkoutEnded,true);
});

test('issued tickets and payments awaiting bank verification survive the online cutoff without advance seating',()=>{
  const event=createEvent(),f=club(event),receiver=f.makeReceiver(),p=f.student();
  f.submit(p,f.submission(p));event.at(close);
  const current=club(event);assert.equal(current.apply(current.statement(receiver,[credit()])).authorized,1);
  const ticket=p.status();assert.ok(ticket.entryCode);assert.equal(ticket.fee,149);assert.equal(ticket.wave,0);
  const pass=f.publicRpc('passInfo',ticket.entryCode);assert.equal(pass.active,true);
  const a=event.staff('ledger_',[]).attempts[p.hold.id];assert.equal(a.wave,-1);assert.ok(!a.seat);assert.equal(a.used,false);
  assert.equal(f.publicRpc('playerHome',p.token,'').receipt.entryCode,ticket.entryCode);
});
