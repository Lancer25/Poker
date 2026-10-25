import test from 'node:test';import assert from 'node:assert/strict';import {spawn} from 'node:child_process';import {mkdtempSync,readFileSync,writeFileSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import path from 'node:path';import {once} from 'node:events';import {setTimeout as delay} from 'node:timers/promises';import { WebSocket } from "./protocol-peer.js";
import {createRoom,joinRoom} from '../server/game.js';import {seedAccounts,testPassword} from './auth-helpers.js';
test('public RTT uses real pong, lightweight updates, multi-tab worst value and offline presence without saving game state',{timeout:15000},async t=>{
 const dir=mkdtempSync(path.join(tmpdir(),'holdem-public-rtt-'));const {store,admin,invite}=await seedAccounts(dir),auth=[store.startSession(admin.id)];
 for(let i=1;i<3;i++)auth.push(await store.register({username:'rtt_'+i,nickname:'P'+i,password:testPassword,inviteCode:invite.code}));
 const r=createRoom('H').room;joinRoom(r,'P1');joinRoom(r,'P2');r.players.forEach((p,i)=>p.accountId=auth[i].user.id);writeFileSync(dir+'/rooms.json',JSON.stringify({rooms:[r],sessions:[]}));
 const child=spawn(process.execPath,['server/index.js'],{env:{...process.env,PORT:'0',DATA_DIR:dir,ROOM_HEARTBEAT_INTERVAL_MS:'100',ROOM_HEARTBEAT_TIMEOUT_MS:'3000',PLAYER_LATENCY_PUBLISH_MS:'50'},stdio:['ignore','pipe','pipe']}),peers=[];
 t.after(async()=>{for(const p of peers)p.ws.terminate();if(child.exitCode===null){const done=once(child,'exit');child.kill();await done;}assert.equal(path.dirname(dir),path.resolve(tmpdir()));rmSync(dir,{recursive:true,force:true});});
 const port=Number((await once(child.stdout,'data'))[0].toString().match(/localhost:(\d+)/)[1]);
 async function until(check){const end=Date.now()+5000;while(!check()){if(Date.now()>end)throw Error('Public RTT network timeout');await delay(5);}}
 async function client(index,lag){const ws=new WebSocket('ws://127.0.0.1:'+port,{autoPong:false}),p={ws,state:null,states:0,connections:new Map(),queue:[],send(type,data={}){ws.send(JSON.stringify({type,...data}));}};peers.push(p);
  ws.on('ping',data=>{const timer=setTimeout(()=>{if(ws.readyState===1)ws.pong(data);},lag);timer.unref();});
  ws.on('message',raw=>{const m=JSON.parse(raw);if(m.type==='state'){p.state=m.room;p.states++;for(const x of m.room.players)p.connections.set(x.id,x.connection);}else if(m.type==='player_latency'){assert.equal(m.room,r.id);assert.equal(m.history,undefined);assert.ok(raw.length<1500);for(const x of m.players)p.connections.set(x.id,x.connection);}else p.queue.push(m);});
  await once(ws,'open');p.send('authenticate',{token:auth[index].token,compactState:true});await until(()=>p.queue.some(m=>m.type==='account'));p.send('resume',{room:r.id});await until(()=>p.state);return p;
 }
 const a=await client(0,20),b=await client(1,270),c=await client(2,650);const before=readFileSync(dir+'/rooms.json','utf8');
 await until(()=>[a,b,c].every(p=>p.connections.get(r.players[2].id)?.rttMs>=650));assert.ok(a.connections.get(r.players[1].id).rttMs>=270);
 const states=a.states;c.send('telemetry',{rttMs:0,renderMs:0});await delay(250);assert.equal(a.states,states);assert.ok(a.connections.get(r.players[2].id).rttMs>=650);assert.equal(readFileSync(dir+'/rooms.json','utf8'),before);
 const slow=await client(0,900);await until(()=>a.connections.get(r.host)?.rttMs>=900);slow.ws.terminate();await until(()=>a.state.players.find(p=>p.id===r.host).connection.rttMs<900);
 c.ws.terminate();await until(()=>a.state.players.find(p=>p.id===r.players[2].id).connection.online===false);
 for(const state of ['good','warning','bad','muted']){const asset=await fetch('http://127.0.0.1:'+port+'/assets/icons/signal-'+state+'.svg');assert.equal(asset.status,200);assert.match(await asset.text(),/lucide-static/);}
});
