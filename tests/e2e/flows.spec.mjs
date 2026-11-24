import {test,expect} from './site.mjs';
import {player,owner} from './event-runtime.mjs';

const button=(page,name)=>page.getByRole('button',{name,exact:true});
const heading=(page,name)=>page.getByRole('heading',{name,exact:true});
const png={name:'sample.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=','base64')};
async function enterCode(page,code,label){
  await page.getByLabel('Six-digit code').fill(code);
  await button(page,label).click();
}
async function studentLogin(page,site){
  await page.goto(site.register);
  await page.getByLabel('Roll number or registered email').fill(player.roll);
  await button(page,'Send code').click();
  await expect(heading(page,'Enter your sign-in code')).toBeVisible();
  await enterCode(page,site.code(player.email),'Verify and continue');
}
async function staffLogin(page,site,role){
  await page.goto(site.staffUrl(role));
  if(role==='admin'){
    await button(page,'Send code to club email').click();
    await expect(page.getByLabel('Six-digit code')).toBeVisible();
    await enterCode(page,site.code(owner),'Verify and open desk');
  }else{
    await page.getByLabel('Private staff key').fill(site.team[role]);await button(page,'Sign in').click();
  }
  await expect(button(page,'Sign out')).toBeVisible();
}
async function gateAction(page,mode,value){
  const manual=page.getByText('Enter a code or record a venue return',{exact:true});
  if(!await page.getByLabel('Action',{exact:true}).isVisible())await manual.click();
  await page.getByLabel('Action',{exact:true}).selectOption(mode);
  await page.getByLabel('Entry code or roll number').fill(value);
  await page.getByLabel('I checked the college ID or assigned wristband.').check();
  await button(page,'Record at gate').click();
}

test('first paint accepts typed input before scripts arrive and sends one request',async({page,site})=>{
  let release;
  const paused=new Promise(resolve=>{release=resolve});
  await page.route('**/assets/event-app.js*',async route=>{await paused;await route.continue()});
  await page.goto(site.register,{waitUntil:'commit'});
  const identifier=page.getByLabel('Roll number or registered email');
  await identifier.fill(player.roll);await identifier.press('Enter');
  await expect(button(page,'Sending code…')).toBeDisabled();
  expect(site.calls).toEqual([]);release();
  await expect(page.getByLabel('Six-digit code')).toBeVisible();
  expect(site.calls.filter(name=>name!=='publicPrices')).toEqual(['requestEventCode']);
  await enterCode(page,site.code(player.email),'Verify and continue');
  await expect(button(page,'Save my registration')).toBeVisible();
  expect(site.calls.filter(name=>name!=='publicPrices')).toEqual(['requestEventCode','signInEvent']);
  await button(page,'Save my registration').click();await expect(page.locator('#regBatchError')).toContainText('Choose your batch');
  await page.getByLabel('Batch',{exact:true}).selectOption('2025-27');await button(page,'Save my registration').dblclick();
  await expect(heading(page,'Registration saved')).toBeVisible();
  expect(site.rows.Journal.filter(r=>r[1]==='Registration saved')).toHaveLength(1);
  await page.reload();await expect(heading(page,'Registration saved')).toBeVisible();
  await button(page,'Sign out').click();await expect(identifier).toBeVisible();
});

test('a student can sign in after five earlier code emails in the same day',async({page,site})=>{
  for(let sent=0;sent<5;sent++){
    expect(site.post({action:'requestEventCode',args:[player.email]}).ok).toBe(true);
    site.advance(60000);
  }
  site.advance(10*60000);
  await studentLogin(page,site);
  await expect(button(page,'Save my registration')).toBeVisible();
  expect(site.mail).toHaveLength(6);
});

