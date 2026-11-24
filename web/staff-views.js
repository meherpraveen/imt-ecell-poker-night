'use strict';

const deskPages={
  Review:{nav:'Payments',title:'Payments',icon:'credit-card',roles:['admin','desk']},
  Gate:{nav:'Gate',title:'Gate check-in',icon:'camera',roles:['admin','desk','gate']},
  Tables:{nav:'Floor',title:'Tournament floor',icon:'grid',roles:['admin','floor']},
  Settings:{nav:'Settings',title:'Settings',icon:'settings',roles:['admin']},
  Audit:{nav:'Activity',title:'Activity',icon:'activity',roles:['admin']}
};
const deskRoles={admin:'Administrator',desk:'Registration desk',gate:'Gate staff',floor:'Floor manager'};
const paymentStates={
  REVIEW:'Awaiting review',REGISTERED:'Awaiting payment',HOLD:'Seat held',EXPIRED:'Hold expired',
  WAITLIST:'Waitlisted',PAID:'Paid',REJECTED:'Rejected',NO_SHOW:'No-show',QUALIFIED:'Qualified',
  ELIMINATED:'Eliminated',WINNER:'Winner'
};
const lookupState={Review:{query:'',status:'REVIEW'},Gate:{query:''}};

function deskIcon(name){
  return '<svg class="desk-icon" aria-hidden="true" focusable="false"><use href="#desk-i-'+name+'"></use></svg>';
}
function deskButton(action,label,icon,cls='',id=''){
  return '<button type="button" data-do="'+action+'" data-id="'+esc(id)+'" class="'+cls+'">'+
    (icon?deskIcon(icon):'')+'<span>'+esc(label)+'</span></button>';
}
function deskSection(title,body,cls=''){
  return '<section class="desk-card '+cls+'"><h2>'+esc(title)+'</h2>'+body+'</section>';
}
function initials(person){
  return String(person||'').trim().split(/\s+/).filter(Boolean).filter((_,i,a)=>i===0||i===a.length-1).map(word=>Array.from(word)[0]).join('').toUpperCase();
}
function deskEmpty(icon,title,hint=''){
  return '<div class="desk-empty">'+deskIcon(icon)+'<strong>'+esc(title)+'</strong>'+(hint?'<p>'+esc(hint)+'</p>':'')+'</div>';
}
function statusName(status){return paymentStates[status]||status}
function waveText(record){return record.wave>0?'Wave '+record.wave:''}
function paymentBadge(r){
  const state=r.sameImage||r.sameTail?'flag':r.status==='REVIEW'?'review':r.status==='PAID'?'paid':'';
  return '<span class="desk-status" data-state="'+state+'">'+(state==='flag'?'Check duplicate':esc(statusName(r.status)))+'</span>';
}
function clearDeskShell(){
  delete document.body.dataset.desk;
  delete document.body.dataset.deskNav;
  for(const id of ['deskTools','deskRail','deskSkip'])el(id).hidden=true;
  el('deskNav').replaceChildren();
  el('deskRole').textContent='';
  el('deskRole').removeAttribute('title');
  el('detail').replaceChildren();
  if(el('deskMainAction'))el('deskMainAction').replaceChildren();
  el('title').removeAttribute('tabindex');
  lookupState.Review={query:'',status:'REVIEW'};lookupState.Gate={query:''};
}
function showDeskShell(allowed){
  const title=el('title'),rail=el('deskRail'),tools=el('deskTools');
  if(!el('deskHeading')){
    const header=document.createElement('div'),actions=document.createElement('div');
    header.id='deskHeading';actions.id='deskMainAction';
    title.before(header);header.append(title,actions);
    const stage=document.querySelector('.stage'),mast=document.querySelector('.top');
    mast.before(el('deskSkip'));stage.before(rail);
    document.querySelector('.appbar').append(tools);
    el('content').before(el('net'),el('msg'));
  }
  document.body.dataset.desk='ready';
  document.body.dataset.deskNav=allowed.length>1?'multiple':'single';
  el('deskSkip').hidden=false;tools.hidden=false;rail.hidden=allowed.length===1;
  el('deskRole').textContent=deskRoles[snapshot.role];
  el('deskRole').title=snapshot.label;
  const nav=el('deskNav');
  if(nav.dataset.items!==allowed.join(',')||!nav.childElementCount){
    nav.dataset.items=allowed.join(',');
    nav.innerHTML=allowed.map(key=>deskButton('tab',deskPages[key].nav,deskPages[key].icon,'desk-nav-item',key)).join('');
  }
  for(const button of nav.children){
    if(button.dataset.id===tab)button.setAttribute('aria-current','page');
    else button.removeAttribute('aria-current');
  }
  title.tabIndex=-1;
  heading('',deskPages[tab].title);
}
function attendance(){
  const rows=[['checked','Checked in'],['inside','Inside now'],['out','Outside'],['noShow','No-shows']];
  return deskSection('Attendance','<dl class="desk-counts">'+rows.map(([key,label])=>
    '<div><dt>'+label+'</dt><dd data-stat="'+key+'">'+snapshot.stats[key]+'</dd></div>').join('')+'</dl>','desk-aside-card');
}
function searchBar(gate=false){
  const label=gate?'Find a player':'Search payments';
  const placeholder=gate?'Name, roll or phone':'Name, roll or reference';
  const state=lookupState[tab];
  const search='<label class="desk-search" for="find">'+deskIcon('search')+'<span class="sr-only">'+label+'</span>'+
    '<input type="search" id="find" placeholder="'+placeholder+'" autocomplete="off" value="'+esc(state.query)+'"></label>';
  if(gate)return '<div class="desk-filters">'+search+'</div>';
  const statuses=[['REVIEW','Awaiting review'],['all','All payments'],...Object.entries(paymentStates).filter(([key])=>key!=='REVIEW')];
  return '<div class="desk-filters">'+search+'<div class="desk-select"><label class="sr-only" for="filter">Payment status</label>'+
    '<select id="filter">'+statuses.map(([key,name])=>'<option value="'+key+'"'+(key===state.status?' selected':'')+'>'+esc(name)+'</option>').join('')+
    '</select>'+deskIcon('chevron-down')+'</div></div>';
}
function personRow(r){
  const gate=tab==='Gate',name=r.name||r.roll;
  const mark='<span class="desk-avatar" aria-hidden="true">'+(r.name?esc(initials(r.name)):deskIcon('user'))+'</span>';
  const info='<span class="desk-person"><strong>'+esc(name)+'</strong><small>'+esc([r.name?r.roll:'',waveText(r)].filter(Boolean).join(' · '))+'</small></span>';
  if(gate){
    const issued=['PAID','QUALIFIED','ELIMINATED','WINNER','NO_SHOW'].includes(r.status);
    const where={IN:'Inside',OUT:'Outside',NEVER:issued?'Not checked in':statusName(r.status)};
    return '<li class="desk-player-row">'+mark+info+'<span class="desk-row-meta">'+
      (r.seat?'<strong>'+esc(seatLabel(r.seat))+'</strong>':'')+'<small>'+esc(where[r.where]||'Not checked in')+'</small></span></li>';
  }
  const secondary=r.suffix&&lookupState.Review.status!=='all'&&!r.sameImage&&!r.sameTail
    ?'<small>Ref ··'+esc(r.suffix)+'</small>':paymentBadge(r);
  return '<li><button class="desk-payment-row" type="button" data-do="inspect" data-id="'+esc(r.id)+'" aria-label="Open payment for '+esc(name)+'" aria-describedby="record-'+esc(r.id)+'">'+
    mark+info+'<span class="desk-row-meta" id="record-'+esc(r.id)+'"><strong>'+esc(formatFee_(r.fee))+'</strong>'+secondary+'</span>'+deskIcon('chevron-right')+'</button></li>';
}
function filterRecords(){
  if(!el('records'))return;
  const gate=tab==='Gate',state=lookupState[tab];
  state.query=el('find').value;if(!gate)state.status=el('filter').value;
  const query=state.query.trim().toLowerCase();
  const records=snapshot.records.filter(r=>{
    if(!gate&&state.status!=='all'&&r.status!==state.status)return false;
    const values=gate?[r.name,r.roll,r.phone]:[r.name,r.roll,r.phone,r.suffix,r.utr,r.id];
    return !query||values.some(value=>String(value||'').toLowerCase().includes(query));
  });
  if(!gate&&state.status==='REVIEW')records.reverse();
  const active=document.activeElement,activeId=active?.dataset.do==='inspect'?active.dataset.id:'';
  const list=el('records');
  list.innerHTML=records.map(personRow).join('');
  list.hidden=!records.length;
  const empty=el('deskEmpty');
  empty.innerHTML=records.length?'':query?deskEmpty('search','No matches','Try another name or roll number.'):
    gate?deskEmpty('users','No ticket holders yet','Players appear here when their tickets are issued.'):
    state.status==='REVIEW'?deskEmpty('check-circle','All payments reviewed','New payment submissions will appear here.'):
    deskEmpty('inbox','No payments in this view');
  if(activeId){
    const restored=Array.from(list.querySelectorAll('[data-do="inspect"]')).find(button=>button.dataset.id===activeId);
    (restored||el('find')).focus({preventScroll:true});
  }
  const count=el('deskListCount');
  count.textContent=String(records.length);
  el('deskResultCount').textContent=records.length+' '+(gate?'player':'payment')+(records.length===1?'':'s');
}
function recordList(title,gate=false){
  return '<section class="desk-card desk-list-card"><div class="desk-card-heading"><h2>'+title+'</h2><span id="deskListCount" class="desk-number" aria-hidden="true"></span></div>'+
    searchBar(gate)+'<span id="deskResultCount" class="sr-only" role="status"></span><ul id="records" class="desk-records" aria-label="'+title+'"></ul><div id="deskEmpty"></div></section>';
}
function deskLink(action,label,icon){
  return '<button type="button" class="desk-link" data-do="'+action+'">'+deskIcon(icon)+'<span>'+esc(label)+'</span>'+deskIcon('chevron-right')+'</button>';
}
function paymentsView(){
  const actions=deskSection('At the desk',bankDeskLinks()+deskLink('deskform','Walk-in or paid retry','credit-card')+
    deskLink('studentform','Add missing student details','user-plus'),'desk-aside-card desk-links');
  return '<div class="desk-columns desk-payments">'+actions+recordList('Payment queue')+attendance()+'</div>';
}
function setPaymentAction(){
  const area=el('deskMainAction');
  const pending=snapshot.records.some(r=>r.status==='REVIEW');
  if(pending&&!area.childElementCount)area.innerHTML=deskButton('nextPayment','Review next payment','arrow-right','primary desk-forward');
  if(!pending)area.replaceChildren();
  document.querySelector('[data-do="deskform"]')?.classList.toggle('desk-link-primary',!pending);
}
function gateView(){
  const scan='<section class="desk-card desk-feature"><div class="desk-emblem">'+deskIcon('camera')+'</div>'+
    '<h2>Scan a ticket</h2><p>Check the player’s college ID, then scan their QR code to assign a seat.</p>'+
    '<a class="button primary desk-forward" href="'+esc(snapshot.scannerUrl)+'" target="_blank" rel="noopener noreferrer">'+deskIcon('camera')+'<span>Scan entry QR</span><span class="sr-only"> (opens in a new tab)</span></a>'+
    '<details class="desk-disclosure"><summary>Enter a code or record a venue return'+deskIcon('chevron-down')+'</summary><div>'+
    '<label for="gateMode">Action</label><select id="gateMode"><option value="admit">Admit with an entry code</option><option value="exit">Record exit by roll number</option><option value="return">Record wristband return by roll number</option></select>'+
    input('gateValue','Entry code or roll number','autocapitalize="characters" autocomplete="off"')+
    checkbox('gateID','I checked the college ID or assigned wristband.')+btn('gate','Record at gate')+'</div></details>'+
    '<div id="pending" role="status"></div></section>';
  return '<div class="desk-columns"><div class="desk-stack">'+scan+recordList('Player lookup',true)+'</div><div class="desk-side">'+attendance()+'</div></div>';
}
function floorTables(b,active){
  if(!b.tables.length)return '';
  const rows=b.tables.map((t,i)=>{
    const no=active?.tableNumbers?.[i]||(t.seats?.[0]?Math.ceil(t.seats[0]/6):i+1);
    const title='Table '+no+' · '+t.name;
    const seatList=t.players.map((alias,j)=>{
      const player=active?snapshot.records.find(r=>r.id===active.tables[i][j])?.name||alias:alias;
      return '<li><span>'+esc(t.seats?.[j]?seatLabel(t.seats[j]):'Seat '+(j+1))+'</span> '+esc(player)+'</li>';
    }).join('');
    const action=active?'<button type="button" class="desk-table-action" data-do="table" data-id="'+i+'">'+
      (t.winner?'Edit result':'Enter result')+'<span class="sr-only"> for '+esc(title)+'</span></button>':'';
    return '<article class="desk-table"><h3>'+esc(title)+'</h3><p>'+t.players.length+' seated'+(t.winner?' · Result saved':'')+'</p>'+
      '<details class="desk-disclosure"><summary>Seats<span class="sr-only"> at '+esc(title)+'</span>'+deskIcon('chevron-down')+'</summary><ul class="desk-seats">'+seatList+'</ul></details>'+action+'</article>';
  }).join('');
  return '<section class="desk-card"><h2>'+(active?'Active tables':'Last seating')+'</h2><div class="desk-table-grid">'+rows+'</div></section>';
}
function syncFloorClock(board){
  clockEnd=board.deadline?Date.now()+board.deadline-board.now:0;
  tick();
}
function floorView(){
  const g=snapshot.game,b=snapshot.board,active=g.active,complete=g.next>=8;
  syncFloorClock(b);
  const heading=active?b.title:complete?'Tournament complete':b.next;
  let action='',summary='';
  if(active){
    const count=active.winners.length,total=active.tables.length;
    summary=count+' of '+total+' table results recorded.';
    if(count===total)action=btn('finish','Close stage','primary');
    else action=deskButton('table','Enter next result','arrow-right','primary desk-forward',String(b.tables.findIndex(t=>!t.winner)));
  }else if(complete)summary=b.champion?'Winner · '+b.champion:'All stages are closed.';
  else{summary='Review the seating before you open the tables.';action=deskButton('preview','Review next draw','arrow-right','primary desk-forward')}
  const stage='<section class="desk-card desk-feature"><div class="desk-feature-top"><span class="desk-small-label">'+
    deskIcon(active?'clock':'grid')+(active?'In play':complete?'Final result':'Next stage')+'</span>'+
    (active?'<span class="desk-clock" role="timer" aria-label="Time remaining" id="clock"></span>':'')+'</div>'+
    '<h2>'+esc(heading)+'</h2><p>'+esc(summary)+'</p>'+action+'</section>';
  const ranked=b.leaderboard.length?deskSection('Chip leaderboard','<ol class="desk-ranks">'+b.leaderboard.map(p=>'<li><span>'+esc(p.alias)+'</span><strong>'+p.chips.toLocaleString('en-IN')+'</strong></li>').join('')+'</ol>','desk-aside-card'):'';
  return '<div class="desk-columns"><div class="desk-stack">'+stage+floorTables(b,active)+'</div><div class="desk-side">'+attendance()+ranked+'</div></div>';
}
function deskSwitch(id,label,checked){
  return '<label class="desk-switch"><span>'+esc(label)+'</span><input type="checkbox" id="'+id+'"'+(checked?' checked':'')+'></label>';
}
function settingsView(){
  const p=snapshot.settings;
  const legacy=deskSwitch('open','Accept registrations',p.open)+'<div class="desk-form-group"><h3>Payment recipient</h3>'+
    input('payname','Recipient name shown by the UPI app','value="'+esc(p.name)+'"')+
    input('upi','Coordinator’s UPI ID','placeholder="Optional with a payment QR" value="'+esc(p.upi)+'"')+
    '<label for="paymentQr">Upload payment QR</label><input type="file" id="paymentQr" accept="image/png,image/jpeg,image/webp" aria-describedby="deskQrHelp">'+
    '<p id="deskQrHelp" class="desk-hint">Use a QR that lets the player enter the fee.</p><img class="payment-preview" id="qrPreview" alt="Payment QR preview" hidden>'+
    (p.hasQr?btn('showPaymentQr','Preview saved QR')+checkbox('removeQr','Remove the saved QR when I save'):'')+'</div>'+
    deskSwitch('publish','Publish payment details to players',p.published)+'<div class="desk-form-actions">'+btn('save','Save payment settings','primary')+'</div>';
  const settings=(snapshot.managed?deskSwitch('open','Accept registrations',p.open)+btn('save','Save registration setting'):'')+receiverSettings(p)+(snapshot.managed?'':legacy);
  const access=input('label','Volunteer name','autocomplete="off"')+'<label for="role">Role</label><select id="role"><option value="desk">Registration desk</option><option value="gate">Gate</option><option value="floor">Floor manager</option></select>'+
    btn('newkey','Create staff invitation')+'<p class="desk-hint">To revoke a key, set Active to no in the private Staff sheet.</p>';
  return '<div class="desk-columns desk-settings"><div>'+deskSection('Registration and payments',settings)+'</div><div>'+deskSection('Volunteer access',access,'desk-access')+'</div></div>';
}
function activityView(){
  if(!snapshot.audit.length)return deskSection('Recent activity',deskEmpty('clock','No activity yet','Recorded actions will appear here.'));
  const date=new Intl.DateTimeFormat('en-IN',{day:'numeric',month:'short',year:'numeric',timeZone:'Asia/Kolkata'});
  let last='';
  const rows=snapshot.audit.map(a=>{
    const day=date.format(a.time),group=day===last?'':'<li class="desk-day">'+esc(day)+'</li>';last=day;
    const player=snapshot.records.find(r=>r.id===a.target||r.roll===a.target);
    const target=player?(player.name||player.roll):a.target;
    return group+'<li class="desk-activity-row">'+deskIcon('activity')+'<div><strong>'+esc(a.action)+'</strong><small>'+esc([a.actor,target].filter(Boolean).join(' · '))+'</small></div><time datetime="'+new Date(a.time).toISOString()+'">'+esc(localTime(a.time))+'</time></li>';
  }).join('');
  return '<section class="desk-card desk-journal"><h2>Recent activity</h2><ul>'+rows+'</ul></section>';
}
function staffView(){
  const allowed=Object.keys(deskPages).filter(key=>deskPages[key].roles.includes(snapshot.role));
  if(!allowed.includes(tab))tab=allowed[0];
  showDeskShell(allowed);
  delete el('content').dataset.modified;
  const render={Review:paymentsView,Gate:gateView,Tables:floorView,Settings:settingsView,Audit:activityView};
  el('deskMainAction').replaceChildren();
  el('content').innerHTML=render[tab]();
  if(tab==='Review')setPaymentAction();
  if(el('find'))filterRecords();
  if(el('pending'))queueLabel();
  tick();
}
