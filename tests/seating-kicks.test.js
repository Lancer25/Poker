import test from 'node:test';import assert from 'node:assert/strict';
import {createRoom,joinRoom,startHand,command,settle,snapshot} from '../server/game.js';
import {rollSeats,beginSeating,isRoomKicked,rejoinRemoved,seatedPlayers} from '../server/friend-room.js';
import {prepareSeating} from './game-helpers.js';
import {addSpectator} from '../server/spectators.js';
function room(n=3){const r=createRoom('H',undefined,undefined,undefined,30,'friends').room;for(let i=1;i<n;i++)joinRoom(r,'P'+i);return r;}
function roll(r,p,dice){if(r.seating.status==='idle')beginSeating(r,r.host);let i=0;rollSeats(r,p.id,{version:r.seating.version,rollRound:r.seating.rollRound},()=>dice[i++]);}
test('dice require everyone; ties reroll only their group and retain earlier ordering; first seat deals',()=>{
 const r=room(),[a,b,c]=r.players;assert.throws(()=>startHand(r,r.host),/掷骰/);
 const version=r.seating.version;roll(r,a,[6,6]);roll(r,b,[6,6]);roll(r,c,[5,6]);assert.equal(r.seating.status,'rolling');assert.deepEqual(new Set(r.seating.pending),new Set([a.id,b.id]));
 assert.throws(()=>command(r,c.id,'rollseat',{version,rollRound:0,dice:[6,6]}),/过期|掷骰/);
 roll(r,a,[1,1]);roll(r,b,[1,2]);assert.equal(r.seating.status,'ready');assert.deepEqual(r.seating.order,[b.id,a.id,c.id]);assert.deepEqual(r.players.map(p=>p.id),[a.id,b.id,c.id]);
 const restored=JSON.parse(JSON.stringify(r));startHand(restored,restored.host);assert.equal(restored.players[restored.dealer].id,b.id);assert.equal(snapshot(restored,b.id).players[0].seatNumber,1);
});
test('waiting roster changes invalidate all dice, duplicate rolls cannot improve scores',()=>{
 const r=room(2),a=r.players[0];roll(r,a,[1,1]);const data={version:r.seating.version,rollRound:r.seating.rollRound};const before=JSON.stringify(r);
 assert.throws(()=>command(r,a.id,'rollseat',data),/已掷|掷骰/);assert.equal(JSON.stringify(r),before);
 joinRoom(r,'New');assert.notEqual(r.seating.version,data.version);assert.equal(Object.keys(r.seating.rolls).length,0);assert.throws(()=>command(r,a.id,'rollseat',data),/过期/);
});
test('separate tied groups keep their original priority and client-supplied dice are ignored',()=>{
 const r=room(4),[a,b,c,d]=r.players;roll(r,a,[4,4]);roll(r,b,[4,4]);roll(r,c,[3,3]);roll(r,d,[3,3]);
 roll(r,a,[1,1]);roll(r,b,[2,2]);roll(r,c,[6,6]);roll(r,d,[5,5]);assert.deepEqual(r.seating.order,[b.id,a.id,c.id,d.id]);
 const f=room(2),p=f.players[0];beginSeating(f,f.host);let i=0;rollSeats(f,p.id,{version:f.seating.version,rollRound:0,dice:[6,6],score:12},()=>[1,2][i++]);assert.deepEqual(f.seating.rolls[p.id].history,[[1,2]]);
});
test('host kick waits for settlement, preserves stack/pots/history and cancels affected approvals',()=>{
 const r=room(),[a,b,c]=r.players;r.hand=1;r.phase='river';r.tournament.startedAt=10000;r.tournament.totalChips=30000;r.board=['2h','3d','7c','8d','Jh'];r.turn=0;r.deadline=90000;
 r.players.forEach((p,i)=>Object.assign(p,{cards:i===0?['Ks','Kd']:i===1?['As','Ad']:['Qs','Qd'],stack:9900,total:100,bet:100,inHand:true,finishStack:10000,folded:false}));
 r.requests=[{id:'q',kind:'friend-rebuy',player:c.id,voters:[a.id,b.id],approvals:[a.id],status:'pending'}];
 assert.throws(()=>command(r,b.id,'kick',{player:a.id,round:1}),/房主/);assert.throws(()=>command(r,a.id,'kick',{player:a.id,round:1}),/自己/);
 command(r,a.id,'kick',{player:b.id,round:1});assert.equal(b.pendingKick,true);assert.equal(b.removed,undefined);assert.equal(r.turn,0);assert.equal(r.deadline,90000);assert.equal(r.requests.length,1);
 settle(r,Date.now());assert.equal(b.removed,true);assert.equal(b.stack,10200);assert.equal(r.pots[0].winnerIds[0],b.id);assert.equal(r.history[0].results.find(p=>p.id===b.id).stack,10200);assert.equal(r.requests.length,0);assert.equal(r.players.reduce((sum,p)=>sum+p.stack,0),30000);
 assert.equal(snapshot(r,a.id).tournament.remaining,2);assert.throws(()=>snapshot(r,b.id),/移出/);assert.equal(snapshot(r,a.id).winnerFocus[0]?.id,b.id);
});
test('waiting kicks invalidate seating, free a real seat and reject stale/self/non-host removal without mutation',()=>{
 const r=room(9),target=r.players[8];prepareSeating(r);const version=r.seating.version,before=JSON.stringify(r);
 assert.throws(()=>command(r,r.host,'kick',{player:target.id,round:99}),/场次/);assert.equal(JSON.stringify(r),before);
 command(r,r.host,'kick',{player:target.id,round:1});assert.equal(seatedPlayers(r).length,8);assert.notEqual(r.seating.version,version);assert.equal(isRoomKicked(r,target.id),true);
 joinRoom(r,'New');assert.equal(seatedPlayers(r).length,9);assert.throws(()=>joinRoom(r,'Overflow'),/已满/);prepareSeating(r);startHand(r,r.host);assert.equal(r.players.filter(p=>p.inHand).length,9);assert.equal(target.inHand,false);
});
test('showdown removal finishes at one survivor, preserves old history and requires explicit next-round return',()=>{
 const r=room(),target=r.players[1];r.phase='showdown';r.hand=1;r.tournament.startedAt=Date.now();
 command(r,r.host,'kick',{player:target.id,round:1});command(r,r.host,'kick',{player:r.players[2].id,round:1});assert.equal(r.phase,'ended');assert.equal(r.tournament.championId,r.host);assert.equal(r.completedRounds.length,1);
 const old=structuredClone(r.completedRounds);assert.throws(()=>command(r,r.host,'kick',{player:target.id,round:1}),/结束/);
 command(r,r.host,'restart',{round:1});assert.deepEqual(r.completedRounds,old);assert.equal(target.removed,true);assert.equal(target.stack,0);assert.equal(isRoomKicked(r,target.id),false);
 rejoinRemoved(r,target);assert.equal(target.removed,false);assert.equal(target.stack,10000);assert.equal(r.seating.status,'idle');assert.throws(()=>startHand(r,r.host),/掷骰/);
});
test('spectator removal is immediate and same-round observation is blocked',()=>{
 const r=room(2),spectator=addSpectator(r,{id:'outside',nickname:'S'});prepareSeating(r);startHand(r,r.host);const before=[r.turn,r.deadline,r.players.map(p=>p.stack)];
 command(r,r.host,'kick',{player:spectator.id,round:1});assert.equal(spectator.removed,true);assert.deepEqual([r.turn,r.deadline,r.players.map(p=>p.stack)],before);assert.throws(()=>addSpectator(r,{id:'outside',nickname:'S'}),/移出/);assert.throws(()=>snapshot(r,spectator.id),/移出/);
});