test('club email at the public sign-in opens the private admin desk with one code',async({page,context,site})=>{
  await page.goto(site.register);
  await expect(page.locator('a[href*="view=staff"]')).toHaveCount(0);
  await page.getByLabel('Roll number or registered email').fill(owner.toUpperCase());
  await button(page,'Send code').click();
  await expect(page.getByLabel('Six-digit code')).toBeVisible();
  await expect(page.locator('#content')).toContainText(owner.toUpperCase());
  expect(site.mail.map(({to,subject})=>[to,subject])).toEqual([[owner,'Poké Poker Night 2026 admin sign-in code']]);
  await expect(page.getByText('Student sign-in is saved on this device for 30 days.')).toBeVisible();
  await enterCode(page,site.code(owner),'Verify and continue');
  await expect(button(page,'Settings')).toBeVisible();
  const privateUrl=new URL(page.url());
  expect(privateUrl.origin).toBe('https://script.google.com');
  expect(privateUrl.hash).toBe('');expect(privateUrl.searchParams.has('entry')).toBe(false);
  await page.reload();
  await button(page,'Settings').click();await expect(page.getByLabel('UPI ID')).toBeVisible();
  expect(site.mail).toHaveLength(1);
  const storage=await context.storageState();
  expect(storage.origins.every(origin=>!origin.localStorage.some(item=>item.name.includes('staff:')))).toBe(true);
  await page.goto(site.register);
  await expect(page.getByLabel('Roll number or registered email')).toBeVisible();
  expect(await page.evaluate(()=>Object.keys(sessionStorage).filter(key=>key.startsWith('pn26:')&&key!=='pn26:public-entry-quote'))).toEqual([]);
});

test('mail failure, mismatched details, cooldown and delayed email can all be recovered',async({page,site})=>{
  site.mailFailure(true);await page.goto(site.register);
  await page.getByLabel('Roll number or registered email').fill(player.email);await button(page,'Send code').click();
  await expect(page.getByRole('status').filter({hasText:'Email delivery is temporarily unavailable'})).toBeVisible();
  expect(site.mail).toHaveLength(0);site.mailFailure(false);await button(page,'Send code').click();
  await expect(page.getByLabel('Six-digit code')).toBeVisible();const original=site.code(player.email);
  const junk=page.getByRole('link',{name:'Open Outlook Junk Email'});
  await expect(junk).toBeVisible();
  await expect(junk).toHaveAttribute('href','https://outlook.office.com/mail/junkemail');
  await expect(junk).toHaveAttribute('target','_blank');
  await expect(junk).toHaveAttribute('rel',/noreferrer/);
  const folderUrl='https://outlook.office.com/mail/junkemail';
  await page.context().route(folderUrl,route=>route.fulfill({contentType:'text/html',body:'<title>Test mail folder</title>'}));
  const [folder]=await Promise.all([page.context().waitForEvent('page'),junk.click()]);
  await expect(folder).toHaveURL(folderUrl);
  await folder.close();
  await expect(page.getByLabel('Six-digit code')).toBeVisible();
  expect(site.mail).toHaveLength(1);
  await page.getByText('Email hasn’t arrived?',{exact:true}).click();await page.getByLabel('College roll number').fill(player.roll);
  await page.getByLabel('Email on your student record').fill('other@example.test');
  await button(page,'Check details and send code').click();await expect(page.locator('#msg')).toContainText('do not match');
  await page.getByLabel('Email on your student record').fill(player.email);
  await button(page,'Check details and send code').click();await expect(page.locator('#msg')).toContainText('still active');
  expect(site.mail).toHaveLength(1);site.advance(65000);
  await page.getByText('Email hasn’t arrived?',{exact:true}).click();
  await page.getByLabel('Email on your student record').fill(player.email);await button(page,'Check details and send code').click();
  await expect(page.locator('#msg')).toContainText('accepted the email');expect(site.mail).toHaveLength(2);
  expect(site.code(player.email)).toBe(original);
  await enterCode(page,original,'Verify and continue');await expect(button(page,'Save my registration')).toBeVisible();
});

