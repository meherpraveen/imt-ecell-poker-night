import {test,expect} from './site.mjs';
import {owner,player} from './event-runtime.mjs';
import {club,credit,csvHeader,image,jpegQr,receiptText,testUpi,utr} from '../payment-fixtures.mjs';

const button=(page,name)=>page.getByRole('button',{name,exact:true});
const screenshot={name:'payment.jpg',mimeType:'image/jpeg',buffer:jpegQr()};
test('a slow private screenshot leaves the admin desk usable and historical references can be reread from the original',async({page,site})=>{
  const api=club(site);api.makeReceiver();const student=api.student();
  site.ocr(null);api.publicRpc('playerSubmitScreenshot',student.token,student.hold.ticket,image,'0');
  await page.addInitScript(({invite,token})=>sessionStorage.setItem('pn26:staff:'+invite,token),{invite:site.invite('admin'),token:api.admin});
  await page.setViewportSize({width:320,height:740});await page.goto(site.staffUrl('admin'));
  let allowDetail,allowImage,sawDetail,sawImage;
  const detailGate=new Promise(r=>{allowDetail=r}),imageGate=new Promise(r=>{allowImage=r});
  const pending=[new Promise(r=>{sawDetail=r}),new Promise(r=>{sawImage=r})];
  await page.route('**/test-staff-rpc',async route=>{
    const method=route.request().postDataJSON().name;
    if(method==='adminPaymentDetail'){sawDetail();await detailGate}
    if(method==='proofImage'){sawImage();await imageGate}
    await route.fallback();
  });
  await button(page,'Review next payment').click();
  try{
    await expect(page.getByRole('dialog')).toContainText('Loading payment details');
    await Promise.all(pending);
    allowDetail();
    await expect(button(page,'Read screenshot details again')).toBeVisible();
    await button(page,'Close').click();await button(page,'Settings').click();
    await expect(page.getByRole('heading',{name:'Settings',exact:true})).toBeVisible();await expect(page.getByRole('dialog')).toBeHidden();
    await button(page,'Payments').click();await button(page,'Review next payment').click();
    await expect(button(page,'Read screenshot details again')).toBeVisible();
    const rowOffset=()=>page.locator('#bankLookup').evaluate(input=>input.offsetTop);
    const before=await rowOffset();allowImage();
    await button(page,'Enlarge payment screenshot').click();await expect(button(page,'Fit payment screenshot')).toHaveAttribute('aria-pressed','true');
    expect(Math.abs(await rowOffset()-before)).toBeLessThan(2);
  }finally{allowDetail();allowImage()}
  await expect(page.getByAltText('Student payment screenshot')).toBeVisible();
  const reads=site.calls.filter(x=>x==='proofImage').length;
  await page.getByLabel('Reason for your decision').fill('Checking the original bank entry.');
  await page.getByLabel('Find another row by full UTR').fill(utr);await button(page,'Find row').click();
  await expect(page.getByAltText('Student payment screenshot')).toBeVisible();
  await expect(page.getByLabel('Reason for your decision')).toHaveValue('Checking the original bank entry.');
  expect(site.calls.filter(x=>x==='proofImage').length).toBe(reads);
  site.ocr('Payment successful\n149\nOne Hundred Forty Nine Rupees\nRef No: 0123 4567 8901');
  await button(page,'Read screenshot details again').click();
  const dialog=page.getByRole('dialog');
  await expect(dialog.locator('dt').filter({hasText:'Payment UTR'}).locator('..')).toContainText('012345678901');
  await expect(dialog.locator('dt').filter({hasText:'Amount'}).locator('..')).toContainText('149');
  await expect(button(page,'Read screenshot details again')).toHaveCount(0);
  expect(student.status().status).toBe('REVIEW');
  await button(page,'Close').click();await button(page,'Refresh').click();
  await page.getByLabel('Search payments').fill('012345678901');
  await expect(button(page,'Open payment for Sample Student')).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

async function register(page,site){
  await page.goto(site.register);await page.getByLabel('Roll number or registered email').fill(player.roll);
  await button(page,'Send code').click();await expect(page.getByLabel('Six-digit code')).toBeVisible();
  await page.getByLabel('Six-digit code').fill(site.code(player.email));await button(page,'Verify and continue').click();
  await expect(page.getByLabel('Full Name')).toHaveValue('Sample Student');await expect(page.getByLabel('PGP ID',{exact:true})).toHaveValue(player.roll);await page.getByLabel('Batch',{exact:true}).selectOption('2026-28');await page.getByLabel('Phone number').fill('9876543210');await button(page,'Continue to payment').click();
}
async function addReceiver(admin,site){
  await admin.goto(site.staffUrl('admin'));await button(admin,'Send code to club email').click();
  await expect(admin.getByLabel('Six-digit code')).toBeVisible();await admin.getByLabel('Six-digit code').fill(site.code(owner));
  await button(admin,'Verify and open desk').click();await button(admin,'Settings').click();await button(admin,'Add receiver').click();
  await admin.getByLabel('Receiver name').fill('Sample Treasurer');await admin.getByLabel('UPI ID',{exact:true}).fill(testUpi);
  await admin.getByLabel('Payment QR image').setInputFiles(screenshot);await button(admin,'Save receiver').click();
  await expect(admin.locator('dialog')).not.toBeVisible();await expect(button(admin,'Sample Treasurer · Active')).toBeVisible();
}
async function proof(page,site,alter){
  site.ocr(alter?null:receiptText());
  const shot=page.getByLabel('Payment screenshot'),form=page.locator('form[data-action="submitPayment"]');
  await expect(form.locator('input,textarea,select')).toHaveCount(1);
  await button(page,'Submit screenshot').click();await expect(page.locator('#shotError')).toBeVisible();
  await shot.setInputFiles(screenshot);await button(page,'Submit screenshot').click();
  await expect(page.getByRole('heading',{name:'Payment pending'})).toBeVisible();
}
for(const manual of [false,true]){
  test(manual?'desk verifies an unreadable screenshot using the original bank credit':'student payment moves from screenshot to statement preview to an emailed phone pass',async({page,context,site})=>{
    const admin=await context.newPage();await addReceiver(admin,site);
    if(manual){
      await button(admin,'Add receiver').click();await admin.getByLabel('Receiver name').fill('Alternate Treasurer');await admin.getByLabel('UPI ID',{exact:true}).fill('second@samplebank');
      await admin.getByLabel('Payment QR image').setInputFiles({...screenshot,buffer:jpegQr('second@samplebank')});await button(admin,'Save receiver').click();await expect(admin.locator('dialog')).not.toBeVisible();
    }
    await register(page,site);
    if(manual){
      await expect(page.getByRole('img',{name:/UPI payment QR for/})).toHaveCount(2);
      await expect(page.getByRole('radio',{name:'Sample Treasurer',exact:true})).toBeChecked();
      await expect(page.getByRole('button',{name:/Copy UPI ID/})).toHaveAttribute('data-value',testUpi);
    }
    await expect(page.getByRole('img',{name:'UPI payment QR for Sample Treasurer'})).toBeVisible();
    await expect(page.getByRole('link',{name:'Save QR for Sample Treasurer'})).toBeVisible();
    await expect(page.getByRole('button',{name:/Copy number/})).toHaveCount(0);
    await expect(page.locator('.payment-help')).toContainText('enter ₹149');
    await proof(page,site,manual);
    await button(admin,'Payments').click();await button(admin,'Bank statements').click();
    const receiver=admin.getByLabel('Receiving account on the statement');
    await receiver.selectOption({label:'Sample Treasurer · '+testUpi});
    await admin.getByLabel('Statement file').setInputFiles({name:'test-bank.csv',mimeType:'text/csv',buffer:Buffer.from(csvHeader+'\r\n'+credit())});
    await admin.getByLabel('I checked that this statement', {exact:false}).check();await button(admin,'Preview matches').click();
    await expect(admin.getByRole('heading',{name:'Statement preview'})).toBeVisible();
    await expect(admin.locator('dialog dt').filter({hasText:'Ready to authorize'}).locator('..')).toContainText(manual?'0':'1');
    expect(site.mail.some(m=>m.subject.endsWith('entry pass'))).toBe(false);
    expect(await admin.locator('dialog').evaluate(d=>d.scrollWidth<=d.clientWidth+1)).toBe(true);
    let resumeDelivery;
    if(manual){
      const held=new Promise(resolve=>{resumeDelivery=resolve});
      await admin.route('**/test-staff-rpc',async route=>{
        if(route.request().postDataJSON().name==='adminDispatchPasses')await held;
        await route.fallback();
      });
    }
    await button(admin,'Apply preview').click();
    if(manual){
      try{await expect(admin.getByRole('dialog',{name:'Statement applied'})).toBeVisible()}
      finally{resumeDelivery()}
    }
    await expect(admin.locator('dialog')).not.toBeVisible();
    if(manual){
      await button(admin,'Needs Review').click();await button(admin,player.roll).click();
      await expect(admin.getByAltText('Student payment screenshot')).toBeVisible();await expect(admin.locator('dialog')).toContainText('Unreadable');
      await admin.getByLabel('Find another row by full UTR').fill(utr);await button(admin,'Find row').click();
      await admin.getByLabel('Statement row to use').selectOption({index:1});
      await admin.getByLabel('Reason for your decision').fill('Original screenshot and incoming credit match.');
      await admin.getByLabel('I checked the screenshot and the original bank credit.').check();
      await button(admin,'Approve payment').click();await expect(admin.locator('dialog')).not.toBeVisible();
    }
    await button(page,'Refresh status').click();await expect(page.getByRole('heading',{name:'Payment verified'})).toBeVisible();
    const pass=page.getByRole('link',{name:'Open phone pass'});
    await expect(pass).toBeVisible();await expect(page.getByAltText('Single-use entry QR')).toBeVisible();
    expect(site.mail.filter(m=>m.subject.endsWith('entry pass'))).toHaveLength(1);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  });
}
