import test from 'node:test';
import assert from 'node:assert/strict';
import {viewingMode} from '../public/room-ui.js';

const room=()=>({me:'a',phase:'flop',tournament:{started:true},players:[{id:'a',inHand:true,stack:100,folded:false}]});
test('god-mode observers and true spectators have explicit viewing layouts',()=>{
 const r=room();r.godMode=true;assert.equal(viewingMode(r),'god');r.spectating=true;assert.equal(viewingMode(r),'spectator');assert.equal(viewingMode({...r,players:[]}), 'spectator');
});
test('elimination only removes the ordinary dock once the player has no dealt hand',()=>{
 const r=room();r.players[0].eliminated=true;r.players[0].stack=0;r.phase='showdown';assert.equal(viewingMode(r),null);
 r.players[0].inHand=false;assert.equal(viewingMode(r),'eliminated');
});
test('regular, folded, waiting and zero-stack all-in players retain their normal private-hand layout',()=>{
 const r=room();assert.equal(viewingMode(r),null);r.players[0].folded=true;assert.equal(viewingMode(r),null);r.players[0].stack=0;assert.equal(viewingMode(r),null);
 assert.equal(viewingMode({...r,phase:'waiting',players:[{id:'a',inHand:false,stack:100}]}),null);assert.equal(viewingMode(null),null);
});