test('owner keeps a payment QR private, checks proof and issues a single-use pass; gate and floor share the result',async({context,page,site})=>{
  const admin=await context.newPage();await staffLogin(admin,site,'admin');
  await button(admin,'Settings').click();await admin.getByLabel('Recipient name shown by the UPI app').fill('Example Club');
  await admin.getByLabel('Upload payment QR').setInputFiles(png);await admin.getByLabel('Accept proof for this account').check();
  await button(admin,'Save payment settings').click();await expect(button(admin,'Preview saved QR')).toBeVisible();
  await studentLogin(page,site);await page.getByLabel('Batch',{exact:true}).selectOption('2026-28');await button(page,'Save my registration').click();await expect(heading(page,'Online UPI payments paused')).toBeVisible();
  await expect(page.getByAltText('Coordinator’s UPI payment QR')).toHaveCount(0);
  await page.getByLabel('Payment screenshot').setInputFiles(png);await page.getByLabel('Visible final digits',{exact:false}).fill('6789');
  await page.getByLabel('I agree to share',{exact:false}).check();await button(page,'Submit for review').click();
  await expect(heading(page,'Payment under review')).toBeVisible();
  await button(admin,'Payments').click();await button(admin,'Refresh').click();await admin.getByRole('button',{name:/^Open payment for /}).click();
  await button(admin,'View private screenshot').click();await expect(admin.getByAltText('Private payment screenshot')).toBeVisible();
  await admin.getByLabel('Full UPI bank reference').fill('123456786789');await admin.getByLabel('I checked the incoming credit',{exact:false}).check();
  await button(admin,'Approve and send code').click();await expect(admin.locator('dialog')).not.toBeVisible();
  await button(page,'Refresh status').click();await expect(heading(page,'Payment verified')).toBeVisible();
  const passMail=site.mail.find(m=>m.to===player.email&&m.subject.includes('entry'));
  const passLink=new URL(passMail.body.match(/https:\/\/\S+/)[0]);expect(passLink.hostname).toBe('pokernight.imtneversleeps.com');
  const code=new URLSearchParams(passLink.hash.slice(1)).get('code'),pass=await context.newPage();
  await pass.goto(site.origin+'/event.html'+passLink.search+passLink.hash);
  await expect(pass.getByAltText('Single-use entry QR')).toBeVisible();expect(new URL(pass.url()).hash).toBe('');
  await expect(pass.locator('.qr')).toHaveCSS('background-color','rgb(255, 255, 255)');
  site.at('2026-11-27T19:15:00+05:30');
  const gate=await context.newPage();await staffLogin(gate,site,'gate');
  await expect(button(gate,'Settings')).toHaveCount(0);await gateAction(gate,'admit',code);
  await expect(gate.getByRole('dialog',{name:'Checked in'}).getByText('Seat 01',{exact:true})).toBeVisible();
  await button(gate,'Done').click();
  await expect(gate.getByRole('list',{name:'Player lookup'}).getByText('Seat 01',{exact:true})).toBeVisible();
  await gateAction(gate,'admit',code);await expect(heading(gate,'Already used')).toBeVisible();await expect(gate.getByText(/First scan/)).toBeVisible();await button(gate,'Done').click();
  await gateAction(gate,'exit',player.roll);await expect(gate.locator('#msg')).toContainText('Recorded outside');
  await gateAction(gate,'return',player.roll);await expect(gate.locator('#msg')).toContainText('Recorded inside');
  await pass.reload();await expect(heading(pass,'Pass already scanned')).toBeVisible();
  const floor=await context.newPage();await staffLogin(floor,site,'floor');floor.on('dialog',d=>d.accept());
  await button(floor,'Review next draw').click();await button(floor,'Start all tables').click();
  await floor.getByRole('button',{name:/^Enter result for Table 1/}).click();await floor.getByLabel('Sample Student').fill('10000');
  await button(floor,'Save table result').click();await expect(floor.locator('dialog')).not.toBeVisible();
  const board=await context.newPage();await board.goto(site.floor);await expect(heading(board,'Chip leaderboard')).toBeVisible();
  await expect(board.locator('#content')).not.toContainText(player.roll);await expect(board.locator('#content')).not.toContainText('Sample Student');
  await button(floor,'Close stage').click();await expect(button(floor,'Review next draw')).toBeVisible();
});

