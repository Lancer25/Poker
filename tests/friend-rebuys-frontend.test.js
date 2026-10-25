import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';
function harness(){
 const sent=[];
 class Element {
  constructor(){this.children=[];this.textContent='';this.hidden=false;this.disabled=false;}
  append(...nodes){this.children.push(...nodes);}
  replaceChildren(...nodes){this.children=nodes;}
  setAttribute(k,v){this[k]=v;}
  querySelector(){return this.submit;}
 }
 const nodes=Object.fromEntries(['rebuy','rebuyAmount','requests','requestBadge','tab-chips'].map(id=>[id,new Element()]));nodes.rebuy.submit=new Element();
 const source=fs.readFileSync('public/app.js','utf8'),code=source.slice(source.indexOf('function renderRebuyRequests('),source.indexOf('function render()'));
 const context={$:id=>nodes[id],document:{createElement:()=>new Element()},button:(label,type,data,disabled)=>{const e=new Element();e.textContent=label;e.disabled=disabled;e.onclick=()=>sent.push({type,...data});return e;}};
 vm.createContext(context);vm.runInContext(fs.readFileSync('miniprogram/utils/table-experience.js','utf8'),context);context.chipUnit=context.TableExperience.chipUnit;vm.runInContext(code,context);
 const r={gameMode:'friends',initial:10000,phase:'flop',host:'a',me:'b',canRequestRebuy:false,players:[{id:'c',name:'C'}],requests:[{id:'q',kind:'friend-rebuy',player:'c',amount:10000,status:'pending',voters:['a','b'],approvals:['a'],votes:[{id:'a',name:'A',approved:true},{id:'b',name:'B',approved:false}],canApprove:true,canCancel:false}]};
 return {r,nodes,sent,render:()=>context.renderRebuyRequests(r)};
}
test('web non-host sees correct progress and vote commands, applicant sees fixed request and cancellation, queued votes disappear',()=>{
 const {r,nodes,sent,render}=harness();render();assert.equal(nodes.rebuy.hidden,true);assert.equal(nodes.rebuyAmount.disabled,true);
 const row=nodes.requests.children[0];assert.equal(row.children[1].textContent,'已同意 1/2');row.children[3].onclick();assert.equal(sent[0].type,'approve');assert.equal(sent[0].request,'q');row.children[4].onclick();assert.equal(sent[1].type,'reject');
 r.me='c';r.requests[0].canApprove=false;r.requests[0].canCancel=true;render();nodes.requests.children[0].children.at(-1).onclick();assert.equal(sent.at(-1).type,'cancelrebuy');
 r.requests=[];r.canRequestRebuy=true;render();assert.equal(nodes.rebuy.hidden,false);assert.equal(nodes.rebuy.submit.textContent,'申请补充 10000');
 r.requests=[{id:'q',kind:'friend-rebuy',player:'c',amount:10000,status:'approved',voters:['a','b'],approvals:['a','b'],votes:[],canApprove:false,canCancel:true}];r.canRequestRebuy=false;render();assert.equal(nodes.requests.children[0].children[1].textContent,'全员通过 · 下一手到账');
});
test('web cash host approval remains independent, and standards have no rebuy form',()=>{
 const {r,nodes,render}=harness();r.gameMode='cash';r.me=r.host;r.requests=[{id:'cash',player:'c',amount:500,status:'pending'}];render();assert.equal(nodes.rebuy.hidden,false);assert.equal(nodes.rebuyAmount.disabled,false);assert.equal(nodes.requests.children[0].children[1].textContent,'批准');
 r.gameMode='standard';r.tournament={};r.requests=[];render();assert.equal(nodes.rebuy.hidden,true);
});
