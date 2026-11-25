import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import bcrypt from 'bcryptjs';
import {createEvent,owner,player} from './e2e/event-runtime.mjs';

// Synthetic credentials only. The live verifier is private deployment configuration.
const password='Fixture-owner-82!',hash=bcrypt.hashSync(password,10),changedHash=bcrypt.hashSync('Changed-fixture-83!',10);
const event=()=>createEvent({studentSignIn:'directory',ownerSignIn:'password',ownerPasswordHash:hash});
const direct=(e,p=password,id=randomUUID())=>e.staff('signInOwnerWithPassword',[e.invite('admin'),p,id]);
const entry=(e,p=password,email=owner,id=randomUUID())=>e.post({action:'signInClubWithPassword',args:[email,p,id]});
const ticket=reply=>new URL(reply.value.continueUrl).hash.slice('#ticket='.length);

test('club password sign-in works without mail quota and preserves the journal',()=>{
  const e=event();e.mailFailure(true);e.mail.push(...Array.from({length:100},()=>({subject:'Synthetic quota use'})));
  const signed=direct(e);assert.equal(signed.role,'admin');assert.equal(signed.expires-e.now(),8*3600000);
  assert.equal(e.staff('staffSnapshot',[signed.token]).role,'admin');assert.equal(e.rows.Journal.length,1);assert.equal(e.mail.length,100);
});
test('wrong credentials, missing setup and ambiguous owners cannot open the club desk',()=>{
  const e=event();
  for(const email of [player.email,'no-owner@example.test',''])assert.equal(entry(e,password,email).ok,false);
  assert.equal(entry(e,'wrong').ok,false);assert.throws(()=>direct(e,'wrong'),/incorrect/);
  assert.throws(()=>direct(e,'a'.repeat(73)),/incorrect/);assert.throws(()=>direct(e,'é'.repeat(37)),/incorrect/);
  assert.throws(()=>direct(e,password,'invalid'),/Reload/);
  e.configureOwner({ownerPasswordHash:''});assert.throws(()=>direct(e),/not configured/);
  e.configureOwner({ownerPasswordHash:hash});e.rows.Staff.push([owner,'admin','a'.repeat(40),'yes']);assert.throws(()=>direct(e),/incorrect/);
  assert.equal(e.mail.length,0);assert.equal(e.rows.Journal.length,1);
});
test('public and private password routes share a bounded retry allowance',()=>{
  const e=event();for(let i=0;i<4;i++){assert.equal(entry(e,'wrong').ok,false);assert.throws(()=>direct(e,'wrong'),/incorrect/)}
  assert.match(entry(e).error,/Too many/);assert.throws(()=>direct(e),/Too many/);
  e.advance(15*60000);assert.equal(direct(e).role,'admin');assert.equal(e.mail.length,0);
});
test('retries recover one password session and logout and expiry revoke access',()=>{
  const e=event(),id=randomUUID(),signed=direct(e,password,id);assert.equal(direct(e,password,id).token,signed.token);
  e.staff('staffLogout',[signed.token]);assert.throws(()=>e.staff('staffSnapshot',[signed.token]),/Sign in/);
  const next=direct(e);e.advance(8*3600000);assert.throws(()=>e.staff('staffSnapshot',[next.token]),/Sign in/);
});
test('public password login transfers only to the owner desk and the transfer is single-use',()=>{
  const e=event(),id=randomUUID(),first=entry(e,password,owner.toUpperCase(),id),again=entry(e,password,owner,id);
  assert.equal(first.ok,true);assert.equal(again.value.continueUrl,first.value.continueUrl);
  const t=ticket(first);assert.throws(()=>e.staff('staffSnapshot',[t]),/Sign in/);
  assert.throws(()=>e.staff('completeDeskSignIn',[e.invite('desk'),t]),/owner/);
  const signed=e.staff('completeDeskSignIn',[e.invite('admin'),t]);assert.equal(signed.role,'admin');
  assert.throws(()=>e.staff('completeDeskSignIn',[e.invite('admin'),t]),/expired|already/);
  const expired=ticket(entry(e));e.advance(2*60000);assert.throws(()=>e.staff('completeDeskSignIn',[e.invite('admin'),expired]),/expired/);
});
test('password rotation and owner revocation invalidate password sessions and outstanding transfers',()=>{
  const e=event(),signed=direct(e),t=ticket(entry(e));e.configureOwner({ownerPasswordHash:changedHash});
  assert.throws(()=>e.staff('staffSnapshot',[signed.token]),/Sign in/);
  assert.throws(()=>e.staff('completeDeskSignIn',[e.invite('admin'),t]),/expired/);assert.equal(entry(e).ok,false);
  const next=direct(e,'Changed-fixture-83!');e.rows.Staff[1][3]='no';assert.throws(()=>e.staff('staffSnapshot',[next.token]),/role/);
});
test('owner codes and raw owner keys cannot bypass password mode; student and volunteer access remains available',()=>{
  const e=event();assert.match(e.post({action:'requestEventCode',args:[owner]}).error,/password/);
  assert.throws(()=>e.staff('requestOwnerCode',[e.invite('admin')]),/password/);
  assert.throws(()=>e.staff('verifyOwnerCode',[e.invite('admin'),'123456']),/password/);
  assert.match(e.post({action:'signInEvent',args:[owner,'123456','']}).error,/password/);
  assert.throws(()=>e.staff('staffLogin',[e.team.admin,e.invite('admin')]),/owner/);
  assert.equal(e.staff('staffLogin',[e.team.gate,e.invite('gate')]).role,'gate');
  assert.equal(e.post({action:'signInWithStudentDetails',args:[player.roll,player.email,'',randomUUID()]}).ok,true);
  e.configureOwner({ownerSignIn:'email'});assert.equal(entry(e).ok,false);assert.equal(e.mail.length,0);
});
