import {startHand} from './game-helpers.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {completeFlop} from './game-helpers.js';
import {createRoom,joinRoom,settle,command,snapshot,advanceTournament} from '../server/game.js';
import {recoverFriendCountdown} from '../server/tournament.js';
function table(n=3,small=10,big=20){
 const {room}=createRoom('Host',undefined,small,big,60,'friends');
 // Retain coverage for persisted elimination-policy rounds.
 delete room.tournament.blindPolicy;room.tournament.levelDurationMs=0;
 for(let i=1;i<n;i++)joinRoom(room,'P'+i);
 return room;
}
function river(room,bets,starts){
 room.hand=1;room.phase='river';room.dealer=0;room.tournament.startedAt=Date.now();
 room.board=['2h','3d','7c','8d','Jh'];
 const holes=[['As','Ad'],['Ks','Kd'],['Qs','Qd'],['Ts','Td']];
 room.players.forEach((p,i)=>Object.assign(p,{inHand:true,cards:holes[i],total:bets[i],bet:bets[i],stack:starts[i]-bets[i],finishStack:starts[i],antePaid:0}));
}
test('friends defaults, no pregame rebuys or late entrants; legacy cash unchanged',()=>{
 const {room}=createRoom('Host',undefined,undefined,undefined,60,'friends');
 assert.deepEqual([room.initial,room.small,room.big,room.ante],[10000,10,20,0]);
 for(const type of ['rebuy','approve','reject'])assert.throws(()=>command(room,room.host,type,{amount:100}),/不能补充/);
 joinRoom(room,'P1');startHand(room,room.host);
 assert.throws(()=>joinRoom(room,'Late'),/已开始/);
 const legacy=createRoom('Host').room;
 assert.deepEqual([legacy.initial,legacy.small,legacy.big],[1000,5,10]);
});
test('legacy friend elimination doubles after five seconds; stale manual start cannot skip countdown',()=>{
 const room=table();river(room,[100,100,100],[1000,100,1000]);const before=Date.now();settle(room);
 assert.equal(room.players[1].eliminated,true);
 assert.deepEqual([room.small,room.big],[10,20]);
 const t=snapshot(room,room.host).tournament;
 assert.deepEqual([t.pendingLevel.small,t.pendingLevel.big,t.nextLevelAt],[20,40,null]);
 assert.ok(t.nextHandAt>=before+5000&&t.nextHandAt<=Date.now()+5000);
 assert.equal(advanceTournament(room,t.nextHandAt-1),false);
 assert.throws(()=>command(room,room.host,'start'),/自动继续/);
 assert.equal(advanceTournament(room,t.nextHandAt),true);
 assert.equal(advanceTournament(room,t.nextHandAt),false);
 assert.deepEqual([room.small,room.big,room.ante],[20,40,0]);
 assert.equal(room.players[1].inHand,false);
});
test('two simultaneous eliminations double twice, remain pending across serialization',()=>{
 const room=table(4);river(room,[100,100,100,100],[1000,100,100,1000]);settle(room);
 const restored=JSON.parse(JSON.stringify(room));
 assert.equal(restored.players.filter(p=>p.eliminated).length,2);
 assert.deepEqual([restored.small,restored.big],[10,20]);
 assert.equal(advanceTournament(restored,restored.tournament.nextHandAt),true);
 assert.deepEqual([restored.small,restored.big],[40,80]);
 assert.equal(restored.players.reduce((n,p)=>n+p.stack+p.total,0),2200);
});
test('last survivor archives then reset restores initial blinds and all players',()=>{
 const room=table();river(room,[1000,500,300],[1000,500,300]);settle(room);
 assert.equal(room.phase,'ended');assert.equal(room.tournament.championId,room.host);
 assert.equal(room.completedRounds.length,1);
 assert.throws(()=>command(room,room.host,'restart',{round:1,chipMode:'carry'}),/重置/);
 command(room,room.host,'restart',{round:1,chipMode:'reset'});
 assert.deepEqual([room.phase,room.roundNumber,room.small,room.big],['waiting',2,10,20]);
 assert.ok(room.players.every(p=>!p.eliminated&&p.stack===10000));
 assert.equal(room.tournament.startedAt,null);
});
test('custom initial blinds restore on rematch without ante or time escalation',()=>{
 const room=table(3,15,30);river(room,[1000,500,300],[1000,500,300]);settle(room);
 command(room,room.host,'restart',{round:1});
 assert.deepEqual([room.small,room.big],[15,30]);
 startHand(room,room.host,Date.now()+99999999);
 assert.deepEqual([room.small,room.big,room.ante],[15,30,0]);
});
test('7/9-player friends games conserve chips, terminate and never eliminate twice',()=>{
 for(const count of [7,9])for(let run=0;run<15;run++){
  const room=table(count);startHand(room,room.host);
  for(let actions=0;room.phase!=='ended';actions++){
   assert.ok(actions<400);
   if(room.flopReveal)completeFlop(room);
   else if(room.phase==='showdown'){
    const eliminated=room.players.filter(p=>p.eliminated).length;
    advanceTournament(room,room.tournament.nextHandAt);
    assert.equal(room.big,20*2**eliminated);
   }else{
    const p=room.players[room.turn];
    command(room,p.id,room.players.filter(p=>p.inHand&&!p.folded&&p.stack>0).length>1?'allin':'call');
   }
   const total=room.players.reduce((s,p)=>s+p.stack+(['showdown','ended'].includes(room.phase)?0:p.total),0);
   assert.equal(total,count*10000);
  }
  assert.equal(room.tournament.standings.length,count);
  assert.equal(room.players.filter(p=>p.place===1).length,1);
 }
});
test('friend scheduling recovers old showdown once, preserves persisted deadline and respects stop/completion',()=>{
 const room=table();river(room,[100,100,100],[1000,100,1000]);settle(room);
 room.tournament.nextHandAt=null;
 assert.equal(recoverFriendCountdown(room,1000),true);
 assert.equal(room.tournament.nextHandAt,6000);
 assert.equal(recoverFriendCountdown(room,2000),false);
 const restored=JSON.parse(JSON.stringify(room));
 assert.equal(recoverFriendCountdown(restored,3000),false);
 command(restored,restored.host,'end');
 assert.equal(restored.tournament.nextHandAt,null);
 assert.equal(advanceTournament(restored,999999),false);
 assert.equal(recoverFriendCountdown(restored,999999),false);
 for(const phase of ['waiting','flop','ended'])assert.equal(recoverFriendCountdown({...room,phase,tournament:{...room.tournament,nextHandAt:null}},1000),false);
 for(const flag of ['completed','cancelled','stopRequested'])assert.equal(recoverFriendCountdown({...room,tournament:{...room.tournament,nextHandAt:null,[flag]:true}},1000),false);
 assert.equal(recoverFriendCountdown({...room,idleEndRequested:true,tournament:{...room.tournament,nextHandAt:null}},1000),false);
});
