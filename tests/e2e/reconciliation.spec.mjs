import {test,expect} from './site.mjs';
import {owner,player} from './event-runtime.mjs';
import {credit,csvHeader,jpegQr,paidAt,receiptText,testUpi,utr} from '../payment-fixtures.mjs';

const button=(page,name)=>page.getByRole('button',{name,exact:true});
const screenshot={name:'payment.jpg',mimeType:'image/jpeg',buffer:jpegQr()};
async function register(page,site){
  await page.goto(site.register);await page.getByLabel('Roll number or registered email').fill(player.roll);
  await button(page,'Send code').click();await expect(page.getByLabel('Six-digit code')).toBeVisible();
  await page.getByLabel('Six-digit code').fill(site.code(player.email));await button(page,'Verify and continue').click();
  await expect(page.getByText('Sample Student',{exact:true})).toBeVisible();await button(page,'Request a seat').click();
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
  site.ocr(receiptText());await expect(page.getByText('Keep the UTR / UPI Transaction ID visible in your screenshot.',{exact:true})).toBeVisible();
  await button(page,'Submit for verification').click();await expect(page.locator('#shotError')).toBeVisible();
  await page.getByLabel('Payment screenshot').setInputFiles(screenshot);
  await expect(page.getByLabel('UTR / UPI Transaction ID')).toHaveValue(utr);
  await expect(page.getByLabel('Payment time (IST)')).toHaveValue(paidAt);
  if(alter)await page.getByLabel('Amount paid (₹)').fill('140');
  await page.getByLabel('Who made the payment?').fill('Friend of Student');
  await page.getByLabel('Who was the payment for?').selectOption(player.roll);
  await page.getByLabel('I agree to fair play.',{exact:false}).check();await button(page,'Submit for verification').click();
  await expect(page.getByRole('heading',{name:'Payment pending'})).toBeVisible();
}
for(const manual of [false,true]){
  test(manual?'admin compares corrected proof to the bank and manually authorizes the selected credit':'student payment moves from screenshot to statement preview to an emailed phone pass',async({page,context,site})=>{
    const admin=await context.newPage();await addReceiver(admin,site);await register(page,site);
    await expect(page.getByAltText('Coordinator’s UPI payment QR')).toBeVisible();
    await expect(page.getByRole('link',{name:'Open UPI app'})).toHaveAttribute('href',/am=149\.00/);
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
    await button(admin,'Apply preview').click();await expect(admin.locator('dialog')).not.toBeVisible();
    if(manual){
      await button(admin,'Needs Review').click();await button(admin,player.roll).click();
      await expect(admin.getByAltText('Student payment screenshot')).toBeVisible();await expect(admin.locator('dialog')).toContainText('Friend of Student');
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
