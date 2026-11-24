import {devices} from '@playwright/test';
import {test,expect} from './site.mjs';
import {club,jpegQr,receiptText,testUpi,utr} from '../payment-fixtures.mjs';

const alternate='alternate@samplebank';
const image={name:'payment.jpg',mimeType:'image/jpeg',buffer:jpegQr()};

async function openCheckout(page,site){
  const api=club(site);
  const first=api.makeReceiver(testUpi,'First receiver'),second=api.makeReceiver(alternate,'Second receiver');
  const player=api.student();
  await page.addInitScript(token=>sessionStorage.setItem('pn26:player-login',JSON.stringify({token,expires:Date.now()+3600000})),player.token);
  await page.goto(site.register);
  await expect(page.getByRole('heading',{name:'Online UPI payments paused'})).toBeVisible();
  return {api,player,first,second};
}
function holdRequest(page,endpoint,action){
  let release,arrived;
  const wait=new Promise(resolve=>{release=resolve}),seen=new Promise(resolve=>{arrived=resolve});
  let held=false;
  const handler=async route=>{
    if(held||route.request().postDataJSON().action!==action)return route.fallback();
    held=true;arrived();await wait;await route.fallback();
  };
  return page.route(endpoint,handler).then(()=>({release,seen}));
}

async function expectNoPaymentDestination(page){
  await expect(page.locator('#checkoutPayment a, #checkoutPayment img, #checkoutPayment input, [data-payment-link]')).toHaveCount(0);
  await expect(page.getByRole('link',{name:/Google Pay|PhonePe|Paytm|BHIM|Open UPI app|Save QR/i})).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Copy UPI ID'})).toHaveCount(0);
  await expect(page.locator('body')).not.toContainText('@samplebank');
}

for(const deviceName of ['iPhone 13','Pixel 7','iPad (gen 7)']){
  test.describe(deviceName,()=>{
    const {userAgent,viewport,isMobile,hasTouch}=devices[deviceName];
    test.use({userAgent,viewport,isMobile,hasTouch});
    test('a risk decline leaves the registration saved without another payment request',async({page,site})=>{
      const {player}=await openCheckout(page,site);
      await expect(page.getByText(/UPI risk policy and shows no debit/)).toBeVisible();
      await expectNoPaymentDestination(page);
      for(const width of [320,viewport.width]){
        await page.setViewportSize({width,height:viewport.height});
        expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
      }
      await page.reload();await expect(page.getByLabel('Payment screenshot')).toBeVisible();
      await expectNoPaymentDestination(page);
      expect(player.status().entryCode).toBe('');expect(player.status().proofVersion).toBe(0);
      expect(site.calls).not.toContain('playerSelectReceiver');
      expect(site.calls.filter(method=>method==='playerStart')).toHaveLength(1);
    });
  });
}

test('a cached response from the previous release cannot recreate an app link or QR on iPad desktop mode',async({page,site})=>{
  await page.addInitScript(()=>{
    Object.defineProperties(navigator,{platform:{get:()=>'MacIntel'},maxTouchPoints:{get:()=>5}});
  });
  let mixed=false;
  await page.route(site.endpoint,route=>{
    const request=route.request().postDataJSON();
    if(request.action!=='playerHome')return route.fallback();
    const result=site.post(request),r=result.value.receipt;
    Object.assign(r,{upi:testUpi,name:'Old payee',paymentQr:'data:image/gif;base64,R0lG',checkoutReceivers:[{...r.receiver,upi:testUpi,qr:'data:image/gif;base64,R0lG'}]});
    mixed=true;return route.fulfill({json:result,headers:{'Access-Control-Allow-Origin':'*'}});
  });
  await openCheckout(page,site);expect(mixed).toBe(true);await expectNoPaymentDestination(page);
});

