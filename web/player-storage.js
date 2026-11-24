'use strict';
function tabValue(key,value){
  try{
    if(value===undefined)return sessionStorage.getItem('pn26:'+key)||'';
    if(value)sessionStorage.setItem('pn26:'+key,value);else sessionStorage.removeItem('pn26:'+key);
  }catch{}
  return '';
}
function unpack(value){try{return JSON.parse(value)}catch{return null}}
function deviceValue(key){return key==='player-login'?durable.get(key)||tabValue(key):tabValue(key)||durable.get(key)}
function saveDeviceValue(key,value){
  const saved=durable.set(key,value);
  tabValue(key,saved?'':value);
  return saved;
}
function dropAccountDrafts(roll){
  if(!roll)return;
  const prefix='pn26:draft:'+roll+':';
  for(const name of ['localStorage','sessionStorage']){
    try{const store=window[name];for(const key of Object.keys(store))if(key.startsWith(prefix))store.removeItem(key)}catch{}
  }
  proofStore('readwrite',store=>{
    const request=store.index('owner').openCursor(roll);
    request.onsuccess=()=>{const cursor=request.result;if(cursor){cursor.delete();cursor.continue()}};
  }).catch(()=>{});
}
// Store the original bytes in IndexedDB. Some mobile browsers cannot persist File objects.
let proofDatabase;
function openProofDatabase(){
  if(!proofDatabase)proofDatabase=new Promise((resolve,reject)=>{
    const request=indexedDB.open('pn26-registration-drafts',1);
    let blocked=false;
    request.onupgradeneeded=()=>{const files=request.result.createObjectStore('files',{keyPath:'key'});files.createIndex('owner','owner')};
    request.onsuccess=()=>{const db=request.result;if(blocked){db.close();return}db.onversionchange=()=>{db.close();proofDatabase=null};resolve(db)};
    request.onerror=()=>reject(request.error);
    request.onblocked=()=>{blocked=true;reject(Error('Draft storage is busy.'))};
  }).catch(error=>{proofDatabase=null;throw error});
  return proofDatabase;
}
async function proofStore(mode,operation){
  const db=await openProofDatabase();
  return new Promise((resolve,reject)=>{
    const tx=db.transaction('files',mode),request=operation(tx.objectStore('files'));
    tx.oncomplete=()=>resolve(request?.result);
    tx.onabort=tx.onerror=()=>reject(tx.error||Error('Could not access the saved screenshot.'));
  });
}
