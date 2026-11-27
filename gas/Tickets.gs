function pass_(id){return 'PN-'+mac_('gate:'+id).slice(0,16).toUpperCase().replace(/_/g,'X').replace(/-/g,'Y')}
function normalizeCode_(s){return String(s||'').trim().toUpperCase().replace(/[\s-]/g,'')}
function byCode_(st,s){
  const v=normalizeCode_(s);
  if(!/^PN[A-Z0-9]{16}$/.test(v))return null;
  // Cache only the lookup. Every scan checks the ticket in the current journal.
  const key='ticket-id:'+v;
  let cache;
  try{cache=CacheService.getScriptCache();const a=st.attempts[cache.get(key)];if(a&&issued_(a)&&normalizeCode_(pass_(a.id))===v)return a}catch{}
  const match=Object.values(st.attempts).find(a=>issued_(a)&&normalizeCode_(pass_(a.id))===v);
  if(match&&cache){try{cache.put(key,match.id,21600)}catch{}}
  return match;
}
function passInfo(code){
  const st=ledger_(),a=byCode_(st,code);must_(a,'Invalid ticket');
  const active=ticketActive_(a,st,Date.now());
  return {used:!!a.used,active,wave:a.used?a.wave+1:0,allocation:a.used?'assigned':'desk',seat:a.seat||null,checkedInAt:a.checkedInAt||null,code:active?pass_(a.id):''};
}

const EVENT_MAIL_NAME = 'Poké Poker Night 2026';
const EVENT_PAGE = 'https://pokernight.imtneversleeps.com/event.html';
// Resuming ticket mail requires an explicit owner change. Verification and
// registration never lift the owner's pause or discard the pending delivery.
function passEmailsPaused_(){return props_().getProperty('PASS_EMAIL_DELIVERY')!=='enabled'}
function sendEventMail_(recipient, subject, paragraphs) {
  const body = [...paragraphs, 'Entrepreneurship Cell, IMT Ghaziabad\nYou can reply to this email for help.'].join('\n\n');
  MailApp.sendEmail(recipient, subject, body, {name:EVENT_MAIL_NAME, replyTo:clubOwner_()});
}
function deliverPass_(id,actor,force=false){
  if(passEmailsPaused_())return 'Email delivery paused';
  const plan=locked_(()=>{
    if(passEmailsPaused_())return {status:'Email delivery paused'};
    const st=ledger_(),a=st.attempts[id],now=Date.now();
    must_(a&&issued_(a),'This payment has no authorized ticket.');
    if(force)must_(ticketActive_(a,st,now),'This ticket is no longer available for entry.');
    if(a.mailUntil>now)return {status:'Sending email'};
    if(!force&&a.delivery!=='Pending delivery')return {status:a.delivery||'Desk delivery needed'};
    const slots=pendingMail_(now);
    if(remainingMail_(slots)<=1){
      commit_(st,'Pass delivery',actor,{attempts:[{...a,delivery:'Desk delivery needed'}],note:id});
      return {status:'Desk delivery needed'};
    }
    const ref=rand_().slice(0,16),until=now+6*60000;
    slots[ref]=until;props_().setProperty('MAIL_IN_FLIGHT',JSON.stringify(slots));
    // If the provider acknowledgement is lost, the desk can explicitly resend the same pass.
    commit_(st,'Pass delivery started',actor,{attempts:[{...a,delivery:'Desk delivery needed',mailClaim:ref,mailUntil:until}],note:id});
    return {ref,a};
  },false);
  if(!plan.ref)return plan.status;
  let delivery='Desk delivery needed';
  try{
    const a=plan.a,person=directoryPlayer_(a.roll),code=pass_(id);
    if(person&&emailAddress_(person.email)){
      const subject=EVENT_MAIL_NAME+' '+(a.kind==='retry'?'retry':'entry')+' pass';
      sendEventMail_(person.email,subject,[
        'E-Cell verified your '+formatFee_(a.fee)+' payment for Poké Poker Night.',
        'Your round, table and seat will be allocated at the registration desk according to availability.',
        'Open your private pass to show or save your entry QR.\n'+EVENT_PAGE+'?view=pass#code='+encodeURIComponent(code),
        'You can also give the gate volunteer this code.\n'+code,
        'Bring your college ID on 27 November and keep your pass private.'
      ]);
      delivery='Email sent';
    }
  }catch{console.warn('Pass email delivery was unconfirmed for '+id)}
  return locked_(()=>{
    const st=ledger_(),latest=st.attempts[id],slots=pendingMail_(Date.now());
    delete slots[plan.ref];props_().setProperty('MAIL_IN_FLIGHT',JSON.stringify(slots));
    if(latest.mailClaim!==plan.ref)return latest.delivery;
    // Admission or a detail edit may have been committed while the email was in flight.
    commit_(st,'Pass delivery',actor,{attempts:[{...latest,delivery,mailClaim:'',mailUntil:0}],note:id});
    return delivery;
  },false);
}

