import assert from 'node:assert/strict';
import {randomUUID,randomBytes} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import vm from 'node:vm';
import {setTimeout as pause} from 'node:timers/promises';
import {createEvent} from './e2e/event-runtime.mjs';
import {club,testUpi,receiptText,credit,paidAt,image} from './payment-fixtures.mjs';

const transport=new vm.Script(readFileSync(new URL('../web/transport.js',import.meta.url),'utf8'));
const endpoint='https://script.google.com/macros/s/capacity-fixture/exec';
function client(fetch){
  const net={textContent:''};
  const context=vm.createContext({window:{POKER_NIGHT_WEB_APP:endpoint},document:{getElementById:()=>net},fetch,AbortController,setTimeout,clearTimeout});
  transport.runInContext(context);return context.api;
}

test('50 simultaneous clients register, submit proof, reconcile and check in through a 30-execution limit',async t=>{
  const attendance=50,event=createEvent(),admin=club(event);
  const receivers=[admin.makeReceiver(testUpi,'First receiver'),admin.makeReceiver('second@samplebank','Second receiver')];
  let active=0,peak=0,limited=0,compactUploads=0;
  const users=Array.from({length:attendance},(_,i)=>{
    const roll=String(300000000+i),email=roll+'@example.test',name='Student '+i;
    event.rows.Students.push([roll,name,email,'']);
    const receiver=receivers[i%2],utr=String(800000000000+i);
    const proof='data:image/png;base64,'+Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),randomBytes(32768)]).toString('base64');
    const api=client(async(url,request)=>{
      assert.equal(url,endpoint);
      if(active===30){limited++;return new Response('Too many requests',{status:429})}
      active++;peak=Math.max(peak,active);
      try{
        await pause(8);
        const body=JSON.parse(request.body);
        if(body.action==='playerReadProof')event.ocr(receiptText(utr,'149.00',receiver.upi));
        if(body.action==='playerSubmitPayment'&&body.args[2].startsWith('proof:'))compactUploads++;
        return Response.json(event.post(body));
      }finally{active--}
    });
    return {api,roll,email,name,receiver,utr,proof};
  });
  async function burst(fn){return Promise.all(users.map(fn))}
  await burst(u=>u.api('requestEventCode',u.roll));
  await burst(async u=>{u.token=(await u.api('signInEvent',u.roll,event.code(u.email),'')).session.token});
  await burst(async u=>{
    const d={pgpId:u.roll,fullName:u.name,batch:'2026-28',contact:'9876501234'};
    u.registration=await u.api('playerStart',u.token,'',randomUUID(),JSON.stringify(d));
  });
  await burst(async u=>{u.ocr=await u.api('playerReadProof',u.token,u.registration.ticket,u.proof)});
  await burst(async u=>{
    const r=u.registration,form={utr:u.utr,amount:'149.00',time:paidAt,payer:u.name,beneficiary:u.roll,receiver:r.receiver.id,paidReceiver:u.receiver.id,
      receiverChoiceVersion:r.receiverChoiceVersion,agreementVersion:r.fairPlayVersion,fairPlay:true,revision:0,ocr:u.ocr};
    const saved=await u.api('playerSubmitPayment',u.token,r.ticket,u.ocr.uploadRef,JSON.stringify(form));assert.equal(saved.status,'REVIEW');
  });
  for(const r of receivers){
    const rows=users.filter(u=>u.receiver===r).map(u=>credit(u.utr,'149',r.upi));
    const plan=admin.statement(r,rows,'statement-'+r.id+'.csv');
    assert.equal(plan.matches.length,25);assert.equal(admin.apply(plan).authorized,25);
    assert.equal(admin.apply(plan).authorized,25);
  }
  const gate=event.staff('staffLogin',[event.team.gate,event.invite('gate')]);
  const link=new URL(event.staff('staffSnapshot',[gate.token]).scannerUrl);
  const access=new URLSearchParams(link.hash.slice(1)).get('access');
  await burst(async u=>{u.pass=(await u.api('playerStatus',u.token,u.registration.ticket)).entryCode;assert.ok(u.pass)});
  await burst(async u=>{u.scan=await u.api('scanEntryTicket',access,u.pass,randomUUID());assert.equal(u.scan.status,'admitted')});
  await burst(async u=>{
    const second=await u.api('scanEntryTicket',access,u.pass,randomUUID());assert.equal(second.status,'used');
    assert.equal(second.seat,u.scan.seat);assert.equal(second.checkedInAt,u.scan.checkedInAt);
    const pass=await u.api('passInfo',u.pass);assert.equal(pass.used,true);assert.equal(pass.seat,u.scan.seat);
  });
  const attempts=Object.values(event.staff('ledger_',[]).attempts);
  assert.equal(attempts.length,50);assert.equal(new Set(attempts.map(a=>a.utr)).size,50);
  assert.equal(new Set(attempts.map(a=>a.wave+'/'+a.seat)).size,50);assert.equal(attempts.filter(a=>a.wave===0).length,36);
  assert.equal(event.rows.Journal.filter(r=>r[1]==='Gate admit').length,50);
  assert.equal(peak,30);assert.ok(limited>=20);assert.equal(compactUploads,50);
  t.diagnostic('50 players, 50 authorizations, 50 distinct seats. All 50 repeated scans returned the original admission.');
});

