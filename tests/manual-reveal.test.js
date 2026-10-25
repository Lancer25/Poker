import test from 'node:test';
import assert from 'node:assert/strict';
import {createRoom,joinRoom,command,snapshot,advanceTournament} from '../server/game.js';
import {startHand} from './game-helpers.js';
import {historyPage,historyVersion} from '../server/history-pages.js';
import {adminHistory} from '../server/room-history.js';

function table(){const {room}=createRoom('Host',undefined,undefined,undefined,undefined,'friends');joinRoom(room,'Guest');startHand(room,room.host);return room;}
function finish(room){command(room,room.players[room.turn].id,'fold');return room.players.find(p=>p.folded);}
function reveal(room,id,extra={}){return command(room,id,'showcards',{round:room.roundNumber||1,hand:room.hand,...extra});}

test('folded player may voluntarily reveal after settlement without changing game state',()=>{
 const room=table(),folded=finish(room),viewer=room.players.find(p=>p.id!==folded.id);
 assert.ok(snapshot(room,viewer.id).players.find(p=>p.id===folded.id).cards.every(c=>c==='??'));
 const version=historyVersion(room),next=room.tournament.nextHandAt,pots=structuredClone(room.pots),stacks=room.players.map(p=>p.stack);
 assert.equal(snapshot(room,folded.id).canShowCards,true);reveal(room,folded.id);
 assert.deepEqual(snapshot(room,viewer.id).players.find(p=>p.id===folded.id).cards,folded.cards);
 assert.equal(snapshot(room,folded.id).canShowCards,false);
 assert.notEqual(historyVersion(room),version);
 assert.deepEqual(historyPage(room).hands[0].shownPlayers[0].cards,folded.cards);
 assert.deepEqual(adminHistory(room).rounds[0].history[0].shownPlayers[0].cards,folded.cards);
 assert.equal(room.tournament.nextHandAt,next);assert.deepEqual(room.pots,pots);assert.deepEqual(room.players.map(p=>p.stack),stacks);
 const once=JSON.stringify(room);reveal(room,folded.id);assert.equal(JSON.stringify(room),once);
 advanceTournament(room,next);assert.equal(snapshot(room,folded.id).canShowCards,false);
 assert.ok(snapshot(room,viewer.id).players.find(p=>p.id===folded.id).cards.every(c=>c==='??'));
});
test('fold winner can opt in without creating automatic winner enlargement',()=>{
 const room=table();finish(room);const winner=room.players.find(p=>!p.folded);reveal(room,winner.id);
 assert.deepEqual(snapshot(room,room.players.find(p=>p.folded).id).players.find(p=>p.id===winner.id).cards,winner.cards);
 assert.deepEqual(snapshot(room,winner.id).winnerFocus,[]);assert.deepEqual(historyPage(room).hands[0].shownWinners,[]);
});
test('reveal rejects premature, stale, missing and foreign identities without mutation',()=>{
 const room=table();const before=JSON.stringify(room);assert.throws(()=>reveal(room,room.host));assert.equal(JSON.stringify(room),before);
 finish(room);for(const [id,data] of [[room.host,{hand:0}],[room.host,{round:99}],['unknown',{}],[room.host,{round:undefined}],[room.host,{hand:'1'}]]){
 const previous=JSON.stringify(room);assert.throws(()=>reveal(room,id,data));assert.equal(JSON.stringify(room),previous);}
 const player=room.players[0];player.removed=true;assert.throws(()=>reveal(room,player.id));
});
test('terminal hand reveal updates frozen archive and survives restart without exposing new cards',()=>{
 const room=table();finish(room);command(room,room.host,'end');const id=room.players[0].id;
 reveal(room,id);assert.equal(room.phase,'ended');assert.deepEqual(historyPage(room).hands[0].shownPlayers[0].cards,room.players[0].cards);
 const restored=JSON.parse(JSON.stringify(room));command(restored,id,'restart',{round:1});assert.equal(snapshot(restored,id).canShowCards,false);
 assert.equal(historyPage(restored,{round:1}).hands[0].shownPlayers.length,1);
});
