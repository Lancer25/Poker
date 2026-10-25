import {startHand} from './game-helpers.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {createRoom,joinRoom,command,snapshot} from '../server/game.js';
import {beginTournamentHand,currentLevel,tournamentView,announceTournamentLevel} from '../server/tournament.js';
function table(initial=10000,minutes=1,small=1,big=2){
 const {room}=createRoom('H',10000,10,20,30,'friends',minutes);
 // Persisted legacy rooms may have arbitrary integer stacks and blinds.
 delete room.chipUnit;room.initial=initial;room.small=small;room.big=big;
 room.tournament.baseSmall=small;room.tournament.baseBig=big;
 room.players[0].stack=room.players[0].buyin=initial;
 joinRoom(room,'B');startHand(room,room.host,10000);return room;
}
test('gentle friend caps scale with per-player starting chips, floor odd amounts and keep the first blinds',()=>{
 for(const initial of [100,999,5000,10000,20000,999999]){
  const r=table(initial);assert.deepEqual([r.small,r.big],[1,2]);
  for(let minute=0;minute<20;minute++){
   const now=10000+minute*60000;r.tournament.level=currentLevel(r,now);
   const view=tournamentView(r,now);assert.ok(view.applied.small<=Math.floor(initial/20));assert.ok(view.applied.big<=2*Math.floor(initial/20));
  }
  r.tournament.level=currentLevel(r,10000+3600000);const end=tournamentView(r,10000+3600000);
  assert.deepEqual([end.applied.small,end.applied.big],[Math.floor(initial/10),2*Math.floor(initial/10)]);
  assert.equal(end.nextLevelAt,null);assert.equal(end.nextLevel,null);
  assert.equal(snapshot(r,r.host).initial,initial);
 }
});
test('one-minute intervals wait at the early cap until elapsed twenty minutes and preview the gated time',()=>{
 const r=table();r.tournament.level=9;
 const before=JSON.stringify([r.small,r.big,r.currentBet,r.deadline,r.players]);
 assert.equal(currentLevel(r,10000+1199999),9);
 const waiting=tournamentView(r,10000+600000);assert.equal(waiting.nextLevelAt,1210000);assert.deepEqual([waiting.nextLevel.small,waiting.nextLevel.big],[750,1500]);
 r.tournament.announcedLevel=9;assert.equal(announceTournamentLevel(r,1209999),false);assert.equal(announceTournamentLevel(r,1210000),true);
 assert.equal(currentLevel(r,1210000),11);assert.equal(JSON.stringify([r.small,r.big,r.currentBet,r.deadline,r.players]),before);
 const next=tournamentView(r,1210000);assert.deepEqual([next.pendingLevel.small,next.pendingLevel.big],[750,1500]);
 beginTournamentHand(r,1210000);assert.deepEqual([r.small,r.big],[750,1500]);beginTournamentHand(r,1210001);assert.deepEqual([r.small,r.big],[1000,2000]);
});
test('custom slow intervals, recovery and rematches retain caps and restart elapsed time',()=>{
 const r=table(20000,7);assert.equal(tournamentView(r,10000).nextLevelAt,430000);
 const restored=JSON.parse(JSON.stringify(r));restored.tournament.level=11;
 assert.deepEqual([tournamentView(restored,1e12).applied.small,tournamentView(restored,1e12).applied.big],[2000,4000]);
 restored.phase='showdown';command(restored,restored.host,'end');command(restored,restored.host,'restart',{round:1});
 assert.equal(restored.tournament.levelDurationMs,420000);assert.equal(restored.tournament.startedAt,null);startHand(restored,restored.host,50000);
 assert.deepEqual([restored.small,restored.big],[1,2]);assert.equal(tournamentView(restored,50000).nextLevelAt,470000);
});
test('starting blinds validate against proportional early caps before room or rematch mutation',()=>{
 assert.throws(()=>createRoom('H',1000,55,100,30,'friends'),/50\/100/);
 assert.throws(()=>createRoom('H',1000,50,105,30,'friends'),/50\/100/);
 assert.doesNotThrow(()=>createRoom('H',20000,1000,2000,30,'friends'));
 const r=table(1000);r.phase='showdown';command(r,r.host,'end');r.tournament.baseSmall=51;
 const before=JSON.stringify(r);assert.throws(()=>command(r,r.host,'restart',{round:1}),/50\/100/);assert.equal(JSON.stringify(r),before);
});
test('old gentle rooms with oversized base blinds conform on next deal, never during a hand',()=>{
 const r=table(1000);r.tournament.baseSmall=400;r.tournament.baseBig=800;r.small=400;r.big=800;
 tournamentView(r,11000);assert.deepEqual([r.small,r.big],[400,800]);
 beginTournamentHand(r,11000);assert.deepEqual([r.small,r.big],[50,100]);
});