test('an overlapping proof upload and gate scan during pass email preserve the evidence and admission',()=>{
  let onFile,onMail;
  const event=createEvent({onFileCreate:info=>onFile?.(info),onPassMail:info=>onMail?.(info)}),admin=club(event);
  const receiver=admin.makeReceiver(),p=admin.student(),submission=admin.submission(p);
  onFile=({locked})=>{onFile=null;assert.equal(locked,false);assert.equal(admin.submit(p,submission).status,'REVIEW')};
  assert.equal(admin.submit(p,submission).proofVersion,1);
  assert.equal([...event.files.values()].filter(f=>f.getName()?.includes('-proof-')).length,1);
  admin.apply(admin.statement(receiver));const pass=p.status().entryCode;let scanned;
  onMail=({locked})=>{
    onMail=null;assert.equal(locked,false);
    scanned=admin.rpc('gateAction',admin.admin,'admit',pass,randomUUID());
    assert.equal(admin.rpc('adminDispatchPasses',admin.admin).remaining,0);
  };
  assert.equal(admin.rpc('adminDispatchPasses',admin.admin).failed,0);
  assert.equal(scanned.status,'admitted');assert.equal(p.status().checkedInAt,scanned.checkedInAt);
  assert.equal(p.status().delivery,'Email sent');
  assert.equal(event.mail.filter(m=>m.subject.endsWith('entry pass')&&m.body.includes('#code='+pass)).length,1);
});

test('concurrent statement uploads share one original and a changed bank row invalidates an in-flight approval',()=>{
  let writeHook,readHook;
  const event=createEvent({onFileCreate:x=>writeHook?.(x),onFileRead:x=>readHook?.(x)}),admin=club(event);
  const receiver=admin.makeReceiver(),p=admin.student();admin.submit(p,admin.submission(p));
  writeHook=({name,locked})=>{
    if(name!=='statement.csv')return;writeHook=null;assert.equal(locked,false);admin.statement(receiver);
  };
  const plan=admin.statement(receiver);
  assert.equal([...event.files.values()].filter(f=>f.getName()==='statement.csv').length,1);
  assert.equal([...event.files.values()].filter(f=>f.getName()?.startsWith('bank-rows-')).length,1);
  assert.equal(event.rows.Journal.filter(r=>r[1]==='Statement uploaded for preview').length,1);
  readHook=({name,locked})=>{
    if(!name?.startsWith('bank-rows-'))return;readHook=null;assert.equal(locked,false);
    const correction={key:plan.matches[0].row,values:{issue:'Desk is checking the incoming amount'}};
    event.rows.Journal.push([event.now(),'Correction','Fixture',JSON.stringify({bankCorrection:correction})]);
  };
  assert.throws(()=>admin.apply(plan),/preview changed/);
  assert.equal(p.status().paymentStatus,'PENDING');
  assert.match(admin.rpc('adminStatementPreview',admin.admin,plan.statement.id).matches[0].reason,/checking the incoming amount/);
});

test('private cached proof is scoped to its registration and eviction falls back to original bytes',()=>{
  const event=createEvent(),admin=club(event);admin.makeReceiver();const p=admin.student(),other=admin.student('223456789','second@example.test');
  const s=admin.submission(p),ref=s.values.ocr.uploadRef;assert.match(ref,/^proof:/);
  const send=(player,data)=>admin.publicRpc('playerSubmitPayment',player.token,player.hold.ticket,data,JSON.stringify(s.values));
  assert.equal(send(other,ref).uploadRequired,true);
  for(const key of event.cache.keys())if(key.startsWith('proof-bytes:'))event.cache.delete(key);
  assert.equal(send(p,ref).uploadRequired,true);assert.equal(send(p,image).proofVersion,1);
  assert.equal(send(p,image).proofVersion,1);
});

test('warm journal reads use just the new rows and replay correctly after partial cache eviction',()=>{
  const reads=[],event=createEvent({onSheetRead:(name,row,height)=>{if(name==='Journal')reads.push({row,height})}});
  function append(i,note=''){
    event.rows.Journal.push([event.now(),'Fixture','Tester',JSON.stringify({attempts:[{id:'p'+i,note}],note:'row '+i})]);
  }
  for(let i=0;i<500;i++)append(i);
  assert.equal(event.staff('ledger_',[]).audit.at(-1).target,'row 499');
  assert.deepEqual(reads.splice(0),[{row:2,height:500}]);append(500);
  const current=event.staff('ledger_',[]);
  assert.deepEqual(reads.splice(0),[{row:502,height:1}]);assert.equal(current.audit.length,35);
  assert.equal(event.staff('ledger_',[]).audit.at(-1).target,'row 500');assert.equal(reads.length,0);
  for(let i=501;i<580;i++)append(i,randomBytes(1450).toString('hex'));
  const full=event.staff('ledger_',[]),chunk=[...event.cache.keys()].find(k=>k.startsWith('event-journal-prefix-v1:'));
  assert.ok(chunk);event.cache.delete(chunk);reads.length=0;
  assert.deepEqual(event.staff('ledger_',[]),full);assert.deepEqual(reads,[{row:2,height:580}]);
});

test('sessions revalidate a single directory row and follow a moved player without trusting a stale email',()=>{
  const reads=[],event=createEvent({onSheetRead:(name,row,height)=>{if(name==='Students')reads.push({row,height})}});
  const admin=club(event),p=admin.student();reads.length=0;
  assert.equal(p.status().id,p.hold.id);assert.deepEqual(reads,[{row:2,height:1}]);
  const data=event.rows.Students;[data[1],data[2]]=[data[2],data[1]];
  assert.equal(p.status().id,p.hold.id);
  data.push([p.hold.beneficiary,'Duplicate','another@example.test','']);assert.throws(()=>p.status(),/Sign in/);data.pop();
  data[2][2]='reassigned@example.test';
  assert.throws(()=>p.status(),/Sign in/);
});
