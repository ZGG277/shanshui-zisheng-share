'use strict';
// Versioned, local-only artwork storage. Each setItem is an atomic commit;
// the other slot is never removed to make room. No unload dependency or network.
(() => {
  const VERSION=1,PREFIX='shanshui.artwork.v1.',LIMIT=6000000,MAX_CELLS=1048576;
  const fields={cells:1,life:2,wet:2,moisture:1,grain:1,owner:2,decay:2,rainDrop:1,goldOre:1,frostAge:2,seedKind:1,flora:1,floraOwner:2,floraLife:2,floraWet:2,floraShade:1,heat:4};
  const metricNames='sifted panned drained ashProduced snowed leavesShed regrown frozen iceMelted waterMelted melted heatVaporized evaporated heated condensed rained returned absorbed transpired germinated grown withered composted seedsReleased quenched'.split(' ');
  const integer=(n,min,max)=>Number.isSafeInteger(n)&&n>=min&&n<=max;
  const number=(n,min,max)=>typeof n==='number'&&Number.isFinite(n)&&n>=min&&n<=max;
  const object=o=>o!==null&&typeof o==='object'&&!Array.isArray(o);
  function require(ok){if(!ok)throw new Error('Invalid artwork');}
  function checksum(text){let h=2166136261;for(let i=0;i<text.length;i++){h^=text.charCodeAt(i);h+=(h<<1)+(h<<4)+(h<<7)+(h<<8)+(h<<24);}return (h>>>0).toString(16);}
  const littleEndian=new Uint8Array(new Uint16Array([1]).buffer)[0]===1;
  function pack(array,width){
    let bytes=new Uint8Array(array.buffer,array.byteOffset,array.byteLength);
    if(!littleEndian&&width>1){bytes=new Uint8Array(array.length*width);const view=new DataView(bytes.buffer);for(let i=0;i<array.length;i++){if(width===2)view.setUint16(i*2,array[i],true);else view.setFloat32(i*4,array[i],true);}}
    const output=new Uint8Array(bytes.length*2+4);let used=0,start=0;
    const emit=(zero,a,b)=>{output[used++]=(b-a)&255;output[used++]=((b-a)>>8)|(zero?128:0);if(!zero){output.set(bytes.subarray(a,b),used);used+=b-a;}};
    while(start<bytes.length){
      let end=start;
      if(bytes[start]===0){while(end<bytes.length&&bytes[end]===0&&end-start<32767)end++;}
      if(end-start>=4){emit(true,start,end);start=end;continue;}
      end=start;
      while(end<bytes.length&&end-start<32767){if(bytes[end]===0&&bytes[end+1]===0&&bytes[end+2]===0&&bytes[end+3]===0)break;end++;}
      emit(false,start,end);start=end;
    }
    const chunks=[];for(let i=0;i<used;i+=8192)chunks.push(String.fromCharCode.apply(null,output.subarray(i,Math.min(used,i+8192))));
    return {type:width===4?'f32':width===2?'u16':'u8',length:array.length,data:btoa(chunks.join(''))};
  }
  function unpack(field,width,count){
    require(object(field)&&field.type===(width===4?'f32':width===2?'u16':'u8')&&field.length===count&&typeof field.data==='string');
    require(field.data.length<=Math.ceil((count*width*3+8)/3)*4&&/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(field.data));
    const input=atob(field.data),size=count*width;
    // Validate the complete compressed stream and declared size before allocation.
    let pos=0,total=0;
    while(pos<input.length){require(pos+2<=input.length);const a=input.charCodeAt(pos++),b=input.charCodeAt(pos++),n=a+((b&127)<<8);require(n>0&&total+n<=size);total+=n;if(!(b&128)){require(pos+n<=input.length);pos+=n;}}
    require(total===size);
    const bytes=new Uint8Array(size);pos=0;total=0;
    while(pos<input.length){const a=input.charCodeAt(pos++),b=input.charCodeAt(pos++),n=a+((b&127)<<8);if(!(b&128))for(let j=0;j<n;j++)bytes[total+j]=input.charCodeAt(pos++);total+=n;}
    const view=new DataView(bytes.buffer),output=width===4?new Float32Array(count):width===2?new Uint16Array(count):new Uint8Array(count);
    for(let i=0;i<count;i++)output[i]=width===4?view.getFloat32(i*4,true):width===2?view.getUint16(i*2,true):view.getUint8(i);
    return output;
  }
  function validate(payload,live=false){
    require(object(payload)&&Array.isArray(payload.grid)&&payload.grid.length===2);
    const W=payload.grid[0],H=payload.grid[1],N=W*H;
    require(integer(W,8,1024)&&integer(H,8,1024)&&W%8===0&&H%8===0&&N<=MAX_CELLS);
    const state=payload.state;
    require(object(state)&&integer(state.tick,0,Number.MAX_SAFE_INTEGER)&&['qing','ink','ochre'].includes(state.palette)&&[.65,1,1.8].includes(state.brush));
    require([1,2,3,4,5,6,7,8,13,16].includes(state.selected)&&['free','garden','cycle','thaw'].includes(state.scene));
    for(const key of ['erasing','paused','sun','drainOpen','cold','thawing'])require(typeof state[key]==='boolean');
    require(object(state.metrics)&&object(state.lastPhase));
    for(const key of metricNames)require(integer(state.metrics[key],0,Number.MAX_SAFE_INTEGER));
    require(Object.keys(state.metrics).length===metricNames.length);
    for(const key of Object.keys(state.lastPhase))require(['vapor','water','cloud','rain','snow'].includes(key)&&integer(state.lastPhase[key],0,state.tick));
    require(Array.isArray(payload.plants)&&payload.plants.length<=65000);
    let references=0;
    for(let i=0;i<payload.plants.length;i++){
      const p=payload.plants[i];require(object(p)&&p.id===i+1&&integer(p.x,0,W-1)&&integer(p.y,0,H-1)&&integer(p.tipX,0,W-1)&&integer(p.species,0,1)&&integer(p.form,0,3));
      for(const key of ['alive','dormant'])require(typeof p[key]==='boolean');
      for(const key of ['lifespan','decline','fadeCursor','height','target','water','drought','age','budCursor','shedCursor','lastSeed','nextBranch','branchCount'])require(integer(p[key],0,Number.MAX_SAFE_INTEGER));
      require(p.lifespan>0&&p.height<H&&p.target<=1024&&p.water<=7&&p.lastSeed<=p.age);
      require(number(p.lean,-1,1)&&number(p.bend,0,8)&&number(p.phase,0,Math.PI*2)&&number(p.crown,1,32)&&number(p.tone,-32,32)&&p.height<=p.y);
      require(p.species===1?p.form===3:p.form<=2);
      for(const key of ['parts','buds','fadeLeaves']){require(Array.isArray(p[key])&&p[key].length<=N);references+=p[key].length;require(references<=MAX_CELLS*12);for(const j of p[key])require(integer(j,key==='buds'?-1:0,N-1));}
      require(p.fadeCursor<=p.fadeLeaves.length);
    }
    require(object(payload.arrays)&&Object.keys(payload.arrays).length===Object.keys(fields).length);
    const arrays={};for(const key of Object.keys(fields)){const count=key==='heat'?N/16:N;if(live){const array=payload.arrays[key];require(array&&array.length===count&&array.BYTES_PER_ELEMENT===fields[key]);arrays[key]=array;}else arrays[key]=unpack(payload.arrays[key],fields[key],count);}
    for(let i=0;i<N;i++){
      const id=arrays.floraOwner[i],f=arrays.flora[i];
      if(arrays.cells[i]>16||arrays.seedKind[i]>1||arrays.goldOre[i]>1||arrays.rainDrop[i]>2||arrays.moisture[i]>3||(f!==0&&f!==4&&f!==11)||arrays.owner[i]>payload.plants.length||id>payload.plants.length||(f===0?id!==0:id===0))require(false);
    }
    if(!live){const parts=payload.plants.map(p=>new Set(p.parts));for(let i=0;i<N;i++)if(arrays.flora[i])require(parts[arrays.floraOwner[i]-1].has(i));}
    for(const h of arrays.heat)require(number(h,0,10000));
    return {grid:[W,H],state,plants:payload.plants,arrays};
  }
  function encode(snapshot,sequence){
    const arrays={};for(const key of Object.keys(fields))arrays[key]=pack(snapshot.arrays[key],fields[key]);
    const payload=JSON.stringify({grid:snapshot.grid,state:snapshot.state,plants:snapshot.plants,arrays});
    const raw=JSON.stringify({version:VERSION,sequence,payload,checksum:checksum(VERSION+':'+sequence+':'+payload)});require(raw.length<=LIMIT);return raw;
  }
  function decode(raw){
    require(typeof raw==='string'&&raw.length<=LIMIT);const envelope=JSON.parse(raw);
    require(object(envelope)&&envelope.version===VERSION&&integer(envelope.sequence,1,Number.MAX_SAFE_INTEGER)&&typeof envelope.payload==='string'&&envelope.checksum===checksum(envelope.version+':'+envelope.sequence+':'+envelope.payload));
    return {sequence:envelope.sequence,snapshot:validate(JSON.parse(envelope.payload))};
  }
  function create(options){
    let storage,sequence=0,slot=-1,dirty=false,armed=false,lastAttempt=-Infinity,readBlocked=false,resetPending=false,lastStatus='';
    let restored=null,message='',fence=0,quarantined=false,pendingWrite=null;
    const notify=code=>{message=code;if(code!==lastStatus){lastStatus=code;options.status(code);}};
    try{storage=options.storage();require(storage&&typeof storage.getItem==='function'&&typeof storage.setItem==='function');}
    catch(error){readBlocked=true;message='unavailable';}
    const candidates=[],expected={};let bad=false;
    if(storage&&!readBlocked){
      for(const suffix of ['reset','0','1']){
        let raw;try{raw=storage.getItem(PREFIX+suffix);}catch(error){readBlocked=true;message='unavailable';break;}
        expected[suffix]=raw;if(raw==null)continue;
        try{const decoded=decode(raw);decoded.slot=suffix;candidates.push(decoded);if(suffix==='reset')fence=decoded.sequence;}
        catch(error){bad=true;if(suffix==='reset'){quarantined=true;message='damaged';}}
      }
      if(!readBlocked){
        for(const candidate of candidates)sequence=Math.max(sequence,candidate.sequence);
        const valid=quarantined?[]:candidates.filter(candidate=>candidate.sequence>=fence).sort((a,b)=>b.sequence-a.sequence);
        if(valid.length){const newest=valid[0];sequence=newest.sequence;slot=newest.slot;restored=newest.snapshot;armed=true;message=bad?'recovered':'restored';}
        else if(bad){message='damaged';quarantined=true;}
      }
    }
    function flush(reset){
      if(reset){resetPending=true;armed=true;dirty=true;}
      if(!armed||!dirty)return false;
      lastAttempt=options.now();
      // A denied/partial read must never overwrite a possibly good unseen save.
      if(readBlocked||quarantined&&!resetPending){notify(message||'unavailable');return false;}
      try{
        // A write can commit even if its readback is temporarily unavailable.
        if(pendingWrite){
          const actual=storage.getItem(PREFIX+pendingWrite.target);
          if(actual===pendingWrite.raw){expected[pendingWrite.target]=actual;sequence=pendingWrite.sequence;slot=pendingWrite.target;if(pendingWrite.reset&&!reset)resetPending=false;quarantined=false;}
          else if(actual!==pendingWrite.prior){notify('conflict');return false;}
          pendingWrite=null;
        }
        // Detect an older still-open page before it can clobber another instance.
        for(const suffix of ['reset','0','1'])if(storage.getItem(PREFIX+suffix)!==expected[suffix]){notify('conflict');return false;}
        const snapshot=options.snapshot();validate(snapshot,true);const next=sequence+1,raw=encode(snapshot,next);
        const target=resetPending?'reset':slot==='0'?'1':'0';
        pendingWrite={target,raw,sequence:next,prior:expected[target],reset:resetPending};
        storage.setItem(PREFIX+target,raw);
        const readback=storage.getItem(PREFIX+target);require(readback===raw);expected[target]=raw;pendingWrite=null;
        sequence=next;slot=target;dirty=false;resetPending=false;quarantined=false;notify('saved');return true;
      }catch(error){notify('failed');return false;}
    }
    return {restored,get message(){return message;},mark:arm=>{if(arm)armed=true;if(armed)dirty=true;},flush,
      periodic:()=>{const now=options.now();if(dirty&&(now<lastAttempt||now-lastAttempt>=1500))flush(false);},
      status:()=>({armed,dirty,sequence,message})};
  }
  window.ArtworkStorage=Object.freeze({create});
})();
