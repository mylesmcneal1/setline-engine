// set.Line mockup: shared between the satellite and the Users & Canvases editor.
// Layouts are saved in this browser, so editing a canvas on the desktop page
// updates any satellite tab open in the same browser (stand-in for the main computer pushing it).
window.SL = (function(){
  // g = palette group · lab = optional label · label = label on by default
  const WIDGETS = {
    songname:  {g:'Song',     n:'Song name',        i:'♪',  w:6,  h:1, lab:'Song'},
    songpos:   {g:'Song',     n:'Song number',      i:'#',  w:1,  h:1, lab:'Song'},
    bpm:       {g:'Song',     n:'BPM',              i:'♩',  w:1.5,h:1, lab:'BPM', label:true},
    meter:     {g:'Song',     n:'Meter',            i:'⁴⁄₄',w:1,  h:1, lab:'Meter'},
    key:       {g:'Song',     n:'Key',              i:'♯',  w:1.5,h:1, lab:'Key'},
    songleft:  {g:'Song',     n:'Song time left',   i:'⏱',  w:2,  h:1, lab:'Song', label:true},
    setleft:   {g:'Song',     n:'Set time left',    i:'⏱',  w:2,  h:1, lab:'Set', label:true},
    clock:     {g:'Song',     n:'Clock',            i:'◷',  w:2,  h:1, lab:'Clock'},
    timeline:  {g:'Song',     n:'Song timeline',    i:'▭',  w:12, h:2},
    section:   {g:'Section',  n:'Current section',  i:'■',  w:6,  h:2, lab:'Now'},
    barsleft:  {g:'Section',  n:'Bars left',        i:'⏳', w:3,  h:2, lab:'Bars left', label:true},
    nextsec:   {g:'Section',  n:'Next section',     i:'→',  w:4,  h:1, lab:'Next', label:true},
    beats:     {g:'Section',  n:'Beat flash',       i:'●',  w:6,  h:1},
    exitloop:  {g:'Section',  n:'Exit loop',        i:'⟲',  w:4,  h:1},
    jumpmode:  {g:'Section',  n:'Jump timing',      i:'⇥',  w:4,  h:1},
    nextsong:  {g:'Set',      n:'Next song',        i:'⏭',  w:4,  h:1, lab:'Up next', label:true},
    transition:{g:'Set',      n:'Transition',       i:'↘',  w:3,  h:1, lab:'Then', label:true},
    setlist:   {g:'Set',      n:'Setlist',          i:'☰',  w:4,  h:3},
    mynote:    {g:'Notes',    n:'My note',          i:'✎',  w:6,  h:2, lab:'Notes'},
    nextnote:  {g:'Notes',    n:'Next note',        i:'✎',  w:6,  h:1, lab:'Next', label:true},
    play:      {g:'Controls', n:'Play / stop',      i:'▶',  w:2,  h:1},
    prevbtn:   {g:'Controls', n:'Previous song',    i:'⏮',  w:1,  h:1},
    nextbtn:   {g:'Controls', n:'Next song button', i:'⏭',  w:1,  h:1},
    mutes:     {g:'Controls', n:'Stem mutes',       i:'◍',  w:6,  h:1},
    resend:    {g:'Controls', n:'Resend MIDI',      i:'↻',  w:2,  h:1},
    ready:     {g:'Controls', n:'Ready button',     i:'✋', w:3,  h:1},
    lock:      {g:'Controls', n:'Lock',             i:'🔒', w:2,  h:1},
    custom:    {g:'Controls', n:'Custom button',    i:'⚡', w:3,  h:1},
    qcpatch:   {g:'Status',   n:'MIDI patch 1',     i:'◈',  w:2,  h:1, lab:'Guitar rig', label:true},
    axepatch:  {g:'Status',   n:'MIDI patch 2',     i:'◈',  w:2,  h:1, lab:'Lights', label:true},
    readyflags:{g:'Status',   n:'Band ready',       i:'✓',  w:4,  h:1},
  };
  const GROUPS=['Song','Section','Set','Notes','Controls','Status'];
  const PERMS = [
    ['start','Start / stop','Play and stop'],
    ['jump','Jump sections','Tap a section on the song timeline to jump'],
    ['loop','Exit loops',''],
    ['song','Change songs','Prev / next / pick from setlist'],
    ['mute','Mute stems','Per song'],
    ['resend','Resend MIDI','Send this section’s MIDI again'],
    ['lock','Lock screen',''],
    ['layout','Edit own layout','Rearrange and restyle their canvas on their device'],
  ];
  const NOTE_ROLES = [['drums','Drums'],['keys','Keys'],['md','MD'],['vocals','Vocals']];
  const ALL = {start:1,jump:1,loop:1,song:1,mute:1,resend:1,lock:1,layout:1}, NONE = {start:0,jump:0,loop:0,song:0,mute:0,resend:0,lock:0,layout:1};
  const DEFAULT_USERS = [
    {id:'mac',name:'This computer',short:'⌘',col:'#e9ebef',notes:null,orient:'mac',cols:16,rows:10,perms:{...ALL},local:true,devices:[['This computer','runs the show']],
     w:[['songpos',1,1,1,1],['songname',2,1,6,1],['bpm',8,1,1.5,1,{label:true}],['meter',9.5,1,1,1],['key',10.5,1,1.5,1],['songleft',12,1,1.5,1,{label:true}],['setleft',13.5,1,1.5,1,{label:true}],['clock',15,1,2,1],
        ['timeline',1,2,16,2],['section',1,4,7,2],['barsleft',1,6,7,2,{label:true}],['nextsec',8,4,4,1,{label:true}],['nextsong',8,5,4,1,{label:true}],['transition',8,6,4,1,{label:true}],
        ['qcpatch',8,7,2,1,{label:true}],['axepatch',10,7,2,1,{label:true}],['setlist',12,4,5,4],['beats',1,8,7,1],['readyflags',8,8,4,1],['resend',12,8,2,1],['lock',14,8,3,1],
        ['prevbtn',1,9,2,2],['play',3,9,4,2],['nextbtn',7,9,2,2],['exitloop',9,9,4,2],['jumpmode',13,9,4,1],['mutes',13,10,4,1]]},
    {id:'engineer',name:'Playback Engineer',short:'PE',col:'#f5a524',notes:null,orient:'land',cols:12,rows:8,perms:{...ALL},devices:[['iPad Pro 11″','now · 4 ms'],['MacBook (backup)','2 min ago']],
     w:[['song',1,1,6,1],['timers',7,1,4,1],['lock',11,1,2,1],['timeline',1,2,9,2],['transport',10,2,3,1],['exitloop',10,3,3,1],['jumpmode',10,4,3,1],['upnext',10,5,3,1],['patches',10,6,3,1],['clock',10,7,3,1],['countdown',1,4,5,4],['next',6,4,4,1],['setlist',6,5,4,3],['beats',1,8,4,1],['readyflags',5,8,4,1],['mutes',9,8,4,1]]},
    {id:'drummer',name:'Drummer',short:'DR',col:'#22c3a6',notes:'drums',orient:'land',cols:12,rows:8,perms:{...NONE},devices:[['iPad mini','now · 6 ms']],
     w:[['song',1,1,8,1],['timers',9,1,4,1],['timeline',1,2,12,1],['countdown',1,3,7,4],['beats',8,3,5,2],['next',8,5,5,2],['notes',1,7,9,2],['ready',10,7,3,2]]},
    {id:'md',name:'Music Director',short:'MD',col:'#a46bff',notes:'md',orient:'land',cols:12,rows:8,perms:{...NONE,jump:1,loop:1},devices:[['iPad Air','now · 5 ms']],
     w:[['song',1,1,6,1],['timers',7,1,6,1],['timeline',1,2,12,2],['countdown',1,4,6,4],['next',7,4,6,1],['notes',7,5,6,3],['beats',1,8,8,1],['readyflags',9,8,4,1]]},
    {id:'keys',name:'Keys',short:'KY',col:'#5aa9ff',notes:'keys',orient:'port',cols:6,rows:10,perms:{...NONE},devices:[['iPhone 15','now · 9 ms']],
     w:[['song',1,1,6,1],['countdown',1,2,6,3],['next',1,5,6,1],['notes',1,6,6,3],['beats',1,9,4,1],['ready',5,9,2,1],['clock',1,10,6,1]]},
    {id:'vocals',name:'Vocals',short:'VX',col:'#ff5fa2',notes:'vocals',orient:'port',cols:6,rows:10,perms:{...NONE},devices:[],
     w:[['song',1,1,6,1],['countdown',1,2,6,3],['next',1,5,6,1],['notes',1,6,6,4],['beats',1,10,6,1]]},
    {id:'guest',name:'Guest view',short:'GV',col:'#7d8696',notes:null,orient:'port',cols:6,rows:10,perms:{...NONE},devices:[],
     w:[['song',1,1,6,1],['countdown',1,2,6,3],['next',1,5,6,1],['setlist',1,6,6,5]]},
  ];
  // per-user look, chosen on the device (Style panel) — the main computer shows it but doesn't need to set it
  const THEMES = [['dark','Dark','#0b0c0e','#171a1f','#e9ebef'],['black','Stage black','#000000','#0e0e10','#e9ebef'],['light','Daylight','#f3f4f6','#ffffff','#111317'],['contrast','High contrast','#000000','#000000','#ffffff']];
  const ACCENTS = ['#f5a524','#3ddc84','#5aa9ff','#ff5fa2','#a46bff','#45c8d6','#ff5468','#ffffff'];
  const DEFAULT_STYLE = {theme:'dark',accent:'#f5a524',corners:'round',spacing:'roomy',count:'fill',beat:'bars'};
  // free placement on a fine grid (AbleSet-style): positions/sizes in grid cells, snapped to quarter cells, overlap allowed (later = on top)
  const SNAP=0.125, MIN=0.5;
  const snap=(v,st=SNAP)=>st?Math.round(v/st)*st:Math.round(v*1000)/1000, clamp=(v,a,b)=>Math.max(a,Math.min(b,v)), fmtU=v=>String(+(+v).toFixed(3));
  function dragBox(o,dx,dy,dir,cols,rows,st){ let [c,r,w,h]=o; dx=snap(dx,st===undefined?SNAP:st); dy=snap(dy,st===undefined?SNAP:st);
    if(dir==='move') return [clamp(o[0]+dx,1,cols-w+1),clamp(o[1]+dy,1,rows-h+1),w,h];
    if(dir.includes('e')) w=clamp(o[2]+dx,MIN,cols-c+1);
    if(dir.includes('s')) h=clamp(o[3]+dy,MIN,rows-r+1);
    if(dir.includes('w')){ const nc=clamp(o[0]+dx,1,o[0]+o[2]-MIN); w=o[2]+(o[0]-nc); c=nc; }
    if(dir.includes('n')){ const nr=clamp(o[1]+dy,1,o[1]+o[3]-MIN); h=o[3]+(o[1]-nr); r=nr; }
    return [c,r,w,h]; }
  // Smart guides: snap edges/centers to the screen center & edges and to other widgets (within th px); otherwise fall back to the grid step.
  // box=[c,r,w,h] (1-based), others=[[c,r,w,h]...], cw/ch = px per cell. free=true skips all snapping (Alt held).
  function guideSnap(box,dir,others,cols,rows,cw,ch,free,th){ th=th||7; let [c,r,w,h]=box; const g=[];
    if(free) return {box:[snap(c,0),snap(r,0),snap(w,0),snap(h,0)],guides:g};
    const axis=(pos,size,scale,total,isX,edges)=>{ const tg=[0,total/2,total]; others.forEach(o=>{ const p=isX?o[0]-1:o[1]-1, s=isX?o[2]:o[3]; tg.push(p,p+s/2,p+s); });
      const anchors=edges.map(k=>k==='a'?pos:k==='m'?pos+size/2:pos+size); let best=null;
      anchors.forEach((a,i)=>tg.forEach((t,j)=>{ const d=(t-a)*scale, sc=Math.abs(d)*(j===1?.35:1); if(Math.abs(d)<=(j===1?th*1.6:th)&&(!best||sc<best.sc)) best={d,sc,dv:t-a,t,k:edges[i]}; })); return best; };
    const mv=dir==='move';
    const xe=mv?['a','m','z']:[dir.includes('w')?'a':null,dir.includes('e')?'z':null].filter(Boolean);
    const ye=mv?['a','m','z']:[dir.includes('n')?'a':null,dir.includes('s')?'z':null].filter(Boolean);
    if(xe.length){ const bx=axis(c-1,w,cw,cols,true,xe);
      if(bx){ if(mv) c+=bx.dv; else if(bx.k==='a'){ c+=bx.dv; w-=bx.dv; } else w+=bx.dv; g.push({x:bx.t}); }
      else if(mv) c=snap(c-1)+1; else if(xe[0]==='a'){ const nc=snap(c-1)+1; w+=c-nc; c=nc; } else w=snap(c-1+w)-(c-1); }
    if(ye.length){ const by=axis(r-1,h,ch,rows,false,ye);
      if(by){ if(mv) r+=by.dv; else if(by.k==='a'){ r+=by.dv; h-=by.dv; } else h+=by.dv; g.push({y:by.t}); }
      else if(mv) r=snap(r-1)+1; else if(ye[0]==='a'){ const nr=snap(r-1)+1; h+=r-nr; r=nr; } else h=snap(r-1+h)-(r-1); }
    w=Math.max(MIN,w); h=Math.max(MIN,h); c=clamp(c,1,cols-w+1); r=clamp(r,1,rows-h+1);
    return {box:[snap(c,0),snap(r,0),snap(w,0),snap(h,0)],guides:g}; }
  const HANDLES=['n','s','e','w','ne','nw','se','sw'];
  // ---------- per-tile options panel (same on iPad, Perform view and the main computer editor) ----------
  const TEXT_KINDS=new Set(['songname','songpos','bpm','meter','key','songleft','setleft','clock','section','barsleft','nextsec','nextsong','transition','mynote','nextnote','qcpatch','axepatch']);
  const NEEDS={timeline:'jump',play:'start',prevbtn:'song',nextbtn:'song',exitloop:'loop',jumpmode:'jump',mutes:'mute',resend:'resend',lock:'lock'};
  const DESC={songname:'Name of the song that’s playing.',songpos:'Where this song sits in the set, like 2/12.',bpm:'Current tempo, including ramps.',meter:'Current time signature.',key:'Key of the song.',
    songleft:'Time left in this song.',setleft:'Time left in the whole set.',clock:'Time of day.',timeline:'Every section of the song. Tap one to jump (needs “Jump sections”).',
    section:'Section that’s playing now, in its color.',barsleft:'Bars left in this section (seconds during an auto-next wait).',nextsec:'Section coming up next.',beats:'Flashes on every beat; beat 1 in the accent color.',
    exitloop:'Leaves a looping section after the current pass.',jumpmode:'When a tapped section jump happens.',nextsong:'Next song in the set. Tap to open the setlist.',transition:'What happens after this song: Segue, Stop or Auto-next.',
    setlist:'The whole set. Tap a song to cue it (needs “Change songs”).',mynote:'This player’s note for the current section.',nextnote:'This player’s note for the next section.',play:'Starts and stops playback.',
    prevbtn:'Previous song.',nextbtn:'Next song.',mutes:'Mute stems for this song.',resend:'Sends this section’s MIDI (patches, scenes) again.',ready:'Player taps when ready; shows on Band ready.',
    lock:'Locks this screen so nothing gets bumped.',custom:'A button that does one thing you choose.',qcpatch:'The first MIDI track’s patch for this section.',axepatch:'The second MIDI track’s patch for this section.',readyflags:'Who has tapped Ready.'};
  const SWATCH=['#e9ebef','#8a909b','#f5a524','#3ddc84','#5aa9ff','#45c8d6','#a46bff','#ff5fa2','#ff5468','#0b0c0e'];
  const ACTIONS=[['resend','Resend MIDI'],['play','Play / stop'],['next','Next song'],['prev','Previous song'],['exitloop','Exit loop'],['jump','Jump to a section…'],['mute','Mute a stem…'],['toast','Just show a message']];
  const SECS=['Intro','Verse','Pre','Chorus','Bridge','Turn','Outro'], STEMS=['Drums','Bass','Keys','Gtrs','BGVs','Synth','FX','Cues'];
  const OPTS_CSS=`.op{font-size:12.5px} .op h4{font-size:10.5px;font-weight:700;letter-spacing:.09em;color:var(--faint);margin:16px 0 8px;text-transform:uppercase}
    .op .d{color:var(--muted);line-height:1.45} .op .warn{color:var(--accent);margin-top:6px;line-height:1.4}
    .op .row{display:flex;align-items:center;justify-content:space-between;gap:10px;margin:7px 0} .op .row>span{color:var(--muted)}
    .op input[type=text],.op select,.op input[type=number]{background:var(--bg);color:var(--text);border:1px solid var(--hair);border-radius:6px;padding:5px 7px;font:inherit;font-size:12px;width:100%}
    .op .grid4{display:grid;grid-template-columns:repeat(4,1fr);gap:5px} .op .grid4 small{display:block;font-size:10px;color:var(--faint);text-align:center;margin-top:2px}
    .op .seg{display:flex;background:var(--bg);border-radius:7px;padding:2px;gap:2px} .op .seg button{flex:1;padding:5px 8px;border-radius:5px;color:var(--muted);font-size:12px;background:none;border:0;cursor:pointer}
    .op .seg button.on{background:var(--s3);color:var(--text)}
    .op .sw{display:flex;flex-wrap:wrap;gap:7px} .op .sw i{width:22px;height:22px;border-radius:50%;cursor:pointer;box-shadow:inset 0 0 0 1px rgba(127,127,127,.4);display:grid;place-items:center;font-style:normal;font-size:10px;color:var(--muted)}
    .op .sw i.on{box-shadow:0 0 0 2px var(--bg),0 0 0 4px var(--accent)} .op .sw i.auto{background:var(--bg)}
    .op .tg{width:34px;height:20px;border-radius:10px;background:var(--s3);position:relative;cursor:pointer;flex:none;border:0} .op .tg::after{content:"";position:absolute;left:2px;top:2px;width:16px;height:16px;border-radius:50%;background:#fff;transition:.15s}
    .op .tg.on{background:var(--green)} .op .tg.on::after{left:16px}
    .op .acts{display:flex;gap:6px;flex-wrap:wrap} .op .acts button{flex:1;padding:7px 8px;border-radius:7px;background:var(--s2);color:var(--text);font-size:12px;border:0;cursor:pointer} .op .acts button.del{color:var(--red)}
    .op input[type=range]{width:100%}
    .op .cf{position:relative;margin-bottom:4px} .op .cfb{display:flex;align-items:center;gap:9px;width:100%;padding:6px 8px;border-radius:7px;background:var(--bg);border:1px solid var(--hair);color:var(--text);cursor:pointer;font:inherit;font-size:12px}
    .op .cfb i{width:20px;height:20px;border-radius:5px;box-shadow:inset 0 0 0 1px rgba(127,127,127,.45)} .op .cfb i.auto{background:repeating-linear-gradient(45deg,#8a909b33 0 3px,transparent 3px 6px) !important}
    .op .cfb span{flex:1;text-align:left;font-family:var(--code,monospace);font-size:11.5px} .op .cfb em{font-style:normal;color:var(--faint)}
    .cp{position:absolute;left:0;right:0;top:calc(100% + 6px);z-index:50;background:var(--s2);border:1px solid var(--hair);border-radius:12px;padding:12px;box-shadow:0 14px 40px rgba(0,0,0,.5)}
    .cpt{display:flex;gap:12px;align-items:flex-start} .cp canvas{width:150px;height:150px;flex:none;touch-action:none;cursor:crosshair;border-radius:50%}
    .cpr{flex:1;display:flex;flex-direction:column;gap:8px;min-width:0}
    .cp .cpv{-webkit-appearance:none;appearance:none;width:100%;height:12px;border-radius:6px;border:0;padding:0}
    .cp .cpv::-webkit-slider-thumb{-webkit-appearance:none;width:16px;height:16px;border-radius:50%;background:#fff;box-shadow:0 0 0 2px rgba(0,0,0,.4)}
    .cpp{height:38px;border-radius:8px;box-shadow:inset 0 0 0 1px rgba(127,127,127,.4)}
    .cp .cph{width:100%;background:var(--bg);color:var(--text);border:1px solid var(--hair);border-radius:6px;padding:5px 7px;font:12px var(--code,monospace);text-transform:uppercase}
    .cp button{background:var(--s3);color:var(--text);border:0;border-radius:6px;padding:5px 8px;font:inherit;font-size:12px;cursor:pointer}
    .cpm{display:flex;justify-content:space-between;align-items:center;margin:12px 0 6px;font-size:11px;color:var(--faint);font-weight:700;letter-spacing:.06em;text-transform:uppercase}
    .cpm button{background:none;color:var(--muted);padding:0;text-transform:none;letter-spacing:0;font-weight:500}
    .cps{display:flex;flex-wrap:wrap;gap:6px} .cps i{width:24px;height:24px;border-radius:6px;cursor:pointer;box-shadow:inset 0 0 0 1px rgba(127,127,127,.45);position:relative;display:grid;place-items:center}
    .cps i b{background:rgba(0,0,0,.7);color:#fff;width:16px;height:16px;border-radius:50%;font-size:11px;line-height:16px;text-align:center} .cpe{font-size:12px;color:var(--faint)}
    .cpf{display:flex;justify-content:space-between;gap:6px;margin-top:12px} .cpf .cpdone{background:var(--accent);color:#1b1200;font-weight:600}`;
  // ---------- color wheel picker with a saved palette ("My colors") ----------
  const CKEY='setline.colors.v1';
  function loadColors(){ try{ const j=JSON.parse(localStorage.getItem(CKEY)||'null'); if(Array.isArray(j)) return j; }catch(e){} return SWATCH.slice(); }
  function saveColors(c){ try{ localStorage.setItem(CKEY,JSON.stringify(c)); }catch(e){} }
  const hex2rgb=h=>{ h=h.replace('#',''); if(h.length===3) h=h.split('').map(x=>x+x).join(''); const n=parseInt(h,16); return [n>>16&255,n>>8&255,n&255]; };
  const rgb2hex=(r,g,b)=>'#'+[r,g,b].map(x=>Math.round(x).toString(16).padStart(2,'0')).join('');
  function hsv2rgb(h,s,v){ const f=n=>{ const k=(n+h/60)%6; return v-v*s*Math.max(0,Math.min(k,4-k,1)); }; return [f(5)*255,f(3)*255,f(1)*255]; }
  function rgb2hsv(r,g,b){ r/=255; g/=255; b/=255; const mx=Math.max(r,g,b), mn=Math.min(r,g,b), d=mx-mn; let h=0;
    if(d){ h=mx===r?((g-b)/d)%6:mx===g?(b-r)/d+2:(r-g)/d+4; h*=60; if(h<0) h+=360; } return [h,mx?d/mx:0,mx]; }
  function colorField(key,val,title){ return `<div class="cf" data-cf="${key}"><button class="cfb" type="button" title="${title}"><i style="background:${val||'transparent'}" class="${val?'':'auto'}"></i><span>${val?val.toUpperCase():'Auto'}</span><em>▾</em></button></div>`; }
  function openPicker(field,val,onPick){ document.querySelectorAll('.cp').forEach(x=>x.remove());
    let [h,sat,v]=val?rgb2hsv(...hex2rgb(val)):[30,.85,.96], manage=false, touched=false; const S=176, Rr=S/2-4;
    const cp=document.createElement('div'); cp.className='cp';
    cp.innerHTML=`<div class="cpt"><canvas width="${S}" height="${S}"></canvas><div class="cpr"><input type="range" class="cpv" min="0" max="100" title="Brightness"><div class="cpp"></div><input type="text" class="cph" maxlength="7" spellcheck="false"><button class="cpa" type="button">Auto</button></div></div>
      <div class="cpm"><span>My colors</span><button class="cpman" type="button">Manage</button></div><div class="cps"></div>
      <div class="cpf"><button class="cpsave" type="button">＋ Save this color</button><button class="cpdone" type="button">Done</button></div>`;
    field.appendChild(cp); const cv=cp.querySelector('canvas'), g=cv.getContext('2d'), vin=cp.querySelector('.cpv'), hx=cp.querySelector('.cph'), pv=cp.querySelector('.cpp');
    const cur=()=>rgb2hex(...hsv2rgb(h,sat,v));
    function wheel(){ const im=g.createImageData(S,S); for(let y=0;y<S;y++) for(let x=0;x<S;x++){ const dx=x-S/2, dy=y-S/2, r=Math.hypot(dx,dy), i=(y*S+x)*4; if(r>Rr+1){ im.data[i+3]=0; continue; }
        const [cr,cg,cb]=hsv2rgb((Math.atan2(dy,dx)*180/Math.PI+360)%360,Math.min(1,r/Rr),v); im.data[i]=cr; im.data[i+1]=cg; im.data[i+2]=cb; im.data[i+3]=r>Rr?Math.max(0,(Rr+1-r)*255):255; }
      g.putImageData(im,0,0); const a=h*Math.PI/180, mx=S/2+Math.cos(a)*sat*Rr, my=S/2+Math.sin(a)*sat*Rr;
      g.lineWidth=2.5; g.strokeStyle=v>.55?'#000':'#fff'; g.beginPath(); g.arc(mx,my,7,0,7); g.stroke(); g.lineWidth=1.5; g.strokeStyle=v>.55?'#fff':'#000'; g.beginPath(); g.arc(mx,my,8.5,0,7); g.stroke(); }
    function sync(fire,final){ const c=cur(); vin.value=Math.round(v*100); vin.style.background=`linear-gradient(to right,#000,${rgb2hex(...hsv2rgb(h,sat,1))})`; pv.style.background=c; if(document.activeElement!==hx) hx.value=c.toUpperCase(); wheel(); if(fire){ touched=true; onPick(c,final); } }
    function swatches(){ const list=loadColors(); cp.querySelector('.cps').innerHTML=list.map((c,i)=>`<i data-i="${i}" style="background:${c}" title="${c}">${manage?'<b>×</b>':''}</i>`).join('')||'<span class="cpe">No saved colors</span>';
      cp.querySelectorAll('.cps i').forEach(el=>el.onclick=()=>{ const c=list[+el.dataset.i]; if(manage){ list.splice(+el.dataset.i,1); saveColors(list); swatches(); return; } [h,sat,v]=rgb2hsv(...hex2rgb(c)); sync(true,false); }); }
    const pick=e=>{ const r=cv.getBoundingClientRect(), dx=(e.clientX-r.left)*S/r.width-S/2, dy=(e.clientY-r.top)*S/r.height-S/2; h=(Math.atan2(dy,dx)*180/Math.PI+360)%360; sat=Math.min(1,Math.hypot(dx,dy)/Rr); if(v<.15) v=.85; sync(true,false); };
    cv.onpointerdown=e=>{ e.preventDefault(); cv.setPointerCapture(e.pointerId); pick(e); cv.onpointermove=pick; cv.onpointerup=()=>{ cv.onpointermove=null; }; };
    vin.oninput=()=>{ v=vin.value/100; sync(true,false); };
    hx.oninput=()=>{ const t=hx.value.trim(); if(/^#?[0-9a-f]{6}$/i.test(t)){ [h,sat,v]=rgb2hsv(...hex2rgb(t)); sync(true,false); } };
    cp.querySelector('.cpa').onclick=()=>{ onPick('',true); cp.remove(); };
    cp.querySelector('.cpman').onclick=()=>{ manage=!manage; cp.querySelector('.cpman').textContent=manage?'Done managing':'Manage'; swatches(); };
    cp.querySelector('.cpsave').onclick=()=>{ const list=loadColors(), c=cur(); if(!list.includes(c)){ list.push(c); saveColors(list); } swatches(); };
    cp.querySelector('.cpdone').onclick=()=>{ onPick(touched?cur():null,true); cp.remove(); };
    cp.onpointerdown=e=>e.stopPropagation(); setTimeout(()=>document.addEventListener('pointerdown',function off(ev){ if(!cp.contains(ev.target)&&!field.contains(ev.target)){ document.removeEventListener('pointerdown',off); if(cp.isConnected){ cp.remove(); onPick(null,true); } } }),0);
    swatches(); sync(false); }
  function optsHTML(w,perms){ const [k,c,r,ww,hh,o0]=w, o=o0||{}, d=WIDGETS[k]||{n:k}, isTxt=TEXT_KINDS.has(k), need=NEEDS[k];
    const sw=(key,val,auto)=>`<div class="sw" data-sw="${key}">${auto?`<i class="auto ${!val?'on':''}" data-v="" title="Automatic">A</i>`:''}${SWATCH.map(x=>`<i data-v="${x}" class="${val===x?'on':''}" style="background:${x}"></i>`).join('')}</div>`;
    const lblOn=o.label===undefined?!!d.label:!!o.label;
    let h=`<div class="op"><h4>Function</h4><div class="d">${DESC[k]||''}</div>`;
    if(need&&perms&&!perms[need]) h+=`<div class="warn">View only for this user: “${(PERMS.find(p=>p[0]===need)||[,need])[1]}” is off.</div>`;
    if(k==='custom'){ const act=o.act||'toast';
      h+=`<div class="row"><span>Button text</span></div><input type="text" data-o="label" value="${(o.label||'').replace(/"/g,'&quot;')}">
        <div class="row" style="margin-top:10px"><span>When tapped</span></div><select data-o="act">${ACTIONS.map(([v,l])=>`<option value="${v}" ${act===v?'selected':''}>${l}</option>`).join('')}</select>
        ${act==='jump'?`<div class="row"><span>Section</span><select data-o="arg" style="width:60%">${SECS.map(x=>`<option ${(o.arg||'Chorus')===x?'selected':''}>${x}</option>`).join('')}</select></div>`:''}
        ${act==='mute'?`<div class="row"><span>Stem</span><select data-o="arg" style="width:60%">${STEMS.map(x=>`<option ${(o.arg||'Drums')===x?'selected':''}>${x}</option>`).join('')}</select></div>`:''}`; }
    if(isTxt||k==='custom'){ h+=`<h4>Text</h4>`;
      if(d.lab) h+=`<div class="row"><span>Label</span><button class="tg ${lblOn?'on':''}" data-t="label"></button></div>${lblOn?`<input type="text" data-o="lab" placeholder="${d.lab}" value="${(o.lab||'').replace(/"/g,'&quot;')}">`:''}`;
      h+=`${lblOn?`<div class="row"><span>Label color</span></div>${colorField('lc',o.lc,'Label color')}`:''}<div class="row"><span>Align</span><div class="seg" data-seg="align" style="width:60%">${[['l','Left'],['c','Center'],['r','Right']].map(([v,l])=>`<button data-v="${v}" class="${(o.align||(k==='mynote'||k==='nextnote'?'l':'c'))===v?'on':''}">${l}</button>`).join('')}</div></div>
        <div class="row"><span>Size</span><span style="flex:1;display:flex;align-items:center;gap:8px"><input type="range" min="50" max="160" step="5" data-o="size" value="${o.size||100}"><b style="font-weight:500;min-width:36px;text-align:right">${o.size||100}%</b></span></div>
`; }
    h+=`${isTxt||k==='custom'?'':'<h4>Text</h4>'}<div class="row"><span>Text color</span></div>${colorField('tc',o.tc,'Text color')}`;
    h+=`<h4>Background</h4><div class="row"><span>${k==='custom'?'Button color':'Bubble behind this tile'}</span>${k==='custom'?'':`<button class="tg ${o.bubble?'on':''}" data-t="bubble"></button>`}</div>${(o.bubble||k==='custom')?colorField('bb',o.bb,k==='custom'?'Button color':'Bubble color'):''}`;
    h+=`<h4>Layout</h4><div class="grid4">${[1,2,3,4].map(j=>`<div><input type="number" step="0.125" data-p="${j}" value="${fmtU(w[j])}"><small>${['X','Y','Width','Height'][j-1]}</small></div>`).join('')}</div>
      <div class="acts" style="margin-top:10px"><button data-a="front">Bring to front</button><button data-a="back">Send to back</button></div>
      <div class="acts" style="margin-top:6px"><button data-a="remove" class="del">Remove tile</button></div></div>`;
    return h; }
  // cb: {change(rebuildPanel), layer(dir), remove(), cols, rows}
  function wireOpts(root,w,cb){ const o=()=>(w[5]=w[5]||{});
    root.querySelectorAll('[data-o]').forEach(el=>{ const k=el.dataset.o; const ev=el.tagName==='SELECT'||el.type==='range'?'input':'input';
      el.addEventListener(ev,()=>{ o()[k]=el.type==='range'?+el.value:el.value; if(el.type==='range') el.nextElementSibling.textContent=el.value+'%'; cb.change(el.tagName==='SELECT'); }); });
    root.querySelectorAll('[data-t]').forEach(el=>el.onclick=()=>{ const k=el.dataset.t, d=WIDGETS[w[0]]||{}; const cur=k==='label'?(o().label===undefined?!!d.label:!!o().label):!!o()[k]; o()[k]=!cur; cb.change(true); });
    root.querySelectorAll('[data-seg]').forEach(g=>g.querySelectorAll('button').forEach(b=>b.onclick=()=>{ o()[g.dataset.seg]=b.dataset.v; cb.change(true); }));
    root.querySelectorAll('.cf').forEach(f=>{ const key=f.dataset.cf; f.querySelector('.cfb').onclick=()=>{ if(f.querySelector('.cp')){ f.querySelector('.cp').remove(); return; }
      openPicker(f,o()[key]||'',(c,final)=>{ if(c===null){ cb.change(true); return; } if(c) o()[key]=c; else delete o()[key];
        const b=f.querySelector('.cfb'); b.querySelector('i').style.background=c||'transparent'; b.querySelector('i').classList.toggle('auto',!c); b.querySelector('span').textContent=c?c.toUpperCase():'Auto'; cb.change(!!final); }); }; });
    root.querySelectorAll('[data-sw]').forEach(g=>g.querySelectorAll('i').forEach(i=>i.onclick=()=>{ if(i.dataset.v) o()[g.dataset.sw]=i.dataset.v; else delete o()[g.dataset.sw]; cb.change(true); }));
    root.querySelectorAll('[data-p]').forEach(el=>el.onchange=()=>{ const j=+el.dataset.p, v=parseFloat(el.value); if(!(v>0)) return; w[j]=Math.round(v*1000)/1000;
      w[3]=clamp(w[3],MIN,cb.cols); w[4]=clamp(w[4],MIN,cb.rows); w[1]=clamp(w[1],1,cb.cols-w[3]+1); w[2]=clamp(w[2],1,cb.rows-w[4]+1); cb.change(true); });
    root.querySelectorAll('[data-a]').forEach(b=>b.onclick=()=>{ const a=b.dataset.a; if(a==='remove') cb.remove(); else cb.layer(a); }); }
  const KEY='setline.canvases.v2', RKEY='setline.ready.v1';
  const clone=o=>JSON.parse(JSON.stringify(o));
  // Section tiles were merged into the Song timeline. Old stock layouts get the new stock layout; edited ones keep their timeline.
  const OLD_STOCK={engineer:JSON.stringify([["song",1,1,6,1],["timers",7,1,4,1],["lock",11,1,2,1],["timeline",1,2,12,1],["sections",1,3,9,5],["transport",10,3,3,1],["exitloop",10,4,3,1],["jumpmode",10,5,3,1],["upnext",10,6,3,1],["patches",10,7,3,1],["beats",1,8,4,1],["readyflags",5,8,4,1],["mutes",9,8,4,1]]),md:JSON.stringify([["song",1,1,6,1],["timers",7,1,6,1],["timeline",1,2,12,1],["sections",1,3,8,5],["countdown",9,3,4,2],["next",9,5,4,1],["notes",9,6,4,2],["beats",1,8,8,1],["readyflags",9,8,4,1]])};
  // Combined widgets were split into single-value ones; old boxes are divided in place.
  const SPLIT={ song:['h',[['songpos',.1],['songname',.5],['bpm',.14],['meter',.1],['key',.16]]], timers:['h',[['songleft',.5],['setleft',.5]]],
    transport:['h',[['prevbtn',.25],['play',.5],['nextbtn',.25]]], countdown:['v',[['section',.45],['barsleft',.55]]], next:['h',[['nextsec',1]]],
    upnext:['h',[['nextsong',.62],['transition',.38]]], notes:['v',[['mynote',.68],['nextnote',.32]]], patches:['h',[['qcpatch',.36],['axepatch',.36],['resend',.28]]] };
  function splitW(list){ const out=[]; (list||[]).forEach(w=>{ const sp=SPLIT[w[0]]; if(!sp){ out.push(w); return; }
      let [dir,parts]=sp; if(w[0]==='notes'&&w[4]<1.5) parts=[['mynote',1]]; const tot=dir==='h'?w[3]:w[4]; let at=0;
      parts.forEach(([k,f],i)=>{ const len=i===parts.length-1?tot-at:Math.max(MIN,snap(tot*f)); if(len<MIN) return;
        const box=dir==='h'?[k,w[1]+at,w[2],len,w[4]]:[k,w[1],w[2]+at,w[3],len]; if(WIDGETS[k].label) box.push({label:true}); out.push(box); at+=len; }); });
    return out; }
  function migrate(x){ x.perms=x.perms||{}; if(x.perms.layout===undefined) x.perms.layout=1;
    if(x.w.some(w=>SPLIT[w[0]])) x.w=splitW(x.w); if(x.macW&&x.macW.some(w=>SPLIT[w[0]])) x.macW=splitW(x.macW);
    if(!x.w.some(w=>w[0]==='sections')) return;
    const d=DEFAULT_USERS.find(y=>y.id===x.id);
    if(d&&OLD_STOCK[x.id]===JSON.stringify(x.w)){ x.w=clone(d.w); return; }
    const sec=x.w.find(w=>w[0]==='sections'), tl=x.w.find(w=>w[0]==='timeline');
    if(tl) x.w=x.w.filter(w=>w!==sec); else sec[0]='timeline'; }
  DEFAULT_USERS.forEach(u=>{ u.w=splitW(u.w); });
  function load(){ try{ const j=localStorage.getItem(KEY); if(j){ const u=JSON.parse(j); if(Array.isArray(u)&&u.length){ u.forEach(migrate); if(!u.some(x=>x.id==='mac')) u.unshift(clone(DEFAULT_USERS[0])); return u; } } }catch(e){} return clone(DEFAULT_USERS); }
  function save(users){ try{ localStorage.setItem(KEY, JSON.stringify(users)); return true; }catch(e){ return false; } }
  function reset(){ try{ localStorage.removeItem(KEY); }catch(e){} return clone(DEFAULT_USERS); }
  function loadReady(){ try{ return JSON.parse(localStorage.getItem(RKEY)||'{}'); }catch(e){ return {}; } }
  function saveReady(r){ try{ localStorage.setItem(RKEY, JSON.stringify(r)); }catch(e){} }
  return {loadColors,saveColors,openPicker,optsHTML,wireOpts,OPTS_CSS,TEXT_KINDS,guideSnap,GROUPS,SNAP,MIN,snap,clamp,fmtU,dragBox,HANDLES,THEMES,ACCENTS,DEFAULT_STYLE,WIDGETS,PERMS,NOTE_ROLES,DEFAULT_USERS,KEY,RKEY,load,save,reset,loadReady,saveReady,clone};
})();
