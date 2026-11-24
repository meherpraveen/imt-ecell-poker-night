import makeQr from 'qrcode-generator';
import {test,expect} from './site.mjs';
import {player} from './event-runtime.mjs';

test('the pass linked in the text email and its saved copy share one gate admission',async({context,page,site},testInfo)=>{
  site.at('2026-11-27T19:12:00+05:30');
  const desk=site.staff('staffLogin',[site.team.desk,site.invite('desk')]);
  site.staff('deskPayment',[desk.token,player.roll,'walk','123456784321',true,199,'2026-28']);
  const mail=site.mail.at(-1),gateCode=mail.body.match(/^PN-[A-Z0-9]{16}$/m)[0];
  const link=new URL(mail.body.match(/https:\/\/\S+/)[0]);
  expect(link.origin+link.pathname).toBe('https://pokernight.imtneversleeps.com/event.html');
  expect(new URLSearchParams(link.hash.slice(1)).get('code')).toBe(gateCode);
  await page.goto(site.origin+'/event.html'+link.search+link.hash);
  const passQr=page.getByAltText('Single-use entry QR');await expect(passQr).toBeVisible();
  const linkedQr=await passQr.getAttribute('src');
  const save=page.getByRole('link',{name:'Save pass to phone'});
  await expect(save).toBeVisible();
  const png=await save.getAttribute('href');
  const download=page.waitForEvent('download');await save.click();
  expect((await download).suggestedFilename()).toBe('Poke-Poker-Night-Wave-1.png');
  await page.emulateMedia({colorScheme:'dark',reducedMotion:'reduce'});
  await expect(page.locator('.wallet').getByRole('img',{name:'Poké Poker Night'})).toBeVisible();
  await expect(page.locator('.wallet .qr')).toHaveCSS('background-color','rgb(255, 255, 255)');
  await page.screenshot({animations:'disabled',path:testInfo.outputPath('phone-pass-dark.png')});

  const account=await context.newPage();await account.goto(site.register);
  await account.getByLabel('Roll number or registered email').fill(player.roll);
  await account.getByRole('button',{name:'Send code',exact:true}).click();
  await account.getByLabel('Six-digit code').fill(site.code(player.email));
  await account.getByRole('button',{name:'Verify and continue'}).click();
  await expect(account.getByAltText('Single-use entry QR')).toBeVisible();

  const deskPage=await context.newPage();await deskPage.goto(site.staffUrl('gate'));
  await deskPage.getByLabel('Private staff key').fill(site.team.gate);await deskPage.getByRole('button',{name:'Sign in',exact:true}).click();
  const openCamera=deskPage.waitForEvent('popup');await deskPage.getByRole('link',{name:'Scan entry QR'}).click();
  const camera=await openCamera;await expect(camera.getByRole('button',{name:'Start camera'})).toBeVisible();
  expect(new URL(camera.url()).hash).toBe('');
  await camera.evaluate(image=>{
    window.testGateImage=image;
    // Some platforms advertise QR support and then reject the detector at runtime.
    window.BarcodeDetector=class{static async getSupportedFormats(){return ['qr_code']}async detect(){throw Error('Detector unavailable')}};
    // A real MediaStream carrying the pass pixels drives the same video and decoder as a rear camera.
    Object.defineProperty(navigator.mediaDevices,'getUserMedia',{value:async()=>{
      const frame=document.createElement('canvas');frame.width=640;frame.height=880;
      const ctx=frame.getContext('2d'),img=new Image();img.src=window.testGateImage;await img.decode();
      const scale=Math.min(frame.width/img.width,frame.height/img.height);
      const draw=()=>{
        ctx.fillStyle='white';ctx.fillRect(0,0,frame.width,frame.height);
        ctx.drawImage(img,(frame.width-img.width*scale)/2,(frame.height-img.height*scale)/2,img.width*scale,img.height*scale);
      };
      draw();const stream=frame.captureStream(10);window.testTrack=stream.getVideoTracks()[0];
      const timer=setInterval(()=>{if(stream.active)draw();else clearInterval(timer)},100);
      return stream;
    }});
  },png);
  await camera.getByRole('button',{name:'Start camera'}).click();
  await expect(camera.getByRole('heading',{name:'Checked in'})).toBeVisible();
  await expect(camera.getByText('Sample Student')).toBeVisible();await expect(camera.getByText('Seat 01')).toBeVisible();
  expect(await camera.evaluate(()=>window.testTrack.readyState)).toBe('ended');
  await camera.screenshot({animations:'disabled',path:testInfo.outputPath('gate-admitted.png')});
  await camera.evaluate(image=>window.testGateImage=image,linkedQr);
  await camera.getByRole('button',{name:'Scan next ticket'}).click();
  await expect(camera.getByRole('heading',{name:'Already used'})).toBeVisible();
  await expect(camera.getByText(/First scan.*IST/)).toBeVisible();await expect(camera.getByText('Seat 01')).toBeVisible();
  const foreign=makeQr(0,'M');foreign.addData('unrelated QR');foreign.make();
  await camera.evaluate(image=>window.testGateImage=image,foreign.createDataURL(8,32));
  await camera.getByRole('button',{name:'Scan next ticket'}).click();
  await expect(camera.getByRole('heading',{name:'Invalid ticket'})).toBeVisible();
  expect(site.rows.Journal.filter(row=>row[1]==='Gate admit')).toHaveLength(1);
  for(const playerPage of [page,account]){
    await playerPage.bringToFront();
    await expect(playerPage.getByText('Seat 01',{exact:true})).toBeVisible({timeout:12000});
    await expect(playerPage.getByAltText('Single-use entry QR')).toHaveCount(0);
  }
});

