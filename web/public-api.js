'use strict';
const view=new URLSearchParams(location.search).get('view')||'register';
document.body.dataset.mode=['register','board','pass','scan'].includes(view)?view:'unavailable';
document.title=document.body.dataset.mode==='unavailable'?'Page unavailable · Poké Poker Night':view==='board'?'Live floor · Poké Poker Night':view==='pass'?'Entry pass · Poké Poker Night':view==='scan'?'Gate scanner · Poké Poker Night':'Registration · Poké Poker Night';
const fragment=new URLSearchParams(location.hash.slice(1));
const receipt=fragment.get('receipt')||'';
const incomingReceipt=/^[a-f0-9]{16}\.[A-Za-z0-9_-]{43}$/.test(receipt)?receipt:'';
if(view==='pass'){
  const code=fragment.get('code')||'';
  document.body.dataset.pass=code;
  try{
    if(code)sessionStorage.setItem('pn26:entry-pass',code);
    else document.body.dataset.pass=sessionStorage.getItem('pn26:entry-pass')||'';
  }catch{}
}
let scannerAccess='';
if(view==='scan'){
  scannerAccess=fragment.get('access')||'';
  try{
    if(scannerAccess)sessionStorage.setItem('pn26:camera-access',scannerAccess);
    else scannerAccess=sessionStorage.getItem('pn26:camera-access')||'';
  }catch{}
}
if(fragment.has('receipt')||fragment.has('code')||fragment.has('access'))history.replaceState(null,'',location.pathname+location.search);
