import {createRequire} from 'node:module';
import {readFile} from 'node:fs/promises';
import {devices} from '@playwright/test';
import {test,expect} from './site.mjs';
import {club,jpegQr,receiptText,testUpi,utr} from '../payment-fixtures.mjs';

const require=createRequire(import.meta.url);
const alternate='alternate@samplebank';
const image={name:'payment.jpg',mimeType:'image/jpeg',buffer:jpegQr()};

async function openCheckout(page,site){
  const api=club(site);
  const first=api.makeReceiver(testUpi,'First receiver','9000000001'),second=api.makeReceiver(alternate,'Second receiver','9000000002');
  const player=api.student();
  await page.addInitScript(token=>sessionStorage.setItem('pn26:player-login',JSON.stringify({token,expires:Date.now()+3600000})),player.token);
  await page.goto(site.register);
  await expect(page.getByRole('group',{name:'Payment QR'})).toBeVisible();
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
  await expect(page.getByRole('radio',{name:'First receiver'})).toBeChecked();
  await expect(page.getByRole('button',{name:'Copy UPI ID for First receiver'})).toBeVisible();
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
  await expect(page.getByRole('button',{name:'Copy UPI ID for Second receiver'})).toHaveAttribute('data-value',alternate);
  await expect(images).toHaveCount(2);await page.reload();
  await expect(target).toBeChecked();expect(player.status().chosenReceiverId).toBe(second.id);
});

async function decodeSavedQr(page,bytes){
  await page.addScriptTag({path:require.resolve('jsqr')});
  return page.evaluate(async data=>{
    const img=new Image();img.src='data:image/png;base64,'+data;await img.decode();
    const canvas=document.createElement('canvas');canvas.width=img.naturalWidth;canvas.height=img.naturalHeight;
    const ctx=canvas.getContext('2d');ctx.drawImage(img,0,0);
    const pixels=ctx.getImageData(0,0,canvas.width,canvas.height);
    return {width:canvas.width,payload:window.jsQR(pixels.data,pixels.width,pixels.height)?.data};
  },bytes.toString('base64'));
}
for(const device of ['iPhone 13','Pixel 7']){
  test.describe(device,()=>{
    const {userAgent,viewport,isMobile,hasTouch}=devices[device];test.use({userAgent,viewport,isMobile,hasTouch});
    test('copies only the confirmed ID and number and saves a scannable image without launching a payment app',async({page,site})=>{
      await page.addInitScript(()=>Object.defineProperties(navigator,{
        clipboard:{configurable:true,value:{writeText:async value=>{window.copiedValue=value}}},
        canShare:{configurable:true,value:()=>false}
      }));
      const {player,first,second}=await openCheckout(page,site);
      const tools=page.getByRole('group',{name:'Payment details for '+second.name});
      await expect(page.locator('[data-payment-copy],[data-save-qr]')).toHaveCount(3);
      await page.getByRole('radio',{name:first.name}).check();
      await expect(page.getByRole('button',{name:'Copy UPI ID for '+first.name})).toBeVisible();
      const gate=await holdRequest(page,site.endpoint,'playerSelectReceiver');
      await page.getByRole('radio',{name:second.name}).check();await gate.seen;
      await expect(page.locator('[data-payment-copy],[data-save-qr]')).toHaveCount(0);gate.release();
      await tools.getByRole('button',{name:/Copy UPI ID/}).click();await expect(tools.getByRole('status')).toHaveText('UPI ID copied.');
      expect(await page.evaluate(()=>window.copiedValue)).toBe(second.upi);
      await tools.getByRole('button',{name:/Copy number/}).click();await expect(tools.getByRole('status')).toHaveText('UPI number copied.');
      expect(await page.evaluate(()=>window.copiedValue)).toBe(second.number);
      const [download]=await Promise.all([page.waitForEvent('download'),tools.getByRole('link',{name:/Save QR/}).click()]);
      expect(download.suggestedFilename()).toBe('payment-qr-second-receiver.png');
      const bytes=await readFile(await download.path());expect([...bytes.subarray(0,8)]).toEqual([137,80,78,71,13,10,26,10]);
      const code=await decodeSavedQr(page,bytes);expect(code.width).toBeGreaterThanOrEqual(512);
      expect(code.payload).toBe('upi://pay?pa='+second.upi+'&cu=INR');
      await expect(page.locator('#checkoutPayment a:not([download])')).toHaveCount(0);
      expect(await tools.locator('button,a').evaluateAll(nodes=>nodes.every(node=>node.getBoundingClientRect().height>=44))).toBe(true);
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
      expect(player.status().status).toBe('HOLD');expect(player.status().entryCode).toBe('');
      await page.reload();await expect(tools.getByRole('button',{name:/Copy number/})).toBeVisible();
      const proof=page.locator('form[data-action="submitPayment"]');await expect(proof.locator('input,select,textarea')).toHaveCount(1);
      await proof.getByLabel('Payment screenshot').setInputFiles(image);
      await expect(page.locator('#proofDraftNote')).toContainText('saved on this device');await page.reload();
      await expect(page.locator('#proofDraftNote')).toHaveText('Restored screenshot · payment.jpg');
      await proof.getByRole('button',{name:'Submit screenshot'}).click();
      await expect(page.getByRole('heading',{name:'Payment pending'})).toBeVisible();
    });
  });
}

