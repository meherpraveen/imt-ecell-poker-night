const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
function fixture(){
  let time=Date.parse('2026-11-25T12:00:00+05:30');class Clock extends Date{static now(){return time}}
  const source=['Code','Floor'].map(n=>fs.readFileSync(path.join(__dirname,'../gas',n+'.gs'),'utf8')).join('\n');
  const sent=[],people={'123456789':{name:'Sample Player',email:'sample@example.test',phone:'9999999999'},'987654321':{name:'Second Player',email:'',phone:''}};
  const ctx={Date:Clock,console,Utilities:{getUuid:crypto.randomUUID},MailApp:{getRemainingDailyQuota:()=>5,sendEmail:(...m)=>sent.push(m)},ScriptApp:{getService:()=>({getUrl:()=>''})}};
  vm.createContext(ctx);vm.runInContext(source,ctx);const st=ctx.fresh_(),audit=[];
  ctx.ledger_=()=>st;ctx.locked_=fn=>fn();ctx.commit_=(s,kind,actor,p)=>{audit.push([kind,actor,p]);ctx.apply_(s,JSON.parse(JSON.stringify(p)))};
  ctx.roster_=()=>people;ctx.settings_=()=>({upi:'club@example',name:'Example Club',open:true});
  ctx.mac_=x=>crypto.createHmac('sha256','synthetic-only').update(x).digest('base64url');
  const actualStaff=ctx.staff_;ctx.staff_=(token,roles)=>{if(token!=='admin'&&!roles.includes(token))throw Error('Role denied');return {name:'Test staff',role:token}};
  return {ctx,st,sent,audit,people,actualStaff,at:s=>time=Date.parse(s)};
}
function hold(f,roll='123456789'){return f.ctx.playerStart(roll,'')}
test('the Pages transport returns public results, validates input, and excludes staff operations',()=>{
  const {ctx,st}=fixture();
  ctx.ContentService={MimeType:{JSON:'json'},createTextOutput:text=>({setMimeType:()=>JSON.parse(text)})};
  ctx.ensureStaffLinks_=()=>{};
  ctx.hash_=value=>crypto.createHash('sha256').update(value).digest('hex');
  const post=(action,args)=>ctx.doPost({postData:{contents:JSON.stringify({action,args})}});
  assert.equal(post('publicInfo',[]).value.open,true);
  assert.equal(post('liveFloor',[]).value.state,'Awaiting first seating');
  assert.equal(post('staffSnapshot',['admin']).ok,false);
  assert.equal(post('playerStart',[]).ok,false);
  const request=crypto.randomUUID(),args=['123456789','',request];
  const first=post('playerStart',args);
  assert.ok(first.ok);assert.equal(post('playerStart',args).value.ticket,first.value.ticket);
  assert.equal(post('playerStatus',[first.value.ticket]).value.id,first.value.id);
  assert.equal(Object.keys(st.attempts).length,1);
  assert.ok(!JSON.stringify(st.attempts).includes(request));
  assert.equal(post('playerStart',['123456789','',crypto.randomUUID()]).ok,false);
  assert.equal(post('playerStart',['wrong','','']).validation,true);
  ctx.publicInfo=()=>{throw Error('private provider detail')};
  const fail=post('publicInfo',[]);assert.ok(!fail.ok&&!fail.validation&&!fail.error.includes('private provider detail'));
});
function pending(f,roll='123456789',tail='6789'){const r=hold(f,roll);Object.assign(f.st.attempts[r.id],{status:'REVIEW',suffix:tail});return r}
function pay(f,roll='123456789',ref='123456786789'){const r=pending(f,roll,ref.slice(-4));f.ctx.staffApprove('admin',r.id,ref,true);return f.st.attempts[r.id]}
function staffFixture(){
  const {ctx,actualStaff}=fixture();
  const rows=[['Volunteer A','gate','a'.repeat(40),'yes'],['Volunteer B','floor','b'.repeat(40),'yes']];
  ctx.Utilities.computeHmacSha256Signature=(message,key)=>crypto.createHmac('sha256',key).update(message).digest();
  ctx.Utilities.base64EncodeWebSafe=bytes=>Buffer.from(bytes).toString('base64url');
  ctx.hash_=value=>crypto.createHash('sha256').update(value).digest('base64url');
  ctx.staffList_=()=>rows;
  ctx.staff_=actualStaff;
  const page={evaluate(){return this},setTitle(title){this.title=title;return this},addMetaTag(){return this}};
  ctx.HtmlService={createHtmlOutput:html=>({...page,html}),createTemplateFromFile:()=>({...page})};
  return {ctx,rows};
}
test('public views work without staff access and the old desk URL returns an unavailable page',()=>{
  const {ctx}=staffFixture();
  ctx.staffList_=()=>{throw Error('Unexpected staff directory read')};
  for(const view of ['register','board','pass'])assert.equal(ctx.doGet({parameter:{view}}).route,view);
  assert.equal(ctx.doGet({parameter:{view:'staff'}}).title,'Page unavailable');
  assert.equal(ctx.doGet({parameter:{view:'staff',invite:'invalid'}}).title,'Page unavailable');
});
test('private invitations are bound to the matching active staff key and role',()=>{
  const {ctx,rows}=staffFixture(),key=rows[0][2],invite=ctx.staffInvite_(key);
  const visit=()=>ctx.doGet({parameter:{view:'staff',invite}});
  assert.equal(visit().route,'staff');
  assert.equal(visit().invite,invite);
  assert.equal(ctx.doGet({parameter:{view:'staff',invite:'Z'.repeat(43)}}).title,'Page unavailable');
  assert.throws(()=>ctx.staffLogin(key));
  assert.throws(()=>ctx.staffLogin(rows[1][2],invite));
  const session=ctx.staffLogin(key,invite);
  assert.equal(ctx.staff_(session.token,['gate']).role,'gate');
  assert.throws(()=>ctx.staff_(session.token,['desk']));
  rows[0][3]='no';
  assert.equal(visit().title,'Page unavailable');
  assert.throws(()=>ctx.staffLogin(key,invite));
  assert.throws(()=>ctx.staff_(session.token,['gate']));
});
test('the one-time staff link migration can be retried and returns only public registration status',()=>{
  const {ctx}=fixture(),properties=new Map(),staff={};
  ctx.props_=()=>({getProperty:k=>properties.get(k),setProperty:(k,v)=>properties.set(k,v)});
  ctx.book_=()=>({getSheetByName:name=>name==='Staff'?staff:null});
  let runs=0;
  ctx.syncStaffLinks_=sheet=>{assert.equal(sheet,staff);return ++runs>1};
  for(let n=0;n<3;n++)assert.equal(JSON.stringify(ctx.publicInfo()),'{"open":true}');
  assert.equal(runs,2);
});
test('existing staff receive private links alongside their keys without replacing other columns',()=>{
  const {ctx,rows}=staffFixture(),base='https://script.google.com/macros/s/example/exec';
  ctx.deskBaseUrl_=()=>base;
  const data=[['Label','Role','Private sign-in key','Active','Notes'],[...rows[0],'Keep'],[...rows[1],'Keep']];
  const sheet={
    getLastRow:()=>data.length,getLastColumn:()=>data[0].length,
    getRange(row,column,height=1,width=1){
      return {
        getDisplayValues:()=>Array.from({length:height},(_,r)=>Array.from({length:width},(_,c)=>data[row+r-1][column+c-1]||'')),
        setValue:value=>{data[row-1][column-1]=value},
        setValues:values=>values.forEach((cells,r)=>{data[row+r-1][column-1]=cells[0]})
      };
    }
  };
  ctx.syncStaffLinks_(sheet);ctx.syncStaffLinks_(sheet);
  assert.equal(data[0][5],'Private desk link');assert.equal(data[0].length,6);
  assert.equal(data[1][4],'Keep');assert.equal(data[1][2],rows[0][2]);
  assert.equal(data[1][5],base+'?view=staff&invite='+ctx.staffInvite_(rows[0][2]));
  assert.ok(!data[1][5].includes(rows[0][2]));assert.notEqual(data[1][5],data[2][5]);
  data[1][3]='no';ctx.syncStaffLinks_(sheet);assert.equal(data[1][5],'');
});
test('roll-only lookup creates one private hold without revealing contact or pass',()=>{const f=fixture(),r=hold(f);assert.equal(r.fee,149);assert.equal(r.wave,1);assert.ok(r.ticket);assert.ok(!('code' in r||'email' in r||'phone' in r));assert.throws(()=>hold(f));assert.equal(f.ctx.playerStart('123456789',r.ticket).id,r.id);assert.throws(()=>f.ctx.playerStatus(r.id+'.forged'));});
test('partial references never approve and a wrong visible suffix blocks approval',()=>{const f=fixture(),r=pending(f);for(const ref of ['6789','000000001234'])assert.throws(()=>f.ctx.staffApprove('admin',r.id,ref,true));assert.throws(()=>f.ctx.staffApprove('admin',r.id,'000000006789',false));assert.equal(f.sent.length,0)});
test('approval is idempotent, mails only registered contact and rejects a reused bank reference',()=>{const f=fixture(),a=pay(f);assert.equal(f.sent.length,1);assert.equal(f.sent[0][0],'sample@example.test');f.ctx.staffApprove('admin',a.id,a.utr,true);assert.equal(f.sent.length,1);const r=pending(f,'987654321');assert.throws(()=>f.ctx.staffApprove('admin',r.id,a.utr,true));assert.throws(()=>f.ctx.staffApprove('gate',r.id,a.utr,true))});
test('missing email preserves paid code for ID-checked desk delivery',()=>{const f=fixture(),a=pay(f,'987654321');assert.equal(a.delivery,'Desk delivery needed');assert.equal(f.sent.length,0);assert.equal(f.ctx.staffPass('desk',a.id,false).code,f.ctx.pass_(a.id))});
test('single use gate, exit and wristband return count one person',()=>{const f=fixture(),a=pay(f),code=f.ctx.pass_(a.id);assert.equal(f.ctx.gateAction('gate','admit',code,'fixture-01'),'Recorded inside');assert.equal(f.ctx.gateAction('gate','admit',code,'fixture-01'),'Already recorded');assert.throws(()=>f.ctx.gateAction('gate','admit',code,'fixture-02'));f.ctx.gateAction('gate','exit',a.roll,'fixture-03');f.ctx.gateAction('gate','return',a.roll,'fixture-04');assert.equal(Object.keys(f.st.venue).length,1);assert.equal(f.st.venue[a.roll].where,'IN');assert.equal(f.ctx.passInfo(code).used,true)});
test('216 held attempts fill six waves, next student waitlists with no payment address',()=>{const f=fixture();for(let i=0;i<216;i++){const roll=String(200000000+i);f.people[roll]={};const r=hold(f,roll);assert.equal(r.wave,Math.floor(i/36)+1)}const r=hold(f);assert.equal(r.status,'WAITLIST');assert.equal(r.upi,'');});
test('expired holds release capacity, wrong roles cannot see screenshots or issue pass',()=>{const f=fixture(),r=hold(f);f.at('2026-11-25T12:16:00+05:30');assert.equal(f.ctx.playerStatus(r.ticket).status,'EXPIRED');assert.equal(hold(f).wave,1);assert.throws(()=>f.ctx.proofImage('floor',r.id));assert.throws(()=>f.ctx.staffPass('gate',r.id,false));});
test('walk-ins stop at 11, eliminated players can buy one later retry, reentry leaves inside count alone',()=>{const f=fixture(),a=pay(f);f.at('2026-11-27T23:12:00+05:30');assert.throws(()=>f.ctx.deskPayment('desk',a.roll,'retry','000000001222',true));f.ctx.gateAction('gate','admit',f.ctx.pass_(a.id),'fixture-in1');f.st.attempts[a.id].status='ELIMINATED';f.st.game.next=1;assert.throws(()=>f.ctx.deskPayment('desk','987654321','walk','000000001111',true));const k=f.ctx.deskPayment('desk',a.roll,'retry','000000001222',true);assert.equal(f.st.attempts[k.id].wave,1);assert.equal(f.st.attempts[k.id].fee,149);assert.notEqual(f.ctx.pass_(k.id),f.ctx.pass_(a.id));f.ctx.gateAction('gate','admit',f.ctx.pass_(k.id),'fixture-in2');assert.equal(Object.keys(f.st.venue).length,1)});
test('a full table result requires conserved chips and an explicit tiebreak; only the leader advances',()=>{const f=fixture(),a=pay(f),b=pay(f,'987654321','000000000001');for(const x of [a,b])f.ctx.gateAction('gate','admit',f.ctx.pass_(x.id),'admission-'+x.id);const draw=f.ctx.gamePreview('floor');f.ctx.startStage('floor',0,draw.tables);assert.equal(f.st.game.active.deadline-f.st.game.active.started,1800000);assert.throws(()=>f.ctx.tableResult('floor',0,0,{[a.id]:1,[b.id]:1},''));const values={[a.id]:10000,[b.id]:10000};assert.throws(()=>f.ctx.tableResult('floor',0,0,values,''));f.ctx.tableResult('floor',0,0,values,a.id);f.ctx.finishStage('floor',0);assert.equal(f.st.attempts[a.id].status,'QUALIFIED');assert.equal(f.st.attempts[b.id].status,'ELIMINATED');assert.ok(!JSON.stringify(f.ctx.liveFloor()).includes(a.roll));});
test('six full qualifiers yield 36 semifinalists, six finalists and one winner',()=>{const f=fixture();for(let wave=0;wave<6;wave++)for(let seat=0;seat<36;seat++){const id=wave.toString(16).padStart(2,'0')+seat.toString(16).padStart(3,'0')+'0'.repeat(11),roll=String(300000000+36*wave+seat);f.st.attempts[id]={id,roll,wave,status:'PAID',used:true,created:seat};f.st.venue[roll]={where:'IN'}}for(let n=0;n<8;n++){const d=f.ctx.gamePreview('floor');assert.equal(d.tables.flat().length,n===7?6:36);f.ctx.startStage('floor',n,d.tables);assert.equal(f.st.game.active.deadline-f.st.game.active.started,n===7?3600000:1800000);d.tables.forEach((ids,i)=>{const chips=Object.fromEntries(ids.map((id,j)=>[id,j===0?60000:0]));f.ctx.tableResult('floor',n,i,chips,'')});f.ctx.finishStage('floor',n)}assert.equal(Object.values(f.st.attempts).filter(x=>x.status==='WINNER').length,1);assert.equal(f.ctx.liveFloor().state,'Finished')});
