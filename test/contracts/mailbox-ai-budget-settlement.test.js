'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { PGlite } = require('@electric-sql/pglite');
const { readUsage, mergeUsage } = require('../../server/services/mailbox-ai-usage');
const { createMailboxAiPresentations } = require('../../server/services/mailbox-ai-presentations');
const migration = fs.readFileSync(require.resolve('../../supabase/migrations/20260923105207_mailbox_ai_settle_usage.sql'), 'utf8');

test('usage prices cached input and long context per request; missing usage never becomes free', () => {
  const read = (input_tokens, output_tokens, cached_tokens=0) => readUsage({ model:'gpt-6-luna', service_tier:'default', usage:{input_tokens, output_tokens, input_tokens_details:{cached_tokens,cache_write_tokens:0}} });
  assert.equal(read(1000,100,800).billingMicroUsd,78);
  assert.equal(readUsage({usage:{input_tokens:1000,output_tokens:100,input_tokens_details:{cached_tokens:0,cache_write_tokens:1000}}}).billingMicroUsd,175);
  assert.equal(readUsage({usage:{input_tokens:1000,output_tokens:100}}).billingMicroUsd,175);
  assert.equal(read(300000,1000,0).billingMicroUsd,60750);
  assert.equal(mergeUsage(read(200000,100),read(200000,100)).billingMicroUsd,40100);
  for (const value of [{}, {usage:{input_tokens:0,output_tokens:0}}, {usage:{input_tokens:10,output_tokens:-1}},
    {usage:{input_tokens:10,output_tokens:1,input_tokens_details:{cached_tokens:11}}},
    {model:'other',usage:{input_tokens:10,output_tokens:1}}]) assert.equal(readUsage(value).complete,false);
  assert.equal(mergeUsage(read(1000,100),readUsage({})).billingMicroUsd,null);
});

async function database() {
  const db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create table public.softora_mailbox_messages (folder text, has_body boolean, body_truncated boolean, deleted_at timestamptz,
      generation_superseded_at timestamptz, body_text text, sender_email text, account_email text, payload jsonb,
      message_key text, message_id text, sender_name text, date timestamptz, created_at timestamptz);`);
  for (const file of ['20260921093527_mailbox_luna_presentations.sql','20260922155819_mailbox_ai_incoming_gate.sql'])
    await db.exec(fs.readFileSync(require.resolve('../../supabase/migrations/'+file),'utf8'));
  return db;
}
test('SQL settles old/new usage exactly once, retains unknown costs and preserves the approved ceiling', async () => {
  const db=await database();
  try {
    await db.exec(`update softora_mailbox_ai_budget set approved_micro_usd=20000000,reserved_micro_usd=300000;
      insert into softora_mailbox_ai_presentations(id,version,account_email,message_key,source,status,started_at,usage) values
      ('legacy','mailbox-luna-v1','a','legacy','{}','ready',now(),'{"inputTokens":1000,"outputTokens":100}'),
      ('unknown','mailbox-luna-v1','a','unknown','{}','ready',now(),null),
      ('failed','mailbox-luna-v1','a','failed','{}','failed',now(),null);`);
    await db.exec(migration);
    let b=(await db.query('select * from softora_mailbox_ai_budget')).rows[0];
    assert.equal(Number(b.reserved_micro_usd),200370); assert.equal(Number(b.spent_micro_usd),370);
    assert.equal(Number(b.approved_micro_usd),20000000); assert.equal(b.include_history,false);
    await db.exec("update softora_mailbox_ai_presentations set status=status where status='ready'");
    assert.equal(Number((await db.query('select reserved_micro_usd from softora_mailbox_ai_budget')).rows[0].reserved_micro_usd),200370);
    await db.exec(`update softora_mailbox_ai_presentations set usage='{"model":"gpt-6-luna","complete":false,"billingMicroUsd":0}' where id='unknown'`);
    assert.equal((await db.query("select charged_micro_usd from softora_mailbox_ai_presentations where id='unknown'")).rows[0].charged_micro_usd,null);
    await db.exec(`update softora_mailbox_ai_presentations set usage='{"model":"gpt-6-luna","complete":true,"billingMicroUsd":123}' where id='unknown'`);
    b=(await db.query('select * from softora_mailbox_ai_budget')).rows[0];
    assert.equal(Number(b.reserved_micro_usd),100493); assert.equal(Number(b.spent_micro_usd),493);
    await db.exec('set role anon');
    await assert.rejects(db.query('select * from softora_mailbox_ai_budget'),/permission denied/);
    await assert.rejects(db.query("select * from softora_claim_mailbox_ai('00000000-0000-0000-0000-000000000001')"),/permission denied/);
  } finally { await db.close(); }
});
test('SQL prioritizes incoming, admits approved history, caps global concurrency and stops before overspend', async () => {
  const db=await database();
  try {
    await db.exec(migration);
    await db.exec(`update softora_mailbox_ai_budget set approved_micro_usd=3000000,incoming_after=now()-interval '1 hour';
      insert into softora_mailbox_messages(message_key,account_email,created_at,date,folder,sender_email,body_text,has_body,body_truncated,payload)
        select 'm'||i,'a',case when i=1 then now() else now()-interval '1 day' end,now(), 'inbox','sender','Hello',true,false,'{}' from generate_series(1,10) i;
      insert into softora_mailbox_ai_presentations(id,version,account_email,message_key,source)
        select message_key,'mailbox-luna-v1','a',message_key,'{}' from softora_mailbox_messages;`);
    await db.exec(`update softora_mailbox_messages set message_id='stable-id' where message_key='m2';
      update softora_mailbox_ai_presentations set message_key='stale-key',source='{"identity":"stable-id"}' where id='m2';`);
    const claim="select * from softora_claim_mailbox_ai('00000000-0000-0000-0000-000000000001')";
    assert.equal((await db.query(claim)).rows[0].id,'m1'); assert.equal((await db.query(claim)).rows.length,0);
    await db.exec('update softora_mailbox_ai_budget set include_history=true');
    assert.equal((await db.query("select gate from softora_mailbox_ai_states(array['m2'])")).rows[0].gate,true);
    for(let i=0;i<7;i++) assert.equal((await db.query(claim)).rows.length,1);
    assert.equal((await db.query(claim)).rows.length,0);
    assert.equal((await db.query("select status from softora_mailbox_ai_presentations where id='m2'")).rows[0].status,'running');
    await db.exec("update softora_mailbox_ai_presentations set status='failed' where status='running'");
    await db.exec('update softora_mailbox_ai_budget set approved_micro_usd=reserved_micro_usd+299999');
    assert.equal((await db.query(claim)).rows.length,0);
    assert.equal((await db.query("select reason from softora_mailbox_ai_states(array['m9'])")).rows[0].reason,'budget');
  } finally { await db.close(); }
});
test('worker processes eight jobs in bounded waves and settles only after classification completes', async () => {
  let next=0,active=0,max=0,finished=0;
  const service=createMailboxAiPresentations({env:{MAILBOX_AI_PRESENTATION_ENABLED:'true'},getOpenAiApiKey:()=> 'test',
    repository:{candidates:async()=>[],enqueue:async()=>[],claim:async()=>({id:++next,source:{}}),finish:async()=>{finished++;}},
    classifier:{classify:async()=>{active++;max=Math.max(max,active);await new Promise(r=>setTimeout(r,5));active--;return {decision:{},usage:{}};}}});
  assert.deepEqual(await service.processQueue(),{processed:8});assert.equal(finished,8);assert.equal(max,4);
});
