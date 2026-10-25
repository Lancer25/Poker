import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import * as ui from '../public/room-ui.js';

test('pinch zoom freezes layout metrics and returning to original scale clears stale keyboard insets',()=>{
  assert.equal(typeof ui.viewportLayout,'function');
  assert.deepEqual(ui.viewportLayout(844,{height:744,scale:1,offsetTop:0},744),{zoomed:false,height:744,keyboardInset:100,keyboardOpen:false});
  assert.deepEqual(ui.viewportLayout(844,{height:372,scale:2,offsetTop:80},744,true),{zoomed:true,height:744,keyboardInset:0,keyboardOpen:false});
  assert.deepEqual(ui.viewportLayout(844,{height:744,scale:1.001,offsetTop:0},744),{zoomed:false,height:744,keyboardInset:100,keyboardOpen:false});
  assert.equal(ui.viewportLayout(844,{height:400,scale:1,offsetTop:0},744,true).keyboardOpen,true);
});

function winnerHarness(){
  class Element{
    constructor(tag='div'){this.tagName=tag;this.children=[];this.dataset={};this.hidden=false;this.open=false;this.textContent='';this.classes=new Set();this.classList={toggle:(k,on)=>on?this.classes.add(k):this.classes.delete(k),remove:k=>this.classes.delete(k)};}
    append(...nodes){this.children.push(...nodes);}
    replaceChildren(...nodes){this.children=nodes;}
    setAttribute(k,v){this[k]=v;}
    closest(){return table;}
    showModal(){this.open=true;}
    close(){this.open=false;}
  }
  const table=new Element(),nodes=new Map(),$=id=>{if(!nodes.has(id))nodes.set(id,new Element());return nodes.get(id);};
  const source=readFileSync('public/app.js','utf8'),code=source.slice(source.indexOf('function renderWinnerFocus(r)'),source.indexOf('function displayedHistory(r)'));
  const context={$,document:{createElement:tag=>new Element(tag)},cards:(node,list)=>{node.textContent=list.join(' ');},performance:{now:()=>0},clockServerAtReceipt:1000,clockReceivedAt:0,clearTimeout(){},setTimeout(){return 1;},winnerFocusTimer:0};
  vm.runInNewContext(code,context);
  return {$,table,render:r=>context.renderWinnerFocus(r)};
}
test('winner presentation does not hide the board; enlargement is explicitly opened and expires safely',()=>{
  const {$,table,render}=winnerHarness(),room={id:'r',me:'a',hand:1,showdownAt:1000,board:['Ah','Kd','2c'],winnerFocus:[{id:'a',name:'A',cards:['As','Ad'],won:100},{id:'b',name:'B',cards:['Ks','Kc'],won:50}]};
  render(room);assert.equal(table.classes.has('winner-presenting'),false);
  assert.equal($('winnerDialog').open,false);
  assert.equal($('winnerFocusHands').children.length,1);
  const summary=$('winnerFocusHands').children[0];assert.equal(summary.tagName,'button');
  summary.onclick();assert.equal($('winnerDialog').open,true);assert.equal($('winnerDialogHands').children.length,2);
  render({...room,hand:2,showdownAt:0,winnerFocus:[]});assert.equal($('winnerDialog').open,false);assert.equal($('winnerFocus').hidden,true);
});
