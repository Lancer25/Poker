import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import vm from 'node:vm';import sharp from 'sharp';
const c={module:{exports:{}}};vm.runInNewContext(readFileSync('miniprogram/utils/player-latency.js','utf8'),c);
test('web lightweight latency updates touch only existing badge nodes and leave game clock/history unchanged',()=>{
 const image={},value={},badge={dataset:{},setAttribute(k,v){this[k]=v;},querySelector:q=>q==='img'?image:value},seat={dataset:{player:'p'},querySelector:()=>badge};
 const players=[{id:'p',connection:{online:true,rttMs:180,measuredAt:1000}}],history=[],state={id:'r',serverTime:1000,players,history};let now=0;
 const context=vm.createContext({state,connected:true,playerPanel:{selected:null},PlayerLatency:c.module.exports,clockServerAtReceipt:1000,clockReceivedAt:0,playerLatencyServerAt:0,playerLatencyReceivedAt:0,performance:{now:()=>now},document:{querySelectorAll:q=>{assert.equal(q,'#seats .seat');return [seat];}}});
 const source=readFileSync('public/app.js','utf8');vm.runInContext(source.slice(source.indexOf('function latencyNow(){'),source.indexOf('const historyCache =')),context);
 context.refreshPlayerLatency();assert.match(badge.title,/180 毫秒/);assert.equal(image.src,'/assets/icons/signal-good.svg');assert.equal(value.textContent,undefined);context.receivePlayerLatency({room:'r',serverTime:1010,players:[{id:'p',connection:{online:true,rttMs:600,measuredAt:1010}}]});
 assert.match(badge.title,/600 毫秒/);assert.equal(image.src,'/assets/icons/signal-bad.svg');assert.equal(state.serverTime,1000);assert.equal(state.history,history);assert.equal(context.clockReceivedAt,0);assert.equal(context.clockServerAtReceipt,1000);
 context.receivePlayerLatency({room:'other',serverTime:1020,players:[]});assert.match(badge.title,/600 毫秒/);now=46000;context.refreshPlayerLatency();assert.match(badge.title,/过期/);assert.equal(value.textContent,undefined);
});
test('signal assets reuse Lucide geometry and render nonblank at normal and scaled icon sizes',async()=>{
 const original=readFileSync('node_modules/lucide-static/icons/signal.svg','utf8');const paths=s=>[...s.matchAll(/<path d="([^"]+)"/g)].map(m=>m[1]);
 for(const tone of ['good','warning','bad','muted']){
  const svg=readFileSync('miniprogram/assets/icons/signal-'+tone+'.svg','utf8');assert.match(svg,/@license lucide-static/);assert.match(svg,/viewBox="0 0 24 24"/);assert.deepEqual(paths(svg),paths(original));
  for(const size of [10,13]){const pixels=await sharp(Buffer.from(svg)).resize(size,size).ensureAlpha().raw().toBuffer();assert.ok(pixels.some((v,i)=>i%4===3&&v>0));}
 }
});
