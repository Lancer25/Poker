import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import sharp from 'sharp';

test('physical dice retain the exact six server face values and a pip-free pending face',async()=>{
  for(const face of [1,2,3,4,5,6,'pending']){
    const svg=readFileSync(`public/assets/icons/dice-real-${face}.svg`,'utf8');
    assert.equal((svg.match(/data-pip="true"/g)||[]).length,face==='pending'?0:face);
    assert.match(svg,/viewBox="0 0 64 70"/);assert.match(svg,new RegExp(`data-face="${face}"`));
    const m=await sharp(Buffer.from(svg)).metadata();assert.equal(m.width,64);assert.equal(m.height,70);
  }
});
test('private card suit vectors have stable geometry and do not depend on font glyph metrics',async()=>{
  const css=readFileSync('public/table-ui.css','utf8');
  for(const suit of ['spade','heart','diamond','club']){
    const svg=readFileSync(`public/assets/icons/card-${suit}.svg`,'utf8');
    assert.match(svg,/viewBox="0 0 24 24"/);assert.match(svg,/fill="currentColor"/);
    assert.ok(css.includes(`card-${suit}.svg`));assert.equal((await sharp(Buffer.from(svg)).metadata()).width,24);
  }
});
