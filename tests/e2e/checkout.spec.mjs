import {createRequire} from 'node:module';
import {test,expect} from './site.mjs';
import {club,jpegQr,receiptText,testUpi,utr} from '../payment-fixtures.mjs';

const require=createRequire(import.meta.url);
const alternate='alternate@samplebank';
const image={name:'payment.jpg',mimeType:'image/jpeg',buffer:jpegQr()};

async function openCheckout(page,site){
  const api=club(site);
  const first=api.makeReceiver(testUpi,'First receiver'),second=api.makeReceiver(alternate,'Second receiver');
  const player=api.student();
  await page.addInitScript(token=>sessionStorage.setItem('pn26:player-login',JSON.stringify({token,expires:Date.now()+3600000})),player.token);
  await page.goto(site.register);
  await expect(page.getByRole('group',{name:'Who would you like to pay?'})).toBeVisible();
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

test('both payment codes scan at their displayed size on a small phone, tablet and desktop',async({page,site})=>{
  const {player,second}=await openCheckout(page,site);
  await page.addScriptTag({path:require.resolve('jsqr')});
  const images=page.getByRole('img',{name:/UPI payment QR for/});
  await expect(images).toHaveCount(2);
  await expect(page.locator('input[name=checkoutReceiver]:checked')).toHaveCount(0);
  await expect(page.getByRole('link',{name:/Open UPI app/})).toHaveCount(0);
  for(const width of [320,390,768,1280]){
    await page.setViewportSize({width,height:844});await page.emulateMedia({colorScheme:width<400?'dark':'light'});
    const codes=await images.evaluateAll(async imgs=>Promise.all(imgs.map(async img=>{
      await img.decode();
      const {y,width}=img.getBoundingClientRect(),canvas=document.createElement('canvas');
      canvas.width=canvas.height=Math.round(width);
      const ctx=canvas.getContext('2d');ctx.imageSmoothingEnabled=false;ctx.drawImage(img,0,0,canvas.width,canvas.height);
      const pixels=ctx.getImageData(0,0,canvas.width,canvas.height);
      return {y,width,value:window.jsQR(pixels.data,pixels.width,pixels.height)?.data};
    })));
    expect(codes.map(c=>c.value)).toEqual([testUpi,alternate].map(id=>'upi://pay?pa='+id+'&cu=INR'));
    expect(Math.abs(codes[0].y-codes[1].y)).toBeLessThan(1);
    expect(codes.every(c=>c.width>=100)).toBe(true);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  }
  const target=page.getByRole('radio',{name:'Second receiver'});
  await target.focus();await page.keyboard.press('Space');
  await expect(page.getByRole('link',{name:'Open UPI app to pay Second receiver'})).toHaveAttribute('href',/alternate%40samplebank/);
  await expect(images).toHaveCount(2);await page.reload();
  await expect(target).toBeChecked();expect(player.status().chosenReceiverId).toBe(second.id);
});

test('a busy payment desk retries on its own and a cache miss reuses the selected screenshot',async({page,site})=>{
  const {player,second}=await openCheckout(page,site);
  const radio=page.getByRole('radio',{name:second.name}),shot=page.getByLabel('Payment screenshot');
  let limited=0,posted=[];
  await page.route(site.endpoint,async route=>{
    const {action,args}=route.request().postDataJSON();
    if(action==='playerSelectReceiver'&&limited++===0)return route.fulfill({status:429,headers:{'Retry-After':'1'},body:'Too many requests'});
    if(action==='playerSubmitPayment')posted.push(args[2].startsWith('proof:')?'reference':'original');
    return route.fallback();
  });
  await radio.check();await expect(page.locator('#net')).toContainText('Retrying automatically');
  await expect(page.getByRole('link',{name:'Open UPI app to pay Second receiver'})).toBeVisible();
  expect(limited).toBe(2);await expect(radio).toBeChecked();
  site.ocr(receiptText(utr,'149.00',second.upi));await shot.setInputFiles(image);
  await expect(page.getByLabel('UTR / UPI Transaction ID')).toHaveValue(utr);
  for(const key of site.cache.keys())if(key.startsWith('proof-bytes:'))site.cache.delete(key);
  await page.getByLabel('Please confirm the recipient of your payment').selectOption(second.id);
  await page.getByLabel(/I agree to play fair/).check();
  await page.getByRole('button',{name:'Submit for verification'}).click();
  await expect(page.getByRole('heading',{name:'Payment pending'})).toBeVisible();
  expect(posted).toEqual(['reference','original']);expect(player.status().proofVersion).toBe(1);
});

test('a lost choice response, rapid switches and conflicting tabs preserve the proof draft',async({page,site})=>{
  const {api,player,first,second}=await openCheckout(page,site);
  site.ocr(receiptText());await page.getByLabel('Payment screenshot').setInputFiles(image);
  await expect(page.getByLabel('UTR / UPI Transaction ID')).toHaveValue(utr);
  const payer=page.getByLabel('Who made the payment?');await payer.fill('My original payer');
  const a=page.getByRole('radio',{name:'First receiver'}),b=page.getByRole('radio',{name:'Second receiver'});
  const feedback=page.locator('#receiverFeedback'),upi=page.getByRole('link',{name:/Open UPI app/});
  await page.route(site.endpoint,async route=>{
    if(route.request().postDataJSON().action!=='playerSelectReceiver')return route.fallback();
    site.post(route.request().postDataJSON());await route.abort();
  },{times:1});
  await a.click();await expect(feedback).toContainText('Choose again');await expect(upi).toHaveCount(0);
  await a.check();await expect(upi).toHaveAccessibleName('Open UPI app to pay First receiver');
  expect(player.status().receiverChoiceVersion).toBe(1);
  const gate=await holdRequest(page,site.endpoint,'playerSelectReceiver');
  await b.check();await gate.seen;await a.check();await expect(upi).toHaveCount(0);gate.release();
  await expect(upi).toHaveAccessibleName('Open UPI app to pay First receiver');
  const saved=player.status();expect(saved.receiverChoiceVersion).toBe(3);
  api.publicRpc('playerSelectReceiver',player.token,saved.ticket,second.id,'3');
  await b.check();await expect(upi).toHaveAccessibleName('Open UPI app to pay Second receiver');
  api.publicRpc('playerSelectReceiver',player.token,saved.ticket,first.id,'4');
  api.publicRpc('playerSelectReceiver',player.token,saved.ticket,second.id,'5');
  await a.click();await expect(feedback).toContainText('another window');await expect(upi).toHaveCount(0);
  await a.check();await expect(upi).toHaveAccessibleName('Open UPI app to pay First receiver');
  await expect(payer).toHaveValue('My original payer');await expect(page.locator('#shot')).toHaveValue(/payment\.jpg$/);
  expect(player.status().chosenReceiverId).toBe(first.id);
});

test('checkout keeps both QRs and the payment draft open for hours on the original registration',async({page,site})=>{
  await page.clock.install({time:new Date(site.now())});
  const {player,first}=await openCheckout(page,site);
  await page.getByRole('radio',{name:first.name}).check();
  await expect(page.locator('#receiverFeedback')).toContainText('Selected');
  site.ocr(receiptText());await page.getByLabel('Payment screenshot').setInputFiles(image);
  await expect(page.getByLabel('UTR / UPI Transaction ID')).toHaveValue(utr);
  const elapsed=3*60*60000;site.advance(elapsed);await page.clock.fastForward(elapsed);
  await expect(page.getByRole('heading',{name:'Pay ₹149'})).toBeVisible();
  await page.getByRole('radio',{name:'Second receiver'}).check();
  await expect(page.getByRole('img',{name:/UPI payment QR/})).toHaveCount(2);
  await expect(page.getByRole('link',{name:'Open UPI app to pay Second receiver'})).toBeVisible();
  await page.getByRole('radio',{name:first.name}).check();await expect(page.locator('#receiverFeedback')).toContainText(first.name);
  await expect(page.getByLabel('UTR / UPI Transaction ID')).toHaveValue(utr);
  await page.getByLabel('Please confirm the recipient of your payment').selectOption(first.id);
  await expect(page.getByLabel('Who was the payment for?')).toHaveValue(new RegExp(player.hold.beneficiary));
  await page.getByLabel(/I agree to play fair/).check();await page.getByRole('button',{name:'Submit for verification'}).click();
  await expect(page.getByRole('heading',{name:'Payment pending'})).toBeVisible();
  expect(player.status().entryCode).toBe('');
});

test('editing registration keeps the receiver, screenshot, OCR and verified PGP ID on the same checkout',async({page,site})=>{
  const {player,second}=await openCheckout(page,site);
  await page.getByRole('radio',{name:second.name}).check();
  await expect(page.locator('#receiverFeedback')).toContainText(second.name);
  site.ocr(receiptText());const reading=await holdRequest(page,site.endpoint,'playerReadProof');
  const shot=page.getByLabel('Payment screenshot');await shot.setInputFiles(image);await reading.seen;
  await page.getByLabel('Who made the payment?').fill('A friend');
  const editor=page.locator('#registrationEditor');await editor.locator('summary').click();
  await expect(editor.getByLabel('PGP ID')).toHaveAttribute('readonly','');
  await expect(editor.getByLabel('Batch')).toHaveValue('2026-28');
  await editor.getByLabel('Full Name').fill('Edited Student');
  await editor.getByLabel('Contact No. (optional)').fill('9876543210');
  await editor.getByLabel('Batch').selectOption('');await editor.getByRole('button',{name:'Save changes'}).click();
  await expect(editor.locator('#regBatchError')).toHaveText('Choose your batch to continue.');
  await editor.getByLabel('Batch').selectOption('2025-27');await editor.getByRole('button',{name:'Save changes'}).click();
  await expect(page.locator('#detailsSaved')).toHaveText('Saved');reading.release();
  await expect(page.getByRole('radio',{name:second.name})).toBeChecked();
  await expect(shot).toHaveValue(/payment\.jpg$/);await expect(page.getByLabel('UTR / UPI Transaction ID')).toHaveValue(utr);
  await expect(page.getByLabel('Who made the payment?')).toHaveValue('A friend');
  await expect(page.getByLabel('Who was the payment for?')).toHaveValue('Edited Student · '+player.hold.beneficiary);
  const saved=player.status();expect(saved.ticket).toBe(player.hold.ticket);expect(saved.details.batch).toBe('2025-27');
  await page.reload();await page.locator('#registrationEditor summary').click();
  await expect(page.getByLabel('Full Name')).toHaveValue('Edited Student');await expect(page.getByLabel('Contact No. (optional)')).toHaveValue('9876543210');
  expect(site.calls.filter(action=>action==='playerStart')).toHaveLength(1);
});

test('a returning registration with a missing batch opens payment as soon as the batch is saved',async({page,site})=>{
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
  await expect(page.getByRole('img',{name:/UPI payment QR/})).toHaveCount(2);
  expect(p.status().ticket).toBe(p.hold.ticket);expect(p.status().details.batch).toBe('2025-27');
  expect(Object.values(site.staff('ledger_',[]).attempts)).toHaveLength(1);
});

test('a receiver choice in flight at the price cutoff stays selected at the new price',async({page,site})=>{
  site.at('2026-11-27T18:59:45+05:30');await page.clock.install({time:new Date(site.now())});
  const {player,second}=await openCheckout(page,site);
  const pending=await holdRequest(page,site.endpoint,'playerSelectReceiver');
  await page.getByRole('radio',{name:second.name}).check();await pending.seen;
  site.advance(16000);await page.clock.fastForward(16000);
  await expect(page.locator('#checkoutUpdate')).toHaveText('Checking the current entry fee…');
  await expect(page.locator('#checkoutUpdate')).toBeVisible();
  await expect(page.getByRole('link',{name:/Open UPI app/})).toHaveCount(0);
  pending.release();
  await expect(page.getByRole('link',{name:'Open UPI app to pay Second receiver'})).toHaveAttribute('href',/am=199\.00/);
  await expect(page.getByRole('radio',{name:second.name})).toBeChecked();
  expect(player.status().chosenReceiverId).toBe(second.id);
});

test('a pricing change withdraws the old payment link and keeps the details and proof drafts during a retry',async({page,site})=>{
  site.at('2026-11-27T18:55:00+05:30');await page.clock.install({time:new Date(site.now())});
  const {first}=await openCheckout(page,site);
  await page.getByRole('radio',{name:first.name}).check();
  const link=page.getByRole('link',{name:/Open UPI app/});await expect(link).toHaveAttribute('href',/am=149\.00/);
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
  await expect(link).toHaveCount(0);await retry.click();
  await expect(link).toHaveAttribute('href',/am=199\.00/);await expect(page.getByRole('heading',{name:'Pay ₹199'})).toBeVisible();
  await expect(page.getByLabel('Full Name')).toHaveValue('Still editing');
  await expect(page.getByLabel('Payment screenshot')).toHaveValue(/payment\.jpg$/);
  await expect(page.getByLabel('UTR / UPI Transaction ID')).toHaveValue(utr);
});

test('delayed OCR preserves typing, clearing a file recovers, and a disabled receiver withdraws its QR',async({page,site})=>{
  const {api,first,second}=await openCheckout(page,site);
  const a=page.getByRole('radio',{name:'First receiver'}),b=page.getByRole('radio',{name:'Second receiver'});
  api.rpc('adminSaveReceiver',api.admin,{...first,active:false});
  await a.click();await expect(page.getByAltText('UPI payment QR for First receiver')).toHaveCount(0);
  await expect(page.getByAltText('UPI payment QR for Second receiver')).toBeVisible();
  await b.check();await expect(page.locator('#receiverFeedback')).toContainText(second.name);
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
