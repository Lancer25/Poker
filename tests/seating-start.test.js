import test from 'node:test';
import assert from 'node:assert/strict';
import {createRoom,joinRoom,command,advanceTournament,snapshot} from '../server/game.js';
import {rollSeats} from '../server/friend-room.js';
function setup(){const r=createRoom('Host',10000,10,20,30,'friends').room;joinRoom(r,'Guest');return r;}
function roll(r,p,dice,now){let i=0;rollSeats(r,p.id,{version:r.seating.version,rollRound:r.seating.rollRound},()=>dice[i++],now);}
test('host starts dice ceremony before any roll; duplicate start preserves scores',()=>{
 const r=setup(),[a,b]=r.players;
 assert.equal(r.seating.status,'idle');assert.equal(snapshot(r,a.id).seating.canRoll,false);
 assert.throws(()=>roll(r,a,[6,5],1000),/无需|开始/);
 assert.throws(()=>command(r,b.id,'start'),/房主/);
 command(r,a.id,'start');assert.equal(r.phase,'waiting');assert.equal(r.hand,0);assert.equal(r.seating.status,'rolling');
 roll(r,a,[6,5],1000);command(r,a.id,'start');assert.deepEqual(r.seating.rolls[a.id].history,[[6,5]]);
 roll(r,b,[2,3],1200);assert.equal(r.seating.status,'ready');assert.equal(r.seating.autoStartAt,3600);
 command(r,a.id,'start');assert.equal(r.hand,0);
 assert.equal(advanceTournament(r,3599),false);assert.equal(advanceTournament(r,3600),true);assert.equal(r.hand,1);assert.equal(r.phase,'preflop');assert.equal(r.deadline,33600);
 assert.equal(advanceTournament(r,3601),false);
});
test('ready ceremony survives serialization and roster changes cancel scheduled deal',()=>{
 const r=setup();command(r,r.host,'start');roll(r,r.players[0],[6,6],1000);roll(r,r.players[1],[1,1],1000);
 const restored=JSON.parse(JSON.stringify(r));assert.equal(advanceTournament(restored,3400),true);
 joinRoom(r,'Late');assert.equal(r.seating.status,'idle');assert.equal(advanceTournament(r,5000),false);assert.equal(r.hand,0);
});
test('ties need another roll and never schedule a deal prematurely',()=>{
 const r=setup();command(r,r.host,'start');roll(r,r.players[0],[3,3],1000);roll(r,r.players[1],[3,3],1000);
 assert.equal(r.seating.rollRound,1);assert.equal(advanceTournament(r,10000),false);
 roll(r,r.players[0],[6,6],11000);roll(r,r.players[1],[1,1],11000);assert.equal(r.seating.autoStartAt,13400);
});
