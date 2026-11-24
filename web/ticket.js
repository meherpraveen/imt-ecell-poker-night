'use strict';
function scriptAsset(src){
  return new Promise((resolve,reject)=>{
    const script=document.createElement('script');script.onload=resolve;script.onerror=()=>{script.remove();reject(Error('Could not load this part of the ticket. Please try again.'))};
    script.src=src;document.head.append(script);
  });
}
function walletCard(r,player,standalone){
  const code=r.entryCode||r.code,used=!!r.checkedInAt;
  const wordmark=document.querySelector('.appbar .event-wordmark');
  const name=wordmark?'<img class="wallet-wordmark" src="'+esc(wordmark.getAttribute('src'))+'" width="360" height="126" alt="Poké Poker Night">':'Poké Poker Night';
  const header='<header class="wallet-head"><div><p class="wallet-issuer">E-Cell · IMT Ghaziabad</p><h2>'+name+'</h2></div><span class="suit" aria-hidden="true">♠</span></header>';
  const details='<dl class="wallet-facts"><div><dt>Event date</dt><dd>27 Nov 2026</dd></div><div><dt>Qualifier</dt><dd>Wave '+r.wave+'</dd></div></dl>';
  const title=used?(standalone?'Pass already scanned':'Checked in'):(standalone?'Show at the gate':'Payment verified');
  const passUrl=(document.body.dataset.host==='pages'?'event.html':'https://meherpraveen.github.io/imt-ecell-poker-night/event.html')+'?view=pass#code='+encodeURIComponent(code||'');
  const admission=used?'<strong class="wallet-seat">'+seatLabel(r.seat)+'</strong><p>'+seatLocation(r.wave,r.seat)+'</p><p class="sub">Checked in '+esc(scanTime(r.checkedInAt))+'</p>':
    '<div id="passImage" class="pass-image" aria-busy="true"></div><p class="ticket-code">'+esc(code)+'</p><p class="sub">Show this QR with your college ID.</p>';
  const action=used?'':standalone?'<a id="savePass" class="button primary wide" hidden>Save pass to phone</a>':
    '<a class="button primary wide" href="'+esc(passUrl)+'">Open phone pass</a>';
  return '<article class="wallet">'+header+details+'<div class="wallet-body"><h3>'+title+'</h3>'+
    (player?'<p class="wallet-player">'+esc(player)+'</p>':'')+admission+action+'</div></article>';
}
function passPng(code,wave){
  const canvas=document.createElement('canvas');canvas.width=720;canvas.height=980;
  const ctx=canvas.getContext('2d');
  ctx.fillStyle='#ffffff';ctx.fillRect(0,0,720,980);
  const theme=getComputedStyle(document.documentElement);
  ctx.fillStyle=theme.getPropertyValue('--navy').trim();ctx.fillRect(0,0,720,214);
  ctx.fillStyle=theme.getPropertyValue('--poke-red').trim();ctx.fillRect(0,0,720,9);
  ctx.fillStyle='#d2e0f4';ctx.font='28px system-ui';ctx.fillText('E-Cell · IMT Ghaziabad',48,62);
  const wordmark=document.querySelector('.appbar .event-wordmark');
  if(wordmark?.complete&&wordmark.naturalWidth)ctx.drawImage(wordmark,48,80,320,112);
  else {ctx.fillStyle=theme.getPropertyValue('--poke-yellow').trim();ctx.font='bold 55px system-ui';ctx.fillText('Poké Poker Night',48,160)}
  ctx.fillStyle='#162b48';ctx.font='bold 32px system-ui';ctx.fillText('27 Nov 2026',48,285);
  ctx.textAlign='right';ctx.fillText('Wave '+wave,672,285);
  ctx.strokeStyle='#a4b4c9';ctx.setLineDash([8,8]);ctx.beginPath();ctx.moveTo(0,335);ctx.lineTo(720,335);ctx.stroke();
  const matrix=ticketMatrix(code),count=matrix.getModuleCount(),cell=Math.floor(492/(count+8));
  const left=Math.floor((canvas.width-count*cell)/2),top=370+4*cell;
  ctx.fillStyle='#000000';
  for(let row=0;row<count;row++)for(let col=0;col<count;col++)if(matrix.isDark(row,col))ctx.fillRect(left+col*cell,top+row*cell,cell,cell);
  ctx.textAlign='center';ctx.fillStyle='#162b48';ctx.font='bold 33px monospace';ctx.fillText(code,360,862);
  ctx.fillStyle='#4e5f77';ctx.font='26px system-ui';ctx.fillText('Show this pass with your college ID.',360,924);
  return canvas.toDataURL('image/png');
}
async function fillTicketQr(code,wave){
  const slot=el('passImage');if(!slot)return;
  try{
    if(typeof qrcode!=='function'){
      qrLibrary=qrLibrary||scriptAsset('assets/qrcode-1.4.4.js').catch(error=>{qrLibrary=null;throw error});
      await qrLibrary;
    }
    if(!slot.isConnected)return;
    slot.innerHTML=qr(code);
    const save=el('savePass');
    if(save){save.href=passPng(code,wave);save.download='Poke-Poker-Night-Wave-'+wave+'.png';save.hidden=false}
  }catch{if(slot.isConnected)slot.textContent='Show the entry code below at the gate.'}
  finally{slot.removeAttribute('aria-busy')}
}
function drawPass(pass){
  currentPass=pass;
  el('content').innerHTML='<div class="narrow">'+(pass.active||pass.used?walletCard(pass,'',true):panel('Attempt closed','<p>This pass has closed. Speak to the event desk.</p>'))+'</div>';
  if(pass.active)fillTicketQr(pass.code,pass.wave);
  scheduleTicketUpdate();
}
function scheduleTicketUpdate(){
  clearTimeout(ticketTimer);
  if(document.hidden||!navigator.onLine)return;
  const paid=currentReceipt?.entryCode||currentPass?.active;
  const waiting=['REGISTERED','REVIEW','WAITLIST'].includes(currentReceipt?.status);
  if(paid||waiting)ticketTimer=setTimeout(updateTicket,paid?6000:18000);
}
let ticketUpdating=false;
async function updateTicket(){
  if(ticketUpdating||document.hidden||!navigator.onLine)return;
  if(busy){scheduleTicketUpdate();return}
  ticketUpdating=true;
  try{
    if(currentPass?.active||currentReceipt?.entryCode){
      const before=currentReceipt,code=mode==='pass'?document.body.dataset.pass:before.entryCode;
      const next=await api('passInfo',code);
      if(next.used||!next.active){
        if(mode==='pass')drawPass(next);
        else if(currentReceipt===before)showReceipt({...before,entryCode:'',seat:next.seat,checkedInAt:next.checkedInAt});
        if(next.seat&&(mode==='pass'||playerSession))el('ticketAnnouncement').textContent='Checked in. '+seatLabel(next.seat)+'. '+seatLocation(next.wave,next.seat);
      }
    }else if(currentReceipt&&['REGISTERED','REVIEW','WAITLIST'].includes(currentReceipt.status)){
      const before=currentReceipt,next=await playerApi('playerStatus',before.ticket);
      if(currentReceipt===before&&(before.status!==next.status||before.canCheckout!==next.canCheckout||before.checkoutEnded!==next.checkoutEnded||before.issue!==next.issue||before.proofVersion!==next.proofVersion)){
        if(before.status===next.status&&el('shot')?.files?.length)return;
        showReceipt(next);
        el('ticketAnnouncement').textContent=next.entryCode?'Payment verified. Your ticket is ready.':'Your registration status has changed.';
      }
    }
    el('net').textContent='';
  }catch{el('net').textContent='Connection interrupted. Reconnecting for ticket updates.'}
  finally{ticketUpdating=false;scheduleTicketUpdate()}
}
function expireCheckout(){
  if(currentReceipt?.status==='HOLD'&&eventNow()>=currentReceipt.expires){
    const expired={...currentReceipt,status:'EXPIRED',upi:'',paymentQr:''};
    if(currentReceipt.receiver&&el('shot')?.files.length){
      currentReceipt=expired;
      const instructions=document.querySelector('.hold-line')?.closest('section');
      if(instructions){instructions.innerHTML='<h2>Hold expired</h2><p>If you already paid, finish submitting your screenshot below. The desk will check your original payment.</p>'}
    }else showReceipt(expired);
    return true;
  }
  return false;
}
