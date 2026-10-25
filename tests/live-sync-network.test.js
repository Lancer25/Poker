import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {once} from 'node:events';
import {setTimeout as delay} from 'node:timers/promises';
import { WebSocket } from "./protocol-peer.js";
import {createRoom,joinRoom} from '../server/game.js';
import {seedAccounts,testPassword,apiAt} from './auth-helpers.js';
for(const count of [7,9])test(`${count} compact peers with 400 historical hands: bounded states, private cards, lazy readonly pages and legacy compatibility`,{timeout:20000},async t=>{
 const dir=mkdtempSync(path.join(tmpdir(),'holdem-compact-'));
 const {store,admin,invite}=await seedAccounts(dir);
 const auth=[store.startSession(admin.id)];
 for(let i=1;i<=count;i++)auth.push(await store.register({username:'compact_'+i,nickname:'P'+i,password:testPassword,inviteCode:invite.code}));
 const {room}=createRoom('Host',1000);
 for(let i=1;i<count;i++)joinRoom(room,'P'+i);
 room.players.forEach((p,i)=>p.accountId=auth[i].user.id);
 const results=room.players.map(p=>({id:p.id,name:p.name,buyin:1000,stack:1000,net:0}));
 room.history=Array.from({length:200},(_,i)=>({hand:i+1,board:['2h','3d','4s'],pots:[{amount:10,winners:['Host'],winnerIds:[room.host]}],results,deck:['secret'],accountId:'secret'}));
 room.completedRounds=[{number:1,hand:200,history:structuredClone(room.history),results}];room.roundNumber=2;room.hand=200;
 writeFileSync(dir+'/rooms.json',JSON.stringify({rooms:[room],sessions:[]}));
 const child=spawn(process.execPath,['server/index.js'],{env:{...process.env,PORT:'0',DATA_DIR:dir},stdio:['ignore','pipe','pipe']});
 const peers=[];t.after(async()=>{for(const p of peers)p.ws.terminate();if(child.exitCode===null){const done=once(child,'exit');child.kill();await done;}assert.equal(path.dirname(dir),path.resolve(tmpdir()));rmSync(dir,{recursive:true,force:true});});
 const port=Number((await once(child.stdout,'data'))[0].toString().match(/localhost:(\d+)/)[1]);
 async function until(check){const end=Date.now()+7000;while(!check()){if(Date.now()>end)throw Error('Compact state timeout');await delay(5);}}
 for(let i=0;i<count;i++){
  const ws=new WebSocket('ws://127.0.0.1:'+port),p={ws,state:null,bytes:0,queue:[],send(type,data={}){ws.send(JSON.stringify({type,...data}));},async take(type){await until(()=>this.queue.some(m=>m.type===type));return this.queue.splice(this.queue.findIndex(m=>m.type===type),1)[0];}};
  peers.push(p);ws.on('message',raw=>{const m=JSON.parse(raw);if(m.type==='state'){p.state=m.room;p.bytes=raw.length;}else p.queue.push(m);});
  await once(ws,'open');p.send('authenticate',{token:auth[i].token,compactState:i!==count-1});await p.take('account');p.send('resume',{room:room.id});await until(()=>p.state);
 }
 for(const p of peers.slice(0,-1)){assert.ok(p.bytes<10000);assert.equal(p.state.history,undefined);assert.equal(p.state.completedRounds,undefined);assert.equal(p.state.historyVersion,'2:200:1');}
 assert.ok(peers.at(-1).bytes>100000);assert.equal(peers.at(-1).state.history.length,200);
 const before=readFileSync(dir+'/rooms.json','utf8');const url='/api/rooms/'+room.id+'/history';
 assert.equal((await apiAt(port,url,'GET')).status,401);
 assert.equal((await apiAt(port,url,'GET',undefined,auth[count].token)).status,403);
 assert.equal((await apiAt(port,url+'?limit=51','GET',undefined,auth[1].token)).status,400);
 assert.equal((await apiAt(port,url+'?round=999','GET',undefined,auth[1].token)).status,404);
 const hands=[];for(let offset=0;offset<200;offset+=50){const page=await apiAt(port,url+'?offset='+offset,'GET',undefined,auth[1].token);assert.equal(page.status,200);assert.equal(page.data.hands.length,50);hands.push(...page.data.hands);assert.ok(!JSON.stringify(page.data).includes('secret'));}
 assert.equal(new Set(hands.map(h=>h.hand)).size,200);assert.equal(readFileSync(dir+'/rooms.json','utf8'),before);
 peers[0].send('latency',{echo:123});assert.equal((await peers[0].take('latency')).echo,123);
 peers[0].send('telemetry',{rttMs:NaN,renderMs:0});assert.match((await peers[0].take('error')).message,/参数无效/);
 peers[0].send('start');await until(()=>peers.every(p=>p.state.phase==='preflop'));
 for(const p of peers.slice(0,-1))for(const player of p.state.players)if(player.id!==p.state.me)assert.ok(player.cards.every(c=>c==='??'));
 const turn=peers[0].state.turn,actor=peers.find(p=>p.state.me===peers[0].state.players[turn].id);
 actor.send('fold');await until(()=>peers.every(p=>p.state.turn!==turn));
 for(const p of peers.slice(0,-1))assert.ok(p.bytes<10000);
 t.diagnostic(JSON.stringify({players:count,compactBytes:peers[0].bytes,legacyBytes:peers.at(-1).bytes}));
});
