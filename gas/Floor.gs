const TABLES=['Ember','Tide','Grove','Volt','Frost','Dusk'];
function alias_(id){return 'Trainer '+id.slice(0,5).toUpperCase()}
function seated_(st,n){
  const inside=a=>a&&st.venue[a.roll]&&st.venue[a.roll].where==='IN';
  if(n<6)return Object.values(st.attempts).filter(a=>a.wave===n&&a.status==='PAID'&&a.used&&inside(a)).sort((a,b)=>a.created-b.created).map(a=>a.id);
  const prior=n===6?st.game.history.filter(h=>h.n<6):st.game.history.filter(h=>h.n===6);
  return prior.flatMap(h=>h.winners).filter(id=>{const a=st.attempts[id];return a&&a.status==='QUALIFIED'&&inside(a)});
}
function layout_(st,n,ids){
  const count=n===7?1:Math.min(6,Math.max(1,Math.ceil(ids.length/6))),tables=Array.from({length:count},()=>[]);
  const previous=new Map();
  for(const h of st.game.history)for(const t of h.tables)for(const id of t)previous.set(id,new Set([...(previous.get(id)||[]),...t]));
  // Seed different earlier tables across the new tables. Equal sizes outrank repeat avoidance at the final seat.
  for(const id of ids){
    const table=tables.map((seats,i)=>({seats,i,repeats:seats.filter(x=>(previous.get(id)||new Set()).has(x)).length}))
        .filter(t=>t.seats.length<6).sort((a,b)=>a.seats.length-b.seats.length||a.repeats-b.repeats||a.i-b.i)[0];
    if(table)table.seats.push(id);
  }
  return tables;
}
function publicFloor_(st){
  const g=st.game,h=g.active||g.history[g.history.length-1];
  const ranks=(h?Object.entries(h.chips||{}):[]).sort((a,b)=>b[1]-a[1]).map(([id,chips])=>({alias:alias_(id),chips}));
  return {now:Date.now(),title:h?stageName_(h.n):'Round 1 · Qualifiers',state:g.active?'Running':g.next===8?'Finished':g.history.length?'Between rounds':'Awaiting first seating',
    deadline:g.active?g.active.deadline:0,next:g.next<8?stageName_(g.next):'',tables:h?h.tables.map((t,i)=>({name:TABLES[i],players:t.map(alias_),winner:(h.winners||[]).some(id=>t.includes(id))})):[],
    leaderboard:ranks.slice(0,12),champion:g.next===8&&h.winners.length?alias_(h.winners[0]):''};
}
function cacheFloorChange_(st){
  try{
    const revision=rand_();
    CacheService.getScriptCache().put('public-floor:'+revision,JSON.stringify(publicFloor_(st)),30);
    props_().setProperty('FLOOR_REVISION',revision);
  }catch{/* A cache failure cannot undo a recorded table result. */}
}
function liveFloor(){
  let key,cache;
  try{
    key='public-floor:'+(props_().getProperty('FLOOR_REVISION')||'initial');
    cache=CacheService.getScriptCache();const cached=cache.get(key);
    if(cached)return {...JSON.parse(cached),now:Date.now()};
  }catch{/* Read the journal when the cache is unavailable. */}
  const current=publicFloor_(ledger_());
  try{if(cache)cache.put(key,JSON.stringify(current),30)}catch{}
  return current;
}
function gamePreview(token){staff_(token,['floor']);const st=ledger_(),n=st.game.next;must_(n<8&&!st.game.active,'Finish the current stage first.');const ids=seated_(st,n),people=roster_();return {n,title:stageName_(n),tables:layout_(st,n,ids),names:Object.fromEntries(ids.map(id=>[id,people[st.attempts[id].roll]?.name||alias_(id)]))}}
function startStage(token,n,tables){
  const staff=staff_(token,['floor']);return locked_(()=>{const st=ledger_(),g=st.game;must_(n===g.next&&n<8&&!g.active,'The floor has changed. Refresh the draw.');
    const ids=seated_(st,n),all=tables.flat();
    must_(Array.isArray(tables)&&tables.length>=1&&tables.length<=(n===7?1:6)&&tables.every(t=>Array.isArray(t)&&t.length>=1&&t.length<=6),'Use 1–6 seats at each active table.');
    must_(all.length===ids.length&&new Set(all).size===all.length&&ids.every(id=>all.includes(id)),'Use each eligible, checked-in player exactly once. Refresh the draw after a gate change.');
    const now=Date.now(),active={n,tables,started:now,deadline:now+(n===7?60:30)*60000,chips:{},winners:[]};
    commit_(st,'Stage started',staff.name,{game:{...g,active},note:stageName_(n)});return true;
  });
}
function skipEmptyWave(token,n){const s=staff_(token,['floor']);return locked_(()=>{const st=ledger_(),g=st.game;
  must_(n===g.next&&n<6&&!g.active&&!seated_(st,n).length,'Only an empty Round 1 wave can be closed without play.');
  const affected=Object.values(st.attempts).filter(a=>a.wave===n&&a.status==='PAID').map(a=>({...a,status:'NO_SHOW'}));
  commit_(st,'Empty wave closed',s.name,{attempts:affected,game:{...g,next:n+1,history:[...g.history,{n,tables:[],winners:[],chips:{}}]},note:stageName_(n)});return true})}
