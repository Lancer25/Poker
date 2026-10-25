import {startHand} from './game-helpers.js';
import test from 'node:test';import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';import {mkdtempSync,readFileSync,writeFileSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import path from 'node:path';import {once} from 'node:events';import {setTimeout as delay} from 'node:timers/promises';import { WebSocket } from "./protocol-peer.js";
import {createRoom,joinRoom} from '../server/game.js';import {seedAccounts,testPassword,apiAt} from './auth-helpers.js';
test('three-round WS keeps public history bounded and sends action receipt only to its submitting socket',{timeout:15000},async t=>{
 const dir=mkdtempSync(path.join(tmpdir(),'holdem-window-'));const {store,admin,invite}=await seedAccounts(dir);
 const auth=[store.startSession(admin.id),await store.register({username:'window_owner',nickname:'B',password:testPassword,inviteCode:invite.code})];
 const r=createRoom('H',undefined,undefined,undefined,300,'friends').room;joinRoom(r,'B');r.players.forEach((p,i)=>p.accountId=auth[i].user.id);
 const archived=[1,2].map(number=>({number,hand:1,history:[{hand:1,board:['Ah','Kd','3c'],pots:[],results:[]}],results:[]}));r.completedRounds=structuredClone(archived);r.roundNumber=3;startHand(r,r.host);
 writeFileSync(dir+'/rooms.json',JSON.stringify({rooms:[r],sessions:[]}));const peers=[];
 const child=spawn(process.execPath,['server/index.js'],{env:{...process.env,PORT:'0',DATA_DIR:dir},stdio:['ignore','pipe','pipe']});
 t.after(async()=>{for(const p of peers)p.ws.terminate();if(child.exitCode===null){const done=once(child,'exit');child.kill();await done;}assert.equal(path.dirname(dir),path.resolve(tmpdir()));rmSync(dir,{recursive:true,force:true});});
 const port=Number((await once(child.stdout,'data'))[0].toString().match(/localhost:(\d+)/)[1]);
 async function until(check){const end=Date.now()+5000;while(!check()){if(Date.now()>end)throw Error('History window WS timeout');await delay(5);}}
 for(let i=0;i<2;i++){const ws=new WebSocket('ws://127.0.0.1:'+port),p={ws,state:null,receipts:[],queue:[],send(type,data={}){ws.send(JSON.stringify({type,...data}));},async take(type){await until(()=>this.queue.some(m=>m.type===type));return this.queue.splice(this.queue.findIndex(m=>m.type===type),1)[0];}};peers.push(p);ws.on('message',raw=>{const m=JSON.parse(raw);if(m.type==='state'){p.state=m.room;if(m.actionReceipt)p.receipts.push(m.actionReceipt);}else p.queue.push(m);});await once(ws,'open');p.send('authenticate',{token:auth[i].token,compactState:true});await p.take('account');p.send('resume',{room:r.id});await until(()=>p.state);}
 const url='/api/rooms/'+r.id+'/history';const before=readFileSync(dir+'/rooms.json','utf8');
 assert.equal((await apiAt(port,url+'?round=1','GET',undefined,auth[1].token)).status,403);
 const previous=await apiAt(port,url+'?round=2','GET',undefined,auth[1].token);assert.equal(previous.status,200);assert.deepEqual(previous.data.rounds.map(x=>x.number),[2]);
 assert.equal((await apiAt(port,url+'?round=1','GET',undefined,auth[0].token)).status,200);
 const all=await apiAt(port,'/api/admin/rooms/'+r.id+'/history','GET',undefined,auth[0].token);assert.equal(all.status,200);assert.equal(all.data.rounds.length,3);assert.equal(readFileSync(dir+'/rooms.json','utf8'),before);
 const actor=peers.find(p=>p.state.me===p.state.players[p.state.turn].id),other=peers.find(p=>p!==actor);
 actor.send('fold',{actionId:'test-receipt-1'});await until(()=>actor.receipts.length===1&&other.state.phase==='showdown');
 const receipt=actor.receipts[0];assert.equal(receipt.id,'test-receipt-1');assert.ok(receipt.serverMs>=0&&receipt.serverMs<5000);assert.equal(other.receipts.length,0);assert.equal(JSON.stringify(actor.state).includes('test-receipt-1'),false);
 actor.send('action_telemetry',{id:receipt.id,totalMs:null,renderMs:1});assert.match((await actor.take('error')).message,/参数无效/);
 actor.send('action_telemetry',{id:receipt.id,totalMs:10000,renderMs:2});actor.send('action_telemetry',{id:receipt.id,totalMs:null,renderMs:1});actor.send('latency',{echo:7});await actor.take('latency');assert.equal(actor.queue.filter(m=>m.type==='error').length,0);
 const saved=JSON.parse(readFileSync(dir+'/rooms.json'));assert.deepEqual(saved.rooms[0].completedRounds,archived);assert.equal(saved.rooms[0].history.length,1);
});
