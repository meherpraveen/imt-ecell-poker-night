import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';

const domain=readFileSync(new URL('../../docs/CNAME',import.meta.url),'utf8').trim();
const site=process.env.POKER_PUBLIC_SITE||'https://'+domain+'/';
test('the published Apps Script registration renders inside the Google host @deployed',async({page})=>{
  test.setTimeout(90000);
  const config=readFileSync(new URL('../../web/config.js',import.meta.url),'utf8');
  const url=new URL(config.match(/https:\/\/script\.google\.com\/[^'"]+\/exec/)[0]);
  url.searchParams.set('view','register');
  await page.goto(url.href,{waitUntil:'domcontentloaded'});
  let app;
  await expect.poll(async()=>{
    for(const frame of page.frames()){
      if(await frame.locator('body[data-mode="register"]').count()){app=frame;return true}
    }
    return false;
  },{timeout:40000}).toBe(true);
  await expect(app.getByRole('link',{name:'Poké Poker Night home'})).toHaveAttribute('href','https://'+domain+'/');
  await expect(app.locator('.offer .price-values strong')).toHaveText(/^₹[\d,]+$/,{timeout:40000});
  await app.getByLabel('Roll number or registered email').fill('invalid');
  await app.getByRole('button',{name:'Send code',exact:true}).click();
  await expect(app.locator('#identifierError')).toContainText('nine-digit');
});

test('published navigation, mobile startup, live floor and backend validation @deployed',async({page})=>{
  test.setTimeout(110000);
  const errors=[],actions=[];
  page.on('pageerror',e=>errors.push(e.message));
  page.on('request',req=>{if(req.method()==='POST'&&req.url().startsWith('https://script.google.com/macros/'))actions.push(req.postDataJSON().action)});
  await page.addInitScript(()=>{window.layoutShift=0;new PerformanceObserver(list=>{for(const entry of list.getEntries())if(!entry.hadRecentInput)window.layoutShift+=entry.value}).observe({type:'layout-shift',buffered:true})});
  await page.goto(site);await expect(page.getByRole('link',{name:'Sign in to register'})).toBeVisible();
  const clubLogo=page.getByAltText('Entrepreneurship Cell, IMT Ghaziabad');
  await expect(clubLogo).toBeVisible();await expect.poll(()=>clubLogo.evaluate(img=>img.naturalWidth)).toBeGreaterThan(100);
  const hero=page.getByRole('region',{name:'Poké Poker Night',exact:true});
  await expect(hero.getByRole('heading',{name:'Poké Poker Night'})).toBeVisible();
  const wordmark=hero.getByRole('img',{name:'Poké Poker Night',exact:true});
  await expect(wordmark).toBeVisible();
  await expect.poll(()=>wordmark.evaluate(img=>img.complete&&img.naturalWidth>0)).toBe(true);
  await expect(hero.getByRole('link',{name:'Sign in to register'})).toBeInViewport({ratio:1});
  await expect(hero.locator('[data-home-fee=entry]')).toHaveText(/^₹[\d,]+$/,{timeout:40000});
  const sponsors=page.getByRole('region',{name:'Sponsored by'});await sponsors.scrollIntoViewIfNeeded();
  await expect(sponsors.locator('img')).toHaveCount(5);
  await expect.poll(()=>sponsors.locator('img').evaluateAll(imgs=>imgs.every(img=>img.complete&&img.naturalWidth>0))).toBe(true);
  await expect(page.locator('a[href*="view=staff"]')).toHaveCount(0);
  await page.getByRole('link',{name:'Sign in to register'}).click();
  await expect(page.getByLabel('Roll number or registered email')).toBeVisible();
  await expect(page.getByRole('heading',{name:'Email sign-in'})).toBeVisible();
  await page.waitForFunction(()=>window.pokerReady===true);
  await expect(page.locator('.offer .price-values strong')).toHaveText(/^₹[\d,]+/);
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  expect(actions).toEqual(['publicPrices']);
  const metrics=await page.evaluate(()=>({domContentLoadedMs:Math.round(performance.getEntriesByType('navigation')[0].domContentLoadedEventEnd),initialLayoutShift:window.layoutShift,horizontalOverflow:document.documentElement.scrollWidth>innerWidth,
    startupAssets:performance.getEntriesByType('resource').filter(r=>/\/assets\/[^/?]+\.(js|css)(\?|$)/.test(r.name)).length}));
  console.log('Published mobile registration',JSON.stringify(metrics));
  expect(metrics.horizontalOverflow).toBe(false);expect(metrics.initialLayoutShift).toBeLessThan(0.05);expect(metrics.startupAssets).toBe(2);
  // Empty identifiers validate the deployed account routes before a directory read or an email send.
  const validation=await page.evaluate(()=>Promise.all([
    api('requestEventCode','').catch(e=>e.message),api('signInEvent','','','').catch(e=>e.message)
  ]));
  for(const message of validation)expect(message).toContain('nine-digit roll number');
  const guarded=await page.evaluate(()=>Promise.all([api('playerSaveDetails','','','{}').catch(e=>e.message),api('playerSubmitPayment','','','','{}').catch(e=>e.message),api('playerSelectReceiver','','','','0').catch(e=>e.message)]));
  for(const message of guarded)expect(message).toContain('Sign in with your registered email');
  await page.getByLabel('Roll number or registered email').fill('invalid');
  await page.getByRole('button',{name:'Send code',exact:true}).click();await expect(page.locator('#identifierError')).toContainText('nine-digit');
  await page.reload();await expect(page.getByLabel('Roll number or registered email')).toHaveValue('invalid');
  // Resume the public code-entry screen with device state. This checks the live UI without sending mail.
  await page.evaluate(()=>localStorage.setItem('pn26:email-step',JSON.stringify({identifier:'preview@example.invalid',resendAt:Date.now()+60000,expires:Date.now()+600000})));
  await page.reload();const junk=page.getByRole('link',{name:'Open Outlook Junk Email'});
  await expect(junk).toBeVisible();await expect(junk).toHaveAttribute('href','https://outlook.office.com/mail/junkemail');
  await expect(page.getByText('Student sign-in is saved on this device for 30 days.')).toBeVisible();
  await page.goto(site+'event.html?view=board');await expect(page.locator('#clock')).toBeVisible({timeout:35000});
  await expect(page.getByRole('region',{name:'Sponsored by'})).toBeVisible();
  await expect(page.locator('#content h2').first()).toBeVisible();
  const settings=await page.evaluate(()=>api('publicInfo'));expect(typeof settings.open).toBe('boolean');
  await page.goto(site+'event.html?view=pass');await expect(page.locator('#msg')).toContainText('complete pass link');
  await page.goto(site+'event.html?view=staff');await expect(page.getByRole('heading',{name:'Page unavailable'})).toBeVisible();
  expect(actions.every(a=>['publicPrices','publicInfo','liveFloor','requestEventCode','signInEvent','playerSaveDetails','playerSubmitPayment','playerSelectReceiver'].includes(a))).toBe(true);expect(errors).toEqual([]);
});

test('published pages, checkout module and camera assets match the release build @deployed',async({request})=>{
  const docs=new URL('../../docs/',import.meta.url);
  const read=name=>readFileSync(new URL(name,docs),'utf8').replace(/\r\n/g,'\n');
  const refs=source=>source.match(/assets\/[\w.-]+\.(?:js|css)\?v=[a-f0-9]{12}/g)||[];
  const assets=new Set();
  for(const file of ['index.html','event.html']){
    const expected=refs(read(file));expect(expected.length).toBeGreaterThan(0);
    const live=await request.get(new URL(file,site).href);
    expect(live.ok()).toBe(true);
    const html=(await live.text()).replace(/\r\n/g,'\n');
    expect(createHash('sha256').update(html).digest('hex'),file).toBe(createHash('sha256').update(read(file)).digest('hex'));
    for(const asset of expected)assets.add(asset);
  }
  for(const asset of refs(read('assets/event-app.js')))assets.add(asset);
  for(const name of ['player-account.js','payment-form.js','gate-camera.js'])expect([...assets].some(url=>url.includes('/'+name+'?v='))).toBe(true);
  assets.add('assets/jsQR-1.4.0.js');assets.add('assets/qrcode-1.4.4.js');
  await Promise.all([...assets].map(async asset=>{
    const live=await request.get(new URL(asset,site).href);expect(live.ok(),asset).toBe(true);
    const content=(await live.text()).replace(/\r\n/g,'\n'),[file,version]=asset.split('?v=');
    const digest=text=>createHash('sha256').update(text).digest('hex');
    expect(digest(content),file).toBe(digest(read(file)));
    if(version)expect(digest(content).slice(0,12),file).toBe(version);
  }));
  const imageRefs=new Set([read('index.html'),read('event.html')].flatMap(page=>page.match(/assets\/[\w.-]+\.(?:webp|png|avif)/g)||[]));
  for(const asset of imageRefs){
    const response=await request.get(new URL(asset,site).href);
    expect(response.ok(),asset).toBe(true);
    expect((await response.body()).equals(readFileSync(new URL(asset,docs))),asset).toBe(true);
  }
});
