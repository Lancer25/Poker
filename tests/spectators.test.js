import {startHand} from './game-helpers.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {createRoom,joinRoom,snapshot,command} from '../server/game.js';
import {addSpectator,roomMember,canTakeSeat} from '../server/spectators.js';
import {recentRooms} from '../server/room-history.js';
import {onlinePlayers,onlineSpectators,updateLifecycle} from '../server/room-lifecycle.js';
const user={id:'watcher',nickname:'Watcher',avatar:null};
function table(){const r=createRoom('H',undefined,undefined,undefined,undefined,'friends').room;joinRoom(r,'B');r.players[0].accountId='host';return r;}
test('spectators are account-bound, deduplicated and never occupy seats or alter game state',()=>{
 const r=table();startHand(r,r.host);const before=JSON.stringify(r.players);const s=addSpectator(r,user);
 assert.equal(addSpectator(r,user),s);assert.equal(roomMember(r,user.id),s);assert.equal(r.players.length,2);assert.equal(JSON.stringify(r.players),before);assert.equal(canTakeSeat(r),false);
 assert.throws(()=>addSpectator(r,{id:'host',nickname:'H'}));assert.throws(()=>addSpectator(createRoom('H').room,user));
 const restored=JSON.parse(JSON.stringify(r));assert.equal(roomMember(restored,user.id).id,s.id);
 assert.throws(()=>command(r,s.id,'fold'));assert.equal(JSON.stringify(r.players),before);
});
test('only authenticated spectator projection reveals dealt hands; never deck, identity or future cards',()=>{
 const r=table();const s=addSpectator(r,user);startHand(r,r.host);
 const watched=snapshot(r,s.id,{compact:true});assert.equal(watched.spectating,true);assert.equal(watched.godMode,true);assert.equal(watched.players.length,2);assert.ok(watched.players.every(p=>p.cards.length===2&&!p.cards.includes('??')));assert.equal(watched.deck,undefined);assert.equal(watched.board.length,0);assert.equal(watched.insight,null);assert.equal(watched.canRaise,false);assert.equal(watched.spectator.accountId,undefined);
 const seated=snapshot(r,r.host);assert.ok(seated.players[1].cards.every(c=>c==='??'));assert.equal(snapshot(r,'forged').godMode,false);
 assert.deepEqual(watched.requests,[]);assert.equal(canTakeSeat(r),false);
 const duplicated=JSON.parse(JSON.stringify(r));duplicated.players[0].accountId=user.id;assert.equal(snapshot(duplicated,s.id).godMode,false);
 command(r,r.host,'end');while(r.phase!=='ended')command(r,r.players[r.turn].id,'fold');assert.equal(snapshot(r,s.id).godMode,false);assert.deepEqual(snapshot(r,s.id).winnerFocus,[]);
 command(r,r.host,'restart',{round:1});assert.equal(canTakeSeat(r),true);assert.equal(roomMember(r,user.id).id,s.id);
 for(let i=2;i<9;i++)joinRoom(r,'P'+i);assert.equal(canTakeSeat(r),false);
});
test('new spectators cannot enter ended or non-friend rooms and stored spectator capacity is bounded',()=>{
 const r=table(),s=addSpectator(r,user);r.phase='ended';assert.equal(addSpectator(r,user).id,s.id);assert.throws(()=>addSpectator(r,{id:'new',nickname:'New'}));
 r.phase='waiting';for(let i=1;i<50;i++)addSpectator(r,{id:'watch-'+i,nickname:'W'});assert.throws(()=>addSpectator(r,{id:'overflow',nickname:'W'}));assert.equal(r.players.length,2);
});
test('observers have recent-room membership but cannot keep lifecycle alive; online counts deduplicate tabs',()=>{
 const r=table(),s=addSpectator(r,user);assert.equal(recentRooms(new Map([[r.id,r]]),user)[0],r);
 const socket={readyState:1,identity:{room:r.id,player:s.id},authToken:'valid',accountId:user.id,lastPongAt:1000};
 const rooms=new Map([[r.id,r]]),lookup=token=>token==='valid'?user:null;
 assert.equal(onlinePlayers([socket,socket],rooms,lookup,1000).size,0);
 assert.equal(onlineSpectators([socket,socket],rooms,lookup,1000).get(r.id).size,1);
 assert.equal(onlineSpectators([{...socket,accountId:'forged'}],rooms,lookup,1000).size,0);
 updateLifecycle(r,new Set(),1000,100);updateLifecycle(r,new Set(),1100,100);assert.equal(r.phase,'ended');
});
