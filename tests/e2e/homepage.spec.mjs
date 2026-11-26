import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {test,expect} from './site.mjs';

const config=readFileSync(new URL('../../gas/Pricing.gs',import.meta.url),'utf8');
const pricing=runInNewContext(config+'\nENTRY_PRICING');
const format=amount=>new Intl.NumberFormat('en-IN',{style:'currency',currency:pricing.currency,maximumFractionDigits:0}).format(amount);

test('a cached quote from the previous deadline is discarded on the updated site',async({page,site})=>{
  site.at('2026-11-27T16:00:00+05:30');
  await page.clock.install({time:new Date('2026-11-27T16:00:00+05:30')});
  await page.addInitScript(()=>sessionStorage.setItem('pn26:public-entry-quote',JSON.stringify({
    received:Date.now(),offer:{now:Date.now(),amount:149,standard:199,retry:149,currency:'INR',early:true,endsAt:Date.parse('2026-11-27T19:00:00+05:30')}
  })));
  await page.goto(site.origin);
  await expect(page.locator('[data-home-fee=entry]')).toHaveText(format(pricing.standard));
  expect(site.calls.filter(name=>name==='publicPrices')).toHaveLength(1);
});

test('the homepage updates both entry quotes at the cutoff and keeps its event links usable',async({page,site})=>{
  site.at(new Date(Date.parse(pricing.earlyBirdEndsAt)-3000).toISOString());
  await page.clock.install({time:new Date(Date.parse(pricing.earlyBirdEndsAt)-3000)});
  await page.clock.pauseAt(new Date(Date.parse(pricing.earlyBirdEndsAt)-2000));
  await page.goto(site.origin);
  const hero=page.getByRole('region',{name:'Poké Poker Night',exact:true});
  const details=page.getByRole('region',{name:'Entry details'});
  await expect(hero.getByText('prizes worth ₹1 lakh',{exact:true})).toBeVisible();
  await expect(page.locator('#format')).toContainText('wins the tournament');
  await expect(hero.locator('[data-home-fee=entry]')).toHaveText(format(pricing.earlyBird));
  await expect(hero.locator('s')).toHaveText('Standard price '+format(pricing.standard));
  await expect(details.locator('.price-time')).toContainText('left');
  await expect(details.locator('[data-home-fee=retry]')).toHaveText(format(pricing.retry));
  await expect(hero.locator('[data-home-countdown]')).toBeVisible();
  await expect(hero.getByRole('timer')).toHaveText('00h 00m 03s');
  site.advance(1000);await page.clock.fastForward(1000);
  await expect(hero.getByRole('timer')).toHaveText('00h 00m 02s');
  expect(site.calls.filter(name=>name==='publicPrices')).toHaveLength(1);
  site.advance(4000);await page.clock.fastForward(4000);
  await expect(hero.locator('[data-home-countdown]')).toBeHidden();
  await expect(hero.locator('[data-home-fee=entry]')).toHaveText(format(pricing.standard));
  await expect(hero.locator('s')).toBeHidden();
  await expect(details.locator('.price-values strong')).toHaveText(format(pricing.standard));
  await expect(details.locator('.price-time')).toHaveCount(0);
  await expect(hero.getByRole('link',{name:'Sign in to register'})).toHaveAttribute('href','event.html?view=register');
  await expect(page.getByRole('link',{name:'Live floor'})).toHaveAttribute('href','event.html?view=board');
  await page.getByRole('link',{name:'Format',exact:true}).focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/#format$/);
  await expect(page.getByRole('heading',{name:'Tournament format'})).toBeInViewport();
});

