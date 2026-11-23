'use strict';
const el=id=>document.getElementById(id);
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const val=id=>el(id)?.value.trim()||'';
const mem={get(k){try{return sessionStorage.getItem('pn26:'+k)||''}catch{return ''}},set(k,v){try{sessionStorage.setItem('pn26:'+k,v)}catch{}}};
const durable={get(k){try{return localStorage.getItem('pn26:'+k)||''}catch{return ''}},set(k,v){try{localStorage.setItem('pn26:'+k,v)}catch{}}};
const api=(name,...args)=>new Promise((ok,no)=>google.script.run.withSuccessHandler(ok).withFailureHandler(no)[name](...args));
const mode=document.body.dataset.mode||'register';let token=mem.get('staff'),snapshot,tab='Review',opened,clockEnd=0,busy=false,draft,stream,scanTimer,refreshing=false;
function msg(t='',bad=false){el('msg').textContent=t;el('msg').className='note'+(bad?' error':'')}
function btn(action,label,cls='',id=''){return '<button type="button" data-do="'+action+'" data-id="'+esc(id)+'" class="'+cls+'">'+esc(label)+'</button>'}
function input(id,label,extra=''){return '<label for="'+id+'">'+label+'</label><input id="'+id+'" '+extra+'>'}
function checkbox(id,t){return '<label class="check"><input type="checkbox" id="'+id+'">'+esc(t)+'</label>'}
function panel(t,body){return '<section class="panel"><h2>'+esc(t)+'</h2>'+body+'</section>'}
function rollField(id){return input(id,'College roll number','inputmode="numeric" pattern="[0-9]{9}" maxlength="9" autocomplete="off" placeholder="Nine-digit roll number"')}
function reference(id){return input(id,'Full UPI bank reference','inputmode="numeric" maxlength="12" placeholder="12 digits from the coordinator’s history"')}
function heading(k,t){el('kicker').textContent=k;el('title').textContent=t}
function detail(html){const d=el('dialog');el('detail').innerHTML=html;if(!d.open)d.showModal()}
function stopCamera(){clearInterval(scanTimer);if(stream)stream.getTracks().forEach(t=>t.stop());stream=null}
function closeDetail(){stopCamera();el('dialog').close();opened=null}
el('dialog').addEventListener('close',stopCamera);
function qr(code){const q=qrcode(0,'M');q.addData(code);q.make();return '<div class="qr">'+q.createImgTag(5,4,'Single-use entry QR')+'</div>'}
function nameOf(k){return {pre:'Pre-registration',walk:'Walk-in',retry:'Round 1 retry'}[k]||k}
function localTime(t){return new Date(t).toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit',timeZone:'Asia/Kolkata'})}
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
function login(){heading('STAFF ACCESS','Event desk');el('content').innerHTML='<div class="narrow">'+panel('Staff sign-in',input('staffkey','Private staff key','type="password" autocomplete="current-password"')+'<p class="sub">The coordinator issues individual keys from the private club desk.</p>'+btn('login','Sign in','primary'))+'</div>'}
const roles={Review:['admin','desk'],Gate:['admin','desk','gate'],Tables:['admin','floor'],Settings:['admin'],Audit:['admin']};
function board(b){clockEnd=b.deadline;return '<div class="row"><div><p class="tag">'+esc(b.state)+'</p><h2>'+esc(b.title)+'</h2></div><div class="timer" id="clock"></div></div>'+(b.champion?'<p class="note">Winner · '+esc(b.champion)+'</p>':'')+
  (b.tables.length?'<div class="cols">'+b.tables.map(t=>panel(t.name,'<ol class="board-list">'+t.players.map(p=>'<li>'+esc(p)+'</li>').join('')+'</ol>')).join('')+'</div>':'<p class="sub">The floor manager will publish table assignments when seating starts.</p>')+
  (b.leaderboard.length?panel('Chip leaderboard','<ol>'+b.leaderboard.map(x=>'<li>'+esc(x.alias)+' · '+x.chips.toLocaleString('en-IN')+'</li>').join('')+'</ol>'):'');
}
function tick(){const c=el('clock');if(!c)return;const left=Math.max(0,Math.ceil((clockEnd-Date.now())/1000));c.textContent=clockEnd?Math.floor(left/60)+':'+String(left%60).padStart(2,'0'):'—'}
function recordRow(r){return '<div class="record"><div class="row"><strong>'+esc(r.name||r.roll)+'</strong><span class="tag">'+esc(r.status)+'</span></div><div class="sub">'+esc(r.roll)+' · '+esc(nameOf(r.kind))+(r.wave?' · Wave '+r.wave:'')+(r.fee?' · ₹'+r.fee:'')+'</div>'+
  (r.suffix?'<div>Ref ending <code>'+esc(r.suffix)+'</code></div>':'')+(r.sameImage||r.sameTail?'<div class="danger">'+[r.sameImage?'Same image on another attempt':'',r.sameTail?'Reference suffix also appears elsewhere':''].filter(Boolean).join(' · ')+'</div>':'')+
  (tab==='Review'?btn('inspect','Open attempt','',r.id):'<small>'+esc(r.where==='NEVER'?'Not checked in':r.where)+'</small>')+'</div>'}
function filterRecords(){const q=val('find').toLowerCase(),only=el('filter')?.value||'all',r=snapshot.records.filter(r=>(!q||[r.name,r.roll,r.phone,r.suffix,r.utr,r.id].some(v=>String(v||'').toLowerCase().includes(q)))&&(only==='all'||r.status===only));el('records').innerHTML=r.length?r.map(recordRow).join(''):'<p class="sub">No matching attempts.</p>'}
function staffView(){
  const s=snapshot,allowed=Object.keys(roles).filter(t=>roles[t].includes(s.role));if(!allowed.includes(tab))tab=allowed[0];
  heading(s.label+' · '+s.role.toUpperCase(),'Event desk');
  const savedFind=val('find'),savedFilter=el('filter')?.value||'REVIEW';
  const stats=Object.entries({Inside:s.stats.inside,Outside:s.stats.out,'Checked in':s.stats.checked,'No-shows':s.stats.noShow,'To review':s.stats.pending}).map(([k,v])=>'<div class="stat"><strong>'+v+'</strong>'+k+'</div>').join('');
  let out='<div class="stats">'+stats+'</div><div class="tabs">'+allowed.map(t=>'<button data-do="tab" data-id="'+t+'" aria-current="'+(t===tab)+'">'+t+'</button>').join('')+btn('refresh','Refresh')+btn('logout','Sign out')+'</div>';
  if(tab==='Review')out+='<div class="button-row">'+btn('deskform','Walk-in or paid retry','primary')+btn('studentform','Add missing student details')+'</div>'+panel('Payment queue',input('find','Search by roll, name, phone or reference digits','type="search"')+'<label for="filter">Show</label><select id="filter"><option value="REVIEW">Awaiting review</option><option value="all">All attempts</option><option value="WAITLIST">Waitlist</option><option value="PAID">Paid</option><option value="REJECTED">Rejected</option></select><div id="records" class="reviewlist"></div>');
  if(tab==='Gate')out+=panel('Gate scanner','<label for="gateMode">Action</label><select id="gateMode"><option value="admit">Admit with a single-use code</option><option value="exit">Record exit by roll number</option><option value="return">Record wristband return by roll number</option></select>'+input('gateValue','Entry code or roll number','autocapitalize="characters" autocomplete="off"')+checkbox('gateID','I checked the college ID or assigned wristband.')+btn('gate','Record at gate','primary')+btn('camera','Scan QR')+'<div id="pending"></div>')+panel('Player lookup',input('find','Search by roll, name or phone','type="search"')+'<div id="records" class="reviewlist"></div>');
  if(tab==='Tables'){const g=s.game;out+=panel(g.active?'Stage controls':'Next seating',g.active?g.active.tables.map((t,i)=>btn('table','Enter '+(i+1)+' · '+s.board.tables[i].name,'',String(i))).join('')+btn('finish','Close stage','primary'):g.next<8?btn('preview','Review next draw','primary'):'Tournament complete');out+=board(s.board);}
  if(tab==='Settings'){const p=s.settings;out+=panel('Receiving account',input('upi','Coordinator’s UPI ID','value="'+esc(p.upi)+'"')+input('payname','Recipient name in the UPI app','value="'+esc(p.name)+'"')+'<label class="check"><input id="open" type="checkbox" '+(p.open?'checked':'')+'>Open student registration</label>'+btn('save','Save payment settings','primary'))+
    panel('Volunteer access',input('label','Volunteer name')+'<label for="role">Role</label><select id="role"><option value="desk">Registration desk</option><option value="gate">Gate</option><option value="floor">Floor manager</option><option value="admin">Administrator</option></select>'+btn('newkey','Create staff key')+'<p class="sub">Revoke a key by changing Active to no in the private Staff tab.</p>');}
  if(tab==='Audit')out+=panel('Recent activity',s.audit.map(a=>'<p><b>'+esc(a.action)+'</b> · '+esc(a.actor)+'<br><span class="sub">'+localTime(a.time)+' · '+esc(a.target)+'</span></p>').join('')||'Activity appears here after the first action.');
  el('content').innerHTML=out;if(el('find')){el('find').value=savedFind;if(el('filter'))el('filter').value=savedFilter;filterRecords()}if(el('pending'))queueLabel();tick();
}
async function refresh(){if(refreshing)return;refreshing=true;try{snapshot=await api('staffSnapshot',token);staffView()}finally{refreshing=false}}
function inspect(id){
  const r=snapshot.records.find(x=>x.id===id);opened=id;
  let s='<h2>'+esc(r.name)+'</h2><p>'+esc(r.roll)+' · '+nameOf(r.kind)+' · ₹'+r.fee+' · '+esc(r.status)+'</p>';
  if(r.suffix)s+='<p>Player’s visible reference <code>'+esc(r.suffix)+'</code></p>';
  if(r.sameImage||r.sameTail)s+='<p class="danger">Possible duplicate. Compare the full reference and incoming amount in the coordinator’s account.</p>';
  if(r.image)s+=btn('image','View private screenshot')+'<div id="imgslot"></div>';
  if(r.status==='REVIEW')s+=reference('full')+'<small id="matchTail" role="status"></small>'+checkbox('verified','I checked the incoming credit, exact fee and payer in the coordinator’s account.')+btn('approve','Approve and send code','primary')+btn('move','Move to an open wave')+input('reason','Reason if rejecting proof')+btn('reject','Reject proof');
  if(r.status==='WAITLIST')s+=btn('move','Offer next available seat','primary');
  if(['PAID','QUALIFIED','ELIMINATED','WINNER','NO_SHOW'].includes(r.status)){s+='<p>'+esc(r.delivery)+'</p>'+btn('pass','View code and delivery options');if(r.status==='PAID'&&!r.used)s+=btn('no-show','Mark no-show');}
  detail(s);
}
function deskForm(){detail('<h2>Verify a desk payment</h2>'+rollField('deskroll')+'<label for="kind">Purchase</label><select id="kind"><option value="walk">Walk-in · ₹199</option><option value="retry">Round 1 retry · ₹149</option></select>'+reference('deskref')+checkbox('deskcheck','I checked the college ID and the full incoming payment.')+btn('deskpay','Approve and send code','primary'))}
function queueKey(){return 'gate-queue-'+String(token).split('.')[0]}
function qread(){try{return JSON.parse(durable.get(queueKey())||'[]')}catch{return []}}
function qsave(list){durable.set(queueKey(),JSON.stringify(list))}
function queueLabel(){el('pending').textContent=qread().length?qread().length+' unsynced gate actions. Wait for confirmation before admitting.':''}
let gateSync=null;
function transient(e){return !navigator.onLine||/network|offline|connection|timeout|timed out|temporar|service unavailable|failed to fetch|server error|lock timeout/i.test(e?.message||'')}
async function syncGate(){
  if(!token||!navigator.onLine)return;if(gateSync)return gateSync;
  const owner=token;
  gateSync=(async()=>{let last='';for(const a of qread()){
    if(token!==owner)break;
    try{last=await api('gateAction',owner,a.mode,a.value,a.id)}
    catch(e){if(transient(e)){last='Queued on this device. Wait for server confirmation.';break}
      if(/sign in|staff role/i.test(e.message))throw e;
      qsave(qread().filter(x=>x.id!==a.id));throw e}
    qsave(qread().filter(x=>x.id!==a.id));
  }return last})();try{return await gateSync}finally{gateSync=null;if(el('pending'))queueLabel()}
}
async function gateOp(){if(!el('gateID').checked)throw Error('Check the college ID or wristband first.');const a={mode:val('gateMode'),value:val('gateValue'),id:crypto.randomUUID()};if(!a.value)throw Error('Enter a code or roll number.');
  const queued=qread();if(!queued.some(v=>v.mode===a.mode&&v.value===a.value))qsave([...queued,a]);queueLabel();
  if(!navigator.onLine){msg('Queued on this device. Entry is pending until sync.');return}
  const response=await syncGate();msg(response||'Gate action pending.');if(!qread().length)await refresh();
}
async function camera(){if(!window.BarcodeDetector||!navigator.mediaDevices?.getUserMedia)throw Error('Camera scanning is unavailable here. Enter the code printed below the QR.');
  detail('<h2>Scan entry QR</h2><video id="cam" autoplay playsinline muted></video>');stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:'environment'}});el('cam').srcObject=stream;const reader=new BarcodeDetector({formats:['qr_code']});scanTimer=setInterval(async()=>{try{const v=el('cam');if(!v||v.readyState<2)return;const hits=await reader.detect(v);if(hits[0]){el('gateValue').value=hits[0].rawValue;closeDetail();msg('Code read. Check the student ID before recording entry.')}}catch{}},350)}