function tableResult(token,n,index,counts,tieWinner){
  const s=staff_(token,['floor']);return locked_(()=>{const st=ledger_(),g=st.game,h=g.active;must_(h&&h.n===n,'This stage has already closed.');
    const ids=h.tables[index];must_(ids&&counts&&Object.keys(counts).length===ids.length,'Enter every stack at this table.');
    ids.forEach(id=>must_(Number.isSafeInteger(counts[id])&&counts[id]>=0,'Enter whole, non-negative chip counts.'));
    must_(ids.reduce((sum,id)=>sum+counts[id],0)===10000*ids.length,'The table total must equal 10,000 starting chips per player.');
    const high=Math.max(...ids.map(id=>counts[id])),leaders=ids.filter(id=>counts[id]===high);
    must_(leaders.length===1||leaders.includes(tieWinner),'Confirm the witnessed tiebreak winner from the tied chip leaders.');
    const winner=leaders.length===1?leaders[0]:tieWinner;
    const active={...h,chips:{...h.chips,...counts},winners:[...h.winners.filter(id=>!ids.includes(id)),winner]};
    commit_(st,'Table result',s.name,{game:{...g,active},note:stageName_(n)+' · '+TABLES[index]});return true;
  });
}
function finishStage(token,n){
  const s=staff_(token,['floor']);return locked_(()=>{const st=ledger_(),g=st.game,h=g.active;
    must_(h&&h.n===n&&h.winners.length===h.tables.length,'Record one chip leader at every table before closing the stage.');
    const seats=h.tables.flat();const changed=seats.map(id=>({...st.attempts[id],status:h.winners.includes(id)?(n===7?'WINNER':'QUALIFIED'):'ELIMINATED'}));
    if(n<6){for(const a of Object.values(st.attempts))if(a.wave===n&&a.status==='PAID'&&!seats.includes(a.id))changed.push({...a,status:'NO_SHOW'})}
    else{for(const a of Object.values(st.attempts))if(a.status==='QUALIFIED'&&!seats.includes(a.id))changed.push({...a,status:'NO_SHOW'})}
    commit_(st,'Stage closed',s.name,{attempts:changed,game:{next:n+1,active:null,history:[...g.history,h]},note:stageName_(n)});return true;
  });
}
function staffSnapshot(token){
  const staff=staff_(token,['desk','gate','floor']),st=ledger_(),as=Object.values(st.attempts),places=Object.values(st.venue);
  const finance=['admin','desk'].includes(staff.role),floor=['admin','floor'].includes(staff.role);
  const students=as.length?roster_():{},digestHits={},suffixHits={};
  for(const a of as){if(a.digest)digestHits[a.digest]=(digestHits[a.digest]||0)+1}
  for(const a of as){if(!a.suffix)continue;const end=a.suffix.slice(-4);suffixHits[end]=(suffixHits[end]||0)+1}
  const records=as.slice().reverse().filter(a=>finance||issued_(a)).map(a=>{
    const r={id:a.id,roll:a.roll,name:students[a.roll]?.name||'',kind:a.kind,status:a.status==='HOLD'&&a.expires<=Date.now()?'EXPIRED':a.status,wave:a.wave+1,used:a.used,where:st.venue[a.roll]?.where||'NEVER'};
    if(finance||staff.role==='gate')r.phone=students[a.roll]?.phone||'';
    if(finance)Object.assign(r,{fee:a.fee,suffix:a.suffix||'',utr:a.utr||'',image:!!a.file,sameImage:!!(a.digest&&digestHits[a.digest]>1),sameTail:!!(a.suffix&&suffixHits[a.suffix.slice(-4)]>1),delivery:a.delivery||''});
    return r;
  });
  return {role:staff.role,label:staff.name,records,stats:{checked:places.length,inside:places.filter(v=>v.where==='IN').length,out:places.filter(v=>v.where==='OUT').length,
    noShow:new Set(as.filter(a=>a.status==='NO_SHOW').map(a=>a.roll)).size,pending:as.filter(a=>a.status==='REVIEW').length},
    board:publicFloor_(st),game:floor?{next:st.game.next,active:st.game.active}:null,
    settings:staff.role==='admin'?adminSettingsView_(settings_()):null,audit:staff.role==='admin'?st.audit.slice().reverse():[]};
}
function adminSettingsView_(s){
  const version=mac_('payment-settings:'+JSON.stringify([s.upi,s.name,s.open,s.qrFile,s.published]));
  return {upi:s.upi,name:s.name,open:s.open,hasQr:!!s.qrFile,published:s.published,version};
}
function paymentQrFile_(id){
  const file=DriveApp.getFileById(id);
  must_(/^event-payment-qr-[a-f0-9]{32}\.(png|jpg)$/.test(file.getName()),'The payment QR is unavailable.');
  const folderId=props_().getProperty('FOLDER'),parents=file.getParents();
  while(parents.hasNext()){if(parents.next().getId()===folderId)return file}
  throw Error('The payment QR is outside the club folder.');
}
function paymentQrData_(id){
  const blob=paymentQrFile_(id).getBlob(),mime=blob.getContentType();
  must_(mime==='image/png'||mime==='image/jpeg','The payment QR is unavailable.');
  return 'data:'+mime+';base64,'+Utilities.base64Encode(blob.getBytes());
}
function adminPaymentQr(token){
  staff_(token,[]);
  return locked_(()=>{const id=settings_().qrFile;return id?paymentQrData_(id):''});
}
function adminSettings(token,upi,name,open,options){
  const admin=staff_(token,[]);upi=String(upi||'').trim().toLowerCase();name=String(name||'').trim();
  must_(!upi||/^[a-z0-9][a-z0-9._-]{1,127}@[a-z][a-z0-9.-]{1,63}$/.test(upi),'Check the receiving UPI ID.');
  must_(typeof open==='boolean'&&name.length<=100&&!/^[=+@-]/.test(name),'Check the recipient name and registration setting.');
  const change=options||{};
  must_(!options||(typeof change.published==='boolean'&&typeof change.version==='string'),'Refresh payment settings before saving.');
  must_(!change.qr||(typeof change.qr==='string'&&change.qr.length<=720000&&!change.removeQr),'Choose one payment QR image under 525 KB.');
  return locked_(()=>{
    const old=settings_();
    must_(!options||change.version===adminSettingsView_(old).version,'Payment settings changed. Refresh before saving.');
    const published=options?change.published:!!(open&&name&&(upi||old.qrFile));
    const keep=change.removeQr?'':old.qrFile;
    must_(!published||(name&&(upi||keep||change.qr)),'To publish payments, enter the recipient name and add a UPI ID or payment QR.');
    must_(!open||Object.keys(roster_()).length,'Import the student directory before opening.');
    let added;
    if(change.qr){
      const image=imageBytes_(change.qr);
      const fileName='event-payment-qr-'+rand_()+'.'+image.ext;
      added=DriveApp.getFolderById(props_().getProperty('FOLDER')).createFile(Utilities.newBlob(image.bytes,image.mime,fileName));
    }
    const next={upi,name,open,published,qrFile:added?added.getId():keep};
    try{writeSettings_(next);SpreadsheetApp.flush()}
    catch(error){if(added&&settings_().qrFile!==added.getId())added.setTrashed(true);throw error}
    if(old.qrFile&&old.qrFile!==next.qrFile){
      try{paymentQrFile_(old.qrFile).setTrashed(true)}catch{console.warn('Could not archive a superseded payment QR.')}
    }
    commit_(ledger_(),'Payment settings updated',admin.name,{note:published?'Payment details published':'Payments paused'});
    return true;
  });
}
function adminAddStaff(token,label,role,includeLink){
  const s=staff_(token,[]);label=String(label||'').trim();must_(/^[\p{L}\p{N}][\p{L}\p{N} ._-]{1,60}$/u.test(label)&&['desk','gate','floor'].includes(role),'Choose a desk, gate or floor role for the volunteer.');
  return locked_(()=>{
    const base=deskBaseUrl_();
    must_(base,'Publish the web app before inviting staff.');
    const key=rand_()+rand_().slice(0,8),sheet=book_().getSheetByName('Staff');
    sheet.appendRow([label,role,key,'yes']);
    syncStaffLinks_(sheet);
    commit_(ledger_(),'Staff key issued',s.name,{note:role});
    return includeLink===true?{key,url:staffDeskLink_(base,key)}:key;
  });
}
function deskStudent(token,roll,name,email,phone,checked){
  const staff=staff_(token,['desk']);roll=roll_(roll);name=String(name||'').trim();email=String(email||'').trim().toLowerCase();phone=String(phone||'').replace(/[ +()-]/g,'');
  must_(checked===true&&name&&name.length<=100&&!/^[=+@-]/.test(name),'Check the college ID and enter the student’s name.');
  must_((!email||/^[a-z0-9][a-z0-9._+%-]*@[a-z0-9.-]+\.[a-z]{2,}$/.test(email))&&(!phone||/^\d{10,15}$/.test(phone))&&(email||phone),'Enter a valid delivery email or mobile number.');
  return locked_(()=>{const sheet=book_().getSheetByName('Students'),count=sheet.getLastRow()-1;
    const data=count?sheet.getRange(2,1,count,4).getDisplayValues():[],i=data.findIndex(r=>r[0].trim()===roll);
    const existing=i>=0?data[i]:null;
    if(existing)must_((!existing[2]||!email||existing[2].toLowerCase()===email)&&(!existing[3]||!phone||existing[3].replace(/\D/g,'')===phone),'An existing contact differs. The coordinator must resolve it in the private directory.');
    const row=i>=0?i+2:sheet.getLastRow()+1;
    sheet.getRange(row,1,1,4).setNumberFormat('@').setValues([[roll,existing?.[1]||name,existing?.[2]||email,existing?.[3]||phone]]);
    commit_(ledger_(),'Directory contact verified',staff.name,{note:roll});return true;
  });
}
