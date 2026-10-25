import solver from 'pokersolver';import {createHash} from 'node:crypto';
const deck=[...'23456789TJQKA'].flatMap(r=>[...'shdc'].map(s=>r+s));
const labels=['高牌','一对','两对','三条','顺子','同花','葫芦','四条','同花顺','皇家同花顺'];
const keys=['high','pair','twoPair','trips','straight','flush','fullHouse','quads','straightFlush','royalFlush'];
export function normalizeForecastInput({cards,board}) {
  if(!Array.isArray(cards)||cards.length!==2||!Array.isArray(board)||![0,3,4,5].includes(board.length))throw Error('预测牌面无效');
  const visible=[...cards,...board];if(visible.some(c=>!deck.includes(c))||new Set(visible).size!==visible.length)throw Error('预测牌面无效');
  return {cards:[...cards].sort(),board:[...board].sort()};
}
export function forecastKey(input){return JSON.stringify(normalizeForecastInput(input));}
function category(cards) {
  const hand=solver.Hand.solve(cards);
  return hand.rank===9 && ['A','1'].includes(hand.cards[0].value)?9:hand.rank-1;
}
// A visible-input-only deterministic stream, separate from the game's deal RNG.
function simulationDraw(seed) {
  let buffer=Buffer.alloc(0),offset=0,counter=0;
  return n=>{const limit=65536-65536%n;while(true){if(offset+2>buffer.length){buffer=createHash('shake256',{outputLength:65536}).update(seed+':'+counter++).digest();offset=0;}const value=buffer.readUInt16LE(offset);offset+=2;if(value<limit)return value%n;}};
}
export function computeForecast(input,{samples=10000}={}) {
  const {cards,board}=normalizeForecastInput(input),visible=[...cards,...board],unknown=deck.filter(c=>!visible.includes(c)),counts=Array(10).fill(0);let maximum=0,total=0;
  const count=extra=>{const index=category([...visible,...extra]);counts[index]++;maximum=Math.max(maximum,index);total++;};
  if(board.length===5)count([]);
  else if(board.length===4)for(const card of unknown)count([card]);
  else if(board.length===3)for(let i=0;i<unknown.length-1;i++)for(let j=i+1;j<unknown.length;j++)count([unknown[i],unknown[j]]);
  else {
    if(!Number.isSafeInteger(samples)||samples<64||samples>20000)throw Error('模拟样本数无效');
    const draw=simulationDraw(JSON.stringify({cards,board}));
    for(let n=0;n<samples;n++){const remaining=[...unknown];for(let i=0;i<5;i++){const j=i+draw(remaining.length-i);[remaining[i],remaining[j]]=[remaining[j],remaining[i]];}count(remaining.slice(0,5));}
    maximum=9;
  }
  const scaled=counts.map(c=>c/total*10000),points=scaled.map(Math.floor),order=scaled.map((v,i)=>({i,fraction:v-points[i]})).sort((a,b)=>b.fraction-a.fraction);
  for(let i=0,left=10000-points.reduce((a,b)=>a+b,0);i<left;i++)points[order[i].i]++;
  return {method:board.length?'exact':'simulation',samples:total,boardCount:board.length,
    ceiling:{key:keys[maximum],label:labels[maximum],preflop:board.length===0},
    probabilities:keys.map((key,i)=>({key,label:labels[i],count:counts[i],percent:points[i]/100})),
  };
}
