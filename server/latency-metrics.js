import {monitorEventLoopDelay} from 'node:perf_hooks';
export function createLatencyMetrics(log=console.log){
  const samples=new Map(),recent=[];let slowConnections=0;
  const loop=monitorEventLoopDelay({resolution:20});loop.enable();
  function observe(key,value){
    if(!Number.isFinite(value)||value<0)return;
    let sample=samples.get(key);if(!sample){sample={count:0,sum:0,max:0,values:[]};samples.set(key,sample);}
    sample.count++;sample.sum+=value;sample.max=Math.max(sample.max,value);
    if(sample.values.length<1024)sample.values.push(value);
  }
  function summary(){
    const metrics={type:'latency_summary',at:new Date().toISOString(),intervalSeconds:60,slowConnections,
      eventLoopP99Ms:Number((loop.percentile(99)/1000000).toFixed(2)),eventLoopMaxMs:Number((loop.max/1000000).toFixed(2))};
    for(const [key,s] of samples){const values=[...s.values].sort((a,b)=>a-b);metrics[key]={count:s.count,mean:Number((s.sum/s.count).toFixed(2)),max:Number(s.max.toFixed(2)),p95:Number(values[Math.min(values.length-1,Math.floor(values.length*.95))].toFixed(2))};}
    return metrics;
  }
  function flush(){
    if(!samples.size&&!slowConnections){loop.reset();return;}
    const metrics=summary();recent.push(metrics);if(recent.length>60)recent.shift();
    log(JSON.stringify(metrics));samples.clear();slowConnections=0;loop.reset();
  }
  const timer=setInterval(flush,60000);timer.unref();
  return {observe,flush,snapshot(){return {current:summary(),recent:structuredClone(recent)};},slow(){slowConnections++;},close(){clearInterval(timer);loop.disable();}};
}
