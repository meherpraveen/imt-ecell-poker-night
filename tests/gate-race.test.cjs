const {isMainThread, Worker, workerData, parentPort} = require('node:worker_threads');
const {once} = require('node:events');
const {test} = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

// Independent Apps Script executions share only a lock and a Sheet-shaped journal.
const player = {id:'0123456789abcdef',roll:'123456789',kind:'pre',status:'PAID',wave:0,used:false};
function journal(buffer) {
  const length=new Int32Array(buffer,0,1), bytes=Buffer.from(buffer,4);
  return {
    read(){return JSON.parse(bytes.subarray(0,Atomics.load(length,0)).toString())},
    write(rows){const size=bytes.write(JSON.stringify(rows));Atomics.store(length,0,size)}
  };
}
if(isMainThread){
  test('two simultaneous staff scans commit one admission and return the same seat and first-scan time',async()=>{
    const buffer=new SharedArrayBuffer(8192),flags=new SharedArrayBuffer(8);
    const log=journal(buffer);
    log.write([[0,'Payment approved','Desk',JSON.stringify({attempts:[player]})]]);
    const results=await Promise.all(['East gate','West gate'].map(staff=>{
      const worker=new Worker(__filename,{workerData:{buffer,flags,staff}});
      return once(worker,'message').then(([result])=>result);
    }));
    assert.deepEqual(results.map(r=>r.status).sort(),['admitted','used']);
    assert.equal(results[0].seat,1);assert.equal(results[0].seat,results[1].seat);
    assert.equal(results[0].checkedInAt,results[1].checkedInAt);
    const admissions=log.read().filter(row=>row[1]==='Gate admit');
    assert.equal(admissions.length,1);
    const patch=JSON.parse(admissions[0][3]);
    assert.equal(patch.attempts[0].used,true);assert.equal(patch.venue[player.roll].where,'IN');
  });
  test('a burst of 50 gate requests across eight concurrent operators keeps distinct seats and blocks repeats',async()=>{
    const players=Array.from({length:42},(_,i)=>({...player,id:i.toString(16).padStart(16,'0'),roll:String(400000000+i),wave:i<36?0:1}));
    const jobs=[...players,...players.slice(0,8)],operators=8;
    const buffer=new SharedArrayBuffer(131072),flags=new SharedArrayBuffer(8),log=journal(buffer);
    log.write([[0,'Batch approved','Desk',JSON.stringify({attempts:players})]]);
    const groups=await Promise.all(Array.from({length:operators},(_,i)=>{
      const worker=new Worker(__filename,{workerData:{buffer,flags,staff:'Gate '+i,operators,jobs:jobs.filter((_,j)=>j%operators===i).map(p=>p.id)}});
      return once(worker,'message').then(([results])=>results);
    }));
    const byId=new Map(),results=groups.flat();
    for(const {id,scan} of results){
      const previous=byId.get(id);if(previous){assert.equal(previous.checkedInAt,scan.checkedInAt);assert.equal(previous.seat,scan.seat)}
      byId.set(id,scan);
    }
    assert.equal(results.filter(r=>r.scan.status==='admitted').length,42);
    assert.equal(results.filter(r=>r.scan.status==='used').length,8);
    assert.equal(new Set([...byId.values()].map(r=>r.wave+'/'+r.seat)).size,42);
    assert.equal(log.read().filter(row=>row[1]==='Gate admit').length,42);
  });
}else{
  const flags=new Int32Array(workerData.flags),log=journal(workerData.buffer);
  let holding=false;
  const sheet={
    getLastRow(){assert.ok(holding);return log.read().length+1},
    getRange(){return {getValues:()=>log.read()}},
    appendRow(row){assert.ok(holding);log.write([...log.read(),row])}
  };
  const ctx={
    Date:class extends Date{static now(){return Date.parse('2026-11-27T19:00:00+05:30')}},
    LockService:{getScriptLock:()=>({
      waitLock(){while(Atomics.compareExchange(flags,0,0,1)!==0)Atomics.wait(flags,0,1);holding=true},
      releaseLock(){holding=false;Atomics.store(flags,0,0);Atomics.notify(flags,0)}
    })},
    SpreadsheetApp:{flush(){assert.ok(holding)}},CacheService:{getScriptCache:()=>({get:()=>null})}
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../gas/Code.gs'),'utf8'),ctx);
  ctx.book_=()=>({getSheetByName:()=>sheet});
  ctx.staff_=()=>({name:workerData.staff,role:'gate'});
  ctx.roster_=()=>({[player.roll]:{name:'Test player'}});
  ctx.mac_=value=>crypto.createHmac('sha256','race-fixture').update(value).digest('base64url');
  Atomics.add(flags,1,1);Atomics.notify(flags,1);
  const operators=workerData.operators||2;
  for(let waiting=Atomics.load(flags,1);waiting<operators;waiting=Atomics.load(flags,1)){
    assert.notEqual(Atomics.wait(flags,1,waiting,10000),'timed-out','All gate operators should reach the starting barrier');
  }
  const scan=id=>ctx.gateAction('fixture','admit',ctx.pass_(id),crypto.randomUUID());
  parentPort.postMessage(workerData.jobs?workerData.jobs.map(id=>({id,scan:scan(id)})):scan(player.id));
}
