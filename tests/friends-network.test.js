import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {once} from 'node:events';
import {setTimeout as delay} from 'node:timers/promises';
import { WebSocket } from "./protocol-peer.js";
import {seedAccounts,registerAt} from './auth-helpers.js';
import {rollNetworkSeats} from './game-helpers.js';
for(const count of [7,9])test(`${count} friends peers: exact raise, no rebuy, automatic five-second continuation and reset`,{timeout:45000},async t=>{
 const dir=mkdtempSync(path.join(tmpdir(),'holdem-friends-'));
 const {invite}=await seedAccounts(dir);
 const child=spawn(process.execPath,['server/index.js'],{env:{...process.env,PORT:'0',DATA_DIR:dir},stdio:['ignore','pipe','pipe']});
 const peers=[];
 t.after(async()=>{for(const p of peers)p.ws.terminate();if(child.exitCode===null){const done=once(child,'exit');child.kill();await done;}assert.equal(path.dirname(dir),path.resolve(tmpdir()));rmSync(dir,{recursive:true,force:true});});
 const [output]=await once(child.stdout,'data');const port=Number(output.toString().match(/localhost:(\d+)/)[1]);
 async function until(check){const end=Date.now()+10000;while(!check()){if(Date.now()>end)throw Error('State timeout');await delay(5);}}
 for(let i=0;i<count;i++){
  const {token}=await registerAt(port,invite.code,'friend_'+i,'Friend '+i);
  const ws=new WebSocket(`ws://127.0.0.1:${port}`),p={ws,state:null,queue:[],send(type,data={}){ws.send(JSON.stringify({type,...data}));},async take(type){await until(()=>this.queue.some(m=>m.type===type));return this.queue.splice(this.queue.findIndex(m=>m.type===type),1)[0];}};
  peers.push(p);ws.on('message',raw=>{const m=JSON.parse(raw);if(m.type==='state')p.state=m.room;else p.queue.push(m);});
  await once(ws,'open');p.send('authenticate',{token});await p.take('account');
 }
 const host=peers[0];host.send('create',{gameMode:'friends'});await host.take('session');await until(()=>host.state);
 assert.deepEqual([host.state.initial,host.state.small,host.state.big],[10000,10,20]);
 for(const p of peers.slice(1)){p.send('join',{room:host.state.id});await p.take('session');}
 await until(()=>peers.every(p=>p.state?.players.length===count));
 host.send('rebuy',{amount:100});assert.match((await host.take('error')).message,/不能补充/);
 await rollNetworkSeats(peers,until);host.send('start');await until(()=>peers.every(p=>p.state.phase==='preflop'));
 const actor=peers.find(p=>p.state.me===host.state.players[host.state.turn].id);
 actor.send('raise',{amount:237});assert.match((await actor.take('error')).message,/5/);
 actor.send('raise',{amount:235});await until(()=>peers.every(p=>p.state.currentBet===235));
 assert.equal(host.state.players.find(p=>p.id===actor.state.me).bet,235);
 for(const p of peers)for(const other of p.state.players)if(other.id!==p.state.me)assert.ok(other.cards.every(c=>c==='??'));
 while(host.state.phase!=='showdown'){
  const hand=host.state,turn=hand.turn,p=peers.find(p=>p.state.me===hand.players[turn].id);
  p.send('fold');await until(()=>peers.every(p=>p.state.phase==='showdown'||p.state.turn!==turn));
 }
 const deadline=host.state.tournament.nextHandAt;
 assert.ok(deadline>Date.now()&&deadline<=Date.now()+5000);
 host.send('start');assert.match((await host.take('error')).message,/自动继续/);
 await delay(Math.max(0,deadline-Date.now()-200));
 assert.ok(peers.every(p=>p.state.hand===1));
 await until(()=>peers.every(p=>p.state.hand===2&&p.state.phase==='preflop'));
 assert.ok(Date.now()>=deadline);
 assert.deepEqual([host.state.small,host.state.big],[10,20]);
 while(!['ended','showdown'].includes(host.state.phase)){
  const turn=host.state.turn,p=peers.find(p=>p.state.me===host.state.players[turn].id);
  p.send('fold');await until(()=>peers.every(p=>['ended','showdown'].includes(p.state.phase)||p.state.turn!==turn));
 }
 host.send('end');await until(()=>peers.every(p=>p.state.phase==='ended'));
 host.send('restart',{round:1,chipMode:'reset'});await until(()=>peers.every(p=>p.state.roundNumber===2));
 assert.ok(host.state.players.every(p=>p.stack===10000));assert.equal(host.state.completedRounds.length,1);
});
