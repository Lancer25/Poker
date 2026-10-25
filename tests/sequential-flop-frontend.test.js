import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import vm from 'node:vm';
test('incremental public board keeps already revealed nodes while replacing only hidden slots',()=>{
 const node=()=>({dataset:{},children:[],append(...c){this.children.push(...c);},replaceChildren(...c){this.children=c;},replaceChild(n,o){this.children[this.children.indexOf(o)]=n;},removeChild(n){this.children.splice(this.children.indexOf(n),1);},get lastElementChild(){return this.children.at(-1);}});
 const source=readFileSync('public/app.js','utf8'),context=vm.createContext({document:{createElement:node},suits:{s:'♠',h:'♥',d:'♦',c:'♣'}});
 vm.runInContext(source.slice(source.indexOf('function card(value)'),source.indexOf('function button(')),context);const board=node();
 context.cards(board,['2h','??','??'],true);const first=board.children[0],secondBack=board.children[1];context.cards(board,['2h','3d','??'],true);assert.equal(board.children[0],first);assert.notEqual(board.children[1],secondBack);const second=board.children[1];context.cards(board,['2h','3d','7c'],true);assert.equal(board.children[0],first);assert.equal(board.children[1],second);assert.equal(board.children.length,3);context.cards(board,[],true);assert.equal(board.children.length,0);
});
