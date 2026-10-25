import {startHand} from './game-helpers.js';
import test from 'node:test';import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';import {mkdtempSync,readFileSync,writeFileSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import path from 'node:path';import {once} from 'node:events';import {setTimeout as delay} from 'node:timers/promises';import { WebSocket } from "./protocol-peer.js";
import {createRoom,joinRoom,settle,command} from '../server/game.js';import {seedAccounts,testPassword,apiAt} from './auth-helpers.js';
test('real unanimous rebuy survives restart, is visible to every voter, queues god-mode exit and deals fresh cards once',{timeout:18000},async t=>{
 const dir=mkdtempSync(path.join(tmpdir(),'holdem-unanimous-'));const {store,admin,invite}=await seedAccounts(dir),auth=[store.startSession(admin.id)];
 for(let i=1;i<4;i++)auth.push(await store.register({username:'unanimous_'+i,nickname:'P'+i,password:testPassword,inviteCode:invite.code}));
 const r=createRoom('H',undefined,undefined,undefined,30,'friends').room;joinRoom(r,'B');joinRoom(r,'C');r.players.forEach((p,i)=>p.accountId=auth[i].user.id);startHand(r,r.host);
 r.phase='river';r.board=['2h','3d','7c','8d','Jh'];r.players.forEach((p,i)=>Object.assign(p,{cards:i===0?['As','Ad']:i===1?['Ks','Kd']:['Qs','Qd'],inHand:true,folded:false,total:100,bet:100,stack:i===1?0:9900,finishStack:i===1?100:10000}));r.tournament.totalChips=20100;settle(r);command(r,r.players[1].id,'godmode',{enabled:true});
 writeFileSync(dir+'/rooms.json',JSON.stringify({rooms:[r],sessions:[]}));let child,port;const peers=[];
 async function stop(){for(const p of peers)p.ws.terminate();if(child?.exitCode===null){const done=once(child,'exit');child.kill();await done;}}
 t.after(async()=>{await stop();assert.equal(path.dirname(dir),path.resolve(tmpdir()));rmSync(dir,{recursive:true,force:true});});
 async function boot(){child=spawn(process.execPath,['server/index.js'],{env:{...process.env,PORT:'0',DATA_DIR:dir},stdio:['ignore','pipe','pipe']});port=Number((await once(child.stdout,'data'))[0].toString().match(/localhost:(\d+)/)[1]);}
 async function until(check){const end=Date.now()+8000;while(!check()){if(Date.now()>end)throw Error('Unanimous network timeout');await delay(5);}}
 async function client(i){const ws=new WebSocket('ws://127.0.0.1:'+port),p={ws,state:null,queue:[],send(type,data={}){ws.send(JSON.stringify({type,...data}));}};peers.push(p);ws.on('message',raw=>{const m=JSON.parse(raw);if(m.type==='state')p.state=m.room;else p.queue.push(m);});await once(ws,'open');p.send('authenticate',{token:auth[i].token,compactState:true});await until(()=>p.queue.some(m=>m.type==='account'));p.send(i===3?'watch':'resume',{room:r.id});await until(()=>p.state);return p;}
 await boot();let current=[];for(let i=0;i<4;i++)current.push(await client(i));const [host,applicant,voter,observer]=current;
 applicant.send('rebuy',{amount:10000,voters:[],approvals:['forged']});await until(()=>current.every(p=>p.state.requests.length===1));let request=host.state.requests[0];assert.equal(request.voters.length,2);assert.equal(request.approvals.length,0);assert.equal(voter.state.requests[0].canApprove,true);assert.equal(observer.state.requests[0].canApprove,false);
 observer.send('approve',{request:request.id});await until(()=>observer.queue.some(m=>m.type==='error'));
 host.send('approve',{request:request.id});await until(()=>applicant.state.requests[0].approvals.length===1);assert.equal(applicant.state.players[1].stack,0);
 await stop();await boot();current=[];for(let i=0;i<4;i++)current.push(await client(i));request=current[2].state.requests[0];assert.equal(request.approvals.length,1);assert.equal(request.canApprove,true);
 current[2].send('approve',{request:request.id});await until(()=>current[1].state.requests[0]?.status==='approved');assert.equal(current[1].state.godMode,false);assert.equal(current[1].state.players[1].stack,0);assert.equal(current[1].state.players[1].buyin,10000);
 current[1].send('godmode',{enabled:true});await until(()=>current[1].queue.some(m=>m.type==='error'));
 await until(()=>current.every(p=>p.state.hand===2));for(const p of current){assert.equal(p.state.requests.length,0);assert.equal(p.state.players[1].eliminated,false);assert.equal(p.state.players[1].buyin,20000);assert.equal(p.state.players[1].cards.length,2);}
 assert.deepEqual(current[1].state.players[0].cards,['??','??']);assert.equal(current[1].state.godMode,false);
 const persisted=JSON.parse(readFileSync(dir+'/rooms.json')).rooms[0];assert.equal(persisted.tournament.totalChips,30100);assert.equal(persisted.players.reduce((n,p)=>n+p.stack+p.total,0),30100);assert.equal(persisted.tournament.standings.length,0);
 const history=await apiAt(port,'/api/rooms/'+r.id+'/history','GET',undefined,auth[0].token);assert.equal(history.data.hands[0].results[1].buyin,10000);
});
