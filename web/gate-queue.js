'use strict';
function queueKey(){return 'gate-queue-'+String(token).split('.')[0]}
function qread(key=queueKey()){
  let list;
  try{list=JSON.parse(localStorage.getItem('pn26:'+key)||'[]')}catch{}
  if(!Array.isArray(list)||!list.every(a=>a&&typeof a.id==='string'&&typeof a.value==='string'&&['admit','exit','return'].includes(a.mode))){
    throw Error('This browser could not read the saved gate actions. Use the online scanner or contact the desk.');
  }
  return list;
}
async function withGateLock(name,operation){
  let acquired=false;
  try{
    if(navigator.locks)return await navigator.locks.request('pn26:'+name,()=>{
      acquired=true;return operation();
    });
  }catch(error){
    if(acquired||!['SecurityError','NotSupportedError'].includes(error.name))throw error;
  }
  return operation();
}
function changeGateQueue(key,change){
  function write(){
    const previous=qread(key),next=change(previous);
    return next===previous||durable.set(key,next.length?JSON.stringify(next):'');
  }
  // Keep changes from two desk tabs from overwriting each other's local queue.
  return withGateLock(key,write);
}
function queueLabel(){
  const pending=el('pending');if(!pending)return;
  try{
    const count=qread().length;
    pending.textContent=count?count+' unsynced gate actions. Wait for confirmation before admitting.':'';
  }catch(error){pending.textContent=error.message}
}
addEventListener('storage',event=>{if(token&&event.key==='pn26:'+queueKey())queueLabel()});
let gateSync=null;
let settledAction='';
const gateResults=[];
function nextGateResult(){
  if(!gateResults.length){closeDetail();return}
  const result=gateResults.shift();
  detail(gateResultHtml(result,btn('nextGateResult',gateResults.length?'Next result':'Done','primary wide')));
  el('dialog').classList.add('gate-dialog');el('scanResultTitle').focus();
}
function presentGateReply(reply){
  if(typeof reply==='string'){msg(reply);return}
  gateResults.push(reply);
  if(gateResults.length&&!el('dialog').open)nextGateResult();
}
function rejectedGateAction(error){
  // Apps Script RPC sends error messages without a reliable custom error name.
  // Only a definitive input or attendance rejection can remove an unconfirmed action.
  return /(?:Invalid gate action|Enter your nine-digit college roll number|This player is not recorded inside|A venue return requires an earlier checked-in exit)\.$/.test(error?.message||'');
}
async function syncGate(){
  if(!token||!navigator.onLine)return;if(gateSync)return gateSync;
  const owner=token,key=queueKey();
  gateSync=withGateLock(key+':sync',async()=>{
    while(token===owner){
      const a=qread(key)[0];if(!a)break;
      let rejected;
      if(settledAction!==a.id){
        try{
          const reply=await deskApi('gateAction',owner,a.mode,a.value,a.id);
          if(token===owner)presentGateReply(reply);
        }catch(error){
          if(token!==owner||staffAccessLost(error))throw error;
          if(!rejectedGateAction(error)){msg('Queued on this device. Wait for server confirmation.');break}
          rejected=error;
        }
        settledAction=a.id;
      }
      const removed=await changeGateQueue(key,list=>list.filter(x=>x.id!==a.id));
      if(!removed){
        if(token===owner)msg('The gate replied. This browser could not clear the saved action.',true);
        break;
      }
      settledAction='';
      if(rejected)throw rejected;
    }
  });
  try{return await gateSync}finally{gateSync=null;queueLabel()}
}
async function gateOp(){
  const owner=token,key=queueKey();
  const a={mode:val('gateMode'),value:val('gateValue'),id:crypto.randomUUID()};
  if(!a.value)return fieldError('gateValue','Enter the ticket code or the player’s roll number.');
  if(!el('gateID').checked)return fieldError('gateID','Check the college ID or wristband before recording this action.');
  let saved;
  try{saved=await changeGateQueue(key,list=>list.some(v=>v.mode===a.mode&&v.value===a.value)?list:[...list,a])}catch{saved=false}
  if(token!==owner)return;
  queueLabel();
  if(!saved){
    if(!navigator.onLine)throw Error('Reconnect to check this ticket. This browser could not save an offline action.');
    const reply=await deskApi('gateAction',owner,a.mode,a.value,a.id);
    if(token===owner)presentGateReply(reply);return;
  }
  if(!navigator.onLine){msg('Queued on this device. Entry is pending until sync.');return}
  await syncGate();
  if(token===owner&&!qread(key).length)refresh().catch(()=>{if(token===owner)el('net').textContent='Attendance will update when the connection returns.'});
}
