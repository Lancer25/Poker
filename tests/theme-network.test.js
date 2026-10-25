import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {once} from 'node:events';
import http from 'node:http';
import {seedAccounts} from './auth-helpers.js';

test('theme assets use explicit public routes and image MIME/cache, never expose source masters or private data',{timeout:15000},async t=>{
 const dir=mkdtempSync(path.join(tmpdir(),'holdem-theme-static-'));await seedAccounts(dir);
 const child=spawn(process.execPath,['server/index.js'],{env:{...process.env,PORT:'0',HOST:'127.0.0.1',DATA_DIR:dir},stdio:['ignore','pipe','pipe']});
 t.after(async()=>{if(child.exitCode===null){const exited=once(child,'exit');child.kill();await exited;}assert.equal(path.dirname(dir),path.resolve(tmpdir()));rmSync(dir,{recursive:true,force:true});});
 const port=Number((await once(child.stdout,'data'))[0].toString().match(/localhost:(\d+)/)[1]);
 const get=route=>new Promise((resolve,reject)=>{http.get({hostname:'127.0.0.1',port,path:route},response=>{const chunks=[];response.on('data',chunk=>chunks.push(chunk));response.on('end',()=>resolve({status:response.statusCode,headers:response.headers,body:Buffer.concat(chunks)}));response.on('error',reject);}).on('error',reject);});
 for(const name of ['tables','avatars','chips']){const response=await get(`/assets/themes/${name}-v1.webp`);assert.equal(response.status,200);assert.equal(response.headers['content-type'],'image/webp');assert.match(response.headers['cache-control'],/immutable/);assert.deepEqual(response.body,readFileSync(`public/assets/themes/${name}-v1.webp`));}
 for(const name of ['tables-wide-v2','tables-portrait-v2']){const response=await get(`/assets/themes/${name}.webp`);assert.equal(response.status,200);assert.equal(response.headers['content-type'],'image/webp');assert.deepEqual(response.body,readFileSync(`public/assets/themes/${name}.webp`));}
 for(const route of ['/theme.js','/themes.css','/room-ui.js','/assets/icons/minus.svg','/assets/icons/plus.svg','/assets/icons/eye.svg'])assert.equal((await get(route)).status,200);
 for(const route of ['/assets/themes/tables-v1.png','/assets/themes/../../server/index.js','/data/accounts.json','/server/manual-reveal.js'])assert.equal((await get(route)).status,404);
 const root=await get('/');assert.match(root.body.toString(),/theme\.js/);assert.match(root.body.toString(),/data-theme-picker/);
});
