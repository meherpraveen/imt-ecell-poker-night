import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createEvent,player,owner} from './e2e/event-runtime.mjs';
import {club,image,receiptText} from './payment-fixtures.mjs';

const event=()=>createEvent({studentSignIn:'directory'});
const signIn=(e,roll=player.roll,email=player.email,id=randomUUID())=>e.post({action:'signInWithStudentDetails',args:[roll,email,'',id]});

test('temporary sign-in matches both directory identifiers with no mail or mail-quota dependency',()=>{
  const e=event();e.mailFailure(true);
  e.mail.push(...Array.from({length:100},()=>({subject:'Synthetic quota use'})));
  const id=randomUUID(),first=signIn(e,' '+player.roll+' ',' '+player.email.toUpperCase()+' ',id);
  assert.equal(first.ok,true);assert.equal(first.value.account.player.roll,player.roll);
  const again=signIn(e,player.roll,player.email,id);assert.equal(again.value.session.token,first.value.session.token);
  assert.equal(e.mail.length,100);assert.equal(e.rows.Journal.length,1);
  assert.equal(e.staff('playerRoll_',[first.value.session.token]),player.roll);
});

test('mismatched, blank, ambiguous and owner identities never get a student session',()=>{
  for(const change of ['wrong-email','wrong-roll','blank-email','duplicate-roll','duplicate-email','owner']){
    const e=event();let roll=player.roll,email=player.email;
    if(change==='wrong-email')email='second@example.test';
    if(change==='wrong-roll')roll='999999999';
    if(change==='blank-email')e.rows.Students[1][2]='';
    if(change==='duplicate-roll')e.rows.Students.push([...e.rows.Students[1]]);
    if(change==='duplicate-email')e.rows.Students[2][2]=player.email;
    if(change==='owner'){e.rows.Students[1][2]=owner;email=owner;}
    const result=signIn(e,roll,email);assert.equal(result.ok,false,change);assert.match(result.error,/match one student record/);
    assert.equal(e.mail.length,0);assert.equal(e.rows.Journal.length,1);
  }
  assert.equal(signIn(event(),player.roll,player.email,'bad-request').ok,false);
  assert.equal(signIn(createEvent()).ok,false); // Restoring email mode closes the temporary endpoint.
});

test('student code requests pause while owner verification remains available',()=>{
  const e=event(),api=club(e); // Owner still signs in with its actual code.
  for(const [action,args] of [['requestEventCode',[player.roll]],['requestPlayerCode',[player.email]],['requestMatchedPlayerCode',[player.roll,player.email]]]){
    const result=e.post({action,args});assert.equal(result.ok,false);assert.match(result.error,/Email codes are paused/);
  }
  const signed=signIn(e).value;assert.throws(()=>e.staff('staffSnapshot',[signed.session.token]),/Sign in|sign-in|role/i);
  assert.equal(e.mail.length,1);assert.equal(e.mail[0].to,owner);assert.ok(api.admin);
});

test('restoring email verification closes temporary sessions and preserves email-verified sessions',()=>{
  const e=createEvent(),api=club(e),verified=api.student();e.studentSignInMode('directory');
  const temporary=signIn(e).value;e.studentSignInMode('email');
  assert.throws(()=>e.staff('playerRoll_',[temporary.session.token]),/Sign in/);
  assert.equal(e.staff('playerRoll_',[verified.token]),player.roll);assert.equal(signIn(e).ok,false);
});

test('temporary login resumes one registration and retains screenshot evidence across logout and device changes',()=>{
  const e=event(),api=club(e);api.makeReceiver();
  const first=signIn(e).value,details=JSON.stringify({pgpId:player.roll,fullName:'Sample Student',contact:'9876501234',batch:'2026-28'});
  const started=e.post({action:'playerStart',args:[first.session.token,'',randomUUID(),details]});assert.equal(started.ok,true);
  const hold=started.value;e.ocr(receiptText());
  assert.equal(e.post({action:'playerSubmitScreenshot',args:[first.session.token,hold.ticket,image,'0']}).ok,true);
  const before=e.staff('ledger_',[]).attempts[hold.id];
  e.post({action:'playerLogout',args:[first.session.token]});assert.throws(()=>e.staff('playerRoll_',[first.session.token]),/Sign in/);
  const second=signIn(e).value;assert.equal(second.account.receipt.id,hold.id);assert.equal(second.account.receipt.status,'REVIEW');
  assert.equal(e.staff('ledger_',[]).attempts[hold.id].file,before.file);assert.equal(Object.keys(e.staff('ledger_',[]).attempts).length,1);
  const other=signIn(e,'223456789','second@example.test').value;
  assert.equal(e.post({action:'playerStatus',args:[other.session.token,hold.ticket]}).ok,false);
  assert.equal(e.mail.length,1); // Only owner setup sent a message.
});

test('directory changes revoke temporary sessions and expired sessions stay closed',()=>{
  const e=event(),signed=signIn(e).value;
  e.rows.Students[1][2]='changed@example.test';assert.throws(()=>e.staff('playerRoll_',[signed.session.token]),/Sign in/);
  const next=signIn(e,player.roll,'changed@example.test').value;
  e.advance(31*24*3600000);assert.throws(()=>e.staff('playerRoll_',[next.session.token]),/Sign in/);
});
