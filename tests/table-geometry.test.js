import test from 'node:test';
import assert from 'node:assert/strict';
import {fitTableFrame} from '../public/room-ui.js';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import sharp from 'sharp';

test('table frame preserves native aspect ratio instead of stretching to its available viewport',()=>{
 for(const [width,height,ratio]of [[1424,790,2],[2000,520,2],[500,700,2],[390,470,.75],[390,325,.75],[320,390,.75]]){
   const frame=fitTableFrame(width,height,ratio);assert.ok(frame.width<=width+.01);assert.ok(frame.height<=height+.01);assert.ok(Math.abs(frame.width/frame.height-ratio)<.00001);assert.ok(frame.width===width||frame.height===height);
 }
});
test('hidden or invalid table sizes cannot produce NaN, infinity or a zero-ratio layout',()=>{
 for(const [width,height,ratio]of [[0,300,2],[300,0,2],[NaN,300,2],[300,300,0],[300,300,Infinity]])assert.deepEqual(fitTableFrame(width,height,ratio),{width:0,height:0});
});
test('configured table aspect ratios match the actual portrait columns and landscape rows',async()=>{
 const context={module:{exports:{}}};vm.runInNewContext(readFileSync('public/theme.js','utf8'),context);
 for(const theme of context.module.exports.themes){
   const wide=await sharp('public/assets/themes/tables-wide-v7.webp').metadata(),portrait=await sharp('public/assets/themes/tables-portrait-v7.webp').metadata();
   assert.equal(wide.width/(wide.height/3),Number(theme.tokens['--table-wide-ratio']));
   assert.equal((portrait.width/3)/(portrait.height*Number(theme.tokens['--table-portrait-window'])),Number(theme.tokens['--table-ratio']));
 }
});
