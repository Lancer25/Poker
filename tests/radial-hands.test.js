import test from 'node:test';
import assert from 'node:assert/strict';
import * as layout from '../public/room-ui.js';
import * as objects from '../public/table-objects.js';

test('hidden hands face the physical table center; the local hand remains upright',()=>{
  assert.equal(typeof layout.radialHandAngle,'function');
  const angle=layout.radialHandAngle;
  assert.equal(angle(50,95,300,500),0);assert.equal(angle(0,50,300,500),90);
  assert.equal(Math.abs(angle(50,5,300,500)),180);assert.equal(angle(100,50,300,500),-90);
  assert.ok(angle(25,10,300,500)>90);assert.ok(angle(75,10,300,500)<-90);
  assert.ok(angle(5,75,300,500)>0&&angle(5,75,300,500)<90);
  assert.equal(angle(5,75,300,500,true),0);
  assert.notEqual(angle(25,10,300,500),angle(25,10,1000,400));
});

test('revealed hands are upright from the current viewer at every seat and viewport',()=>{
  for(const [width,height] of [[300,500],[1920,1080]])for(const [x,y] of [[50,5],[0,50],[100,50],[25,10],[75,10],[5,75],[95,75]]){
    assert.equal(layout.radialHandAngle(x,y,width,height,false,true),0);
    assert.notEqual(layout.radialHandAngle(x,y,width,height,false,false),0);
  }
});
test('chip obstacle padding keeps visible clearance beyond rotated card bounds',()=>{
  assert.equal(typeof objects.paddedObstacle,'function');
  const card={left:80,top:80,width:48,height:40},obstacle=objects.paddedObstacle(card,6);
  assert.deepEqual(obstacle,{left:74,top:74,width:60,height:52});
  const p=objects.placeObject({x:104,y:100,width:42,height:30,bounds:{width:240,height:400},obstacles:[obstacle]});
  assert.ok(p.left+p.width<=74||p.left>=134||p.top+p.height<=74||p.top>=126);
});
test('placement preserves a seat sector instead of relocating a hand to another player',()=>{
  const allowed=r=>r.left+r.width/2<110&&r.top+r.height/2>150;
  const p=objects.placeObject({x:70,y:200,width:30,height:24,bounds:{width:220,height:350},obstacles:[{left:50,top:185,width:45,height:30}],edgeWeight:0,allowed});
  assert.ok(allowed(p));assert.ok(p.left+p.width<=50||p.left>=95||p.top+p.height<=185||p.top>=215);
});
