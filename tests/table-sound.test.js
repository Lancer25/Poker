import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';
function harness(){
 const c={window:{},document:{hidden:false,body:{classList:{toggle(){}}},addEventListener(){},querySelectorAll:()=>[]},navigator:{},localStorage:{getItem:()=>null},sessionStorage:{getItem:()=>null},matchMedia:()=>({matches:false})};
 vm.createContext(c);vm.runInContext(fs.readFileSync('miniprogram/utils/table-experience.js','utf8'),c);c.window.TableExperience=c.TableExperience;c.window.addEventListener=()=>{};
 vm.runInContext(fs.readFileSync('public/table-feedback.js','utf8').replace(/^import .*;\r?\n/gm,'').replace('export class TableFeedback','class TableFeedback')+';globalThis.Feedback=TableFeedback',c);
 const f=new c.Feedback(),sources=[];
 const param={setValueAtTime(){},linearRampToValueAtTime(){},exponentialRampToValueAtTime(){}};
 const node=()=>({connect(){},disconnect(){},start(t){sources.push(t);},stop(){},frequency:{value:0},gain:param,Q:{value:0}});
 f.audio={state:'running',currentTime:0,sampleRate:1000,destination:{},createOscillator:node,createGain:node,createBiquadFilter:node,createBufferSource:node,createBuffer:(_c,n)=>({getChannelData:()=>new Float32Array(n)})};
 return {f,c,sources};
}
test('physical dice roll and land effects are bounded and respect mute, hidden and suspended audio',()=>{
 const {f,c,sources}=harness();f.sound('dice');assert.equal(sources.length,0);
 f.settings.sound=true;f.sound('dice');assert.ok(sources.length>=5);assert.ok(f.voices.size<=24);
 const n=sources.length;c.document.hidden=true;f.sound('dice');assert.equal(sources.length,n);
 c.document.hidden=false;f.audio.state='suspended';f.sound('flip');assert.equal(sources.length,n);
 f.audio.state='running';f.settings.volume=0;f.sound('allin');assert.equal(sources.length,n);
});
test('new table cues produce audio without owning any gameplay timer',()=>{
 const {f,sources}=harness();f.settings.sound=true;
 for(const kind of ['flip','fold','check','allin']){f.voices.clear();const n=sources.length;f.sound(kind);assert.ok(sources.length>n,kind);}
});
