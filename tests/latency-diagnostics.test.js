import test from 'node:test';import assert from 'node:assert/strict';import {createLatencyMetrics} from '../server/latency-metrics.js';
test('diagnostics snapshots retain bounded aggregates without exposing source values or resetting live samples',()=>{
 const logged=[],m=createLatencyMetrics(v=>logged.push(v));try{
  m.observe('actionTotalMs',100);m.observe('actionTotalMs',200);m.slow();
  assert.equal(typeof m.snapshot,'function');const first=m.snapshot();assert.equal(first.current.actionTotalMs.count,2);assert.equal(first.current.actionTotalMs.p95,200);
  assert.equal(m.snapshot().current.actionTotalMs.count,2);m.flush();assert.equal(logged.length,1);assert.equal(m.snapshot().recent.length,1);assert.equal(m.snapshot().current.actionTotalMs,undefined);
 }finally{m.close();}
});
