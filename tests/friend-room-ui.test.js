import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';
function harness(){
 class Element {constructor(){this.children=[];this.hidden=false;this.disabled=false;this.dataset={};this.classList={add:()=>{},toggle:()=>{}};}append(...x){this.children.push(...x);}replaceChildren(...x){this.children=x;}insertBefore(x,b){this.children=this.children.filter(e=>e!==x);const i=b?this.children.indexOf(b):this.children.length;this.children.splice(i,0,x);x.parent=this;}remove(){this.parent.children=this.parent.children.filter(e=>e!==this);}setAttribute(k,v){this[k]=v;}}
 const elements=Object.fromEntries(['game','seatDiceHistory','seatDiceHistoryRows','rollSeatDiceLabel','seatDice','seatDiceRows','rollSeatDice','seatDiceStatus','friendManager','friendMembers'].map(k=>[k,new Element()])),sent=[];
 const context={document:{getElementById:id=>elements[id],createElement:()=>new Element()}};vm.createContext(context);vm.runInContext(fs.readFileSync('public/friend-room-ui.js','utf8').replaceAll('export function','function'),context);
 const r={id:'r',me:'a',host:'a',gameMode:'friends',phase:'waiting',hand:0,roundNumber:1,seating:{version:'v',rollRound:0,status:'rolling',canRoll:true,entries:[{id:'a',name:'A',dice:[],totals:[],needsRoll:true},{id:'b',name:'B',dice:[3,4],totals:[7],needsRoll:false}]},manageableMembers:[{id:'b',name:'B',pendingKick:false}]};
 return {r,e:elements,sent,context,render:(confirm=()=>true,feedback)=>context.renderFriendRoomUI(r,{send:(type,data)=>sent.push({type,...data}),connected:true,confirm,feedback})};
}
test('web dice use physical face assets, immutable request version and disabled pending states; host removal needs confirmation',()=>{
 const {r,e,sent,render}=harness();render();assert.equal(e.seatDice.hidden,false);assert.equal(e.seatDiceRows.children[1].children[1].children[0].src,'/assets/icons/dice-real-3.svg');
 assert.equal(e.seatDiceRows.children[0].children[1].role,'img');assert.equal(e.seatDiceRows.children[0].children[1].children[0].src,'/assets/icons/dice-real-pending.svg');
 e.rollSeatDice.onclick();assert.equal(sent[0].type,'rollseat');assert.equal(sent[0].version,'v');assert.equal(sent[0].rollRound,0);assert.equal(e.rollSeatDice.disabled,true);
 render(()=>false);e.friendMembers.children[0].children[1].onclick();assert.equal(sent.length,1);
 render();e.friendMembers.children[0].children[1].onclick();assert.equal(sent[1].type,'kick');assert.equal(sent[1].player,'b');assert.equal(sent[1].round,1);
 r.manageableMembers[0].pendingKick=true;render();assert.equal(e.friendMembers.children[0].children[1].textContent,'本手后移出');r.me='b';render();assert.equal(e.friendManager.hidden,true);
 r.seating.status='ready';r.seating.autoStartAt=9000;r.seating.canRoll=false;render();assert.equal(e.rollSeatDice.disabled,true);assert.equal(e.rollSeatDiceLabel.textContent,'即将发牌');
 for(let n=1;n<=6;n++){assert.ok(fs.existsSync(`public/assets/icons/dice-real-${n}.svg`));assert.ok(fs.existsSync(`miniprogram/assets/dice-${n}.svg`));}
});
test('dice node identity survives unrelated updates; baseline and background recovery do not replay sounds',()=>{
 const {r,e,render,context}=harness(),heard=[],feedback={previous:null,moving:true,sound:kind=>heard.push(kind)};
 render(undefined,feedback);assert.equal(heard.length,0);const stable=e.seatDiceRows.children[1];
 feedback.previous=r;r.seating.entries[0].dice=[6,5];r.seating.entries[0].totals=[11];render(undefined,feedback);
 assert.equal(heard.length,1);assert.equal(e.seatDiceRows.children[1],stable);
 const own=e.seatDiceRows.children[0];render(undefined,feedback);assert.equal(heard.length,1);assert.equal(e.seatDiceRows.children[0],own);
 context.document.hidden=true;r.seating.entries[1].totals.push(9);render(undefined,feedback);assert.equal(heard.length,1);
 context.document.hidden=false;feedback.previous=null;r.seating.entries[0].totals.push(8);render(undefined,feedback);assert.equal(heard.length,1);
});
test('host starts from the compact command, dice stay off the felt until ceremony begins',()=>{
 const {r,e,sent,render}=harness();r.seating.status='idle';r.seating.canRoll=false;render();
 assert.equal(e.seatDice.hidden,true);assert.equal(e.rollSeatDice.disabled,false);assert.equal(e.rollSeatDiceLabel.textContent,'开始比赛');
 e.rollSeatDice.onclick();assert.equal(sent[0].type,'start');r.me='b';render();assert.equal(e.rollSeatDice.disabled,true);
 r.phase='preflop';render();assert.equal(e.seatDice.hidden,true);assert.equal(e.rollSeatDice.hidden,true);
});
