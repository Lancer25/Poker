import test from 'node:test';
import assert from 'node:assert/strict';
import {portraitSeatScale,holeCardSide,inwardHandAnchor,outerSeatPositions} from '../public/room-ui.js';

test('short portrait tables scale seats inside the fitted frame rather than enlarging the stage',()=>{
 assert.equal(portraitSeatScale(390,true),1);
 assert.equal(portraitSeatScale(200,true),200/240);
 assert.equal(portraitSeatScale(138,true),138/240);
 assert.equal(portraitSeatScale(200,false),1);
});
test('all dealt hands face inward, including the private bottom hand',()=>{
 assert.equal(holeCardSide(25,12,true),'right');
 assert.equal(holeCardSide(75,12,true),'left');
 assert.equal(holeCardSide(14,38,true),'right');
 assert.equal(holeCardSide(86,38,true),'left');
 assert.equal(holeCardSide(50,10,true),'bottom');
 assert.equal(holeCardSide(50,94,true,true),'top');
 assert.equal(holeCardSide(14,38,true,true),'right');
 assert.equal(holeCardSide(86,38,true,true),'left');
});
test('cards lie between their outer seat and the center for every supported player count',()=>{
 for(const portrait of [false,true])for(let count=2;count<=9;count++){
  const seats=outerSeatPositions(count,portrait);assert.equal(seats.length,count);
  for(const [index,[x,y]]of seats.entries()){
   const hand=inwardHandAnchor(x,y,index===0);
   assert.ok(Math.hypot(hand.x-50,hand.y-50)<Math.hypot(x-50,y-50));
   assert.ok(hand.x>=8&&hand.x<=92&&hand.y>=8&&hand.y<=92);
  }
 }
 const a=outerSeatPositions(7,true);a[0][0]=0;assert.equal(outerSeatPositions(7,true)[0][0],50);
});
test('a newly created single-player waiting room keeps its private-hand anchor',()=>{
 assert.deepEqual(outerSeatPositions(1,true),[[50,94]]);
 assert.deepEqual(outerSeatPositions(1,false),[[50,92]]);
});
