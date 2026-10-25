import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const context={module:{exports:{}}};vm.runInNewContext(readFileSync('miniprogram/utils/table-experience.js','utf8'),context);
const {HapticClock,preferences}=context.module.exports;
const room=()=>({id:'123456',me:'a',roundNumber:1,hand:1,gameMode:'friends',phase:'flop',turn:0,deadline:40000,players:[{id:'a',inHand:true,stack:100}]});
test('vibration is opt in and deduplicates turn and ten-second warning across persisted recovery',()=>{
 assert.equal(preferences().vibration,false);assert.equal(preferences({vibration:'true'}).vibration,false);
 const clock=new HapticClock(),r=room();assert.equal(clock.tick(r,30),'turn');assert.equal(clock.tick(r,29),null);
 assert.equal(clock.tick(r,10),'warning');assert.equal(clock.tick(r,9),null);
 const restored=new HapticClock(JSON.parse(JSON.stringify(clock.entries())));assert.equal(restored.tick(r,8),null);
 r.deadline+=30000;assert.equal(restored.tick(r,30),'turn');assert.equal(restored.tick(r,10),'warning');
});
test('late entry gives one urgent pattern, never a duplicate turn and warning together',()=>{
 const clock=new HapticClock(),r=room();assert.equal(clock.tick(r,7),'warning');assert.equal(clock.tick(r,7),null);
 r.roundNumber++;assert.equal(clock.tick(r,7),'warning');
});
test('no pulses for observers, inactive/folded/all-in/removed players, partial flop or expired clocks',()=>{
 for(const change of [r=>r.spectating=true,r=>r.godMode=true,r=>r.phase='showdown',r=>r.gameMode='cash',r=>r.turn=-1,r=>r.flopReveal={},r=>r.players[0].inHand=false,r=>r.players[0].folded=true,r=>r.players[0].stack=0,r=>r.players[0].removed=true]){
 const clock=new HapticClock(),r=room();change(r);assert.equal(clock.tick(r,10),null);}
 for(const seconds of [0,-1,null,NaN,Infinity])assert.equal(new HapticClock().tick(room(),seconds),null);
});
test('dedup storage is bounded and rejects corrupt persisted state',()=>{
 const clock=new HapticClock({corrupt:true}),r=room();for(let hand=1;hand<=150;hand++){r.hand=hand;clock.tick(r,30);clock.tick(r,10);}assert.ok(clock.entries().length<=64);
 assert.equal(new HapticClock([null,{},['x',99]]).tick(room(),30),'turn');
});
