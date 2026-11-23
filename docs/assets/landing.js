'use strict';
const target=String(window.POKER_NIGHT_WEB_APP||'').trim();
const ready=/^https:\/\/script\.google\.com\/(?:a\/macros\/[a-z0-9.-]+\/s|macros\/s)\/[\w-]+\/exec$/.test(target);
for(const link of document.querySelectorAll('[data-view="register"], [data-view="board"]')){
  if(ready){link.href=target+'?view='+encodeURIComponent(link.dataset.view);continue;}
  link.addEventListener('click',event=>{
    event.preventDefault();
    const notice=document.getElementById('availability');
    notice.hidden=false;
    notice.textContent=link.dataset.view==='register'?'Online registration has not opened yet. Please wait for the club’s payment instructions.':'The live floor opens when the club connects the event desk.';
    notice.scrollIntoView({block:'center'});
  });
}
