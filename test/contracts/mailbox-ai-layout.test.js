const test = require('node:test');
const assert = require('node:assert/strict');
const contract = require('../../assets/premium-mailbox-ai-presentation');
const { restoreMailboxDisplayLayout, restoreMailboxAiDecision } = require('../../server/services/mailbox-ai-layout');
const { createMailboxAiClassifier, buildSource } = require('../../server/services/mailbox-ai-classifier');
const { createMailboxAiPresentations } = require('../../server/services/mailbox-ai-presentations');
const campaign = require('../../assets/premium-mailbox-campaign-inbox');
const escape = (text) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const answer = 'Bedankt voor je bericht. Kan dit ontwerp ook binnen onze bestaande webwinkel?';
const signoff = 'Groeten Jeffrey en Peggy';
const header = 'Op 5 oktober 2026, om 10:58, Robin Voorbeeld <owner@example.nl> schreef:';
const parent = { id: 'sent:layout', messageId: '<parent@example.nl>', folder: 'sent', direction: 'sent',
  accountEmail: 'owner@example.nl', email: 'owner@example.nl', date: '2026-10-05T08:58:00Z',
  body: 'Goedendag,\n\nHier staat het eerdere voorstel voor jullie website. Ik hoor graag wat je van het ontwerp vindt. 😁\n\nMet vriendelijke groet,\nRobin Voorbeeld' };
const flat = `Beste Robin,${answer} ${signoff}${header}Goedendag,\nHier staat het eerdere voorstel voor jullie website. Ik hoor graag wat je van het ontwerp vindt. 😁\nMet vriendelijke groet,Robin Voorbeeld`;
const html = [`Beste Robin,`, answer, signoff, 'Krijg BlueMail voor Desktop', header,
  ...parent.body.split('\n').filter(Boolean)].map(line => `<div>${escape(line)}</div>`).join('');
const originalDecision = { labels: ['authored', 'authored', 'signature'], contacts: [] };
const incoming = { id: 'inbox:layout', messageKey: 'owner|inbox|layout', folder: 'inbox',
  from: 'Jeffrey en Peggy', email: 'contact@example.nl', accountEmail: 'owner@example.nl',
  date: '2026-10-08T08:09:45Z', inReplyTo: parent.messageId, body: flat, sourceHtml: html };

test('display layout recovers whole HTML blocks omitted from a plain alternative without adding any text', () => {
  const restored = restoreMailboxDisplayLayout({ body: flat, html });
  assert.ok(restored.startsWith(`Beste Robin,\n\n${answer}\n\n${signoff}\n\n${header}\n\nGoedendag,`));
  assert.equal(restored.replace(/\s/g, ''), flat.replace(/\s/g, ''));
  assert.doesNotMatch(restored, /BlueMail/);
  assert.equal(restoreMailboxDisplayLayout({ body: restored, html }), restored, 'restoration is idempotent');
});

test('ambiguous, different, partial, reordered and additional plain content never gets replaced', () => {
  for (const source of [
    { body: 'Betaal 50 euro', html: '<p>Betaal 500 euro</p>' },
    { body: 'Beste Robin,Belangrijke eigen extra afspraak.', html: '<p>Beste Robin,</p>' },
    { body: 'EersteTweede', html: '<div>Tweede</div><div>Eerste</div>' },
    { body: 'Beste Robin,Voorstel', html: '<p>Beste Robin,</p><p>Voorstel veranderd</p>' },
    { body: 'HalloBedankt', html: '<p>Hallo</p><p>Bedankt</p><p>Hallo</p><p>Bedankt</p>' },
    { body: 'Mail <robin@example.nl>. 2 < 3.', html: '<p>Andere versie.</p>' },
  ]) assert.equal(restoreMailboxDisplayLayout(source), source.body);
  assert.equal(restoreMailboxDisplayLayout({ body: 'Al goed.\nTweede alinea.', html: '<p>Al goed.</p><p>Tweede alinea.</p>' }),
    'Al goed.\nTweede alinea.');
  assert.equal(restoreMailboxDisplayLayout({ body: 'Eerste alinea. Tweede alinea.',
    html: '<p>Eerste alinea.</p><p>Tweede alinea.</p>' }), 'Eerste alinea.\n\nTweede alinea.');
});

