import test from 'node:test';
import assert from 'node:assert/strict';
import {fitCenterY} from '../public/room-ui.js';

test('center clears actual upper seat labels when a long settlement expands its height',()=>{
  for(const [height,content,upper,lower] of [[570,247,155,480],[712,247,170,590],[360,150,112,300],[400,160,110,325]]){
    const y=fitCenterY(height,content,upper,lower);
    assert.ok(y-content/2>=upper+10);
    assert.ok(y+content/2<=lower-10);
  }
});
test('center returns to its preferred position when settlement text shrinks',()=>{
  assert.equal(fitCenterY(570,160,125,480),570*.48);
  assert.equal(fitCenterY(300,200,100,240),170);
});
