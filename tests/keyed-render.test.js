import test from 'node:test';import assert from 'node:assert/strict';import {seatRenderKey,reconcileChildren} from '../public/keyed-render.js';
test('seat fingerprints ignore transport clocks but include visible amounts, actor and hole-card visibility',()=>{
 const p={id:'a',name:'A',stack:1000,cards:['??','??']},r={me:'a',players:[p],turn:0,deadline:1000,phase:'preflop'};
 const key=seatRenderKey(p,r,0,[]);assert.equal(seatRenderKey({...p,connection:{rttMs:500}}, {...r,serverTime:2000},0,[]),key);
 assert.notEqual(seatRenderKey({...p,stack:995},r,0,[]),key);assert.notEqual(seatRenderKey({...p,cards:['As','Ad']},r,0,[]),key);
 assert.notEqual(seatRenderKey(p,{...r,turn:1},0,[]),key);
});
test('unchanged nodes are not detached; only additions, moves and removals touch the tree',()=>{
 const a={},b={},c={},parent={children:[a,b],writes:0,insertBefore(node,before){this.writes++;const old=this.children.indexOf(node);if(old>=0)this.children.splice(old,1);const i=before?this.children.indexOf(before):this.children.length;this.children.splice(i,0,node);},removeChild(node){this.writes++;this.children.splice(this.children.indexOf(node),1);}};
 reconcileChildren(parent,[a,b]);assert.equal(parent.writes,0);reconcileChildren(parent,[b,c]);assert.deepEqual(parent.children,[b,c]);
});
