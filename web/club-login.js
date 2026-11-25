'use strict';
let clubPasswordAttempt;
function clubSignInPage(){
  const email=challenge?.adminEntry?challenge.identifier:'';
  challenge=null;saveDeviceValue('email-step','');clearInterval(resendTimer);
  heading('','Event registration');
  el('content').innerHTML='<div class="narrow login-card">'+panel('Club account sign-in',ownerPasswordForm('clubPassword')+btn('changeLogin','Student sign-in','quiet'))+'</div>';
  el('clubEmail').value=email||'';el('clubEmail').focus();
}
async function submitClubPassword(){
  const email=val('clubEmail').toLowerCase(),password=el('clubPassword').value;
  if(!clubPasswordAttempt||clubPasswordAttempt.email!==email)clubPasswordAttempt={email,id:crypto.randomUUID()};
  const signed=await api('signInClubWithPassword',email,password,clubPasswordAttempt.id);
  el('clubPassword').value='';openClubDesk(signed);
}
function openClubDesk(signed){
  const next=new URL(signed.continueUrl);
  if(next.origin!=='https://script.google.com'||!next.pathname.endsWith('/exec')||
    (window.POKER_NIGHT_WEB_APP&&next.origin+next.pathname!==window.POKER_NIGHT_WEB_APP))throw Error('Open the private desk link from the club Sheet.');
  clearPlayer();heading('EVENT ACCESS','Opening your admin desk');
  el('content').innerHTML='<div class="narrow">'+panel('Club account verified','<a href="'+esc(next.href)+'" target="_top" rel="noreferrer">Open admin desk</a>')+'</div>';
  if(window===window.top)location.replace(next.href);
}