test('the embedded Apps Script release keeps prior recipients private and can recover a completed payment',async({page,site})=>{
  const api=club(site);api.makeReceiver();const player=api.student();
  await page.addInitScript(token=>sessionStorage.setItem('pn26:player-login',JSON.stringify({token})),player.token);
  await page.route('**/test-staff-rpc',route=>{
    const {name,args}=route.request().postDataJSON();
    return route.fulfill({json:site.post({action:name,args})});
  });
  await page.goto(site.origin+'/club?view=register');
  await expect(page.getByRole('heading',{name:'Online UPI payments paused'})).toBeVisible();
  await expectNoPaymentDestination(page);await expect(page.getByLabel('Payment screenshot')).toBeVisible();
  await expect(page.getByRole('link',{name:'Open this receipt on the event site'})).toHaveAttribute('href',/view=register/);
  site.ocr(receiptText());await page.getByLabel('Payment screenshot').setInputFiles(image);
  await expect(page.getByLabel('UTR / UPI Transaction ID')).toHaveValue(utr);
  await page.getByLabel('Please confirm the recipient of your payment').selectOption(player.hold.receiver.id);
  await page.getByLabel(/I agree to play fair/).check();await page.getByRole('button',{name:'Submit for verification'}).click();
  await expect(page.getByRole('heading',{name:'Payment pending'})).toBeVisible();
  expect(player.status().proofVersion).toBe(1);expect(player.status().entryCode).toBe('');
});

test('a busy proof reader retries and a cache miss reuses the selected file for the actual recipient',async({page,site})=>{
  const {api,player,second}=await openCheckout(page,site);
  let reads=0;const posted=[];
  await page.route(site.endpoint,route=>{
    const {action,args}=route.request().postDataJSON();
    if(action==='playerReadProof'&&reads++===0)return route.fulfill({status:429,headers:{'Retry-After':'1'},body:'Too many requests'});
    if(action==='playerSubmitPayment')posted.push(args[2].startsWith('proof:')?'reference':'original');
    return route.fallback();
  });
  site.ocr(receiptText(utr,'149.00',second.upi));await page.getByLabel('Payment screenshot').setInputFiles(image);
  await expect(page.locator('#net')).toContainText('Retrying automatically');
  await expect(page.getByLabel('UTR / UPI Transaction ID')).toHaveValue(utr);expect(reads).toBe(2);
  for(const key of site.cache.keys())if(key.startsWith('proof-bytes:'))site.cache.delete(key);
  await page.getByLabel('Please confirm the recipient of your payment').selectOption(second.id);
  await page.getByLabel(/I agree to play fair/).check();await page.getByRole('button',{name:'Submit for verification'}).click();
  await expect(page.getByRole('heading',{name:'Payment pending'})).toBeVisible();
  await expect(page.getByText('Receiver · Second receiver')).toBeVisible();
  expect(posted).toEqual(['reference','original']);expect(player.status().proofVersion).toBe(1);
  expect(player.status().entryCode).toBe('');expect(api.rpc('adminNeedsReview',api.admin).payments).toHaveLength(1);
});

test('a pending transfer screenshot cannot automatically issue an entry pass',async({page,site})=>{
  const {api,player,first}=await openCheckout(page,site);
  site.ocr(receiptText().replace('Successfully paid','Payment pending'));
  await page.getByLabel('Payment screenshot').setInputFiles(image);
  await expect(page.getByLabel('UTR / UPI Transaction ID')).toHaveValue(utr);
  await page.getByLabel('Please confirm the recipient of your payment').selectOption(first.id);
  await page.getByLabel(/I agree to play fair/).check();await page.getByRole('button',{name:'Submit for verification'}).click();
  await expect(page.getByRole('heading',{name:'Payment pending'})).toBeVisible();
  const plan=api.statement(first);expect(plan.matches[0].reason).toContain('pending');
  expect(api.apply(plan).authorized).toBe(0);await page.getByRole('button',{name:'Refresh status'}).click();
  expect(player.status().entryCode).toBe('');await expect(page.getByAltText('Single-use entry QR')).toHaveCount(0);
});

