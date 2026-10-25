import test from 'node:test';
import assert from 'node:assert/strict';
import {ConnectionRecovery} from '../public/connection-recovery.js';
import {safeTopFallback} from '../public/room-ui.js';

function harness(){
 let now=0,id=0,echo=0,online=true,visible=true,reconnects=0,probeAvailable=true;const timers=new Map(),drops=[];
 const recovery=new ConnectionRecovery({now:()=>now,wallNow:()=>now,random:()=>.5,online:()=>online,visible:()=>visible,
  setTimer(fn,ms){timers.set(++id,{fn,at:now+ms});return id;},clearTimer(id){timers.delete(id);},
  reconnect(){reconnects++;recovery.connecting();},drop:r=>drops.push(r),probe:()=>probeAvailable?++echo:null});
 const advance=ms=>{const end=now+ms;while(true){const next=[...timers].filter(([,v])=>v.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];if(!next)break;now=next[1].at;timers.delete(next[0]);next[1].fn();}now=end;};
 return{recovery,advance,drops,get reconnects(){return reconnects;},get echo(){return echo;},set online(v){online=v;},set visible(v){visible=v;},set probeAvailable(v){probeAvailable=v;},ready(){recovery.connecting();recovery.opened();recovery.authenticated(false);}};
}
test('half-open application probes fail within six seconds and retry once after 250ms',()=>{
 const h=harness();h.ready();h.recovery.check();h.advance(5999);assert.deepEqual(h.drops,[]);
 assert.equal(h.recovery.acknowledge(999),false);h.advance(1);assert.deepEqual(h.drops,['probe_timeout']);
 h.advance(249);assert.equal(h.reconnects,0);h.advance(1);assert.equal(h.reconnects,1);assert.equal(h.recovery.mode,'connecting');
});
test('connect, authentication and room restoration stages have bounded independent deadlines',()=>{
 const h=harness();h.recovery.connecting();h.advance(7999);assert.equal(h.drops.length,0);h.advance(1);assert.equal(h.drops.length,1);h.advance(250);
 h.recovery.opened();h.advance(5999);assert.equal(h.drops.length,1);h.advance(1);assert.equal(h.drops.length,2);h.advance(500);
 h.recovery.opened();h.recovery.authenticated(true);h.advance(5999);assert.equal(h.recovery.mode,'resuming');h.recovery.ready();h.advance(1);assert.equal(h.recovery.mode,'ready');
});
test('matching probes stay healthy and foreground wake cannot produce duplicate probes',()=>{
 const h=harness();h.ready();h.advance(10000);assert.equal(h.echo,1);assert.equal(h.recovery.acknowledge(1),true);
 h.recovery.wake();h.recovery.wake();assert.equal(h.echo,1);h.advance(10000);assert.equal(h.echo,2);h.recovery.acknowledge(2);assert.deepEqual(h.drops,[]);
});
test('a brief app switch keeps responsive sockets but cannot wait six seconds on a dead link',()=>{
 const h=harness();h.ready();h.visible=false;h.recovery.suspend();h.advance(500);h.visible=true;h.recovery.wake();
 assert.equal(h.echo,1);h.advance(1999);assert.equal(h.drops.length,0);h.advance(1);h.advance(0);assert.equal(h.reconnects,1);
});
test('a brief foreground probe acknowledgment retains the existing healthy socket',()=>{
 const h=harness();h.ready();h.visible=false;h.recovery.suspend();h.advance(500);h.visible=true;h.recovery.wake();h.recovery.acknowledge(h.echo);h.advance(3000);assert.equal(h.reconnects,0);assert.deepEqual(h.drops,[]);
});
test('login after a hidden logged-out page does not recycle the fresh connection',()=>{
 const h=harness();h.recovery.suspend();h.advance(10000);h.ready();h.recovery.wake();assert.deepEqual(h.drops,[]);assert.equal(h.reconnects,0);
});
test('a long app switch rebuilds immediately instead of probing a potentially suspended socket',()=>{
 const h=harness();h.ready();h.recovery.check();h.visible=false;h.recovery.suspend();h.advance(120000);assert.deepEqual(h.drops,[]);
 h.visible=true;h.recovery.wake();h.advance(0);assert.equal(h.reconnects,1);assert.equal(h.echo,1);
 h.recovery.wake({force:true});assert.equal(h.reconnects,1);
});
test('offline and background states do not spin retries, online resumes a single authenticated attempt',()=>{
 const h=harness();h.ready();h.online=false;h.recovery.wake();assert.equal(h.recovery.mode,'offline');h.advance(120000);assert.equal(h.reconnects,0);
 h.online=true;h.recovery.wake();h.recovery.wake();assert.equal(h.reconnects,1);h.visible=false;h.recovery.suspend();h.advance(10000);assert.equal(h.drops.length,1);
 h.visible=true;h.recovery.wake();assert.equal(h.drops.length,2);h.advance(250);assert.equal(h.reconnects,2);
});
test('failed retries back off, missing sockets recover and logout cancels every future attempt',()=>{
 const h=harness();h.ready();h.probeAvailable=false;h.recovery.wake();assert.deepEqual(h.drops,['probe_unavailable']);h.advance(250);assert.equal(h.reconnects,1);
 h.recovery.failed();h.advance(499);assert.equal(h.reconnects,1);h.advance(1);assert.equal(h.reconnects,2);
 h.recovery.failed();h.recovery.stop();h.advance(120000);h.recovery.wake();h.recovery.opened();h.recovery.authenticated(false);assert.equal(h.reconnects,2);assert.equal(h.recovery.mode,'stopped');
});
test('ordinary iOS browser tabs do not add a second status-bar-sized safe area',()=>{
 assert.equal(safeTopFallback({ios:true,width:390}),0);
 assert.equal(safeTopFallback({ios:true,width:844,landscape:true}),0);
 assert.equal(safeTopFallback({ios:true,tablet:true,width:768}),0);
});
test('installed iOS apps retain a conservative fallback only when the native safe inset is missing',()=>{
 assert.equal(safeTopFallback({ios:true,standalone:true,width:390}),44);
 assert.equal(safeTopFallback({ios:true,standalone:true,width:844,landscape:true}),20);
 assert.equal(safeTopFallback({ios:true,standalone:true,tablet:true,width:768}),24);
 for(const nativeTop of [20,44,47,59])assert.equal(safeTopFallback({ios:true,standalone:true,width:390,nativeTop}),0);
 assert.equal(safeTopFallback({ios:false,width:390}),0);assert.equal(safeTopFallback({ios:true,width:1400}),0);
 assert.equal(safeTopFallback({ios:true,width:NaN}),0);
});