test('iPad desktop mode shares the verified PNG and offers a download when sharing is denied or cancelled',async({page,site})=>{
  await page.addInitScript(()=>{
    Object.defineProperties(navigator,{platform:{get:()=>'MacIntel'},maxTouchPoints:{get:()=>5},
      canShare:{value:data=>data.files?.length===1&&data.files[0].type==='image/png'},
      share:{value:async({files})=>{
        if(window.shareError)throw new DOMException('Share unavailable',window.shareError);
        window.sharedFile={type:files[0].type,name:files[0].name,bytes:Array.from(new Uint8Array(await files[0].arrayBuffer()))};
      }}
    });
  });
  const {first}=await openCheckout(page,site);await page.getByRole('radio',{name:first.name}).check();
  const box=page.getByRole('group',{name:'Payment details for '+first.name}),save=box.getByRole('link',{name:/Save QR/});
  await save.click();await expect.poll(()=>page.evaluate(()=>window.sharedFile?.name)).toBe('payment-qr-first-receiver.png');
  const file=await page.evaluate(()=>window.sharedFile);expect(file.type).toBe('image/png');
  expect((await decodeSavedQr(page,Buffer.from(file.bytes))).payload).toBe('upi://pay?pa='+first.upi+'&cu=INR');
  for(const error of ['NotAllowedError','AbortError']){
    await page.evaluate(name=>{window.shareError=name},error);await save.click();
    await expect(box.getByRole('status')).toContainText(error==='AbortError'?'Save cancelled':'You can download');
    const link=box.getByRole('link',{name:'Download QR image'});
    await expect(link).toHaveAttribute('download','payment-qr-first-receiver.png');
  }
  const [download]=await Promise.all([page.waitForEvent('download'),box.getByRole('link',{name:'Download QR image'}).click()]);
  expect(await readFile(await download.path())).toEqual(Buffer.from(file.bytes));
});

test('blocked clipboard permission leaves the chosen number or ID selected for native copying',async({page,site})=>{
  await page.addInitScript(()=>Object.defineProperty(navigator,'clipboard',{value:{writeText:async()=>{throw Error('Clipboard permission denied')}}}));
  const {first}=await openCheckout(page,site);await page.getByRole('radio',{name:first.name}).check();
  for(const [button,label,value] of [['Copy UPI ID','UPI ID',first.upi],['Copy number','UPI number',first.number]]){
    await page.getByRole('button',{name:button+' for '+first.name}).click();
    const manual=page.getByRole('textbox',{name:label+' to copy'});
    await expect(manual).toBeVisible();await expect(manual).toBeFocused();await expect(manual).toHaveValue(value);
    expect(await manual.evaluate(el=>[el.selectionStart,el.selectionEnd])).toEqual([0,value.length]);
  }
});

