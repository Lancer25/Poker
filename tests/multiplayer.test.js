import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { tmpdir } from "node:os";
import path from "node:path";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import { WebSocket } from "./protocol-peer.js";
import { seedAccounts, registerAt, apiAt } from "./auth-helpers.js";
import {createRoom,joinRoom} from '../server/game.js';
import {createRoomStore} from '../server/room-store.js';

const loadProfile=process.env.POKER_LOAD_PROFILE;
const loadStorage=process.env.POKER_LOAD_STORAGE||'json';
assert.ok(!loadProfile||['baseline','history'].includes(loadProfile),'POKER_LOAD_PROFILE must be baseline or history');
assert.ok(!loadProfile||['json','sqlite'].includes(loadStorage),'POKER_LOAD_STORAGE must be json or sqlite');
const betting=new Set(['fold','check','call','raise','allin']);

function seedHistory(directory) {
  const rooms=Array.from({length:100},(_,i)=>{
    const {room}=createRoom('Fixture');room.id=String(800000+i);
    for(let j=1;j<9;j++)joinRoom(room,'Fixture '+j);
    room.phase='ended';room.finishedAt=Date.now();
    const results=room.players.map(p=>({id:p.id,name:p.name,stack:p.stack,buyin:p.buyin,net:0}));
    const history=Array.from({length:20},(_,j)=>({hand:j+1,board:['2s','3s','4s','5s','6s'],pots:[],results}));
    room.hand=20;room.roundNumber=3;room.history=history;
    room.completedRounds=[1,2].map(number=>({number,hand:20,history,results}));
    return room;
  });
  const storage=createRoomStore(directory,{mode:loadStorage});
  try{storage.save({rooms,sessions:[]});}finally{storage.close();}
}