test('native camera decoding can be cancelled mid-frame and needs no JavaScript QR decoder',async({page,site})=>{
  site.at('2026-11-27T19:15:00+05:30');
  const desk=site.staff('staffLogin',[site.team.desk,site.invite('desk')]);
  site.staff('deskPayment',[desk.token,player.roll,'walk','111122223333',true,199,'2026-28']);
  const code=site.mail.at(-1).body.match(/PN-[A-Z0-9]{16}/)[0];
  const gate=site.staff('staffLogin',[site.team.gate,site.invite('gate')]);
  const link=new URL(site.staff('staffSnapshot',[gate.token]).scannerUrl);
  const assets=[];page.on('request',req=>assets.push(req.url()));
  await page.goto(site.origin+'/event.html'+link.search+link.hash);
  await page.evaluate(ticket=>{
    window.BarcodeDetector=class{
      static async getSupportedFormats(){return ['qr_code']}
      async detect(){
        if(!window.allowScan)await new Promise(resolve=>{window.finishCameraFrame=resolve});
        return [{rawValue:ticket}];
      }
    };
    navigator.mediaDevices.getUserMedia=async()=>{
      const canvas=document.createElement('canvas');canvas.width=160;canvas.height=120;
      const feed=canvas.captureStream(10);
      canvas.getContext('2d').fillRect(0,0,160,120);
      return feed;
    };
  },code);
  await page.getByRole('button',{name:'Start camera'}).click();
  await page.waitForFunction(()=>!!window.finishCameraFrame);
  await page.getByRole('button',{name:'Close camera'}).click();
  await page.evaluate(()=>{window.allowScan=true;window.finishCameraFrame()});
  await expect(page.getByRole('button',{name:'Start camera'})).toBeVisible();
  expect(site.calls.filter(name=>name==='scanEntryTicket')).toHaveLength(0);
  await page.getByRole('button',{name:'Start camera'}).click();
  await expect(page.getByRole('heading',{name:'Checked in'})).toBeVisible();
  expect(site.calls.filter(name=>name==='scanEntryTicket')).toHaveLength(1);
  expect(assets.some(url=>url.includes('jsQR-'))).toBe(false);
});

