import test from 'node:test';
import assert from 'node:assert/strict';
import {createRoom,joinRoom,command,startHand} from '../server/game.js';
import * as protocol from '../server/action-protocol.js';

function table(){const {room}=createRoom('host');joinRoom(room,'peer');startHand(room,room.host);return room;}
test('action context binds a request to the current decision and rejects missing or stale decisions',()=>{
 const r=table(),id=r.players[r.turn].id,context=protocol.actionContext(r,id);
 assert.ok(context);assert.equal(protocol.actionContext(r,r.players.find(p=>p.id!==id).id),null);
 const msg={type:'raise',amount:40,requestId:'test-request-1',decision:context};
 assert.equal(protocol.validateAction(r,id,msg),null);
 assert.throws(()=>protocol.validateAction(r,id,{...msg,decision:null}),/刷新|过期/);
 command(r,id,'raise',msg);assert.throws(()=>protocol.validateAction(r,id,msg),/过期/);
});
test('persisted receipts acknowledge duplicates exactly once and reject request-ID reuse with altered contents',()=>{
 const r=table(),id=r.players[r.turn].id,msg={type:'raise',amount:40,requestId:'test-request-2',decision:protocol.actionContext(r,id)};
 protocol.validateAction(r,id,msg);command(r,id,'raise',msg);protocol.recordActionReceipt(r,id,msg);
 const restored=JSON.parse(JSON.stringify(r)),before=JSON.stringify(restored);
 const receipt=protocol.validateAction(restored,id,msg);assert.equal(receipt.status,'already_applied');assert.equal(JSON.stringify(restored),before);
 assert.throws(()=>protocol.validateAction(restored,id,{...msg,amount:45}),/重复|不一致/);
});
test('an old hand cannot act when the same player becomes the actor again',()=>{
 const r=table(),id=r.players[r.turn].id,msg={type:'raise',amount:40,requestId:'test-delayed-1',decision:protocol.actionContext(r,id)};
 for(let i=0;i<2;i++){command(r,r.players[r.turn].id,'fold');startHand(r,r.host);}
 assert.equal(r.players[r.turn].id,id);assert.throws(()=>protocol.validateAction(r,id,msg),/过期/);assert.equal(r.currentBet,10);
});
