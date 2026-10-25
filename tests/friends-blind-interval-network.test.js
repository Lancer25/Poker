import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {once} from 'node:events';
import {setTimeout as delay} from 'node:timers/promises';
import { WebSocket } from "./protocol-peer.js";
import {seedAccounts} from './auth-helpers.js';
test('WS validates creation interval and persists it across server restart and resume',{timeout:15000},async t=>{
 const dir=mkdtempSync(path.join(tmpdir(),'holdem-blind-interval-'));
 const {store,admin}=await seedAccounts(dir),auth=store.startSession(admin.id);
 let child,port,ws;const messages=[];
 async function boot(){child=spawn(process.execPath,['server/index.js'],{env:{...process.env,PORT:'0',DATA_DIR:dir},stdio:['ignore','pipe','pipe']});port=Number((await once(child.stdout,'data'))[0].toString().match(/localhost:(\d+)/)[1]);}
 async function stop(){ws?.terminate();if(child?.exitCode===null){const done=once(child,'exit');child.kill();await done;}}
 t.after(async()=>{await stop();assert.equal(path.dirname(dir),path.resolve(tmpdir()));rmSync(dir,{recursive:true,force:true});});
 async function until(check){const end=Date.now()+5000;while(!check()){if(Date.now()>end)throw Error('Blind interval network timeout');await delay(5);}}
 async function connect(){messages.length=0;ws=new WebSocket('ws://127.0.0.1:'+port);ws.on('message',raw=>messages.push(JSON.parse(raw)));await once(ws,'open');ws.send(JSON.stringify({type:'authenticate',token:auth.token,compactState:true}));await until(()=>messages.some(m=>m.type==='account'));}
 await boot();await connect();
 for(const blindMinutes of [0,31,2.5,'7',null]){
  messages.length=0;ws.send(JSON.stringify({type:'create',gameMode:'friends',blindMinutes}));await until(()=>messages.some(m=>m.type==='error'));assert.ok(!messages.some(m=>m.type==='state'));
 }
 messages.length=0;ws.send(JSON.stringify({type:'create',gameMode:'friends',chips:20000,small:1000,big:2000,blindMinutes:7}));await until(()=>messages.some(m=>m.type==='state'));
 const r=messages.find(m=>m.type==='state').room;assert.equal(r.tournament.levelDurationSeconds,420);
 assert.deepEqual(r.tournament.blindCaps,{earlySmall:1000,earlyBig:2000,small:2000,big:4000});
 await stop();const persisted=JSON.parse(readFileSync(dir+'/rooms.json'));assert.equal(persisted.rooms.length,1);assert.equal(persisted.rooms[0].tournament.levelDurationMs,420000);
 await boot();await connect();ws.send(JSON.stringify({type:'resume',room:r.id}));await until(()=>messages.some(m=>m.type==='state'));
 assert.equal(messages.find(m=>m.type==='state').room.tournament.levelDurationSeconds,420);
});
