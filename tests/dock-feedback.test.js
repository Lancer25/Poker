import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync('public/app.js','utf8');
function load(name,next,context={}){
  vm.runInNewContext(source.slice(source.indexOf(`function ${name}(`),source.indexOf(`function ${next}(`)),context);
  return context[name];
}
const api={};vm.runInNewContext(readFileSync('miniprogram/utils/table-experience.js','utf8'),api);
const room={chipUnit:5,me:'a',players:[{id:'a',bet:10,stack:990}],currentBet:20,minRaise:20,toCall:10,pot:30,canRaise:true};
const invalid=load('invalidBetReason','refreshDockFeedback',api.TableExperience);

test('default raise preset is per-account, permits no automatic all-in default and never submits',()=>{
 const data=new Map(),nodes={};
 const c={$:id=>nodes[id]??={},feedback:{account:'alice',settings:{volume:.35},capabilities:{}},localStorage:{getItem:key=>data.get(key),setItem:(key,value)=>data.set(key,value)}};
 vm.createContext(c);
 vm.runInContext(source.slice(source.indexOf("let preferredRaisePreset="),source.indexOf('function continuationBlockers(')),c);
 vm.runInContext(source.slice(source.indexOf('function syncFeedbackStatus('),source.indexOf('feedback.onStatus=')),c);
 vm.runInContext(source.match(/^\$\('defaultRaisePreset'\)\.onchange=.*$/m)[0],c);
 c.syncFeedbackStatus();assert.equal(nodes.defaultRaisePreset.value,'min');nodes.defaultRaisePreset.value='pot';nodes.defaultRaisePreset.onchange();
 c.feedback.account='bob';c.syncFeedbackStatus();assert.equal(nodes.defaultRaisePreset.value,'min');
 nodes.defaultRaisePreset.value='max';nodes.defaultRaisePreset.onchange();c.syncFeedbackStatus();assert.equal(nodes.defaultRaisePreset.value,'min');
 c.feedback.account='alice';c.syncFeedbackStatus();assert.equal(nodes.defaultRaisePreset.value,'pot');
});
test('exact bet bounds, denomination and legal short all-in',()=>{
  for(const value of ['','1e2','-5','9007199254740992'])assert.match(invalid(room,value),/整数/);
  assert.match(invalid(room,'35'),/40/);assert.match(invalid(room,'1005'),/1,000/);
  assert.match(invalid(room,'41'),/5/);assert.equal(invalid(room,'100'), '');
  assert.equal(invalid({...room,players:[{id:'a',bet:10,stack:20}]},'30'),'');
  assert.match(invalid({...room,canRaise:false},'1000'),/不能/);
});
test('continuation identifies each name and reason, preserving readiness policy',()=>{
 const blockers=load('continuationBlockers','invalidBetReason');
 const r={roomControls:{enabled:true,settings:{requireReady:false},seats:[{name:'甲',eligible:true,ready:false},{name:'乙',eligible:true,away:true,pendingAway:true}]}};
 assert.equal(blockers(r).join('；'),'乙：暂离、本手后暂离');
 r.roomControls.pause={state:'active'};
 assert.match(blockers(r).join('；'),/牌桌已暂停.*甲：未准备.*乙/);
 assert.equal(blockers({...r,phase:'ended'}).length,0);
});
test('send never submits a bet during recovery, even on an open socket',()=>{
 let count=0;const nodes={};const context={socket:{readyState:1,send(){count++;}},connected:true,recovery:{mode:'resuming'},$:id=>nodes[id]??=( {} ),toast(){}};
 const send=load('send','dropConnection',context);
 for(const action of ['raise','call','check','fold','allin'])send(action,{amount:100});
 assert.equal(count,0);assert.match(nodes.actionSubmissionStatus.textContent,/未发送/);
 context.connected=false;send('raise');assert.equal(count,0);
});
test('pending entry opens the exact chip row or pause control with keyboard focus',()=>{
 const nodes={dockWaitingLabel:{textContent:'等待'},continuationStatus:{},dockPending:{setAttribute(k,v){this[k]=v;}},requests:{children:[]},roomControls:{focus(){this.focused=true;},scrollIntoView(){}}};
 const row={dataset:{request:'17'},focus(){this.focused=true;},scrollIntoView(){}};nodes.requests.children=[row];
 const context={state:{phase:'waiting',gameMode:'friends',me:'a',players:[{id:'b',name:'乙'}],requests:[{id:17,player:'b',amount:500,status:'pending',canApprove:true}]},$:id=>nodes[id],continuationBlockers:()=>[],selectPanel:p=>assert.equal(p,'chips')};
 const refresh=load('refreshDockFeedback','syncFeedbackStatus',context);refresh();nodes.dockPending.onclick();assert.equal(row.focused,true);assert.match(nodes.dockPending['aria-label'],/乙.*500/);
 context.state.requests=[];context.state.roomControls={pause:{state:'pending',voters:['a'],approvals:[]}};refresh();nodes.dockPending.onclick();assert.equal(nodes.roomControls.focused,true);
});
test('single submission waits for acknowledgement without replaying a pending bet',()=>{
 let count=0;const nodes={};const context={socket:{readyState:1,send(){count++;}},connected:true,recovery:{mode:'ready'},pendingAction:null,state:{players:[{id:'a'}],turn:0,me:'a',deadline:1000,actionContext:{}},clockServerAtReceipt:0,clockReceivedAt:0,performance:{now:()=>1},liveMetrics:{startAction:()=> 'id'},decisionKey:()=> 'turn',refreshBetControls(){},$:id=>nodes[id]??={},toast(){}};
 const send=load('send','dropConnection',context);send('call');send('call');
 assert.equal(count,1);assert.match(nodes.actionSubmissionStatus.textContent,/提交中/);
 assert.equal(context.pendingAction.requestId,'id');
});
