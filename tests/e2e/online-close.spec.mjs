import {randomUUID} from 'node:crypto';
import {test,expect} from './site.mjs';
import {player} from './event-runtime.mjs';
import {club,image,receiptText,credit} from '../payment-fixtures.mjs';

test.use({studentSignIn:'directory'});
async function login(page,site){
  await page.goto(site.register);
  await page.getByLabel('College roll number',{exact:true}).fill(player.roll);
  await page.getByLabel('College email',{exact:true}).fill(player.email);
  await page.getByRole('button',{name:'Sign in',exact:true}).click();
}
function savedRegistration(site,api){
  const signed=api.publicRpc('signInWithStudentDetails',player.roll,player.email,'',randomUUID()),token=signed.session.token;
  const hold=api.publicRpc('playerStart',token,'',randomUUID(),JSON.stringify({fullName:'Sample Student',pgpId:player.roll,contact:'9876501234',batch:'2026-28'}));
  return {token,hold,status:()=>api.publicRpc('playerStatus',token,hold.ticket)};
}

test('the unsubmitted details form closes at 4 PM even without a network connection',async({page,context,site})=>{
  site.at('2026-11-27T15:59:00+05:30');await page.clock.install({time:new Date(site.now())});
  club(site).makeReceiver();await login(page,site);
  await expect(page.getByRole('button',{name:'Continue to payment'})).toBeVisible();
  await context.setOffline(true);site.advance(60000);await page.clock.fastForward(60000);
  await expect(page.getByRole('heading',{name:'Registration closed',exact:true})).toBeVisible();
  await expect(page.locator('#content')).toContainText('Amphitheater from 7 PM IST');
  await expect(page.getByRole('button',{name:'Continue to payment'})).toHaveCount(0);
  expect(Object.keys(site.staff('ledger_',[]).attempts)).toHaveLength(0);
});

test('after 4 PM sign-in shows saved review status without a replacement upload',async({page,site})=>{
  const api=club(site);api.makeReceiver();const p=savedRegistration(site,api);site.ocr(receiptText());
  api.publicRpc('playerSubmitScreenshot',p.token,p.hold.ticket,image,'0');
  site.at('2026-11-27T16:00:00+05:30');await page.clock.install({time:new Date(site.now())});
  await login(page,site);
  await expect(page.locator('#content')).toContainText('submitted payment is saved and remains under review');
  await expect(page.getByRole('button',{name:'Refresh status'})).toBeVisible();
  await expect(page.getByLabel('Payment screenshot')).toHaveCount(0);
  expect(p.status().status).toBe('REVIEW');
});

test('the Google-hosted registration also closes and directs students to the desk',async({page,site})=>{
  site.at('2026-11-27T16:00:00+05:30');await page.clock.install({time:new Date(site.now())});
  await page.goto(site.origin+'/club?view=register');
  await page.getByLabel('College roll number',{exact:true}).fill(player.roll);
  await page.getByLabel('College email',{exact:true}).fill(player.email);
  await page.getByRole('button',{name:'Sign in',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Registration closed',exact:true})).toBeVisible();
  await expect(page.locator('#content')).toContainText('Amphitheater from 7 PM IST');
  expect(Object.keys(site.staff('ledger_',[]).attempts)).toHaveLength(0);
});

test('the closure notice preserves ticket access and never replaces a paid ticket',async({page,site})=>{
  const api=club(site),receiver=api.makeReceiver(),p=savedRegistration(site,api);
  api.submit(p,api.submission(p));api.apply(api.statement(receiver,[credit()]));
  const code=p.status().entryCode;site.at('2026-11-27T16:00:00+05:30');await page.clock.install({time:new Date(site.now())});
  await login(page,site);
  await expect(page.getByRole('heading',{name:'Payment verified'})).toBeVisible();
  await expect(page.locator('.ticket-code')).toHaveText(code);
  await expect(page.getByRole('heading',{name:'Online registration closed'})).toHaveCount(0);
  expect(site.staff('ledger_',[]).attempts[p.hold.id].wave).toBe(-1);
});

test('a staff-opened 7 PM checkout can be completed on the registration page',async({page,site})=>{
  site.at('2026-11-27T19:00:00+05:30');await page.clock.install({time:new Date(site.now())});
  const api=club(site);api.makeReceiver();api.rpc('adminOpenDeskPayment',api.admin,player.roll,'walk');
  await login(page,site);
  await page.getByLabel('Batch',{exact:true}).selectOption('2026-28');
  await page.getByRole('button',{name:'Save and continue'}).click();
  await expect(page.getByRole('heading',{name:'Pay ₹199'})).toBeVisible();
  await expect(page.getByLabel('Payment screenshot')).toBeVisible();
  expect(Object.values(site.staff('ledger_',[]).attempts)).toHaveLength(1);
});
