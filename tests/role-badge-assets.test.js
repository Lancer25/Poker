import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import sharp from 'sharp';
import {ROLE_BADGES} from '../public/chip-display.js';

test('each poker role resolves to its own small nonletter raster texture and accessible label',()=>{
 for(const [role,label]of [['dealer','庄家'],['small-blind','小盲'],['big-blind','大盲']]){
  assert.equal(ROLE_BADGES[role].label,label);
  assert.equal(ROLE_BADGES[role].src,`/assets/badges/role-${role}-v1.webp`);
 }
});
test('badge exports preserve alpha, are lightweight and remain visible at mobile/desktop sizes',async()=>{
 for(const role of ['dealer','small-blind','big-blind']){
  const file=`public${ROLE_BADGES[role].src}`,meta=await sharp(file).metadata();
  assert.equal(meta.width,96);assert.equal(meta.height,96);assert.equal(meta.hasAlpha,true);
  assert.ok(fs.statSync(file).size<12000);
  const raw=await sharp(file).ensureAlpha().raw().toBuffer();assert.equal(raw[3],0);
  for(const size of [8,12,16,20]){
   const pixels=await sharp(file).resize(size,size).ensureAlpha().raw().toBuffer();
   assert.ok(pixels.filter((value,index)=>index%4===3&&value>150).length>size*size*.3);
  }
 }
});
