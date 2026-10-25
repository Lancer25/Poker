export function renderForecast(value) {
  const panel=document.getElementById('forecastPanel'),status=document.getElementById('forecastStatus'),body=document.getElementById('forecastBody');
  panel.hidden=value.status==='hidden';body.hidden=value.status!=='ready';
  status.textContent=value.status==='loading'?'正在计算河牌潜力':value.status==='error'?'预测暂不可用':'';
  if(value.status!=='ready')return;
  const f=value.data;document.getElementById('forecastMethod').textContent=f.method==='simulation'?`模拟估算 · ${f.samples.toLocaleString()} 次`:`精确枚举 · ${f.samples.toLocaleString()} 种`;
  document.getElementById('forecastCeiling').textContent=(f.boardCount===5?'最终牌型 · ':'理论可达上限 · ')+f.ceiling.label;
  document.getElementById('forecastNote').textContent=f.ceiling.preflop?'翻牌前各手牌均可能由公共牌组成皇家同花顺，上限不代表起手牌强弱。模拟未采样到不等于不可能。':'按当前已知牌计算最终最佳五张牌；这是成牌概率，不是获胜概率。';
  const top=document.getElementById('forecastTop'),all=document.getElementById('forecastAll');top.replaceChildren();all.replaceChildren();
  const rows=[...f.probabilities].sort((a,b)=>b.count-a.count);
  rows.forEach((p,i)=>{const row=document.createElement('div');row.className='forecast-row';const name=document.createElement('span'),bar=document.createElement('progress'),number=document.createElement('span');name.textContent=p.label;bar.max=100;bar.value=p.percent;bar.setAttribute('aria-label',p.label+'成牌概率');number.textContent=f.method==='simulation'&&p.count===0?'未采样到':p.percent.toFixed(2)+'%';row.append(name,bar,number);(i<3?top:all).append(row);});
}