test('walk-in, a paid retry and offline gate sync honor the verified fee and headcount',async({page,context,site})=>{
  site.at('2026-11-27T19:30:00+05:30');await staffLogin(page,site,'desk');
  async function deskPay(kind,ref){
    await button(page,'Walk-in or paid retry').click();
    await page.getByLabel('College roll number').fill(player.roll);await page.getByLabel('Purchase').selectOption(kind);
    if(await page.locator('#deskBatch').isVisible())await page.getByLabel('Batch',{exact:true}).selectOption('2026-28');
    if(await page.locator('#deskPhone').isVisible())await page.getByLabel('Phone number',{exact:true}).fill('9876501234');
    await page.getByLabel('Full UPI bank reference').fill(ref);await page.getByLabel('I checked the college ID, the exact fee',{exact:false}).check();
    await button(page,'Approve and send code').click();
  }
  await deskPay('walk','111111116789');await expect(page.locator('dialog')).not.toBeVisible();
  const pass=site.mail.find(m=>m.subject.includes('entry'));expect(pass.body).toContain('₹199');
  await deskPay('retry','222222226789');await expect(page.locator('[data-error]')).toBeVisible();await button(page,'Close').click();
  await button(page,'Gate').click();await context.setOffline(true);
  await gateAction(page,'admit',pass.body.match(/PN-[A-Z0-9]{16}/)[0]);await expect(page.locator('#pending')).toContainText('1 unsynced');
  expect(site.calls).not.toContain('gateAction');await context.setOffline(false);
  await expect(page.locator('#pending')).toBeEmpty();await expect.poll(()=>site.calls.filter(v=>v==='gateAction').length).toBe(1);
  await expect(heading(page,'Checked in')).toBeVisible();await button(page,'Done').click();
  // The completed first qualifier supplies the state for the retry purchase.
  const paid=site.rows.Journal.map(r=>{try{return JSON.parse(r[3]).attempts?.[0]}catch{return null}}).filter(Boolean).at(-1);
  site.rows.Journal.push([site.now(),'Stage closed','Fixture floor',JSON.stringify({attempts:[{...paid,status:'ELIMINATED'}],game:{next:1,active:null,history:[]}})]);
  await button(page,'Payments').click();await button(page,'Refresh').click();await deskPay('retry','222222226789');
  await expect(page.locator('dialog')).not.toBeVisible();expect(site.mail.find(m=>m.subject.includes('retry')).body).toContain('₹149');
});

test('live floor recovers from a network error and reopens the last published snapshot',async({page,site})=>{
  await page.route(site.endpoint,route=>route.abort(),{times:1});await page.goto(site.floor);
  await button(page,'Retry live floor').click();await expect(page.locator('#clock')).toBeVisible();
  let release;const paused=new Promise(resolve=>{release=resolve});let reads=0;
  await page.route(site.endpoint,async route=>{reads++;await paused;await route.fallback()});
  await page.reload();await expect(page.locator('#clock')).toBeVisible();
  await page.evaluate(()=>{for(let n=0;n<3;n++)document.dispatchEvent(new Event('visibilitychange'))});
  expect(reads).toBe(1);release();await expect(page.locator('#net')).toBeEmpty();
});

test('lost registration response is retryable and a shared receipt opens only for its owner',async({page,context,site})=>{
  await studentLogin(page,site);await page.getByLabel('Batch',{exact:true}).selectOption('2026-28');let lost=true;
  await page.route(site.endpoint,async route=>{
    const body=route.request().postDataJSON();
    if(lost&&body.action==='playerStart'){lost=false;site.post(body);return route.abort()}
    return route.fallback();
  });
  await button(page,'Save my registration').click();await expect(page.locator('#msg')).toContainText('Could not reach');
  await button(page,'Save my registration').click();await expect(heading(page,'Registration saved')).toBeVisible();
  expect(site.rows.Journal.filter(r=>r[1]==='Registration saved')).toHaveLength(1);
  const receipt=await page.evaluate(()=>localStorage.getItem('pn26:receipt'));
  const remembered=await context.newPage();await remembered.goto(site.register);await expect(heading(remembered,'Registration saved')).toBeVisible();
  await button(remembered,'Sign out').click();await expect(page.getByLabel('Roll number or registered email')).toBeVisible();
  const another=await context.newPage();await another.goto(site.register+'#receipt='+encodeURIComponent(receipt));
  await another.getByLabel('Roll number or registered email').fill('second@example.test');await button(another,'Send code').click();
  await expect(another.getByLabel('Six-digit code')).toBeVisible();await enterCode(another,site.code('second@example.test'),'Verify and continue');
  await expect(button(another,'Save my registration')).toBeVisible();await expect(heading(another,'Registration saved')).toHaveCount(0);
  await button(another,'Sign out').click();site.advance(65000);const recovered=await context.newPage();await studentLogin(recovered,site);await expect(heading(recovered,'Registration saved')).toBeVisible();
});

