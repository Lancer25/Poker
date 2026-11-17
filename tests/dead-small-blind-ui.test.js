import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

test('web table shows the missing small blind only during that preflop',()=>{
  const source=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
  const start=source.indexOf('$("stage").textContent = {');
  const end=source.indexOf('$("potValue").textContent',start);
  assert.ok(start>=0&&end>start);
  for(const [phase,dead,expected] of [['preflop',true,'翻牌前 · 本手无小盲'],['preflop',false,'翻牌前'],['flop',true,'翻牌']]){
    const stage={};
    runInNewContext(source.slice(start,end),{$:()=>stage,r:{phase,tournament:{deadSmallBlind:dead}}});
    assert.equal(stage.textContent,expected);
  }
});