function previewDraw(){const options=draft.tables.flat();detail('<h2>'+esc(draft.title)+'</h2><p class="sub">The draw includes checked-in players inside the venue. For a swap, change both seat selections.</p>'+draft.tables.map((t,i)=>'<h3>Table '+(i+1)+'</h3>'+t.map((id,j)=>'<label for="s'+i+'-'+j+'">Seat '+(j+1)+'</label><select id="s'+i+'-'+j+'">'+options.map(x=>'<option value="'+x+'" '+(x===id?'selected':'')+'>'+esc(draft.names[x])+'</option>').join('')+'</select>').join('')).join('')+(options.length?btn('startStage','Start all tables','primary'):draft.n<6?btn('skip','Close empty wave'):'<p>No eligible qualifiers are inside.</p>'))}
function score(index){const h=snapshot.game.active,t=h.tables[index];opened=index;detail('<h2>Table '+(index+1)+' chip counts</h2>'+t.map(id=>input('c'+id,esc(snapshot.records.find(a=>a.id===id)?.name||id),'type="number" min="0" step="1" value="'+(h.chips[id]??'')+'"')).join('')+'<label for="tie">Witnessed tiebreak, if tied</label><select id="tie"><option value="">Choose for a tie only</option>'+t.map(id=>'<option value="'+id+'">'+esc(snapshot.records.find(a=>a.id===id)?.name||id)+'</option>').join('')+'</select>'+btn('score','Save table result','primary'))}
async function action(name,id){
  if(name==='close'){closeDetail();return}if(name==='tab'){tab=id;staffView();return}if(name==='other'){durable.set('receipt','');startPlayer();return}
  if(name==='start'){const r=await api('playerStart',val('roll'),durable.get('receipt'));showReceipt(r);return}
  if(name==='receipt'){showReceipt(await api('playerStatus',durable.get('receipt')));return}
  if(name==='upload'){if(!el('consent').checked)throw Error('Please confirm proof sharing before continuing.');const data=await picture(el('shot').files[0]);showReceipt(await api('playerUpload',durable.get('receipt'),val('tail'),data));return}
  if(name==='login'){const auth=await api('staffLogin',val('staffkey'));token=auth.token;mem.set('staff',token);await refresh();return}
  if(name==='logout'){mem.set('staff','');token='';snapshot=null;login();return}
  if(name==='refresh'){await refresh();return}if(name==='inspect'){inspect(id);return}if(name==='deskform'){deskForm();return}
  if(name==='studentform'){detail('<h2>Verify directory details</h2>'+rollField('newroll')+input('newname','Name on college ID')+input('newmail','Delivery email','type="email"')+input('newphone','WhatsApp number','type="tel"')+checkbox('newid','I verified the college ID and the contact with the student.')+btn('student','Save missing details','primary'));return}
  if(name==='student'){await api('deskStudent',token,val('newroll'),val('newname'),val('newmail'),val('newphone'),el('newid').checked);closeDetail();msg('Directory details saved.');await refresh();return}
  if(name==='image'){const pic=await api('proofImage',token,opened);const im=document.createElement('img');im.className='shot';im.alt='Private payment screenshot';im.src=pic;el('imgslot').replaceChildren(im);return}
  if(name==='approve'){const r=await api('staffApprove',token,opened,val('full'),el('verified').checked);closeDetail();msg('Payment approved. '+r.status);await refresh();return}
  if(name==='deskpay'){const r=await api('deskPayment',token,val('deskroll'),val('kind'),val('deskref'),el('deskcheck').checked);closeDetail();msg('Attempt verified. '+r.status);await refresh();return}
  if(name==='reject'){await api('staffReject',token,opened,val('reason'));closeDetail();msg('Proof rejected. The reason is on the player’s receipt page.');await refresh();return}
  if(name==='move'||name==='no-show'){if(name==='no-show'&&!confirm('Mark this paid player as a no-show and release their seat?'))return;await api('releaseSeat',token,opened,name);closeDetail();msg('Seat updated.');await refresh();return}
  if(name==='pass'||name==='resend'){if(name==='resend'&&!confirm('Email the same code again to the registered address?'))return;
    const p=await api('staffPass',token,opened,name==='resend');const phone=p.phone.length===10?'91'+p.phone:p.phone;
    const share='E-Cell Poker Night: your Round 1 wave '+p.wave+' code is '+p.code+'. Bring your college ID.';
    detail('<h2>Player pass</h2><p>'+esc(p.name)+' · Wave '+p.wave+'</p>'+qr(p.code)+'<p><code>'+esc(p.code)+'</code></p><p>'+esc(p.delivery)+'</p>'+btn('resend','Resend email')+(/^\d{10,15}$/.test(phone)?'<a class="button" href="https://wa.me/'+phone+'?text='+encodeURIComponent(share)+'" target="_blank" rel="noopener">Send via WhatsApp</a>':'')+'<p class="sub">For in-person delivery, verify the college ID.</p>');return}
  if(name==='gate'){await gateOp();return}if(name==='camera'){await camera();return}
  if(name==='preview'){draft=await api('gamePreview',token);previewDraw();return}
  if(name==='startStage'||name==='skip'){if(!confirm(name==='skip'?'Close this empty wave?':'Lock this draw and start all tables?'))return;
    if(name==='skip')await api('skipEmptyWave',token,draft.n);else await api('startStage',token,draft.n,draft.tables.map((t,i)=>t.map((_,j)=>val('s'+i+'-'+j))));closeDetail();await refresh();return}
  if(name==='table'){score(Number(id));return}if(name==='score'){const h=snapshot.game.active,t=h.tables[opened];const values=Object.fromEntries(t.map(id=>[id,val('c'+id)===''?-1:Number(val('c'+id))]));await api('tableResult',token,h.n,opened,values,val('tie'));closeDetail();await refresh();return}
  if(name==='finish'){if(!confirm('Close this stage and advance only the winning player at each table?'))return;await api('finishStage',token,snapshot.game.next);await refresh();return}
  if(name==='save'){await api('adminSettings',token,val('upi'),val('payname'),el('open').checked);msg('Payment settings saved.');await refresh();return}
  if(name==='newkey'){const k=await api('adminAddStaff',token,val('label'),val('role'));detail('<h2>Private volunteer key</h2><p>Give this key to the named volunteer only.</p><code>'+esc(k)+'</code>');return}
}
document.addEventListener('click',async e=>{const b=e.target.closest('[data-do]');if(!b||busy)return;busy=true;b.disabled=true;msg();try{await action(b.dataset.do,b.dataset.id)}catch(err){msg(err.message||'Connection failed. Try again.',true);if(el('dialog').open){let n=el('detail').querySelector('[data-error]');if(!n){n=document.createElement('p');n.className='note error';n.dataset.error='1';el('detail').prepend(n)}n.textContent=err.message}}finally{busy=false;b.disabled=false}});
document.addEventListener('input',e=>{if(e.target.id==='find')filterRecords();if(e.target.id==='full'){
 const r=snapshot.records.find(a=>a.id===opened),v=val('full');el('matchTail').textContent=v.length===12&&r.suffix?(v.endsWith(r.suffix)?'The visible receipt digits match.':'The visible digits differ. Check the bank record.'):'';
}});document.addEventListener('change',e=>{if(e.target.id==='filter')filterRecords()});
async function launch(){try{
  if(mode==='board'){heading('LIVE FLOOR','Tournament floor');el('content').innerHTML=board(await api('liveFloor'));tick();return}
  if(mode==='pass'){heading('TRAINER PASS','Your entry pass');const code=document.body.dataset.pass;if(!/^PN-[A-Z0-9]{16}$/.test(code))throw Error('Open the complete pass link from your email.');const pass=await api('passInfo',code);el('content').innerHTML='<div class="narrow">'+panel(pass.used?'Pass already scanned':pass.active?'Show at the gate':'Attempt closed',(pass.active&&!pass.used?qr(pass.code)+'<p><code>'+esc(pass.code)+'</code></p>':'')+'<p>Round 1 · Wave '+pass.wave+'. Bring your college ID. Use your wristband for a venue return.</p>')+'</div>';return}
  if(mode==='staff'){if(token){try{await refresh();return}catch{mem.set('staff','');token=''}}login();return}
  startPlayer();const ticket=durable.get('receipt');if(ticket){try{showReceipt(await api('playerStatus',ticket));return}catch{durable.set('receipt','')}}
  const p=await api('publicInfo');if(!p.open)msg('Online registration is currently closed. The club will open payments here.');
}catch(e){msg(e.message||'The club desk is temporarily unavailable.',true)}}
addEventListener('online',()=>{el('net').textContent='';if(mode==='staff')syncGate().then(t=>{if(t)msg(t)}).catch(e=>msg(e.message,true))});addEventListener('offline',()=>{el('net').textContent='Offline. Payment approvals and admission confirmations need a connection.'});
setInterval(tick,1000);setInterval(async()=>{if(document.hidden||busy||el('dialog').open||!navigator.onLine)return;try{
  if(mode==='board'){el('content').innerHTML=board(await api('liveFloor'));tick()}
  else if(mode==='staff'&&token&&qread().length){const status=await syncGate();if(status)msg(status)}
  else if(mode==='staff'&&token&&!['INPUT','SELECT','TEXTAREA'].includes(document.activeElement?.tagName)&&!['Gate','Settings'].includes(tab))await refresh();
}catch{el('net').textContent='Connection interrupted. Showing the last update.'}},15000);
launch();
