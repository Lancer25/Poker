import {startHand} from './game-helpers.js';
import test from "node:test";
import assert from "node:assert/strict";
import {completeFlop} from './game-helpers.js';
import {createRoom,joinRoom,command,snapshot} from '../server/game.js';
import {initializeControls} from '../server/room-controls.js';
import {addSpectator} from '../server/spectators.js';

test('eliminated friend players can opt into god mode under public-only spectator policy',()=>{
  const {room}=createRoom('Host',10000,10,20,30,'friends');
  const guest=joinRoom(room,'Guest'),eliminated=joinRoom(room,'Eliminated');
  initializeControls(room);
  eliminated.stack=0;eliminated.eliminated=true;
  startHand(room,room.host);
  assert.equal(snapshot(room,eliminated.id).canGodMode,true);
  command(room,eliminated.id,'godmode',{enabled:true});
  const view=snapshot(room,eliminated.id);
  assert.equal(view.godMode,true);
  assert.deepEqual(view.players.find(p=>p.id===guest.id).cards,guest.cards);
  assert.deepEqual(snapshot(room,room.host).players.find(p=>p.id===guest.id).cards,['??','??']);
  const spectator=addSpectator(room,{id:'outside',nickname:'Outside'});
  const watching=snapshot(room,spectator.id);
  assert.equal(watching.godMode,false);
  assert.ok(watching.players.every(p=>p.cards.every(c=>c==='??')));
  const recovered=JSON.parse(JSON.stringify(room));
  assert.equal(snapshot(recovered,eliminated.id).godMode,true);
  command(room,eliminated.id,'godmode',{enabled:false});
  assert.equal(snapshot(room,eliminated.id).godMode,false);
  assert.deepEqual(snapshot(room,eliminated.id).players.find(p=>p.id===guest.id).cards,['??','??']);
  command(room,eliminated.id,'godmode',{enabled:true});
  command(room,eliminated.id,'rebuy',{amount:room.initial});
  const request=room.requests[0];
  for(const voter of request.voters)command(room,voter,'approve',{request:request.id});
  assert.equal(snapshot(room,eliminated.id).canGodMode,false);
  assert.equal(snapshot(room,eliminated.id).godMode,false);
  assert.throws(()=>command(room,eliminated.id,'godmode',{enabled:true}));
});

test('controlled friend room still rejects in-hand all-ins, funded players and removed seats',()=>{
  const {room}=createRoom('Host',10000,10,20,30,'friends');joinRoom(room,'Guest');initializeControls(room);startHand(room,room.host);
  const actor=room.players[room.turn];command(room,actor.id,'allin');
  assert.equal(snapshot(room,actor.id).canGodMode,false);
  assert.throws(()=>command(room,actor.id,'godmode',{enabled:true}));
  const other=room.players.find(p=>p.id!==actor.id);
  assert.throws(()=>command(room,other.id,'godmode',{enabled:true}));
  actor.inHand=false;actor.eliminated=true;actor.removed=true;
  assert.throws(()=>command(room,actor.id,'godmode',{enabled:true}));
});
function table() {
  const { room, player: host } = createRoom("Host");
  const guest = joinRoom(room, "Guest");
  const observer = joinRoom(room, "Observer");
  observer.stack = 0;
  return { room, host, guest, observer };
}
function finish(room) {
  let steps = 0;
  while (room.phase !== "showdown") {
    if(completeFlop(room))continue;
    assert.ok(steps++ < 50);
    const p = room.players[room.turn];
    command(room, p.id, p.bet < room.currentBet ? "call" : "check");
  }
}
test("zero-stack observer opts in, sees only dealt cards; ordinary players remain private", () => {
  const { room, host, guest, observer } = table();
  assert.throws(() => command(room, host.id, "godmode", { enabled: true }));
  assert.throws(() =>
    command(room, observer.id, "godmode", { enabled: "true" }),
  );
  command(room, observer.id, "godmode", { enabled: true });
  startHand(room, host.id);
  const view = snapshot(room, observer.id);
  assert.equal(view.godMode, true);
  assert.deepEqual(view.players[0].cards, host.cards);
  assert.deepEqual(view.players[1].cards, guest.cards);
  assert.deepEqual(view.board, []);
  assert.equal(view.deck, undefined);
  assert.deepEqual(snapshot(room, host.id).players[1].cards, ["??", "??"]);
  assert.equal(snapshot(room, host.id).players[2].godMode, true);
  for (const type of ["call", "check", "fold", "raise", "allin"])
    assert.throws(() => command(room, observer.id, type, { amount: 100 }));
  command(room, observer.id, "godmode", { enabled: false });
  assert.deepEqual(snapshot(room, observer.id).players[0].cards, ["??", "??"]);
});
test("zero chips from all-in never grants visibility until the hand finishes", () => {
  const { room, host, observer } = table();
  observer.stack = 1000;
  startHand(room, host.id);
  const allin = room.players[room.turn];
  command(room, allin.id, "allin");
  assert.equal(allin.stack, 0);
  assert.throws(() => command(room, allin.id, "godmode", { enabled: true }));
  allin.godMode = true;
  const view = snapshot(room, allin.id);
  assert.equal(view.canGodMode, false);
  assert.equal(view.godMode, false);
  assert.ok(
    view.players
      .filter((p) => p.id !== allin.id)
      .every((p) => p.cards.every((c) => c === "??")),
  );
});
test("queued rebuy cancels god mode at settlement and restores ordinary next-hand privacy", () => {
  const { room, host, observer } = table();
  command(room, observer.id, "godmode", { enabled: true });
  startHand(room, host.id);
  command(room, observer.id, "rebuy", { amount: 100 });
  command(room, host.id, "approve", { request: room.requests[0].id });
  assert.equal(snapshot(room, observer.id).godMode, true);
  finish(room);
  assert.equal(observer.stack, 100);
  assert.equal(observer.godMode, false);
  startHand(room, host.id);
  assert.equal(observer.inHand, true);
  assert.equal(observer.cards.length, 2);
  assert.deepEqual(snapshot(room, observer.id).players[0].cards, ["??", "??"]);
  assert.throws(() => command(room, observer.id, "godmode", { enabled: true }));
});
test("mode survives JSON recovery; immediate rebuy and ended room revoke visibility", () => {
  const { room, host, observer } = table();
  command(room, observer.id, "godmode", { enabled: true });
  const recovered = JSON.parse(JSON.stringify(room));
  startHand(recovered, host.id);
  assert.equal(snapshot(recovered, observer.id).godMode, true);
  command(room, observer.id, "rebuy", { amount: 100 });
  command(room, host.id, "approve", { request: room.requests[0].id });
  assert.equal(snapshot(room, observer.id).godMode, false);
  observer.stack = 0;
  command(room, observer.id, "godmode", { enabled: true });
  command(room, host.id, "end");
  assert.equal(snapshot(room, observer.id).godMode, false);
  assert.throws(() => command(room, observer.id, "godmode", { enabled: true }));
});
