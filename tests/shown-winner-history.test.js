import {startHand} from './game-helpers.js';
import test from 'node:test';import assert from 'node:assert/strict';
import {createRoom,joinRoom,settle,snapshot,command} from '../server/game.js';import {historyPage} from '../server/history-pages.js';import {publicHistory,adminHistory} from '../server/room-history.js';import {addSpectator} from '../server/spectators.js';
function river(tie=false){const r=createRoom('Host',undefined,undefined,undefined,undefined,'friends').room;joinRoom(r,'B');joinRoom(r,'C');startHand(r,r.host);r.phase='river';r.board=tie?['As','Ks','Qs','Js','Ts']:['2h','3d','7c','8d','Jh'];const holes=tie?[['2c','3c'],['4c','5c'],['6c','7d']]:[['As','Ad'],['Ks','Kd'],['Qs','Qd']];r.players.forEach((p,i)=>Object.assign(p,{inHand:true,folded:false,cards:holes[i],stack:9900,total:100,bet:100,finishStack:10000}));return r;}
test('shown winner snapshot freezes public consent, nickname, cards and label through new hands and recovery',()=>{
 const r=river();settle(r);const shown=r.history[0].shownWinners;
 assert.equal(shown.length,1);assert.equal(shown[0].id,r.host);assert.deepEqual(shown[0].cards,['As','Ad']);assert.equal(shown[0].won,300);assert.equal(shown[0].handLabel,'一对');
 const before=JSON.stringify(shown);command(r,r.host,'winningcards',{enabled:false});r.players[0].name='Changed';startHand(r,r.host);assert.equal(JSON.stringify(r.history[0].shownWinners),before);
 const recovered=JSON.parse(JSON.stringify(r));recovered.phase='showdown';command(recovered,recovered.host,'end');command(recovered,recovered.host,'restart',{round:1});assert.equal(JSON.stringify(recovered.completedRounds[0].history[0].shownWinners),before);
 const view=historyPage(recovered,{round:'1'});assert.equal(view.hands[0].shownWinners[0].name,'Host');view.hands[0].shownWinners[0].cards[0]='2s';assert.equal(recovered.completedRounds[0].history[0].shownWinners[0].cards[0],'As');
 const final=river();final.players.forEach(p=>Object.assign(p,{stack:0,total:10000,bet:10000}));settle(final);assert.equal(final.phase,'ended');assert.deepEqual(final.completedRounds[0].history[0].shownWinners[0].cards,['As','Ad']);
});
test('opt-out excludes even the local private winner focus; observer visibility and fold wins never create records',()=>{
 const r=river();command(r,r.host,'winningcards',{enabled:false});addSpectator(r,{id:'watch',nickname:'Viewer'});settle(r);
 assert.equal(snapshot(r,r.host).winnerFocus.length,1);assert.deepEqual(r.history[0].shownWinners,[]);assert.deepEqual(historyPage(r).hands[0].shownWinners,[]);
 assert.equal(snapshot(r,r.spectators[0].id).godMode,true);
 const folded=river();folded.players[1].folded=true;folded.players[2].folded=true;settle(folded);assert.equal(folded.reveal,false);assert.deepEqual(folded.history[0].shownWinners,[]);
});
test('ties/side pots use stable IDs, do not duplicate winners or include refunds',()=>{
 const tie=river(true);tie.players.forEach(p=>p.name='Same');command(tie,tie.players[1].id,'winningcards',{enabled:false});settle(tie);
 assert.deepEqual(new Set(tie.history[0].shownWinners.map(w=>w.id)),new Set([tie.players[0].id,tie.players[2].id]));assert.ok(tie.history[0].shownWinners.every(w=>w.won===100));
 const r=river();r.players.forEach((p,i)=>Object.assign(p,{total:(i+1)*100,bet:(i+1)*100,stack:10000-(i+1)*100}));settle(r);
 assert.equal(r.pots.length,3);assert.deepEqual(r.history[0].shownWinners.map(w=>[w.id,w.won]),[[r.players[0].id,300],[r.players[1].id,200]]);assert.equal(r.history[0].shownWinners.some(w=>w.id===r.players[2].id),false);
});
test('projection whitelists only explicit valid shown winners; legacy history is never backfilled',()=>{
 const r=river();settle(r);const hand=structuredClone(r.history[0]);hand.shownWinners.push({id:r.players[1].id,cards:['Ks','Kd'],won:100,name:'Hidden'});hand.shownWinners[0].accountId='secret';hand.shownWinners[0].deck=['secret'];
 const result=publicHistory([hand])[0];assert.equal(result.shownWinners.length,1);assert.equal(result.shownWinners[0].accountId,undefined);assert.equal(result.shownWinners[0].deck,undefined);
 hand.shownWinners[0].cards=['??','??'];assert.deepEqual(publicHistory([hand])[0].shownWinners,[]);
 const old={hand:1,board:[...r.board],pots:r.pots,results:[]};assert.equal(Object.hasOwn(publicHistory([old])[0],'shownWinners'),false);assert.equal(adminHistory({...r,history:[old]}).rounds[0].history[0].shownWinners,undefined);
});
