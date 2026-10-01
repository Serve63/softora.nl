const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { parseAnalyticsFilters, summarizeMailAnalytics, createMailAnalyticsService } = require('../../server/services/mail-analytics');
const { createMailAnalyticsRepository } = require('../../server/repositories/mail-analytics');
const { registerMailAnalyticsRoutes } = require('../../server/routes/mail-analytics');
const NOW = Date.parse('2026-10-01T10:00:00Z');
const filters = query => parseAnalyticsFilters(query, NOW);
const guard = (recipient = 'lead@example.org', provider = 'softora', account = 'sender@example.net') => ({ key_type:'email', status:'sent', channel:'coldmail', provider, source:provider === 'softora' ? 'softora-coldmail-pre-send' : 'instantly-webhook', sender_email:account, recipient_email:recipient, payload:{ sentAt:'2026-09-25T09:00:00Z' } });
const sent = (id = '<send@example.net>', recipient = 'lead@example.org', account = 'sender@example.net') => ({ message_key:id, message_id:id, account_email:account, sender_email:account, recipients_text:recipient, folder:'sent', date:'2026-09-25T09:00:00Z', payload:{ originalCampaignOutbound:true } });
const reply = (id = '<reply@example.org>', reference = '<send@example.net>', recipient = 'lead@example.org') => ({ message_key:id, message_id:id, sender_email:recipient, account_email:'sender@example.net', folder:'inbox', date:'2026-09-26T09:00:00Z', in_reply_to:reference, subject:'Re: Vraag over de website' });
const summarize = (guards, messages, query = {}) => summarizeMailAnalytics({ guards, messages }, filters(query));

test('mail analytics counts confirmed campaign sends and human responders, without duplicate provider copies', () => {
  const first = sent(), second = { ...sent('<followup@example.net>'), date:'2026-09-27T09:00:00Z' };
  const data = summarize([guard()], [first, { ...first, folder:'allmail', payload:{direction:'sent',originalCampaignOutbound:true} }, second, reply(), reply('<another@example.org>'), reply()]);
  assert.equal(data.totals.sent, 2); assert.equal(data.totals.contacted, 1); assert.equal(data.totals.replied, 1); assert.equal(data.totals.replyRate, 100);
  assert.equal(data.totals.minimumOnly, false); assert.equal(data.daily.reduce((sum,d) => sum+d.replies,0), 2); assert.equal(data.totals.clickRate, null);
});
test('reservations, uploads, ordinary-client ledger guards, test rows and unlinked inbox conversations never become acquisition', () => {
  const guards = [guard(), { ...guard('reserved@example.org'), status:'reserved' }, { ...guard('client@example.org'), source:'mailbox-outbound-ledger' }, { ...guard('test@example.org'), payload:{ sentStatsExcluded:true } }];
  const data = summarize(guards, [sent(), reply('unrelated', 'unknown'), { ...sent('ordinary'), date:'2026-09-28T09:00:00Z', payload:{} }, { ...sent('manual'), payload:{ softoraSendMode:'reply', originalCampaignOutbound:true } }]);
  assert.equal(data.totals.sent, 1); assert.equal(data.totals.contacted, 1); assert.equal(data.totals.replied, 0);
});
test('automatic replies are separate, and spoofed or pre-send references are excluded', () => {
  const data = summarize([guard()], [sent(), { ...reply('auto'), subject:'Automatic reply: out of office', payload:{ automatedReplyEvidence:true } }, reply('spoof','<send@example.net>','other@example.org'), { ...reply('old'), date:'2026-09-20T09:00:00Z' }]);
  assert.equal(data.totals.automaticReplies, 1); assert.equal(data.totals.replied, 0);
});
test('source channel survives answering through another mailbox and filters use the original sender', () => {
  const data = summarize([guard('lead@example.org','instantly')], [{ ...sent(), folder:'instantly', payload:{direction:'sent',originalCampaignOutbound:true,providerThreadId:'thread-1'} }, { ...reply(), account_email:'other@example.net',folder:'instantly',in_reply_to:'',payload:{direction:'received',providerThreadId:'thread-1'} }], { provider:'instantly', account:'sender@example.net' });
  assert.equal(data.rows[0].provider, 'instantly'); assert.equal(data.totals.replied, 1);
  assert.equal(summarize([guard('lead@example.org','instantly')], [sent(),reply()], {provider:'softora'}).rows.length, 0);
});
test('period rates follow the contacted cohort and do not mix new sends with old-contact replies', () => {
  const old = { ...guard('old@example.org'), payload:{ sentAt:'2026-08-01T09:00:00Z' } };
  const data = summarize([guard(),old], [sent(), sent('oldsend','old@example.org'), reply('oldreply','oldsend','old@example.org')]);
  assert.equal(data.totals.contacted,1); assert.equal(data.totals.replied,0);
});
test('missing message history gives a labelled confirmed minimum, and a zero denominator has no rate', () => {
  const data = summarize([guard()],[]); assert.equal(data.totals.sent,1); assert.equal(data.totals.minimumOnly,true);
  assert.equal(summarize([],[]).totals.replyRate,null);
});
test('a richer duplicate reply is retained when the first copy lacks thread references', () => {
  const data = summarize([guard()], [sent(), { ...reply(), in_reply_to:'' }, reply()]); assert.equal(data.totals.replied,1);
});
test('Amsterdam calendar boundaries remain correct through DST and reject unsupported filters', () => {
  const f = parseAnalyticsFilters({days:7}, Date.parse('2026-10-26T23:30:00Z')); assert.equal(f.startDate,'2026-10-21');
  assert.throws(() => filters({days:365}), /geldige/); assert.throws(() => filters({provider:'smtp'}), /geldige/); assert.throws(() => filters({account:'bad'}), /geldige/);
});
test('all filter combinations share one complete cached read and failures do not become empty results', async () => {
  let calls=0;
  const service=createMailAnalyticsService({now:()=>NOW,repository:{async load(){calls++;return {guards:[guard()],messages:[sent()]};}}});
  await Promise.all([service.get({}),service.get({provider:'instantly'})]); assert.equal(calls,1);
  await service.get({days:7}); assert.equal(calls,1);
  const broken=createMailAnalyticsService({repository:{async load(){throw new Error('unavailable');}}}); await assert.rejects(broken.get({}), /unavailable/);
});
test('repository pages without silently truncating history and rejects provider failures', async () => {
  let reads=0;
  const makeClient = fail => ({ from(table) { const q={select(){return q;},eq(){return q;},in(){return q;},gte(){return q;},lte(){return q;},order(){return q;},or(){return q;},range(start){q.start=start;return q;},async abortSignal(){reads++;return fail ? {error:{message:'private'}} : {data:table.includes('guards')&&q.start===0 ? Array.from({length:500},(_,i)=>({guard_key:String(i)})) : []};}};return q;} });
  const repository=createMailAnalyticsRepository({getSupabaseClient:()=>makeClient(false)});
  const data=await repository.load({from:'2026-09-01',until:'2026-10-01'});assert.equal(data.guards.length,500);assert.equal(reads,4);
  await assert.rejects(createMailAnalyticsRepository({getSupabaseClient:()=>makeClient(true)}).load({}), /tijdelijk/);
});
test('analytics endpoint is admin-only, private, read-only and hides unexpected server errors', async () => {
  let route; const auth=()=>{}; const app={get(path,...handlers){route={path,handlers};}};
  registerMailAnalyticsRoutes(app,{requirePremiumAdminApiAccess:auth,service:{async get(){throw new Error('secret-detail');}}});
  assert.equal(route.path,'/api/mailbox/analytics');assert.equal(route.handlers[0],auth);
  const res={setHeader(key,value){assert.equal(key,'Cache-Control');assert.match(value,/private/);},status(value){this.code=value;return this;},json(value){this.body=value;}};
  await route.handlers[1]({query:{}},res);assert.equal(res.code,503);assert.doesNotMatch(JSON.stringify(res.body),/secret-detail/);
  let registered=false;registerMailAnalyticsRoutes({get(){registered=true;}},{});assert.equal(registered,false);
});
test('analytics page has a complete-readiness state, visible failures, cancellation, safe text and isolated admin access', () => {
  const read = file => fs.readFileSync(path.join(__dirname,'../..',file),'utf8');
  assert.match(read('premium-mail-analytics.html'),/data-sidebar-shell="canonical"/);
  const ui=read('assets/premium-mail-analytics.js');assert.match(ui,/results.dataset.ready = 'true'/);assert.match(ui,/results.dataset.ready = 'false'/);assert.match(ui,/current === revision/);assert.match(ui,/AbortController/);assert.match(ui,/escape\(row.account\)/);
  assert.match(read('server/config/premium-admin-html-files.js'),/'premium-mail-analytics.html'/);
});


