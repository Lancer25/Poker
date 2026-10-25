import test from 'node:test';import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';import {mkdtempSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import path from 'node:path';import {once} from 'node:events';import {setTimeout as delay} from 'node:timers/promises';import {WebSocket} from 'ws';
import {seedAccounts,registerAt} from './auth-helpers.js';
test('real sockets reject missing/stale contexts and acknowledge a duplicate without applying money twice',{timeout:20000},async t=>{
 const dir=mkdtempSync(path.join(tmpdir(),'holdem-protocol-')),{store,admin,invite}=await seedAccounts(dir),auth=[store.startSession(admin.id),await registerAtForStore()];
 async function registerAtForStore(){return store.register({username:'peer',nickname:'Peer',password:'TestFriends123!',inviteCode:invite.code});}
 const child=spawn(process.execPath,['server/index.js'],{env:{...process.env,PORT:'0',DATA_DIR:dir},stdio:['ignore','pipe','pipe']}),peers=[];
 t.after(async()=>{for(const p of peers)p.ws.terminate();if(child.exitCode===null){const end=once(child,'exit');child.kill();await end;}assert.equal(path.dirname(dir),path.resolve(tmpdir()));rmSync(dir,{recursive:true,force:true});});
 const port=Number((await once(child.stdout,'data'))[0].toString().match(/localhost:(\d+)/)[1]);
 async function until(fn){const end=Date.now()+5000;while(!fn()){if(Date.now()>end)throw Error('protocol timeout');await delay(5);}}
 for(const account of auth){const ws=new WebSocket('ws://127.0.0.1:'+port),p={ws,state:null,queue:[],send(type,data={}){ws.send(JSON.stringify({type,...data}));},async take(type){await until(()=>this.queue.some(m=>m.type===type));return this.queue.splice(this.queue.findIndex(m=>m.type===type),1)[0];}};peers.push(p);ws.on('message',raw=>{const m=JSON.parse(raw);if(m.type==='state')p.state=m.room;else p.queue.push(m);});await once(ws,'open');p.send('authenticate',{token:account.token});await p.take('account');}
 peers[0].send('create',{gameMode:'cash'});await until(()=>peers[0].state);peers[1].send('join',{room:peers[0].state.id});await until(()=>peers.every(p=>p.state?.players.length===2));peers[0].send('start');await until(()=>peers.every(p=>p.state.phase==='preflop'));
 const actor=peers.find(p=>p.state.actionContext),context=actor.state.actionContext;
 actor.send('raise',{amount:40});assert.equal((await actor.take('error')).code,'action_context_required');
 const payload={amount:40,requestId:'network-request-1',decision:context};actor.send('raise',payload);assert.equal((await actor.take('action_result')).status,'applied');await until(()=>peers.every(p=>p.state.currentBet===40));
 const stacks=actor.state.players.map(p=>p.stack);actor.send('raise',payload);assert.equal((await actor.take('action_result')).status,'already_applied');await delay(30);assert.deepEqual(actor.state.players.map(p=>p.stack),stacks);
 actor.send('raise',{...payload,requestId:'network-stale'});assert.equal((await actor.take('error')).code,'action_wrong_turn');
});
