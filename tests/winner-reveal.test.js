import {startHand} from './game-helpers.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {createRoom,joinRoom,command,settle,snapshot,advanceTournament} from '../server/game.js';
import {historyPage} from '../server/history-pages.js';
function table(n=3){const {room}=createRoom('Host',undefined,undefined,undefined,undefined,'friends');for(let i=1;i<n;i++)joinRoom(room,'P'+i);return room;}
function river(r,tie=false){startHand(r,r.host);r.phase='river';r.board=tie?['As','Ks','Qs','Js','Ts']:['2h','3d','7c','8d','Jh'];const holes=tie?[['2c','3c'],['4c','5c'],['6c','7d']]:[['As','Ad'],['Ks','Kd'],['Qs','Qd']];r.players.forEach((p,i)=>Object.assign(p,{inHand:true,folded:false,cards:holes[i],stack:9900,total:100,bet:100,finishStack:10000}));}
test('fold wins stay hidden and never create a focus, even for the winner or god observer',()=>{
 const r=table(3);const observer=r.players[2];observer.stack=0;observer.eliminated=true;r.players[0].stack=20000;
 command(r,observer.id,'godmode',{enabled:true});startHand(r,r.host);const loser=r.players[r.turn];command(r,loser.id,'fold');
 const winner=r.players.find(p=>p.id!==loser.id&&p.id!==observer.id);
 assert.equal(r.reveal,false);assert.deepEqual(r.highlightedWinnerIds,[]);
 for(const p of r.players)assert.deepEqual(snapshot(r,p.id).winnerFocus,[]);
 assert.ok(snapshot(r,loser.id).players.find(p=>p.id===winner.id).cards.every(c=>c==='??'));
 assert.deepEqual(snapshot(r,winner.id).players.find(p=>p.id===winner.id).cards,winner.cards);
 assert.equal(snapshot(r,observer.id).godMode,true);
});
test('five-second continuation and focus start only after a real showdown',()=>{
 const r=table();river(r);const start=Date.now();settle(r);
 assert.ok(r.tournament.nextHandAt>=start+5000&&r.tournament.nextHandAt<=Date.now()+5000);
 assert.equal(advanceTournament(r,r.tournament.nextHandAt-1),false);
 const focus=snapshot(r,r.players[1].id,{compact:true}).winnerFocus;
 assert.equal(focus.length,1);assert.equal(focus[0].id,r.host);assert.deepEqual(focus[0].cards,['As','Ad']);assert.equal(focus[0].won,300);
 assert.equal(advanceTournament(r,r.tournament.nextHandAt),true);assert.deepEqual(snapshot(r,r.host).winnerFocus,[]);
});
test('preference controls only enlargement, freezes at settlement, persists through recovery and rematch',()=>{
 const r=table();assert.equal(snapshot(r,r.host).showWinningCards,true);
 command(r,r.host,'winningcards',{enabled:false});river(r);settle(r);
 const viewer=r.players[1].id;assert.deepEqual(snapshot(r,viewer).winnerFocus,[]);
 assert.deepEqual(snapshot(r,viewer).players[0].cards,['As','Ad']);
 assert.equal(snapshot(r,r.host).winnerFocus.length,1);
 command(r,r.host,'winningcards',{enabled:true});assert.deepEqual(snapshot(r,viewer).winnerFocus,[]);
 command(r,r.host,'winningcards',{enabled:false});const restored=JSON.parse(JSON.stringify(r));
 assert.equal(snapshot(restored,r.host).showWinningCards,false);
 command(restored,r.host,'end');command(restored,r.host,'restart',{round:1});
 assert.equal(snapshot(restored,r.host).showWinningCards,false);assert.deepEqual(snapshot(restored,r.host).winnerFocus,[]);
});
test('multiple winners use stable IDs; refunds do not qualify; history includes only publicly shown winners',()=>{
 const r=table();r.players.forEach(p=>p.name='Same');command(r,r.players[1].id,'winningcards',{enabled:false});river(r,true);settle(r);
 r.pots.push({amount:20,winners:['Same'],winnerIds:['unknown-refund'],refund:true});
 const view=snapshot(r,r.host,{compact:true});assert.deepEqual(new Set(view.winnerFocus.map(p=>p.id)),new Set([r.players[0].id,r.players[2].id]));
 assert.ok(view.winnerFocus.every(p=>p.won===100));
 const shown=historyPage(r).hands[0].shownWinners;assert.deepEqual(new Set(shown.map(w=>w.id)),new Set([r.players[0].id,r.players[2].id]));assert.ok(shown.every(w=>w.cards.length===2));
 r.showdownAt=Date.now()-5001;assert.deepEqual(snapshot(r,r.host).winnerFocus,[]);
});
test('invalid preferences and other-mode commands are rejected without mutation',()=>{
 const r=table(),before=JSON.stringify(r);assert.throws(()=>command(r,r.host,'winningcards',{enabled:'false'}));assert.equal(JSON.stringify(r),before);
 assert.throws(()=>command(r,'unknown','winningcards',{enabled:false}));
 const cash=createRoom('Host').room;assert.throws(()=>command(cash,cash.host,'winningcards',{enabled:false}));
});