test('Instantly uploads never count as sends; provider campaign messages establish sends even without an old sent guard', () => {
  assert.equal(summarize([guard('lead@example.org','instantly')], []).totals.sent,0);
  const message = { ...sent(), folder:'instantly', payload:{direction:'sent',originalCampaignOutbound:true} };
  assert.equal(summarize([], [message]).totals.sent,1);
});


test('a missing initial message still counts the confirmed initial send alongside a stored follow-up', () => {
  const followup = { ...sent('followup'), date:'2026-09-27T09:00:00Z' };
  const result = summarize([guard()], [followup]); assert.equal(result.totals.sent,2); assert.equal(result.totals.minimumOnly,true);
});


test('Softora bounces require DSN recipient proof, sender account and a date after the confirmed send', () => {
  const bounce = {folder:'inbox',account_email:'sender@example.net',sender_email:'mailer-daemon@example.net',subject:'Delivery Status Notification (Failure)',date:'2026-09-26T09:00:00Z',body_text:'Final-Recipient: rfc822; lead@example.org\nAction: failed\nStatus: 5.1.1'};
  const data=summarizeMailAnalytics({guards:[guard()],messages:[sent()],bounceMessages:[bounce,{...bounce,message_key:'copy'}]},filters({}));assert.equal(data.totals.bounces,1);assert.equal(data.rows[0].bounces,1);
  assert.equal(summarizeMailAnalytics({guards:[guard()],messages:[sent()],bounceMessages:[{...bounce,account_email:'other@example.net'}]},filters({})).totals.bounces,0);
  assert.equal(summarizeMailAnalytics({guards:[],messages:[],bounceMessages:[]},filters({provider:'instantly'})).totals.bounces,null);
});