test('ready decisions keep original source, labels and contacts while repairing only layout', () => {
  const source = { body: 'Hoi Robin,Kan dat morgen?\nMet vriendelijke groet,Sam\nTel: 0612345678Adres: Voorbeeldstraat 7\n1234 AB Voorbeeldstad',
    html: '<div>Hoi Robin,</div><div>Kan dat morgen?</div><div>Met vriendelijke groet,</div><div>Sam</div>' +
      '<div>Tel: 0612345678</div><div>Adres: Voorbeeldstraat 7</div><div>1234 AB Voorbeeldstad</div>' };
  const decision = { labels: ['authored', 'signature', 'signature', 'signature'], contacts: [
    { line: 2, kind: 'phone', text: '0612345678' }, { line: 2, kind: 'address', text: 'Voorbeeldstraat 7' },
    { line: 3, kind: 'address', text: '1234 AB Voorbeeldstad' }] };
  const before = structuredClone({ source, decision });
  const repaired = restoreMailboxAiDecision(source, decision);
  assert.ok(contract.validate(source.body, repaired));
  const view = contract.read({ body: source.body, aiPresentation: { version: contract.VERSION, model: contract.MODEL,
    reasoningEffort: 'max', status: 'ready', sourceBody: source.body, decision: repaired } });
  assert.equal(view.body, 'Hoi Robin,\n\nKan dat morgen?');
  assert.deepEqual(view.contact, { beforeLines: ['Tel: 0612345678'], addressLines: ['Voorbeeldstraat 7', '1234 AB Voorbeeldstad'] });
  assert.deepEqual({ source, decision }, before);
  const ambiguous = { body: 'Hoi Robin,Antwoord\n06123456780612345678',
    html: '<div>Hoi Robin,</div><div>Antwoord</div><div>0612345678</div><div>0612345678</div>' };
  const contactDecision = { labels: ['authored', 'signature'], contacts: [{ line: 1, kind: 'phone', text: '0612345678' }] };
  assert.equal(restoreMailboxAiDecision(ambiguous, contactDecision), contactDecision);
});

test('existing paid decisions repair root and timeline, hide only the proven sent copy, and never call AI again', async () => {
  const snapshot = structuredClone(incoming);
  let classifyCalls = 0;
  const service = createMailboxAiPresentations({ env: { MAILBOX_AI_PRESENTATION_ENABLED: 'true' },
    classifier: { classify: () => { classifyCalls += 1; throw new Error('unexpected model call'); } },
    repository: { enqueue: async sources => sources.map(source => ({ id: source.id, status: 'ready', decision: originalDecision })) } });
  const [enriched] = await service.enrich([incoming]);
  const mail = { ...enriched, threadMessages: [parent] };
  const expected = `Beste Robin,\n\n${answer}\n\n${signoff}`;
  assert.equal(campaign.getRootMessagePresentation(flat, mail).body, expected);
  const views = [];
  campaign.renderThreadMessages({ ...mail, threadMessages: [parent, { ...enriched, bodyLoaded: true }] },
    String, () => ({ date: 'Vandaag', time: '10:09' }), { renderMessageBody: view => { views.push(view.body); return view.body; } });
  assert.ok(views.includes(expected));
  assert.ok(views.includes(parent.body));
  assert.match(campaign.getRootMessagePresentation(flat, { ...enriched, threadMessages: [] }).body, /eerdere voorstel/,
    'unknown quoted correspondence remains visible');
  assert.equal(enriched.body, incoming.body);
  assert.equal(buildSource(enriched).id, buildSource(incoming).id, 'existing source and paid identity remain stable');
  assert.deepEqual(incoming, snapshot);
  assert.equal(classifyCalls, 0);
});

test('future model requests receive separated original lines without sender-specific rules', async () => {
  let calls = 0;
  const classifier = createMailboxAiClassifier({ getApiKey: () => 'offline-test', fetchImpl: async (_url, init) => {
    calls += 1;
    const request = JSON.parse(init.body), input = JSON.parse(request.input[1].content);
    assert.equal(input.lines[0].text, 'Beste Robin,');
    assert.equal(input.lines[1].text, answer);
    assert.ok(input.lines.some(line => line.text === header));
    assert.ok(input.lines.every(line => !line.text.includes('BlueMail')));
    return { ok: true, json: async () => ({ status: 'completed', output: [{ type: 'message', content: [
      { type: 'output_text', text: JSON.stringify({ signatureLines: [], contacts: [] }) }] }] }) };
  } });
  const result = await classifier.classify(buildSource(incoming));
  assert.equal(calls, 1);
  assert.equal(result.decision.displayBody, restoreMailboxDisplayLayout({ body: flat, html }));
  assert.ok(contract.validate(flat, result.decision));
});
