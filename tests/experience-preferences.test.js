import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { ExperiencePreferences } from '../public/experience-preferences.js';
function harness(saved = {}, extras = {}) {
  const data = new Map(Object.entries(saved)), listeners = {};
  const c = { window: { addEventListener() {}, ...extras }, document: {
    hidden: false, body: { classList: { toggle() {} } },
    addEventListener(name, fn) { listeners[name] = fn; }, querySelectorAll: () => [],
  }, navigator: {}, localStorage: {getItem: k => data.get(k) ?? null, setItem: (k,v) => data.set(k,v)},
  sessionStorage: { getItem: () => null }, matchMedia: () => ({ matches: false }), ExperiencePreferences };
  vm.createContext(c);
  vm.runInContext(fs.readFileSync('miniprogram/utils/table-experience.js', 'utf8'), c);
  c.window.TableExperience = c.TableExperience;
  vm.runInContext(fs.readFileSync('public/table-feedback.js','utf8').replace(/^import .*;\r?\n/gm,'').replace('export class TableFeedback','class TableFeedback') + ';globalThis.Feedback=TableFeedback', c);
  return { c, f: new c.Feedback(), data, listeners };
}
test('device legacy choices never migrate to accounts; all five choices remain scoped', () => {
  const { f, data } = harness({'holdem-experience': JSON.stringify({sound:true, volume:.8, vibration:true, motion:false, fourColor:true})});
  assert.equal(f.settings.sound,true);
  f.setAccount('alice'); assert.equal(f.settings.sound,false);
  const alice = {sound:true, volume:.2, vibration:true, motion:false, fourColor:true};
  f.configure(alice); f.setAccount('bob');
  assert.equal(f.settings.volume,.35); assert.equal(f.settings.fourColor,false);
  f.configure({volume:.6}); f.setAccount('alice');
  assert.deepEqual({...f.settings},alice);
  f.setAccount(null); assert.equal(f.settings.volume,.8);
  assert.equal(JSON.parse(data.get('holdem-experience')).volume,.8);
});
test('storage denial retains session choices and normalizes values', () => {
  const store = new ExperiencePreferences(v => ({volume: Number.isFinite(v?.volume) ? Math.max(0, Math.min(1,v.volume)) : .35}), {getItem(){throw Error();}, setItem(){throw Error();}});
  store.setAccount('a'); store.save({volume:4}); store.setAccount('b');
  assert.equal(store.load().volume,.35); store.setAccount('a'); assert.equal(store.load().volume,1);
});
test('capabilities reflect actual browser, gesture, visibility and context state', async () => {
  const {f,c} = harness(); assert.equal(f.capabilities.sound,'unavailable');
  assert.equal(f.capabilities.vibration,'unsupported');
  c.window.AudioContext = class {state='suspended'; async resume(){this.state='running';}};
  c.navigator.vibrate = () => true; c.navigator.userActivation = {hasBeenActive:false};
  assert.equal(f.capabilities.sound,'needs-gesture'); assert.equal(f.capabilities.vibration,'needs-gesture');
  let status; f.onStatus = value => {status=value;};
  f.configure({sound:true}); assert.equal(f.audio,null);
  assert.equal(await f.unlock(),true); assert.equal(status.sound,'ready');
  c.document.hidden=true; assert.equal(f.capabilities.sound,'needs-gesture');
});
test('account switch closes pending audio, cancels effects and never resumes automatically', async () => {
  let resolve, resumes=0, closed=0;
  const {f,c} = harness({}, {AudioContext: class {
    state='suspended'; resume(){resumes++;return new Promise(r=>{resolve=r;});}
    close(){closed++;this.state='closed';return Promise.resolve();}
  }});
  f.configure({sound:true}); const pending=f.unlock();
  let stopped=0,cancelled=0; f.voices.add({stop(){stopped++;}}); f.animations.add({cancel(){cancelled++;}});
  f.previous={id:'old'}; f.setAccount('new'); resolve();
  assert.equal(await pending,false); assert.equal(f.audio,null); assert.equal(f.previous,null);
  assert.equal(resumes,1); assert.equal(closed,1); assert.equal(stopped,1); assert.equal(cancelled,1);
  f.configure({sound:true}); assert.equal(resumes,1);
  c.document.hidden=true; assert.equal(await f.unlock(),false);
});

test('broken AudioContext is unavailable and resume rejection still needs a gesture', async () => {
  const {f,c} = harness({}, {AudioContext: class {constructor(){throw Error('unsupported');}}});
  f.configure({sound:true}); assert.equal(await f.unlock(),false);
  assert.equal(f.capabilities.sound,'unavailable');
  const other=harness({}, {AudioContext: class {state='suspended'; async resume(){throw Error('blocked');}}}).f;
  other.configure({sound:true}); assert.equal(await other.unlock(),false);
  assert.equal(other.capabilities.sound,'needs-gesture');
});
