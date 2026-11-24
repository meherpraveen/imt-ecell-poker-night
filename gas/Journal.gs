function fresh_(){return {receivers:{},statements:{},bankCorrections:{},attempts:{},venue:{},game:{next:0,active:null,history:[]},audit:[]}}
function nextSeat_(state,wave){
  const taken=new Set(Object.values(state.attempts).filter(a=>a.wave===wave&&a.used).map(a=>a.seat));
  for(let seat=1;seat<=CAP;seat++)if(!taken.has(seat))return seat;
  throw Error('No numbered seat is available in this wave. Contact the floor manager.');
}
function apply_(state,patch,action,time){
  for(const receiver of patch.receivers||[])state.receivers[receiver.id]=receiver;
  for(const statement of patch.statements||[])state.statements[statement.id]=statement;
  if(patch.bankCorrection)state.bankCorrections[patch.bankCorrection.key]=patch.bankCorrection;
  for(const d of patch.bankDecisions||[]){
    const a=state.attempts[d.id];must_(a,'Missing payment in the reconciliation journal.');
    state.attempts[d.id]={...a,status:'PAID',paymentStatus:'AUTHORIZED',fee:d.fee??a.fee,utr:d.utr,bankRow:d.row,bankStatement:patch.bankStatement,verified:patch.bankTime,reviewReason:'',decisionReason:d.reason||'',delivery:'Pending delivery'};
  }
  for(const [id,reason] of patch.bankFlags||[])state.attempts[id]={...state.attempts[id],reviewReason:reason};
  for(const a of patch.attempts||[]){
    // Older admissions recorded the time on the journal row and only a used flag on the ticket.
    if(a.used&&!a.checkedInAt){
      const prior=state.attempts[a.id];
      if(prior?.checkedInAt){a.checkedInAt=prior.checkedInAt;a.seat=prior.seat}
      else if(action==='Gate admit'){a.checkedInAt=Number(time);a.seat=nextSeat_(state,a.wave)}
    }
    state.attempts[a.id]=a;
  }
  Object.assign(state.venue,patch.venue||{});
  if(patch.game)state.game=patch.game;
}
// The journal is append-only. A cached snapshot covers exactly its recorded prefix.
// Older deployments include intermediate stage rows in their cached audit trail.
const JOURNAL_SNAPSHOT='event-journal-prefix-v2', JOURNAL_CHUNK=88000;
const JOURNAL_CELL_LIMIT = 49000;
function readJournalSnapshot_(cache,end){
  const saved=JSON.parse(cache.get(JOURNAL_SNAPSHOT)||'null');
  if(!saved||!Number.isSafeInteger(saved.row)||saved.row<1||saved.row>end)return null;
  let packed=saved.packed;
  if(saved.parts){
    const keys=Array.from({length:saved.parts},(_,i)=>JOURNAL_SNAPSHOT+':'+saved.row+':'+i),parts=cache.getAll(keys);
    if(keys.some(key=>!parts[key]))return null;
    packed=keys.map(key=>parts[key]).join('');
  }
  return {row:saved.row,state:JSON.parse(Utilities.ungzip(Utilities.newBlob(Utilities.base64Decode(packed),'application/gzip')).getDataAsString())};
}
function saveJournalSnapshot_(cache,row,state){
  const packed=Utilities.base64Encode(Utilities.gzip(Utilities.newBlob(JSON.stringify(state),'text/plain')).getBytes());
  let value={row,packed};
  if(packed.length>JOURNAL_CHUNK){
    const parts=Math.ceil(packed.length/JOURNAL_CHUNK),chunks={};
    for(let i=0;i<parts;i++)chunks[JOURNAL_SNAPSHOT+':'+row+':'+i]=packed.slice(i*JOURNAL_CHUNK,(i+1)*JOURNAL_CHUNK);
    cache.putAll(chunks,600);value={row,parts};
  }
  cache.put(JOURNAL_SNAPSHOT,JSON.stringify(value),600);
}
function ledger_(sheet=book_().getSheetByName('Journal'),end=sheet.getLastRow()){
  let cache,saved;
  try{cache=CacheService.getScriptCache();saved=readJournalSnapshot_(cache,end)}catch{/* Evicted or unreadable snapshots are rebuilt from the sheet. */}
  const state=saved?saved.state:fresh_(),after=saved?saved.row:1;
  if(end>after){
    for(const [time,action,actor,json] of sheet.getRange(after+1,1,end-after,4).getValues()){
      const patch=JSON.parse(json);apply_(state,patch,action,time);
      if(patch.stagePart)continue;
      state.audit.push({time:Number(time),action,actor,target:patch.note||''});if(state.audit.length>35)state.audit.shift();
    }
    try{saveJournalSnapshot_(cache,end,state)}catch{/* The journal remains authoritative if the cache is full. */}
  }
  return state;
}
function commit_(st,action,actor,patch){
  const json=JSON.stringify(patch),sheet=book_().getSheetByName('Journal'),now=Date.now();
  if(json.length<JOURNAL_CELL_LIMIT){
    sheet.appendRow([now,action,actor,json]);
  }else{
    // A full wave can carry more payment history than fits in one cell. Keep the
    // original attempt records replayable and publish the entire stage in one range write.
    const {attempts,...stage}=patch;
    const tooLarge='This update is too large. Contact the desk.';
    must_(stage.game&&Array.isArray(attempts)&&attempts.length,tooLarge);
    const parts=attempts.map(a=>({attempts:[a],stagePart:true}));
    const rows=[...parts,stage].map(part=>[now,action,actor,JSON.stringify(part)]);
    must_(rows.every(row=>row[3].length<JOURNAL_CELL_LIMIT),tooLarge);
    const start=sheet.getLastRow()+1,last=start+rows.length-1,capacity=sheet.getMaxRows();
    if(last>capacity)sheet.insertRowsAfter(capacity,last-capacity);
    sheet.getRange(start,1,rows.length,4).setValues(rows);
  }
  SpreadsheetApp.flush();
  apply_(st,patch,action,now);
  if(patch.game)cacheFloorChange_(st);
}
