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
  expect(site.calls).toEqual([]);release();
  await expect(page.getByLabel('Six-digit code')).toBeVisible();
  expect(site.calls).toEqual(['requestPlayerCode']);
  await enterCode(page,site.code(player.email),'Verify and continue');
  await expect(button(page,'Save my registration')).toBeVisible();
  expect(site.calls).toEqual(['requestPlayerCode','signInPlayer']);
  await button(page,'Save my registration').dblclick();
  await expect(heading(page,'Registration saved')).toBeVisible();
  expect(site.rows.Journal.filter(r=>r[1]==='Registration saved')).toHaveLength(1);
  await page.reload();await expect(heading(page,'Registration saved')).toBeVisible();
  await button(page,'Sign out').click();await expect(identifier).toBeVisible();
});

test('mail failure, mismatched details, cooldown and delayed email can all be recovered',async({page,site})=>{
  site.mailFailure(true);await page.goto(site.register);
  await page.getByLabel('Roll number or registered email').fill(player.email);await button(page,'Send code').click();
  await expect(page.getByRole('status').filter({hasText:'Email delivery is temporarily unavailable'})).toBeVisible();
  expect(site.mail).toHaveLength(0);site.mailFailure(false);await button(page,'Send code').click();
  await expect(page.getByLabel('Six-digit code')).toBeVisible();const original=site.code(player.email);
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

test('owner publishes a payment QR, checks proof and issues a single-use pass; gate and floor share the result',async({context,page,site})=>{
  const admin=await context.newPage();await staffLogin(admin,site,'admin');
  await button(admin,'Settings').click();await admin.getByLabel('Recipient name shown by the UPI app').fill('Example Club');
  await admin.getByLabel('Upload payment QR').setInputFiles(png);await admin.getByLabel('Publish payment details to players').check();
  await button(admin,'Save payment settings').click();await expect(button(admin,'Preview saved QR')).toBeVisible();
  await studentLogin(page,site);await button(page,'Request a seat').click();await expect(heading(page,'Pay ₹149')).toBeVisible();
  await expect(page.getByAltText('Coordinator’s UPI payment QR')).toBeVisible();
  await page.getByLabel('Payment screenshot').setInputFiles(png);await page.getByLabel('Visible final digits',{exact:false}).fill('6789');
  await page.getByLabel('I agree to share',{exact:false}).check();await button(page,'Submit for review').click();
  await expect(heading(page,'Payment under review')).toBeVisible();
  await button(admin,'Review').click();await button(admin,'Refresh').click();await button(admin,'Open attempt').click();
  await button(admin,'View private screenshot').click();await expect(admin.getByAltText('Private payment screenshot')).toBeVisible();
  await admin.getByLabel('Full UPI bank reference').fill('123456786789');await admin.getByLabel('I checked the incoming credit',{exact:false}).check();
  await button(admin,'Approve and send code').click();await expect(admin.locator('dialog')).not.toBeVisible();
  await button(page,'Refresh status').click();await expect(heading(page,'Payment verified')).toBeVisible();
  const passMail=site.mail.find(m=>m.to===player.email&&m.subject.includes('entry'));
  const passLink=new URL(passMail.body.match(/https:\/\/\S+/)[0]);expect(passLink.hostname).toBe('meherpraveen.github.io');
  const code=new URLSearchParams(passLink.hash.slice(1)).get('code'),pass=await context.newPage();
  await pass.goto(site.origin+'/event.html'+passLink.search+passLink.hash);
  await expect(pass.getByAltText('Single-use entry QR')).toBeVisible();expect(new URL(pass.url()).hash).toBe('');
  site.at('2026-11-27T19:15:00+05:30');
  const gate=await context.newPage();await staffLogin(gate,site,'gate');
  await expect(button(gate,'Settings')).toHaveCount(0);await gateAction(gate,'admit',code);
  await expect(gate.locator('#msg')).toContainText('Recorded inside');
  await gateAction(gate,'admit',code);await expect(gate.locator('#msg')).toContainText('spent');
  await gateAction(gate,'exit',player.roll);await expect(gate.locator('#msg')).toContainText('Recorded outside');
  await gateAction(gate,'return',player.roll);await expect(gate.locator('#msg')).toContainText('Recorded inside');
  await pass.reload();await expect(heading(pass,'Pass already scanned')).toBeVisible();
  const floor=await context.newPage();await staffLogin(floor,site,'floor');floor.on('dialog',d=>d.accept());
  await button(floor,'Review next draw').click();await button(floor,'Start all tables').click();
  await floor.getByRole('button',{name:/Enter 1/}).click();await floor.getByLabel('Sample Student').fill('10000');
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
  // The completed first qualifier supplies the state for the retry purchase.
  const paid=site.rows.Journal.map(r=>{try{return JSON.parse(r[3]).attempts?.[0]}catch{return null}}).filter(Boolean).at(-1);
  site.rows.Journal.push([site.now(),'Stage closed','Fixture floor',JSON.stringify({attempts:[{...paid,status:'ELIMINATED'}],game:{next:1,active:null,history:[]}})]);
  await button(page,'Review').click();await button(page,'Refresh').click();await deskPay('retry','222222226789');
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
  await studentLogin(page,site);let lost=true;
  await page.route(site.endpoint,async route=>{
    const body=route.request().postDataJSON();
    if(lost&&body.action==='playerStart'){lost=false;site.post(body);return route.abort()}
    return route.fallback();
  });
  await button(page,'Save my registration').click();await expect(page.locator('#msg')).toContainText('Could not reach');
  await button(page,'Save my registration').click();await expect(heading(page,'Registration saved')).toBeVisible();
  expect(site.rows.Journal.filter(r=>r[1]==='Registration saved')).toHaveLength(1);
  const receipt=await page.evaluate(()=>localStorage.getItem('pn26:receipt'));
  const another=await context.newPage();await another.goto(site.register+'#receipt='+encodeURIComponent(receipt));
  await another.getByLabel('Roll number or registered email').fill('second@example.test');await button(another,'Send code').click();
  await expect(another.getByLabel('Six-digit code')).toBeVisible();await enterCode(another,site.code('second@example.test'),'Verify and continue');
  await expect(button(another,'Save my registration')).toBeVisible();await expect(heading(another,'Registration saved')).toHaveCount(0);
  site.advance(65000);const recovered=await context.newPage();await studentLogin(recovered,site);await expect(heading(recovered,'Registration saved')).toBeVisible();
});

test('a no-show frees a seat and the payment desk can offer it to a waitlisted player',async({page,context,site})=>{
  site.rows.Settings[1][1]='club@example';site.rows.Settings[2][1]='Sample Club';site.rows.Settings[5][1]='yes';
  const full=Array.from({length:216},(_,i)=>({id:i.toString(16).padStart(16,'0'),roll:String(300000000+i),wave:Math.floor(i/36),kind:'pre',fee:149,created:site.now(),used:false,status:'PAID'}));
  site.rows.Journal.push([site.now(),'Existing paid seats','Fixture',JSON.stringify({attempts:full})]);
  await studentLogin(page,site);await button(page,'Request a seat').click();await expect(heading(page,'On the waitlist')).toBeVisible();
  await expect(page.getByRole('link',{name:'Open UPI app'})).toHaveCount(0);
  const desk=await context.newPage();await staffLogin(desk,site,'desk');desk.on('dialog',d=>d.accept());
  await desk.getByLabel('Show',{exact:true}).selectOption('PAID');await button(desk,'Open attempt').first().click();
  await button(desk,'Mark no-show').click();await expect(desk.locator('dialog')).not.toBeVisible();
  await desk.getByLabel('Show',{exact:true}).selectOption('WAITLIST');await button(desk,'Open attempt').click();
  await button(desk,'Offer next available seat').click();await expect(desk.locator('dialog')).not.toBeVisible();
  await button(page,'Refresh status').click();await expect(heading(page,'Pay ₹149')).toBeVisible();
});

test('phone, tablet and desktop layouts fit, and a desk poll preserves an unsaved payment edit',async({page,site})=>{
  for(const width of [320,768,1366]){
    await page.setViewportSize({width,height:844});await page.goto(site.origin);
    const art=await page.locator('.art').evaluate(element=>getComputedStyle(element).backgroundImage);
    expect(art).toContain(width<=720?'table-art-mobile.webp':'table-art.webp');
    await page.getByRole('link',{name:'Sign in to register'}).click();
    await expect(button(page,'Send code')).toBeVisible();
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  }
  await page.clock.install({time:new Date(site.now())});
  await staffLogin(page,site,'admin');await button(page,'Settings').click();
  const field=page.getByLabel('Recipient name shown by the UPI app');await field.fill('Unsaved example');
  const reads=site.calls.filter(n=>n==='staffSnapshot').length;
  await page.clock.fastForward(16000);
  await expect.poll(()=>site.calls.filter(n=>n==='staffSnapshot').length).toBeGreaterThan(reads);
  await expect(field).toHaveValue('Unsaved example');await expect(field).toBeFocused();
});
