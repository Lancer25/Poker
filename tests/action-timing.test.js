import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {readFileSync} from 'node:fs';
import {ActionTiming} from '../server/action-timing.js';
const context={module:{exports:{}}};vm.runInNewContext(readFileSync('miniprogram/utils/room-history.js','utf8'),context);
const {LiveMetrics}=context.module.exports;
test('action timing measures callback-through-build duration, deduplicates bounded matching samples and never logs IDs',()=>{
 let now=100;const timing=new ActionTiming(()=>now);timing.start('test-1');now=122;
 assert.deepEqual(timing.receipt(),{id:'test-1',serverMs:22});assert.equal(timing.receipt(),null);
 assert.equal(timing.sample({id:'forged',totalMs:100,renderMs:4}),null);
 assert.throws(()=>timing.sample({id:'test-1',totalMs:Infinity,renderMs:4}));
 const sample=timing.sample({id:'test-1',totalMs:100,renderMs:4});assert.deepEqual(sample,{actionTotalMs:100,actionServerMs:22,actionRenderMs:4,actionTransitMs:74});assert.ok(!JSON.stringify(sample).includes('test-1'));
 assert.equal(timing.sample({id:'test-1',totalMs:100,renderMs:4}),null);timing.start('cancel');timing.cancel();assert.equal(timing.receipt(),null);timing.reset();assert.equal(timing.sample({id:'test-1',totalMs:1,renderMs:0}),null);
 assert.throws(()=>timing.start('x'.repeat(49)));assert.throws(()=>timing.start({}));
});
test('client action samples correlate receipt after render, stay bounded and reset without retries',()=>{
 const m=new LiveMetrics();const id=m.startAction(1000);assert.equal(m.actionRendered({id:'forged',serverMs:10},1100,4),null);
 const sample=m.actionRendered({id,serverMs:20},1100,4);assert.equal(sample.id,id);assert.equal(sample.totalMs,100);assert.equal(sample.renderMs,4);assert.equal(m.actionRendered({id,serverMs:20},1200,4),null);
 for(let i=0;i<100;i++)m.startAction(i);assert.ok(m.actions.size<=8);m.cancelActions();assert.equal(m.actions.size,0);
 const expired=m.startAction(0);assert.equal(m.actionRendered({id:expired,serverMs:1},120001,0),null);
});
