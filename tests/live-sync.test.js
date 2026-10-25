import test from 'node:test';
import assert from 'node:assert/strict';
import {createRoom,joinRoom,snapshot} from '../server/game.js';
import {historyPage} from '../server/history-pages.js';
import {createStateSender} from '../server/state-sender.js';
import {setTimeout as delay} from 'node:timers/promises';
function largeRoom(){const {room}=createRoom('Host',1000);joinRoom(room,'Guest');room.history=Array.from({length:200},(_,i)=>({hand:i+1,board:['2h','3d','4s','5c','6h'],pots:[{amount:100,winners:['Host'],winnerIds:[room.host]}],results:room.players.map(p=>({id:p.id,name:p.name,buyin:1000,stack:1000,net:0})),deck:['secret'],accountId:'secret'}));room.completedRounds=[{number:1,hand:200,history:structuredClone(room.history),results:room.history[0].results}];room.roundNumber=2;return room;}
test('compact state remains bounded with hundreds of hands; legacy is unchanged and cards stay private',()=>{
 const r=largeRoom();const a=snapshot(r,r.host),b=snapshot(r,r.host,{compact:true});
 assert.equal(a.history.length,200);assert.equal(a.completedRounds[0].history.length,200);
 assert.equal(b.history,undefined);assert.equal(b.completedRounds,undefined);
 assert.equal(b.historyVersion,'2:200:1');assert.equal(b.historyCount,200);
 assert.ok(Buffer.byteLength(JSON.stringify(b))<3000);
 assert.ok(Buffer.byteLength(JSON.stringify(a))>100000);
 const before=JSON.stringify(r);historyPage(r,{offset:0,limit:50});assert.equal(JSON.stringify(r),before);
});
test('history pages are bounded, newest first, public, complete, and archived current is canonical',()=>{
 const r=largeRoom(),all=[];
 for(let offset=0;offset<200;offset+=50){const p=historyPage(r,{offset,limit:50});assert.equal(p.total,200);assert.equal(p.hands.length,50);all.push(...p.hands);assert.equal(p.rounds[0].history,undefined);}
 assert.deepEqual(all.map(h=>h.hand),Array.from({length:200},(_,i)=>200-i));
 assert.ok(!JSON.stringify(all).includes('secret'));
 assert.equal(historyPage(r,{round:'999'}),null);
 for(const data of [{limit:51},{offset:-1},{offset:1.5},{round:'1.5'}])assert.throws(()=>historyPage(r,data));
 assert.equal(historyPage(r,{offset:999}).hands.length,0);
 r.roundNumber=1;r.phase='ended';r.history=[];assert.equal(historyPage(r).total,200);
});
test('slow sender coalesces unsent state and ignores callbacks from cleared identities',()=>{
 const callbacks=[],sent=[],ws={readyState:1,bufferedAmount:0,send(raw,cb){sent.push(JSON.parse(raw));callbacks.push(cb);},close(){this.readyState=3;}};
 const s=createStateSender();s.send(ws,()=>({n:1}));s.send(ws,()=>({n:2}));s.send(ws,()=>({n:3}));
 assert.deepEqual(sent,[{n:1}]);callbacks.shift()();assert.deepEqual(sent,[{n:1},{n:3}]);
 s.clear(ws);s.send(ws,()=>({n:4}));callbacks.shift()();assert.deepEqual(sent,[{n:1},{n:3},{n:4}]);
 s.clear(ws);
});
test('excessively slow peers reconnect rather than collecting unbounded states',async()=>{
 let closed;const ws={readyState:1,bufferedAmount:999999,send(){throw Error('should not send');},close(code){closed=code;this.readyState=3;}};
 const s=createStateSender({maxStallMs:30});for(let i=0;i<100;i++)s.send(ws,()=>({n:i}));
 await delay(80);assert.equal(closed,1013);s.clear(ws);
});
test('a single stalled in-flight write reconnects even without later broadcasts',async()=>{
 let closed;const ws={readyState:1,bufferedAmount:0,send(){},close(code){closed=code;this.readyState=3;}};
 const s=createStateSender({maxStallMs:30});s.send(ws,()=>({n:1}));
 await delay(80);assert.equal(closed,1013);s.clear(ws);
});
