import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const context={module:{exports:{}}};vm.runInNewContext(readFileSync('public/theme.js','utf8'),context);
const {themes,createThemeStore}=context.module.exports;
function storage(){const values=new Map();return {getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value)};}
test('themes expose one complete stable token contract and default to fresh',()=>{
 assert.equal(themes.length,3);assert.equal(new Set(themes.map(t=>t.id)).size,3);
 const keys=Object.keys(themes[0].tokens).sort().join(',');for(const theme of themes){assert.equal(Object.keys(theme.tokens).sort().join(','),keys);assert.ok(theme.label);}
 assert.equal(createThemeStore(storage()).current(),'fresh');
});
test('theme choice is account-scoped and restores without mixing other preferences',()=>{
 const data=storage(),store=createThemeStore(data);data.setItem('holdem-experience','sound settings');store.select('classic');store.setAccount('a');store.select('arena');store.setAccount('b');store.select('fresh');store.setAccount('a');assert.equal(store.current(),'arena');
 const restored=createThemeStore(data);restored.setAccount('a');assert.equal(restored.current(),'arena');restored.setAccount('b');assert.equal(restored.current(),'fresh');assert.equal(data.getItem('holdem-experience'),'sound settings');
});
test('unknown themes and unavailable/corrupt storage are safe and never accept arbitrary CSS',()=>{
 const data=storage();data.setItem('holdem-theme','url(evil)');const store=createThemeStore(data);assert.equal(store.current(),'fresh');store.select('classic');store.select('__proto__');assert.equal(store.current(),'classic');
 const broken=createThemeStore({getItem(){throw Error('disabled');},setItem(){throw Error('disabled');}});assert.equal(broken.current(),'fresh');broken.select('arena');assert.equal(broken.current(),'arena');
});