test('editing registration keeps the receiver, screenshot, OCR and verified PGP ID on the same checkout',async({page,site})=>{
  const {player,second}=await openCheckout(page,site);
  site.ocr(receiptText());const reading=await holdRequest(page,site.endpoint,'playerReadProof');
  const shot=page.getByLabel('Payment screenshot');await shot.setInputFiles(image);await reading.seen;
  await page.getByLabel('Who made the payment?').fill('A friend');
  await page.getByLabel('Please confirm the recipient of your payment').selectOption(second.id);
  const editor=page.locator('#registrationEditor');await editor.locator('summary').click();
  await expect(editor.getByLabel('PGP ID')).toHaveAttribute('readonly','');
  await expect(editor.getByLabel('Batch')).toHaveValue('2026-28');
  await editor.getByLabel('Full Name').fill('Edited Student');
  await editor.getByLabel('Phone number').fill('9876543210');
  await editor.getByLabel('Batch').selectOption('');await editor.getByRole('button',{name:'Save changes'}).click();
  await expect(editor.locator('#regBatchError')).toHaveText('Choose your batch to continue.');
  await editor.getByLabel('Batch').selectOption('2025-27');await editor.getByRole('button',{name:'Save changes'}).click();
  await expect(page.locator('#detailsSaved')).toHaveText('Saved');reading.release();
  await expect(page.getByLabel('Please confirm the recipient of your payment')).toHaveValue(second.id);
  await expect(shot).toHaveValue(/payment\.jpg$/);await expect(page.getByLabel('UTR / UPI Transaction ID')).toHaveValue(utr);
  await expect(page.getByLabel('Who made the payment?')).toHaveValue('A friend');
  await expect(page.getByLabel('Who was the payment for?')).toHaveValue('Edited Student · '+player.hold.beneficiary);
  const saved=player.status();expect(saved.ticket).toBe(player.hold.ticket);expect(saved.details.batch).toBe('2025-27');
  await page.reload();await page.locator('#registrationEditor summary').click();
  await expect(page.getByLabel('Full Name')).toHaveValue('Edited Student');await expect(page.getByLabel('Phone number')).toHaveValue('9876543210');
  expect(site.calls.filter(action=>action==='playerStart')).toHaveLength(1);
});

test('a returning registration with a missing batch opens proof intake as soon as the batch is saved',async({page,site})=>{
  const api=club(site),p=api.student(),old=site.staff('ledger_',[]).attempts[p.hold.id];
  expect(old.status).toBe('REGISTERED');
  site.rows.Journal.push([site.now(),'Previous release','Fixture',JSON.stringify({attempts:[{...old,details:{...old.details,batch:''},detailsRevision:0}]})]);
  api.makeReceiver(testUpi,'First receiver');api.makeReceiver(alternate,'Second receiver');
  await page.addInitScript(token=>sessionStorage.setItem('pn26:player-login',JSON.stringify({token,expires:Date.now()+3600000})),p.token);
  await page.goto(site.register+'#receipt='+encodeURIComponent(p.hold.ticket));
  await expect(page.getByLabel('Full Name')).toHaveValue(old.details.fullName);
  await expect(page.getByLabel('PGP ID')).toHaveValue(old.roll);
  await page.getByRole('button',{name:'Save and continue'}).click();
  await expect(page.locator('#regBatchError')).toHaveText('Choose your batch to continue.');
  await page.getByLabel('Batch').selectOption('2025-27');await page.getByRole('button',{name:'Save and continue'}).click();
  await expect(page.getByLabel('Payment screenshot')).toBeVisible();await expectNoPaymentDestination(page);
  expect(p.status().ticket).toBe(p.hold.ticket);expect(p.status().details.batch).toBe('2025-27');
  expect(Object.values(site.staff('ledger_',[]).attempts)).toHaveLength(1);
});

