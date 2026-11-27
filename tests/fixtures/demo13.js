// set.Line 13 §20: the example songs live with the tests now, not in the app. The browser test harnesses serve this
// file and load the page with ?demo (tests/ui-timeline.mjs, ui-webkit.mjs, ui-layout.mjs); the app never loads it.
window.SETLINE_DEMO = {
  songs: [
  { id:'neon', name:'Neon Rivers', key:'A min', col:'#f5a524', trans:'segue', tmap:[{bar:1,bpm:128,sig:[4,4]}],
    secs:[['Intro','intro',8],['Verse 1','verse',16],['Pre','pre',8],['Chorus 1','chorus',16],['Verse 2','verse',16],['Pre','pre',8],['Chorus 2','chorus',16],['Bridge','bridge',8],['Chorus 3','chorus',16],['Outro','outro',8]],
    tracks:['Click','Cues','Drums','Bass','Keys','Guitars','BGVs','Synth / Pads','FX / Risers','Guitar rig','Lights'] },
  { id:'glass', name:'Glasshouse', key:'F♯', col:'#22c3a6', trans:'stop',
    tmap:[{bar:1,bpm:92,sig:[4,4]},{bar:25,sig:[7,8]},{bar:27,sig:[4,4]},{bar:41,bpm:96},{bar:69,bpm:96},{bar:77,bpm:84,ramp:true}],
    secs:[['Intro','intro',8],['Verse 1','verse',16],['Turn','turn',2],['Chorus 1','chorus',14],['Verse 2','verse',16],['Chorus 2','chorus',12],['Outro (rit.)','outro',12]],
    tracks:['Click','Cues','Drums','Bass','Keys','Guitars','Strings','Guitar rig','Lights'] },
  { id:'low', name:'Low Tide', key:'D', col:'#6b7cff', trans:'auto', tmap:[{bar:1,bpm:76,sig:[6,8]}],
    secs:[['Intro','intro',8],['Verse','verse',16],['Chorus','chorus',16],['Verse','verse',16],['Chorus','chorus',16],['Outro','outro',12]],
    tracks:['Click','Cues','Drums','Bass','Keys','Pads','Guitar rig'] },
  { id:'sat', name:'Satellites', key:'E min', col:'#ff5fa2', trans:'segue', tmap:[{bar:1,bpm:140,sig:[4,4]},{bar:57,bpm:150}],
    secs:[['Intro','intro',8],['Verse','verse',16],['Chorus','chorus',16],['Verse','verse',16],['Chorus','chorus',16],['Bridge','bridge',8],['Chorus','chorus',16],['Outro','outro',4]],
    tracks:['Click','Cues','Drums','Bass','Guitars','Synth / Pads','Lights'] },
  { id:'copper', name:'Copper Sun', key:'B♭', col:'#a46bff', trans:'stop', tmap:[{bar:1,bpm:110,sig:[4,4]},{bar:33,sig:[3,4]},{bar:41,sig:[4,4]}],
    secs:[['Intro','intro',8],['Verse','verse',16],['Pre','pre',8],['Waltz','bridge',8],['Chorus','chorus',16],['Chorus','chorus',16],['Outro','outro',8]],
    tracks:['Click','Cues','Drums','Bass','Keys','Guitars','BGVs','Guitar rig','Lights'] },
  { id:'paper', name:'Paper Kings', key:'A', col:'#ff9f43', trans:'stop', tmap:[{bar:1,bpm:100,sig:[4,4]}],
    secs:[['Intro','intro',8],['Verse','verse',16],['Chorus','chorus',16],['Verse','verse',16],['Chorus','chorus',16],['Outro','outro',8]],
    tracks:['Click','Cues','Drums','Bass','Guitars','Guitar rig'] },
  { id:'under', name:'Undertow (alt intro)', key:'C♯ min', col:'#5aa9ff', trans:'stop', tmap:[{bar:1,bpm:72,sig:[4,4]},{bar:9,bpm:88,ramp:true}],
    secs:[['Rubato intro','intro',8],['Verse','verse',16],['Chorus','chorus',16],['Verse','verse',16],['Chorus','chorus',16],['Outro','outro',8]],
    tracks:['Click','Cues','Drums','Bass','Keys','Guitars','Lights'] },
  { id:'sound', name:'Soundcheck loop', key:'—', col:'#7d8696', trans:'stop', tmap:[{bar:1,bpm:120,sig:[4,4]}],
    secs:[['Loop','verse',16]], tracks:['Click','Drums','Bass','Keys'] },
],
  setOrder: ['neon', 'glass', 'low', 'sat', 'copper'],
  setlists: (order) => [{id:'L1',name:'Full show',order:order},{id:'L2',name:'Festival 30',order:['neon','glass','sat']},{id:'L3',name:'Acoustic',order:['low','paper']}],
  // the extras made once the page has its helpers: Glasshouse's versions, Neon Rivers' MIDI alternate, the setlist's transitions
  after: () => {
    // example: Glasshouse has a "With intro" version (an intro pad only it plays, then everything from Verse 1) and a
    // "Festival cut" (Verse 1, Chorus 1, Chorus 2, Outro); the Full show plays "With intro" and segues out of Neon Rivers.
    (()=>{ const g=songs.find(x=>x.id==='glass'); if(g){ versOf(g); const secs=[...g.secs].sort((a,b)=>a.start-b.start), id=n=>(secs.find(x=>x.name===n)||{}).id;
        const wi={id:'v'+verSeq++,name:'With intro',order:secs.map(x=>({k:'sec',id:x.id,on:x.name!=='Intro'})),extras:[{id:'x'+xSeq++,name:'Intro pad',bars:8,track:'Intro pad ◆'}]};
        wi.order.unshift({k:'x',id:wi.extras[0].id,on:true}); g.tracks.push('Intro pad ◆'); (g.vonly||(g.vonly={}))['Intro pad ◆']=wi.id; (g.tcol||(g.tcol={}))['Intro pad ◆']='#bf5af2';
        const fc={id:'v'+verSeq++,name:'Festival cut',order:secs.map(x=>({k:'sec',id:x.id,on:['Verse 1','Chorus 1','Chorus 2','Outro (rit.)'].includes(x.name)})),extras:[]};
        g.versions.push(wi,fc); buildBars(g); const L1=setlists.find(l=>l.id==='L1'); if(L1){ (L1.vers||(L1.vers={})).glass=wi.id; (L1.after||(L1.after={})).neon={mode:'segue',sec:4}; L1.after.low={mode:'auto',sec:4}; L1.after.sat={mode:'segue',sec:4}; } }
      const n=songs.find(x=>x.id==='neon'); if(n){ const ax=n.tracks.find(t=>t==='Lights'); if(ax){ altsOf(n,ax); const cur=n.muse[ax]; newAlt(n,ax,true,'Festival looks'); useAlt(n,ax,cur); } }
      songs.forEach(s=>delete s.trans); })();
  },
};
