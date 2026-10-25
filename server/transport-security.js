export function transportInfo(req,{enforced=false,httpsURL=process.env.PUBLIC_HTTPS_URL}={}){
 const address=req.socket.remoteAddress?.replace(/^::ffff:/,''),local=['127.0.0.1','::1'].includes(address);
 const secure=!!req.socket.encrypted||(local&&req.headers['x-forwarded-proto']==='https');
 let target=null;try{const url=new URL(httpsURL);if(url.protocol==='https:'&&!url.username&&!url.password)target=url.origin+'/';}catch{}
 return {secure,enforced,httpsURL:target};
}
export function requireSecureTransport(req,enforced){
 if(enforced&&!transportInfo(req).secure){const error=Error('请使用 HTTPS 安全连接');error.status=426;throw error;}
}
