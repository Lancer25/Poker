import {parentPort} from 'node:worker_threads';import {computeForecast} from './hand-forecast.js';
parentPort.on('message',({id,input})=>{try{parentPort.postMessage({id,result:computeForecast(input)});}catch{parentPort.postMessage({id,error:'预测计算暂不可用'});}});
