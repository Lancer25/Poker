import {Worker} from 'node:worker_threads';import {normalizeForecastInput,forecastKey} from './hand-forecast.js';
export class ForecastService {
  constructor({maxQueue=32,maxCache=128,ttl=600000,timeout=15000}={}){Object.assign(this,{maxQueue,maxCache,ttl,timeout});this.cache=new Map();this.pending=new Map();this.queue=[];this.sequence=0;this.worker=null;this.current=null;}
  run(input){
    const normalized=normalizeForecastInput(input),key=forecastKey(normalized),cached=this.cache.get(key);
    if(cached && Date.now()-cached.at<this.ttl)return Promise.resolve(cached.result);
    if(this.pending.has(key))return this.pending.get(key).promise;
    if(this.pending.size>=this.maxQueue)return Promise.reject(Object.assign(Error('预测计算繁忙，请稍后重试'),{status:503}));
    let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;}),job={id:++this.sequence,key,input:normalized,promise,resolve,reject};
    this.pending.set(key,job);this.queue.push(job);try{this.pump();}catch{this.fail();}return promise;
  }
  pump(){
    if(this.current)return;
    const job=this.queue.shift();if(!job){this.worker?.unref();return;}
    if(!this.worker){
      const worker=this.worker=new Worker(new URL('./forecast-worker.js',import.meta.url),{execArgv:[]});
      worker.on('message',message=>{if(this.worker!==worker||this.current?.id!==message.id)return;const task=this.current;clearTimeout(task.timer);this.current=null;this.pending.delete(task.key);
        if(message.error)task.reject(Object.assign(Error(message.error),{status:503}));
        else{this.cache.delete(task.key);this.cache.set(task.key,{result:message.result,at:Date.now()});while(this.cache.size>this.maxCache)this.cache.delete(this.cache.keys().next().value);task.resolve(message.result);}this.pump();});
      worker.on('error',()=>{if(this.worker===worker)this.fail();});worker.on('exit',()=>{if(this.worker===worker)this.fail();});
    }
    this.current=job;this.worker.ref();job.timer=setTimeout(()=>this.fail(),this.timeout);this.worker.postMessage({id:job.id,input:job.input});
  }
  fail(){const worker=this.worker;this.worker=null;const error=Object.assign(Error('预测计算暂不可用，请稍后重试'),{status:503});for(const job of this.pending.values()){clearTimeout(job.timer);job.reject(error);}this.current=null;this.pending.clear();this.queue=[];worker?.terminate();}
  async close(){const worker=this.worker;this.worker=null;for(const job of this.pending.values()){clearTimeout(job.timer);job.reject(Error('预测服务已关闭'));}this.current=null;this.pending.clear();this.queue=[];if(worker)await worker.terminate();}
}
