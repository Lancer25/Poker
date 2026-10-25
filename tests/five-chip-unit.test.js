import test from 'node:test';
import assert from 'node:assert/strict';
import {createRoom,joinRoom,action,command,settle,snapshot} from '../server/game.js';
import {startHand} from './game-helpers.js';
import {tournamentView} from '../server/tournament.js';
import {botAction} from '../server/practice-bots.js';
import {completeFlop} from './game-helpers.js';
import {chipBreakdown,DENOMINATIONS} from '../public/chip-display.js';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const context={};vm.runInNewContext(readFileSync('miniprogram/utils/table-experience.js','utf8'),context);
const ui=context.TableExperience;

test('all new modes require five-chip initial stacks and blinds',()=>{
  for(const mode of ['friends','cash','standard','turbo']){
    const {room,player}=createRoom('host',undefined,undefined,undefined,undefined,mode);
    assert.equal(room.chipUnit,5);assert.equal(snapshot(room,player.id).chipUnit,5);
    assert.throws(()=>createRoom('host',1001,10,20,30,mode),/5/);
    assert.throws(()=>createRoom('host',1000,11,20,30,mode),/5/);
  }
});
test('new-room invalid raise and rebuy do not mutate state; old rooms keep odd bets',()=>{
  const {room,player}=createRoom('host');joinRoom(room,'guest');startHand(room,player.id);
  const id=room.players[room.turn].id,before=JSON.stringify(room);
  assert.throws(()=>action(room,id,'raise',31),/5/);assert.equal(JSON.stringify(room),before);
  assert.throws(()=>command(room,player.id,'rebuy',{amount:101}),/5/);
  delete room.chipUnit;action(room,id,'raise',31);assert.equal(room.currentBet,31);
  command(room,player.id,'rebuy',{amount:101});assert.equal(room.requests[0].amount,101);
});
test('tied winners split whole five-chip units clockwise, including shown winning amounts',()=>{
  const {room}=createRoom('host',1000,5,10,30,'friends');joinRoom(room,'b');joinRoom(room,'c');
  room.hand=1;room.phase='river';room.dealer=0;room.board=['As','Ks','Qs','Js','Ts'];
  room.players.forEach((p,i)=>Object.assign(p,{stack:995,total:5,bet:5,inHand:true,folded:i===2,cards:[['2h','3h'],['4h','5h'],['6h','7h']][i]}));
  settle(room);
  assert.deepEqual(room.players.map(p=>p.stack),[1000,1005,995]);
  assert.deepEqual(room.history[0].shownWinners.map(p=>p.won),[10,5]);
  assert.equal(room.players.reduce((n,p)=>n+p.stack,0),3000);
});
test('proportional new-room blind ladders and caps stay divisible by five',()=>{
  const {room,player}=createRoom('host',1555,5,10,30,'friends');joinRoom(room,'guest');startHand(room,player.id,1000);
  for(let minutes=0;minutes<60;minutes++){
    const view=tournamentView(room,1000+minutes*60000);
    for(const level of [view.applied,view.nextLevel].filter(Boolean)){
      assert.equal(level.small%5,0);assert.equal(level.big%5,0);
    }
    assert.equal(view.blindCaps.earlySmall%5,0);assert.equal(view.blindCaps.small%5,0);
  }
});
test('chip art retains multiple denominations and never uses a one-chip face',()=>{
  assert.ok(!DENOMINATIONS.includes(1));
  const groups=chipBreakdown(6335);assert.ok(groups.length>1&&groups.length<=3);
  assert.equal(groups.reduce((n,g)=>n+g.value*g.count,0),6335);
  assert.deepEqual(chipBreakdown(6336),groups);
});
test('five-chip presets and adaptive steps are aligned, legacy input stays exact',()=>{
  const state={chipUnit:5,me:'a',players:[{id:'a',bet:0,stack:10000}],currentBet:0,minRaise:20,big:20,toCall:0,pot:75,canRaise:true};
  assert.equal(ui.betOptions(state).half%5,0);
  assert.equal(ui.stepBetAmount(state,'1056',1)%5,0);
  delete state.chipUnit;assert.equal(ui.betOptions(state).half,38);
});
test('room JSON recovery and both rematch modes retain unit; legacy history stays unchanged',()=>{
  for(const legacy of [false,true])for(const chipMode of ['reset','carry']){
    const {room}=createRoom('host');joinRoom(room,'guest');if(legacy)delete room.chipUnit;
    if(legacy)room.players[0].stack=999;
    command(room,room.host,'end');const history=JSON.stringify(room.completedRounds);
    const restored=JSON.parse(JSON.stringify(room));command(restored,restored.host,'restart',{round:1,chipMode});
    assert.equal(snapshot(restored,restored.host).chipUnit,legacy?1:5);
    assert.equal(JSON.stringify(restored.completedRounds),history);
    assert.equal(restored.players[0].stack,legacy&&chipMode==='carry'?999:1000);
  }
});
test('nine-seat bot decisions and mixed all-ins preserve five-chip balances across streets and side pots',()=>{
  for(let iteration=0;iteration<12;iteration++){
    const {room}=createRoom('host');for(let i=1;i<9;i++)joinRoom(room,'bot'+i);
    room.players.forEach((p,i)=>{p.stack=25+i*35;});const total=room.players.reduce((n,p)=>n+p.stack,0);
    startHand(room,room.host);let decisions=0;
    while(room.phase!=='showdown'&&decisions++<200){
      if(completeFlop(room))continue;
      const player=room.players[room.turn],view=snapshot(room,player.id);
      const choice=decisions%3===0&&(view.canRaise||player.bet+player.stack<=room.currentBet)
        ?{type:'allin'}:botAction(view,()=>0);
      assert.ok(choice);if(choice.amount!==undefined)assert.equal(choice.amount%5,0);
      action(room,player.id,choice.type,choice.amount);
      assert.ok(room.players.every(p=>[p.stack,p.bet,p.total].every(n=>n%5===0)));
    }
    assert.equal(room.phase,'showdown');assert.equal(room.players.reduce((n,p)=>n+p.stack,0),total);
  }
});
