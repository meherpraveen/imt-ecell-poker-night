'use strict';
const mem={get(k){try{return sessionStorage.getItem('pn26:'+k)||''}catch{return ''}},set(k,v){try{sessionStorage.setItem('pn26:'+k,v)}catch{}}};
const invite=document.body.dataset.invite,sessionKey='staff:'+invite;
let token=mem.get(sessionKey),snapshot,tab='Review',opened,draft,stream,scanTimer,refreshing=false;
function reference(id){return input(id,'Full UPI bank reference','inputmode="numeric" maxlength="12" placeholder="12 digits from the coordinator’s history"')}
function detail(html){const d=el('dialog');el('detail').innerHTML=html;if(!d.open)d.showModal()}
function stopCamera(){clearInterval(scanTimer);if(stream)stream.getTracks().forEach(t=>t.stop());stream=null}
function closeDetail(){stopCamera();el('dialog').close();opened=null}
el('dialog').addEventListener('close',stopCamera);
function nameOf(k){return {pre:'Pre-registration',walk:'Walk-in',retry:'Round 1 retry'}[k]||k}
function login(){heading('STAFF ACCESS','Event desk');el('content').innerHTML='<div class="narrow">'+panel('Staff sign-in',input('staffkey','Private staff key','type="password" autocomplete="current-password"')+'<p class="sub">The coordinator issues individual keys from the private club desk.</p>'+btn('login','Sign in','primary'))+'</div>'}
const roles={Review:['admin','desk'],Gate:['admin','desk','gate'],Tables:['admin','floor'],Settings:['admin'],Audit:['admin']};
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
    panel('Volunteer access',input('label','Volunteer name')+'<label for="role">Role</label><select id="role"><option value="desk">Registration desk</option><option value="gate">Gate</option><option value="floor">Floor manager</option><option value="admin">Administrator</option></select>'+btn('newkey','Create staff invitation')+'<p class="sub">Revoke a key by changing Active to no in the private Staff tab.</p>');}
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
  if(name==='close'){closeDetail();return}if(name==='tab'){tab=id;staffView();return}
  if(name==='login'){const auth=await api('staffLogin',val('staffkey'),invite);token=auth.token;mem.set(sessionKey,token);await refresh();return}
  if(name==='logout'){mem.set(sessionKey,'');token='';snapshot=null;login();return}
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
    detail('<h2>Player pass</h2><p>'+esc(p.name)+' · Wave '+p.wave+'</p>'+qr(p.code)+'<p><code>'+esc(p.code)+'</code></p><p>'+esc(p.delivery)+'</p>'+btn('resend','Resend email')+(/^\d{10,15}$/.test(phone)?'<a class="button" href="https://wa.me/'+phone+'?text='+encodeURIComponent(share)+'" target="_blank" rel="noopener noreferrer">Send via WhatsApp</a>':'')+'<p class="sub">For in-person delivery, verify the college ID.</p>');return}
  if(name==='gate'){await gateOp();return}if(name==='camera'){await camera();return}
  if(name==='preview'){draft=await api('gamePreview',token);previewDraw();return}
  if(name==='startStage'||name==='skip'){if(!confirm(name==='skip'?'Close this empty wave?':'Lock this draw and start all tables?'))return;
    if(name==='skip')await api('skipEmptyWave',token,draft.n);else await api('startStage',token,draft.n,draft.tables.map((t,i)=>t.map((_,j)=>val('s'+i+'-'+j))));closeDetail();await refresh();return}
  if(name==='table'){score(Number(id));return}if(name==='score'){const h=snapshot.game.active,t=h.tables[opened];const values=Object.fromEntries(t.map(id=>[id,val('c'+id)===''?-1:Number(val('c'+id))]));await api('tableResult',token,h.n,opened,values,val('tie'));closeDetail();await refresh();return}
  if(name==='finish'){if(!confirm('Close this stage and advance only the winning player at each table?'))return;await api('finishStage',token,snapshot.game.next);await refresh();return}
  if(name==='save'){await api('adminSettings',token,val('upi'),val('payname'),el('open').checked);msg('Payment settings saved.');await refresh();return}
  if(name==='newkey'){
    const access=await api('adminAddStaff',token,val('label'),val('role'),true);
    detail('<h2>Volunteer invitation</h2><p>Share both items privately with the named volunteer.</p>'+input('inviteUrl','Private desk link','readonly value="'+esc(access.url)+'"')+input('inviteKey','Sign-in key','readonly value="'+esc(access.key)+'"'));
  }
}
document.addEventListener('input',e=>{if(e.target.id==='find')filterRecords();if(e.target.id==='full'){
 const r=snapshot.records.find(a=>a.id===opened),v=val('full');el('matchTail').textContent=v.length===12&&r.suffix?(v.endsWith(r.suffix)?'The visible receipt digits match.':'The visible digits differ. Check the bank record.'):'';
}});document.addEventListener('change',e=>{if(e.target.id==='filter')filterRecords()});
async function launch(){
  if(token){try{await refresh();return}catch{mem.set(sessionKey,'');token=''}}
  login();
}
addEventListener('online',()=>{el('net').textContent='';syncGate().then(t=>{if(t)msg(t)}).catch(e=>msg(e.message,true))});
addEventListener('offline',()=>{el('net').textContent='Offline. Payment approvals and admission confirmations need a connection.'});
setInterval(async()=>{
  if(document.hidden||busy||el('dialog').open||!navigator.onLine||!token)return;
  try{
    if(qread().length){const status=await syncGate();if(status)msg(status)}
    else if(!['INPUT','SELECT','TEXTAREA'].includes(document.activeElement?.tagName)&&!['Gate','Settings'].includes(tab))await refresh();
  }catch{el('net').textContent='Connection interrupted. Showing the last update.'}
},15000);
launch();
