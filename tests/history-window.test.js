import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {createRoom,snapshot} from '../server/game.js';
import {historyPage} from '../server/history-pages.js';
import {adminHistory} from '../server/room-history.js';
const context={module:{exports:{}}};vm.runInNewContext(readFileSync('miniprogram/utils/room-history.js','utf8'),context);
const {HistoryCache}=context.module.exports;
const hand={hand:1,board:['Ah','Kd','3c'],pots:[],results:[]};
function room(count){const r=createRoom('H').room;r.roundNumber=count;r.completedRounds=Array.from({length:count-1},(_,i)=>({number:i+1,hand:1,history:[hand],results:[]}));r.history=[hand];return r;}
test('table snapshots and history catalog remain bounded while administrator retains every round',()=>{
 for(const count of [3,10,100]){
  const r=room(count),before=JSON.stringify(r),legacy=snapshot(r,r.host),compact=snapshot(r,r.host,{compact:true});
  assert.equal(compact.previousRoundNumber,count-1);assert.deepEqual(legacy.completedRounds.map(x=>x.number),[count-1]);
  const page=historyPage(r);assert.deepEqual(page.rounds.map(x=>x.number),[count-1]);assert.equal(historyPage(r,{round:String(count-1)}).total,1);
  assert.throws(()=>historyPage(r,{round:'1'}),e=>e.status===403);assert.equal(historyPage(r,{round:'1'},{allowOlder:true}).total,1);
  assert.equal(adminHistory(r).rounds.length,count);assert.equal(JSON.stringify(r),before);
 }
 const r=room(10);r.completedRounds=r.completedRounds.filter(x=>x.number!==9);assert.equal(snapshot(r,r.host,{compact:true}).previousRoundNumber,8);
});
test('history cache drops evicted rounds, rejects stale pages and never allocates forbidden entries',()=>{
 const c=new HistoryCache();
 for(let round=1;round<=100;round++){
  c.sync('a',{id:'r',roundNumber:round,transportVersion:2,historyVersion:round+':1:'+round,historyCount:1,previousRoundNumber:round>1?round-1:null});
  const request=c.begin();c.accept(request,{roomId:'r',version:c.context.version,currentRound:round,roundNumber:round,offset:0,total:1,hands:[hand],rounds:round>1?[{number:round-1}]:[]});
  assert.ok(c.entries.size<=2);assert.ok(c.rounds.length<=1);
 }
 assert.equal(c.entries.has(1),false);assert.equal(c.begin('1'),null);c.entry('1');assert.equal(c.entries.has(1),false);
 const previous=c.entry('99').hands,stale=c.begin('99');
 c.sync('a',{id:'r',roundNumber:101,transportVersion:2,historyVersion:'101:0:100',historyCount:0,previousRoundNumber:100});
 assert.equal(c.entries.has(99),false);assert.equal(c.accept(stale,{}),false);assert.notEqual(c.entry('99').hands,previous);
 c.sync('a',{id:'r',roundNumber:103,transportVersion:2,historyVersion:'103:0:102',historyCount:0,previousRoundNumber:102});assert.equal(c.entries.has(100),false);
});
