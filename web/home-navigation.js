// Warm the public document when someone points to or focuses its link.
const warmedPages=new Set();
function warmEventPage(event){
  const link=event.target.closest('a[data-view]');
  if(!link||warmedPages.has(link.href))return;
  const connection=navigator.connection;
  if(connection?.saveData||['slow-2g','2g'].includes(connection?.effectiveType))return;
  warmedPages.add(link.href);
  const hint=document.createElement('link');
  hint.rel='prefetch';hint.as='document';hint.href=link.href;
  document.head.append(hint);
}
document.addEventListener('pointerover',warmEventPage);
document.addEventListener('focusin',warmEventPage);
