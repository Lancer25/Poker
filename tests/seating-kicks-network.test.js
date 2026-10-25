import test from 'node:test';import assert from 'node:assert/strict';import {spawn} from 'node:child_process';import {mkdtempSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import path from 'node:path';import {once} from 'node:events';import {setTimeout as delay} from 'node:timers/promises';import { WebSocket } from "./protocol-peer.js";
import {seedAccounts,testPassword,apiAt} from './auth-helpers.js';import {rollNetworkSeats} from './game-helpers.js';
test('real dice recovery and host boundary removal revoke every tab, join/watch/resume; next round permits explicit reentry',{timeout:28000},async t=>{
 const dir=mkdtempSync(path.join(tmpdir(),'holdem-seating-kicks-')),{store,admin,invite}=await seedAccounts(dir),auth=[store.startSession(admin.id)];
 for(let i=1;i<5;i++)auth.push(await store.register({username:'seating_'+i,nickname:'P'+i,password:testPassword,inviteCode:invite.code}));
 let child,port;const all=[];
 async function stop(){for(const p of all)p.ws.terminate();if(child?.exitCode===null){const done=once(child,'exit');child.kill();await done;}}
 t.after(async()=>{await stop();assert.equal(path.dirname(dir),path.resolve(tmpdir()));rmSync(dir,{recursive:true,force:true});});
 async function boot(){child=spawn(process.execPath,['server/index.js'],{env:{...process.env,PORT:'0',DATA_DIR:dir},stdio:['ignore','pipe','pipe']});port=Number((await once(child.stdout,'data'))[0].toString().match(/localhost:(\d+)/)[1]);}
 async function until(check){const end=Date.now()+8000;while(!check()){if(Date.now()>end)throw Error('Seating/removal network timeout');await delay(5);}}
 async function client(index){const ws=new WebSocket('ws://127.0.0.1:'+port),p={ws,state:null,states:[],queue:[],send(type,data={}){ws.send(JSON.stringify({type,...data}));},async take(type){await until(()=>p.queue.some(m=>m.type===type));return p.queue.splice(p.queue.findIndex(m=>m.type===type),1)[0];}};all.push(p);ws.on('message',raw=>{const m=JSON.parse(raw);if(m.type==='state'){p.state=m.room;p.states.push(m.room);}else p.queue.push(m);});await once(ws,'open');p.send('authenticate',{token:auth[index].token,compactState:true});await p.take('account');return p;}
 await boot();for(const name of ['dice-1','dice-2','dice-3','dice-4','dice-5','dice-6','dices','user-x']){const asset=await fetch('http://127.0.0.1:'+port+'/assets/icons/'+name+'.svg');assert.equal(asset.status,200);assert.match(await asset.text(),/<svg/);}
 let peers=[];for(let i=0;i<4;i++)peers.push(await client(i));let host=peers[0];host.send('create',{gameMode:'friends',roomOptions:{admission:'open',reveal:'realtime'}});await host.take('session');await until(()=>host.state);const id=host.state.id;
 for(const p of peers.slice(1)){p.send('join',{room:id});await p.take('session');}await until(()=>peers.every(p=>p.state?.players.length===4));
 host.send('start');await until(()=>peers.every(p=>p.state.seating.status==='rolling'));
 const s=host.state.seating;host.send('rollseat',{version:s.version,rollRound:s.rollRound,dice:[6,6],score:12});await until(()=>host.state.seating.entries.find(e=>e.id===host.state.me).dice.length===2);const rolled=host.state.seating.entries.find(e=>e.id===host.state.me).dice;
 await stop();await boot();peers=[];for(let i=0;i<4;i++){const p=await client(i);p.send('resume',{room:id});await until(()=>p.state);peers.push(p);}host=peers[0];assert.deepEqual(host.state.seating.entries.find(e=>e.id===host.state.me).dice,rolled);
 await rollNetworkSeats(peers,until);const first=host.state.seating.entries.find(e=>e.seatNumber===1).id;
 const target=peers[1],tab=await client(1);tab.send('join',{room:id});await tab.take('session');await until(()=>tab.state);
 const observer=await client(4);observer.send('watch',{room:id});await observer.take('session');await until(()=>observer.state);
 host.send('start');await until(()=>peers.every(p=>p.state.phase==='preflop'));assert.equal(host.state.players[host.state.dealer].id,first);
 peers[2].send('kick',{player:target.state.me,round:1});assert.match((await peers[2].take('error')).message,/房主/);
 const betting=JSON.stringify([host.state.turn,host.state.deadline,host.state.players.map(p=>[p.bet,p.stack])]);
 host.send('kick',{player:target.state.me,round:1});await until(()=>peers.every(p=>p.state.players.find(q=>q.id===target.state.me).pendingKick));assert.equal(JSON.stringify([host.state.turn,host.state.deadline,host.state.players.map(p=>[p.bet,p.stack])]),betting);
 while(host.state.phase!=='showdown'){const turn=host.state.turn,p=peers.find(p=>p.state.me===host.state.players[turn].id);p.send('fold');await until(()=>host.state.phase==='showdown'||host.state.turn!==turn);}
 assert.equal((await target.take('error')).code,'room_forbidden');assert.equal((await tab.take('error')).code,'room_forbidden');const messages=target.states.length;
 const removed=host.state.players.find(p=>p.id===target.state.me);assert.equal(removed.removed,true);assert.equal(host.state.tournament.remaining,3);
 for(const type of ['join','watch','resume']){target.send(type,{room:id});assert.equal((await target.take('error')).code,'room_forbidden');}
 await until(()=>host.state.hand===2);assert.equal(target.states.length,messages);assert.ok(!host.state.players.find(p=>p.id===removed.id).inHand);
 const history=await apiAt(port,'/api/rooms/'+id+'/history','GET',undefined,auth[1].token);assert.equal(history.status,403);
 const retained=await apiAt(port,'/api/rooms/'+id+'/history','GET',undefined,auth[0].token);assert.equal(retained.status,200);assert.equal(retained.data.hands[0].results.find(p=>p.id===removed.id).stack,removed.stack);
 host.send('end');await until(()=>host.state.tournament.stopRequested);while(host.state.phase!=='ended'){const turn=host.state.turn,p=peers.find(p=>p.state.me===host.state.players[turn].id);p.send('fold');await until(()=>host.state.phase==='ended'||host.state.turn!==turn);}
 host.send('restart',{round:1});await until(()=>host.state.roundNumber===2);assert.equal(host.state.players.find(p=>p.id===removed.id).removed,true);
 target.send('join',{room:id});await target.take('session');await until(()=>target.state.roundNumber===2 && target.state.players.find(p=>p.id===target.state.me).removed===false);assert.equal(target.state.seating.status,'idle');assert.equal(target.state.players.find(p=>p.id===target.state.me).stack,10000);
});
