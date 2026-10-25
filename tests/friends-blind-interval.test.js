import {startHand} from './game-helpers.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {createRoom,joinRoom,command,snapshot} from '../server/game.js';
import {currentLevel,beginTournamentHand,tournamentView} from '../server/tournament.js';
function table(minutes){const {room}=createRoom('Host',undefined,undefined,undefined,undefined,'friends',minutes);joinRoom(room,'B');return room;}
test('friend interval defaults to three and accepts integer minutes 1-30',()=>{
 assert.equal(table().tournament.levelDurationMs,180000);
 for(const minutes of [1,3,7,30])assert.equal(table(minutes).tournament.levelDurationMs,minutes*60000);
 for(const minutes of [0,-1,31,1.5,null,'5',NaN,Infinity])assert.throws(()=>table(minutes),/升盲间隔/);
 for(const [mode,ms]of [['standard',600000],['turbo',300000]])assert.equal(createRoom('A',undefined,undefined,undefined,undefined,mode,7).room.tournament.levelDurationMs,ms);
});
test('custom interval drives countdown and next-hand gentle levels, cap and rematch persistence',()=>{
 const r=table(7);startHand(r,r.host,10000);
 assert.equal(tournamentView(r,10000).nextLevelAt,430000);
 assert.equal(currentLevel(r,429999),1);assert.equal(currentLevel(r,430000),2);
 assert.deepEqual([r.small,r.big],[10,20]);beginTournamentHand(r,430000);assert.deepEqual([r.small,r.big],[15,30]);
 for(let level=3;level<=11;level++)beginTournamentHand(r,10000+level*420000);
 assert.deepEqual([r.small,r.big],[1000,2000]);assert.equal(tournamentView(r,100000000).nextLevelAt,null);
 const recovered=JSON.parse(JSON.stringify(r));assert.equal(snapshot(recovered,recovered.host).tournament.levelDurationSeconds,420);
 recovered.phase='showdown';command(recovered,recovered.host,'end');command(recovered,recovered.host,'restart',{round:1});
 assert.equal(recovered.tournament.levelDurationMs,420000);assert.equal(recovered.tournament.startedAt,null);
 assert.deepEqual([recovered.small,recovered.big],[10,20]);
});
