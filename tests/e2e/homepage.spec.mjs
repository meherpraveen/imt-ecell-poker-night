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
