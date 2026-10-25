import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {RoomUI} from '../public/room-ui.js';
const context={};vm.runInNewContext(readFileSync('miniprogram/utils/table-experience.js','utf8'),context);
const api=context.TableExperience;
const room=(pot=1200,stack=5000,big=20)=>({me:'a',currentBet:300,minRaise:300,toCall:300,pot,big,canRaise:true,players:[{id:'a',bet:0,stack}]});

test('step grows with the pot but is capped by available chips, not a fixed chip or blind',()=>{
 assert.equal(typeof api.betStep,'function');
 assert.equal(api.betStep(room()),50);
 assert.equal(api.betStep(room(200,20000)),20);
 assert.equal(api.betStep(room(30000,100000)),1000);
 assert.equal(api.betStep(room(30000,1000)),20);
 assert.equal(api.betStep(room(10000,10000,1)),200);
});
test('step controls preserve exact odd amounts, clamp legal bounds and handle an all-in-only range',()=>{
 assert.equal(typeof api.stepBetAmount,'function');
 const r=room();assert.equal(api.stepBetAmount(r,'1051',1),1101);assert.equal(api.stepBetAmount(r,'1101',-1),1051);
 assert.equal(api.stepBetAmount(r,'4999',1),5000);assert.equal(api.stepBetAmount(r,'600',-1),600);
 assert.equal(api.stepBetAmount(r,'invalid',1),650);assert.equal(api.stepBetAmount(r,'1e3',-1),600);
 const short=room(3000,450);assert.equal(api.betStep(short),0);assert.equal(api.stepBetAmount(short,'450',1),450);
});
test('opening the raise dialog focuses a non-editing control and never selects the amount',()=>{
 const previous=globalThis.document,focus=[];
 const nodes={betAmount:{disabled:false,value:'600',removeAttribute(){},focus(){focus.push('amount');},select(){focus.push('select');}},raiseError:{hidden:false},closeRaise:{focus(){focus.push('close');}}};
 globalThis.document={getElementById:id=>nodes[id]};
 try{const ui={closeTools(){},raiseDialog:{open:false,showModal(){this.open=true;}}};RoomUI.prototype.openRaise.call(ui,'turn',()=>{});assert.deepEqual(focus,['close']);assert.equal(ui.raiseDialog.open,true);}finally{globalThis.document=previous;}
});
