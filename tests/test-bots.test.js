import test from 'node:test';import assert from 'node:assert/strict';
import {createRoom,joinRoom,command,snapshot} from '../server/game.js';
import {startHand} from './game-helpers.js';
import {manageBots,botSetup,createBotScheduler,botAction} from '../server/practice-bots.js';
import {bindLegacyPlayer,claimLegacyRooms} from '../server/room-ownership.js';
import {recordHandStatistics,accountStatistics} from '../server/player-statistics.js';
function setup(mode='friends'){const {room:r,player:p}=createRoom('Host',undefined,undefined,undefined,30,mode);p.accountId='admin';return {r,p,user:{id:'admin',role:'admin'}};}
const add=(r,user,p,count=1)=>manageBots(r,user,p.id,{action:'add',count,round:r.roundNumber,version:r.botVersion||0});
test('only authenticated admin host can add companions, with atomic capacity and config-revision guards',()=>{
 const {r,p,user}=setup(),before=JSON.stringify(r);
 assert.throws(()=>add(r,{...user,role:'user'},p),/管理员/);assert.equal(JSON.stringify(r),before);
 assert.throws(()=>add(r,{id:'other',role:'admin'},p),/房主/);assert.throws(()=>add(r,user,p,9),/数量|人数/);
 add(r,user,p,8);assert.equal(r.players.length,9);assert.equal(botSetup(r,user,p.id).canManage,true);
 const full=JSON.stringify(r);assert.throws(()=>add(r,user,p),/人数|已满/);assert.equal(JSON.stringify(r),full);
 assert.throws(()=>manageBots(r,user,p.id,{action:'add',count:1,round:1,version:0}),/更新/);
 assert.ok(r.players.slice(1).every(b=>b.isBot&&!b.accountId));
});
test('remove only bot seats before start, preserve identity history, stop changing after host initiates seating',()=>{
 const {r,p,user}=setup();add(r,user,p);const bot=r.players[1];
 assert.throws(()=>manageBots(r,user,p.id,{action:'remove',player:p.id,round:1,version:r.botVersion}),/陪练/);
 manageBots(r,user,p.id,{action:'remove',player:bot.id,round:1,version:r.botVersion});assert.equal(bot.removed,true);assert.equal(r.testRound,false);assert.equal(r.players.length,1);
 add(r,user,p);command(r,p.id,'start');assert.throws(()=>add(r,user,p),/开局|排座/);
});
test('companion scheduler uses normal dice/turn actions, pauses without humans and survives serialization',()=>{
 const {r,p,user}=setup();add(r,user,p);command(r,p.id,'start');
 const scheduler=createBotScheduler({thinkDelay:()=>0,random:()=>.9});const bot=r.players[1],n=Date.now();
 assert.equal(scheduler.tick(r,new Set(),n),false);assert.equal(r.seating.rolls[bot.id],undefined);
 scheduler.tick(r,new Set([p.id]),n);assert.equal(scheduler.tick(r,new Set([p.id]),n+1),true);assert.equal(r.seating.rolls[bot.id].history.length,1);
 assert.equal(scheduler.tick(r,new Set([p.id]),n+2),false);
 const copy=JSON.parse(JSON.stringify(r));assert.equal(createBotScheduler({thinkDelay:()=>0}).tick(copy,new Set([p.id]),n+3),false);
 assert.equal(snapshot(r,p.id).players.find(b=>b.isBot).cards.length,0);
});
test('test rounds never affect global wins and bot identities cannot bind/claim as legacy users',()=>{
 const {r,p,user}=setup();add(r,user,p);const b=r.players[1];
 Object.assign(p,{inHand:true,cards:['As','Ad']});r.hand=1;r.pots=[{winnerIds:[p.id]}];recordHandStatistics(r);assert.equal(accountStatistics([r],user.id).hands,0);
 assert.throws(()=>bindLegacyPlayer(r,{id:'intruder',nickname:'X'},b.id),/陪练/);
 const sessions=new Map([['fake',{room:r.id,player:b.id}]]);assert.equal(claimLegacyRooms(new Map([[r.id,r]]),sessions,user,['fake']).claimed.length,0);assert.equal(b.accountId,undefined);
 r.testRound=false;recordHandStatistics(r);assert.equal(accountStatistics([r],user.id).hands,1);
});
test('decision policy ignores hidden opponents, prevents illegal raises and never acts during partial flop',()=>{
 const view={id:'r',phase:'preflop',me:'b',turn:0,hand:1,board:[],big:20,toCall:20,currentBet:20,minRaise:20,canRaise:true,players:[{id:'b',cards:['As','Ad'],inHand:true,stack:1000,bet:0},{id:'h',cards:['??','??']}]};
 assert.deepEqual(botAction(view,()=>0),{type:'raise',amount:40});assert.equal(botAction({...view,flopReveal:{}},()=>0),null);
 const other=structuredClone(view);other.players[1].cards=['2h','7c'];assert.deepEqual(botAction(other,()=>0),botAction(view,()=>0));
 assert.equal(botAction({...view,canRaise:false},()=>0).type,'call');assert.equal(botAction({...view,turn:1}),null);
});
test('cash, standard and turbo start with companion seats without changing the dealing rules',()=>{
 for(const mode of ['cash','standard','turbo']){const {r,p,user}=setup(mode);add(r,user,p,2);startHand(r,p.id);assert.equal(r.testRound,true);assert.equal(r.players.filter(p=>p.inHand).length,3);assert.equal(r.players.reduce((sum,p)=>sum+p.stack+p.total,0),r.initial*3);}
});
test('eligible companion rebuy votes cannot replace the remaining human approvals',()=>{
 const {r,p,user}=setup();const human=joinRoom(r,'Other');add(r,user,p);startHand(r,p.id);const bot=r.players.find(p=>p.isBot);
 p.stack=0;p.eliminated=true;p.inHand=false;p.cards=[];command(r,p.id,'rebuy',{amount:r.initial});
 const scheduler=createBotScheduler({thinkDelay:()=>0});const online=new Set([p.id,human.id]),now=Date.now();scheduler.tick(r,online,now);scheduler.tick(r,online,now+1);
 const request=r.requests[0];assert.ok(request.approvals.includes(bot.id));assert.equal(request.status,'pending');assert.ok(!request.approvals.includes(human.id));
});