test('the browser clipboard contains the exact configured values after tapping Copy',async({context,page,site,browserName})=>{
  await context.grantPermissions(browserName==='webkit'?['clipboard-read']:['clipboard-read','clipboard-write'],{origin:site.origin});
  const {second}=await openCheckout(page,site);await page.getByRole('radio',{name:second.name}).check();
  const box=page.getByRole('group',{name:'Payment details for '+second.name});
  // WebKit expects a separate user gesture to read even the clipboard value this origin wrote.
  await page.evaluate(()=>{
    const probe=document.createElement('button');probe.id='verifyTestClipboard';probe.textContent='Verify test clipboard';
    probe.onclick=async()=>{probe.dataset.match=String((await navigator.clipboard.readText())===probe.dataset.expected)};
    document.body.append(probe);
  });
  const probe=page.locator('#verifyTestClipboard');
  for(const [label,value] of [['Copy UPI ID',second.upi],['Copy number',second.number]]){
    await box.getByRole('button',{name:new RegExp(label)}).click();
    await expect(box.getByRole('status')).toContainText('copied.');
    await probe.evaluate((node,expected)=>{node.dataset.expected=expected;delete node.dataset.match},value);
    await probe.click();await expect(probe).toHaveAttribute('data-match','true');
  }
});

test('a changed receiver number refreshes before it can be copied and a missing QR leaves the verified ID available',async({page,site})=>{
  const {api,first,second}=await openCheckout(page,site);
  api.rpc('adminSaveReceiver',api.admin,{...second,number:'9000000009'});
  await page.getByRole('radio',{name:second.name}).check();
  await expect(page.getByRole('button',{name:'Copy number for '+second.name})).toHaveAttribute('data-value','9000000009');
  const old=site.staff('ledger_',[]).receivers[first.id];
  site.rows.Journal.push([site.now(),'Older QR file unavailable','Fixture',JSON.stringify({receivers:[{...old,qrPayload:'',qrFile:'missing-test-file'}]})]);
  await page.reload();
  await expect(page.getByText('QR unavailable',{exact:true})).toBeVisible();
  await page.getByRole('radio',{name:first.name}).check();
  const tools=page.getByRole('group',{name:'Payment details for '+first.name});
  await expect(tools.getByRole('button',{name:/Copy UPI ID/})).toHaveAttribute('data-value',first.upi);
  await expect(tools.getByRole('button',{name:/Copy number/})).toHaveAttribute('data-value',first.number);
  await expect(tools.getByRole('link',{name:/Save QR/})).toHaveCount(0);
});

test('the Apps Script registration exposes the same manual controls if its frame denies clipboard access',async({page,site})=>{
  const api=club(site),receiver=api.makeReceiver(testUpi,'Club receiver','9000000003'),player=api.student();
  await page.addInitScript(token=>{
    Object.defineProperty(navigator,'clipboard',{value:undefined});
    sessionStorage.setItem('pn26:player-login',JSON.stringify({token}));
  },player.token);
  await page.route('**/test-staff-rpc',route=>{
    const {name,args}=route.request().postDataJSON();
    return route.fulfill({json:site.post({action:name,args})});
  });
  await page.goto(site.origin+'/club?view=register');
  const tools=page.getByRole('group',{name:'Payment details for '+receiver.name});
  await tools.getByRole('button',{name:/Copy UPI ID/}).click();
  await expect(tools.getByRole('textbox',{name:'UPI ID to copy'})).toHaveValue(testUpi);
  await tools.getByRole('button',{name:/Copy number/}).click();
  await expect(tools.getByRole('textbox',{name:'UPI number to copy'})).toHaveValue(receiver.number);
  await expect(tools.getByRole('link',{name:/Save QR/})).toBeVisible();
  await expect(page.locator('#checkoutPayment a:not([download])')).toHaveCount(0);
});

test('legacy ID-only checkout offers only its available detail',async({page,site})=>{
  site.rows.Settings[1][1]=testUpi;site.rows.Settings[2][1]='Club & Events';site.rows.Settings[5][1]='yes';
  const player=club(site).student();await page.addInitScript(token=>sessionStorage.setItem('pn26:player-login',JSON.stringify({token})),player.token);
  await page.goto(site.register);
  await expect(page.getByRole('button',{name:'Copy UPI ID for Club & Events'})).toHaveAttribute('data-value',testUpi);
  await expect(page.getByRole('button',{name:/Copy number/})).toHaveCount(0);
  await expect(page.locator('#checkoutPayment a')).toHaveCount(0);
});

