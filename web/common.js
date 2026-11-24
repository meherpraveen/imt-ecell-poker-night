'use strict';
const el=id=>document.getElementById(id);
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const val=id=>el(id)?.value.trim()||'';
const durable={get(k){try{return localStorage.getItem('pn26:'+k)||''}catch{return ''}},set(k,v){try{localStorage.setItem('pn26:'+k,v)}catch{}}};
let clockEnd=0,busy=false;
function msg(t='',bad=false){el('msg').textContent=t;el('msg').className='note'+(bad?' error':'')}
function btn(action,label,cls='',id=''){return '<button type="button" data-do="'+action+'" data-id="'+esc(id)+'" class="'+cls+'">'+esc(label)+'</button>'}
function input(id,label,extra=''){return '<label for="'+id+'">'+label+'</label><input id="'+id+'" '+extra+'>'}
function checkbox(id,t){return '<label class="check"><input type="checkbox" id="'+id+'">'+esc(t)+'</label>'}
function panel(t,body){return '<section class="panel"><h2>'+esc(t)+'</h2>'+body+'</section>'}
function rollField(id){return input(id,'College roll number','inputmode="numeric" pattern="[0-9]{9}" maxlength="9" autocomplete="off" placeholder="Nine-digit roll number"')}
function signInForm(action,body,label){
  return '<form data-action="'+action+'">'+body+'<button class="primary" type="submit">'+label+'</button></form>';
}
function codeInput(){
  return input('loginCode','Six-digit code','type="text" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" minlength="6" maxlength="6" required placeholder="000000"');
}
let resendTimer;
function startResendTimer(until){
  clearInterval(resendTimer);
  function update(){
    const button=document.querySelector('[data-do="resendCode"]');
    if(!button){clearInterval(resendTimer);return}
    const seconds=Math.max(0,Math.ceil((until-Date.now())/1000));
    button.disabled=seconds>0;
    button.textContent=seconds?'Resend in '+seconds+'s':'Resend code';
    if(!seconds)clearInterval(resendTimer);
  }
  resendTimer=setInterval(update,1000);update();
}
async function picture(file,forPaymentQr=false){
  if(!file||!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size>15*1024*1024)throw Error('Choose a JPEG, PNG or WebP image under 15 MB.');
  const url=URL.createObjectURL(file);
  try{
    const image=new Image();image.src=url;await image.decode();
    const limit=forPaymentQr?1100:1800,scale=Math.min(1,limit/Math.max(image.width,image.height));
    const canvas=document.createElement('canvas');
    canvas.width=Math.max(1,Math.round(image.width*scale));canvas.height=Math.max(1,Math.round(image.height*scale));
    const ctx=canvas.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(image,0,0,canvas.width,canvas.height);
    let data=forPaymentQr===true?canvas.toDataURL('image/png'):canvas.toDataURL('image/jpeg',.83);
    if(forPaymentQr&&data.length>720000)data=canvas.toDataURL('image/jpeg',.9);
    if(data.length>(forPaymentQr?720000:2400000))throw Error(forPaymentQr?'Crop the image around the payment QR and try again.':'Crop the payment receipt and upload a smaller image.');
    return data;
  }finally{URL.revokeObjectURL(url)}
}
function heading(k,t){el('kicker').textContent=k;el('title').textContent=t}
function ticketMatrix(code){const q=qrcode(0,'M');q.addData(code);q.make();return q}
function qr(code){return '<div class="qr">'+ticketMatrix(code).createImgTag(8,32,'Single-use entry QR')+'</div>'}
function localTime(t){return new Date(t).toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit',timeZone:'Asia/Kolkata'})}
function scanTime(t){return new Date(t).toLocaleString('en-IN',{day:'numeric',month:'short',hour:'numeric',minute:'2-digit',second:'2-digit',timeZone:'Asia/Kolkata'})+' IST'}
function seatLabel(seat){return 'Seat '+String(seat).padStart(2,'0')}
function seatLocation(wave,seat){return 'Wave '+wave+' · Table '+Math.ceil(seat/6)}
function skeleton(label){return '<div class="narrow skeleton" role="status"><span class="sr-only">'+esc(label)+'</span><i></i><i></i><i></i></div>'}
function gateResultHtml(result,nextButton){
  const valid=result.status==='admitted',used=result.status==='used';
  const title=valid?'Checked in':used?'Already used':'Invalid ticket';
  return '<section class="gate-result '+(valid?'accepted':'denied')+'" role="status"><div class="result-mark" aria-hidden="true">'+(valid?'✓':'×')+'</div>'+
    '<h2 id="scanResultTitle" tabindex="-1">'+title+'</h2>'+
    (valid||used?'<p class="gate-player">'+esc(result.player)+'</p><div class="seat-result"><strong>'+seatLabel(result.seat)+'</strong><span>'+seatLocation(result.wave,result.seat)+'</span></div>'+
      (used?'<p>First scan · '+esc(scanTime(result.checkedInAt))+'</p>':''):
      '<p>Ask the player to open their verified entry ticket.</p>')+nextButton+'</section>';
}
function fieldError(id,message){
  const field=el(id);if(!field)return;
  let error=el(id+'Error');
  if(!error){error=document.createElement('span');error.className='field-error';error.setAttribute('role','alert');error.id=id+'Error';(field.closest('label.check')||field).after(error)}
  error.textContent=message;field.setAttribute('aria-invalid','true');field.setAttribute('aria-describedby',error.id);field.focus();
}
document.addEventListener('input',e=>{
  const field=e.target;
  if(field.getAttribute('aria-invalid')==='true'){field.removeAttribute('aria-invalid');field.removeAttribute('aria-describedby');el(field.id+'Error')?.remove()}
});
document.addEventListener('invalid',e=>{
  const messages={identifier:'Enter your roll number or registered email.',loginCode:'Enter all six digits from your email.',matchRoll:'Enter your nine-digit roll number.',matchEmail:'Enter the email on your student record.'};
  if(messages[e.target.id]){e.preventDefault();fieldError(e.target.id,messages[e.target.id])}
},true);
function board(b){clockEnd=b.deadline;return '<div class="row"><div><p class="tag">'+esc(b.state)+'</p><h2>'+esc(b.title)+'</h2></div><div class="timer" id="clock"></div></div>'+(b.champion?'<p class="note">Winner · '+esc(b.champion)+'</p>':'')+
  (b.tables.length?'<div class="cols">'+b.tables.map(t=>panel(t.name,'<ol class="board-list">'+t.players.map((p,i)=>'<li'+(t.seats?.[i]?' value="'+t.seats[i]+'"':'')+'>'+esc(p)+'</li>').join('')+'</ol>')).join('')+'</div>':'<p class="sub">The floor manager will publish table assignments when seating starts.</p>')+
  (b.leaderboard.length?panel('Chip leaderboard','<ol>'+b.leaderboard.map(x=>'<li>'+esc(x.alias)+' · '+x.chips.toLocaleString('en-IN')+'</li>').join('')+'</ol>'):'');
}
function tick(){const c=el('clock');if(!c)return;const left=Math.max(0,Math.ceil((clockEnd-Date.now())/1000));c.textContent=clockEnd?Math.floor(left/60)+':'+String(left%60).padStart(2,'0'):'—'}
async function runAction(b,name){
  if(!b||busy)return;
  busy=true;b.disabled=true;b.setAttribute('aria-busy','true');msg();
  const label=b.textContent,progress={requestCode:'Sending code…',resendCode:'Sending…',matchMail:'Checking your details…',ownerCode:'Sending code…',verifyCode:'Verifying…',verifyOwner:'Verifying…',upload:'Submitting…',start:'Saving…',checkout:'Opening payment…',approve:'Saving approval…',save:'Saving…',submitPayment:'Submitting…',bankUpload:'Reading statement…',bankApply:'Applying preview…',bankSaveReceiver:'Checking receiver…',bankApprove:'Authorizing…'};
  if(progress[name])b.textContent=progress[name];
  try{await action(name,b.dataset.id)}
  catch(err){msg(err.message||'Connection failed. Try again.',true);if(el('dialog')?.open){let n=el('detail').querySelector('[data-error]');if(!n){n=document.createElement('p');n.className='note error';n.dataset.error='1';el('detail').prepend(n)}n.textContent=err.message}}
  finally{busy=false;b.disabled=false;b.removeAttribute('aria-busy');if(progress[name]&&b.isConnected)b.textContent=label}
}
document.addEventListener('click',e=>{const b=e.target.closest('[data-do]');if(b)runAction(b,b.dataset.do)});
document.addEventListener('submit',e=>{
  const f=e.target.closest('form[data-action]');if(!f)return;
  e.preventDefault();runAction(f.querySelector('[type="submit"]'),f.dataset.action);
});
setInterval(tick,1000);
