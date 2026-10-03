const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { isAbsenceNotice } = require('../../assets/premium-mailbox-absence-notice');
const { isAutomatedCampaignReply } = require('../../server/services/mailbox-automated-reply');
const inbox = require('../../assets/premium-mailbox-campaign-inbox');
const { filterVisibleMailboxMessages, assertMailboxMessageVisible } = require('../../server/services/mailbox-delivery-failure-visibility');

const absenceBody = 'Beste lezer,\n\nDe praktijk is gesloten tot maandag 19 oktober, berichten worden na die tijd beantwoord. Nieuwe aanmeldingen zijn momenteel niet mogelijk. Voor lopende clienten geldt: bij spoed neem dan contact op met de huisarts of huisartsenpost.';

test('afwezigheidsmeldingen zonder autoheaders worden gelijk herkend door server en browser', () => {
  const cases = [
    [absenceBody, true],
    [`${absenceBody} Meer informatie: https://example.test/?contact=1`, true],
    ['Onze salon is tijdelijk gesloten. E-mails worden na de vakantie weer gelezen.', true],
    ['Ons bedrijf is gesloten tot 19 oktober. Berichten worden vanaf maandag 19 oktober beantwoord.', true],
    ['Wij zijn met vakantie. Na onze terugkeer beantwoorden wij uw berichten.', true],
    ['Onze praktijk is gesloten. E-mails worden tijdens onze vakantie niet gelezen.', true],
    ['I am on vacation until Monday. I will respond to your email when I return.', true],
    ['Our office is temporarily closed. Messages will be answered after our return.', true],
    ['De praktijk is gesloten tot maandag 19 oktober.', false],
    ['Berichten worden na die tijd beantwoord.', false],
    ['De praktijk is gesloten tot maandag. Berichten worden na die tijd beantwoord. Het ontwerp ziet er mooi uit.', false],
    ['De praktijk is gesloten tot maandag. Berichten worden na die tijd beantwoord. Kun je mij de preview sturen?', false],
    ['Our practice is closed. Emails will be answered after our return. Your design looks great.', false],
    ['Dank voor je mail. Ik kijk na mijn vakantie naar het ontwerp.', false],
  ];
  const context = { window: {} };
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, '../../assets/premium-mailbox-absence-notice.js'), 'utf8'), context);
  for (const [body, expected] of cases) {
    const message = { subject: 'Re: Kleine vraag over jullie website', body, autoSubmitted: 'no' };
    assert.equal(isAbsenceNotice(body), expected, body);
    assert.equal(context.window.SoftoraMailboxAbsenceNotice.isAbsenceNotice(body), expected, body);
    assert.equal(isAutomatedCampaignReply(message), expected, `server: ${body}`);
    assert.equal(inbox.isAutomatedCampaignReply(message), expected, `browser: ${body}`);
  }
});

test('preview-only meldingen verdwijnen; geciteerde afwezigheid in een echt antwoord blijft zichtbaar', () => {
  const previewOnly = { subject: 'Re: Kleine vraag', preview: absenceBody };
  assert.equal(isAutomatedCampaignReply(previewOnly), true);
  assert.equal(inbox.isAutomatedCampaignReply(previewOnly), true);
  const human = {
    subject: 'Re: Kleine vraag',
    preview: absenceBody,
    body: `Bedankt, ik ontvang graag de preview.\n\nOp 3 oktober 2026 schreef Praktijk:\n${absenceBody}`,
  };
  assert.equal(isAutomatedCampaignReply(human), false);
  assert.equal(inbox.isAutomatedCampaignReply(human), false);
});

test('oude inboxrijen en threads worden gefilterd zonder bronberichten of latere echte antwoorden te verwijderen', () => {
  const automatic = {
    id: 'absence', accountEmail: 'serve@softora.nl', email: 'practice@example.test',
    folder: 'inbox', subject: 'Re: Kleine vraag', body: absenceBody,
    date: '2026-10-03T07:43:00Z',
  };
  const sent = { id: 'sent:initial', folder: 'sent', accountEmail: 'serve@softora.nl', body: 'Ons oorspronkelijke bericht.', date: '2026-10-03T07:42:00Z' };
  const human = { ...automatic, id: 'human', body: 'Stuur de preview maar door.', date: '2026-10-20T09:00:00Z', threadMessages: [automatic, sent] };
  const source = [automatic, human];
  assert.deepEqual(filterVisibleMailboxMessages(source).map((message) => message.id), ['human']);
  assert.throws(() => assertMailboxMessageVisible(automatic), { status: 404 });
  assert.equal(assertMailboxMessageVisible(human), human);
  const visible = inbox.filterMessages(source, 'serve');
  assert.deepEqual(visible.map((message) => message.id), ['human']);
  assert.deepEqual(visible[0].threadMessages.map((message) => message.id), ['sent:initial']);
  assert.equal(source.length, 2);
  assert.equal(human.threadMessages.length, 2);
  assert.equal(automatic.body, absenceBody);
});
