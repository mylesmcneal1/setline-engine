// set.Line: app-styled dropdowns. Any <select> on the page is shown as a custom button + menu;
// the real <select> stays (hidden) so existing code keeps reading .value and getting 'change' events.
(function(){
  const css=`
  :root{color-scheme:dark}
  select.xs-h{position:absolute!important;opacity:0!important;pointer-events:none!important;width:1px!important;height:1px!important;margin:0!important;padding:0!important;border:0!important}
  .xs{display:inline-flex;align-items:center;gap:6px;max-width:100%;min-width:0;padding:4px 8px;border-radius:6px;background:var(--bg,#0b0c0e);border:1px solid var(--hair,#22262d);color:var(--text,#e9ebef);font:inherit;font-size:inherit;cursor:pointer;text-align:left;line-height:1.3}
  .xs:hover{border-color:var(--faint,#555b66)} .xs.open{border-color:var(--accent,#f5a524)}
  .xs>span{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .xs::after{content:"";flex:none;width:7px;height:7px;margin:-3px 1px 0 2px;border-right:1.5px solid currentColor;border-bottom:1.5px solid currentColor;transform:rotate(45deg);opacity:.55}
  .xs:disabled{opacity:.4;cursor:default}
  .xs.vsel,.xs.asel,.xs.setsel{background:transparent;border-color:transparent;padding:2px 6px;margin-left:-6px}
  .xs.vsel:hover,.xs.asel:hover,.xs.setsel:hover{background:rgba(255,255,255,.05)}
  .xs.vsel.multi{color:var(--cyan,#45c8d6)} .xs.asel{color:var(--blue,#5aa9ff)} .xs.setsel{font-weight:600}
  .kv .xs,.tmap .xs,.grid2 .xs,.grid3 .xs,.op .row .xs{width:100%}
  .tmap .xs{font:11px var(--mono,inherit);padding:3px 5px;background:transparent;border-color:transparent} .tmap .xs:hover{border-color:var(--hair,#22262d)}
  .dhead .xs{background:var(--s2,#171a1f);border-color:transparent;font-weight:600}
  .xm{position:fixed;z-index:10000;min-width:160px;max-width:320px;max-height:min(360px,70vh);overflow:auto;background:#191c21;border:1px solid #2a2f37;border-radius:10px;padding:5px;box-shadow:0 16px 40px rgba(0,0,0,.55);font:13px/1.35 Inter,system-ui,sans-serif;color:#e9ebef;animation:xmIn .09s ease-out}
  @keyframes xmIn{from{opacity:0;transform:translateY(-3px)}}
  .xm .it{display:flex;align-items:center;gap:8px;padding:7px 10px 7px 8px;border-radius:6px;cursor:pointer;white-space:nowrap}
  .xm .it i{width:14px;flex:none;font-style:normal;color:var(--accent,#f5a524);font-size:12px;text-align:center}
  .xm .it span{overflow:hidden;text-overflow:ellipsis}
  .xm .it:hover,.xm .it.kb{background:#262a31}
  .xm .it.sel{color:#fff;font-weight:600}
  .xm .it.act{color:#9aa0aa} .xm .it.act:hover{color:#fff}
  .xm .it.dis{opacity:.35;cursor:default} .xm .it.dis:hover{background:none}
  .xm .sep{height:1px;background:#2a2f37;margin:5px 4px}`;
  const st=document.createElement('style'); st.textContent=css; document.head.appendChild(st);
  let openMenu=null;
  function close(){ if(openMenu){ openMenu.btn.classList.remove('open'); openMenu.el.remove(); openMenu=null; } }
  function label(sel){ const o=sel.options[sel.selectedIndex]; return o?o.textContent:''; }
  function enhance(sel){
    if(sel.dataset.xs||sel.multiple||sel.closest('.xm')) return; sel.dataset.xs='1';
    const b=document.createElement('button'); b.type='button'; b.className='xs '+sel.className; b.title=sel.title||''; b.innerHTML='<span></span>';
    if(sel.getAttribute('style')) b.setAttribute('style',sel.getAttribute('style'));
    if(sel.id) b.dataset.for=sel.id;
    const sync=()=>{ b.firstChild.textContent=label(sel); b.disabled=sel.disabled; };
    sync(); sel.classList.add('xs-h'); sel.tabIndex=-1; sel.after(b);
    sel.addEventListener('change',sync);
    const desc=Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value');
    Object.defineProperty(sel,'value',{get(){return desc.get.call(this)},set(v){desc.set.call(this,v); sync();}});
    ['pointerdown','mousedown','click'].forEach(ev=>b.addEventListener(ev,e=>e.stopPropagation()));
    b.addEventListener('click',()=>{ if(openMenu&&openMenu.btn===b){ close(); return; } close(); open(sel,b,sync); });
  }
  function open(sel,b,sync){
    const m=document.createElement('div'); m.className='xm'; let kb=-1;
    [...sel.options].forEach((o,i)=>{
      if(o.disabled&&/^[─—\-\s]+$/.test(o.textContent)){ m.insertAdjacentHTML('beforeend','<div class="sep"></div>'); return; }
      const it=document.createElement('div'); const isAct=/^__/.test(o.value);
      it.className='it'+(i===sel.selectedIndex&&!isAct?' sel':'')+(isAct?' act':'')+(o.disabled?' dis':''); it.dataset.i=i;
      it.innerHTML=`<i>${i===sel.selectedIndex&&!isAct?'✓':''}</i><span></span>`; it.lastChild.textContent=o.textContent;
      if(!o.disabled) it.onclick=e=>{ e.stopPropagation(); close(); if(sel.selectedIndex!==i){ sel.selectedIndex=i; sync(); sel.dispatchEvent(new Event('input',{bubbles:true})); sel.dispatchEvent(new Event('change',{bubbles:true})); } };
      m.appendChild(it); });
    document.body.appendChild(m); b.classList.add('open');
    const r=b.getBoundingClientRect(); m.style.minWidth=Math.max(160,r.width)+'px';
    const mh=m.offsetHeight, below=innerHeight-r.bottom-8; let top=r.bottom+4; if(mh>below&&r.top>below) top=Math.max(8,r.top-4-mh);
    m.style.top=top+'px'; m.style.left=Math.min(innerWidth-m.offsetWidth-8,Math.max(8,r.left))+'px';
    const cur=m.querySelector('.it.sel'); if(cur) cur.scrollIntoView({block:'nearest'});
    m.addEventListener('pointerdown',e=>e.stopPropagation());
    openMenu={el:m,btn:b,items:()=>[...m.querySelectorAll('.it:not(.dis)')],kb};
  }
  document.addEventListener('pointerdown',close);
  window.addEventListener('resize',close); document.addEventListener('scroll',e=>{ if(openMenu&&!openMenu.el.contains(e.target)) close(); },true);
  document.addEventListener('keydown',e=>{ if(!openMenu) return; const its=openMenu.items(); if(e.key==='Escape'){ e.preventDefault(); e.stopPropagation(); close(); return; }
    if(e.key==='ArrowDown'||e.key==='ArrowUp'){ e.preventDefault(); e.stopPropagation(); openMenu.kb=(openMenu.kb+(e.key==='ArrowDown'?1:-1)+its.length)%its.length; its.forEach((x,i)=>x.classList.toggle('kb',i===openMenu.kb)); its[openMenu.kb].scrollIntoView({block:'nearest'}); }
    if(e.key==='Enter'&&openMenu.kb>=0){ e.preventDefault(); e.stopPropagation(); its[openMenu.kb].click(); } },true);
  const scan=root=>{ (root.querySelectorAll?root:document).querySelectorAll('select').forEach(enhance); if(root.tagName==='SELECT') enhance(root); };
  new MutationObserver(ms=>ms.forEach(m=>m.addedNodes.forEach(n=>{ if(n.nodeType===1) scan(n); }))).observe(document.documentElement,{childList:true,subtree:true});
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',()=>scan(document)); else scan(document);
})();

