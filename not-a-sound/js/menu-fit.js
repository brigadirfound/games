const menu=document.getElementById('screen-menu'),layout=document.getElementById('menu-layout');
function fitMenu(){
  if(!layout||!menu||menu.classList.contains('hidden'))return;
  const width=menu.clientWidth,height=menu.clientHeight;
  if(!width||!height)return;
  // Keep the desktop size; only shrink when the viewport cannot contain it.
  const scale=Math.min(1,(width-16)/1160,(height-16)/Math.max(1,layout.scrollHeight));
  layout.style.setProperty('--menu-fit',String(scale));
}
new ResizeObserver(fitMenu).observe(layout);
new MutationObserver(fitMenu).observe(menu,{attributes:true,attributeFilter:['class']});
addEventListener('resize',fitMenu);
document.fonts.ready.then(fitMenu);
fitMenu();
