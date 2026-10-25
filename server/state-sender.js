export function createStateSender({maxBufferedBytes=65536,maxStallMs=10000,onSample=()=>{},onSlow=()=>{}}={}) {
  const entries=new WeakMap();
  function clear(ws){const e=entries.get(ws);if(e)clearTimeout(e.timer);entries.delete(ws);}
  function slow(ws){clear(ws);onSlow();ws.close(1013,'Slow connection; reconnect');}
  function drain(ws,e){
    if(entries.get(ws)!==e)return;
    clearTimeout(e.timer);e.timer=null;
    if(ws.readyState!==1){clear(ws);return;}
    if(e.inFlight){
      if(Date.now()-e.sentAt>maxStallMs){slow(ws);return;}
      e.timer=setTimeout(()=>drain(ws,e),25);e.timer.unref?.();return;
    }
    if(!e.pending)return;
    if(Date.now()-e.since>maxStallMs){slow(ws);return;}
    if(ws.bufferedAmount>maxBufferedBytes){
      e.timer=setTimeout(()=>drain(ws,e),25);e.timer.unref?.();return;
    }
    const build=e.pending;e.pending=null;
    const payload=build();if(!payload)return;
    const raw=JSON.stringify(payload),wait=Date.now()-e.since;
    e.inFlight=true;
    e.sentAt=Date.now();
    onSample({bytes:Buffer.byteLength(raw),bufferedBytes:ws.bufferedAmount,queueMs:wait});
    try{
      ws.send(raw,error=>{
        if(entries.get(ws)!==e)return;
        e.inFlight=false;
        clearTimeout(e.timer);e.timer=null;
        if(error){clear(ws);ws.close(1013,'State delivery failed');return;}
        if(e.pending)drain(ws,e);
      });
      if(e.inFlight){e.timer=setTimeout(()=>drain(ws,e),25);e.timer.unref?.();}
    }catch{clear(ws);ws.close(1013,'State delivery failed');}
  }
  return {clear,send(ws,build){
    let e=entries.get(ws);if(!e){e={pending:null,inFlight:false,timer:null,since:0};entries.set(ws,e);}
    if(!e.pending)e.since=Date.now();
    e.pending=build;
    drain(ws,e);
  }};
}
