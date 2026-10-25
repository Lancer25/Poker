import test from 'node:test';
import assert from 'node:assert/strict';
import {createRoom,joinRoom,command,snapshot,advanceTournament} from '../server/game.js';
import {initializeControls,roomControlCommand} from '../server/room-controls.js';
import {prepareSeating,startHand} from './game-helpers.js';
import {manageBots} from '../server/practice-bots.js';
function table(){const {room}=createRoom('A',10000,10,20,30,'friends');joinRoom(room,'B');initializeControls(room);return room;}
function control(room,id,command,data,now){return roomControlCommand(room,id,command,{round:room.roundNumber||1,version:room.controls.version,readyEpoch:room.controls.readyEpoch,...data},now);}
function pause(room,now){control(room,room.host,'pause',{},now);for(const p of room.players.filter(p=>p.id!==room.host))control(room,p.id,'pausevote',{request:room.controls.pause.id,value:true},now);}
test('resuming a pre-first-hand pause preserves the fresh five-second wait after dice seating',()=>{
 const r=table();prepareSeating(r);const now=r.seating.autoStartAt+100;pause(r,now);
 for(const p of r.players)control(r,p.id,'ready',{value:true},now+10);
 control(r,r.host,'resume',{},now+20);
 assert.equal(advanceTournament(r,now+5019),false);assert.equal(r.hand,0);
 assert.equal(advanceTournament(r,now+5020),true);assert.equal(r.hand,1);
});
test('snapshot accounts active pause time before projecting blind levels without touching stacks or action deadlines',()=>{
 const r=table();startHand(r,r.host);pause(r,Date.now());command(r,r.players[r.turn].id,'fold');
 assert.equal(r.controls.pause.state,'active');const now=r.controls.pause.clockAt;
 const before=snapshot(r,r.host,{now}),stacks=r.players.map(p=>p.stack),deadline=r.deadline,version=r.controls.version;
 const after=snapshot(r,r.host,{now:now+180000});
 assert.equal(after.tournament.scheduledLevel,before.tournament.scheduledLevel);
 assert.equal(after.tournament.nextLevelAt-before.tournament.nextLevelAt,180000);
 assert.equal(after.serverTime,now+180000);assert.equal(r.deadline,deadline);assert.deepEqual(r.players.map(p=>p.stack),stacks);assert.equal(r.controls.version,version);
});
test('administrator-created companions consent to pauses without approving for human seats',()=>{
 const r=table(),admin={id:'admin',role:'admin'};r.players[0].accountId=admin.id;
 manageBots(r,admin,r.host,{action:'add',count:1,round:1,version:0});
 control(r,r.host,'pause',{},1000);assert.equal(r.controls.pause.state,'pending');assert.equal(r.controls.pause.approvals.length,2);
 control(r,r.players[1].id,'pausevote',{request:r.controls.pause.id,value:true},1000);assert.equal(r.controls.pause.state,'active');
});
