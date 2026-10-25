import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import vm from 'node:vm';
const c={};vm.runInNewContext(readFileSync('miniprogram/utils/table-experience.js','utf8'),c);const api=c.TableExperience;
test('raise impact separates street total, incremental payment and remaining chips',()=>{
 const r={chipUnit:5,me:'a',players:[{id:'a',bet:10,stack:990}],currentBet:20,minRaise:20,toCall:10,pot:30,canRaise:true};
 assert.equal(typeof api.betImpact,'function');assert.equal(JSON.stringify(api.betImpact(r,'100')),JSON.stringify({target:100,added:90,remaining:900,allin:false}));
 assert.equal(api.betImpact(r,'1000').allin,true);assert.equal(api.betImpact(r,'41'),null);assert.equal(api.betImpact(r,'1e2'),null);assert.equal(api.betImpact(r,'10'),null);
 delete r.chipUnit;assert.equal(api.betImpact(r,'41').added,31);
});
