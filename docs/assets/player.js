'use strict';
const mode=document.body.dataset.mode;
let pendingSeat;
try{pendingSeat=JSON.parse(durable.get('pending-seat')||'null')}catch{}
function startPlayer(){heading('PLAYER REGISTRATION','Register for Poker Night');el('content').innerHTML='<div class="narrow">'+panel('Find your seat',rollField('roll')+'<p class="sub">Pre-register for ₹149 from 23 November. Walk-in registration is ₹199 at the event on 27 November.</p>'+btn('start','Continue','primary'))+'</div>'}
function showReceipt(r){
  durable.set('receipt',r.ticket);heading('PLAYER REGISTRATION','Your registration');
  let body='<p class="tag">ATTEMPT '+esc(r.id.toUpperCase())+'</p>';
  if(r.status==='REGISTERED'){
    const next=r.checkoutEnded?'Online checkout has ended. Contact E-Cell if you already paid.':r.canCheckout?'Payment is available. Continue to start a 15-minute seat hold.':'Keep this receipt. Return here for payment instructions when E-Cell publishes them.';
    body+=panel('Registration saved','<p>Your entry fee is <b>₹'+r.fee+'</b>. E-Cell confirms your seat after verifying payment.</p><p>'+next+'</p>'+
      (r.checkoutEnded?'':r.canCheckout?btn('checkout','Continue to payment','primary'):btn('receipt','Check payment availability'))+
      btn('copyReceipt','Copy private receipt link')+'<div id="copyReceiptFallback"></div>');
  }else if(r.status==='HOLD'){
    let instructions='<p>Round 1 · Wave '+r.wave+' · Hold until <b>'+localTime(r.expires)+' IST</b></p>';
    if(r.upi||r.paymentQr){
      instructions+='<p>Confirm the recipient <b>'+esc(r.name)+'</b> in your UPI app and pay exactly ₹'+r.fee+'.</p>';
      if(r.upi){
        const params=new URLSearchParams({pa:r.upi,pn:r.name,am:r.fee+'.00',cu:'INR',tn:'Poker Night '+r.id});
        instructions+='<p><code>'+esc(r.upi)+'</code></p><a class="button primary" target="_blank" rel="noopener" href="upi://pay?'+esc(params.toString().replace(/\+/g,'%20'))+'">Open UPI app</a>';
      }
      if(r.paymentQr){
        const fileName=r.paymentQr.startsWith('data:image/png;')?'payment-qr.png':'payment-qr.jpg';
        instructions+='<figure class="payment-qr"><img alt="Coordinator’s UPI payment QR" src="'+esc(r.paymentQr)+'"><figcaption>Scan in your UPI app or <a download="'+fileName+'" href="'+esc(r.paymentQr)+'">save the QR image</a>.</figcaption></figure>';
      }
      body+=panel('Pay ₹'+r.fee,instructions);
    }else body+=panel('Payments paused',instructions+'<p>If you already paid, upload your proof below.</p>'+btn('receipt','Refresh payment details'));
    body+=panel('Upload payment proof','<label for="shot">Payment screenshot</label><input id="shot" type="file" accept="image/jpeg,image/png,image/webp">'+input('tail','Visible final digits of the UPI reference (optional)','inputmode="numeric" maxlength="12" placeholder="Last 4–12 visible digits"')+'<p class="sub">Keep the amount, recipient and reference visible. You may crop your balance and unrelated transactions.</p>'+checkbox('consent','I agree to share this proof with the E-Cell payment desk for verification.')+btn('upload','Submit for review','primary'));
  }else{
    const labels={REVIEW:['Payment under review','The desk will check the coordinator’s incoming payment. Keep this page. Please pay only once.'],WAITLIST:['On the waitlist','All available seats are held. Wait for a seat offer here before paying.'],EXPIRED:['Hold expired','If you paid, bring your bank reference to the desk before making another payment.'],REJECTED:['Proof needs attention',r.reason||'Contact the desk with your receipt.'],NO_SHOW:['No-show recorded','Speak to the desk if you are at the venue.'],RELEASED:['Offer released','Speak to the desk for your current attempt.']};
    const [title,bodyText]=labels[r.status]||['Payment verified',r.delivery==='Email sent'?'Your entry code was emailed to your registered address. Bring your college ID.':'The desk can deliver your code using your registered contact or college ID.'];
    body+=panel(title,'<p>'+esc(bodyText)+'</p>'+(r.wave?'<p>Round 1 · Wave '+r.wave+'</p>':'')+btn('receipt','Refresh status'));
  }
  el('content').innerHTML='<div class="narrow">'+body+btn('other','Use another roll number')+'</div>';
  if(document.body.dataset.host!=='pages'){
    const link=document.createElement('a');
    link.href='https://meherpraveen.github.io/imt-ecell-poker-night/event.html?view=register#receipt='+encodeURIComponent(r.ticket);
    link.rel='noreferrer';
    link.textContent='Open this receipt on the event site';
    el('content').querySelector('.narrow').append(link);
  }
}
async function action(name){
  if(name==='other'){durable.set('receipt','');startPlayer();return}
  if(name==='start'){
    const roll=val('roll');
    if(!/^\d{9}$/.test(roll))throw Error('Enter your nine-digit college roll number.');
    if(!pendingSeat||pendingSeat.roll!==roll){
      pendingSeat={roll,id:globalThis.crypto?.randomUUID?.()||''};
      durable.set('pending-seat',JSON.stringify(pendingSeat));
    }
    showReceipt(await api('playerStart',roll,durable.get('receipt'),pendingSeat.id,'2'));
    pendingSeat=null;durable.set('pending-seat','');return;
  }
  if(name==='receipt'){showReceipt(await api('playerStatus',durable.get('receipt'),'2'));return}
  if(name==='checkout'){showReceipt(await api('playerCheckout',durable.get('receipt')));return}
  if(name==='copyReceipt'){
    const ticket=durable.get('receipt');
    if(!ticket)throw Error('Open your saved receipt first.');
    const url='https://meherpraveen.github.io/imt-ecell-poker-night/event.html?view=register#receipt='+encodeURIComponent(ticket);
    try{await navigator.clipboard.writeText(url);msg('Private receipt link copied. Keep it for your payment.')}
    catch{el('copyReceiptFallback').innerHTML=input('receiptUrl','Copy your private receipt link','readonly value="'+esc(url)+'"');el('receiptUrl').select()}
    return;
  }
  if(name==='upload'){if(!el('consent').checked)throw Error('Please confirm proof sharing before continuing.');const data=await picture(el('shot').files[0]);showReceipt(await api('playerUpload',durable.get('receipt'),val('tail'),data));return}
}
async function launch(){try{
  if(mode==='unavailable'){heading('POKER NIGHT','Page unavailable');el('content').replaceChildren();return}
  if(mode==='board'){heading('LIVE FLOOR','Tournament floor');el('content').innerHTML=board(await api('liveFloor'));tick();return}
  if(mode==='pass'){heading('TRAINER PASS','Your entry pass');const code=document.body.dataset.pass;if(!/^PN-[A-Z0-9]{16}$/.test(code))throw Error('Open the complete pass link from your email.');const pass=await api('passInfo',code);el('content').innerHTML='<div class="narrow">'+panel(pass.used?'Pass already scanned':pass.active?'Show at the gate':'Attempt closed',(pass.active&&!pass.used?qr(pass.code)+'<p><code>'+esc(pass.code)+'</code></p>':'')+'<p>Round 1 · Wave '+pass.wave+'. Bring your college ID. Use your wristband for a venue return.</p>')+'</div>';return}
  startPlayer();
  const saved=durable.get('receipt');
  for(const ticket of new Set([incomingReceipt,saved].filter(Boolean))){
    try{showReceipt(await api('playerStatus',ticket,'2'));return}
    catch(err){
      if(!String(err.message).includes('Open the receipt on the device you registered with.'))throw err;
      if(ticket===saved)durable.set('receipt','');
    }
  }
  const p=await api('publicInfo');
  if(!p.open)msg(p.message||'Online registration is currently closed.');
  else if(p.paymentsReady===false)msg('Registration is open. Save your roll number now and return to your receipt to pay later.');
}catch(e){msg(e.message||'The club desk is temporarily unavailable.',true)}}
addEventListener('online',()=>{el('net').textContent=''});
addEventListener('offline',()=>{el('net').textContent='Offline. Reconnect for updates.'});
if(mode==='board')setInterval(async()=>{
  if(document.hidden||!navigator.onLine)return;
  try{el('content').innerHTML=board(await api('liveFloor'));tick()}
  catch{el('net').textContent='Connection interrupted. Showing the last update.'}
},15000);
launch();