test('a no-show frees a seat and the payment desk can offer it to a waitlisted player',async({page,context,site})=>{
  site.rows.Settings[1][1]='club@example';site.rows.Settings[2][1]='Sample Club';site.rows.Settings[5][1]='yes';
  const full=Array.from({length:216},(_,i)=>({id:i.toString(16).padStart(16,'0'),roll:String(300000000+i),wave:Math.floor(i/36),kind:'pre',fee:149,created:site.now(),used:false,status:'PAID'}));
  site.rows.Journal.push([site.now(),'Existing paid seats','Fixture',JSON.stringify({attempts:full})]);
  await studentLogin(page,site);await page.getByLabel('Batch',{exact:true}).selectOption('2026-28');await button(page,'Save my registration').click();await expect(heading(page,'On the waitlist')).toBeVisible();
  await expect(page.getByRole('link',{name:'Open UPI app'})).toHaveCount(0);
  const desk=await context.newPage();await staffLogin(desk,site,'desk');desk.on('dialog',d=>d.accept());
  await desk.getByLabel('Payment status',{exact:true}).selectOption('PAID');await desk.getByRole('button',{name:/^Open payment for /}).first().click();
  await button(desk,'Mark no-show').click();await expect(desk.locator('dialog')).not.toBeVisible();
  await desk.getByLabel('Payment status',{exact:true}).selectOption('WAITLIST');await desk.getByRole('button',{name:/^Open payment for /}).click();
  await button(desk,'Offer next available seat').click();await expect(desk.locator('dialog')).not.toBeVisible();
  await button(page,'Refresh status').click();await expect(heading(page,'Online UPI payments paused')).toBeVisible();
});

test('phone, tablet and desktop layouts fit, and a desk poll preserves an unsaved payment edit',async({page,site})=>{
  for(const width of [320,768,1366]){
    const scheme=width===768?'dark':'light';
    await page.emulateMedia({colorScheme:scheme,reducedMotion:'reduce'});
    await page.setViewportSize({width,height:844});await page.goto(site.origin);
    const hero=page.getByRole('region',{name:'Poké Poker Night',exact:true});
    await expect(hero.getByRole('heading',{name:'Poké Poker Night'})).toBeVisible();
    const wordmark=hero.getByRole('img',{name:'Poké Poker Night',exact:true});
    await expect(wordmark).toBeVisible();
    await expect.poll(()=>wordmark.evaluate(img=>img.complete&&img.naturalWidth>0)).toBe(true);
    await expect(hero.getByRole('link',{name:'Sign in to register'})).toBeInViewport({ratio:1});
    const navLinks=page.getByRole('navigation',{name:'Event',exact:true}).getByRole('link');
    const targets=await navLinks.evaluateAll(links=>links.map(link=>{const {width,height}=link.getBoundingClientRect();return {width,height}}));
    expect(targets.every(({width,height})=>width>=44&&height>=44)).toBe(true);
    const mark=page.getByAltText('Entrepreneurship Cell, IMT Ghaziabad');
    await expect(mark).toBeVisible();await expect.poll(()=>mark.evaluate(img=>img.naturalWidth)).toBeGreaterThan(100);
    const sponsors=page.getByRole('region',{name:'Sponsored by'});
    await sponsors.scrollIntoViewIfNeeded();
    await expect(sponsors.locator('img')).toHaveCount(5);
    await expect.poll(()=>sponsors.locator('img').evaluateAll(imgs=>imgs.every(img=>img.complete&&img.naturalWidth>0))).toBe(true);
    for(const surface of [page.locator('body'),sponsors]){
      const channels=await surface.evaluate(el=>getComputedStyle(el).backgroundColor.match(/\d+/g).slice(0,3).map(Number));
      if(scheme==='dark')expect(Math.max(...channels)).toBeLessThan(65);
      else expect(Math.min(...channels)).toBeGreaterThan(220);
    }
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await page.getByRole('link',{name:'Sign in to register'}).click();
    await expect(button(page,'Send code')).toBeVisible();
    await expect(mark).toBeVisible();
    await expect(page.getByRole('region',{name:'Sponsored by'})).toHaveCount(0);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  }
  await page.clock.install({time:new Date(site.now())});
  await staffLogin(page,site,'admin');await button(page,'Settings').click();
  await expect.poll(()=>page.getByAltText('Entrepreneurship Cell, IMT Ghaziabad').evaluate(img=>img.naturalWidth)).toBeGreaterThan(100);
  const field=page.getByLabel('Recipient name shown by the UPI app');await field.fill('Unsaved example');
  const reads=site.calls.filter(n=>n==='staffSnapshot').length;
  await page.clock.fastForward(16000);
  await expect.poll(()=>site.calls.filter(n=>n==='staffSnapshot').length).toBeGreaterThan(reads);
  await expect(field).toHaveValue('Unsaved example');await expect(field).toBeFocused();
});