test('a waitlisted player can report a past debit without claiming a seat when every wave is full',async({page,site})=>{
  const api=club(site),receiver=api.makeReceiver();
  const seats=Array.from({length:216},(_,index)=>({id:'a'+String(index).padStart(15,'0'),roll:String(300000000+index),wave:Math.floor(index/36),kind:'pre',fee:149,created:site.now(),status:'PAID'}));
  site.rows.Journal.push([site.now(),'Existing paid seats','Fixture',JSON.stringify({attempts:seats})]);
  const player=api.student();expect(player.hold.status).toBe('WAITLIST');
  await page.addInitScript(token=>sessionStorage.setItem('pn26:player-login',JSON.stringify({token})),player.token);
  await page.goto(site.register);
  await page.getByRole('button',{name:'Report a completed payment'}).click();
  await expect(page.getByRole('heading',{name:'All waves are full'})).toBeVisible();await expectNoPaymentDestination(page);
  site.ocr(receiptText());await page.getByLabel('Payment screenshot').setInputFiles(image);
  await expect(page.getByLabel('UTR / UPI Transaction ID')).toHaveValue(utr);
  await page.getByLabel('Please confirm the recipient of your payment').selectOption(receiver.id);
  await page.getByLabel(/I agree to play fair/).check();await page.getByRole('button',{name:'Submit for verification'}).click();
  await expect(page.getByRole('heading',{name:'Payment pending'})).toBeVisible();
  expect(player.status().ticket).toBe(player.hold.ticket);expect(player.status().wave).toBe(0);
  expect(api.apply(api.statement(receiver)).authorized).toBe(0);
});

test('a pricing change keeps the details and proof drafts during a retry',async({page,site})=>{
  site.at('2026-11-27T18:55:00+05:30');await page.clock.install({time:new Date(site.now())});
  await openCheckout(page,site);
  const amount=page.locator('#checkoutPayment .price-values strong');await expect(amount).toHaveText('₹149');
  site.ocr(receiptText());await page.getByLabel('Payment screenshot').setInputFiles(image);
  await expect(page.getByLabel('UTR / UPI Transaction ID')).toHaveValue(utr);
  await page.locator('#registrationEditor summary').click();
  await page.getByLabel('Full Name').fill('Still editing');
  let fail=true;
  await page.route(site.endpoint,route=>{
    if(fail&&route.request().postDataJSON().action==='playerStatus'){fail=false;return route.abort()}
    return route.fallback();
  });
  site.advance(6*60000);await page.clock.fastForward(6*60000);
  const retry=page.getByRole('button',{name:'Retry payment details'});await expect(retry).toBeVisible();
  await expect(amount).toBeHidden();await retry.click();
  await expect(amount).toHaveText('₹199');await expectNoPaymentDestination(page);
  await expect(page.getByLabel('Full Name')).toHaveValue('Still editing');
  await expect(page.getByLabel('Payment screenshot')).toHaveValue(/payment\.jpg$/);
  await expect(page.getByLabel('UTR / UPI Transaction ID')).toHaveValue(utr);
});

test('delayed OCR preserves typing and clearing a screenshot recovers without a second debit',async({page,site})=>{
  const {second}=await openCheckout(page,site);
  site.ocr(receiptText());
  const shot=page.getByLabel('Payment screenshot'),submit=page.getByRole('button',{name:'Submit for verification'});
  await submit.click();await expect(shot).toHaveAttribute('aria-describedby',/proofLimit proofHint shotError/);
  const pending=await holdRequest(page,site.endpoint,'playerReadProof');
  await shot.setInputFiles(image);await pending.seen;
  await expect(page.getByLabel('Who was the payment for?')).toBeVisible();
  await shot.setInputFiles([]);await expect(submit).toBeEnabled();await expect(page.locator('#proofFields')).toBeHidden();
  pending.release();await expect(shot).toHaveAttribute('aria-describedby','proofLimit proofHint');
  const replacement=await holdRequest(page,site.endpoint,'playerReadProof');
  await shot.setInputFiles(image);await replacement.seen;
  await page.getByLabel('Amount paid (₹)').fill('140.50');
  await page.getByLabel('Please confirm the recipient of your payment').selectOption(second.id);
  replacement.release();await expect(page.getByLabel('UTR / UPI Transaction ID')).toHaveValue(utr);
  await expect(page.getByLabel('Amount paid (₹)')).toHaveValue('140.50');await expect(submit).toBeEnabled();
  await expect(page.getByLabel('Please confirm the recipient of your payment')).toHaveValue(second.id);
});