test('a lost camera response stays unconfirmed and retry recovers the original admission',async({page,site})=>{
  site.at('2026-11-27T19:15:00+05:30');
  const desk=site.staff('staffLogin',[site.team.desk,site.invite('desk')]);
  site.staff('deskPayment',[desk.token,player.roll,'walk','111122223333',true,199,'2026-28']);
  const code=site.mail.at(-1).body.match(/PN-[A-Z0-9]{16}/)[0];
  const gate=site.staff('staffLogin',[site.team.gate,site.invite('gate')]);
  const link=new URL(site.staff('staffSnapshot',[gate.token]).scannerUrl);
  await page.goto(site.origin+'/event.html'+link.search+link.hash);
  await page.route(site.endpoint,route=>{site.post(route.request().postDataJSON());return route.abort()},{times:1});
  await page.getByText('Enter a ticket code',{exact:true}).click();await page.getByLabel('Entry code').fill(code);
  await page.getByRole('button',{name:'Check ticket'}).click();
  await expect(page.getByRole('heading',{name:'Check-in unconfirmed'})).toBeVisible();
  await expect(page.getByText('Seat 01')).toHaveCount(0);
  await page.getByRole('button',{name:'Retry this ticket'}).click();
  await expect(page.getByRole('heading',{name:'Already used'})).toBeVisible();
  await expect(page.getByText('Seat 01')).toBeVisible();expect(site.rows.Journal.filter(row=>row[1]==='Gate admit')).toHaveLength(1);
});

test('registration and checkout cross the same price boundary while a phone stays open',async({page,site},testInfo)=>{
  site.at('2026-11-27T18:59:00+05:30');await page.clock.install({time:new Date(site.now())});
  site.rows.Settings[1][1]='club@example';site.rows.Settings[2][1]='Sample Club';site.rows.Settings[5][1]='yes';
  await page.goto(site.register);
  const offer=page.locator('[data-entry-price]:visible');
  await expect(offer.locator('s')).toContainText('₹199');await expect(offer).toContainText('Early Bird');await expect(offer).toContainText('1 min left');
  await page.getByLabel('Roll number or registered email').fill(player.roll);await page.getByRole('button',{name:'Send code',exact:true}).click();
  await page.getByLabel('Six-digit code').fill(site.code(player.email));await page.getByRole('button',{name:'Verify and continue'}).click();
  await expect(page.getByLabel('Full Name')).toHaveValue('Sample Student');await expect(offer).toContainText('₹149');
  await page.screenshot({animations:'disabled',path:testInfo.outputPath('registration-light.png')});
  await page.getByLabel('Batch',{exact:true}).selectOption('2025-27');await page.getByRole('button',{name:'Continue to payment'}).click();await expect(offer.locator('s')).toContainText('₹199');
  await expect(page.getByRole('button',{name:/Copy UPI ID/})).toHaveAttribute('data-value','club@example');
  await expect(page.locator('.payment-help')).toContainText('Enter ₹149');
  await page.getByRole('button',{name:'Submit screenshot'}).click();
  await expect(page.getByLabel('Payment screenshot')).toHaveAttribute('aria-invalid','true');
  site.advance(60000);await page.clock.fastForward(60000);
  await expect(page.getByRole('heading',{name:'Pay ₹199'})).toBeVisible();
  await expect(offer).toContainText('Standard entry');await expect(offer.locator('s')).toHaveCount(0);
  expect(site.calls.filter(method=>method==='playerStart')).toHaveLength(1);
  await expect(page.getByRole('button',{name:/Copy UPI ID/})).toHaveAttribute('data-value','club@example');
  await expect(page.locator('.payment-help')).toContainText('Enter ₹199');
  await expect(offer).not.toContainText('149');await expect(offer).not.toContainText('Early Bird');
});
