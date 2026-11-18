import assert from 'node:assert/strict';
import test from 'node:test';
import {raisePanelPlacement, RoomUI} from '../public/room-ui.js';

const viewport = {left: 0, top: 0, right: 1280, bottom: 800};

test('desktop raise panel opens above and right-aligns to the raise control', () => {
  assert.deepEqual(raisePanelPlacement({top: 720, bottom: 764, right: 950}, viewport, 380, 340),
    {left: 570, top: 712, maxHeight: 704, opensAbove: true});
});

test('desktop raise panel flips below when there is more room and clamps horizontally', () => {
  const view = {left: 100, top: 40, right: 620, bottom: 400};
  assert.deepEqual(raisePanelPlacement({top: 100, bottom: 144, right: 650}, view, 380, 300),
    {left: 232, top: 152, maxHeight: 240, opensAbove: false});
  assert.equal(raisePanelPlacement({top: 100, bottom: 144, right: 140}, view, 380, 300).left, 108);
});

test('mobile drawer limits available height below the public board without changing input focus',t=>{
  const oldDocument=globalThis.document,oldWindow=globalThis.window;
  const values={};
  globalThis.window={visualViewport:{offsetTop:0,height:568}};
  globalThis.document={querySelector:()=>null,getElementById:()=>({getClientRects:()=>[{}],getBoundingClientRect:()=>({bottom:330,height:50})})};
  t.after(()=>{globalThis.document=oldDocument;globalThis.window=oldWindow;});
  const ui=Object.create(RoomUI.prototype);ui.mobile={matches:true};
  ui.raiseDialog={open:true,dataset:{placement:'above'},style:{setProperty:(key,value)=>{values[key]=value;}}};
  ui.positionRaisePanel();
  assert.equal(values['--raise-available-height'],'226px');assert.equal(ui.raiseDialog.dataset.placement,undefined);
});

test('the open panel preserves the draft and closes when the decision changes or becomes unavailable', t => {
  const amount = {value: '415', removeAttribute() { delete this.invalid; }};
  const confirm = {};
  const error = {hidden: true};
  const trigger = {disabled: false, getAttribute: () => '加注 415'};
  const nodes = {betAmount: amount, confirmRaise: confirm, raiseError: error};
  const previous = globalThis.document;
  globalThis.document = {getElementById: id => nodes[id], querySelector: () => trigger};
  t.after(() => { globalThis.document = previous; });
  const ui = Object.create(RoomUI.prototype);
  const reset = () => {
    ui.raiseKey = 'turn';
    ui.raiseSubmit = () => assert.fail('refresh must never submit');
    ui.raiseDialog = {open: true, dataset: {}, close() { this.open = false; }};
  };

  reset();
  ui.refreshRaise(true, 'turn');
  assert.equal(ui.raiseDialog.open, true);
  assert.equal(amount.value, '415');
  assert.equal(confirm.textContent, '确认加注 415');

  ui.refreshRaise(true, 'next-turn');
  assert.equal(ui.raiseDialog.open, false);
  assert.equal(ui.raiseSubmit, null);

  reset();
  trigger.disabled = true;
  ui.refreshRaise(true, 'turn');
  assert.equal(confirm.disabled, true);
  assert.equal(ui.raiseDialog.open, false);
});
