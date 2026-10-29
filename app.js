'use strict';
(() => {
  // Original local toy ecology. Water is transferred between phases/reservoirs,
  // never spawned by a weather timer. Scene presets only place initial matter.
  let layoutReady=false,saveReady=false,saveWarningText='';
  const materialSound=window.MaterialSound?window.MaterialSound.create():{enabled:false,unlock:()=>Promise.resolve(false),gesture:()=>false,ambience(){},setEnabled(){},stop(){}};
  let gestureSpeed=0,gestureTime=0,audioForeground=true;
  let soundActivity={rain:0,fire:0,snow:0};
  function audibleActivity(kind,i){const x=i%W,y=Math.floor(i/W);if(x>=viewport.x&&x<viewport.x+viewport.w&&y>=viewport.y&&y<viewport.y+viewport.h)soundActivity[kind]++;}
  function updateSceneSound(){
    if(document.hidden||!audioForeground||paused||!materialSound.enabled){materialSound.ambience({rain:0,fire:0,snow:0});return;}
    materialSound.ambience({rain:Math.min(1,soundActivity.rain/220),fire:Math.min(1,soundActivity.fire/100),snow:Math.min(1,soundActivity.snow/100)});
  }
  function silenceMaterials(){materialSound.stop(true);gestureSpeed=0;gestureTime=0;}
  function materialGesture(type,count){
    if(pointer===null||erasing||paused||document.hidden||!materialSound.enabled)return;
    const kind=type===WALL?'stone':type===SAND?'sand':type===SOIL?'soil':type===GOLD?'gold':type===WOOD?'wood':type===SEED?'grow':null;
    if(!count||!kind){materialSound.stop();return;}
    materialSound.gesture(kind,Math.min(1,.2+.5*Math.min(1,count/30)+.2*gestureSpeed));
  }
  const artworkStore=window.ArtworkStorage.create({storage:()=>window.localStorage,now:()=>Date.now(),snapshot:captureArtwork,status:showSaveStatus});
  const restoredArtwork=artworkStore.restored;
  const aspect=Math.max(.4,Math.min(2.6,innerWidth/innerHeight));
  // Restore the complete backing world; orientation changes expand it without resampling.
  let W=restoredArtwork?restoredArtwork.grid[0]:Math.round(Math.sqrt(172800*aspect)/8)*8,H=restoredArtwork?restoredArtwork.grid[1]:Math.round(Math.sqrt(172800/aspect)/8)*8,N=W*H;const STEP=1000/30;
  function markArtwork(arm=false){if(saveReady)artworkStore.mark(arm);}
  function flushArtwork(reset=false){if(saveReady)return artworkStore.flush(reset);return false;}
  const E=0,SAND=1,WATER=2,WALL=3,WOOD=4,OIL=5,FIRE=6,SOIL=7,SEED=8,VAPOR=9,CLOUD=10,LEAF=11,LITTER=12,SNOW=13,ASH=14,ICE=15,GOLD=16;
  const BROADLEAF=0,PINE=1;
  const speciesRules=[
    {name:'broadleaf',lifespan:9000,variation:3600,drought:540,decline:300},
    {name:'pine',lifespan:16500,variation:6000,drought:1080,decline:660}
  ];
  // Species travels with a seed through falls, swaps and germination.
  let seedKind=new Uint8Array(N);
  const looseMineral=t=>t===SAND||t===SOIL||t===WALL;
  let HW=W/4,HH=H/4,heat=new Float32Array(HW*HH),heatNext=new Float32Array(HW*HH);
  const heatIndex=i=>Math.floor((i%W)/4)+Math.floor(i/W/4)*HW;
  let CW=W/8,CH=H/8,coldCount=new Uint16Array(CW*CH),waterCount=new Uint16Array(CW*CH);
  let cells=new Uint8Array(N),life=new Uint16Array(N),wet=new Uint16Array(N);
  let frostAge=new Uint16Array(N);
  let decay=new Uint16Array(N),rainDrop=new Uint8Array(N),goldOre=new Uint8Array(N);
  let moisture=new Uint8Array(N),grain=new Uint8Array(N),owner=new Uint16Array(N),seen=new Uint32Array(N);
  let ceiling=new Uint16Array(W),plants=[],woodCells=new Set();
  let flora=new Uint8Array(N),floraOwner=new Uint16Array(N),floraLife=new Uint16Array(N),floraWet=new Uint16Array(N),floraShade=new Uint8Array(N),floraCells=new Set();
  const canvas=document.querySelector('#world'),canvasShell=document.querySelector('.canvas-shell'),materialDock=document.querySelector('#material-drawer'),headerBar=document.querySelector('.topbar'),ctx=canvas.getContext('2d',{alpha:false});
  canvas.width=W*2;canvas.height=H*2;
  let viewport={x:0,y:0,w:W,h:H,scale:1,left:0,top:0,width:innerWidth,height:innerHeight};
  function canvasArea(){
    const style=typeof getComputedStyle==='function'?getComputedStyle(canvasShell):null;
    const safe=key=>style?Math.max(0,parseFloat(style[key])||0):0;
    const left=safe('paddingLeft'),right=safe('paddingRight'),top=safe('paddingTop'),bottom=safe('paddingBottom');
    // Measure the actual drawing box; a host can resize it before window metrics.
    const boxWidth=canvasShell.clientWidth>0?canvasShell.clientWidth:innerWidth,boxHeight=canvasShell.clientHeight>0?canvasShell.clientHeight:innerHeight;
    // The dock's row count follows the full host box, never the area it leaves.
    // Otherwise a nearly square screen can oscillate between one and two rows.
    const orientation=boxWidth>=boxHeight?'landscape':'portrait';
    if(document.body.dataset.canvasOrientation!==orientation)document.body.dataset.canvasOrientation=orientation;
    const dockHeight=materialDock.offsetHeight>0?materialDock.offsetHeight:0;
    const dockWidth=materialDock.offsetWidth>0?materialDock.offsetWidth:0;
    // Each dock includes its own edge safe area; reserve that edge only once.
    const reservedBottom=orientation==='portrait'?Math.max(bottom,dockHeight):bottom;
    const reservedRight=orientation==='landscape'?Math.max(right,dockWidth):right;
    const headerHeight=headerBar.offsetHeight>0?headerBar.offsetHeight:0,headerWidth=headerBar.offsetWidth>0?headerBar.offsetWidth:0;
    const reservedTop=orientation==='portrait'?Math.max(top,headerHeight):top;
    const reservedLeft=orientation==='landscape'?Math.max(left,headerWidth):left;
    const inset=2;
    return {left:reservedLeft+inset,top:reservedTop+inset,width:Math.max(32,boxWidth-reservedLeft-reservedRight-inset*2),height:Math.max(32,boxHeight-reservedTop-reservedBottom-inset*2),boxWidth,boxHeight};
  }
  function updateLayoutDiagnostics(){
    const node=document.querySelector('#layout-diagnostics');if(!node)return;
    const width=canvasShell.clientWidth>0?canvasShell.clientWidth:innerWidth,height=canvasShell.clientHeight>0?canvasShell.clientHeight:innerHeight;
    node.textContent='窗口 '+Math.round(innerWidth)+' × '+Math.round(innerHeight)+'\n容器 '+Math.round(width)+' × '+Math.round(height)+'\n布局 '+(document.body.dataset.canvasOrientation==='landscape'?'横屏':'竖屏')+'\n画心 '+Math.round(viewport.width)+' × '+Math.round(viewport.height);
  }
  function fitCanvas(){
    const area=canvasArea(),long=Math.max(W,H),ratio=area.width/area.height;
    const vw=ratio>=1?long:long*ratio,vh=ratio>=1?long/ratio:long;
    const scale=area.width/vw,x=(W-vw)/2,y=H-vh;
    viewport={x,y,w:vw,h:vh,scale,left:area.left,top:area.top,width:area.width,height:area.height};
    canvasShell.style.clipPath='inset('+area.top+'px '+(area.boxWidth-area.left-area.width)+'px '+(area.boxHeight-area.top-area.height)+'px '+area.left+'px)';
    Object.assign(canvas.style,{width:W*scale+'px',height:H*scale+'px',left:area.left-x*scale+'px',top:area.top-y*scale+'px'});
    updateLayoutDiagnostics();
  }
  fitCanvas();window.addEventListener('resize',resizeCanvas);
  window.addEventListener('orientationchange',()=>{resizeCanvas();setTimeout(resizeCanvas,120);});
  if(window.visualViewport)window.visualViewport.addEventListener('resize',resizeCanvas);
  // Read-only screen/layout notifications never request a native orientation lock.
  try{
    const screenOrientation=window.screen&&window.screen.orientation;
    if(screenOrientation&&typeof screenOrientation.addEventListener==='function')screenOrientation.addEventListener('change',resizeCanvas);
  }catch(error){/* A host may restrict this optional notification; resize remains available. */}
  try{
    if(typeof window.ResizeObserver==='function'){
      const canvasObserver=new window.ResizeObserver(resizeCanvas);canvasObserver.observe(canvasShell);
      try{canvasObserver.observe(materialDock,{box:'border-box'});}catch(error){canvasObserver.observe(materialDock);}
      try{canvasObserver.observe(headerBar,{box:'border-box'});}catch(error){canvasObserver.observe(headerBar);}
    }
  }catch(error){/* Older or restricted hosts retain the window resize fallback. */}
  const buffer=document.createElement('canvas');buffer.width=W;buffer.height=H;
  const raster=buffer.getContext('2d',{alpha:false});let pixels=raster.createImageData(W,H);
  const air=document.createElement('canvas');air.width=W/2;air.height=H/2;const airCtx=air.getContext('2d');
  const $=s=>document.querySelector(s),hint=$('#hint'),invitation=$('#invitation');
  // Mineral-inspired palettes are presentation only: switching preserves matter.
  const palettes={
    qing:[[233,226,208],[191,165,111],[77,148,148],[47,105,114],[141,108,72],[96,115,106],[230,104,53],[54,116,100],[144,130,61],[210,221,208],[225,232,216],[111,155,107],[158,136,87],[246,247,232],[99,113,104],[163,201,193],[218,174,65]],
    ink:[[23,53,56],[138,164,151],[77,145,146],[48,99,107],[108,127,117],[73,94,106],[224,125,86],[57,96,96],[148,157,120],[191,213,213],[210,228,225],[124,161,142],[126,145,119],[242,249,242],[92,111,113],[174,211,212],[201,177,104]],
    ochre:[[239,224,197],[206,159,95],[102,153,146],[106,116,98],[145,105,72],[107,114,97],[214,94,55],[132,120,75],[152,140,64],[222,220,200],[235,235,214],[140,158,104],[172,133,73],[251,246,227],[117,110,95],[190,212,190],[225,173,67]]
  };
  let palette='qing',colors=palettes.qing,brush=1;
  function setPalette(name){markArtwork(true);palette=name;colors=palettes[name];document.body.dataset.palette=name;for(const b of document.querySelectorAll('[data-palette]'))if(b.tagName==='BUTTON')b.setAttribute('aria-pressed',String(b.dataset.palette===name));for(const b of document.querySelectorAll('[data-material]'))b.style.setProperty('--swatch','rgb('+colors[Number(b.dataset.material)].join(',')+')');dirty=true;updateMaterialLabel();}
  const hints=['','轻轻撒沙，散开的细粒会慢慢堆成沙坡。','洒下一阵水滴。水会散开落下，再汇成水面。','碎岩散落，堆成山与岸。擦去支撑，岩粒会继续下落。','木屑一粒粒散落、堆积，也会浮在水面上。烧尽后留下炭灰。','油浮在水上，也会遮住水面。遇火会蔓延。','火能烧掉木屑与油；遇水会腾起水汽。','细土散落成堆，能留住水。湿土给种子一处落脚点。','一粒粒撒在湿土上：约七成阔叶、三成松。颜色略有不同，有阳光就慢慢生长。'];
  hints[GOLD]='金粉沉过水和油；水洗湿沙时缓慢筛落。干沙、土、木屑、冰与岩石能托住它。';
  hints[SNOW]='雪轻轻飘落，岸与活枝都能托住它。拨冷后积雪不被湖水吞掉；拨暖或靠近火，雪与冰慢慢融成水。';
  let cold=false,thawing=false;
  const surfaceMarks=[]; // Short-lived ink marks only; never water particles.
  let selected=SAND,erasing=false,paused=false,sun=true,drainOpen=false,tick=0,pointer=null,last=null;
  let seedDistance=0,seedWait=0;
  let lastTime=0,accumulator=0,dirty=true,scene='free',notice='每一滴都能再回来',noticeUntil=0;
  let metrics={},performanceSample={stepMs:0,renderMs:0,frames:0},lastPhase={};
  function clearMetrics(){metrics={sifted:0,panned:0,drained:0,ashProduced:0,snowed:0,leavesShed:0,regrown:0,frozen:0,iceMelted:0,waterMelted:0,melted:0,heatVaporized:0,evaporated:0,heated:0,condensed:0,rained:0,returned:0,absorbed:0,transpired:0,germinated:0,grown:0,withered:0,composted:0,seedsReleased:0,quenched:0};lastPhase={};}
  clearMetrics();
  const inside=(x,y)=>x>=0&&x<W&&y>=0&&y<H;
  function put(i,t,value=0,species){if(cells[i]===WOOD)woodCells.delete(i);if(t===WOOD)woodCells.add(i);cells[i]=t;seedKind[i]=t===SEED?(species==null?(Math.random()<.3?PINE:BROADLEAF):species):BROADLEAF;life[i]=value;wet[i]=0;moisture[i]=0;decay[i]=0;frostAge[i]=0;rainDrop[i]=0;goldOre[i]=t===SAND&&Math.random()<.009?1:0;owner[i]=0;grain[i]=(Math.random()*255)|0;dirty=true;}
  function neighbor(i,dx,dy){const x=i%W,y=(i/W)|0;return inside(x+dx,y+dy)?i+dx+dy*W:-1;}
  function eachNear(i,fn){const x=i%W;if(x>0)fn(i-1);if(x<W-1)fn(i+1);if(i>=W)fn(i-W);if(i<N-W)fn(i+W);}
  function swap(a,b){const aw=cells[a]===WOOD,bw=cells[b]===WOOD;woodCells.delete(a);woodCells.delete(b);if(aw)woodCells.add(b);if(bw)woodCells.add(a);for(const field of [cells,life,wet,moisture,grain,owner,decay,rainDrop,goldOre,frostAge,seedKind]){const n=field[a];field[a]=field[b];field[b]=n;}seen[a]=seen[b]=tick;dirty=true;}
  function say(text){notice=text;noticeUntil=tick+110;}
  function vaporize(i,heated=false){if(cells[i]!==WATER)return;put(i,VAPOR);seen[i]=tick;metrics.evaporated++;if(heated)metrics.heated++;lastPhase.vapor=tick;if(heated)say('水受热，升起了一缕汽');}
  // Coarse local heat field: burning fuel warms its surroundings and cools
  // gradually after the source goes out. This is a toy, not a temperature model.
  function spreadHeat(){
    for(let y=0;y<HH;y++)for(let x=0;x<HW;x++){
      const i=y*HW+x,h=heat[i];let sum=0;
      for(const j of [x>0?i-1:i,x<HW-1?i+1:i,y>0?i-HW:i,y<HH-1?i+HW:i])sum+=heat[j];
      heatNext[i]=Math.max(0,h*.68+sum*.08-.38);
    }
    heat.set(heatNext);
  }
  function warm(i,amount){const j=heatIndex(i);heat[j]=Math.max(heat[j],amount);}
  function melt(i){const wasIce=cells[i]===ICE;if(cells[i]!==SNOW&&!wasIce)return;put(i,WATER);wet[i]=45;seen[i]=tick;metrics.melted++;if(wasIce)metrics.iceMelted++;heat[heatIndex(i)]=Math.max(0,heat[heatIndex(i)]-.4);if(metrics.melted%80===1)say('雪与冰融化，汇成了水');}
  // Contact phase changes use a local 3x3 neighborhood of 8px tiles.
  // Separate thresholds avoid flip-flopping between melting and freezing.
  function countColdMatter(){
    coldCount.fill(0);waterCount.fill(0);
    for(let i=0;i<N;i++){
      const t=cells[i];if(t!==SNOW&&t!==ICE&&t!==WATER)continue;
      const j=Math.floor(i%W/8)+Math.floor(i/W/8)*CW;
      if(t===WATER)waterCount[j]++;else coldCount[j]++;
    }
  }
  function nearbyPhase(i){
    const x=Math.floor(i%W/8),y=Math.floor(i/W/8);let cold=0,water=0;
    for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++)if(x+dx>=0&&x+dx<CW&&y+dy>=0&&y+dy<CH){const j=(y+dy)*CW+x+dx;cold+=coldCount[j];water+=waterCount[j];}
    return {cold,water};
  }
  // Ambient cold reaches the water from above, through at most two existing
  // ice cells. Exposure must persist: isolated falling drops cannot freeze.
  function surfaceFreezeEligible(i){
    if(i<N-W&&[E,VAPOR,CLOUD,FIRE].includes(cells[i+W]))return false;
    let j=i-W,depth=0;
    while(j>=0&&cells[j]===ICE&&depth<3){depth++;j-=W;}
    return depth<3&&(j<0||[E,VAPOR,CLOUD,SNOW].includes(cells[j]));
  }
  function exposedColdMatter(i){
    let exposed=i<W;eachNear(i,j=>{if([E,VAPOR,CLOUD,WATER,FIRE].includes(cells[j]))exposed=true;});return exposed;
  }
  function setTemperature(value){
    if(cold===value)return;
    markArtwork(true);cold=value;thawing=!cold;frostAge.fill(0);
    $('#temperature').setAttribute('aria-pressed',String(cold));$('#temperature').textContent=cold?'寒暖 · 冷':'寒暖 · 暖';
    $('#temperature-note').textContent=cold?'云雨成雪，水面渐封；阔叶落叶，松针留青':'雪冰渐融，湿土中的枝头会再生叶';
    dirty=true;updateReadout();
  }
  function leaveAsh(i){put(i,ASH);seen[i]=tick;metrics.ashProduced++;}
  function damp(i){
    const x=i%W,y=(i/W)|0;
    for(let dy=-3;dy<=3;dy++)for(let dx=-3;dx<=3;dx++){
      if(!inside(x+dx,y+dy))continue;const j=i+dx+dy*W,t=cells[j];
      if(flora[j]){if(floraLife[j])metrics.quenched++;floraWet[j]=210;floraLife[j]=0;}
      if(t===WOOD||t===LEAF||t===LITTER){if(life[j])metrics.quenched++;wet[j]=Math.max(wet[j],210);life[j]=0;}
      if(t===FIRE){put(j,E);metrics.quenched++;}
    }
  }
  function ignite(i){if(flora[i]&&floraWet[i]===0&&floraLife[i]===0)floraLife[i]=110;const t=cells[i];if((t===WOOD||t===OIL||t===LEAF||t===LITTER)&&life[i]===0&&wet[i]===0)life[i]=t===WOOD?145:t===OIL?55:95;}
  function goldCanSettle(i,j,t){
    if(t===WATER||t===OIL)return true;
    if(t!==SAND||Math.random()>.045)return false;
    let washed=false;eachNear(i,n=>{if(cells[n]===WATER)washed=true;});eachNear(j,n=>{if(cells[n]===WATER)washed=true;});
    if(washed)metrics.sifted++;return washed;
  }
  function drift(i,dx,dy,type,exchange=true){
    const j=neighbor(i,dx,dy);if(j<0)return -1;const t=cells[j];
    // Only snow rests on living branches; rain/water remain permeable.
    if(type===SNOW&&flora[j]===WOOD)return -1;
    if(type===WATER&&t===FIRE){put(j,E);damp(j);swap(i,j);vaporize(j,true);return j;}
    if(t===E||t===FIRE||(type!==FIRE&&type!==VAPOR&&type!==CLOUD&&(t===VAPOR||t===CLOUD))){
      if(t===FIRE)put(j,E);swap(i,j);return j;
    }
    if(exchange&&dy>0&&(((type===WALL||type===SAND||type===SOIL||type===SEED||type===LITTER)&&(t===WATER||t===OIL))||(type===WATER&&(t===OIL||t===WOOD||t===ICE))||(type===GOLD&&goldCanSettle(i,j,t)))){swap(i,j);return j;}
    return -1;
  }
  function iFromXY(x,y){return y*W+x;}
  function updateSky(){
    ceiling.fill(H);
    for(let x=0;x<W;x++)for(let y=0;y<H;y++){const t=cells[y*W+x];if(t===WALL||t===WOOD||t===SOIL||t===SAND||t===LEAF||flora[iFromXY(x,y)]){ceiling[x]=y;break;}}
  }
  function wetSoilNear(x,y){
    for(let attempt=0;attempt<35;attempt++){
      const dx=((Math.random()*19)|0)-9,dy=((Math.random()*9)|0);if(!inside(x+dx,y+dy))continue;
      const i=(y+dy)*W+x+dx;if(cells[i]===SOIL&&moisture[i]>0)return i;
    }
    return -1;
  }
  function sprout(i){
    const x=i%W,y=(i/W)|0;
    if(cold||!sun||plants.filter(p=>p.alive).length>=24||plants.some(p=>p.alive&&Math.abs(p.x-x)<15&&Math.abs(p.y-y)<25))return false;
    if(wetSoilNear(x,y+1)<0)return false;
    if(!rootSupported(x,y))return false;
    const id=plants.length+1;if(id>65000)return false;
    const species=seedKind[i],pine=species===PINE,rules=speciesRules[species];
    put(i,E);flora[i]=WOOD;floraOwner[i]=id;floraShade[i]=(Math.random()*255)|0;floraCells.add(i);
    const form=pine?3:Math.floor(Math.random()*3),target=pine?24+Math.floor(Math.random()*10):34+Math.floor(Math.random()*27)+(form===2?10:0);
    plants.push({id,x,y,species,lifespan:rules.lifespan+Math.floor(Math.random()*rules.variation),decline:0,fadeLeaves:[],fadeCursor:0,tipX:x,alive:true,height:0,target,water:0,drought:0,age:0,dormant:false,buds:[],budCursor:0,shedCursor:0,parts:[i],lastSeed:0,form,lean:(Math.random()-.5)*(pine?.3:.23),bend:1+Math.random()*(pine?1.5:3),phase:Math.random()*Math.PI*2,crown:(pine?8:7)+Math.random()*(pine?3:5),tone:(Math.random()-.5)*(pine?14:28),nextBranch:Math.round(target*(pine?.27:form===1?.4:.57)),branchCount:0});
    metrics.germinated++;say('湿土里的种子，发芽了');return true;
  }
  function plantCell(p,x,y,t=LEAF){
    if(!inside(x,y))return false;const i=y*W+x;
    if(floraOwner[i]===p.id&&flora[i]){if(t===WOOD)flora[i]=WOOD;return true;}
    if(flora[i]||![E,WATER,VAPOR,CLOUD].includes(cells[i]))return false;
    flora[i]=t;floraOwner[i]=p.id;floraShade[i]=(Math.random()*255)|0;floraWet[i]=60;floraCells.add(i);p.parts.push(i);return true;
  }
  function plantLeaf(p,x,y,width=p.crown,height=p.form===1?3:p.form===2?7:5){
    const rx=Math.ceil(width),ry=Math.ceil(height);
    for(let dy=-ry;dy<=ry;dy++)for(let dx=-rx;dx<=rx;dx++){
      const angle=Math.atan2(dy/height,dx/width),edge=dx*dx/(width*width)+dy*dy/(height*height);
      if(edge<=.9+.12*Math.sin(angle*5+p.phase))plantCell(p,x+dx,y+dy);
    }
  }
  function branch(p,x,y,reach,side,rise){
    let bx=x,by=y;
    for(let j=1;j<=reach;j++){
      const nx=x+side*j,ny=y-Math.round(j*rise);
      if(!plantCell(p,nx,ny,WOOD))break;bx=nx;by=ny;
    }
    return [bx,by];
  }
  function growCrownBranch(p,x,y){
    if(p.species===PINE){
      // Uneven paired boughs form low, flat needle tiers, tapering toward the tip.
      for(const side of [-1,1]){
        const reach=Math.max(2,Math.round(p.crown*(1-p.height/p.target*.72)*(.78+Math.random()*.3)));
        const rise=.08+Math.random()*.14,[bx,by]=branch(p,x,y,reach,side,rise);
        for(let j=2;j<=Math.abs(bx-x);j+=3)plantLeaf(p,x+side*j,y-Math.round(j*rise)-1,2.2+Math.random(),1.2);
        plantLeaf(p,bx,by-1,2.6+Math.random(),1.5);
      }
      p.branchCount+=2;p.nextBranch=p.height+5+Math.floor(Math.random()*3);return;
    }
    const side=(p.branchCount%2===0?1:-1)*(p.lean<0?-1:1),reach=Math.round(p.crown*(p.form===1?1.15:.9)*(0.65+Math.random()*.55));
    const rise=p.form===1?.18:.5+Math.random()*.3;const [bx,by]=branch(p,x,y,reach,side,rise);
    plantLeaf(p,bx,by-1,p.crown*(.55+Math.random()*.28),p.form===1?2.5:4+Math.random()*2);
    if(p.form!==1&&Math.abs(bx-x)>6){const pivot=Math.floor(Math.abs(bx-x)*.5);const [fx,fy]=branch(p,x+side*pivot,y-Math.round(pivot*rise),4+Math.floor(Math.random()*4),-side,.85);plantLeaf(p,fx,fy-1,p.crown*.5,3.5);}
    p.branchCount++;p.nextBranch=p.height+7+Math.floor(Math.random()*7);
  }
  function releaseWater(p){
    if(p.water<=0)return;
    for(let n=0;n<12;n++){
      const x=p.x+((Math.random()*13)|0)-6,y=p.y-p.height-4-((Math.random()*8)|0);
      if(inside(x,y)&&cells[y*W+x]===E){put(y*W+x,VAPOR);p.water--;metrics.transpired++;lastPhase.vapor=tick;break;}
    }
  }
  function rootSupported(x,y){
    if(y>=H-2||cells[(y+1)*W+x]!==SOIL)return false;
    // A seed cannot anchor itself to soil that is still falling.
    const below=cells[(y+2)*W+x];
    return [SOIL,SAND,WALL,WOOD].includes(below);
  }
  function shedPart(i){
    const material=flora[i]===WOOD?WOOD:LITTER;
    flora[i]=0;floraOwner[i]=0;floraLife[i]=0;floraWet[i]=0;floraCells.delete(i);
    if(cells[i]===E){put(i,material);return;}
    // Keep any water occupying the permeable vegetation cell intact.
    for(let radius=1;radius<=4;radius++)for(const [dx,dy] of [[-radius,0],[radius,0],[0,-radius],[0,radius]]){
      const j=neighbor(i,dx,dy);if(j>=0&&cells[j]===E){put(j,material);return;}
    }
  }
  function wither(p){
    if(!p.alive)return;p.alive=false;metrics.withered++;say(p.decline?'老枝渐枯，回到土里':'失去根或缺水，枝叶散落回地面');
    for(const i of p.parts)if(floraOwner[i]===p.id&&flora[i])shedPart(i);
  }
  function pruneDisconnected(p){
    const root=p.y*W+p.x,connected=new Set([root]),queue=[root];
    for(let n=0;n<queue.length;n++)for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
      if(!dx&&!dy)continue;const j=neighbor(queue[n],dx,dy);
      if(j>=0&&flora[j]&&floraOwner[j]===p.id&&!connected.has(j)){connected.add(j);queue.push(j);}
    }
    let removed=false;
    for(const i of p.parts)if(flora[i]&&floraOwner[i]===p.id&&!connected.has(i)){shedPart(i);removed=true;}
    if(removed){
      // A severed tree stops extending from its former, now absent tip.
      const stems=queue.filter(i=>flora[i]===WOOD);
      const tip=stems.reduce((a,b)=>a<b?a:b,root);p.height=p.y-Math.floor(tip/W);p.tipX=tip%W;p.target=p.height;
      p.parts=p.parts.filter(i=>floraOwner[i]===p.id&&flora[i]);
    }
  }
  function enterDormancy(p){
    p.dormant=true;p.shedCursor=0;p.budCursor=0;
    p.buds=[...new Set([...p.buds.filter(i=>i>=0),...p.parts.filter(i=>floraOwner[i]===p.id&&flora[i]===LEAF)])];
    // A shuffled list sheds a few scattered leaves at a time, not whole rows.
    for(let n=p.buds.length-1;n>0;n--){const j=Math.floor(Math.random()*(n+1));[p.buds[n],p.buds[j]]=[p.buds[j],p.buds[n]];}
  }
  function restPlant(p){
    if(tick%6!==0)return;
    const end=Math.min(p.buds.length,p.shedCursor+Math.max(1,Math.ceil(p.buds.length/70)));
    while(p.shedCursor<end){const i=p.buds[p.shedCursor++];if(flora[i]===LEAF&&floraOwner[i]===p.id){shedPart(i);metrics.leavesShed++;}}
    p.parts=p.parts.filter(i=>flora[i]&&floraOwner[i]===p.id);
  }
  function regrowLeaves(p){
    if(!p.buds.length||!sun||p.water===0||tick%6!==0)return;
    for(let n=0;n<16;n++){
      const slot=p.budCursor++%p.buds.length,i=p.buds[slot];if(i<0)continue;
      if(flora[i]&&floraOwner[i]===p.id){p.buds[slot]=-1;continue;}
      let attached=false;
      for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){const j=neighbor(i,dx,dy);if(j>=0&&flora[j]&&floraOwner[j]===p.id)attached=true;}
      if(attached&&plantCell(p,i%W,Math.floor(i/W))){p.buds[slot]=-1;metrics.regrown++;}
    }
    if(p.budCursor%240<16&&!p.buds.some(i=>i>=0))p.buds=[];
  }
  function agePlant(p){
    if(p.age<=p.lifespan&&!p.decline)return false;
    const duration=speciesRules[p.species].decline;
    if(!p.decline){
      p.fadeLeaves=p.parts.filter(i=>flora[i]===LEAF&&floraOwner[i]===p.id);
      for(let n=p.fadeLeaves.length-1;n>0;n--){const j=Math.floor(Math.random()*(n+1));[p.fadeLeaves[n],p.fadeLeaves[j]]=[p.fadeLeaves[j],p.fadeLeaves[n]];}
    }
    p.decline++;
    if(tick%6===0){
      const end=Math.min(p.fadeLeaves.length,p.fadeCursor+Math.max(1,Math.ceil(p.fadeLeaves.length/(duration/6))));
      while(p.fadeCursor<end){const i=p.fadeLeaves[p.fadeCursor++];if(flora[i]===LEAF&&floraOwner[i]===p.id)shedPart(i);}
      p.parts=p.parts.filter(i=>flora[i]&&floraOwner[i]===p.id);
    }
    // Old age advances in winter too; evergreen never means immortal.
    if(p.decline>=duration||floraLife[p.y*W+p.x]>0)wither(p);
    return true;
  }
  function growPlants(){
    for(const p of plants){
      if(!p.alive){releaseWater(p);continue;}
      p.age++;const root=p.y*W+p.x;
      if(flora[root]!==WOOD||floraOwner[root]!==p.id||!rootSupported(p.x,p.y)){wither(p);continue;}
      pruneDisconnected(p);
      if(cold&&floraLife[root]>0){wither(p);continue;}
      if(agePlant(p))continue;
      if(cold){if(!p.dormant){if(p.species===PINE)p.dormant=true;else enterDormancy(p);}if(p.species!==PINE)restPlant(p);continue;}
      if(p.dormant){p.dormant=false;p.drought=0;}
      if(tick%6===0&&p.water<7){const soil=wetSoilNear(p.x,p.y+1);if(soil>=0){moisture[soil]--;p.water++;}}
      if(p.water>0)p.drought=Math.max(0,p.drought-4);else p.drought++;
      if(p.drought>speciesRules[p.species].drought||floraLife[root]>0){wither(p);continue;}
      if(sun&&p.water>0&&tick%7===0&&p.height<p.target){
        const nextHeight=p.height+1,desired=p.x+Math.round(p.lean*nextHeight+(Math.sin(nextHeight*.085+p.phase)-Math.sin(p.phase))*p.bend);
        const x=p.tipX+Math.sign(desired-p.tipX),y=p.y-nextHeight;
        // Advance only from the current connected stem; never grow across a gap.
        if(plantCell(p,x,y,WOOD)){
          p.height=nextHeight;p.tipX=x;if(p.height<p.target*.46)plantCell(p,x+1,y,WOOD);metrics.grown++;
          if(p.height>=p.nextBranch)growCrownBranch(p,x,y);
          if(p.height===p.target){
            if(p.species===PINE)plantLeaf(p,x,y-1,2.6,2.8);
            else plantLeaf(p,x,y-2,p.crown,p.form===1?3.5:p.form===2?7:5.5);
            if(p.form===0){for(const side of [-1,1]){const [bx,by]=branch(p,x,y-1,Math.round(p.crown*.65),side,.45);plantLeaf(p,bx,by-1,p.crown*.68,4.5);}}
          }
        }
      }
      regrowLeaves(p);
      if(sun&&tick%60===0)releaseWater(p);
      if(sun&&p.height===p.target&&p.water>1&&p.age-p.lastSeed>1100){
        const x=p.x+(Math.random()<.5?-12:12),y=p.y-p.height-5;
        if(inside(x,y)&&cells[y*W+x]===E){put(y*W+x,SEED,0,p.species);metrics.seedsReleased++;p.lastSeed=p.age;say('成熟的植物，落下了新种子');}
      }
    }
  }
  // Growing vegetation is rooted and permeable. Painted wood is loose sawdust
  // and follows the same per-grain gravity path as the other granular matter.
  function updateVegetation(){
    for(const i of floraCells){
      if(!flora[i])continue;
      let watered=cells[i]===WATER;eachNear(i,j=>{if(cells[j]===WATER)watered=true;if(cells[j]===FIRE&&floraWet[i]===0&&floraLife[i]===0)floraLife[i]=110;});
      if(watered){floraWet[i]=210;if(floraLife[i])metrics.quenched++;floraLife[i]=0;}
      else if(floraWet[i])floraWet[i]--;
      if(floraLife[i]){
        audibleActivity('fire',i);
        
        floraLife[i]--;eachNear(i,j=>{if(Math.random()<.035)ignite(j);});
        if(floraLife[i]===0){flora[i]=0;floraOwner[i]=0;floraCells.delete(i);if(cells[i]===E)leaveAsh(i);}
        else if(i>=W&&cells[i-W]===E&&Math.random()<.04)put(i-W,FIRE,24);
      }
    }
  }
  function step(){
    const start=performance.now();soundActivity={rain:0,fire:0,snow:0};tick++;markArtwork();
    if(tick%2===0)spreadHeat();
    if(tick%4===1)countColdMatter();
    if(tick%12===1)updateSky();
    updateVegetation();
    for(let y=H-1;y>=0;y--){
      const direction=tick%2?1:-1;
      for(let column=0;column<W;column++){
        const x=direction===1?column:W-1-column;let i=y*W+x,type=cells[i];
        if(!type||seen[i]===tick)continue;seen[i]=tick;
        // Rock is granular matter with gravity, never an anchored brush stroke.
        if(type===SNOW||type===ICE){
          if(heat[heatIndex(i)]>12){melt(i);continue;}
          if(thawing&&tick%4===0&&exposedColdMatter(i)&&Math.random()<.035){melt(i);continue;}
          let touchingWater=false;eachNear(i,j=>{if(cells[j]===WATER)touchingWater=true;});
          if(!cold&&touchingWater&&tick%4===0){const local=nearbyPhase(i);if(local.water>local.cold*1.3&&Math.random()<.32){melt(i);metrics.waterMelted++;continue;}}
          if(type===SNOW&&Math.random()<.26+(grain[i]%5)*.085)continue;
        }
        if(type===VAPOR||type===CLOUD){
          life[i]++;
          if(type===VAPOR&&((y<H*.31&&life[i]>22)||life[i]>400)){
            put(i,CLOUD);metrics.condensed++;lastPhase.cloud=tick;continue;
          }
          if(type===CLOUD){
            let density=0;
            if(life[i]>60&&tick%8===0)for(const [dx,dy] of [[-2,0],[2,0],[0,-2],[0,2],[-2,-2],[2,-2],[-2,2],[2,2]]){const j=neighbor(i,dx,dy);if(j>=0&&cells[j]===CLOUD)density++;}
            if((density>2&&Math.random()<.18)||life[i]>150+grain[i]){
              const snow=cold&&heat[heatIndex(i)]<12;put(i,snow?SNOW:WATER);wet[i]=160;rainDrop[i]=snow?2:1;
              if(snow){metrics.snowed++;lastPhase.snow=tick;if(metrics.snowed%120===1)say('云里的水，轻轻落成雪');}
              else{metrics.rained++;lastPhase.rain=tick;if(metrics.rained%120===1)say('云里的水，落回来了');}continue;
            }
            if(Math.random()<.55)continue;
            const target=H*.15+Math.sin(x*.013)*15+(grain[i]%29)-14,d=Math.random()<.54?1:-1;
            if(drift(i,d,y>target?-1:y<target?1:0,type,false)<0)drift(i,d,0,type,false);
          }else{
            const d=Math.random()<.53?1:-1;
            for(let k=0;k<2;k++){const next=drift(i,d,-1,type,false);if(next<0){drift(i,-d,0,type,false);break;}i=next;}
          }
          continue;
        }
        if(type===FIRE){
          warm(i,85);
          let water=-1;eachNear(i,j=>{if(cells[j]===WATER)water=j;});
          if(water>=0){put(i,E);damp(i);vaporize(water,true);metrics.quenched++;continue;}
          if(life[i]<=1||y===0){put(i,E);continue;}
          audibleActivity('fire',i);life[i]--;eachNear(i,j=>ignite(j));
          for(let k=0;k<2;k++){const d=Math.random()<.5?-1:1,next=drift(i,d,-1,FIRE,false);if(next<0)break;i=next;}
          continue;
        }
        if(type===WOOD||type===OIL||type===LEAF||type===LITTER){
          if(wet[i]){
            wet[i]--;if(life[i]){life[i]=0;metrics.quenched++;}
            if(tick%3===0&&wet[i]>10)eachNear(i,j=>{if((cells[j]===WOOD||cells[j]===LEAF)&&wet[j]<wet[i]-5){wet[j]=wet[i]-5;life[j]=0;}});
          }
          if(life[i]>0){
            audibleActivity('fire',i);
            
            warm(i,type===OIL?155:130);
            life[i]--;if(life[i]===0){if(type===WOOD)leaveAsh(i);else put(i,FIRE,12+grain[i]%20);continue;}
            eachNear(i,j=>{if(Math.random()<(type===OIL?.20:.045))ignite(j);});
            if(y>0&&cells[i-W]===E&&Math.random()<.05){put(i-W,FIRE,20+grain[i]%25);seen[i-W]=tick;}
          }
          if(type===LEAF)continue;
        }
        if(type===WATER){
          if(drainOpen&&y===H-1){put(i,E);metrics.drained++;continue;}
          if(cold&&tick%4===0){
            if(heat[heatIndex(i)]<2&&wet[i]===0&&surfaceFreezeEligible(i)){
              frostAge[i]+=4;
              if(frostAge[i]>=100+grain[i]%121){put(i,ICE);seen[i]=tick;metrics.frozen++;continue;}
            }else frostAge[i]=0;
          }
          if(!cold&&!thawing&&tick%4===0&&heat[heatIndex(i)]<2&&wet[i]===0){
            let touchingCold=false;eachNear(i,j=>{if(cells[j]===SNOW||cells[j]===ICE)touchingCold=true;});
            if(touchingCold){const local=nearbyPhase(i);if(local.cold>local.water*2&&local.cold>=8&&Math.random()<.6){put(i,ICE);seen[i]=tick;metrics.frozen++;if(metrics.frozen%24===1)say('雪多水少，水滴结成了冰');continue;}}
          }
          if(heat[heatIndex(i)]>48&&Math.random()<.22){heat[heatIndex(i)]-=.8;vaporize(i,true);metrics.heatVaporized++;continue;}
          if(rainDrop[i]&&(y===H-1||[SAND,WATER,WALL,WOOD,OIL,SOIL,LEAF,ICE,SNOW].includes(cells[i+W]))){
            if(y<H-1&&(cells[i+W]===WATER||cells[i+W]===OIL)){if(surfaceMarks.length>=96)surfaceMarks.shift();surfaceMarks.push({x,y:y+1,born:tick});}
            rainDrop[i]=0;metrics.returned++;lastPhase.water=tick;
          }
          if(wet[i])wet[i]--;
          let absorbed=-1,hot=false;
          eachNear(i,j=>{
            if(cells[j]===SOIL&&moisture[j]<3&&Math.random()<.025)absorbed=j;
            if(cells[j]===WOOD||cells[j]===LEAF){if(life[j])hot=true;wet[j]=220;life[j]=0;}
            if(cells[j]===FIRE||(cells[j]===OIL&&life[j]>0))hot=true;
          });
          if(absorbed>=0){moisture[absorbed]++;put(i,E);metrics.absorbed++;continue;}
          if(hot){damp(i);vaporize(i,true);continue;}
          if(!cold&&sun&&wet[i]===0&&y<ceiling[x]&&y>H*.42&&i>=W&&cells[i-W]===E&&Math.random()<.018){vaporize(i);continue;}
        }
        // A flagged sand grain contains a tiny gold inclusion. Washing reveals
        // that existing inclusion; this is a stylized panning rule, not alchemy.
        if(type===SAND&&goldOre[i]){let washed=false;eachNear(i,j=>{if(cells[j]===WATER)washed=true;});if(washed&&++wet[i]>12){put(i,GOLD);metrics.panned++;continue;}}
        if(type===SOIL){
          if(moisture[i]>0&&tick%10===0){
            const d=Math.random()<.5?-1:1;const j=neighbor(i,d,Math.random()<.5?0:1);
            if(j>=0&&cells[j]===SOIL&&moisture[i]>moisture[j]+1){moisture[i]--;moisture[j]++;}
          }
        }
        if(type===SEED&&tick%9===0&&y<H-1&&cells[i+W]===SOIL){if(sprout(i))continue;}
        if(type===LITTER&&life[i]===0){decay[i]++;if(decay[i]>150&&y<H-1&&(cells[i+W]===SOIL||cells[i+W]===WALL||cells[i+W]===LITTER)){put(i,SOIL);metrics.composted++;continue;}if(tick%2===0)continue;}
        let moved=false;
        // Airborne drops/flakes/grains do not retain a painted brush silhouette.
        // Vary descent per grain and let them drift only while there is air below.
        const below=neighbor(i,0,1),airborne=below>=0&&[E,VAPOR,CLOUD,FIRE].includes(cells[below]);
        if((type===WATER||type===SNOW||type===SEED||type===WOOD||type===ASH||looseMineral(type))&&below>=0&&[E,VAPOR,CLOUD,FIRE].includes(cells[below])){
          const sideways=type===SEED?.22:type===SNOW?.65:type===SAND?.18:type===SOIL?.12:type===WALL?.08:.3;
          if(Math.random()<sideways){
            const side=type===SNOW||type===SEED?(Math.sin(tick*(type===SEED?.06:cold?.035:.11)+grain[i])<0?-1:1):(Math.random()<.5?-1:1);
            const next=drift(i,side,0,type,false);if(next>=0)i=next;
          }
        }
        const variation=grain[i]/255;
        const rate=type===WATER||type===SAND?2+variation*2:type===SOIL?2.15+variation*1.7:type===WALL?2.45+variation*1.1:type===WOOD||type===ASH||type===ICE?1+variation*2:3;
        const speed=type===SEED||type===LITTER||type===SNOW?1:Math.floor(rate)+(Math.random()<rate%1?1:0);
        for(let fall=0;fall<speed;fall++){
          const d=Math.random()<.5?-1:1;
          let next=drift(i,0,1,type);
          if(next<0)next=drift(i,d,1,type);
          if(next<0)next=drift(i,-d,1,type);
          if(next<0)break;i=next;moved=true;if(cells[i]!==type)break;
        }
        if(moved&&cells[i]===type&&airborne&&(type===WATER||type===SNOW))audibleActivity(type===WATER?'rain':'snow',i);
        if(!moved&&(type===WATER||type===OIL)){
          const d=Math.random()<.5?-1:1;
          for(const side of [d,-d]){
            let distance=0;const ix=i%W,iy=(i/W)|0;
            for(let k=1;k<=7;k++){const nx=ix+side*k;if(nx<0||nx>=W||cells[i+side*k]!==E)break;distance=k;}
            if(distance){swap(i,iy*W+ix+side*distance);break;}
          }
        }
      }
    }
    growPlants();dirty=true;
    if(tick%15===0)updateReadout();
    performanceSample.stepMs=performance.now()-start;
  }
  function updateReadout(){
    for(const span of document.querySelectorAll('[data-phase]')){const phase=lastPhase[span.dataset.phase];span.classList.toggle('active',tick-(phase==null?-1000:phase)<60);}
    $('#drain-count').textContent=drainOpen?'已排出 '+metrics.drained+' 滴':'水留在画布里';
    $('#notice').textContent=tick<noticeUntil?notice:(cold?'寒意落在枝头与水面':sun?'阳光照着水面':'阳光歇一会儿');
  }
  // Presentation-only fields. A private, coordinate-based noise source keeps
  // paper/pigment deterministic without consuming the ecology's random stream.
  let paperTone=new Float32Array(N),sunWash=new Float32Array(N);
  const paperTexture=document.createElement('canvas');paperTexture.width=canvas.width;paperTexture.height=canvas.height;
  function visualNoise(x,y){let n=Math.imul(x+137,374761393)^Math.imul(y+71,668265263);n=Math.imul(n^(n>>>13),1274126177);return ((n^(n>>>16))>>>0)/4294967295;}
  function softNoise(x,y,scale){
    const xx=x/scale,yy=y/scale,ix=Math.floor(xx),iy=Math.floor(yy);let u=xx-ix,v=yy-iy;u=u*u*(3-2*u);v=v*v*(3-2*v);
    return (visualNoise(ix,iy)*(1-u)+visualNoise(ix+1,iy)*u)*(1-v)+(visualNoise(ix,iy+1)*(1-u)+visualNoise(ix+1,iy+1)*u)*v;
  }
  function squareArtworkBounds(view){
    const size=Math.min(view.w,view.h);
    // Use only the visible painting: keep its lower edge and center the square.
    return {x:view.x+(view.w-size)/2,y:view.y+view.h-size,size};
  }
  function visualSunGeometry(){
    const square=squareArtworkBounds(viewport),portrait=viewport.width<viewport.height;
    return {x:square.x+square.size*.76,y:square.y+square.size*(portrait?.18:.32),radius:Math.min(Math.max(10,Math.min(18,Math.min(W,H)*.047)),square.size*.09)};
  }
  function makeSunWash(){
    sunWash.fill(0);
    // This only places the painted sun; heat, evaporation and growth use `sun`.
    // Its complete disc stays inside the same square used for the share cover.
    const position=visualSunGeometry(),sx=position.x,sy=position.y,radius=position.radius;
    const left=Math.max(0,Math.floor(sx-radius-2)),right=Math.min(W-1,Math.ceil(sx+radius+2));
    const top=Math.max(0,Math.floor(sy-radius-2)),bottom=Math.min(H-1,Math.ceil(sy+radius+2));
    for(let y=top;y<=bottom;y++)for(let x=left;x<=right;x++){
      const i=y*W+x,dx=x-sx,dy=y-sy,d=Math.hypot(dx,dy);
      if(d<radius+2){
        const angle=Math.atan2(dy,dx),edge=radius*(1+.009*Math.sin(angle*5)+.006*Math.sin(angle*9+.8));
        const disc=Math.max(0,Math.min(1,(edge-d)/.8+.5)),bleed=Math.max(0,1-Math.abs(d-edge)/1.8)*.055;
        sunWash[i]=Math.min(.94,disc*(.86+(softNoise(x+87,y,2.8)-.5)*.13)+bleed);
      }
    }
  }
  function makePaper(){
    makeSunWash();
    const pc=paperTexture.getContext('2d'),pw=paperTexture.width,ph=paperTexture.height,texture=pc.createImageData(pw,ph);
    for(let y=0;y<H;y++)for(let x=0;x<W;x++){
      const i=y*W+x;
      paperTone[i]=y/H*2.3+(softNoise(x,y,46)-.5)*5.2+(softNoise(x+231,y,9)-.5)*2.4+(visualNoise(x,y)-.5)*1.8;
    }
    for(let y=0;y<ph;y++)for(let x=0;x<pw;x++){
      const p=(y*pw+x)*4,n=visualNoise(x+419,y+613),light=n>.48;
      texture.data[p]=light?255:92;texture.data[p+1]=light?252:72;texture.data[p+2]=light?231:43;
      texture.data[p+3]=Math.round(Math.abs(n-.48)*17);
    }
    pc.putImageData(texture,0,0);pc.lineCap='round';
    // Short translucent fibres, with occasional longer strands, are baked once
    // at artwork resolution. They remain present in the exported PNG as well.
    for(let k=0;k<Math.floor(pw*ph/86);k++){
      const x=visualNoise(k,301)*pw,y=visualNoise(k,302)*ph,a=visualNoise(k,303)*Math.PI;
      const length=2.4+Math.pow(visualNoise(k,304),2)*14+(k%19===0?11:0),dx=Math.cos(a)*length,dy=Math.sin(a)*length*.48;
      pc.strokeStyle=k%3===0?'rgba(126,99,58,.105)':'rgba(255,252,227,.18)';pc.lineWidth=.35+visualNoise(k,305)*.5;
      pc.beginPath();pc.moveTo(x,y);pc.quadraticCurveTo(x+dx*.45-dy*.15,y+dy*.45+dx*.07,x+dx,y+dy);pc.stroke();
    }
  }
  makePaper();
  // All actual vapor/cloud cells feed one continuous, horizontally brushed
  // density field. Nothing is spawned, moved, condensed or removed here.
  let AW=W/4,AH=H/4,airMass=new Float32Array(AW*AH),airAcross=new Float32Array(AW*AH),airDensity=new Float32Array(AW*AH);
  let airPixels=airCtx.createImageData(air.width,air.height),airTooth=new Float32Array(air.width*air.height);
  for(let y=0;y<air.height;y++)for(let x=0;x<air.width;x++)airTooth[y*air.width+x]=.88+softNoise(x,y*2.8,8)*.24;
  const cloudKernel=[1,3,6,10,14,17,18,17,14,10,6,3,1],cloudWeight=120;
  function gatherAir(x,y,t){
    const fx=x/4,fy=y/4,ix=Math.floor(fx),iy=Math.floor(fy),u=fx-ix,v=fy-iy,m=t===CLOUD?1:.42,i=iy*AW+ix;
    airMass[i]+=m*(1-u)*(1-v);
    if(ix+1<AW)airMass[i+1]+=m*u*(1-v);
    if(iy+1<AH){airMass[i+AW]+=m*(1-u)*v;if(ix+1<AW)airMass[i+AW+1]+=m*u*v;}
  }
  function airAt(x,y){
    x=Math.max(0,Math.min(AW-1.001,x));y=Math.max(0,Math.min(AH-1.001,y));
    const ix=Math.floor(x),iy=Math.floor(y),u=x-ix,v=y-iy,i=iy*AW+ix;
    return (airDensity[i]*(1-u)+airDensity[i+1]*u)*(1-v)+(airDensity[i+AW]*(1-u)+airDensity[i+AW+1]*u)*v;
  }
  function paintAir(){
    for(let y=0;y<AH;y++)for(let x=0;x<AW;x++){
      let sum=0;for(let k=-6;k<=6;k++)if(x+k>=0&&x+k<AW)sum+=airMass[y*AW+x+k]*cloudKernel[k+6];
      airAcross[y*AW+x]=sum/cloudWeight;
    }
    for(let y=0;y<AH;y++)for(let x=0;x<AW;x++){
      const i=y*AW+x;let sum=airAcross[i]*6;
      if(y>0)sum+=airAcross[i-AW]*4;if(y+1<AH)sum+=airAcross[i+AW]*4;
      if(y>1)sum+=airAcross[i-AW*2];if(y+2<AH)sum+=airAcross[i+AW*2];airDensity[i]=sum/16;
    }
    const light=palette==='ink'?[211,231,223]:palette==='ochre'?[249,241,216]:[246,246,227];
    const shade=palette==='ink'?[104,145,144]:palette==='ochre'?[143,145,121]:[119,147,137];
    const data=airPixels.data,aw=air.width,ah=air.height;
    for(let x=0;x<aw;x++){
      // A restrained curving edge follows the moving water field, rather than
      // outlining every particle with its own circle or decorative cloud icon.
      const bend=Math.sin(x*.057+tick*.006)*.32+Math.sin(x*.021-tick*.003)*.22;
      for(let y=0;y<ah;y++){
        const p=(y*aw+x)*4,d=airAt(x*.5,y*.5+bend)*airTooth[y*aw+x];
        if(d<.006){data[p+3]=0;continue;}
        const below=airAt(x*.5,y*.5+bend+.8),rim=Math.max(0,Math.min(.82,.20+(d-below)/(d+.08)*1.35));
        data[p]=light[0]*(1-rim)+shade[0]*rim;data[p+1]=light[1]*(1-rim)+shade[1]*rim;data[p+2]=light[2]*(1-rim)+shade[2]*rim;
        data[p+3]=Math.min(.76,1-Math.exp(-d*1.15))*228;
      }
    }
    airCtx.putImageData(airPixels,0,0);ctx.drawImage(air,0,0,canvas.width,canvas.height);
  }
  function seedColor(species,g=0){
    const c=colors[SEED];return species===PINE?[c[0]-15+g*12,c[1]-4+g*10,c[2]+9+g*8]:[c[0]+g*12,c[1]+g*10,c[2]+g*8];
  }
  function foliageColor(species){
    if(species!==PINE)return colors[LEAF];
    return palette==='ink'?[73,118,106]:palette==='ochre'?[71,106,73]:[48,101,77];
  }
  function render(){
    const start=performance.now();airMass.fill(0);let airCount=0;const flames=[],precipitation=[],seedMarks=[];
    const sunColor=palette==='ink'?[208,123,79]:palette==='ochre'?[187,83,48]:[184,78,51];
    for(let i=0;i<N;i++){
      const t=cells[i],x=i%W,y=(i/W)|0,g=(grain[i]/255-.5),p=i*4;
      const floating=precipitation.length<2400&&(t===WATER||t===SNOW)&&i<N-W&&[E,VAPOR,CLOUD,FIRE].includes(cells[i+W])&&(t!==SNOW||flora[i+W]!==WOOD);
      if(floating)precipitation.push([x,y,t,grain[i]]);
      const seedMark=t===SEED&&seedMarks.length<1200;if(seedMark)seedMarks.push([x,y,seedKind[i],grain[i]]);
      let r=colors[t][0],green=colors[t][1],b=colors[t][2];
      if(t===E||t===VAPOR||t===CLOUD||floating||seedMark){
        const shade=paperTone[i]*(palette==='ink'?.65:1),pigment=sun?sunWash[i]:0;
        r=colors[0][0]-shade;green=colors[0][1]-shade;b=colors[0][2]-shade;
        if(pigment){r=r*(1-pigment)+(sunColor[0]-shade)*pigment;green=green*(1-pigment)+(sunColor[1]-shade)*pigment;b=b*(1-pigment)+(sunColor[2]-shade)*pigment;}
        if(t===VAPOR||t===CLOUD){gatherAir(x,y,t);airCount++;}
      }
      else if(t===WATER){const surface=y>0&&cells[i-W]!==WATER,depth=Math.min(1,y/H);r+=surface?42:g*5;green+=surface?41:g*7;b+=surface?29:g*7;r-=depth*6;}
      else if(t===WOOD&&life[i]===0){r+=g*49;green+=g*40;b+=g*25;if(wet[i]){r-=19;green-=11;b-=3;}}
      else if(t===ICE){r+=g*14;green+=g*11;b+=g*8;if(i>=W&&cells[i-W]!==ICE){r+=25;green+=20;b+=16;}}
      else if(t===SEED){[r,green,b]=seedColor(seedKind[i],g);}
      else if(t===ASH){r+=g*35;green+=g*34;b+=g*30;}
      else if(t===SNOW){r+=g*11;green+=g*9;b+=g*7;}
      else if(t===WALL){const vein=Math.sin(x*.023+y*.018)*5+Math.sin(x*.056-y*.043)*3,edge=i>=W&&cells[i-W]!==WALL;r+=g*9+vein+(edge?8:0);green+=g*10+vein+(edge?17:0);b+=g*8+vein+(edge?7:0);}
      else if(t===SOIL){const m=moisture[i],edge=i>=W&&cells[i-W]!==SOIL;r+=g*15-m*5+(edge?25:0);green+=g*18-m*6+(edge?30:0);b+=g*12-m*3+(edge?10:0);}
      else if(t===GOLD){const glint=Math.pow(Math.max(0,Math.sin(tick*.075+grain[i])),14)*45;r+=g*36+glint;green+=g*36+glint;b+=g*23+glint*.65;}
      else if(t===FIRE||((t===WOOD||t===OIL||t===LEAF||t===LITTER)&&life[i]>0)){
        const v=(grain[i]+tick*3)%32;r=255;green=128+v*3;b=40+v;if(flames.length<1600&&grain[i]%5===0)flames.push([x,y,'fire']);
      }else if(t===LEAF){r+=g*30;green+=g*24;b+=g*17;}
      else{r+=g*22;green+=g*19;b+=g*13;if(t===WOOD&&wet[i]){r-=19;green-=11;b-=3;}}
      if(flora[i]){
        const fg=floraShade[i]/255-.5,p=plants[floraOwner[i]-1],tone=p&&p.tone||0;
        const fc=flora[i]===WOOD?(palette==='ink'?[131,141,112]:palette==='ochre'?[98,84,58]:[72,86,67]):foliageColor(p==null?undefined:p.species);
        let fr=fc[0]+fg*24+tone,fgreen=fc[1]+fg*26+tone,fb=fc[2]+fg*16+tone*.55;
        if(flora[i]===LEAF){const rim=i>=W&&!flora[i-W];fr+=rim?6:-19;fgreen+=rim?6:-17;fb+=rim?4:-12;if(floraShade[i]%7===0){fr+=14;fgreen+=16;}}
        if(floraLife[i]){fr=245;fgreen=148+(tick+floraShade[i])%60;fb=48;}
        const blend=t===WATER?.35:t===E||t===VAPOR||t===CLOUD?.94:.55;
        r=r*(1-blend)+fr*blend;green=green*(1-blend)+fgreen*blend;b=b*(1-blend)+fb*blend;
      }
      pixels.data[p]=r;pixels.data[p+1]=green;pixels.data[p+2]=b;pixels.data[p+3]=255;
    }
    raster.putImageData(pixels,0,0);
    ctx.imageSmoothingEnabled=true;ctx.drawImage(buffer,0,0,canvas.width,canvas.height);
    if(airCount)paintAir();
    ctx.save();ctx.globalCompositeOperation='screen';for(let y=0;y<HH;y++)for(let x=0;x<HW;x++){const h=heat[y*HW+x];if(h>10){ctx.fillStyle='rgba(229,112,44,'+Math.min(.13,h/1300)+')';ctx.fillRect(x*8,y*8,8,8);}}ctx.restore();
    for(const [x,y] of flames){ctx.fillStyle='rgba(255,166,69,.045)';ctx.beginPath();ctx.arc(x*2,y*2,7,0,Math.PI*2);ctx.fill();}
    // Fine rain strokes descend quickly; snow is a small, soft horizontal flake.
    // These marks read actual particles and tick only, never the ecology RNG.
    ctx.save();ctx.lineCap='round';
    for(const [x,y,species,g] of seedMarks){
      const i=y*W+x,falling=i<N-W&&[E,VAPOR,CLOUD,FIRE].includes(cells[i+W]);
      const pose=g/255*Math.PI+(falling?Math.sin(tick*.055+g)*.3:0),c=seedColor(species,g/255-.5);
      ctx.fillStyle='rgb('+c.join(',')+')';ctx.beginPath();ctx.ellipse(x*2,y*2,1.65,1,pose,0,Math.PI*2);ctx.fill();
    }
    for(const [x,y,t,g] of precipitation){
      if(t===WATER){
        ctx.strokeStyle=palette==='ink'?'rgba(168,203,197,.55)':'rgba(75,124,124,.48)';ctx.lineWidth=.65;
        ctx.beginPath();ctx.moveTo(x*2+.35,y*2-4-g%3);ctx.lineTo(x*2-.2,y*2+1);ctx.stroke();
      }else{
        const sway=Math.sin(tick*.035+g)*.85;
        ctx.fillStyle=palette==='ink'?'rgba(235,243,228,.86)':'rgba(255,253,238,.94)';
        ctx.strokeStyle=palette==='ink'?'rgba(151,185,177,.25)':'rgba(112,144,134,.27)';ctx.lineWidth=.4;
        ctx.beginPath();ctx.ellipse(x*2+sway,y*2,.85+g%3*.12,.52+g%2*.12,Math.sin(tick*.025+g)*.4,0,Math.PI*2);ctx.fill();ctx.stroke();
      }
    }
    for(let n=surfaceMarks.length-1;n>=0;n--){
      const mark=surfaceMarks[n],age=tick-mark.born;if(age>14){surfaceMarks.splice(n,1);continue;}
      const j=mark.y*W+mark.x;if(cells[j]!==WATER&&cells[j]!==OIL)continue;
      ctx.strokeStyle=palette==='ink'?'rgba(183,219,204,'+(.24*(1-age/15))+')':'rgba(82,126,118,'+(.22*(1-age/15))+')';ctx.lineWidth=.55;
      ctx.beginPath();ctx.ellipse(mark.x*2,mark.y*2,1+age*.32,.4+age*.035,0,Math.PI,Math.PI*2);ctx.stroke();
    }
    ctx.restore();
    ctx.save();ctx.globalAlpha=palette==='ink'?.57:.82;ctx.drawImage(paperTexture,0,0);ctx.restore();
    dirty=false;performanceSample.renderMs=performance.now()-start;performanceSample.frames++;
  }
  function choose(t){markArtwork(true);seedDistance=0;seedWait=0;selected=t;erasing=false;$('#erase').setAttribute('aria-pressed','false');for(const b of document.querySelectorAll('[data-material]'))b.setAttribute('aria-pressed',String(Number(b.dataset.material)===t));hint.textContent=hints[t];updateMaterialLabel();}
  const scattered=t=>t===WATER||t===SNOW||t===WOOD||t===GOLD||looseMineral(t);
  function dab(p){
    let added=0;markArtwork(true);
    if(!erasing&&scattered(selected)){
      const radius=(selected===SNOW?12:selected===SAND?11:selected===SOIL?10:9)*brush;
      const amount=Math.ceil((selected===WATER?14:selected===SNOW||selected===GOLD?6:selected===WALL?7:selected===SOIL?8:selected===SAND?9:10)*brush*brush);
      for(let n=0;n<amount;n++){
        const angle=Math.random()*Math.PI*2,r=Math.sqrt(Math.random())*radius;
        const x=p.x+Math.round(Math.cos(angle)*r),y=p.y+Math.round(Math.sin(angle)*r);
        if(inside(x,y)&&cells[y*W+x]===E){put(y*W+x,selected);added++;}
      }
      materialGesture(selected,added);invitation.hidden=true;return;
    }
    if(selected===SEED&&!erasing){
      // One seed per release. Brush size changes spread, never a dense spray.
      const angle=Math.random()*Math.PI*2,r=Math.sqrt(Math.random())*4*brush;
      const x=p.x+Math.round(Math.cos(angle)*r),y=p.y+Math.round(Math.sin(angle)*r);
      if(inside(x,y)&&cells[y*W+x]===E){put(y*W+x,SEED);added++;}
      materialGesture(selected,added);invitation.hidden=true;return;
    }
    const radius=Math.max(1,Math.round((erasing?10:5)*brush));
    for(let dy=-radius;dy<=radius;dy++)for(let dx=-radius;dx<=radius;dx++){
      if(dx*dx+dy*dy>radius*radius)continue;const x=p.x+dx,y=p.y+dy;if(!inside(x,y))continue;const i=y*W+x;
      if(erasing){put(i,E);flora[i]=0;floraOwner[i]=0;floraLife[i]=0;floraWet[i]=0;floraCells.delete(i);continue;}
      if(selected===FIRE){const before=cells[i],fuel=life[i],plant=floraLife[i];if(cells[i]===SNOW||cells[i]===ICE){warm(i,85);melt(i);added++;continue;}if(flora[i])ignite(i);if(cells[i]===WATER)vaporize(i,true);else if(cells[i]===E)put(i,FIRE,24+grain[i]%24);else ignite(i);if(cells[i]!==before||life[i]>fuel||floraLife[i]>plant)added++;}
      else if(cells[i]===E||cells[i]===FIRE)put(i,selected);
    }
    materialGesture(selected,added);invitation.hidden=true;
  }
  function point(e){const r=canvas.getBoundingClientRect();return {x:Math.max(0,Math.min(W-1,Math.floor((e.clientX-r.left)*W/r.width))),y:Math.max(0,Math.min(H-1,Math.floor((e.clientY-r.top)*H/r.height)))};}
  function insideDrawingArea(e){return e.clientX>=viewport.left&&e.clientX<viewport.left+viewport.width&&e.clientY>=viewport.top&&e.clientY<viewport.top+viewport.height;}
  function stroke(a,b){
    if(selected===SEED&&!erasing){
      // Carry distance across pointer events, so event frequency cannot spray seeds.
      const distance=Math.hypot(b.x-a.x,b.y-a.y);if(!distance)return;
      let travelled=0;const spacing=17;
      while(seedDistance+distance-travelled>=spacing){
        travelled+=spacing-seedDistance;seedDistance=0;
        dab({x:Math.round(a.x+(b.x-a.x)*travelled/distance),y:Math.round(a.y+(b.y-a.y)*travelled/distance)});seedWait=0;
      }
      seedDistance+=distance-travelled;return;
    }
    const n=Math.max(Math.abs(b.x-a.x),Math.abs(b.y-a.y),1),spacing=!erasing?(scattered(selected)?4:2):2;for(let s=0;s<=n;s+=spacing)dab({x:Math.round(a.x+(b.x-a.x)*s/n),y:Math.round(a.y+(b.y-a.y)*s/n)});dab(b);}
  function endPointer(e,flush=true,soft=false){if(e&&e.pointerId!==pointer)return;const active=pointer!==null;if(active)materialSound.stop(!soft);pointer=null;last=null;seedDistance=0;seedWait=0;if(active&&flush)flushArtwork();}
  canvas.addEventListener('pointerdown',e=>{if(e.button!==0||pointer!==null||!insideDrawingArea(e)||document.body.classList.contains('artwork-preview'))return;e.preventDefault();gestureSpeed=0;gestureTime=performance.now();materialSound.unlock().catch(()=>{});setSettings(false);canvas.setPointerCapture(e.pointerId);pointer=e.pointerId;seedDistance=0;seedWait=0;last=point(e);dab(last);render();});
  canvas.addEventListener('pointermove',e=>{if(e.pointerId!==pointer)return;if(!insideDrawingArea(e)){endPointer(e);return;}if(typeof document.elementFromPoint==='function'){const target=document.elementFromPoint(e.clientX,e.clientY);if(target&&typeof target.closest==='function'&&target.closest('#material-drawer, .topbar, #settings, #share-dialog')){endPointer(e);return;}}const p=point(e),now=performance.now(),dt=Math.max(8,now-gestureTime);gestureSpeed=.65*gestureSpeed+.35*Math.min(1,Math.hypot(p.x-last.x,p.y-last.y)/dt);gestureTime=now;stroke(last,p);last=p;render();});
  for(const name of ['pointerup','pointercancel','lostpointercapture'])canvas.addEventListener(name,e=>{if(e.pointerId!==pointer)return;endPointer(e,true,name==='pointerup');});
  canvas.addEventListener('pointerleave',e=>{if(e.pointerId===pointer)endPointer(e);});
  window.addEventListener('blur',()=>{audioForeground=false;silenceMaterials();endPointer();flushArtwork();lastTime=0;accumulator=0;});
  window.addEventListener('focus',()=>{audioForeground=true;});
  document.addEventListener('visibilitychange',()=>{audioForeground=!document.hidden;if(document.hidden)silenceMaterials();endPointer();lastTime=0;accumulator=0;if(document.hidden)flushArtwork();});
  window.addEventListener('pagehide',()=>{audioForeground=false;silenceMaterials();endPointer();flushArtwork();lastTime=0;accumulator=0;});
  window.addEventListener('pageshow',()=>{audioForeground=true;lastTime=0;accumulator=0;});
  const pauseIcon='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5v14M15 5v14"/></svg>';
  const playIcon='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m8 5 11 7-11 7Z"/></svg>';
  function showPause(){$('#pause').setAttribute('aria-pressed',String(paused));$('#pause').innerHTML=(paused?playIcon:pauseIcon)+'<span>'+(paused?'继续':'暂停')+'</span>';$('#state').textContent=paused?'已暂停，可以继续画':'正在流动';}
  function reset(){silenceMaterials();soundActivity={rain:0,fire:0,snow:0};const wasReady=saveReady;saveReady=false;endPointer(null,false);coldCount.fill(0);waterCount.fill(0);heat.fill(0);heatNext.fill(0);for(const f of [cells,life,wet,moisture,grain,owner,seen,decay,rainDrop,goldOre,frostAge,seedKind,flora,floraOwner,floraLife,floraWet,floraShade])f.fill(0);plants.length=0;woodCells.clear();floraCells.clear();tick=0;accumulator=0;lastTime=0;clearMetrics();paused=false;scene='free';sun=true;drainOpen=false;cold=false;thawing=false;surfaceMarks.length=0;$('#temperature').setAttribute('aria-pressed','false');$('#temperature').textContent='寒暖 · 暖';$('#temperature-note').textContent='拨向冷，等一会儿，看风物慢慢入冬';$('#drain').setAttribute('aria-pressed','false');$('#drain').textContent='排水 · 关';$('#drain-count').textContent='';$('#sun').setAttribute('aria-pressed','true');$('#sun').textContent='日照 · 开';$('#scene-name').textContent='空白画布';endPointer();choose(SAND);showPause();dirty=true;saveReady=wasReady;}
  function terrainY(x,garden){const u=(x-viewport.x)/viewport.w;return Math.round(viewport.y+viewport.h*(garden?.86-.27*Math.exp(-Math.pow((u-.18)/.085,2))-.39*Math.exp(-Math.pow((u-.60)/.13,2))-.14*Math.exp(-Math.pow((u-.89)/.10,2))+.012*Math.sin(u*70)+.008*Math.sin(u*130):.76+.075*Math.cos(u*6.7)+.026*Math.sin(u*22)));}
  function loadScene(name){
    reset();scene=name;
    if(name==='thaw'){
      const sx=v=>Math.round(viewport.x+v/480*viewport.w),sy=v=>Math.round(viewport.y+v/360*viewport.h);
      for(let y=sy(290);y<H;y++)for(let x=0;x<W;x++)put(y*W+x,WALL);
      for(let x=sx(130);x<sx(290);x++)for(let y=sy(270)-Math.round(12*Math.sin((x-sx(130))/sx(160)*Math.PI));y<sy(290);y++)put(y*W+x,WOOD);
      for(let y=sy(245);y<sy(248);y++)for(let x=sx(120);x<sx(330);x++)put(y*W+x,WALL);
      for(let x=sx(132);x<sx(319);x++)for(let y=sy(244)-Math.round(8+16*Math.sin((x-sx(132))/sx(187)*Math.PI));y<sy(245);y++)put(y*W+x,SNOW);
      choose(FIRE);toast('点燃雪下的木屑');
    }else{
      const garden=name==='garden';
      for(let x=0;x<W;x++){
        const top=terrainY(x,garden);
        for(let y=top;y<H;y++){const i=y*W+x;put(i,(!garden||y>=top+9||x<5||x>W-6)?WALL:SOIL);if(garden&&cells[i]===SOIL)moisture[i]=3;}
        for(let y=Math.round(viewport.y+viewport.h*(garden?.765:.762));y<top;y++)put(y*W+x,WATER);
      }
      if(!garden){for(let x=Math.round(viewport.x+viewport.w*.04);x<viewport.x+viewport.w*.34;x++)for(let y=terrainY(x,false)-5;y<terrainY(x,false);y++)put(y*W+x,SAND);}
      else{for(const u of [.10,.15,.18,.23,.28,.47,.50,.55,.60,.65,.69,.72,.88,.94]){const x=Math.round(viewport.x+u*viewport.w),y=terrainY(x,true)-1;if(cells[y*W+x]===E)put(y*W+x,SEED);}}
    }
    invitation.hidden=true;updateSky();updateReadout();render();setSettings(false);markArtwork(true);flushArtwork();
  }
  let toastTimer;
  function toast(text,sticky=false){$('#toast').textContent=text;$('#toast').classList.add('visible');clearTimeout(toastTimer);if(!sticky)toastTimer=setTimeout(()=>$('#toast').classList.remove('visible'),2400);}
  function showSaveStatus(code){
    const messages={saved:'画作已保存在此设备',restored:'已接着上次的画作',recovered:'已恢复上一次完整画作',failed:'本次画作未能保存，请先保留画作再退出',unavailable:'此处无法保存画作，退出前请先保留画作',damaged:'上次画作无法读取，请先保留画作再重来',conflict:'另一页面已有新画作，请重新进入'};
    const text=messages[code]||'';$('#save-status').textContent=text;
    if(code==='saved'){if(saveWarningText&&$('#toast').textContent===saveWarningText)$('#toast').classList.remove('visible');saveWarningText='';return;}
    const warning=['failed','unavailable','damaged','conflict'].includes(code);saveWarningText=warning?text:'';toast(text,warning);
  }
  function setSettings(open){if(open)updateLayoutDiagnostics();$('#settings').hidden=!open;$('#settings-toggle').setAttribute('aria-expanded',String(open));}
  function updateMaterialLabel(){const button=document.querySelector('[data-material="'+selected+'"]'),name=erasing?'擦除':button.textContent.trim();materialDock.setAttribute('aria-label','材料与画布工具，当前'+name);}
  materialDock.addEventListener('pointerdown',e=>{e.stopPropagation();endPointer();});
  for(const b of document.querySelectorAll('[data-material]'))b.addEventListener('click',e=>{e.stopPropagation();endPointer();choose(Number(b.dataset.material));flushArtwork();});
  for(const b of document.querySelectorAll('[data-scene]'))b.addEventListener('click',()=>loadScene(b.dataset.scene));
  for(const b of document.querySelectorAll('button[data-palette]'))b.addEventListener('click',()=>{setPalette(b.dataset.palette);flushArtwork();});
  for(const b of document.querySelectorAll('[data-brush]'))b.addEventListener('click',()=>{markArtwork(true);brush=Number(b.dataset.brush);for(const other of document.querySelectorAll('[data-brush]'))other.setAttribute('aria-pressed',String(other===b));flushArtwork();});
  function showSound(){const button=$('#sound-toggle');button.setAttribute('aria-pressed',String(materialSound.enabled));button.setAttribute('aria-label',materialSound.enabled?'关闭材料音效':'开启材料音效');button.dataset.enabled=String(materialSound.enabled);}
  $('#sound-toggle').addEventListener('click',()=>{silenceMaterials();materialSound.setEnabled(!materialSound.enabled);showSound();});showSound();
  $('#settings-toggle').addEventListener('click',()=>setSettings($('#settings').hidden));$('#settings-close').addEventListener('click',()=>setSettings(false));
  document.addEventListener('keydown',e=>{if(e.key==='Escape'){setSettings(false);}});
  $('#drain').addEventListener('click',()=>{markArtwork(true);drainOpen=!drainOpen;$('#drain').setAttribute('aria-pressed',String(drainOpen));$('#drain').textContent=drainOpen?'排水 · 开':'排水 · 关';toast(drainOpen?'流到底边的水会排出':'水留在画布里');dirty=true;updateReadout();flushArtwork();});
  $('#temperature').addEventListener('click',()=>{setTemperature(!cold);flushArtwork();});
  $('#sun').addEventListener('click',()=>{markArtwork(true);sun=!sun;$('#sun').setAttribute('aria-pressed',String(sun));$('#sun').textContent=sun?'日照 · 开':'日照 · 关';dirty=true;updateReadout();flushArtwork();});
  $('#erase').addEventListener('click',()=>{markArtwork(true);erasing=!erasing;$('#erase').setAttribute('aria-pressed',String(erasing));for(const b of document.querySelectorAll('[data-material]'))b.setAttribute('aria-pressed',String(!erasing&&Number(b.dataset.material)===selected));hint.textContent=erasing?'擦出一处留白。':hints[selected];updateMaterialLabel();flushArtwork();});
  $('#pause').addEventListener('click',()=>{markArtwork(true);paused=!paused;if(paused)silenceMaterials();showPause();updateReadout();flushArtwork();});$('#reset').addEventListener('click',()=>{reset();render();toast('一张新的画布');flushArtwork(true);});
  // Capture once; platform calls only run after an explicit sharing/save tap.
  let captured=null,artworkData=null,completeArtworkData=null,sharing=false,artworkRequest=0;
  const shareDialog=$('#share-dialog');
  function refreshShareActions(){
    const available=window.ArtworkPlatform.capabilities();
    $('#post-note').disabled=sharing||!artworkData||!available.postNote;
    $('#save-art').disabled=sharing||!completeArtworkData||!available.save;
    $('#signature').disabled=sharing;$('#share').disabled=sharing;
    if(!available.postNote)$('#share-status').textContent='在小红书小工具内打开，即可把画作带入笔记。';
  }
  function signArtwork(out){
    if(!$('#signature').checked)return;
    const c=out.getContext('2d'),size=Math.round(Math.min(out.width,out.height)*.034),x=out.width-size*2,y=out.height-size*2;
    c.fillStyle='#a44532';c.fillRect(x,y,size,size);c.fillStyle='#f4e8cf';c.textAlign='center';c.textBaseline='middle';c.font=Math.round(size*.72)+'px "LXGW WenKai"';c.fillText('生',x+size/2,y+size/2+1);
  }
  function captureArtworkMount(){
    // Fallback values match the three CSS mounting themes. Read the active
    // computed colors once so a later palette change cannot recolor a capture.
    const themes={
      qing:['#e4eadc','#a6b39a','#91a185','#f4f6e9','rgba(51,80,43,.035)'],
      ink:['#d6dfd8','#95aa9c','#829c8d','#eef3ee','rgba(35,71,57,.035)'],
      ochre:['#ecdfc6','#beaa86','#ac9364','#fcf0d7','rgba(102,71,32,.035)']
    };
    const keys=['mount','mount-line','mount-roll-shadow','mount-roll-light','mount-thread'],fallback=themes[palette];
    const style=typeof getComputedStyle==='function'?getComputedStyle(document.body):null;
    return Object.freeze(keys.map((key,index)=>style&&typeof style.getPropertyValue==='function'?style.getPropertyValue('--'+key).trim()||fallback[index]:fallback[index]));
  }
  function composeCompleteArtwork(current){
    const out=document.createElement('canvas'),landscape=current.artworkOrientation==='landscape';
    // Let the finished scroll follow the complete painting's aspect ratio:
    // narrow side borders and longer ends, reversed for a horizontal scroll.
    const artworkScale=980/(landscape?current.height:current.width);
    const naturalWidth=landscape?current.width*artworkScale+320:1080,naturalHeight=landscape?1080:current.height*artworkScale+320;
    const unit=Math.min(1,4096/Math.max(naturalWidth,naturalHeight));
    out.width=Math.round(naturalWidth*unit);out.height=Math.round(naturalHeight*unit);
    const c=out.getContext('2d'),mount=current.artworkMount;
    c.fillStyle=mount[0];c.fillRect(0,0,out.width,out.height);
    // Fine, deterministic silk threads repeat the mounting cloth used in the UI.
    c.fillStyle='rgba(255,255,255,.18)';for(let y=0;y<out.height;y+=4*unit)c.fillRect(0,y,out.width,unit);
    c.fillStyle=mount[4];for(let x=0;x<out.width;x+=3*unit)c.fillRect(x,0,unit,out.height);
    // Thin rolled edges run across a vertical scroll and down a horizontal one.
    for(const far of [false,true]){
      const x=landscape?(far?out.width-30*unit:22*unit):22*unit,y=landscape?22*unit:(far?out.height-30*unit:22*unit),width=landscape?8*unit:out.width-44*unit,height=landscape?out.height-44*unit:8*unit;
      c.fillStyle=mount[2];c.fillRect(x,y,width,height);
      c.fillStyle=mount[3];c.fillRect(x,y,landscape?2*unit:width,landscape?height:2*unit);
      c.fillStyle=mount[1];c.fillRect(x+(landscape?3*unit:0),y+(landscape?0:3*unit),landscape?3*unit:width,landscape?height:3*unit);
    }
    // Fit the entire captured world between restrained silk borders. Only the
    // art canvas is drawn; controls, DOM text and diagnostics never enter it.
    const scale=artworkScale*unit,width=current.width*scale,height=current.height*scale;
    const x=(out.width-width)/2,y=(out.height-height)/2;
    c.fillStyle=mount[1];c.fillRect(x-unit,y-unit,width+2*unit,height+2*unit);
    c.drawImage(current,x,y,width,height);
    signArtwork(out);return out;
  }
  async function prepareArtwork(){
    if(!captured)return;
    const request=++artworkRequest,current=captured;artworkData=null;completeArtworkData=null;refreshShareActions();
    if(document.fonts&&document.fonts.ready)await document.fonts.ready;
    if(request!==artworkRequest||current!==captured)return;
    const out=document.createElement('canvas');out.width=1080;out.height=1080;
    const square=current.artworkSquare;
    out.getContext('2d').drawImage(current,square.x,square.y,square.size,square.size,0,0,out.width,out.height);
    signArtwork(out);
    // Preview and post are the very same square PNG. Saving keeps the full world.
    const coverData=out.toDataURL('image/png'),completeData=composeCompleteArtwork(current).toDataURL('image/png');
    artworkData=coverData;completeArtworkData=completeData;$('#art-preview').src=artworkData;$('#export-size').textContent='1080 × 1080';refreshShareActions();
  }
  function clearArtwork(){artworkRequest++;captured=null;artworkData=null;completeArtworkData=null;document.body.classList.remove('artwork-preview');}
  function closeArtwork(){
    clearArtwork();
    if(typeof shareDialog.close==='function')shareDialog.close();else shareDialog.removeAttribute('open');
    document.body.classList.remove('modal-fallback');shareDialog.classList.remove('fallback-modal');$('#share').focus();
  }
  $('#share').addEventListener('click',async()=>{
    if(sharing||captured)return;endPointer();setSettings(false);document.body.classList.add('artwork-preview');render();
    captured=document.createElement('canvas');captured.width=canvas.width;captured.height=canvas.height;captured.getContext('2d').drawImage(canvas,0,0);captured.artworkPaper=colors[E].slice();captured.artworkInk=palette==='ink';
    const ratio=captured.width/captured.height;
    captured.artworkOrientation=ratio>1.05?'landscape':ratio<.95?'portrait':viewport.width>=viewport.height?'landscape':'portrait';
    captured.artworkMount=captureArtworkMount();
    const square=squareArtworkBounds(viewport),pixelScale=canvas.width/W;
    captured.artworkSquare={x:square.x*pixelScale,y:square.y*pixelScale,size:square.size*pixelScale};
    captured.artworkTexture=document.createElement('canvas');captured.artworkTexture.width=paperTexture.width;captured.artworkTexture.height=paperTexture.height;captured.artworkTexture.getContext('2d').drawImage(paperTexture,0,0);
    $('#share-status').textContent='预览即发布的方形画面；保存可保留完整画作与装裱。';
    if(typeof shareDialog.showModal==='function')shareDialog.showModal();else{shareDialog.setAttribute('open','');shareDialog.classList.add('fallback-modal');document.body.classList.add('modal-fallback');}
    try{await prepareArtwork();}catch(error){artworkData=null;completeArtworkData=null;$('#art-preview').removeAttribute('src');$('#share-status').textContent='画作生成失败，请关闭后重试。';refreshShareActions();}
  });
  $('#signature').addEventListener('change',async()=>{try{await prepareArtwork();}catch(error){artworkData=null;completeArtworkData=null;refreshShareActions();$('#share-status').textContent='画作生成失败，请关闭后重试。';}});
  $('#share-close').addEventListener('click',closeArtwork);
  shareDialog.addEventListener('cancel',event=>{event.preventDefault();closeArtwork();});
  shareDialog.addEventListener('close',()=>{if(!shareDialog.open)clearArtwork();});
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&shareDialog.classList.contains('fallback-modal'))closeArtwork();});
  async function shareArtwork(action){
    if(sharing||!artworkData||!completeArtworkData)return;
    sharing=true;refreshShareActions();$('#share-status').textContent=action==='post'?'正在打开笔记…':'正在保存画作…';
    try{
      if(action==='post'){await window.ArtworkPlatform.postNote(artworkData);$('#share-status').textContent='已返回画布，笔记状态请在小红书中查看。';}
      else{await window.ArtworkPlatform.save(completeArtworkData);$('#share-status').textContent='完整装裱画作已存入相册。';}
    }catch(error){
      const message=typeof error==='string'?error:error&&(error.errMsg||error.message);
      const cancelled=typeof message==='string'&&/cancel|取消/i.test(message);
      $('#share-status').textContent=cancelled?'已取消，画作仍在这里。':action==='post'?'未能打开笔记，请再试一次。':'未能保存，请检查相册权限后重试。';
    }finally{sharing=false;refreshShareActions();}
  }
  $('#post-note').addEventListener('click',()=>shareArtwork('post'));
  $('#save-art').addEventListener('click',()=>shareArtwork('save'));
  window.addEventListener('focus',()=>{if(shareDialog.open&&!sharing)refreshShareActions();});
  // Read-only observations for local acceptance; no state mutation or test hooks.
  window.sandGarden=Object.freeze({snapshot:()=>{
    const names=['empty','sand','water','wall','wood','oil','fire','soil','seed','vapor','cloud','leaf','litter','snow','ash','ice','gold'];
    const counts={};for(const name of names)counts[name]=0;let stored=0;
    for(let i=0;i<N;i++){counts[names[cells[i]]]++;stored+=moisture[i];}
    const seedCounts={broadleaf:0,pine:0};for(let i=0;i<N;i++)if(cells[i]===SEED)seedCounts[speciesRules[seedKind[i]].name]++;
    const particleShape={};
    for(const [name,t] of [['seed',SEED],['sand',SAND],['soil',SOIL],['rock',WALL],['water',WATER],['snow',SNOW],['wood',WOOD],['litter',LITTER],['ash',ASH],['ice',ICE],['gold',GOLD]]){
      let count=0,minX=W,maxX=-1,minY=H,maxY=-1,sumY=0,isolated=0;
      for(let i=0;i<N;i++)if(cells[i]===t){const x=i%W,y=(i/W)|0;count++;minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y);sumY+=y;let neighbors=0;eachNear(i,j=>{if(cells[j]===t)neighbors++;});if(!neighbors)isolated++;}
      particleShape[name]={count,minX,maxX,minY,maxY,meanY:count?sumY/count:null,isolated};
    }
    const plantWater=plants.reduce((n,p)=>n+p.water,0);
    let plantStems=0,plantLeaves=0,waterOverlap=0,woodSumY=0,woodMinY=H,woodMaxY=-1;
    for(const i of floraCells){if(flora[i]===WOOD)plantStems++;if(flora[i]===LEAF)plantLeaves++;if(cells[i]===WATER)waterOverlap++;}
    for(const i of woodCells){const y=(i/W)|0;woodSumY+=y;woodMinY=Math.min(woodMinY,y);woodMaxY=Math.max(woodMaxY,y);}
    return {version:'bottom-dock-exp.5-q1',viewport:Object.assign({},viewport),palette,brush,erasing,hiddenGold:goldOre.reduce((a,b)=>a+b,0),grid:[W,H],seedCounts,particleShape,vegetation:{stems:plantStems,leaves:plantLeaves,waterOverlap},wood:{count:woodCells.size,minY:woodMinY,maxY:woodMaxY,meanY:woodCells.size?woodSumY/woodCells.size:null},render:[canvas.width,canvas.height],scene,sun,temperature:cold?'cold':'warm',thawing,drainOpen,paused,tick,seconds:tick/30,counts,soilWater:stored,plantWater,waterTotal:counts.water+counts.vapor+counts.cloud+counts.snow+counts.ice+stored+plantWater,heatPeak:Math.max(...heat),burningWood:[...woodCells].filter(i=>life[i]>0).length,burningOil:cells.reduce((n,t,i)=>n+(t===OIL&&life[i]>0?1:0),0),metrics:Object.assign({},metrics),plants:plants.map(p=>({x:p.x,y:p.y,species:speciesRules[p.species].name,lifespan:p.lifespan,decline:p.decline,alive:p.alive,dormant:p.dormant,height:p.height,target:p.target,form:p.form,lean:p.lean,crown:p.crown,tone:p.tone,branchCount:p.branchCount,water:p.water,drought:p.drought,age:p.age,rootSupported:rootSupported(p.x,p.y),parts:p.parts.filter(i=>flora[i]&&floraOwner[i]===p.id).length})),performance:Object.assign({},performanceSample)};
  }});
  function frame(time){
    const elapsed=lastTime?Math.min(time-lastTime,400):0;lastTime=time;
    if(!document.hidden){accumulator=Math.min(accumulator+elapsed,400);let steps=0;while(accumulator>=STEP&&steps<12){if(pointer!==null&&last){if(selected===SEED&&!erasing){if(++seedWait>=14){dab(last);seedWait=0;}}else dab(last);}if(!paused)step();accumulator-=STEP;steps++;}if(dirty)render();}
    updateSceneSound();
    if(!document.hidden&&saveReady)artworkStore.periodic();
    requestAnimationFrame(frame);
  }
  function expandWorld(newW,newH){
    if(newW===W&&newH===H)return false;
    const oldW=W,oldH=H,dx=(newW-W)/2,dy=newH-H;
    const remap=(field,width,height,offsetX,offsetY,targetWidth,targetHeight)=>{
      const output=new field.constructor(targetWidth*targetHeight);
      for(let y=0;y<height;y++)output.set(field.subarray(y*width,(y+1)*width),(y+offsetY)*targetWidth+offsetX);
      return output;
    };
    const move=field=>remap(field,oldW,oldH,dx,dy,newW,newH);
    [cells,life,wet,moisture,grain,owner,seen,decay,rainDrop,goldOre,frostAge,seedKind,flora,floraOwner,floraLife,floraWet,floraShade]=
      [cells,life,wet,moisture,grain,owner,seen,decay,rainDrop,goldOre,frostAge,seedKind,flora,floraOwner,floraLife,floraWet,floraShade].map(move);
    heat=remap(heat,oldW/4,oldH/4,dx/4,dy/4,newW/4,newH/4);heatNext=new Float32Array(heat);
    const index=i=>i<0?i:(Math.floor(i/oldW)+dy)*newW+i%oldW+dx;
    for(const p of plants){p.x+=dx;p.y+=dy;p.tipX+=dx;for(const key of ['parts','buds','fadeLeaves'])p[key]=p[key].map(index);}
    for(const mark of surfaceMarks){mark.x+=dx;mark.y+=dy;}
    W=newW;H=newH;N=W*H;HW=W/4;HH=H/4;CW=W/8;CH=H/8;AW=W/4;AH=H/4;
    coldCount=new Uint16Array(CW*CH);waterCount=new Uint16Array(CW*CH);ceiling=new Uint16Array(W);
    woodCells.clear();floraCells.clear();for(let i=0;i<N;i++){if(cells[i]===WOOD)woodCells.add(i);if(flora[i])floraCells.add(i);}
    canvas.width=W*2;canvas.height=H*2;buffer.width=W;buffer.height=H;pixels=raster.createImageData(W,H);
    air.width=W/2;air.height=H/2;airPixels=airCtx.createImageData(air.width,air.height);airTooth=new Float32Array(air.width*air.height);
    for(let y=0;y<air.height;y++)for(let x=0;x<air.width;x++)airTooth[y*air.width+x]=.88+softNoise(x,y*2.8,8)*.24;
    airMass=new Float32Array(AW*AH);airAcross=new Float32Array(AW*AH);airDensity=new Float32Array(AW*AH);
    paperTone=new Float32Array(N);sunWash=new Float32Array(N);paperTexture.width=canvas.width;paperTexture.height=canvas.height;
    updateSky();countColdMatter();dirty=true;return true;
  }
  function resizeCanvas(){
    if(!layoutReady)return;
    updateLayoutDiagnostics();
    const area=canvasArea(),long=Math.max(W,H),ratio=area.width/area.height;
    const newW=Math.max(W,Math.min(1024,Math.ceil((ratio>=1?long:long*ratio)/8)*8));
    const newH=Math.max(H,Math.min(1024,Math.ceil((ratio>=1?long/ratio:long)/8)*8));
    if(newW===W&&newH===H&&viewport.left===area.left&&viewport.top===area.top&&viewport.width===area.width&&viewport.height===area.height)return;
    silenceMaterials();endPointer();lastTime=0;accumulator=0;
    const wasLandscape=viewport.width>=viewport.height,expanded=expandWorld(newW,newH);fitCanvas();
    if(expanded||wasLandscape!==(area.width>=area.height))makePaper();else makeSunWash();
    dirty=true;render();
    // Preserve a fresh blank/quarantined save until the user actually draws.
    if(expanded)markArtwork();
  }
  function captureArtwork(){
    return {grid:[W,H],arrays:{cells,life,wet,moisture,grain,owner,decay,rainDrop,goldOre,frostAge,seedKind,flora,floraOwner,floraLife,floraWet,floraShade,heat},plants,
      state:{tick,palette,brush,selected,erasing,paused,sun,drainOpen,cold,thawing,scene,metrics,lastPhase}};
  }
  function restoreArtwork(saved){
    const target=captureArtwork().arrays;for(const key of Object.keys(target))target[key].set(saved.arrays[key]);
    // Clone plant records; no persisted object or typed-array buffer is aliased.
    for(const plant of saved.plants)plants.push(JSON.parse(JSON.stringify(plant)));
    const state=saved.state;tick=state.tick;palette=state.palette;brush=state.brush;selected=state.selected;erasing=state.erasing;paused=state.paused;sun=state.sun;drainOpen=state.drainOpen;cold=state.cold;thawing=state.thawing;scene=state.scene;
    metrics=Object.assign({},state.metrics);lastPhase=Object.assign({},state.lastPhase);
    for(let i=0;i<N;i++){if(cells[i]===WOOD)woodCells.add(i);if(flora[i])floraCells.add(i);}
    heatNext.set(heat);seen.fill(0);updateSky();countColdMatter();
    // UI-only synchronization: semantic setters would discard frost age / thaw state.
    $('#temperature').setAttribute('aria-pressed',String(cold));$('#temperature').textContent=cold?'寒暖 · 冷':'寒暖 · 暖';
    $('#temperature-note').textContent=cold?'云雨成雪，水面渐封；阔叶落叶，松针留青':'雪冰渐融，湿土中的枝头会再生叶';
    $('#drain').setAttribute('aria-pressed',String(drainOpen));$('#drain').textContent=drainOpen?'排水 · 开':'排水 · 关';
    $('#sun').setAttribute('aria-pressed',String(sun));$('#sun').textContent=sun?'日照 · 开':'日照 · 关';
    $('#erase').setAttribute('aria-pressed',String(erasing));
    for(const b of document.querySelectorAll('[data-material]'))b.setAttribute('aria-pressed',String(!erasing&&Number(b.dataset.material)===selected));
    for(const b of document.querySelectorAll('[data-brush]'))b.setAttribute('aria-pressed',String(Number(b.dataset.brush)===brush));
    hint.textContent=erasing?'擦出一处留白。':hints[selected];invitation.hidden=true;showPause();
    pointer=null;last=null;seedDistance=0;seedWait=0;lastTime=0;accumulator=0;dirty=true;
  }
  reset();if(restoredArtwork)restoreArtwork(restoredArtwork);setPalette(palette);updateReadout();render();saveReady=true;layoutReady=true;resizeCanvas();
  if(artworkStore.message)showSaveStatus(artworkStore.message);
  requestAnimationFrame(frame);
})();
