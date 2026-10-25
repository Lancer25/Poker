import {startHand} from './game-helpers.js';
import test from 'node:test';import assert from 'node:assert/strict';
import {createRoom,joinRoom,action,advanceFlop,snapshot,settle,command} from '../server/game.js';import {addSpectator} from '../server/spectators.js';
function table(mode='friends'){const r=createRoom('H',undefined,undefined,undefined,30,mode).room;joinRoom(r,'B');startHand(r,r.host,10000);r.players[0].cards=['As','Ad'];r.players[1].cards=['Ks','Kd'];r.deck=['Jh','6s','8d','5s','7c','3d','2h','4s'];return r;}
function finishPreflop(r,now=20000){while(r.phase==='preflop'){const p=r.players[r.turn];action(r,p.id,p.bet<r.currentBet?'call':'check',undefined,now);}return r;}
test('all formats expose flop at exact boundaries, pause decisions and start the complete turn after card three',()=>{
 for(const mode of ['cash','friends','standard','turbo']){
  const r=finishPreflop(table(mode));assert.deepEqual(r.board,['2h']);assert.equal(r.turn,-1);assert.equal(r.deadline,null);
  assert.equal(advanceFlop(r,20999),false);assert.deepEqual(r.board,['2h']);assert.equal(advanceFlop(r,21000),true);assert.deepEqual(r.board,['2h','3d']);
  assert.equal(advanceFlop(r,21999),false);assert.equal(advanceFlop(r,22000),true);assert.deepEqual(r.board,['2h','3d','7c']);assert.ok(r.turn>=0);assert.equal(r.deadline,52000);assert.equal(r.flopReveal,null);assert.equal(advanceFlop(r,22001),false);
 }
});
test('partial flop blocks actions/settlement and cannot leak future cards or insights to any role',()=>{
 const r=finishPreflop(table());const spectator=addSpectator(r,{id:'observer',nickname:'Observer'});
 for(const id of [...r.players.map(p=>p.id),spectator.id]){const v=snapshot(r,id,{compact:true});assert.equal(v.insight,null);assert.equal(v.canRaise,false);assert.equal(v.flopReveal.revealed,1);assert.ok(!JSON.stringify(v).includes('"3d"'));assert.ok(!JSON.stringify(v).includes('"7c"'));assert.equal(v.deck,undefined);assert.equal(v.flopReveal.runout,undefined);}
 const before=JSON.stringify(r);for(const type of ['fold','check','call','raise','allin'])assert.throws(()=>action(r,r.host,type,100),/翻牌/);assert.throws(()=>settle(r),/翻牌/);assert.equal(JSON.stringify(r),before);
});
test('recovery catches up elapsed reveal without replay; late completion grants a fresh full timer',()=>{
 const r=finishPreflop(table());advanceFlop(r,21000);const recovered=JSON.parse(JSON.stringify(r));assert.equal(advanceFlop(recovered,21500),false);assert.equal(advanceFlop(recovered,30000),true);assert.deepEqual(recovered.board,['2h','3d','7c']);assert.equal(recovered.deadline,60000);
 const delayed=finishPreflop(table());advanceFlop(delayed,30000);assert.equal(delayed.board.length,2);assert.equal(advanceFlop(delayed,30999),false);assert.equal(advanceFlop(delayed,31000),true);assert.equal(delayed.deadline,61000);
});
test('preflop all-ins wait for flop then use unchanged runout; no early history/focus/champion',()=>{
 for(const mode of ['cash','friends','standard','turbo']){
  const r=table(mode);while(r.phase==='preflop')action(r,r.players[r.turn].id,'allin',undefined,20000);
  assert.equal(r.board.length,1);assert.equal(r.history.length,0);assert.equal(r.showdownAt,null);assert.deepEqual(snapshot(r,r.host).winnerFocus,[]);
  advanceFlop(r,21000);assert.equal(r.board.length,2);assert.equal(r.history.length,0);advanceFlop(r,22000);assert.equal(r.board.length,5);assert.ok(['showdown','ended'].includes(r.phase));assert.equal(r.history.length,1);assert.equal(r.showdownAt,22000);assert.equal(r.deadline,null);
  assert.deepEqual(r.board,mode==='cash'?['4s','2h','3d','7c','5s']:['2h','3d','7c','8d','Jh']);
 }
});
test('turn/river normal burn and action timing remain unchanged after sequential flop',()=>{
 const r=finishPreflop(table('cash'));advanceFlop(r,21000);advanceFlop(r,22000);const before=r.players.reduce((n,p)=>n+p.stack+p.total,0);
 while(r.phase==='flop')action(r,r.players[r.turn].id,'check',undefined,23000);assert.deepEqual(r.board,['2h','3d','7c','8d']);assert.equal(r.deadline,53000);assert.equal(r.flopReveal,null);
 while(r.phase==='turn')action(r,r.players[r.turn].id,'check',undefined,24000);assert.deepEqual(r.board,['2h','3d','7c','8d','Jh']);assert.equal(r.deadline,54000);assert.equal(r.players.reduce((n,p)=>n+p.stack+p.total,0),before);
});
