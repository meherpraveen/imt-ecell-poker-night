import {chromium} from '@playwright/test';
import {test,expect} from './site.mjs';
import {club,jpegQr,receiptText,testUpi,utr} from '../payment-fixtures.mjs';
import {player} from './event-runtime.mjs';

const button=(page,name)=>page.getByRole('button',{name,exact:true});
async function requestCode(page,site){
  await page.goto(site.register);await page.getByLabel('Roll number or registered email').fill(player.roll);
  await button(page,'Send code').click();await expect(page.getByLabel('Six-digit code')).toBeVisible();
}
async function verify(page,site){
  await page.getByLabel('Six-digit code').fill(site.code(player.email));await button(page,'Verify and continue').click();
}

test('closing the browser resumes details, receiver, screenshot and OCR corrections on the same phone',async({site},testInfo)=>{
  const api=club(site),receiver=api.makeReceiver(testUpi,'First receiver');api.makeReceiver('other@samplebank','Second receiver');
  site.rows.Students[1][3]='';
  const open=async()=>{
    const context=await chromium.launchPersistentContext(testInfo.outputPath('student-profile'),{channel:process.env.POKER_BROWSER_CHANNEL||undefined,viewport:{width:390,height:844}});
    await site.attach(context);return context;
  };
  let context=await open(),page=context.pages()[0]||await context.newPage();
  try{
    await requestCode(page,site);await context.close();
    context=await open();page=context.pages()[0]||await context.newPage();await page.goto(site.register);
    await expect(page.getByLabel('Six-digit code')).toBeVisible();await verify(page,site);
    await expect(page.getByLabel('Phone number')).toHaveAttribute('required','');
    await page.getByLabel('Batch').selectOption('2025-27');await button(page,'Save my registration').click();
    await expect(page.locator('#regContactError')).toHaveText('Enter your phone number.');
    await page.getByLabel('Full Name').fill('Returning Student');await page.getByLabel('Phone number').fill('+91 98765 01234');
    await context.close();site.advance(3*3600000);context=await open();page=context.pages()[0]||await context.newPage();await page.goto(site.register);
    await expect(page.getByLabel('Full Name')).toHaveValue('Returning Student');await expect(page.getByLabel('Batch')).toHaveValue('2025-27');
    await expect(page.getByLabel('Phone number')).toHaveValue('+91 98765 01234');await button(page,'Save my registration').click();
    await expect(page.getByRole('heading',{name:'Online UPI payments paused'})).toBeVisible();
    site.ocr(receiptText());await page.getByLabel('Payment screenshot').setInputFiles({name:'bank-receipt.jpg',mimeType:'image/jpeg',buffer:jpegQr()});
    await expect(page.getByLabel('UTR / UPI Transaction ID')).toHaveValue(utr);
    await expect(page.locator('#proofDraftNote')).toContainText('saved on this device');
    await page.getByLabel('Amount paid (₹)').fill('149.0');await page.getByLabel('Who made the payment?').fill('My brother');
    await page.getByLabel('Please confirm the recipient of your payment').selectOption(receiver.id);
    await page.getByLabel(/I agree to play fair/).check();await context.close();
    site.advance(11*60000);for(const key of site.cache.keys())if(key.startsWith('proof-bytes:'))site.cache.delete(key);
    context=await open();page=context.pages()[0]||await context.newPage();await page.goto(site.register);
    await expect(page.getByLabel('Payment screenshot')).toHaveValue(/bank-receipt\.jpg$/);
    await expect(page.locator('#checkoutPayment a, #checkoutPayment img')).toHaveCount(0);
    await expect(page.getByLabel('Amount paid (₹)')).toHaveValue('149.0');await expect(page.getByLabel('Who made the payment?')).toHaveValue('My brother');
    await expect(page.getByLabel('Please confirm the recipient of your payment')).toHaveValue(receiver.id);await expect(page.getByLabel(/I agree to play fair/)).toBeChecked();
    await button(page,'Submit for verification').click();await expect(page.getByRole('heading',{name:'Payment pending'})).toBeVisible();
    expect(site.calls.filter(s=>s==='playerStart')).toHaveLength(1);expect(site.calls.filter(s=>s==='playerReadProof')).toHaveLength(1);
    expect(site.rows.Journal.filter(r=>r[1]==='Proof submitted')).toHaveLength(1);
    expect(site.mail.filter(m=>m.to===player.email)).toHaveLength(1);
    expect(await page.evaluate(()=>Object.keys(localStorage).filter(k=>k.includes(':draft:')))).toEqual([]);
  }finally{await context.close()}
});

test('an expired email code can be replaced in one tap and a lost sign-in response reuses the same request',async({page,context,site})=>{
  await page.clock.install({time:new Date(site.now())});await requestCode(page,site);
  site.advance(11*60000);await page.clock.fastForward(11*60000);await page.reload();
  await button(page,'Send a new code').click();await expect(page.getByLabel('Six-digit code')).toBeVisible();
  const requests=[];await page.route(site.endpoint,async route=>{
    const body=route.request().postDataJSON();if(body.action!=='signInEvent')return route.fallback();
    requests.push(body.args[3]);if(requests.length===1){site.post(body);return route.abort()}return route.fallback();
  });
  await verify(page,site);await expect(page.locator('#msg')).toContainText('Could not reach');await button(page,'Verify and continue').click();
  await expect(page.getByLabel('Phone number')).toBeVisible();expect(requests).toHaveLength(2);expect(requests[0]).toBe(requests[1]);
  await page.getByLabel('Full Name').fill('Private draft');
  const another=await context.newPage();await another.goto(site.register);await expect(another.getByLabel('Full Name')).toHaveValue('Private draft');
  await button(page,'Sign out').click();await expect(another.getByLabel('Roll number or registered email')).toBeVisible();
  expect(await page.evaluate(()=>Object.keys(localStorage).filter(k=>k.includes('player-login')||k.includes(':draft:')))).toEqual([]);
});

