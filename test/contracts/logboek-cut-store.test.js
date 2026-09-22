const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');
const {projectExercises,createLogboekCutService,validDate}=require('../../server/services/logboek-cut');
test('the live schedule is reconciled into today while invalid dates are rejected',async()=>{
  const plan={days:{tuesday:{orders:[1],exercises:{1:{title:'PRESS',sets:'2',reps:'8',kg:'old',exerciseKey:'press'}}}},exerciseSources:{press:{kg:'50'}}};
  const rows=projectExercises(plan,'2026-09-22');assert.equal(rows[0].kg,'50');
  for(const d of ['2026-02-30','x','2026-13-01'])assert.equal(validDate(d),false);
  const session={training_date:'2026-09-22',exercises:rows,checks:{}};
  const service=createLogboekCutService({now:()=>new Date('2026-09-22T18:00:00Z'),repo:{read:async()=>session,plan:async()=>({payload:plan,updatedAt:'2026-09-22T17:00:00Z'})}});
  assert.deepEqual((await service.get()).session,session);
  await assert.rejects(service.get('2026-09-23'),{status:400});
  await assert.rejects(service.set({date:'2026-09-22',done:'true'}),{status:400});
});
test('stale cut sessions are refreshed from the complete canonical logbook exercise source',async()=>{
  const plan={
    days:{tuesday:{orders:['7'],exercises:{7:{title:'Old press',exerciseKey:'press',sets:'2',reps:'8',kg:'old',notes:'old day copy'}}}},
    exerciseSources:{press:{title:'Chest Press',sets:'3',reps:'10',kg:'82,5',notes:'Canonical note'}},
  };
  let session={training_date:'2026-09-22',exercises:[{order:7,title:'Old press',sets:2,reps:'8',kg:'old',notes:'old day copy'}],checks:{}};
  let refreshed;
  const repo={
    plan:async()=>({payload:plan,updatedAt:'2026-09-22T17:00:00Z'}),
    read:async()=>session,
    refreshExercises:async(_date,exercises)=>{refreshed=exercises;session={...session,exercises};return session;},
  };
  const service=createLogboekCutService({now:()=>new Date('2026-09-22T18:00:00Z'),repo});
  const body=await service.get('2026-09-22');
  assert.deepEqual(refreshed,[{order:7,title:'Chest Press',kg:'82,5',reps:'10',sets:3,notes:'Canonical note'}]);
  assert.deepEqual(body.session.exercises,refreshed);
});
test('SQL saves are atomic, idempotent, conflict-aware and isolated per date',async()=>{
  const db=new PGlite();
  try {
    await db.exec("create role anon; create role authenticated; create role service_role bypassrls; create table public.softora_sportschool_logbook(id text,payload jsonb);");
    await db.exec(fs.readFileSync(path.join(__dirname,'../../supabase/migrations/20260922161337_logboek_cut_sessions.sql'),'utf8'));
    await db.exec(fs.readFileSync(path.join(__dirname,'../../supabase/migrations/20260922184500_logboek_cut_notes.sql'),'utf8'));
    await db.query('insert into softora_logboek_cut_sessions(training_date,exercises) values ($1,$2),($3,$2)', ['2026-09-22',JSON.stringify([{order:1,sets:2}]),'2026-09-23']);
    const call=async(date,set,done,version,id)=>(await db.query('select softora_logboek_cut_set($1,$2,$3,$4,$5,$6) as result',[date,1,set,done,version,id])).rows[0].result;
    const id='00000000-0000-4000-8000-000000000001';
    let result=await call('2026-09-22',0,true,0,id);assert.equal(result.session.checks['1:0'].version,1);
    result=await call('2026-09-22',0,true,0,id);assert.equal(result.session.checks['1:0'].version,1);
    result=await call('2026-09-22',1,true,0,'00000000-0000-4000-8000-000000000002');assert.equal(result.session.checks['1:0'].done,true);assert.equal(result.session.checks['1:1'].done,true);
    result=await call('2026-09-22',0,false,0,'00000000-0000-4000-8000-000000000003');assert.equal(result.conflict,true);assert.equal(result.session.checks['1:0'].done,true);
    result=await call('2026-09-22',0,false,1,'00000000-0000-4000-8000-000000000004');assert.equal(result.session.checks['1:0'].done,false);
    result=await call('2026-09-22',0,true,0,id);assert.equal(result.session.checks['1:0'].done,false,'retry cannot reverse a newer edit');
    const saveNote=async(text,version,operation)=>(await db.query('select softora_logboek_cut_note($1,$2,$3,$4,$5) as result',['2026-09-22',1,text,version,operation])).rows[0].result;
    result=await saveNote('Goede vorm',0,'00000000-0000-4000-8000-000000000006');assert.deepEqual(result.session.notes['1'],{text:'Goede vorm',version:1});
    result=await saveNote('Ander apparaat',0,'00000000-0000-4000-8000-000000000007');assert.equal(result.conflict,true);assert.equal(result.session.notes['1'].text,'Goede vorm');
    result=await saveNote('Nog beter',1,'00000000-0000-4000-8000-000000000008');assert.equal(result.session.notes['1'].text,'Nog beter');
    result=await saveNote('Goede vorm',0,'00000000-0000-4000-8000-000000000006');assert.equal(result.session.notes['1'].text,'Nog beter','retry cannot reverse a newer note');
    await assert.rejects(saveNote('x'.repeat(1001),2,'00000000-0000-4000-8000-000000000009'),/Invalid note/);
    const next=await db.query("select checks from softora_logboek_cut_sessions where training_date='2026-09-23'");assert.deepEqual(next.rows[0].checks,{});
    await assert.rejects(call('2026-09-22',2,true,0,'00000000-0000-4000-8000-000000000005'),/Invalid set/);
    await assert.rejects(call('2026-09-22',0,false,0,id),/Operation mismatch/);
    const privileges=await db.query("select has_table_privilege('anon','softora_logboek_cut_sessions','SELECT') as read, has_function_privilege('anon','softora_logboek_cut_set(date,integer,integer,boolean,integer,uuid)','EXECUTE') as write_set, has_function_privilege('anon','softora_logboek_cut_note(date,integer,text,integer,uuid)','EXECUTE') as write_note");
    assert.deepEqual(privileges.rows[0],{read:false,write_set:false,write_note:false});
  } finally {await db.close();}
});
