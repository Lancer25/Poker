import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import vm from 'node:vm';
import {probeLatency,receiveLatencyPong,resetLatency,playerConnections} from '../server/player-latency.js';
const context={module:{exports:{}}};vm.runInNewContext(readFileSync('miniprogram/utils/player-latency.js','utf8'),context);const {latencyBadge}=context.module.exports;
test('server probes accept only matching control pong and retain at most one pending nonce',()=>{
 const sent=[],ws={readyState:1,accountId:'a',ping:data=>sent.push(data)};resetLatency(ws);const nonce=Buffer.from('test-ping');
 assert.equal(probeLatency(ws,100,nonce),true);assert.equal(probeLatency(ws,101),false);assert.equal(sent.length,1);
 assert.equal(receiveLatencyPong(ws,Buffer.from('wrong'),120,1000),false);assert.equal(receiveLatencyPong(ws,nonce,99,1000),false);
 assert.equal(receiveLatencyPong(ws,nonce,300,1000),true);assert.deepEqual(ws.latencySample,{rttMs:200,measuredAt:1000,accountId:'a'});assert.equal(receiveLatencyPong(ws,nonce,301,1000),false);
 resetLatency(ws);assert.equal(ws.latencySample,null);assert.equal(ws.pendingLatencyPing,null);
});
test('projection uses authorized seated sockets only, highest fresh tab and no persisted mutation',()=>{
 const room={id:'r',players:[{id:'p',accountId:'a'},{id:'q',accountId:'b'}],spectators:[{id:'watch',accountId:'c'}]},before=JSON.stringify(room);
 const socket=(extra={})=>({readyState:1,lastPongAt:1000,identity:{room:'r',player:'p'},accountId:'a',authToken:'a',latencySample:{accountId:'a',rttMs:180,measuredAt:1000},...extra});
 const lookup=id=>['a','b','c'].includes(id)?{id}:undefined;
 let result=playerConnections(room,[socket(),socket({latencySample:{accountId:'a',rttMs:600,measuredAt:900}})],lookup,1100);
 assert.deepEqual(result.get('p'),{online:true,rttMs:600,measuredAt:900});assert.deepEqual(result.get('q'),{online:false,rttMs:null,measuredAt:null});
 for(const extra of [{authToken:'invalid'},{accountId:'b'},{identity:{room:'r',player:'watch'}},{identity:{room:'other',player:'p'}},{readyState:3},{lastPongAt:0}])assert.equal(playerConnections(room,[socket(extra)],lookup,46000).get('p').online,false);
 result=playerConnections(room,[socket({lastPongAt:47000})],lookup,47001);assert.equal(result.get('p').online,true);assert.equal(result.get('p').rttMs,null);assert.equal(JSON.stringify(room),before);
});
test('badge thresholds, stale/unknown/offline values and compact formatting are shared with native',()=>{
 for(const [ms,state]of [[0,'good'],[200,'good'],[201,'warning'],[500,'warning'],[501,'bad'],[1200,'bad']]){
  const badge=latencyBadge({online:true,rttMs:ms,measuredAt:1000},1001);assert.equal(badge.state,state);assert.match(badge.title,new RegExp(ms+' 毫秒'));assert.equal(badge.icon,'/assets/icons/signal-'+state+'.svg');
 }
 assert.equal(latencyBadge({online:true,rttMs:180,measuredAt:1000},46001).text,'--');assert.equal(latencyBadge({online:false},1001).text,'离线');assert.equal(latencyBadge(null,1001).text,'--');assert.equal(latencyBadge({online:true,rttMs:1200,measuredAt:1000},1001).text,'1.2s');
});
