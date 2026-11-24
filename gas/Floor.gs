function stageName_(n){return n<6?'Round 1 · Wave '+(n+1):n===6?'Round 2 · Semifinals':'Round 3 · Final'}

const TABLES=['Ember','Tide','Grove','Volt','Frost','Dusk'];
function alias_(id){return 'Trainer '+id.slice(0,5).toUpperCase()}
function seated_(st,n){
  const inside=a=>a&&st.venue[a.roll]&&st.venue[a.roll].where==='IN';
  if(n<6)return Object.values(st.attempts).filter(a=>a.wave===n&&a.status==='PAID'&&a.used&&inside(a)).sort((a,b)=>a.created-b.created).map(a=>a.id);
  const prior=n===6?st.game.history.filter(h=>h.n<6):st.game.history.filter(h=>h.n===6);
  return prior.flatMap(h=>h.winners).filter(id=>{const a=st.attempts[id];return a&&a.status==='QUALIFIED'&&inside(a)});
}
function layout_(st,n,ids){
  if(n<WAVES&&ids.every(id=>st.attempts[id].seat)){
    const assigned=Array.from({length:TABLES.length},()=>[]);
    for(const id of ids.slice().sort((a,b)=>st.attempts[a].seat-st.attempts[b].seat)){
      assigned[Math.floor((st.attempts[id].seat-1)/6)].push(id);
    }
    return assigned.filter(table=>table.length);
  }
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
function tableNumbers_(st,n,tables){
  return tables.map((t,i)=>n<WAVES&&st.attempts[t[0]]?.seat?Math.ceil(st.attempts[t[0]].seat/6):i+1);
}
function publicFloor_(st){
  const g=st.game,h=g.active||g.history[g.history.length-1];
  const ranks=(h?Object.entries(h.chips||{}):[]).sort((a,b)=>b[1]-a[1]).map(([id,chips])=>({alias:alias_(id),chips}));
  return {now:Date.now(),title:h?stageName_(h.n):'Round 1 · Qualifiers',state:g.active?'Running':g.next===8?'Finished':g.history.length?'Between rounds':'Awaiting first seating',
    deadline:g.active?g.active.deadline:0,next:g.next<8?stageName_(g.next):'',tables:h?h.tables.map((t,i)=>({name:TABLES[(h.tableNumbers?.[i]||i+1)-1],players:t.map(alias_),seats:h.n<WAVES?t.map(id=>st.attempts[id].seat||null):[],winner:(h.winners||[]).some(id=>t.includes(id))})):[],
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
function gamePreview(token){staff_(token,['floor']);const st=ledger_(),n=st.game.next;must_(n<8&&!st.game.active,'Finish the current stage first.');const ids=seated_(st,n),people=roster_(),tables=layout_(st,n,ids);return {n,title:stageName_(n),tables,tableNumbers:tableNumbers_(st,n,tables),seats:Object.fromEntries(ids.map(id=>[id,st.attempts[id].seat||null])),names:Object.fromEntries(ids.map(id=>[id,people[st.attempts[id].roll]?.name||alias_(id)]))}}
function startStage(token,n,tables){
  const staff=staff_(token,['floor']);return locked_(()=>{const st=ledger_(),g=st.game;must_(n===g.next&&n<8&&!g.active,'The floor has changed. Refresh the draw.');
    must_(Array.isArray(tables)&&tables.length>=1&&tables.length<=(n===7?1:6)&&tables.every(t=>Array.isArray(t)&&t.length>=1&&t.length<=6),'Use 1–6 seats at each active table.');
    const ids=seated_(st,n),all=tables.flat();
    must_(all.length===ids.length&&new Set(all).size===all.length&&ids.every(id=>all.includes(id)),'Use each eligible, checked-in player exactly once. Refresh the draw after a gate change.');
    if(n<WAVES)must_(JSON.stringify(tables)===JSON.stringify(layout_(st,n,ids)),'Gate seats have changed. Refresh the draw.');
    const now=Date.now(),active={n,tables,tableNumbers:tableNumbers_(st,n,tables),started:now,deadline:now+(n===7?60:30)*60000,chips:{},winners:[]};
    commit_(st,'Stage started',staff.name,{game:{...g,active},note:stageName_(n)});return true;
  });
}
function skipEmptyWave(token,n){const s=staff_(token,['floor']);return locked_(()=>{const st=ledger_(),g=st.game;
  must_(n===g.next&&n<6&&!g.active&&!seated_(st,n).length,'Only an empty Round 1 wave can be closed without play.');
  const affected=Object.values(st.attempts).filter(a=>a.wave===n&&a.status==='PAID').map(a=>({...a,status:'NO_SHOW'}));
  commit_(st,'Empty wave closed',s.name,{attempts:affected,game:{...g,next:n+1,history:[...g.history,{n,tables:[],winners:[],chips:{}}]},note:stageName_(n)});return true})}
function tableResult(token,n,index,counts,tieWinner){
  const s=staff_(token,['floor']);return locked_(()=>{const st=ledger_(),g=st.game,h=g.active;must_(h&&h.n===n,'This stage has already closed.');
    const ids=h.tables[index];must_(Array.isArray(ids)&&counts&&typeof counts==='object'&&!Array.isArray(counts)&&Object.keys(counts).length===ids.length,'Enter every stack at this table.');
    ids.forEach(id=>must_(Number.isSafeInteger(counts[id])&&counts[id]>=0,'Enter whole, non-negative chip counts.'));
    must_(ids.reduce((sum,id)=>sum+counts[id],0)===10000*ids.length,'The table total must equal 10,000 starting chips per player.');
    const high=Math.max(...ids.map(id=>counts[id])),leaders=ids.filter(id=>counts[id]===high);
    must_(leaders.length===1||leaders.includes(tieWinner),'Confirm the witnessed tiebreak winner from the tied chip leaders.');
    const winner=leaders.length===1?leaders[0]:tieWinner;
    const active={...h,chips:{...h.chips,...counts},winners:[...h.winners.filter(id=>!ids.includes(id)),winner]};
    commit_(st,'Table result',s.name,{game:{...g,active},note:stageName_(n)+' · '+TABLES[(h.tableNumbers?.[index]||index+1)-1]});return true;
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