function staffPass(token,id,send){
  const staff=staff_(token,['desk']);
  if(send)deliverPass_(id,staff.name,true);
  const st=ledger_(),a=st.attempts[id];
  must_(a&&ticketActive_(a,st,Date.now()),'This ticket is no longer available for entry.');
  const p=a.details||roster_()[a.roll]||{};
  return {code:pass_(id),phone:(p.contact||p.phone||'').replace(/\D/g,''),name:p.fullName||p.name||'',wave:a.used?a.wave+1:0,allocation:a.used?'assigned':'desk',delivery:a.mailUntil>Date.now()?'Sending email':a.delivery==='Pending delivery'&&passEmailsPaused_()?'Email delivery paused':a.delivery};
}
function scannerLink_(token){
  // This capability can only admit tickets. Revoking the parent desk session also revokes the camera.
  const key=hash_(token);
  return EVENT_PAGE+'?view=scan#access='+key+'.'+mac_('camera-admit:'+key);
}
function scanEntryTicket(access,value,op){
  const match=/^([\w-]{43})\.([\w-]{43})$/.exec(access);
  must_(match&&equalDigest_(match[2],mac_('camera-admit:'+match[1])),STAFF_SIGN_IN);
  const session=JSON.parse(props_().getProperty('AUTH_SESSION_'+match[1])||'null');
  const staff=staffClaims_(session,['gate','desk']);
  return admitTicket_(staff,value,op);
}
function admitTicket_(staff,value,op){
  must_(/^[a-zA-Z0-9-]{8,64}$/.test(op),'Invalid gate action.');
  return locked_(()=>{
    const st=ledger_(),a=byCode_(st,value);
    if(!a)return {status:'invalid'};
    if(!a.used&&!ticketActive_(a,st,Date.now()))return {status:'invalid'};
    const player=a.details?.fullName||roster_()[a.roll]?.name||a.roll;
    if(a.used)return {status:'used',player,wave:a.wave+1,seat:a.seat,checkedInAt:a.checkedInAt};
    const wave=deskWaveFor_(st,a.roll);must_(wave>=0,'No qualifier seat is available. Check with the registration desk.');
    const seat=nextSeat_(st,wave),checkedInAt=Date.now();
    const venue={where:'IN',ops:[...(st.venue[a.roll]?.ops||[]).slice(-23),op]};
    commit_(st,'Gate admit',staff.name,{attempts:[{...a,wave,capacityReserved:true,used:true,seat,checkedInAt}],venue:{[a.roll]:venue},note:a.roll});
    return {status:'admitted',player,wave:wave+1,seat,checkedInAt};
  },false);
}
function gateAction(token,action,value,op){
  const s=staff_(token,['gate','desk']);
  if(action==='admit')return admitTicket_(s,value,op);
  must_(['exit','return'].includes(action)&&/^[a-zA-Z0-9-]{8,64}$/.test(op),'Invalid gate action.');
  return locked_(()=>{const st=ledger_(),roll=roll_(value),prior=st.venue[roll]||{where:'NEVER',ops:[]};
    if(prior.ops.includes(op))return 'Already recorded';
    if(action==='exit')must_(prior.where==='IN','This player is not recorded inside.');
    if(action==='return')must_(prior.where==='OUT','A venue return requires an earlier checked-in exit.');
    const where=action==='exit'?'OUT':'IN',v={where,ops:[...prior.ops.slice(-23),op]};
    commit_(st,'Gate '+action,s.name,{venue:{[roll]:v},note:roll});return where==='IN'?'Recorded inside':'Recorded outside';
  });
}
