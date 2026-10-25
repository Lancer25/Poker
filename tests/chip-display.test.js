import test from 'node:test';import assert from 'node:assert/strict';
import fs from 'node:fs';import sharp from 'sharp';
import {chipBreakdown,payoutTransfers} from '../public/chip-display.js';
import {seatDensity} from '../public/room-ui.js';
test('20 is two 10 chips, 100 is one 100 chip, zero has no chip picture',()=>{
 assert.deepEqual(chipBreakdown(20),[{value:10,count:2}]);assert.deepEqual(chipBreakdown(100),[{value:100,count:1}]);assert.deepEqual(chipBreakdown(0),[]);
});
test('very narrow tables may use one exact denomination column without losing any chips',()=>{
 assert.deepEqual(chipBreakdown(160,1),[{value:10,count:16}]);
 assert.deepEqual(chipBreakdown(1680,1),[{value:10,count:168}]);
 assert.equal(chipBreakdown(160).length,3);
});
test('five-chip totals are exact and legacy artwork omits only sub-five residuals',()=>{
 for(let i=0;i<5000;i++){const n=i*19999%100000000,groups=chipBreakdown(n);assert.ok(groups.length<=3);assert.equal(groups.reduce((sum,g)=>sum+g.value*g.count,0),Math.floor(n/5)*5);assert.ok(groups.every(g=>Number.isSafeInteger(g.count)&&g.count>0&&g.value>=5));}
 for(const n of [-1,NaN,Infinity,1.2])assert.deepEqual(chipBreakdown(n),[]);
});
test('seat density uses fixed desktop/mobile size bands, accounting for crowded rooms',()=>{
 assert.equal(seatDensity(1400,700,5,false),'desktop-large');assert.equal(seatDensity(1000,550,9,false),'desktop');assert.equal(seatDensity(1000,500,9,false),'desktop-compact');
 assert.equal(seatDensity(360,540,2,true),'mobile-roomy');assert.equal(seatDensity(360,540,9,true),'mobile');assert.equal(seatDensity(280,420,9,true),'mobile-compact');
});
test('payout pictures include the last decision contribution and refunds, but never rebuy money',()=>{
 const a={id:'r',hand:1,players:[{id:'a',stack:1000,totalBet:0,buyin:1000},{id:'b',stack:500,totalBet:500,buyin:1000}]};
 const b={id:'r',hand:1,players:[{id:'a',stack:2100,totalBet:100,buyin:2000},{id:'b',stack:550,totalBet:500,buyin:1000}]};
 assert.deepEqual(payoutTransfers(a,b),[{id:'a',amount:200},{id:'b',amount:50}]);assert.deepEqual(payoutTransfers(null,b),[]);assert.deepEqual(payoutTransfers(a,{...b,hand:2}),[]);
});
test('top role charm art has no letter glyphs and stays visible at 100% and 125% sizes',async()=>{
 for(const role of ['dealer','small-blind','big-blind']){
  const svg=fs.readFileSync(`public/assets/icons/charm-${role}.svg`);assert.doesNotMatch(svg.toString(),/<text/);assert.match(svg.toString(),/viewBox="0 0 32 32"/);
  for(const size of [15,19,22,28,32]){const pixels=await sharp(svg).resize(size,size).ensureAlpha().raw().toBuffer();assert.ok(pixels.filter((v,i)=>i%4===3&&v>0).length>20);}
 }
});

test('role insignia use a diamond, one ring and two concentric rings without hanging chip decorations',()=>{
 const read=role=>fs.readFileSync(`public/assets/icons/charm-${role}.svg`,'utf8');
 assert.match(read('dealer'),/data-insignia="diamond"/);
 for(const [role,count]of [['small-blind',1],['big-blind',2]]){
  const svg=read(role);assert.equal((svg.match(/<circle\b/g)||[]).length,count);
  assert.doesNotMatch(svg,/rotate\(|<text|<rect/);
 }
});
