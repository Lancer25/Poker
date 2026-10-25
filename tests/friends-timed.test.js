import {startHand} from './game-helpers.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {createRoom,joinRoom,command,snapshot,advanceTournament,settle} from '../server/game.js';
import {currentLevel,tournamentView,announceTournamentLevel} from '../server/tournament.js';
function table(n=3){const {room}=createRoom('Host',undefined,undefined,undefined,undefined,'friends');for(let i=1;i<n;i++)joinRoom(room,'P'+i);return room;}
function river(r){r.hand=1;r.phase='river';r.tournament.startedAt=Date.now();r.board=['2h','3d','7c','8d','Jh'];const cards=[['As','Ad'],['Ks','Kd'],['Qs','Qd']];r.players.forEach((p,i)=>Object.assign(p,{inHand:true,cards:cards[i],total:100,bet:100,stack:i===1?0:900,finishStack:i===1?100:1000,antePaid:0}));}
test('new friends default30 and gentle180; custom/default other modes unchanged',()=>{
 const r=table();assert.equal(r.turnSeconds,30);assert.equal(r.tournament.levelDurationMs,180000);assert.equal(r.tournament.blindPolicy,'timed');assert.equal(r.tournament.blindStructure,'gentle3');
 assert.equal(createRoom('H',undefined,undefined,undefined,90,'friends').room.turnSeconds,90);
 assert.throws(()=>createRoom('H',10000,505,1000,30,'friends'),/500\/1000/);
 assert.throws(()=>createRoom('H',10000,500,1005,30,'friends'),/500\/1000/);
 for(const mode of ['cash','standard','turbo'])assert.equal(createRoom('H',undefined,undefined,undefined,undefined,mode).room.turnSeconds,60);
});
test('exact180s boundary announces only once, does not change active bets, then applies only one level',()=>{
 const r=table();startHand(r,r.host,10000);
 const before=JSON.stringify([r.small,r.big,r.currentBet,r.players.map(p=>[p.bet,p.stack]),r.deadline]);
 assert.equal(currentLevel(r,189999),1);assert.equal(announceTournamentLevel(r,189999),false);
 assert.equal(announceTournamentLevel(r,190000),true);assert.equal(announceTournamentLevel(r,190000),false);
 const t=tournamentView(r,190000);assert.deepEqual([t.pendingLevel.small,t.pendingLevel.big,t.nextLevelAt],[15,30,370000]);
 assert.equal(before,JSON.stringify([r.small,r.big,r.currentBet,r.players.map(p=>[p.bet,p.stack]),r.deadline]));
 while(r.phase!=='showdown')command(r,r.players[r.turn].id,'fold');
 assert.equal(advanceTournament(r,190000),false);
 const next=r.tournament.nextHandAt;r.tournament.startedAt=next-360000;
 advanceTournament(r,next);assert.deepEqual([r.small,r.big],[15,30]);
 while(r.phase!=='showdown')command(r,r.players[r.turn].id,'fold');
 advanceTournament(r,r.tournament.nextHandAt);assert.deepEqual([r.small,r.big],[25,50]);
});
test('elimination never advances timed blinds; long delays and numeric limits stay finite',()=>{
 const r=table();river(r);settle(r);
 assert.equal(r.players[1].eliminated,true);assert.equal(currentLevel(r,r.tournament.startedAt+119999),1);
 assert.equal(tournamentView(r,r.tournament.startedAt+1).pendingLevel,null);
 assert.equal(currentLevel(r,r.tournament.startedAt+360000),3);
 const restored=JSON.parse(JSON.stringify(r));assert.equal(currentLevel(restored,restored.tournament.startedAt+360000),3);
 const end=tournamentView(restored,1e15);restored.tournament.level=end.scheduledLevel;
 assert.equal(currentLevel(restored,1e15),11);
 assert.equal(tournamentView(restored,1e15).applied.big,2000);
 assert.equal(tournamentView(restored,1e15).nextLevel,null);
 assert.equal(end.nextLevelAt,null);
});
test('gentle levels honor the requested 20/30-minute ceilings and keep integer steps',()=>{
 const r=table();startHand(r,r.host,10000);
 const first=[20,30,50,80,150,250,400,600,1000,1500,2000];
 for(let level=1;level<=first.length;level++){
  const now=10000+(level-1)*180000;
  assert.equal(currentLevel(r,now),level);
  r.tournament.level=level;
  const applied=tournamentView(r,now).applied;
  assert.equal(applied.big,first[level-1]);
  assert.ok(Number.isSafeInteger(applied.small)&&Number.isSafeInteger(applied.big));
  if(level<=7)assert.ok(applied.small<=500&&applied.big<=1000);
  if(level<=11)assert.ok(applied.small<=1000&&applied.big<=2000);
 }
 r.tournament.level=currentLevel(r,10000+20*60000);
 assert.equal(tournamentView(r,10000+20*60000).applied.big,400);
 r.tournament.level=currentLevel(r,10000+30*60000);
 assert.equal(tournamentView(r,10000+30*60000).applied.big,2000);
 for(const hour of [1,2,24,10000]){
  const now=10000+hour*3600000;
  assert.equal(currentLevel(r,now),11);
  assert.deepEqual([tournamentView(r,now).applied.small,tournamentView(r,now).applied.big],[1000,2000]);
  assert.equal(tournamentView(r,now).nextLevelAt,null);
 }
});
test('a running stepped room above the new cap lowers blinds on its next hand',()=>{
 const r=table();startHand(r,r.host);
 while(r.phase!=='showdown')command(r,r.players[r.turn].id,'fold');
 r.tournament.level=12;r.tournament.startedAt=Date.now()-3600000;
 r.small=1500;r.big=3000;
 const pending=tournamentView(r,Date.now()).pendingLevel;
 assert.deepEqual([pending.small,pending.big],[1000,2000]);
 advanceTournament(r,r.tournament.nextHandAt);
 assert.deepEqual([r.tournament.level,r.small,r.big],[11,1000,2000]);
});
test('custom early blinds obey hard ceilings and old two-minute timed rooms keep doubling until rematch',()=>{
 const r=createRoom('H',10000,400,800,60,'friends').room;
 joinRoom(r,'P1');startHand(r,r.host,10000);
 for(let minute=0;minute<=30;minute++){
  const now=10000+minute*60000;
  r.tournament.level=currentLevel(r,now);
  const applied=tournamentView(r,now).applied;
  if(minute<=20)assert.ok(applied.small<=500&&applied.big<=1000);
  if(minute<=30)assert.ok(applied.small<=1000&&applied.big<=2000);
 }
 const previous=table();delete previous.tournament.blindStructure;previous.tournament.levelDurationMs=120000;
 startHand(previous,previous.host,10000);
 assert.equal(currentLevel(previous,130000),2);
 previous.tournament.level=2;
 assert.deepEqual([tournamentView(previous,130000).applied.small,tournamentView(previous,130000).applied.big],[20,40]);
 assert.equal(tournamentView(previous,130000).blindStructure,null);
 command(previous,previous.host,'end');while(previous.phase!=='ended')command(previous,previous.players[previous.turn].id,'fold');
 command(previous,previous.host,'restart',{round:1});
 assert.equal(previous.tournament.blindStructure,'gentle3');assert.equal(previous.tournament.levelDurationMs,180000);
});
test('persisted elimination rounds retain rules until rematch; reset enables timed policy and clears god',()=>{
 const r=table();delete r.tournament.blindPolicy;r.tournament.levelDurationMs=0;r.turnSeconds=60;
 river(r);settle(r);assert.equal(currentLevel(r,r.tournament.startedAt+999999),2);
 command(r,r.players[1].id,'godmode',{enabled:true});assert.equal(snapshot(r,r.players[1].id).godMode,true);
 command(r,r.host,'end');command(r,r.host,'restart',{round:1});
 assert.equal(r.tournament.blindPolicy,'timed');assert.equal(r.tournament.blindStructure,'gentle3');assert.equal(r.tournament.startedAt,null);assert.equal(r.turnSeconds,30);assert.ok(r.players.every(p=>!p.godMode&&!p.eliminated));
});
test('friend god permission excludes live all-ins, reveals only dealt cards and survives next hand/recovery',()=>{
 const r=table();startHand(r,r.host);const p=r.players[1];p.stack=0;
 assert.throws(()=>command(r,p.id,'godmode',{enabled:true}));p.stack=9900;
 river(r);settle(r);p.cards=['Ks','Kd'];
 command(r,p.id,'godmode',{enabled:true});assert.equal(snapshot(r,p.id).godMode,true);
 const restored=JSON.parse(JSON.stringify(r));advanceTournament(restored,restored.tournament.nextHandAt);
 const view=snapshot(restored,p.id,{compact:true});assert.equal(view.godMode,true);
 assert.equal(view.players.find(x=>x.id===p.id).cards.length,0);
 assert.ok(view.players.filter(x=>x.id!==p.id).every(x=>x.cards.length===2&&x.cards.every(c=>c!=='??')));
 assert.equal(view.deck,undefined);assert.equal(view.board.length,0);
 const ordinary=snapshot(restored,r.host,{compact:true});assert.ok(ordinary.players.find(x=>x.id===r.players[2].id).cards.every(c=>c==='??'));
 assert.throws(()=>command(restored,p.id,'call'));assert.throws(()=>command(restored,p.id,'rebuy',{amount:100}));
 command(restored,p.id,'godmode',{enabled:false});assert.equal(snapshot(restored,p.id).godMode,false);
});
