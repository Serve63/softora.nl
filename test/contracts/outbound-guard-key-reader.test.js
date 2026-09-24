const test = require('node:test');
const assert = require('node:assert/strict');
const {readOutboundGuardKeys,readGuardSetWithRetry} = require('../../server/services/outbound-guard-key-reader');
test('guard batch retries a failed read and retains every matched guard',async()=>{
 let calls=0;
 const result=await readOutboundGuardKeys({run:async(_label,_operation,options)=>{
  calls++;if(calls===1)return {ok:false};
  assert.equal(options.bypassReadFailureCooldown,true);
  return {ok:true,data:[{guard_key:'email:existing@example.nl'}]};
 },normalizeString:s=>String(s||'').trim(),defaultTimeoutMs:10000},['email:existing@example.nl']);
 assert.equal(calls,2);assert.deepEqual(result,['email:existing@example.nl']);
});
test('persistent guard failure still refuses to produce an unguarded result',async()=>{
 let calls=0;
 const result=await readOutboundGuardKeys({run:async()=>{calls++;return {ok:false};},normalizeString:String,defaultTimeoutMs:10000},['one']);
 assert.equal(calls,2);assert.equal(result,null);
});
test('legacy guard read retries null but accepts an authoritative empty set',async()=>{
 let calls=0;const guarded=new Set(['guard']);
 assert.equal(await readGuardSetWithRetry(async()=>++calls===1?null:guarded),guarded);
 assert.equal(calls,2);calls=0;
 await readGuardSetWithRetry(async()=>{calls++;return new Set();});assert.equal(calls,1);
 assert.equal(await readGuardSetWithRetry(async()=>null),null);
});
