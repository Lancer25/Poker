export const BETTING_ACTIONS=new Set(['fold','check','call','raise','allin']);
function failure(message,code){const error=Error(message);error.code=code;return error;}
const key=d=>d&&JSON.stringify([d.room,d.round,d.hand,d.phase,d.version,d.player,d.deadline]);
const fingerprint=msg=>JSON.stringify([msg.type,msg.type==='raise'?msg.amount:null,key(msg.decision)]);
export function actionContext(room,player){
 if(!['preflop','flop','turn','river'].includes(room.phase)||room.flopReveal||room.players[room.turn]?.id!==player)return null;
 return {room:room.id,round:room.roundNumber||1,hand:room.hand,phase:room.phase,version:room.actionVersion||0,player,deadline:room.deadline};
}
export function validateAction(room,player,msg){
 if(typeof msg.requestId!=='string'||!/^[a-zA-Z0-9-]{1,80}$/.test(msg.requestId))
  throw failure('客户端操作信息缺失，请刷新后重新操作','action_context_required');
 const receipt=(room.actionReceipts||[]).find(r=>r.player===player&&r.requestId===msg.requestId);
 if(receipt){if(receipt.fingerprint!==fingerprint(msg))throw failure('重复操作标识与原请求不一致','action_id_conflict');return {requestId:msg.requestId,status:'already_applied',version:receipt.version};}
 if(room.flopReveal)throw failure('翻牌中，请等待公共牌全部翻开','action_unavailable');
 if(room.players[room.turn]?.id!==player)throw failure('还没轮到你，操作已过期','action_wrong_turn');
 if(!msg.decision)throw failure('客户端操作信息缺失，请刷新后重新操作','action_context_required');
 const expected=actionContext(room,player);
 if(!expected||key(expected)!==key(msg.decision))throw failure('操作已过期，请根据当前牌局重新决策','action_stale');
 return null;
}
export function recordActionReceipt(room,player,msg){
 const receipt={player,requestId:msg.requestId,fingerprint:fingerprint(msg),version:room.actionVersion||0};
 room.actionReceipts=[...(room.actionReceipts||[]),receipt].slice(-128);
 return {requestId:msg.requestId,status:'applied',version:receipt.version};
}
