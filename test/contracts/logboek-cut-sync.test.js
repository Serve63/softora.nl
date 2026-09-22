const test=require('node:test');
const assert=require('node:assert/strict');
const state=require('../../assets/logboek-cut-state');
const createCutSyncFor=require('../../assets/logboek-cut-sync');
const pause=()=>new Promise(resolve=>setImmediate(resolve));
function client({fetchImpl,now=()=>new Date('2026-09-22T12:00:00Z').getTime()}) {
  const listeners={};let latest;
  class Clock extends Date {constructor(...args){super(...(args.length?args:[now()]));}static now(){return now();}}
  const target={LogboekCutState:state,addEventListener:(key,fn)=>listeners[key]=fn,Date:Clock,
    crypto:require('node:crypto').webcrypto,AbortSignal,
    document:{visibilityState:'visible',addEventListener:(key,fn)=>listeners[key]=fn},setInterval:fn=>listeners.timer=fn};
  const sync=createCutSyncFor(target)({fetchImpl,onChange:value=>latest=value});
  return {sync,listeners,get latest(){return latest;}};
}
test('offline intent stays queued in memory and retries with the same operation id',async()=>{
  let online=true,posts=[];
  let session={training_date:'2026-09-22',exercises:[{order:1,sets:2}],checks:{}};
  const fetchImpl=async(_url,options)=>{
    if(!online)throw Error('offline');
    if(options.method==='POST') {const op=JSON.parse(options.body);posts.push(op);session.checks[`${op.order}:${op.set}`]={done:op.done,version:1};}
    return {ok:true,status:200,json:async()=>({ok:true,session:JSON.parse(JSON.stringify(session))})};
  };
  const app=client({fetchImpl});app.sync.start();await pause();await pause();
  online=false;app.sync.toggle(1,0);await pause();assert.equal(app.latest.pending.length,1);const id=app.latest.pending[0].operationId;
  online=true;await app.sync.refresh();assert.equal(posts[0].operationId,id);assert.equal(app.latest.pending.length,0);assert.equal(app.latest.session.checks['1:0'].done,true);
});
test('midnight discards the old visible day while preserving its unsent intent',async()=>{
  let now=Date.parse('2026-09-22T21:59:59Z'),online=true;
  const fetchImpl=async()=>{if(!online)throw Error('offline');return {ok:true,status:200,json:async()=>({session:{training_date:state.dateKey(new Date(now)),exercises:[{order:1,sets:2}],checks:{}}})};};
  const app=client({fetchImpl,now:()=>now});app.sync.start();await pause();await pause();
  online=false;app.sync.toggle(1,0);await pause();now=Date.parse('2026-09-22T22:00:00Z');await app.sync.refresh();
  assert.equal(app.latest.today,'2026-09-23');assert.equal(app.latest.session,null);assert.equal(app.latest.pending[0].date,'2026-09-22');
});
