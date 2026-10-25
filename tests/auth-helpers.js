import { AccountStore } from "../server/accounts.js";
import http from 'node:http';

export const testPassword = "TestFriends123!";
export async function seedAccounts(directory) {
  const store = new AccountStore(directory);
  const admin = await store.bootstrapAdmin({
    username: "admin",
    nickname: "Admin",
    password: testPassword,
  });
  const invite = store.createInvite(admin.id, { maxUses: 50, days: 30 });
  return { admin, invite, store };
}
export async function apiAt(
  port,
  pathname,
  method = "GET",
  input,
  token,
  headers = {},
) {
  // Ephemeral localhost test ports can be blocked by fetch's browser-port policy.
  return new Promise((resolve,reject)=>{
    const request=http.request({hostname:'127.0.0.1',port,path:pathname,method,headers:{
      ...(input===undefined?{}:{'Content-Type':'application/json'}),...(token?{Authorization:'Bearer '+token}:{}),...headers,
    }},response=>{
      const chunks=[];response.on('data',chunk=>chunks.push(chunk));response.on('error',reject);response.on('end',()=>{
        try{const resultHeaders=new Headers();for(const [key,value]of Object.entries(response.headers))for(const item of [].concat(value||[]))resultHeaders.append(key,item);
          resolve({status:response.statusCode,data:JSON.parse(Buffer.concat(chunks).toString()),headers:resultHeaders});}catch(error){reject(error);}
      });
    });request.on('error',reject);if(input!==undefined)request.write(JSON.stringify(input));request.end();
  });
}
export async function registerAt(port, inviteCode, username, nickname) {
  const result = await apiAt(port, "/api/auth/register", "POST", {
    username,
    nickname,
    password: testPassword,
    inviteCode,
  });
  if (result.status !== 200)
    throw Error(`Registration failed: ${result.data.error}`);
  return result.data;
}
