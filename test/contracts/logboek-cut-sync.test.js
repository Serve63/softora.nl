const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
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
test('the latest note typed during an in-flight save is sent with the fresh version',async()=>{
  let releaseFirst;
  const session={training_date:'2026-09-22',exercises:[{order:1,sets:2,notes:'Basis'}],checks:{},notes:{'1':{text:'Basis',version:0}}};
  const posts=[];
  const fetchImpl=async(_url,options)=>{
    if(options.method!=='POST')return {ok:true,status:200,json:async()=>({session:JSON.parse(JSON.stringify(session))})};
    const op=JSON.parse(options.body);posts.push(op);
    if(posts.length===1)await new Promise(resolve=>releaseFirst=resolve);
    session.notes[String(op.order)]={text:op.text,version:session.notes[String(op.order)].version+1};
    return {ok:true,status:200,json:async()=>({session:JSON.parse(JSON.stringify(session))})};
  };
  const app=client({fetchImpl});app.sync.start();await pause();await pause();
  app.sync.setNoteDraft(1,'Eerste wijziging','Basis');app.sync.saveNote(1,'Eerste wijziging','Basis');await pause();
  app.sync.setNoteDraft(1,'Laatste wijziging','Basis');app.sync.saveNote(1,'Laatste wijziging','Basis');
  assert.equal(posts.length,1);assert.equal(app.latest.drafts['2026-09-22:1'],'Laatste wijziging');
  releaseFirst();await pause();await pause();await pause();
  assert.deepEqual(posts.map(op=>op.text),['Eerste wijziging','Laatste wijziging']);
  assert.equal(posts[1].version,1);assert.equal(session.notes['1'].text,'Laatste wijziging');
  assert.equal(app.latest.pending.length,0);assert.equal(app.latest.drafts['2026-09-22:1'],undefined);
});
test('offline note edits retry in order and preserve the newest text',async()=>{
  let online=true,session={training_date:'2026-09-22',exercises:[{order:1,sets:2,notes:'Basis'}],checks:{},notes:{'1':{text:'Basis',version:0}}};
  const posts=[];
  const fetchImpl=async(_url,options)=>{
    if(!online)throw Error('offline');
    if(options.method==='POST'){
      const op=JSON.parse(options.body);posts.push(op);
      session.notes[String(op.order)]={text:op.text,version:session.notes[String(op.order)].version+1};
    }
    return {ok:true,status:200,json:async()=>({session:JSON.parse(JSON.stringify(session))})};
  };
  const app=client({fetchImpl});app.sync.start();await pause();await pause();
  online=false;app.sync.setNoteDraft(1,'Offline edit','Basis');app.sync.saveNote(1,'Offline edit','Basis');await pause();
  const operationId=app.latest.pending[0].operationId;
  app.sync.setNoteDraft(1,'Newest offline edit','Basis');app.sync.saveNote(1,'Newest offline edit','Basis');
  assert.equal(app.latest.pending[0].operationId,operationId);
  online=true;await app.sync.refresh();await pause();
  assert.deepEqual(posts.map(op=>op.text),['Offline edit','Newest offline edit']);
  assert.equal(posts[0].operationId,operationId);assert.equal(posts[1].version,1);
  assert.equal(session.notes['1'].text,'Newest offline edit');assert.equal(app.latest.pending.length,0);
});
test('note version conflict retries the preserved local draft against the fresh server version',async()=>{
  let session={training_date:'2026-09-22',exercises:[{order:1,sets:2,notes:'Basis'}],checks:{},notes:{'1':{text:'Basis',version:0}}};
  const posts=[];
  const fetchImpl=async(_url,options)=>{
    if(options.method!=='POST')return {ok:true,status:200,json:async()=>({session:JSON.parse(JSON.stringify(session))})};
    const op=JSON.parse(options.body);posts.push(op);
    if(posts.length===1) {
      session.notes['1']={text:'Wijziging op ander apparaat',version:1};
      return {ok:false,status:409,json:async()=>({conflict:true,session:JSON.parse(JSON.stringify(session))})};
    }
    session.notes['1']={text:op.text,version:2};
    return {ok:true,status:200,json:async()=>({session:JSON.parse(JSON.stringify(session))})};
  };
  const app=client({fetchImpl});app.sync.start();await pause();await pause();
  app.sync.setNoteDraft(1,'Mijn laatste tekst','Basis');app.sync.saveNote(1,'Mijn laatste tekst','Basis');
  await pause();await pause();await pause();
  assert.deepEqual(posts.map(op=>op.version),[0,1]);
  assert.deepEqual(posts.map(op=>op.text),['Mijn laatste tekst','Mijn laatste tekst']);
  assert.equal(session.notes['1'].text,'Mijn laatste tekst');assert.equal(app.latest.pending.length,0);
  assert.equal(app.latest.drafts['2026-09-22:1'],undefined);
});
test('notes save automatically without an explicit save control and render without a box',()=>{
  const html=fs.readFileSync(path.join(__dirname,'../../logboek-cut.html'),'utf8');
  const script=fs.readFileSync(path.join(__dirname,'../../assets/logboek-cut.js'),'utf8');
  const styles=fs.readFileSync(path.join(__dirname,'../../assets/logboek-cut.css'),'utf8');
  assert.doesNotMatch(html+script,/Notitie opslaan|data-note-save/);
  assert.match(script,/scheduleNoteSave\(Number\(field\.dataset\.noteOrder\)\)/);
  assert.match(script,/focusout/);assert.match(script,/flushNoteTimers/);
  assert.match(styles,/\.note-editor textarea[^\n]*border:0/);
});