// set.Line: Appearance (Dark / Darker). Stored per machine; every Mac page follows it.
(function(){
  const K='setline.appearance.v1', root=document.documentElement;
  const get=()=>{ try{ return localStorage.getItem(K)||'dark'; }catch(e){ return 'dark'; } };
  const set=v=>{ try{ localStorage.setItem(K,v); }catch(e){} apply(); };
  const apply=()=>{ root.classList.toggle('ap-darker',get()==='darker'); const b=document.getElementById('apBtn'); if(b){ b.classList.toggle('on',get()==='darker'); b.title='Appearance: '+(get()==='darker'?'Darker':'Dark'); } };
  apply();
  window.SLAppearance={ get, set }; // Settings › Appearance (the Show page)
  const st=document.createElement('style'); st.textContent=`
  html.ap-darker{--bg:#000;--s1:#0a0a0b;--s2:#141416;--s3:#1c1c1f;--panel:#0a0a0b;--hair:rgba(255,255,255,.07)}
  html.ap-darker body{background:#000}
  html.ap-darker .xm{background:rgba(22,22,24,.9)}
  #apBtn{flex:none;display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;border-radius:7px;border:0;background:transparent;color:var(--muted,#9aa0aa);cursor:pointer}
  #apBtn:hover{background:rgba(255,255,255,.08);color:var(--text,#f5f5f7)} #apBtn svg{width:16px;height:16px}
  .apPop{position:fixed;z-index:10001;width:236px;padding:12px;border-radius:12px;background:rgba(44,44,46,.88);backdrop-filter:blur(24px) saturate(180%);-webkit-backdrop-filter:blur(24px) saturate(180%);border:1px solid rgba(255,255,255,.1);box-shadow:0 18px 50px rgba(0,0,0,.55);font:13px -apple-system,BlinkMacSystemFont,"SF Pro Text",Inter,sans-serif;color:#f5f5f7}
  html.ap-darker .apPop{background:rgba(20,20,22,.92)}
  .apPop h4{margin:0 0 10px;font-size:11px;font-weight:600;color:rgba(235,235,245,.6)}
  .apPop .ops{display:grid;grid-template-columns:1fr 1fr;gap:10px}
  .apPop button{all:unset;cursor:pointer;display:flex;flex-direction:column;align-items:center;gap:6px;font-size:12px;color:rgba(235,235,245,.75)}
  .apPop .sw{width:100%;height:58px;border-radius:8px;border:2px solid transparent;box-shadow:0 0 0 1px rgba(255,255,255,.12);overflow:hidden;display:grid;grid-template-columns:28% 1fr}
  .apPop .sw i{display:block} .apPop button.on{color:#fff;font-weight:600} .apPop button.on .sw{border-color:var(--accent,#ff9f0a)}`;
  (document.head||root).appendChild(st);
  function pop(btn){ const old=document.querySelector('.apPop'); if(old){ old.remove(); return; }
    const p=document.createElement('div'); p.className='apPop';
    const sw=(a,b)=>`<span class="sw"><i style="background:${a}"></i><i style="background:${b}"></i></span>`;
    p.innerHTML=`<h4>Appearance</h4><div class="ops"><button data-v="dark">${sw('#1e1e20','#161617')}Dark</button><button data-v="darker">${sw('#0a0a0b','#000')}Darker</button></div>`;
    const draw=()=>p.querySelectorAll('button').forEach(b=>b.classList.toggle('on',b.dataset.v===get())); draw();
    p.querySelectorAll('button').forEach(b=>b.onclick=()=>{ set(b.dataset.v); draw(); });
    document.body.appendChild(p); const r=btn.getBoundingClientRect(); p.style.top=(r.bottom+8)+'px'; p.style.left=Math.max(8,Math.min(innerWidth-p.offsetWidth-8,r.right-p.offsetWidth))+'px';
    setTimeout(()=>document.addEventListener('pointerdown',function f(e){ if(!p.contains(e.target)&&e.target!==btn&&!btn.contains(e.target)){ p.remove(); document.removeEventListener('pointerdown',f,true); } },true),0); }
  function mount(){ const top=document.querySelector('.top'); if(!top||document.getElementById('apBtn')||document.getElementById('gearBtn')) return; // the Show page: Settings › Appearance
    const b=document.createElement('button'); b.id='apBtn';
    b.innerHTML='<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><circle cx="8" cy="8" r="6"/><path d="M8 2a6 6 0 0 1 0 12z" fill="currentColor"/></svg>';
    b.onclick=e=>{ e.stopPropagation(); pop(b); }; top.appendChild(b); apply(); }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',mount); else mount();
})();

// set.Line: runs on Mac and Windows. Show the right shortcut keys for this computer.
(function(){
  const mac=/Mac|iPhone|iPad/.test(navigator.platform||navigator.userAgent);
  document.documentElement.classList.add(mac?'os-mac':'os-win');
  if(mac) return;
  const fix=t=>t.replace(/⇧⌘/g,'Ctrl+Shift+').replace(/⌥⌘/g,'Ctrl+Alt+').replace(/⌘/g,'Ctrl+').replace(/⌥/g,'Alt+').replace(/⇧/g,'Shift+');
  const run=root=>root.querySelectorAll('[title*="⌘"],[title*="⌥"],[data-tip*="⌘"]').forEach(el=>{ if(el.title) el.title=fix(el.title); if(el.dataset.tip) el.dataset.tip=fix(el.dataset.tip); });
  const go=()=>{ run(document); new MutationObserver(()=>run(document)).observe(document.body,{subtree:true,childList:true}); };
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',go); else go();
})();
