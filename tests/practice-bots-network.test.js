import test from 'node:test';import assert from 'node:assert/strict';import {spawn} from 'node:child_process';import {mkdtempSync,rmSync,readFileSync} from 'node:fs';import {tmpdir} from 'node:os';import path from 'node:path';import {once} from 'node:events';import {setTimeout as delay} from 'node:timers/promises';import {WebSocket} from './protocol-peer.js';
import {seedAccounts,testPassword,apiAt} from './auth-helpers.js';
test('admin companions: nine seats, permission rejection, offline pause, restart recovery, normal play and isolated history',{timeout:180000},async t=>{
 const dir=mkdtempSync(path.join(tmpdir(),'holdem-built-in-bots-')),{store,admin,invite}=await seedAccounts(dir),auth=[store.startSession(admin.id),await store.register({username:'human',nickname:'Human',password:testPassword,inviteCode:invite.code})];
 let child,port;const peers=[];
 const until=async check=>{const end=Date.now()+12000;while(!check()){if(Date.now()>end)throw Error('Bot network state timeout');await delay(10);}};
 async function stop(){for(const p of peers)p.ws.terminate();if(child?.exitCode===null){const done=once(child,'exit');child.kill();await done;}}
 async function boot(){child=spawn(process.execPath,['server/index.js'],{env:{...process.env,PORT:'0',DATA_DIR:dir},stdio:['ignore','pipe','pipe']});port=Number((await once(child.stdout,'data'))[0].toString().match(/localhost:(\d+)/)[1]);}
 async function client(index){const ws=new WebSocket('ws://127.0.0.1:'+port),p={ws,state:null,errors:[],send(type,data={}){ws.send(JSON.stringify({type,...data}));}};peers.push(p);ws.on('message',raw=>{const m=JSON.parse(raw);if(m.type==='state')p.state=m.room;else if(m.type==='error')p.errors.push(m);});await once(ws,'open');p.send('authenticate',{token:auth[index].token,compactState:true});await delay(50);return p;}
 t.after(async()=>{await stop();assert.equal(path.dirname(dir),path.resolve(tmpdir()));rmSync(dir,{recursive:true,force:true});});
 await boot();let h=await client(0),u=await client(1);
 h.send('create',{gameMode:'friends'});await until(()=>h.state);const id=h.state.id;u.send('join',{room:id});await until(()=>u.state?.players.length===2);
 u.send('testbots',{action:'add',count:1,round:1,version:0,role:'admin'});await until(()=>u.errors.length);assert.match(u.errors.at(-1).message,/管理员/);assert.equal(h.state.players.length,2);assert.equal(u.state.botSetup.canManage,false);
 h.send('testbots',{action:'add',count:7,round:1,version:0});await until(()=>h.state.players.length===9);const botIds=h.state.players.filter(p=>p.isBot).map(p=>p.id);assert.equal(botIds.length,7);assert.ok(h.state.testRound);assert.equal(h.state.botSetup.capacity,0);
 h.send('testbots',{action:'add',count:1,round:1,version:0});await until(()=>h.errors.length);assert.match(h.errors.at(-1).message,/更新/);assert.equal(h.state.players.length,9);
 h.send('start');await until(()=>h.state.seating.status==='rolling');h.ws.terminate();u.ws.terminate();await delay(100);
 const rolls=()=>JSON.stringify(JSON.parse(readFileSync(path.join(dir,'rooms.json'))).rooms.find(r=>r.id===id).seating.rolls);
 const before=rolls();await delay(1800);assert.equal(rolls(),before);
 await stop();await boot();h=await client(0);u=await client(1);h.send('resume',{room:id});u.send('resume',{room:id});await until(()=>h.state&&u.state);assert.deepEqual(h.state.players.filter(p=>p.isBot).map(p=>p.id),botIds);
 const sentDice=new Set(),seatingDeadline=Date.now()+20000;while(h.state.hand===0){if(Date.now()>seatingDeadline)throw Error('Bot seating did not complete');for(const p of [h,u])if(p.state.seating?.canRoll){const s=p.state.seating,key=p.state.me+':'+s.version+':'+s.rollRound;if(!sentDice.has(key)){sentDice.add(key);p.send('rollseat',{version:s.version,rollRound:s.rollRound});}}await delay(40);}
 assert.equal(h.state.players.length,9);assert.equal(h.state.phase,'preflop');h.send('end');await until(()=>h.state.tournament.stopRequested);
 // Nine real bot seats can exceed 55s across four streets and multiple raises.
 const actions=new Set(),playDeadline=Date.now()+120000;while(h.state.phase!=='ended'){
   if(Date.now()>playDeadline)throw Error('Bot hand did not finish');
   const r=h.state;for(const p of [h,u])if(r.players[r.turn]?.id===p.state.me&&!r.flopReveal&&p.state.actionContext&&p.state.actionVersion===r.actionVersion){const k=[r.hand,r.phase,r.turn,r.deadline,r.actionVersion].join(':');if(!actions.has(k)){actions.add(k);p.send(r.toCall&&p===h||p===u&&p.state.toCall?'call':'check');}}
   for(const b of r.players.filter(p=>p.isBot))if(!['showdown','ended'].includes(r.phase))assert.ok(b.cards.every(c=>c==='??'));
   await delay(30);
 }
 assert.equal(h.state.players.reduce((n,p)=>n+p.stack,0),90000);assert.equal(h.state.historyCount,1);
 const history=await apiAt(port,`/api/rooms/${id}/history`,'GET',undefined,auth[0].token);assert.equal(history.status,200);assert.equal(history.data.testRound,true);assert.equal(history.data.hands[0].testRound,true);
 const profile=await apiAt(port,`/api/rooms/${id}/players/${h.state.me}`,'GET',undefined,auth[0].token);assert.equal(profile.data.statistics.hands,0);
 const adminState=await apiAt(port,'/api/admin/state','GET',undefined,auth[0].token);assert.equal(adminState.data.users.length,2);assert.ok(!adminState.data.legacy.some(p=>botIds.includes(p.player)));
 h.send('restart',{round:1});await until(()=>h.state.roundNumber===2);assert.ok(h.state.botSetup.canManage);assert.equal(h.state.botSetup.bots.length,7);
 for(const bot of [...h.state.botSetup.bots]){const v=h.state.botSetup.version;h.send('testbots',{action:'remove',player:bot.id,round:2,version:v});await until(()=>h.state.botSetup.version>v);}
 assert.equal(h.state.testRound,undefined);assert.equal(h.state.botSetup.bots.length,0);
 const previous=await apiAt(port,`/api/rooms/${id}/history?round=1`,'GET',undefined,auth[0].token);assert.equal(previous.data.testRound,true);assert.equal(previous.data.hands[0].testRound,true);
});