test('the desk keeps payment review keyboard accessible and phone shortcuts within reach',async({page,site})=>{
  const add=(id,roll)=>site.rows.Journal.push([site.now(),'Proof submitted','Player',JSON.stringify({
    attempts:[{id,roll,kind:'pre',status:'REVIEW',wave:0,fee:site.staff('publicInfo',[]).offer.amount,suffix:id.slice(-4)}],note:id
  })]);
  add('1000000000000001',player.roll);
  await page.clock.install({time:new Date(site.now())});
  await page.setViewportSize({width:320,height:730});
  await staffLogin(page,site,'admin');
  const queue=page.getByRole('list',{name:'Payment queue'});
  const row=queue.getByRole('button',{name:'Open payment for Sample Student'});
  await expect(page.getByRole('navigation',{name:'Staff workspace'}).getByRole('button')).toHaveCount(5);
  await expect(button(page,'Walk-in or paid retry')).toBeInViewport({ratio:1});
  await expect(row).toBeInViewport({ratio:1});
  await button(page,'Review next payment').press('Enter');
  const dialog=page.getByRole('dialog',{name:'Sample Student'});
  await expect(dialog).toBeVisible();
  await button(page,'Approve and send code').click();
  await expect(page.getByLabel('Full UPI bank reference')).toBeFocused();
  await expect(dialog.getByRole('alert').filter({hasText:'12 digits'})).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(button(page,'Review next payment')).toBeFocused();

  await row.focus();
  site.rows.Students.push(['234000222','Asha Das','asha@example.test','']);
  add('1000000000000002','234000222');
  await page.clock.fastForward(16000);
  await expect(queue.getByRole('button')).toHaveCount(2);
  await expect(row).toBeFocused();
  await button(page,'Review next payment').click();
  await expect(dialog).toBeVisible();
  await button(page,'Close').click();
  await page.getByRole('searchbox',{name:'Search payments'}).fill('Asha');
  await button(page,'Gate').click();
  await expect(page.getByRole('searchbox',{name:'Find a player'})).toHaveValue('');
  await button(page,'Payments').click();
  await expect(page.getByRole('searchbox',{name:'Search payments'})).toHaveValue('Asha');
  await expect(queue.getByRole('button')).toHaveCount(1);
  await expect(queue.getByRole('button',{name:'Open payment for Asha Das'})).toBeVisible();
  for(const [width,scheme] of [[320,'light'],[768,'dark'],[1366,'light']]){
    await page.setViewportSize({width,height:820});await page.emulateMedia({colorScheme:scheme,reducedMotion:'reduce'});
    await expect(button(page,'Payments')).toHaveAttribute('aria-current','page');
    const sizes=await page.getByRole('navigation',{name:'Staff workspace'}).getByRole('button').evaluateAll(buttons=>buttons.map(b=>[b.offsetWidth,b.offsetHeight]));
    expect(sizes.every(([w,h])=>w>=44&&h>=44)).toBe(true);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  }
  await button(page,'Activity').click();
  await expect(page.getByRole('heading',{name:'Recent activity'})).toBeVisible();
  await expect(page.getByRole('main')).toContainText('Asha Das');
  await button(page,'Sign out').click();
  await expect(button(page,'Send code to club email')).toBeVisible();
  await expect(page.getByRole('navigation',{name:'Staff workspace'})).toHaveCount(0);
});

