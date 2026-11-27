// Included only in the homepage bundle; shares the verified pricing clock/timer.
function updateHomeCountdown(offer,now){
  const box=document.querySelector('[data-home-countdown]');
  if(!box)return false;
  const closed=now>=registrationDeadline();
  const remaining=offer&&!closed?Math.max(0,registrationDeadline()-now):0;
  const link=document.querySelector('.register-link'),label=link?.querySelector('[data-registration-label]');
  if(label)label.textContent=closed?'View registration or ticket':'Sign in to register';
  const notice=document.querySelector('[data-registration-closed]');if(notice)notice.hidden=!closed;
  box.hidden=!remaining;
  if(!remaining)return false;
  const seconds=Math.ceil(remaining/1000),hours=Math.floor(seconds/3600),minutes=Math.floor(seconds/60)%60;
  const pad=value=>String(value).padStart(2,'0');
  const clock=box.querySelector('[data-countdown-clock]'),value=pad(hours)+'h '+pad(minutes)+'m '+pad(seconds%60)+'s';
  if(clock.textContent!==value)clock.textContent=value;
  const next=box.querySelector('[data-countdown-next]'),note='Amphitheater desk: 7 PM · '+formatFee_(offer.standard,offer.currency);
  if(next.textContent!==note)next.textContent=note;
  return true;
}
