'use strict';
const mode=document.body.dataset.mode;
function startPlayer(){heading('PLAYER REGISTRATION','Register for Poker Night');el('content').innerHTML='<div class="narrow">'+panel('Find your seat',rollField('roll')+'<p class="sub">Use your college roll number to see the fee and the coordinator’s UPI details.</p>'+btn('start','Continue','primary'))+'</div>'}
function showReceipt(r){
  durable.set('receipt',r.ticket);heading('PLAYER REGISTRATION','Your registration');
  let body='<p class="tag">ATTEMPT '+esc(r.id.toUpperCase())+'</p>';
  if(r.status==='HOLD'){
    const params=new URLSearchParams({pa:r.upi,pn:r.name,am:r.fee+'.00',cu:'INR',tn:'Poker Night '+r.id});
    body+=panel('Pay ₹'+r.fee,'<p>Round 1 · Wave '+r.wave+' · Hold until <b>'+localTime(r.expires)+' IST</b></p><p>Recipient <b>'+esc(r.name)+'</b><br><code>'+esc(r.upi)+'</code></p><a class="button primary" target="_blank" rel="noopener" href="upi://pay?'+esc(params.toString().replace(/\+/g,'%20'))+'">Open UPI app</a><p class="sub">If your UPI app does not open, copy the ID above and pay the exact fee.</p>');
    body+=panel('Upload payment proof','<label for="shot">Payment screenshot</label><input id="shot" type="file" accept="image/jpeg,image/png,image/webp">'+input('tail','Visible final digits of the UPI reference (optional)','inputmode="numeric" maxlength="12" placeholder="Last 4–12 visible digits"')+'<p class="sub">Keep the amount, recipient and reference visible. You may crop your balance and unrelated transactions.</p>'+checkbox('consent','I agree to share this proof with the E-Cell payment desk for verification.')+btn('upload','Submit for review','primary'));
  }else{
    const labels={REVIEW:['Payment under review','The desk will check the coordinator’s incoming payment. Keep this page. Please pay only once.'],WAITLIST:['On the waitlist','All available seats are held. Wait for a seat offer here before paying.'],EXPIRED:['Hold expired','If you paid, bring your bank reference to the desk before making another payment.'],REJECTED:['Proof needs attention',r.reason||'Contact the desk with your receipt.'],NO_SHOW:['No-show recorded','Speak to the desk if you are at the venue.'],RELEASED:['Offer released','Speak to the desk for your current attempt.']};
    const [title,bodyText]=labels[r.status]||['Payment verified',r.delivery==='Email sent'?'Your entry code was emailed to your registered address. Bring your college ID.':'The desk can deliver your code using your registered contact or college ID.'];
    body+=panel(title,'<p>'+esc(bodyText)+'</p>'+(r.wave?'<p>Round 1 · Wave '+r.wave+'</p>':'')+btn('receipt','Refresh status'));
  }
  el('content').innerHTML='<div class="narrow">'+body+btn('other','Use another roll number')+'</div>';
}
async function picture(file){
  if(!file||!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size>15*1024*1024)throw Error('Choose a JPEG, PNG or WebP screenshot under 15 MB.');
  const url=URL.createObjectURL(file);try{const im=new Image();im.src=url;await im.decode();const scale=Math.min(1,1800/Math.max(im.width,im.height));const c=document.createElement('canvas');c.width=Math.max(1,Math.round(im.width*scale));c.height=Math.max(1,Math.round(im.height*scale));const ctx=c.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,c.width,c.height);ctx.drawImage(im,0,0,c.width,c.height);const data=c.toDataURL('image/jpeg',.83);if(data.length>2400000)throw Error('Crop the payment receipt and upload a smaller image.');return data}finally{URL.revokeObjectURL(url)}
}
async function action(name){
  if(name==='other'){durable.set('receipt','');startPlayer();return}
  if(name==='start'){const r=await api('playerStart',val('roll'),durable.get('receipt'));showReceipt(r);return}
  if(name==='receipt'){showReceipt(await api('playerStatus',durable.get('receipt')));return}
  if(name==='upload'){if(!el('consent').checked)throw Error('Please confirm proof sharing before continuing.');const data=await picture(el('shot').files[0]);showReceipt(await api('playerUpload',durable.get('receipt'),val('tail'),data));return}
}
async function launch(){try{
  if(mode==='board'){heading('LIVE FLOOR','Tournament floor');el('content').innerHTML=board(await api('liveFloor'));tick();return}
  if(mode==='pass'){heading('TRAINER PASS','Your entry pass');const code=document.body.dataset.pass;if(!/^PN-[A-Z0-9]{16}$/.test(code))throw Error('Open the complete pass link from your email.');const pass=await api('passInfo',code);el('content').innerHTML='<div class="narrow">'+panel(pass.used?'Pass already scanned':pass.active?'Show at the gate':'Attempt closed',(pass.active&&!pass.used?qr(pass.code)+'<p><code>'+esc(pass.code)+'</code></p>':'')+'<p>Round 1 · Wave '+pass.wave+'. Bring your college ID. Use your wristband for a venue return.</p>')+'</div>';return}
  startPlayer();const ticket=durable.get('receipt');if(ticket){try{showReceipt(await api('playerStatus',ticket));return}catch{durable.set('receipt','')}}
  const p=await api('publicInfo');if(!p.open)msg('Online registration is currently closed. The club will open payments here.');
}catch(e){msg(e.message||'The club desk is temporarily unavailable.',true)}}
addEventListener('online',()=>{el('net').textContent=''});
addEventListener('offline',()=>{el('net').textContent='Offline. Reconnect for updates.'});
if(mode==='board')setInterval(async()=>{
  if(document.hidden||!navigator.onLine)return;
  try{el('content').innerHTML=board(await api('liveFloor'));tick()}
  catch{el('net').textContent='Connection interrupted. Showing the last update.'}
},15000);
launch();
