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
  await db.exec(fs.readFileSync(require.resolve('../../supabase/migrations/20260923111119_mailbox_ai_queue_lookup_indexes.sql'),'utf8'));
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
    await db.exec(fs.readFileSync(require.resolve('../../supabase/migrations/20260923112643_mailbox_ai_failed_usage_settlement.sql'),'utf8'));
    await db.exec(`update softora_mailbox_ai_budget set approved_micro_usd=3000000,incoming_after=now()-interval '1 hour';
      insert into softora_mailbox_messages(message_key,account_email,created_at,date,folder,sender_email,body_text,has_body,body_truncated,payload)
        select 'm'||i,'a',case when i=1 then now() else now()-interval '1 day' end,now(), case when i=2 then 'coldmail' else 'inbox' end,'sender','Hello',true,false,'{}' from generate_series(1,10) i;
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
test('worker processes two jobs in a bounded wave and settles only after classification completes', async () => {
  let next=0,active=0,max=0,finished=0;
  const service=createMailboxAiPresentations({env:{MAILBOX_AI_PRESENTATION_ENABLED:'true'},getOpenAiApiKey:()=> 'test',
    repository:{recover:async()=>0,candidates:async()=>[],enqueue:async()=>[],claim:async()=>({id:++next,source:{}}),finish:async()=>{finished++;}},
    classifier:{classify:async()=>{active++;max=Math.max(max,active);await new Promise(r=>setTimeout(r,5));active--;return {decision:{},usage:{}};}}});
  assert.deepEqual(await service.processQueue(),{processed:2});assert.equal(finished,2);assert.equal(max,2);
});

test('worker drains already queued jobs even when candidate discovery fails', async () => {
  let claims = 0, finished = 0;
  const warnings = [];
  const service = createMailboxAiPresentations({ env: { MAILBOX_AI_PRESENTATION_ENABLED: 'true' },
    getOpenAiApiKey: () => 'test', logger: { warn: (...args) => warnings.push(args) },
    repository: { recover: async () => 0, candidates: async () => { throw new Error('private database detail'); },
      claim: async () => ++claims <= 2 ? { id: claims, source: {} } : null,
      finish: async () => { finished++; } },
    classifier: { classify: async () => ({ decision: {}, usage: {} }) } });
  assert.deepEqual(await service.processQueue(), { processed: 2, unavailable: true });
  assert.equal(finished, 2);
  assert.equal(warnings[0][1].stage, 'candidates');
  assert.doesNotMatch(JSON.stringify(warnings), /private database detail/);
});

test('collapsed HTML paragraphs are classified with source-safe layout and tampering retains original', async () => {
  const { createMailboxAiClassifier }=require('../../server/services/mailbox-ai-classifier');
  const contract=require('../../assets/premium-mailbox-ai-presentation');
  const body='GoedendagIk wil graag dinsdag afspreken.Groet,Sam';
  const html='<div>Goedendag</div><div>Ik wil graag dinsdag afspreken.</div><div>Groet,</div><div>Sam</div>';
  let calls=0;
  const classifier=createMailboxAiClassifier({getApiKey:()=> 'test',fetchImpl:async(_url,init)=>{
    const request=JSON.parse(init.body), input=JSON.parse(request.input[1].content);calls++;
    assert.equal(input.lines[1].text,'Ik wil graag dinsdag afspreken.');
    const remove=input.lines.filter(r=>['Groet,','Sam'].includes(r.text)).map(r=>r.line);
    return {ok:true,json:async()=>({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(calls===1?{signatureLines:remove,contacts:[]}:{safeToRemove:remove})}]}]})};
  }});
  const result=await classifier.classify({body,html});
  const message={body,aiPresentation:{version:contract.VERSION,model:contract.MODEL,reasoningEffort:'max',status:'ready',sourceBody:body,decision:result.decision}};
  assert.equal(contract.read(message).body.trim(),'Goedendag\n\nIk wil graag dinsdag afspreken.');
  assert.equal(message.body,body);assert.equal(calls,2);
  message.aiPresentation.decision.displayBody+=' Herschreven tekst';
  assert.equal(contract.read(message).body,body);
});

test('invalid model output retains complete usage; transport uncertainty never releases a hold', async () => {
  const { createMailboxAiClassifier }=require('../../server/services/mailbox-ai-classifier');
  const usage={input_tokens:1000,output_tokens:100,input_tokens_details:{cached_tokens:0,cache_write_tokens:0}};
  for(const secondFails of [false,true]) {
    let calls=0;
    const classifier=createMailboxAiClassifier({getApiKey:()=> 'test',fetchImpl:async()=>{
      calls++;if(secondFails && calls===2) throw new Error('network timeout');
      return {ok:true,json:async()=>({status:'completed',usage,output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(secondFails?{signatureLines:[1,2],contacts:[]}:{signatureLines:[999],contacts:[]})}]}]})};
    }});
    await assert.rejects(classifier.classify({body:'Graag dinsdag.\nGroet,\nSam',html:''}), error=>{
      assert.equal(error.mailboxUsage.complete,!secondFails);
      assert.equal(error.mailboxUsage.billingMicroUsd,secondFails?null:150);return true;
    });
    assert.equal(calls,secondFails?2:1);
  }
});

test('failed jobs settle known complete usage once, but partial failures keep their hold',async()=>{
  const db=await database();
  try {
    await db.exec(migration);
    await db.exec(fs.readFileSync(require.resolve('../../supabase/migrations/20260923112643_mailbox_ai_failed_usage_settlement.sql'),'utf8'));
    await db.exec(`update softora_mailbox_ai_budget set approved_micro_usd=1000000,reserved_micro_usd=600000;
      insert into softora_mailbox_ai_presentations(id,version,account_email,message_key,source,status,claim_reserved_micro_usd) values
      ('complete','mailbox-luna-v1','a','a','{}','running',300000),('partial','mailbox-luna-v1','a','b','{}','running',300000);
      update softora_mailbox_ai_presentations set status='failed',usage='{"model":"gpt-6-luna","complete":true,"billingMicroUsd":200}' where id='complete';
      update softora_mailbox_ai_presentations set status='failed',usage='{"model":"gpt-6-luna","complete":false,"billingMicroUsd":null}' where id='partial';
      update softora_mailbox_ai_presentations set status=status where status='failed';`);
    const b=(await db.query('select * from softora_mailbox_ai_budget')).rows[0];
    assert.equal(Number(b.reserved_micro_usd),300200);assert.equal(Number(b.spent_micro_usd),200);
  } finally {await db.close();}
});

test('campaign-only SQL excludes queued Gmail and admits proven coldmail across history and future arrivals', async () => {
  const db=await database();
  try {
    await db.exec(migration);
    await db.exec(fs.readFileSync(require.resolve('../../supabase/migrations/20260923112643_mailbox_ai_failed_usage_settlement.sql'),'utf8'));
    await db.exec(`alter table public.softora_mailbox_messages add column in_reply_to text;
      alter table public.softora_mailbox_messages add column references_text text;
      alter table public.softora_mailbox_messages add column recipients_text text;
      alter table public.softora_mailbox_messages add column subject text;
      create function public.softora_mailbox_message_has_campaign_proof(text,text,text,text,text,text,text,text,text,text,jsonb,text,text default null)
      returns boolean language sql immutable as $$select $1 like 'campaign-%' and $8 = $12$$;
      update public.softora_mailbox_ai_budget set approved_micro_usd=3000000,include_history=true,incoming_after=now()-interval '1 hour';
      insert into public.softora_mailbox_messages(message_key,account_email,created_at,date,folder,sender_email,body_text,has_body,body_truncated,payload)
        values ('gmail-new','owner',now(),now(),'inbox','other@example.nl','Private mail',true,false,'{}'),
        ('campaign-old','owner',now()-interval '1 day',now()-interval '1 day','coldmail','reply@example.nl','Old reply',true,false,'{}'),
        ('campaign-new','owner',now(),now(),'inbox','reply@example.nl','New reply',true,false,'{}');
      update public.softora_mailbox_messages set in_reply_to='<sent@softora.nl>' where message_key='campaign-new';
      update public.softora_mailbox_messages set in_reply_to='<personal@example.nl>' where message_key='gmail-new';
      insert into public.softora_mailbox_ai_presentations(id,version,account_email,message_key,source)
        select message_key,'mailbox-luna-v1','owner',message_key,'{}' from public.softora_mailbox_messages;`);
    await db.exec(`create table public.softora_mailbox_campaign_lineage_members(message_key text,account_email text);
      create table public.softora_mailbox_campaign_lineage_roots(message_key text,account_email text);
      insert into public.softora_mailbox_campaign_lineage_members values ('campaign-old','owner');`);
    await db.exec(fs.readFileSync(require.resolve('../../supabase/migrations/20260923122053_mailbox_ai_campaign_only.sql'),'utf8'));
    await db.exec(fs.readFileSync(require.resolve('../../supabase/migrations/20260923122633_mailbox_ai_campaign_hint.sql'),'utf8'));
    assert.deepEqual((await db.query('select message_key from softora_mailbox_ai_candidates(20)')).rows.map(row=>row.message_key),['campaign-new','campaign-old']);
    assert.equal((await db.query("select reason from softora_mailbox_ai_states(array['gmail-new'])")).rows[0].reason,'outside_scope');
    const claim="select id from softora_claim_mailbox_ai('00000000-0000-0000-0000-000000000001')";
    assert.equal((await db.query(claim)).rows[0].id,'campaign-new');
    assert.equal((await db.query(claim)).rows[0].id,'campaign-old');
    assert.equal((await db.query(claim)).rows.length,0);
    assert.equal((await db.query("select status from softora_mailbox_ai_presentations where id='gmail-new'")).rows[0].status,'queued');
  } finally { await db.close(); }
});

test('paged candidates cross non-campaign history, admit new replies, and respect the budget', async () => {
  const db = await database();
  try {
    await db.exec(migration);
    await db.exec(`alter table public.softora_mailbox_messages add column in_reply_to text;
      alter table public.softora_mailbox_messages add column references_text text;
      alter table public.softora_mailbox_messages add column recipients_text text;
      alter table public.softora_mailbox_messages add column subject text;
      create table public.softora_mailbox_campaign_lineage_members(message_key text,account_email text);
      create table public.softora_mailbox_campaign_lineage_roots(message_key text,account_email text);
      create function public.softora_mailbox_message_has_campaign_proof(text,text,text,text,text,text,text,text,text,text,jsonb,text,text default null)
        returns boolean language sql immutable as $$select $1 like 'campaign-%'$$;
      update public.softora_mailbox_ai_budget set approved_micro_usd=18000000,include_history=true;
      insert into public.softora_mailbox_messages(message_key,account_email,created_at,date,folder,sender_email,
        body_text,has_body,body_truncated,payload)
        select 'private-'||i,'owner',now()-interval '1 day',now()-interval '1 day'+i*interval '1 second',
          'inbox','personal@example.nl','Personal',true,false,'{}' from generate_series(1,4000) i;
      insert into public.softora_mailbox_messages(message_key,account_email,created_at,date,folder,sender_email,
        body_text,has_body,body_truncated,payload,in_reply_to)
        values ('campaign-old','owner',now()-interval '2 days',now()-interval '2 days',
          'inbox','reply@example.nl','Old reply',true,false,'{}','<sent@example.nl>');`);
    for (const file of ['20260923122053_mailbox_ai_campaign_only.sql',
      '20260923122633_mailbox_ai_campaign_hint.sql',
      '20260923133902_mailbox_ai_paged_candidates.sql'])
      await db.exec(fs.readFileSync(require.resolve('../../supabase/migrations/'+file),'utf8'));
    assert.deepEqual((await db.query('select message_key from softora_mailbox_ai_candidates(20)')).rows, []);
    let cursor = (await db.query('select after_message_key from softora_mailbox_ai_candidate_cursor')).rows[0];
    assert.ok(cursor.after_message_key.startsWith('private-'));
    assert.deepEqual((await db.query('select message_key from softora_mailbox_ai_candidates(20)')).rows,
      [{ message_key: 'campaign-old' }]);
    await db.exec(`insert into public.softora_mailbox_messages(message_key,account_email,created_at,date,folder,sender_email,
      body_text,has_body,body_truncated,payload,in_reply_to)
      values ('campaign-new','owner',now(),now(),'inbox','reply@example.nl','New reply',true,false,'{}','<sent@example.nl>');`);
    assert.ok((await db.query('select message_key from softora_mailbox_ai_candidates(20)')).rows
      .some(row => row.message_key === 'campaign-new'));
    await db.exec('update public.softora_mailbox_ai_budget set approved_micro_usd=reserved_micro_usd+299999');
    assert.deepEqual((await db.query('select message_key from softora_mailbox_ai_candidates(20)')).rows, []);
    await db.exec('set role anon');
    await assert.rejects(db.query('select * from public.softora_mailbox_ai_candidate_cursor'), /permission denied/);
    await assert.rejects(db.query('select * from public.softora_mailbox_ai_candidates(20)'), /permission denied/);
  } finally { await db.close(); }
});

test('stalled and timed-out campaign claims retry once without refunding uncertain costs', async () => {
  const db = await database();
  try {
    await db.exec(migration);
    await db.exec(fs.readFileSync(require.resolve('../../supabase/migrations/20260923112643_mailbox_ai_failed_usage_settlement.sql'),'utf8'));
    await db.exec(`alter table public.softora_mailbox_messages add column in_reply_to text;
      alter table public.softora_mailbox_messages add column references_text text;
      alter table public.softora_mailbox_messages add column recipients_text text;
      alter table public.softora_mailbox_messages add column subject text;
      create function public.softora_mailbox_message_has_campaign_proof(text,text,text,text,text,text,text,text,text,text,jsonb,text,text default null)
        returns boolean language sql immutable as $$select $1 like 'campaign-%'$$;
      create table public.softora_mailbox_campaign_lineage_members(message_key text,account_email text);
      create table public.softora_mailbox_campaign_lineage_roots(message_key text,account_email text);`);
    for (const file of ['20260923122053_mailbox_ai_campaign_only.sql','20260923122633_mailbox_ai_campaign_hint.sql',
      '20260923125807_mailbox_ai_recover_stalled_claims.sql'])
      await db.exec(fs.readFileSync(require.resolve('../../supabase/migrations/'+file),'utf8'));
    await db.exec(`update public.softora_mailbox_ai_budget set approved_micro_usd=1800000,
      reserved_micro_usd=900000, include_history=true;
      insert into public.softora_mailbox_messages(message_key,account_email,created_at,date,folder,sender_email,
        body_text,has_body,body_truncated,payload,in_reply_to) values
        ('campaign-timeout','a',now(),now(),'inbox','sender@example.nl','Reply',true,false,'{}','<sent@example.nl>'),
        ('campaign-stale','a',now(),now(),'inbox','sender@example.nl','Reply',true,false,'{}','<sent@example.nl>'),
        ('private-mail','a',now(),now(),'inbox','sender@example.nl','Personal',true,false,'{}','<private@example.nl>');
      insert into public.softora_mailbox_ai_presentations(id,version,account_email,message_key,source,status,
        started_at,finished_at,claim_reserved_micro_usd,usage,attempt_count) values
        ('timeout','mailbox-luna-v1','a','campaign-timeout','{}','failed',now()-interval '20 minutes',
          now()-interval '17 minutes',300000,'{"errorCode":"MAILBOX_AI_TIMEOUT","complete":false}',1),
        ('stale','mailbox-luna-v1','a','campaign-stale','{}','running',now()-interval '20 minutes',null,300000,null,1),
        ('private','mailbox-luna-v1','a','private-mail','{}','failed',now()-interval '20 minutes',
          now()-interval '17 minutes',300000,'{"errorCode":"MAILBOX_AI_TIMEOUT","complete":false}',1);`);
    assert.equal((await db.query('select softora_recover_mailbox_ai() n')).rows[0].n,2);
    let rows=(await db.query('select id,status,attempt_count,claim_reserved_micro_usd,prior_uncertain_micro_usd from softora_mailbox_ai_presentations order by id')).rows;
    for(const row of rows.filter((item)=>item.id!=='private')) {
      assert.equal(row.status,'queued'); assert.equal(row.attempt_count,1);
      assert.equal(Number(row.claim_reserved_micro_usd),0);
      assert.equal(Number(row.prior_uncertain_micro_usd),300000);
    }
    assert.equal(rows.find((item)=>item.id==='private').status,'failed');
    assert.equal(Number((await db.query('select reserved_micro_usd from softora_mailbox_ai_budget')).rows[0].reserved_micro_usd),900000);
    await db.exec("update softora_mailbox_ai_presentations set retry_after=now()-interval '1 second'");
    const claim="select id from softora_claim_mailbox_ai('00000000-0000-0000-0000-000000000001')";
    assert.deepEqual([(await db.query(claim)).rows[0].id,(await db.query(claim)).rows[0].id].sort(),['stale','timeout']);
    assert.equal((await db.query(claim)).rows.length,0);
    assert.equal(Number((await db.query('select reserved_micro_usd from softora_mailbox_ai_budget')).rows[0].reserved_micro_usd),1500000);
    await db.exec(`update softora_mailbox_ai_presentations set status='failed',finished_at=now()-interval '4 minutes',
      usage='{"errorCode":"MAILBOX_AI_TIMEOUT","complete":false}' where id='timeout'`);
    assert.equal((await db.query('select softora_recover_mailbox_ai() n')).rows[0].n,0);
    rows=(await db.query("select status,attempt_count,prior_uncertain_micro_usd from softora_mailbox_ai_presentations where id='timeout'")).rows;
    assert.equal(rows[0].status,'failed'); assert.equal(rows[0].attempt_count,2);
    assert.equal(Number(rows[0].prior_uncertain_micro_usd),300000);
    await db.exec('set role anon');
    await assert.rejects(db.query('select softora_recover_mailbox_ai()'),/permission denied/);
  } finally { await db.close(); }
});

test('claim uses a proven copy of the same message when its queued inbox copy lacks campaign proof', async () => {
  const db = await database();
  try {
    await db.exec(migration);
    await db.exec(fs.readFileSync(require.resolve('../../supabase/migrations/20260923112643_mailbox_ai_failed_usage_settlement.sql'),'utf8'));
    await db.exec(`alter table public.softora_mailbox_messages add column in_reply_to text;
      alter table public.softora_mailbox_messages add column references_text text;
      alter table public.softora_mailbox_messages add column recipients_text text;
      alter table public.softora_mailbox_messages add column subject text;
      create table public.softora_mailbox_campaign_lineage_members(message_key text,account_email text);
      create table public.softora_mailbox_campaign_lineage_roots(message_key text,account_email text);
      create function public.softora_mailbox_message_has_campaign_proof(text,text,text,text,text,text,text,text,text,text,jsonb,text,text default null)
        returns boolean language sql immutable as $$select $3='coldmail'$$;`);
    for (const file of ['20260923122053_mailbox_ai_campaign_only.sql',
      '20260923122633_mailbox_ai_campaign_hint.sql',
      '20260923125807_mailbox_ai_recover_stalled_claims.sql'])
      await db.exec(fs.readFileSync(require.resolve('../../supabase/migrations/'+file),'utf8'));
    await db.exec(`update public.softora_mailbox_ai_budget set approved_micro_usd=600000,include_history=true;
      insert into public.softora_mailbox_messages(message_key,message_id,account_email,created_at,date,folder,
        sender_email,body_text,has_body,body_truncated,payload,in_reply_to) values
        ('unproven-inbox','stable-id','owner',now(),now(),'inbox','sender@example.nl','Reply',true,false,'{}','<sent@example.nl>'),
        ('proven-coldmail','stable-id','owner',now(),now(),'coldmail','sender@example.nl','Reply',true,false,'{}','<sent@example.nl>');
      insert into public.softora_mailbox_ai_presentations(id,version,account_email,message_key,source)
        values ('job','mailbox-luna-v1','owner','unproven-inbox',
          '{"identity":"stable-id","body":"Reply","from":"sender@example.nl","email":"sender@example.nl"}');`);
    const claim = "select id from softora_claim_mailbox_ai('00000000-0000-0000-0000-000000000001')";
    assert.equal((await db.query(claim)).rows.length, 0);
    await db.exec(fs.readFileSync(require.resolve('../../supabase/migrations/20260923182811_mailbox_ai_claim_proven_identity.sql'),'utf8'));
    assert.equal((await db.query(claim)).rows[0].id, 'job');
    assert.equal((await db.query(claim)).rows.length, 0);
    assert.equal(Number((await db.query('select reserved_micro_usd from softora_mailbox_ai_budget')).rows[0].reserved_micro_usd), 300000);
  } finally { await db.close(); }
});

test('failed campaign jobs retry within the cap while retaining known and uncertain costs', async () => {
  const db = await database();
  try {
    await db.exec(migration);
    await db.exec(fs.readFileSync(require.resolve('../../supabase/migrations/20260923112643_mailbox_ai_failed_usage_settlement.sql'),'utf8'));
    await db.exec(`alter table public.softora_mailbox_messages add column in_reply_to text;
      alter table public.softora_mailbox_messages add column references_text text;
      alter table public.softora_mailbox_messages add column recipients_text text;
      alter table public.softora_mailbox_messages add column subject text;
      create function public.softora_mailbox_message_has_campaign_proof(text,text,text,text,text,text,text,text,text,text,jsonb,text,text default null)
        returns boolean language sql immutable as $$select $1 like 'campaign-%'$$;
      create table public.softora_mailbox_campaign_lineage_members(message_key text,account_email text);
      create table public.softora_mailbox_campaign_lineage_roots(message_key text,account_email text);`);
    for (const file of ['20260923122053_mailbox_ai_campaign_only.sql','20260923122633_mailbox_ai_campaign_hint.sql',
      '20260923125807_mailbox_ai_recover_stalled_claims.sql','20260923182811_mailbox_ai_claim_proven_identity.sql',
      '20260923192148_mailbox_ai_failed_campaign_retry.sql'])
      await db.exec(fs.readFileSync(require.resolve('../../supabase/migrations/'+file),'utf8'));
    await db.exec(`update public.softora_mailbox_ai_budget set approved_micro_usd=18000000,
      reserved_micro_usd=600686,spent_micro_usd=686,include_history=true;
      insert into public.softora_mailbox_messages(message_key,account_email,created_at,date,folder,sender_email,
        body_text,has_body,body_truncated,payload,in_reply_to) values
        ('campaign-invalid','a',now(),now(),'inbox','sender@example.nl','Reply',true,false,'{}','<sent@example.nl>'),
        ('campaign-lost','a',now(),now(),'inbox','sender@example.nl','Reply',true,false,'{}','<sent@example.nl>'),
        ('private-mail','a',now(),now(),'inbox','sender@example.nl','Personal',true,false,'{}',null);
      insert into public.softora_mailbox_ai_presentations(id,version,account_email,message_key,source,status,
        finished_at,claim_reserved_micro_usd,prior_uncertain_micro_usd,charged_micro_usd,usage,attempt_count) values
        ('invalid','mailbox-luna-v1','a','campaign-invalid','{}','failed',now()-interval '4 minutes',
          300000,0,686,'{"model":"gpt-6-luna","complete":true,"billingMicroUsd":686,"errorCode":"MAILBOX_AI_INVALID_RESULT"}',1),
        ('lost','mailbox-luna-v1','a','campaign-lost','{}','failed',now()-interval '4 minutes',
          0,600000,null,'{"errorCode":"MAILBOX_AI_WORKER_LOST","complete":false}',2),
        ('private','mailbox-luna-v1','a','private-mail','{}','failed',now()-interval '4 minutes',
          0,0,null,'{"errorCode":"MAILBOX_AI_INVALID_RESULT"}',1);`);
    assert.equal((await db.query('select softora_recover_mailbox_ai() n')).rows[0].n,2);
    const recovered=(await db.query('select id,status,charged_micro_usd,prior_charged_micro_usd,prior_uncertain_micro_usd from softora_mailbox_ai_presentations order by id')).rows;
    assert.equal(recovered.find((row)=>row.id==='invalid').status,'queued');
    assert.equal(Number(recovered.find((row)=>row.id==='invalid').prior_charged_micro_usd),686);
    assert.equal(recovered.find((row)=>row.id==='invalid').charged_micro_usd,null);
    assert.equal(Number(recovered.find((row)=>row.id==='lost').prior_uncertain_micro_usd),600000);
    assert.equal(recovered.find((row)=>row.id==='private').status,'failed');
    assert.equal(Number((await db.query('select reserved_micro_usd from softora_mailbox_ai_budget')).rows[0].reserved_micro_usd),600686);
    await db.exec("update softora_mailbox_ai_presentations set retry_after=now()-interval '1 second' where status='queued'");
    const claim="select id from softora_claim_mailbox_ai('00000000-0000-0000-0000-000000000001')";
    assert.deepEqual([(await db.query(claim)).rows[0].id,(await db.query(claim)).rows[0].id].sort(),['invalid','lost']);
    assert.equal((await db.query(claim)).rows.length,0);
    await db.exec(`update softora_mailbox_ai_presentations set status='ready',finished_at=now(),
      usage='{"model":"gpt-6-luna","complete":true,"billingMicroUsd":500}' where id='invalid';
      update softora_mailbox_ai_presentations set status='ready',finished_at=now(),
      usage='{"model":"gpt-6-luna","complete":true,"billingMicroUsd":400}' where id='lost';`);
    const budget=(await db.query('select reserved_micro_usd,spent_micro_usd from softora_mailbox_ai_budget')).rows[0];
    assert.equal(Number(budget.reserved_micro_usd),601586);
    assert.equal(Number(budget.spent_micro_usd),1586);
  } finally { await db.close(); }
});

test('stale claims outside campaign scope close without refunding uncertain reservations', async () => {
  const db = await database();
  try {
    await db.exec(migration);
    await db.exec(fs.readFileSync(require.resolve('../../supabase/migrations/20260923112643_mailbox_ai_failed_usage_settlement.sql'),'utf8'));
    await db.exec(`alter table public.softora_mailbox_messages add column in_reply_to text;
      alter table public.softora_mailbox_messages add column references_text text;
      alter table public.softora_mailbox_messages add column recipients_text text;
      alter table public.softora_mailbox_messages add column subject text;
      create table public.softora_mailbox_campaign_lineage_members(message_key text,account_email text);
      create table public.softora_mailbox_campaign_lineage_roots(message_key text,account_email text);
      create function public.softora_mailbox_message_has_campaign_proof(text,text,text,text,text,text,text,text,text,text,jsonb,text,text default null)
        returns boolean language sql immutable as $$select $1 like 'campaign-%'$$;`);
    for (const file of ['20260923122053_mailbox_ai_campaign_only.sql',
      '20260923122633_mailbox_ai_campaign_hint.sql','20260923125807_mailbox_ai_recover_stalled_claims.sql'])
      await db.exec(fs.readFileSync(require.resolve('../../supabase/migrations/'+file),'utf8'));
    await db.exec(`update public.softora_mailbox_ai_budget set approved_micro_usd=1800000,
      reserved_micro_usd=600000,include_history=true;
      insert into public.softora_mailbox_messages(message_key,account_email,created_at,date,folder,sender_email,
        body_text,has_body,body_truncated,payload,in_reply_to) values
        ('campaign-reply','a',now(),now(),'inbox','sender@example.nl','Reply',true,false,'{}','<sent@example.nl>'),
        ('private-mail','a',now(),now(),'inbox','sender@example.nl','Personal',true,false,'{}',null);
      insert into public.softora_mailbox_ai_presentations(id,version,account_email,message_key,source,status,
        started_at,claim_reserved_micro_usd,attempt_count) values
        ('campaign','mailbox-luna-v1','a','campaign-reply','{}','running',now()-interval '20 minutes',300000,1),
        ('private','mailbox-luna-v1','a','private-mail','{}','running',now()-interval '20 minutes',300000,1);`);
    await db.exec(fs.readFileSync(require.resolve('../../supabase/migrations/20260923135720_mailbox_ai_close_orphaned_claims.sql'),'utf8'));
    const rows=(await db.query('select id,status,usage,claim_reserved_micro_usd from softora_mailbox_ai_presentations order by id')).rows;
    assert.equal(rows[0].status,'running');
    assert.equal(rows[1].status,'failed');
    assert.equal(rows[1].usage.errorCode,'MAILBOX_AI_ORPHANED_SCOPE');
    assert.equal(Number(rows[1].claim_reserved_micro_usd),300000);
    assert.equal(Number((await db.query('select reserved_micro_usd from softora_mailbox_ai_budget')).rows[0].reserved_micro_usd),600000);
  } finally { await db.close(); }
});
