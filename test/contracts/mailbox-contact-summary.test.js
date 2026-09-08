const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const discovery = require('../../assets/premium-mailbox-discovery');

function fixture() {
  const mail = {
    id: 'sent:3', messageId: '<third@example.test>', accountEmail: 'serve@softora.nl',
    folder: 'sent', email: 'serve@softora.nl', to: 'contact@example.test',
    threadMessages: [
      { id: 'inbox:2', messageId: '<second@example.test>', accountEmail: 'serve@softora.nl' },
      { id: 'sent:1', messageId: '<first@example.test>', accountEmail: 'serve@softora.nl' },
    ],
  };
  const dossier = discovery.getContactDossier(mail, { activeFolder: 'outreach', accountEmails: ['serve@softora.nl'] });
  return { mail, dossier };
}

test('contactdossier staat in de eerste detailrender voordat de contacthistorie is opgehaald', () => {
  const { mail, dossier } = fixture();
  const before = JSON.stringify(mail);
  const html = discovery.renderTimelineSummary(mail, String, dossier);
  assert.match(html, /<strong>Contactdossier:<\/strong>/);
  assert.match(html, /3 berichten geladen · contact@example\.test/);
  assert.match(html, /data-contact-summary-state="partial"/);
  assert.doesNotMatch(html, /0 onderwerpen|Oudere berichten laden/);
  assert.equal(JSON.stringify(mail), before, 'een samenvatting mag niet doen alsof de volledige tijdlijn geladen is');
});

test('samenvatting houdt dezelfde regel voor, na en bij een mislukte contacthistorieaanvraag', () => {
  const { mail, dossier } = fixture();
  for (const pending of [{}, { contactTimelineLoading: true }, { contactTimelineError: 'tijdelijk niet beschikbaar' }]) {
    const html = discovery.renderTimelineSummary({ ...mail, ...pending }, String, dossier);
    assert.match(html, /class="mail-contact-summary"/);
    assert.match(html, /class="mail-contact-summary-text"/);
    assert.match(html, /3 berichten geladen/);
  }
  const ready = discovery.renderTimelineSummary({
    ...mail, contactTimelineLoaded: true, contactTimelineTotal: 3, contactTimelineThreadCount: 1,
    externalContactEmail: dossier.contactEmail,
  }, String, dossier);
  assert.match(ready, /class="mail-contact-summary"/);
  assert.match(ready, /class="mail-contact-summary-text"/);
  assert.match(ready, /data-contact-summary-state="complete"/);
  assert.match(ready, /3 berichten · 1 onderwerp · contact@example\.test/);
  assert.doesNotMatch(ready, /berichten geladen/);
});

test('eerste telling telt geen dubbele berichten, quotes of nog niet opgehaalde historie', () => {
  const { mail, dossier } = fixture();
  mail.body = 'Een mail met geciteerde vorige berichten.';
  mail.threadMessages.push({ ...mail.threadMessages[0], messageId: 'SECOND@EXAMPLE.TEST' }, { body: 'Een losse quote zonder berichtidentiteit' });
  const html = discovery.renderTimelineSummary(mail, String, dossier);
  assert.match(html, /3 berichten geladen/);
  assert.doesNotMatch(html, /onderwerp/);
});

test('gewone mailboxmappen krijgen geen contactdossier en paginering blijft beschikbaar na laden', () => {
  const { mail } = fixture();
  assert.equal(discovery.renderTimelineSummary(mail, String, { active: false }), '');
  const ready = discovery.renderTimelineSummary({ ...mail, contactTimelineLoaded: true, contactTimelineTotal: 80, contactTimelineThreadCount: 5, contactTimelineNextCursor: 'page-2' }, String);
  assert.match(ready, /data-mailbox-action="load-more-contact-timeline"/);
  assert.match(ready, /Oudere berichten laden/);
});

test('contactsamenvatting en paginering behouden een regelhoogte wanneer aantallen of lange adressen verschijnen', () => {
  const page = fs.readFileSync(path.join(__dirname, '../../premium-mailbox.html'), 'utf8');
  assert.match(page, /\.mail-contact-summary \{[^}]*flex-wrap: nowrap;[^}]*min-height: 18px;[^}]*line-height: 18px;/);
  assert.match(page, /\.mail-contact-summary-text \{[^}]*min-width: 0;[^}]*overflow: hidden;[^}]*white-space: nowrap;[^}]*text-overflow: ellipsis;/);
  assert.match(page, /\.mail-contact-summary button \{[^}]*padding: 0;[^}]*line-height: inherit;/);
  const script = fs.readFileSync(path.join(__dirname, '../../assets/premium-mailbox.js'), 'utf8');
  assert.match(script, /renderTimelineSummary\?\.\(m, escapeHtml, contactDossier\)/);
});
