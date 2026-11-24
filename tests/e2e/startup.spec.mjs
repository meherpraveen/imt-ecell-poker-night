import {test,expect} from './site.mjs';
import {player} from './event-runtime.mjs';

test.describe('cold mobile assets',()=>{
  test.use({viewport:{width:390,height:844},deviceScaleFactor:2});
  test('the selected wordmarks and anonymous runtime stay within their size budgets',async({page,request,site})=>{
    async function imageSize(selector){
      const image=page.locator(selector);
      await expect.poll(()=>image.evaluate(node=>node.complete&&node.naturalWidth>0)).toBe(true);
      const response=await request.get(await image.evaluate(node=>node.currentSrc));
      expect(response.ok()).toBe(true);
      return (await response.body()).length;
    }
    await page.goto(site.origin);
    expect(await imageSize('.hero-wordmark')).toBeLessThan(58*1024);
    await page.getByRole('link',{name:'Sign in to register'}).click();
    expect(await imageSize('.appbar .event-wordmark')).toBeLessThan(14*1024);
    const runtime=await request.get(await page.locator('#event-runtime').evaluate(node=>node.src));
    expect(runtime.ok()).toBe(true);
    expect((await runtime.body()).length).toBeLessThan(32*1024);
  });
});

test('retrying a failed startup keeps the typed identifier and sends exactly one sign-in email',async({page,site})=>{
  let failDownload;
  const held=new Promise(resolve=>{failDownload=resolve});
  await page.route('**/assets/event-app.js*',async route=>{await held;await route.abort()},{times:1});
  await page.goto(site.register,{waitUntil:'commit'});
  const field=page.getByLabel('Roll number or registered email');
  await field.fill(player.email);
  await field.press('Enter');
  await expect(page.getByRole('button',{name:'Sending code…'})).toBeDisabled();
  failDownload();
  const retry=page.getByRole('button',{name:'Retry loading'});
  await expect(retry).toBeEnabled();
  await expect(field).toHaveValue(player.email);
  expect(site.mail).toHaveLength(0);
  await retry.click();
  await expect(page.getByLabel('Six-digit code')).toBeVisible();
  expect(site.mail).toHaveLength(1);
  expect(site.calls.filter(action=>action==='requestEventCode')).toHaveLength(1);
});

test('a student can retry the account download after verification without signing in twice',async({page,site})=>{
  await page.route('**/assets/player-account.js*',route=>route.abort(),{times:1});
  await page.goto(site.register);
  await page.getByLabel('Roll number or registered email').fill(player.roll);
  await page.getByRole('button',{name:'Send code',exact:true}).click();
  await expect(page.getByLabel('Six-digit code')).toBeVisible();
  await page.getByLabel('Six-digit code').fill(site.code(player.email));
  await page.getByRole('button',{name:'Verify and continue'}).click();
  await expect(page.locator('#msg')).toContainText('could not load');
  await page.getByRole('button',{name:'Open registration'}).click();
  await expect(page.getByLabel('PGP ID',{exact:true})).toHaveValue(player.roll);
  expect(site.calls.filter(action=>action==='signInEvent')).toHaveLength(1);
  expect(site.mail).toHaveLength(1);
});

test('the saved email step paints correctly before scripts when persistent storage is blocked',async({page,site})=>{
  await page.addInitScript(email=>{
    Object.defineProperty(window,'localStorage',{get(){throw new DOMException('Storage blocked','SecurityError')}});
    sessionStorage.setItem('pn26:email-step',JSON.stringify({identifier:email,expires:Date.now()+600000,resendAt:0}));
  },player.email);
  let release;
  const held=new Promise(resolve=>{release=resolve});
  await page.route('**/assets/event-app.js*',async route=>{await held;await route.continue()});
  await page.goto(site.register,{waitUntil:'commit'});
  try{
    await expect(page.getByRole('heading',{name:'Check your email'})).toBeVisible();
    await expect(page.getByLabel('Roll number or registered email')).toBeHidden();
  }finally{release()}
  await expect(page.getByLabel('Six-digit code')).toBeVisible();
  expect(site.calls).toEqual([]);
});

test('floor data starts before the runtime, and public navigation skips account and checkout downloads',async({page,site})=>{
  let release;
  const held=new Promise(resolve=>{release=resolve}),requests=[];
  page.on('request',request=>requests.push(request.url()));
  await page.route('**/assets/event-app.js*',async route=>{await held;await route.continue()},{times:1});
  await page.goto(site.floor,{waitUntil:'commit'});
  try{
    await expect(page.getByRole('heading',{name:'Tournament floor'})).toBeVisible();
    await expect.poll(()=>site.calls.filter(action=>action==='liveFloor').length).toBe(1);
    expect(await page.evaluate(()=>window.pokerReady)).toBeUndefined();
  }finally{release()}
  await expect(page.locator('#clock')).toBeVisible();
  expect(site.calls.filter(action=>action==='liveFloor')).toHaveLength(1);
  await page.getByRole('navigation',{name:'Event pages'}).getByRole('link',{name:'Registration'}).click();
  await expect(page.getByLabel('Roll number or registered email')).toBeVisible();
  await page.getByRole('navigation',{name:'Event pages'}).getByRole('link',{name:'Live floor'}).click();
  await expect(page.locator('#clock')).toBeVisible();
  await page.goBack();
  await expect(page.getByRole('button',{name:'Send code',exact:true})).toBeVisible();
  expect(requests.some(url=>/\/assets\/(?:player-account|payment-form|qrcode-|gate-camera|jsQR)/.test(url))).toBe(false);
});
