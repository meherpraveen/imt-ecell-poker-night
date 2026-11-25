import bcrypt from 'bcryptjs';
import {test,expect} from './site.mjs';
import {owner,player} from './event-runtime.mjs';
const password='Fixture-owner-82!',hash=bcrypt.hashSync(password,10);
test.use({studentSignIn:'directory',ownerSignIn:'password',ownerPasswordHash:hash});
const button=(page,name)=>page.getByRole('button',{name,exact:true});
async function publicForm(page,site){await page.goto(site.register);await button(page,'Club account sign-in').click();await page.getByLabel('Club email',{exact:true}).fill(owner)}
test('club email and password open the private desk while mail is offline',async({page,site})=>{
  site.mailFailure(true);await publicForm(page,site);await page.getByLabel('Club password',{exact:true}).fill(password);
  await button(page,'Sign in to club desk').click();await expect(page.getByRole('heading',{name:'Payments',exact:true})).toBeVisible();
  expect(site.mail).toHaveLength(0);
  let release;const held=new Promise(resolve=>{release=resolve});
  await page.route('**/test-staff-rpc',async route=>{if(route.request().postDataJSON().name==='staffLogout')await held;await route.fallback()});
  await button(page,'Sign out').click();
  try{await expect(page.getByLabel('Club password',{exact:true})).toHaveCount(0);await expect(page.locator('#content')).toContainText('Signing out')}
  finally{release()}
  await expect(page.getByLabel('Club password',{exact:true})).toBeVisible();
  await page.getByLabel('Club password',{exact:true}).fill(password);await button(page,'Sign in to club desk').click();
  await expect(page.getByRole('heading',{name:'Payments',exact:true})).toBeVisible();expect(site.mail).toHaveLength(0);
});
test('incorrect password stays outside the desk and typed passwords are never stored',async({page,context,site})=>{
  await publicForm(page,site);await page.getByLabel('Club password',{exact:true}).fill('wrong');await button(page,'Sign in to club desk').click();
  await expect(page.locator('#msg')).toContainText('incorrect');await expect(page.getByRole('heading',{name:'Payments',exact:true})).toHaveCount(0);
  await page.getByLabel('Club password',{exact:true}).fill(password);expect(JSON.stringify(await context.storageState())).not.toContain(password);
  expect(await page.evaluate(()=>JSON.stringify(sessionStorage))).not.toContain(password);await page.reload();
  await button(page,'Club account sign-in').click();await expect(page.getByLabel('Club password',{exact:true})).toHaveValue('');expect(site.mail).toHaveLength(0);
});
test('old owner email-code steps resume at the password form on either entry point',async({page,site})=>{
  await page.addInitScript(email=>localStorage.setItem('pn26:email-step',JSON.stringify({identifier:email,adminEntry:true,expires:Date.now()+600000})),owner);
  await page.goto(site.register);await expect(page.getByLabel('Club password',{exact:true})).toBeVisible();await expect(page.getByLabel('Club email',{exact:true})).toHaveValue(owner);
  await page.goto(site.staffUrl('admin'));await expect(page.getByLabel('Club password',{exact:true})).toBeVisible();
  await expect(page.getByLabel('Six-digit code')).toHaveCount(0);expect(site.mail).toHaveLength(0);
});
test('a lost public password response can retry and student access still uses roll and email',async({page,site})=>{
  await publicForm(page,site);let continuation;
  await page.route(site.endpoint,async route=>{const body=route.request().postDataJSON();if(body.action!=='signInClubWithPassword'||continuation)return route.fallback();continuation=site.post(body).value.continueUrl;await route.abort()});
  await page.getByLabel('Club password',{exact:true}).fill(password);await button(page,'Sign in to club desk').click();await expect(page.locator('#msg')).toContainText('Could not reach');
  await button(page,'Sign in to club desk').click();await expect(page.getByRole('heading',{name:'Payments',exact:true})).toBeVisible();
  await page.goto(site.register);await page.getByLabel('College roll number',{exact:true}).fill(player.roll);await page.getByLabel('College email',{exact:true}).fill(player.email);
  await button(page,'Sign in').click();await expect(page.getByLabel('PGP ID',{exact:true})).toHaveValue(player.roll);expect(site.mail).toHaveLength(0);
});