test('an unfinished checkout from an earlier release asks for a phone once on the original receipt',async({page,site})=>{
  const api=club(site);api.makeReceiver();const p=api.student(),old=site.staff('ledger_',[]).attempts[p.hold.id];
  site.rows.Journal.push([site.now(),'Earlier release','Fixture',JSON.stringify({attempts:[{...old,details:{...old.details,contact:''}}]})]);
  site.rows.Students[1][3]='';
  await page.addInitScript(token=>sessionStorage.setItem('pn26:player-login',JSON.stringify({token,expires:1})),p.token);
  await page.goto(site.register);await button(page,'Save and continue').click();await expect(page.locator('#regContactError')).toHaveText('Enter your phone number.');
  await page.getByLabel('Phone number').fill('9876501234');await button(page,'Save and continue').click();
  await expect(page.getByRole('heading',{name:'Online UPI payments paused'})).toBeVisible();
  expect(p.status().ticket).toBe(p.hold.ticket);expect(p.status().details.contact).toBe('9876501234');
});

test('closing during OCR restores the original screenshot and keeps a manually corrected UTR',async({page,context,site})=>{
  const api=club(site);api.makeReceiver();const p=api.student();site.ocr(receiptText());
  await page.addInitScript(token=>sessionStorage.setItem('pn26:player-login',JSON.stringify({token})),p.token);
  let release;
  const pending=new Promise(resolve=>{release=resolve});
  await page.route(site.endpoint,async route=>{
    if(route.request().postDataJSON().action!=='playerReadProof')return route.fallback();
    await pending;await route.abort().catch(()=>{});
  });
  try{
    await page.goto(site.register);
    await page.getByLabel('Payment screenshot').setInputFiles({name:'receipt.jpg',mimeType:'image/jpeg',buffer:jpegQr()});
    await expect(page.locator('#proofDraftNote')).toContainText('saved on this device');
    await page.getByLabel('UTR / UPI Transaction ID').fill('123456789099');
    await page.close();
  }finally{release()}
  const resumed=await context.newPage();await resumed.goto(site.register);
  await expect(resumed.locator('#proofDraftNote')).toHaveText('Restored screenshot · receipt.jpg');
  await expect(resumed.locator('#ocrFeedback')).toContainText('Check the details read');
  await expect(resumed.getByLabel('UTR / UPI Transaction ID')).toHaveValue('123456789099');
  await expect(resumed.getByLabel('Amount paid (₹)')).toHaveValue('149.00');
});

test('reconnecting restores a draft and a lost registration response reopens the saved checkout once',async({page,site})=>{
  club(site).makeReceiver();await requestCode(page,site);await verify(page,site);
  await page.getByLabel('Full Name').fill('Interrupted Student');await page.getByLabel('Phone number').fill('9876501234');
  await page.getByLabel('Batch').selectOption('2026-28');
  let unavailable=true;
  await page.route(site.endpoint,route=>{
    const body=route.request().postDataJSON();
    if(unavailable&&body.action==='playerHome')return route.abort();
    if(body.action==='playerStart'){site.post(body);return route.abort()}
    return route.fallback();
  });
  await page.reload();await expect(page.locator('#msg')).toContainText('Could not reach');
  unavailable=false;await page.evaluate(()=>window.dispatchEvent(new Event('online')));
  await expect(page.getByLabel('Full Name')).toHaveValue('Interrupted Student');
  await expect(page.locator('#msg')).toBeEmpty();
  await button(page,'Save my registration').click();await expect(page.locator('#msg')).toContainText('Could not reach');
  await page.reload();await expect(page.getByRole('heading',{name:'Online UPI payments paused'})).toBeVisible();
  expect(site.mail.filter(m=>m.to===player.email)).toHaveLength(1);
  expect(site.rows.Journal.filter(r=>r[1]==='Payment proof intake opened')).toHaveLength(1);
  expect(await page.evaluate(()=>Object.keys(localStorage).filter(k=>k.includes(':draft:')))).toEqual([]);
});

test('leaving as soon as the email arrives keeps its code screen and a later re-verification restores the draft',async({page,context,site})=>{
  let release;const pending=new Promise(resolve=>{release=resolve});
  await page.route(site.endpoint,async route=>{
    const body=route.request().postDataJSON();if(body.action!=='requestEventCode')return route.fallback();
    site.post(body);await pending;await route.abort().catch(()=>{});
  });
  try{
    await page.goto(site.register);await page.getByLabel('Roll number or registered email').fill(player.roll);await button(page,'Send code').click();
    await expect.poll(()=>site.mail.length).toBe(1);await page.close();
  }finally{release()}
  const returning=await context.newPage();await returning.goto(site.register);
  await expect(returning.getByLabel('Six-digit code')).toBeVisible();await verify(returning,site);
  await returning.getByLabel('Full Name').fill('Saved before verification');await returning.getByLabel('Batch').selectOption('2025-27');
  const token=await returning.evaluate(()=>JSON.parse(localStorage.getItem('pn26:player-login')).token);
  site.post({action:'playerLogout',args:[token]});site.advance(61000);await returning.reload();
  await expect(returning.getByLabel('Roll number or registered email')).toHaveValue(player.roll);
  await button(returning,'Send code').click();await verify(returning,site);
  await expect(returning.getByLabel('Full Name')).toHaveValue('Saved before verification');
  await expect(returning.getByLabel('Batch')).toHaveValue('2025-27');expect(site.mail).toHaveLength(2);
});