test('a busy desk retries and the screenshot is sent only once, when the student submits it',async({page,site})=>{
  const {player,second}=await openCheckout(page,site);
  const radio=page.getByRole('radio',{name:second.name}),shot=page.getByLabel('Payment screenshot');
  let limited=0,posted=[];
  await page.route(site.endpoint,async route=>{
    const {action,args}=route.request().postDataJSON();
    if(action==='playerSelectReceiver'&&limited++===0)return route.fulfill({status:429,headers:{'Retry-After':'1'},body:'Too many requests'});
    if(['playerReadProof','playerSubmitPayment','playerSubmitScreenshot'].includes(action))posted.push({action,image:args[2]});
    return route.fallback();
  });
  await radio.check();await expect(page.locator('#net')).toContainText('Retrying automatically');
  await expect(page.getByRole('button',{name:'Copy UPI ID for Second receiver'})).toBeVisible();
  expect(limited).toBe(2);await expect(radio).toBeChecked();
  site.ocr(receiptText(utr,'149.00',second.upi));await shot.setInputFiles(image);
  expect(posted).toEqual([]);
  await expect(shot.locator('xpath=..').locator('input,select,textarea')).toHaveCount(1);
  await page.getByRole('button',{name:'Submit screenshot'}).click();
  await expect(page.getByRole('heading',{name:'Payment pending'})).toBeVisible();
  expect(posted).toEqual([{action:'playerSubmitScreenshot',image:'data:image/jpeg;base64,'+image.buffer.toString('base64')}]);expect(player.status().proofVersion).toBe(1);
});

test('a lost choice response, rapid switches and conflicting tabs preserve the proof draft',async({page,site})=>{
  const {api,player,first,second}=await openCheckout(page,site);
  site.ocr(receiptText());await page.getByLabel('Payment screenshot').setInputFiles(image);
  await expect(page.locator('#proofDraftNote')).toContainText('saved on this device');
  const a=page.getByRole('radio',{name:'First receiver'}),b=page.getByRole('radio',{name:'Second receiver'});
  const feedback=page.locator('#receiverFeedback'),upi=page.getByRole('button',{name:/Copy UPI ID/});
  await page.route(site.endpoint,async route=>{
    if(route.request().postDataJSON().action!=='playerSelectReceiver')return route.fallback();
    site.post(route.request().postDataJSON());await route.abort();
  },{times:1});
  await b.click();await expect(feedback).toContainText('Choose again');await expect(upi).toHaveCount(0);
  await b.check();await expect(upi).toHaveAccessibleName('Copy UPI ID for Second receiver');
  expect(player.status().receiverChoiceVersion).toBe(1);
  const gate=await holdRequest(page,site.endpoint,'playerSelectReceiver');
  await a.check();await gate.seen;await b.check();await expect(upi).toHaveCount(0);gate.release();
  await expect(upi).toHaveAccessibleName('Copy UPI ID for Second receiver');
  const saved=player.status();expect(saved.receiverChoiceVersion).toBe(3);
  api.publicRpc('playerSelectReceiver',player.token,saved.ticket,first.id,'3');
  await a.check();await expect(upi).toHaveAccessibleName('Copy UPI ID for First receiver');
  api.publicRpc('playerSelectReceiver',player.token,saved.ticket,second.id,'4');
  api.publicRpc('playerSelectReceiver',player.token,saved.ticket,first.id,'5');
  await b.click();await expect(feedback).toContainText('another window');await expect(upi).toHaveCount(0);
  await b.check();await expect(upi).toHaveAccessibleName('Copy UPI ID for Second receiver');
  await expect(page.locator('#shot')).toHaveValue(/payment\.jpg$/);
  expect(player.status().chosenReceiverId).toBe(second.id);
});

