import test from 'node:test';import assert from 'node:assert/strict';
import {wagerView,objectTransitions,placeObject} from '../public/table-objects.js';
const room=()=>({id:'r',roundNumber:1,hand:1,phase:'preflop',dealer:0,smallBlind:0,bigBlind:1,board:[],players:[{id:'a',bet:10,totalBet:10,stack:990,folded:false},{id:'b',bet:20,totalBet:20,stack:980}]});
test('heads-up dealer and small blind stay distinct; folded bets remain until collection',()=>{
 const r=room(),a=wagerView(r,r.players[0],0);assert.deepEqual(a.roles,['dealer','small-blind']);assert.equal(a.amount,10);
 r.players[0].folded=true;assert.equal(wagerView(r,r.players[0],0).amount,10);
 assert.equal(wagerView({...r,phase:'showdown'},r.players[0],0).amount,0);
 assert.equal(wagerView({...r,phase:'waiting',hand:0},r.players[0],0).roles.length,0);
 assert.equal(wagerView(r,{...r.players[0],removed:true},0).roles.length,0);
});
test('wagers retain exact amounts without arbitrary decorative pile bands',()=>{
 const r=room();for(const n of [1,100,10000,99999999]){const view=wagerView(r,{...r.players[0],bet:n},0);assert.equal(view.amount,n);assert.equal(view.band,undefined);}
});
test('only real server-confirmed street boundaries collect old wagers',()=>{
 const a=room(),b=structuredClone(a);b.phase='flop';b.board=['As'];b.players.forEach(p=>p.bet=0);
 assert.equal(objectTransitions(null,b).length,0);assert.equal(objectTransitions(a,b).length,2);
 assert.equal(objectTransitions(b,{...b,board:['As','2c']}).length,0);
 assert.equal(objectTransitions(a,{...b,id:'other'}).length,0);
 assert.equal(objectTransitions(a,{...b,roundNumber:2}).length,0);
 assert.equal(objectTransitions(a,{...a,serverTime:-1}).length,0);
 const end={...a,phase:'showdown'};assert.equal(objectTransitions(a,end).length,2);
});
test('object placement clears obstacles and remains inside the table',()=>{
 const occupied=[{left:80,top:80,width:60,height:60}];
 const p=placeObject({x:110,y:110,width:40,height:24,bounds:{width:220,height:300},obstacles:occupied});
 assert.ok(p.left>=6&&p.top>=6&&p.left+p.width<=214&&p.top+p.height<=294);
 assert.ok(p.left+p.width<=80||p.left>=140||p.top+p.height<=80||p.top>=140);
});
