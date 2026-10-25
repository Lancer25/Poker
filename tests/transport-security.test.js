import test from 'node:test';import assert from 'node:assert/strict';import {transportInfo,requireSecureTransport} from '../server/transport-security.js';
test('secure-auth policy rejects plain HTTP and untrusted forged proxy headers without breaking local compatibility mode',()=>{
 const req={headers:{host:'example.test','x-forwarded-proto':'https'},socket:{remoteAddress:'203.0.113.5'}};
 assert.equal(transportInfo(req).secure,false);assert.throws(()=>requireSecureTransport(req,true),/HTTPS/);assert.doesNotThrow(()=>requireSecureTransport(req,false));
 req.socket.remoteAddress='127.0.0.1';assert.equal(transportInfo(req).secure,true);assert.doesNotThrow(()=>requireSecureTransport(req,true));
 req.headers['x-forwarded-proto']='http';req.socket.encrypted=true;assert.equal(transportInfo(req).secure,true);
});