test('checkout keeps both QRs and the payment draft open for hours on the original registration',async({page,site})=>{
  await page.clock.install({time:new Date(site.now())});
  const {player,first}=await openCheckout(page,site);
  await page.getByRole('radio',{name:first.name}).check();
  await expect(page.locator('#receiverFeedback')).toContainText('Selected');
  site.ocr(receiptText());await page.getByLabel('Payment screenshot').setInputFiles(image);
  await expect(page.locator('#proofDraftNote')).toContainText('saved on this device');
  const elapsed=3*60*60000;site.advance(elapsed);await page.clock.fastForward(elapsed);
  await expect(page.getByRole('heading',{name:'Pay ₹149'})).toBeVisible();
  await page.getByRole('radio',{name:'Second receiver'}).check();
  await expect(page.getByRole('img',{name:/UPI payment QR/})).toHaveCount(2);
  await expect(page.getByRole('button',{name:'Copy UPI ID for Second receiver'})).toBeVisible();
  await page.getByRole('radio',{name:first.name}).check();await expect(page.locator('#receiverFeedback')).toContainText(first.name);
  await expect(page.locator('#proofDraftNote')).toContainText('saved on this device');
  await page.getByRole('button',{name:'Submit screenshot'}).click();
  await expect(page.getByRole('heading',{name:'Payment pending'})).toBeVisible();
  expect(player.status().entryCode).toBe('');
});

