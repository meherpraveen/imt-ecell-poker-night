import {test,expect} from '@playwright/test';

const site=process.env.POKER_PUBLIC_SITE||'https://meherpraveen.github.io/imt-ecell-poker-night/';
test('published navigation, mobile startup, live floor and backend validation @deployed',async({page})=>{
  const errors=[],actions=[];
  page.on('pageerror',e=>errors.push(e.message));
  page.on('request',req=>{if(req.method()==='POST'&&req.url().startsWith('https://script.google.com/macros/'))actions.push(req.postDataJSON().action)});
  await page.addInitScript(()=>{window.layoutShift=0;new PerformanceObserver(list=>{for(const entry of list.getEntries())if(!entry.hadRecentInput)window.layoutShift+=entry.value}).observe({type:'layout-shift',buffered:true})});
  await page.goto(site);await expect(page.getByRole('link',{name:'Sign in to register'})).toBeVisible();
  await expect(page.locator('a[href*="view=staff"]')).toHaveCount(0);
  await page.getByRole('link',{name:'Sign in to register'}).click();
  await expect(page.getByLabel('Roll number or registered email')).toBeVisible();
  await page.waitForFunction(()=>window.pokerReady===true);
  expect(actions).toEqual([]);
  const metrics=await page.evaluate(()=>({domContentLoadedMs:Math.round(performance.getEntriesByType('navigation')[0].domContentLoadedEventEnd),initialLayoutShift:window.layoutShift,horizontalOverflow:document.documentElement.scrollWidth>innerWidth,
    startupAssets:performance.getEntriesByType('resource').filter(r=>/\/assets\/[^/?]+\.(js|css)(\?|$)/.test(r.name)).length}));
  console.log('Published mobile registration',JSON.stringify(metrics));
  expect(metrics.horizontalOverflow).toBe(false);expect(metrics.initialLayoutShift).toBeLessThan(0.05);expect(metrics.startupAssets).toBe(2);
  await page.getByLabel('Roll number or registered email').fill('invalid');
  await page.getByRole('button',{name:'Send code',exact:true}).click();await expect(page.locator('#msg')).toContainText('nine-digit');
  await page.goto(site+'event.html?view=board');await expect(page.locator('#clock')).toBeVisible({timeout:35000});
  await expect(page.locator('#content h2').first()).toBeVisible();
  const settings=await page.evaluate(()=>api('publicInfo'));expect(typeof settings.open).toBe('boolean');
  await page.goto(site+'event.html?view=pass');await expect(page.locator('#msg')).toContainText('complete pass link');
  await page.goto(site+'event.html?view=staff');await expect(page.getByRole('heading',{name:'Page unavailable'})).toBeVisible();
  expect(actions.every(a=>['publicInfo','liveFloor'].includes(a))).toBe(true);expect(errors).toEqual([]);
});
