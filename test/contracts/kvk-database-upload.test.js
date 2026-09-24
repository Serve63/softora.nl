const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {createKvkDatabaseUploadService} = require('../../server/services/kvk-database-upload');
const {createController} = require('../../assets/kvk-database-upload');
const id = '06ef6c6d-98ef-4cc4-b5f4-39e6d1d6bbc4';
function res() { return {statusCode:200,status(code){this.statusCode=code;return this;},json(data){this.body=data;return this;},setHeader(){}}; }
function fixture({rows=[],receipt=null,fail=false}={}) {
 const calls=[]; let invalidated=0;
 const db={from(table){ if(table==='softora_kvk_upload_receipts') return {select:()=>({eq:()=>({maybeSingle:async()=>({data:receipt})})})};
 const q={select(){return q;},neq(){return q;},gt(){return q;},order(){return q;},limit:async()=>({data:rows,error:fail?{}:null})}; return q;},rpc:async(name,args)=>{calls.push({name,args});return {data:{count:args.p_candidates.length,destination:'available'}};}};
 const service=createKvkDatabaseUploadService({getSupabaseClient:()=>db,getUiStateValues:async()=>({values:{}}),refreshDestination:()=>invalidated++});
 return {service,calls,get invalidated(){return invalidated;}};
}
test('upload refuses without-website, missing mode and invalid IDs before any write',async()=>{
 for(const body of [{mode:'without-website',requestId:id},{mode:'with-website'},{requestId:id}]){
 const f=fixture();const r=res();await f.service.upload({body},r);assert.equal(r.statusCode,400);assert.equal(f.calls.length,0);
 }
});
test('preview is read-only and derives candidates from the canonical source',async()=>{
 const f=fixture({rows:[{source_company_id:1,kvk_nummer:'12345678',bedrijfsnaam:'Voorbeeld',email:'info@voorbeeld.nl',website:'voorbeeld.nl'}]});
 const r=res();await f.service.preview({},r);assert.equal(r.body.count,1);assert.equal(f.calls[0].args.p_dry_run,true);assert.equal(f.calls[0].args.p_request_id,null);assert.ok(f.calls[0].args.p_candidates[0].guard_keys.includes('email:info@voorbeeld.nl'));
});
test('committed retry returns the receipt without selecting or uploading more companies',async()=>{
 const f=fixture({receipt:{result:{count:12,destination:'available'}}});const r=res();await f.service.upload({body:{mode:'with-website',requestId:id}},r);assert.equal(r.body.count,12);assert.equal(r.body.replayed,true);assert.equal(f.calls.length,0);assert.equal(f.invalidated,1);
});
test('unreadable source never falls back to uploading client data',async()=>{
 const f=fixture({fail:true});const r=res();await f.service.upload({body:{mode:'with-website',requestId:id,rows:[{email:'evil'}]}},r);assert.equal(r.statusCode,503);assert.equal(f.calls.length,0);
});
test('both upload routes require admin access',()=>{
 const source=fs.readFileSync(path.join(__dirname,'../../server/routes/kvk-database.js'),'utf8');
 for(const method of ['get','post']) assert.ok(source.includes(`app.${method}('/api/kvk-database/upload', requirePremiumAdminApiAccess`));
});
test('database transaction preserves existing customers and atomically marks imported source rows',()=>{
 const sql=fs.readFileSync(path.join(__dirname,'../../supabase/migrations/20260924132100_kvk_upload_available.sql'),'utf8');
 assert.match(sql,/lock table public.softora_customers in share row exclusive mode/);
 assert.match(sql,/softora_kvk_unused_company_directory/);assert.match(sql,/softora_outbound_recipient_guards/);
 assert.match(sql,/'prospect','prospect'/);assert.match(sql,/'premiumTransferDestination','available'/);
 assert.match(sql,/premium_database_transferred = true/);assert.match(sql,/if found then return v_result/);
 assert.doesNotMatch(sql,/update public.softora_customers|on conflict.*update/i);
 assert.match(sql,/enable row level security/);assert.match(sql,/from public,anon,authenticated/);
});
function uiFixture(respond) {
 const elements=new Map();const node=()=>({disabled:false,hidden:true,textContent:'',addEventListener(){},showModal(){},close(){}});
 const document={getElementById(id){if(!elements.has(id))elements.set(id,node());return elements.get(id);}};
 const requests=[];let refreshed=0;
 const ui=createController({document,crypto:{randomUUID:()=>id},fetch:async(url,options)=>{requests.push(options);return respond(options,requests.length);},refresh:()=>refreshed++});
 return {ui,elements,requests,get refreshed(){return refreshed;}};
}
test('UI preserves request ID after uncertain failure and prevents duplicate in-flight clicks',async()=>{
 let resolvePost;
 const f=uiFixture(async(options,n)=>{if(!options.method)return {ok:true,json:async()=>({ok:true,count:3})};if(n===2)return new Promise(resolve=>{resolvePost=resolve;});return {ok:true,json:async()=>({ok:true,count:3})};});
 await f.ui.open(); const first=f.ui.upload(); await Promise.resolve(); await f.ui.upload();assert.equal(f.requests.length,2);
 resolvePost({ok:false,json:async()=>({ok:false,error:'probeer opnieuw'})});await first;
 await f.ui.upload();assert.equal(JSON.parse(f.requests[1].body).requestId,JSON.parse(f.requests[2].body).requestId);assert.equal(f.refreshed,1);assert.equal(f.elements.get('kvk-upload-result').hidden,false);
});
test('bulk upload materializes source and guard sets once for the full inventory',()=>{
 const sql=fs.readFileSync(path.join(__dirname,'../../supabase/migrations/20260924134500_kvk_upload_guard_lookup.sql'),'utf8');
 for(const name of ['incoming','unused','blocked_sources','existing_identities']) assert.ok(sql.includes(`${name} as materialized`));
 assert.match(sql,/join public.softora_outbound_recipient_guards g on g.guard_key = candidate_guard.guard_key/);
 assert.match(sql,/c.identity_key not in \(select identity_key from existing_identities\)/);
 assert.match(sql,/source_company_id not in \(select source_company_id from blocked_sources\)/);
 assert.match(sql,/if p_dry_run then return v_result/);
 assert.match(sql,/lock table public.softora_customers in share row exclusive mode/);
});