test('gate and floor volunteers land directly on their phone task and floor ties are resolved inline',async({context,page,site})=>{
  await page.setViewportSize({width:320,height:740});
  await staffLogin(page,site,'gate');
  await expect(heading(page,'Gate check-in')).toBeVisible();
  await expect(page.getByRole('navigation',{name:'Staff workspace'})).toHaveCount(0);
  await expect(page.getByRole('link',{name:/Scan entry QR/})).toBeInViewport({ratio:1});
  await expect(button(page,'Settings')).toHaveCount(0);

  site.at('2026-11-27T19:35:00+05:30');
  const ids=['0000000000000100','0000000000000200'],rolls=[player.roll,'234000223'];
  site.rows.Students.push([rolls[1],'Asha Nair','asha@example.test','']);
  const fee=site.staff('publicInfo',[]).offer.amount;
  const attempts=ids.map((id,i)=>({id,roll:rolls[i],kind:'pre',status:'PAID',fee,wave:0,used:true,seat:i+1,checkedInAt:site.now()}));
  site.rows.Journal.push([site.now(),'Stage started','Fixture floor',JSON.stringify({attempts,
    game:{next:0,history:[],active:{n:0,tables:[ids],tableNumbers:[1],started:site.now(),deadline:site.now()+1800000,winners:[],chips:{}}}
  })]);
  const floor=await context.newPage();await staffLogin(floor,site,'floor');
  await expect(heading(floor,'Tournament floor')).toBeVisible();
  await expect(floor.getByRole('navigation',{name:'Staff workspace'})).toHaveCount(0);
  await expect(floor.getByRole('timer')).toHaveText(/^(30:00|29:\d\d)$/);
  await button(floor,'Enter next result').click();
  const tie=floor.getByLabel('Witnessed tiebreak winner');
  await expect(tie).toBeHidden();
  await floor.getByLabel('Sample Student').fill('10000');await floor.getByLabel('Asha Nair').fill('10000');
  await expect(tie).toBeVisible();
  await button(floor,'Save table result').click();await expect(tie).toBeFocused();
  await tie.selectOption(ids[1]);await button(floor,'Save table result').click();
  await expect(floor.getByRole('dialog')).toHaveCount(0);
  await expect(button(floor,'Close stage')).toBeVisible();
  await floor.getByRole('button',{name:/^Edit result for Table 1/}).click();
  await expect(tie).toHaveValue(ids[1]);
});

test('the same edition reaches the public site and private gate in light and dark mode',async({page,site})=>{
  async function checkTheme(mastSelector,artSelector,action){
    const mast=page.locator(mastSelector),art=page.locator(artSelector);
    await expect(art).toHaveAccessibleName('Poké Poker Night');
    await expect.poll(()=>art.evaluate(img=>img.complete&&img.naturalWidth>0)).toBe(true);
    const stripe=await mast.evaluate(el=>getComputedStyle(el,'::after').backgroundImage);
    for(const color of ['rgb(197, 40, 61)','rgb(22, 70, 134)','rgb(255, 203, 5)'])expect(stripe).toContain(color);
    if(action){
      await expect(action).toHaveCSS('background-color','rgb(255, 203, 5)');
      await expect(action).toHaveCSS('color','rgb(16, 41, 78)');
      expect((await action.boundingBox()).height).toBeGreaterThanOrEqual(44);
    }
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  }
  for(const [scheme,width] of [['light',1280],['dark',320]]){
    await page.setViewportSize({width,height:800});await page.emulateMedia({colorScheme:scheme});
    await page.goto(site.origin);await checkTheme('.home-mast','.hero-wordmark',page.getByRole('link',{name:'Sign in to register'}));
    await page.goto(site.register);await checkTheme('.top','.appbar .event-wordmark',button(page,'Send code'));
    await page.goto(site.floor);await expect(page.locator('#clock')).toBeVisible();await checkTheme('.top','.event-wordmark');
    await staffLogin(page,site,'gate');await checkTheme('.top','.appbar .event-wordmark',page.getByRole('link',{name:/Scan entry QR/}));
    await button(page,'Sign out').click();
    await page.goto(site.origin+'/club?view=staff');await expect(heading(page,'Page unavailable')).toBeVisible();
    await checkTheme('.top','.event-wordmark',page.getByRole('link',{name:'Return to event home'}));
    await expect(page.locator('#deskNav')).toHaveCount(0);
  }
});