test('the hero countdown uses server time, fits below sign-in and does not shift when the quote arrives',async({page,site})=>{
  site.at(new Date(Date.parse(pricing.earlyBirdEndsAt)-(2*3600+5*60+8)*1000).toISOString());
  // A wrong device clock must not change the advertised offer's duration.
  await page.clock.install({time:new Date('2030-01-01T00:00:00Z')});
  await page.clock.pauseAt(new Date('2030-01-01T00:00:01Z'));
  let release;
  const held=new Promise(resolve=>{release=resolve});
  await page.route(site.endpoint,async route=>{if(route.request().postDataJSON().action==='publicPrices')await held;await route.fallback()});
  await page.setViewportSize({width:320,height:750});await page.goto(site.origin);
  const countdown=page.locator('[data-home-countdown]'),button=page.getByRole('link',{name:'Sign in to register'});
  await expect(countdown).toBeHidden();
  const guideTop=await page.locator('.event-guide').evaluate(node=>node.getBoundingClientRect().top);
  release();await expect(countdown).toBeVisible();
  await expect(page.getByRole('timer')).toHaveText('02h 05m 08s');
  await expect(countdown).toContainText('Price rises to '+format(pricing.standard));
  expect(await page.locator('.event-guide').evaluate(node=>node.getBoundingClientRect().top)).toBe(guideTop);
  const buttonBox=await button.boundingBox(),timerBox=await countdown.boundingBox();expect(timerBox.y).toBeGreaterThanOrEqual(buttonBox.y+buttonBox.height);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:'.local/countdown-mobile.png',fullPage:true});
  site.advance(1000);await page.clock.fastForward(1000);await expect(page.getByRole('timer')).toHaveText('02h 05m 07s');
  await page.reload();await expect(page.getByRole('timer')).toHaveText('02h 05m 07s');
  expect(site.calls.filter(name=>name==='publicPrices')).toHaveLength(1);
  await page.setViewportSize({width:1280,height:900});await page.emulateMedia({colorScheme:'dark'});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:'.local/countdown-desktop-dark.png',fullPage:true});
});

test('a delayed quote leaves the registration fields in place and a return visit reuses the server quote',async({page,site})=>{
  let release;
  const held=new Promise(resolve=>{release=resolve});
  await page.route(site.endpoint,async route=>{
    if(route.request().postDataJSON().action==='publicPrices')await held;
    await route.fallback();
  });
  await page.addInitScript(()=>{
    window.shiftTotal=0;
    new PerformanceObserver(list=>{for(const e of list.getEntries())if(!e.hadRecentInput)window.shiftTotal+=e.value}).observe({type:'layout-shift',buffered:true});
  });
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.setViewportSize({width:320,height:750});await page.goto(site.register);
  const identifier=page.getByLabel('Roll number or registered email');
  const top=await identifier.evaluate(field=>field.getBoundingClientRect().top);
  await expect(page.getByRole('button',{name:'Send code'})).toBeEnabled();
  await expect(page.locator('[data-rendered="schedule"]')).toContainText(format(pricing.earlyBird)+'–'+format(pricing.standard));
  release();await expect(page.locator('.price-values strong')).toHaveText(format(pricing.earlyBird));
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  expect(Math.abs(await identifier.evaluate(field=>field.getBoundingClientRect().top)-top)).toBeLessThan(1);
  expect(await page.evaluate(()=>window.shiftTotal)).toBeLessThan(0.01);
  await page.getByRole('link',{name:'Poké Poker Night home'}).click();
  await expect(page.locator('[data-home-fee=entry]')).toHaveText(format(pricing.earlyBird));
  await page.getByRole('link',{name:'Sign in to register'}).click();await expect(identifier).toBeVisible();
  expect(site.calls.filter(name=>name==='publicPrices')).toHaveLength(1);
  const assets=await page.evaluate(()=>performance.getEntriesByType('resource').map(r=>r.name));
  expect(assets.some(url=>/player-account|payment-form|qrcode-|gate-camera|jsQR/.test(url))).toBe(false);
  await page.evaluate(()=>{
    sessionStorage.removeItem('pn26:public-entry-quote');
    sessionStorage.setItem('pn26:email-step',JSON.stringify({identifier:'sample@example.test',expires:Date.now()+600000,resendAt:Date.now()}));
  });
  await page.reload();await expect(page.getByLabel('Six-digit code')).toBeVisible();
  expect(site.calls.filter(name=>name==='publicPrices')).toHaveLength(1);
});