async function harness(t) {
  const directory = mkdtempSync(path.join(tmpdir(), "holdem-multiplayer-"));
  const sockets = new Set();
  const { invite,admin,store } = await seedAccounts(directory);
  const adminToken=loadProfile?store.startSession(admin.id).token:null;
  const samples=[];
  if(loadProfile==='history')seedHistory(directory);
  let counter = 0;
  const server = spawn(process.execPath, ["server/index.js"], {
    env: { ...process.env, HOST:'127.0.0.1', PORT: "0", DATA_DIR: directory, ...(loadProfile?{ROOM_STORAGE:loadStorage,BACKUP_INTERVAL_MS:'0'}:{}) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  t.after(async () => {
    for (const socket of sockets) socket.terminate();
    if (server.exitCode === null) {
      const stopped = once(server, "exit");
      server.kill();
      await stopped;
    }
    assert.equal(path.dirname(path.resolve(directory)), path.resolve(tmpdir()));
    assert.ok(path.basename(directory).startsWith("holdem-multiplayer-"));
    rmSync(directory, { recursive: true, force: true });
  });
  const [output] = await once(server.stdout, "data");
  server.stdout.resume();
  const port = Number(output.toString().match(/localhost:(\d+)/)[1]);
  async function client(authToken) {
    if (!authToken) {
      const number = ++counter;
      authToken = (
        await registerAt(
          port,
          invite.code,
          `player_${number}`,
          `Player${number}`,
        )
      ).token;
    }
    const socket = new WebSocket(`ws://127.0.0.1:${port}`);
    sockets.add(socket);
    const queue = [],
      waiting = [];
    const result = { socket, authToken, state: null, messages: 0, sent: [] };
    socket.on("message", (raw) => {
      const message = JSON.parse(raw);
      result.messages++;
      if (message.type === "state") result.state = message.room;
      const index = waiting.findIndex((w) => w.type === message.type);
      if (index < 0) queue.push(message);
      else waiting.splice(index, 1)[0].resolve(message);
    });
    await once(socket, "open");
    result.send = async (type, data = {}) => {
      result.sent = result.sent.filter((time) => Date.now() - time < 1000);
      if (result.sent.length >= 15)
        await delay(1005 - (Date.now() - result.sent[0]));
      result.sent.push(Date.now());
      result.sentAt=performance.now();
      socket.send(JSON.stringify({ type, ...data }));
    };
    result.take = (type, timeout = 5000) => {
      const index = queue.findIndex((m) => m.type === type);
      if (index >= 0) return Promise.resolve(queue.splice(index, 1)[0]);
      return new Promise((resolve, reject) => {
        const entry = {
          type,
          resolve: (value) => {
            clearTimeout(timer);
            resolve(value);
          },
        };
        const timer = setTimeout(() => {
          const i = waiting.indexOf(entry);
          if (i >= 0) waiting.splice(i, 1);
          reject(
            Error(
              `Timed out waiting for ${type}; queued: ${JSON.stringify(queue.filter((m) => m.type === "error"))}`,
            ),
          );
        }, timeout);
        waiting.push(entry);
      });
    };
    result.clear = () => {
      queue.length = 0;
    };
    await result.send("authenticate", { token: authToken, compactState:!!loadProfile });
    await result.take("account");
    return result;
  }
  async function room(count) {
    const host = await client();
    await host.send("create", { name: "Host", chips: 1000, small: 5, big: 10 });
    host.token = (await host.take("session")).token;
    const id = (await host.take("state")).room.id;
    const players = [host];
    // Join concurrently, like friends opening the invitation at the same time.
    const guests = await Promise.all(
      Array.from({ length: count - 1 }, async (_, index) => {
        const guest = await client();
        await guest.send("join", { room: id, name: `Friend${index + 1}` });
        guest.token = (await guest.take("session")).token;
        await guest.take("state");
        return guest;
      }),
    );
    players.push(...guests);
    await delay(30);
    for (const p of players) {
      assert.equal(p.state.players.length, count);
      p.clear();
    }
    return { id, players, host };
  }
  async function step(group, player, type, data = {}) {
    group.players.forEach((p) => p.clear());
    await player.send(type, data);
    const states = await Promise.all(group.players.map((p) => p.take("state")));
    if(loadProfile&&betting.has(type))samples.push(performance.now()-player.sentAt);
    const common = (s) => ({
      id: s.id,
      phase: s.phase,
      hand: s.hand,
      turn: s.turn,
      board: s.board,
      pot: s.pot,
      results: s.results,
      pots: s.pots,
      history: s.history,
      players: s.players.map(({ cards, ...p }) => p),
    });
    for (const message of states)
      assert.deepEqual(common(message.room), common(states[0].room));
    return states[0].room;
  }
  async function profile(count){
    if(!loadProfile)return;
    const {status,data}=await apiAt(port,'/api/admin/diagnostics','GET',undefined,adminToken);
    assert.equal(status,200);
    assert.equal(data.storage.mode,loadStorage);
    const s=[...samples].sort((a,b)=>a-b),p95=Number(s[Math.ceil(s.length*.95)-1].toFixed(2));
    const current=data.latency.current;
    t.diagnostic(JSON.stringify({profile:loadProfile,storage:loadStorage,players:count,samples:s.length,allPeersReceiveP95Ms:p95,rooms:data.rooms.total,storedBytes:data.storage.bytes,walBytes:data.storage.walBytes,save:current.saveMs,snapshot:current.snapshotMs,sendQueue:current.queueMs,stateBytes:current.stateBytes}));
  }
  return { client, room, step, profile };
}

for (const count of [7, 9])
  test(
    `${count} real players: 12 hands, raises, folds, all-ins, rebuy and identical broadcasts`,
    { timeout: 60000 },
    async (t) => {
      const h = await harness(t),
        group = await h.room(count);
      let actions = 0,
        broadcasts = 0;
      for (let hand = 0; hand < 12; hand++) {
        // Unequal buy-ins produce real side pots when all players push all-in.
        for (let i = 0; i < group.players.length; i++) {
          const player = group.players[i];
          const mine = player.state.players.find(
            (p) => p.id === player.state.me,
          );
          if (mine.stack < 100 || hand === 3) {
            const state = await h.step(group, player, "rebuy", {
              amount: 500 + i * 50,
            });
            const request = state.requests.find(
              (r) => r.player === player.state.me,
            );
            await h.step(group, group.host, "approve", { request: request.id });
          }
        }
        let state = await h.step(group, group.host, "start");
        const privateCards = group.players.flatMap(
          (p) => p.state.players.find((s) => s.id === p.state.me).cards,
        );
        assert.equal(new Set(privateCards).size, privateCards.length);
        for (const p of group.players)
          for (const seat of p.state.players)
            if (seat.id !== p.state.me)
              assert.deepEqual(seat.cards, ["??", "??"]);
        let turns = 0;
        while (state.phase !== "showdown") {
          if(state.flopReveal){
            while(group.players.some(p=>p.state.flopReveal))await delay(10);
            state=group.host.state;continue;
          }
          assert.ok(turns++ < 150, "betting must make progress");
          const actor = group.players.find(
            (p) => p.state.me === state.players[state.turn].id,
          );
          const own = actor.state.players.find((p) => p.id === actor.state.me);
          let type = actor.state.toCall ? "call" : "check",
            data = {};
          if (hand === 3)
            type =
              actor.state.canRaise || own.bet + own.stack <= state.currentBet
                ? "allin"
                : "call";
          else if (hand % 3 === 1 && state.phase === "preflop" && turns <= 2)
            type = "fold";
          else if (hand % 3 === 2 && turns === 1 && actor.state.canRaise) {
            type = "raise";
            data.amount = state.currentBet + state.minRaise;
          }
          state = await h.step(group, actor, type, data);
          actions++;
          broadcasts += count;
          if (state.phase !== "showdown") {
            assert.equal(
              state.players.reduce((sum, p) => sum + p.stack, 0) + state.pot,
              state.results.reduce((sum, p) => sum + p.buyin, 0),
            );
            assert.equal(
              new Set([...privateCards, ...state.board]).size,
              privateCards.length + state.board.length,
            );
          }
        }
        assert.equal(
          state.players.reduce((sum, p) => sum + p.stack, 0),
          state.results.reduce((sum, p) => sum + p.buyin, 0),
        );
        assert.equal(
          state.results.reduce((sum, p) => sum + p.net, 0),
          0,
        );
        assert.equal(loadProfile?state.historyCount:state.history.length, hand + 1);
      }
      const ended = await h.step(group, group.host, "end");
      assert.equal(ended.phase, "ended");
      await h.profile(count);
      t.diagnostic(
        `${count} players; 12 settled hands; ${actions} betting actions; ${broadcasts} action broadcasts checked`,
      );
    },
  );

test(
  "nine-seat capacity, mid-hand reconnect, permissions and room isolation",
  { timeout: 20000 },
  async (t) => {
    const h = await harness(t),
      group = await h.room(9),
      other = await h.room(2);
    const outsider = await h.client();
    await outsider.send("join", { room: group.id, name: "Tenth" });
    assert.match((await outsider.take("error")).message, /已满/);
    await group.players[1].send("start");
    assert.match((await group.players[1].take("error")).message, /房主/);
    const oldOther = structuredClone(other.host.state);
    let state = await h.step(group, group.host, "start");
    assert.deepEqual(other.host.state, oldOther);
    const index = group.players.findIndex(
      (p) => p.state.me === state.players[state.turn].id,
    );
    const disconnected = group.players[index];
    const identity = disconnected.state.me,
      cards = disconnected.state.players.find((p) => p.id === identity).cards;
    disconnected.socket.terminate();
    const replacement = await h.client(disconnected.authToken);
    group.players[index] = replacement;
    await replacement.send("resume", { token: disconnected.token });
    state = (await replacement.take("state")).room;
    assert.equal(state.me, identity);
    assert.equal(state.players.length, 9);
    assert.deepEqual(state.players.find((p) => p.id === identity).cards, cards);
    group.players.forEach((p) => p.clear());
    await h.step(group, replacement, state.toCall ? "call" : "check");
    assert.deepEqual(other.host.state, oldOther);
    const invalid = await h.client();
    await invalid.send("resume", { token: "invalid" });
    assert.match((await invalid.take("error")).message, /失效/);
    const unauthorized = group.players.find(
      (p) => p.state.me !== p.state.players[p.state.turn].id,
    );
    const before = structuredClone(group.host.state);
    await unauthorized.send("raise", { amount: 100 });
    assert.match((await unauthorized.take("error")).message, /轮到/);
    assert.deepEqual(group.host.state, before);
  },
);

test(
  "disconnected acting player automatically folds after real 60-second deadline",
  { timeout: 70000 },
  async (t) => {
    const h = await harness(t),
      group = await h.room(7);
    const state = await h.step(group, group.host, "start");
    const index = group.players.findIndex(
      (p) => p.state.me === state.players[state.turn].id,
    );
    const disconnected = group.players[index];
    assert.ok(disconnected.state.toCall > 0);
    disconnected.socket.terminate();
    group.players.splice(index, 1);
    group.players.forEach((p) => p.clear());
    const updated = await Promise.all(
      group.players.map(async (p) => {
        const limit = Date.now() + 65000;
        while (Date.now() < limit) {
          const message = await p.take(
            "state",
            Math.max(1, limit - Date.now()),
          );
          if (message.room.players[state.turn].folded) return message;
          assert.equal(message.room.deadline, state.deadline);
          assert.equal(message.room.turn, state.turn);
          assert.equal(message.room.onlineCount, 6);
        }
        throw Error(
          "Expected the real action deadline to fold the offline player",
        );
      }),
    );
    for (const { room } of updated) {
      assert.equal(room.players[state.turn].folded, true);
      assert.notEqual(room.turn, state.turn);
      assert.equal(room.players.length, 7);
    }
    t.diagnostic(
      "Actual server timeout waited; six connected players received the same fold transition",
    );
  },
);
