// Earlier cached homepages use this script to resolve their navigation links.
for(const link of document.querySelectorAll('[data-view="register"], [data-view="board"]')){
  link.href='event.html?view='+encodeURIComponent(link.dataset.view);
}
