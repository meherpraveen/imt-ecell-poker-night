import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {test,expect} from './site.mjs';

const config=readFileSync(new URL('../../gas/Pricing.gs',import.meta.url),'utf8');
const pricing=runInNewContext(config+'\nENTRY_PRICING');
const format=amount=>new Intl.NumberFormat('en-IN',{style:'currency',currency:pricing.currency,maximumFractionDigits:0}).format(amount);

test('the homepage updates both entry quotes at the cutoff and keeps its event links usable',async({page,site})=>{
  site.at(new Date(Date.parse(pricing.earlyBirdEndsAt)-3000).toISOString());
  await page.clock.install({time:new Date(Date.parse(pricing.earlyBirdEndsAt)-3000)});
  await page.goto(site.origin);
  const hero=page.getByRole('region',{name:'Poké Poker Night',exact:true});
  const details=page.getByRole('region',{name:'Entry details'});
  await expect(hero.locator('[data-home-fee=entry]')).toHaveText(format(pricing.earlyBird));
  await expect(hero.locator('s')).toHaveText('Standard price '+format(pricing.standard));
  await expect(details.locator('.price-time')).toContainText('left');
  await expect(details.locator('[data-home-fee=retry]')).toHaveText(format(pricing.retry));
  site.advance(4000);await page.clock.fastForward(4000);
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
  release();await expect(page.locator('.price-values strong')).toHaveText(format(pricing.earlyBird));
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  expect(Math.abs(await identifier.evaluate(field=>field.getBoundingClientRect().top)-top)).toBeLessThan(1);
  expect(await page.evaluate(()=>window.shiftTotal)).toBeLessThan(0.01);
  await page.getByRole('link',{name:'Poké Poker Night home'}).click();
  await expect(page.locator('[data-home-fee=entry]')).toHaveText(format(pricing.earlyBird));
  await page.getByRole('link',{name:'Sign in to register'}).click();await expect(identifier).toBeVisible();
  expect(site.calls.filter(name=>name==='publicPrices')).toHaveLength(1);
  const assets=await page.evaluate(()=>performance.getEntriesByType('resource').map(r=>r.name));
  expect(assets.some(url=>/payment-form|qrcode-|gate-camera|jsQR/.test(url))).toBe(false);
  await page.evaluate(()=>{
    sessionStorage.removeItem('pn26:public-entry-quote');
    sessionStorage.setItem('pn26:email-step',JSON.stringify({identifier:'sample@example.test',expires:Date.now()+600000,resendAt:Date.now()}));
  });
  await page.reload();await expect(page.getByLabel('Six-digit code')).toBeVisible();
  expect(site.calls.filter(name=>name==='publicPrices')).toHaveLength(1);
});
