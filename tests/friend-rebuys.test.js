import {startHand} from './game-helpers.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {createRoom,joinRoom,settle,command,snapshot,advanceTournament,action} from '../server/game.js';
function table(n=4,busted=[1]){
 const r=createRoom('Host',undefined,undefined,undefined,30,'friends').room;
 for(let i=1;i<n;i++)joinRoom(r,'P'+i);
 startHand(r,r.host,10000);
 r.phase='river';r.board=['2h','3d','7c','8d','Jh'];r.turn=0;r.deadline=50000;
 const cards=[['As','Ad'],['Ks','Kd'],['Qs','Qd'],['Ts','Td'],['9s','9d']];
 r.players.forEach((p,i)=>Object.assign(p,{inHand:true,cards:cards[i],stack:busted.includes(i)?0:9900,bet:100,total:100,finishStack:busted.includes(i)?100:10000,folded:false}));
 r.tournament.totalChips=r.players.reduce((n,p)=>n+p.stack+p.total,0);
 settle(r,20000);return r;
}
const ask=(r,p=r.players[1])=>{command(r,p.id,'rebuy',{amount:r.initial});return r.requests.find(x=>x.player===p.id);};
const agree=(r,req)=>{for(const id of req.voters)command(r,id,'approve',{request:req.id});};
test('friends fixed settled-bust eligibility, all-in seats remain voters, host has no bypass',()=>{
 const r=table(),p=r.players[1];
 assert.equal(snapshot(r,p.id).canRequestRebuy,true);assert.throws(()=>command(r,r.host,'rebuy',{amount:r.initial}),/淘汰/);
 assert.throws(()=>command(r,p.id,'rebuy',{amount:1}),/初始/);
 const req=ask(r);assert.equal(req.amount,10000);assert.deepEqual(req.voters,r.players.filter(x=>x!==p).map(x=>x.id));
 command(r,r.host,'approve',{request:req.id});assert.equal(req.status,'pending');assert.equal(p.stack,0);assert.equal(req.approvals.length,1);
 command(r,r.host,'approve',{request:req.id});assert.equal(req.approvals.length,1);assert.throws(()=>ask(r),/已有/);
 const ongoing=table();advanceTournament(ongoing,25000);ongoing.players[2].stack=0;
 const pending=ask(ongoing);assert.ok(pending.voters.includes(ongoing.players[2].id));
 assert.throws(()=>command(ongoing,ongoing.players[2].id,'rebuy',{amount:10000}),/淘汰/);
});
test('unanimity queues credit only for next hand and locks god mode without changing betting/history/blinds',()=>{
 const r=table(),p=r.players[1];command(r,p.id,'godmode',{enabled:true});advanceTournament(r,25000);
 const before={history:structuredClone(r.history),turn:r.turn,deadline:r.deadline,level:r.tournament.level,started:r.tournament.startedAt,total:r.tournament.totalChips};
 const req=ask(r);agree(r,req);assert.equal(req.status,'approved');assert.equal(p.stack,0);assert.equal(p.godMode,false);
 assert.throws(()=>command(r,p.id,'godmode',{enabled:true}),/上帝|旁观|筹码/);
 assert.deepEqual(r.history,before.history);assert.equal(r.turn,before.turn);assert.equal(r.deadline,before.deadline);assert.equal(r.tournament.level,before.level);
 while(r.phase!=='showdown')action(r,r.players[r.turn].id,'fold',undefined,26000);
 advanceTournament(r,r.tournament.nextHandAt);
 assert.equal(p.eliminated,false);assert.equal(p.inHand,true);assert.equal(p.cards.length,2);assert.equal(p.buyin,20000);assert.equal(p.stack+p.total,10000);assert.equal(p.place,null);
 assert.equal(r.requests.length,0);assert.equal(r.tournament.startedAt,before.started);assert.equal(r.tournament.totalChips,before.total+10000);assert.ok(!r.tournament.standings.some(x=>x.id===p.id));
 assert.equal(r.players.reduce((n,x)=>n+x.stack+x.total,0),r.tournament.totalChips);
});
test('frozen voters and progress persist, outsiders cannot vote; any refusal/cancellation releases slot',()=>{
 const r=table(),req=ask(r),outsider='observer';command(r,r.host,'approve',{request:req.id});
 const restored=JSON.parse(JSON.stringify(r)),view=snapshot(restored,restored.players[2].id);
 assert.equal(view.requests[0].approvals.length,1);assert.equal(view.requests[0].canApprove,true);
 assert.throws(()=>command(restored,outsider,'approve',{request:req.id}),/审批/);
 assert.throws(()=>command(restored,restored.host,'cancelrebuy',{request:req.id}),/本人/);
 command(restored,restored.players[2].id,'reject',{request:req.id});assert.equal(restored.requests.length,0);
 const again=ask(restored);agree(restored,again);command(restored,restored.players[1].id,'cancelrebuy',{request:again.id});assert.equal(restored.requests.length,0);assert.equal(restored.players[1].stack,0);
});
test('ended or stopping friends never revive, queued credit cannot prevent last-survivor completion',()=>{
 const r=table(3),req=ask(r);agree(r,req);
 r.phase='river';r.board=['2h','3d','7c','8d','Jh'];r.players.forEach((p,i)=>Object.assign(p,{inHand:i!==1,folded:false,cards:i===0?['As','Ad']:i===2?['Qs','Qd']:[],total:i===1?0:100,bet:i===1?0:100,stack:0,finishStack:i===1?0:100}));
 settle(r,23000);assert.equal(r.phase,'ended');assert.equal(r.requests.length,0);assert.equal(r.players[1].stack,0);
 assert.throws(()=>ask(r),/结束/);assert.throws(()=>command(r,r.host,'approve',{request:req.id}),/结束/);assert.equal(advanceTournament(r,999999),false);
 const stopped=table();stopped.tournament.stopRequested=true;assert.throws(()=>ask(stopped),/结束/);
 for(const mode of ['standard','turbo']){const other=createRoom('H',undefined,undefined,undefined,30,mode).room;assert.throws(()=>command(other,other.host,'rebuy',{amount:10000}),/不能补充/);}
});
test('simultaneous applicants receive exactly one credit each and current tied ranks adjust without editing history',()=>{
 const r=table(5,[1,3]),past=structuredClone(r.history),before=r.tournament.totalChips;
 const a=ask(r,r.players[1]),b=ask(r,r.players[3]);agree(r,a);agree(r,b);command(r,r.host,'approve',{request:a.id});
 advanceTournament(r,r.tournament.nextHandAt);
 assert.equal(r.players[1].buyin,20000);assert.equal(r.players[3].buyin,20000);assert.equal(r.tournament.totalChips,before+20000);
 assert.equal(r.players.reduce((sum,p)=>sum+p.stack+p.total,0),r.tournament.totalChips);assert.deepEqual(r.history,past);assert.equal(r.tournament.standings.length,0);
 const single=table(5,[1,3]),req=ask(single);agree(single,req);advanceTournament(single,single.tournament.nextHandAt);
 assert.equal(single.players[3].place,5);assert.equal(single.tournament.standings[0].place,5);assert.equal(single.tournament.standings[0].tied,false);
});
test('a revived player may bust and reapply without duplicate rankings or chip creation; legacy blinds never decrease',()=>{
 const r=table(),p=r.players[1];delete r.tournament.blindPolicy;const req=ask(r);agree(r,req);advanceTournament(r,r.tournament.nextHandAt);
 const expected=r.tournament.totalChips,level=r.tournament.level;
 r.players.forEach(x=>{x.stack+=x.total;x.bet=0;x.total=0;x.folded=x!==p&&x.id!==r.host;x.cards=[];x.finishStack=x.stack;});
 r.phase='river';r.board=['2h','3d','7c','8d','Jh'];r.players[0].cards=['As','Ad'];p.cards=['Ks','Kd'];
 const amount=p.stack;for(const x of [r.players[0],p]){x.stack-=amount;x.total=amount;x.bet=amount;}
 settle(r,35000);assert.equal(p.eliminated,true);assert.equal(r.tournament.standings.filter(x=>x.id===p.id).length,1);
 const again=ask(r);agree(r,again);advanceTournament(r,r.tournament.nextHandAt);
 assert.equal(p.buyin,30000);assert.ok(r.tournament.level>=level);assert.equal(r.tournament.totalChips,expected+10000);assert.equal(r.players.reduce((sum,p)=>sum+p.stack+p.total,0),r.tournament.totalChips);
});
