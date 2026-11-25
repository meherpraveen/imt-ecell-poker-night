import {test,expect} from './site.mjs';
import {player,owner} from './event-runtime.mjs';
import {club,jpegQr,receiptText} from '../payment-fixtures.mjs';

test.use({studentSignIn:'directory'});
const button=(page,name)=>page.getByRole('button',{name,exact:true});
async function details(page){
  await page.getByLabel('College roll number',{exact:true}).fill(player.roll);
  await page.getByLabel('College email',{exact:true}).fill(player.email);
}

test('temporary sign-in works with mail offline, submits proof and resumes the same registration',async({page,context,site})=>{
  const api=club(site);api.makeReceiver();const initialMail=site.mail.length;site.mailFailure(true);
  let release;const held=new Promise(resolve=>{release=resolve});
  await page.route('**/assets/event-app.js*',async route=>{await held;await route.continue()},{times:1});
  await page.goto(site.register,{waitUntil:'commit'});
  await details(page);await page.getByLabel('College email',{exact:true}).press('Enter');
  await expect(button(page,'Signing in…')).toBeDisabled();expect(site.calls.filter(c=>c==='signInWithStudentDetails')).toHaveLength(0);release();
  await expect(page.getByLabel('PGP ID',{exact:true})).toHaveValue(player.roll);
  await page.getByLabel('Batch',{exact:true}).selectOption('2026-28');await button(page,'Continue to payment').click();
  site.ocr(receiptText());await page.getByLabel('Payment screenshot').setInputFiles({name:'synthetic.jpg',mimeType:'image/jpeg',buffer:jpegQr()});
  await button(page,'Submit screenshot').click();await expect(page.getByRole('heading',{name:'Payment pending'})).toBeVisible();
  const ids=Object.keys(site.staff('ledger_',[]).attempts);expect(ids).toHaveLength(1);
  const saved=site.staff('ledger_',[]).attempts[ids[0]];
  await button(page,'Sign out').click();await expect(page.getByRole('heading',{name:'Student sign-in'})).toBeVisible();
  await details(page);await button(page,'Sign in').click();await expect(page.getByRole('heading',{name:'Payment pending'})).toBeVisible();
  expect(Object.keys(site.staff('ledger_',[]).attempts)).toEqual(ids);expect(site.staff('ledger_',[]).attempts[ids[0]].file).toBe(saved.file);
  const returning=await context.newPage();await returning.goto(site.register);await expect(returning.getByRole('heading',{name:'Payment pending'})).toBeVisible();
  expect(site.mail.length).toBe(initialMail);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

test('mismatched details are rejected without sending mail or exposing another account',async({page,site})=>{
  await page.goto(site.register);await details(page);await page.getByLabel('College email',{exact:true}).fill('second@example.test');
  await button(page,'Sign in').click();await expect(page.locator('#msg')).toContainText('match one student record');
  await expect(page.getByLabel('College roll number',{exact:true})).toHaveValue(player.roll);expect(site.mail).toHaveLength(0);
  await page.getByLabel('College email',{exact:true}).fill(player.email.toUpperCase());await button(page,'Sign in').click();
  await expect(page.getByLabel('PGP ID',{exact:true})).toHaveValue(player.roll);expect(site.mail).toHaveLength(0);
});

test('an old saved code step opens the temporary form immediately and needs no email bundle',async({page,site})=>{
  await page.addInitScript(email=>localStorage.setItem('pn26:email-step',JSON.stringify({identifier:email,expires:Date.now()+600000,resendAt:0})),player.email);
  let release;const held=new Promise(resolve=>{release=resolve}),requests=[];
  page.on('request',request=>requests.push(request.url()));
  await page.route('**/assets/event-app.js*',async route=>{await held;await route.continue()},{times:1});
  await page.goto(site.register,{waitUntil:'commit'});
  try{await expect(page.getByRole('heading',{name:'Student sign-in'})).toBeVisible();await expect(page.getByLabel('College email',{exact:true})).toBeVisible()}
  finally{release()}
  await page.waitForFunction(()=>window.pokerReady);expect(await page.evaluate(()=>localStorage.getItem('pn26:email-step'))).toBe(null);
  expect(requests.some(url=>url.includes('/email-code.js'))).toBe(false);expect(site.mail).toHaveLength(0);
});

test('retrying a failed runtime preserves both typed identifiers and submits once',async({page,site})=>{
  let fail;const held=new Promise(resolve=>{fail=resolve});
  await page.route('**/assets/event-app.js*',async route=>{await held;await route.abort()},{times:1});
  await page.goto(site.register,{waitUntil:'commit'});await details(page);await button(page,'Sign in').click();fail();
  await expect(button(page,'Retry loading')).toBeEnabled();await button(page,'Retry loading').click();
  await expect(page.getByLabel('PGP ID',{exact:true})).toHaveValue(player.roll);
  expect(site.calls.filter(c=>c==='signInWithStudentDetails')).toHaveLength(1);expect(site.mail).toHaveLength(0);
});

test('a lost sign-in response retries the same session and account download can recover',async({page,site})=>{
  let firstToken;
  await page.goto(site.register);await details(page);
  await page.route(site.endpoint,async route=>{
    const body=route.request().postDataJSON();if(body.action!=='signInWithStudentDetails')return route.fallback();
    if(firstToken)return route.fallback();firstToken=site.post(body).value.session.token;await route.abort();
  });
  await button(page,'Sign in').click();await expect(page.locator('#msg')).toContainText('Could not reach');
  await page.route('**/assets/player-account.js*',route=>route.abort(),{times:1});await button(page,'Sign in').click();
  await expect(page.locator('#msg')).toContainText('could not load');await button(page,'Open registration').click();
  await expect(page.getByLabel('PGP ID',{exact:true})).toHaveValue(player.roll);
  expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('pn26:player-login')).token)).toBe(firstToken);expect(site.mail).toHaveLength(0);
});

test('the club account still requires its email code from the temporary student page',async({page,site})=>{
  await page.goto(site.register);await button(page,'Club account sign-in').click();
  await page.getByLabel('Roll number or registered email').fill(owner);await button(page,'Send code').click();
  await expect(page.getByLabel('Six-digit code')).toBeVisible();expect(site.mail).toHaveLength(1);
  await page.reload();await expect(page.getByLabel('Six-digit code')).toBeVisible();
  await page.getByLabel('Six-digit code').fill(site.code(owner));await button(page,'Verify and continue').click();
  await expect(page.getByRole('heading',{name:'Payments',exact:true})).toBeVisible();
});

test('the Google-hosted registration uses the same directory login when mail is unavailable',async({page,site})=>{
  site.mailFailure(true);await page.goto(site.origin+'/club?view=register');await details(page);
  await button(page,'Sign in').click();await expect(page.getByLabel('PGP ID',{exact:true})).toHaveValue(player.roll);
  expect(site.mail).toHaveLength(0);
});

test('cached email-only HTML opens the new student form with the current runtime',async({page,site})=>{
  await page.route('**/event.html?view=register',async route=>{
    const response=await route.fetch(),html=(await response.text())
      .replace(' data-student-sign-in="directory"','')
      .replace(/<div class="narrow login-card student-directory"[\s\S]*?<\/section><\/div>/,'');
    await route.fulfill({response,body:html});
  });
  await page.goto(site.register);await details(page);await button(page,'Sign in').click();
  await expect(page.getByLabel('PGP ID',{exact:true})).toHaveValue(player.roll);expect(site.mail).toHaveLength(0);
});
