import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {once} from 'node:events';
import {setTimeout as delay} from 'node:timers/promises';
import { WebSocket } from "./protocol-peer.js";
import {createRoom,joinRoom} from '../server/game.js';
import {startHand} from './game-helpers.js';
import {seedAccounts,testPassword,apiAt} from './auth-helpers.js';

test('manual reveal is server-authorized, public and persisted over websocket/HTTP including spectators',{timeout:15000},async t=>{
 const dir=mkdtempSync(path.join(tmpdir(),'holdem-manual-reveal-'));
 const {store,admin,invite}=await seedAccounts(dir),auth=[store.startSession(admin.id)];
 for(let i=1;i<3;i++)auth.push(await store.register({username:'manual_'+i,nickname:'Player'+i,password:testPassword,inviteCode:invite.code}));
 const r=createRoom('Host',undefined,undefined,undefined,300,'friends').room;
 joinRoom(r,'Guest');r.players.forEach((p,i)=>p.accountId=auth[i].user.id);startHand(r,r.host);
 writeFileSync(path.join(dir,'rooms.json'),JSON.stringify({rooms:[r],sessions:[]}));
 const child=spawn(process.execPath,['server/index.js'],{env:{...process.env,PORT:'0',DATA_DIR:dir},stdio:['ignore','pipe','pipe']}),peers=[];
 t.after(async()=>{for(const p of peers)p.ws.terminate();if(child.exitCode===null){const done=once(child,'exit');child.kill();await done;}assert.equal(path.dirname(dir),path.resolve(tmpdir()));rmSync(dir,{recursive:true,force:true});});
 const port=Number((await once(child.stdout,'data'))[0].toString().match(/localhost:(\d+)/)[1]);
 async function until(check){const end=Date.now()+5000;while(!check()){if(Date.now()>end)throw Error('Manual reveal network timeout');await delay(5);}}
 async function client(index){const ws=new WebSocket('ws://127.0.0.1:'+port),peer={ws,state:null,queue:[],send(type,data={}){ws.send(JSON.stringify({type,...data}));}};peers.push(peer);ws.on('message',raw=>{const message=JSON.parse(raw);if(message.type==='state')peer.state=message.room;else peer.queue.push(message);});await once(ws,'open');peer.send('authenticate',{token:auth[index].token,compactState:true});await until(()=>peer.queue.some(m=>m.type==='account'));peer.send(index===2?'watch':'resume',{room:r.id});await until(()=>peer.state);return peer;}
 const host=await client(0),guest=await client(1),observer=await client(2);
 const actor=peers.find(peer=>peer.state.me===host.state.players[host.state.turn].id);
 actor.send('showcards',{round:1,hand:1});await until(()=>actor.queue.some(m=>m.type==='error'));assert.equal(host.state.phase,'preflop');
 actor.send('fold');await until(()=>peers.every(peer=>peer.state.phase==='showdown'));
 const own=actor.state.players.find(player=>player.id===actor.state.me),viewer=actor===host?guest:host;
 assert.deepEqual(viewer.state.players.find(player=>player.id===own.id).cards,['??','??']);
 const version=viewer.state.historyVersion;
 observer.send('showcards',{round:1,hand:1,player:own.id});await until(()=>observer.queue.some(m=>m.type==='error'));
 actor.send('showcards',{round:1,hand:1,cards:['As','Ad'],player:viewer.state.me});await until(()=>peers.every(peer=>peer.state.historyVersion!==version));
 for(const peer of [viewer,observer])assert.deepEqual(peer.state.players.find(player=>player.id===own.id).cards,own.cards);
 const history=await apiAt(port,'/api/rooms/'+r.id+'/history','GET',undefined,auth[2].token);
 assert.equal(history.status,200);assert.deepEqual(history.data.hands[0].shownPlayers[0].cards,own.cards);assert.equal(history.data.hands[0].shownWinners.length,0);
 assert.ok(!JSON.stringify(history.data).includes('"deck"'));assert.ok(history.data.hands[0].results.every(player=>!Object.hasOwn(player,'cards')));
 const adminHistory=await apiAt(port,'/api/admin/rooms/'+r.id+'/history','GET',undefined,auth[0].token);assert.deepEqual(adminHistory.data.rounds[0].history[0].shownPlayers[0].cards,own.cards);
 const saved=JSON.parse(readFileSync(path.join(dir,'rooms.json'))).rooms[0];assert.equal(saved.history[0].shownPlayers.length,1);assert.equal(saved.historyRevision,1);
});