test('editing registration keeps the receiver, screenshot and verified PGP ID on the same checkout',async({page,site})=>{
  const {player,second}=await openCheckout(page,site);
  await page.getByRole('radio',{name:second.name}).check();
  await expect(page.locator('#receiverFeedback')).toContainText(second.name);
  const shot=page.getByLabel('Payment screenshot');await shot.setInputFiles(image);
  const editor=page.locator('#registrationEditor');await editor.locator('summary').click();
  await expect(editor.getByLabel('PGP ID')).toHaveAttribute('readonly','');
  await expect(editor.getByLabel('Batch')).toHaveValue('2026-28');
  await editor.getByLabel('Full Name').fill('Edited Student');
  await editor.getByLabel('Phone number').fill('9876543210');
  await editor.getByLabel('Batch').selectOption('');await editor.getByRole('button',{name:'Save changes'}).click();
  await expect(editor.locator('#regBatchError')).toHaveText('Choose your batch to continue.');
  await editor.getByLabel('Batch').selectOption('2025-27');await editor.getByRole('button',{name:'Save changes'}).click();
  await expect(page.locator('#detailsSaved')).toHaveText('Saved');
  await expect(page.getByRole('radio',{name:second.name})).toBeChecked();
  await expect(shot).toHaveValue(/payment\.jpg$/);
  const saved=player.status();expect(saved.ticket).toBe(player.hold.ticket);expect(saved.details.batch).toBe('2025-27');
  await page.reload();await page.locator('#registrationEditor summary').click();
  await expect(page.getByLabel('Full Name')).toHaveValue('Edited Student');await expect(page.getByLabel('Phone number')).toHaveValue('9876543210');
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

test('a receiver choice crossing the online cutoff cannot restore payment controls or change the saved receiver',async({page,site})=>{
  site.at('2026-11-27T15:59:45+05:30');await page.clock.install({time:new Date(site.now())});
  const {player,second}=await openCheckout(page,site);
  const original=player.status().chosenReceiverId;
  const pending=await holdRequest(page,site.endpoint,'playerSelectReceiver');
  await page.getByRole('radio',{name:second.name}).check();await pending.seen;
  site.advance(16000);await page.clock.fastForward(16000);
  await expect(page.getByRole('heading',{name:'Online registration closed'})).toBeVisible();
  await expect(page.getByRole('button',{name:/Copy UPI ID/})).toHaveCount(0);
  pending.release();
  await expect.poll(()=>site.calls.filter(name=>name==='playerSelectReceiver').length).toBe(1);
  await expect(page.getByRole('button',{name:/Copy UPI ID/})).toHaveCount(0);
  expect(player.status().chosenReceiverId).toBe(original);
});

test('closing keeps the details and screenshot draft until staff reopen the checkout at the desk',async({page,site})=>{
  site.at('2026-11-27T15:55:00+05:30');await page.clock.install({time:new Date(site.now())});
  const {first,api,player}=await openCheckout(page,site);
  await page.getByRole('radio',{name:first.name}).check();
  const copyId=page.getByRole('button',{name:/Copy UPI ID/});await expect(copyId).toHaveAttribute('data-value',first.upi);
  site.ocr(receiptText());await page.getByLabel('Payment screenshot').setInputFiles(image);
  await expect(page.locator('#proofDraftNote')).toContainText('saved on this device');
  await page.locator('#registrationEditor summary').click();
  await page.getByLabel('Full Name').fill('Still editing');
  let fail=true;
  await page.route(site.endpoint,route=>{
    if(fail&&route.request().postDataJSON().action==='playerStatus'){fail=false;return route.abort()}
    return route.fallback();
  });
  site.advance(6*60000);await page.clock.fastForward(6*60000);
  await expect(page.getByRole('heading',{name:'Online registration closed'})).toBeVisible();
  await expect(copyId).toHaveCount(0);await expect(page.getByLabel('Payment screenshot')).toHaveCount(0);
  await expect(page.getByLabel('Full Name')).toHaveValue('Still editing');
  site.at('2026-11-27T19:00:00+05:30');await page.clock.fastForward(179*60000);
  api.rpc('adminOpenDeskPayment',api.admin,player.hold.beneficiary,'walk');
  const refresh=page.getByRole('button',{name:'Refresh status'});await refresh.click();
  await expect(page.locator('#msg')).toContainText('Could not reach');await refresh.click();
  await expect(copyId).toHaveAttribute('data-value',first.upi);await expect(page.getByRole('heading',{name:'Pay ₹199'})).toBeVisible();
  await expect(page.getByLabel('Full Name')).toHaveValue('Still editing');
  await expect(page.getByLabel('Payment screenshot')).toHaveValue(/payment\.jpg$/);
  await expect(page.locator('#proofDraftNote')).toContainText('Restored screenshot');
});

test('clearing a file recovers, and proof still submits while the receiver choice is unresolved',async({page,site})=>{
  const {api,first,second}=await openCheckout(page,site);
  const a=page.getByRole('radio',{name:first.name}),b=page.getByRole('radio',{name:second.name});
  await b.check();await expect(page.locator('#receiverFeedback')).toContainText(second.name);
  api.rpc('adminSaveReceiver',api.admin,{...first,active:false});
  await a.click();await expect(page.getByAltText('UPI payment QR for First receiver')).toHaveCount(0);
  await expect(page.getByAltText('UPI payment QR for Second receiver')).toBeVisible();
  const shot=page.getByLabel('Payment screenshot'),submit=page.getByRole('button',{name:'Submit screenshot'});
  await submit.click();await expect(shot).toHaveAttribute('aria-describedby',/proofLimit proofDraftNote shotError/);
  await shot.setInputFiles(image);await expect(page.locator('#proofDraftNote')).toContainText('saved on this device');
  await shot.setInputFiles([]);await submit.click();await expect(page.locator('#shotError')).toBeVisible();
  await shot.setInputFiles(image);await expect(shot).toHaveAttribute('aria-describedby','proofLimit proofDraftNote');
  site.ocr(null);await submit.click();
  await expect(page.getByRole('heading',{name:'Payment pending'})).toBeVisible();
  expect(site.rows.Journal.filter(row=>row[1]==='Proof submitted')).toHaveLength(1);
});

test('retry after a lost upload response keeps one screenshot and one registration',async({page,site})=>{
  const {player}=await openCheckout(page,site),requests=[];
  await page.route(site.endpoint,async route=>{
    const body=route.request().postDataJSON();if(body.action!=='playerSubmitScreenshot')return route.fallback();
    requests.push(body.args);
    if(requests.length===1){site.post(body);return route.abort()}
    return route.fallback();
  });
  const form=page.locator('form[data-action="submitPayment"]'),submit=form.getByRole('button',{name:'Submit screenshot'});
  await form.getByLabel('Payment screenshot').setInputFiles(image);await submit.click();
  await expect(page.locator('#msg')).toContainText('Could not reach');
  await submit.click();await expect(page.getByRole('heading',{name:'Payment pending'})).toBeVisible();
  expect(requests).toHaveLength(2);expect(requests[0]).toEqual(requests[1]);expect(player.status().proofVersion).toBe(1);
  expect(site.rows.Journal.filter(row=>row[1]==='Proof submitted')).toHaveLength(1);
});
