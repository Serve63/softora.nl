const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const pagePath = path.join(__dirname, '../../premium-mailbox.html');
const scriptPath = path.join(__dirname, '../../assets/premium-mailbox.js');
const indexScriptPath = path.join(__dirname, '../../assets/premium-mailbox-index.js');
const displayScriptPath = path.join(__dirname, '../../assets/premium-mailbox-display.js');
const outreachScriptPath = path.join(__dirname, '../../assets/premium-mailbox-outreach.js');
const campaignInboxScriptPath = path.join(__dirname, '../../assets/premium-mailbox-campaign-inbox.js');
const imagesScriptPath = path.join(__dirname, '../../assets/premium-mailbox-images.js');
const refreshScriptPath = path.join(__dirname, '../../assets/premium-mailbox-refresh.js');
const composeScriptPath = path.join(__dirname, '../../assets/premium-mailbox-compose.js');
const listScriptPath = path.join(__dirname, '../../assets/premium-mailbox-list.js');
const deleteScriptPath = path.join(__dirname, '../../assets/premium-mailbox-delete.js');
const campaignInboxModule = require('../../assets/premium-mailbox-campaign-inbox.js');
global.SoftoraMailboxCampaignInbox = campaignInboxModule;
const imagesModule = require('../../assets/premium-mailbox-images.js');
const refreshModule = require('../../assets/premium-mailbox-refresh.js');
const composeModule = require('../../assets/premium-mailbox-compose.js');
const listModule = require('../../assets/premium-mailbox-list.js');
const deleteModule = require('../../assets/premium-mailbox-delete.js');

function readPage() {
  return fs.readFileSync(pagePath, 'utf8');
}

function readScript() {
  return fs.readFileSync(scriptPath, 'utf8');
}

function readIndexScript() {
  return fs.readFileSync(indexScriptPath, 'utf8');
}

function readDisplayScript() {
  return fs.readFileSync(displayScriptPath, 'utf8');
}

function readOutreachScript() {
  return fs.readFileSync(outreachScriptPath, 'utf8');
}

function readCampaignInboxScript() {
  return fs.readFileSync(campaignInboxScriptPath, 'utf8');
}

function readImagesScript() {
  return fs.readFileSync(imagesScriptPath, 'utf8');
}

function readRefreshScript() {
  return fs.readFileSync(refreshScriptPath, 'utf8');
}

function readComposeScript() {
  return fs.readFileSync(composeScriptPath, 'utf8');
}

function readListScript() {
  return fs.readFileSync(listScriptPath, 'utf8');
}

function readDeleteScript() {
  return fs.readFileSync(deleteScriptPath, 'utf8');
}

test('mailbox gebruikt de juiste browsertitel', () => {
  assert.match(readPage(), /<title>Mailbox – Softora\.nl<\/title>/);
  assert.doesNotMatch(readPage(), /Coldmail Inbox/);
  assert.match(readPage(), /assets\/premium-mailbox-images\.js\?v=20260723c/);
});

test('mailbox toont de gekozen eigenaar zwart in de topbar', () => {
  assert.match(readPage(), /\.topbar-mailbox-switcher-label\s*\{[^}]*color:\s*var\(--text-dark\)/s);
});

function loadMailboxHelpersForTest(options = {}) {
  const elements = new Map();
  function getElement(id) {
    if (!elements.has(id)) {
      elements.set(id, {
        innerHTML: '',
        textContent: '',
        value: '',
        hidden: false,
        dataset: {},
        addEventListener() {},
        classList: { add() {}, remove() {}, contains() { return false; }, toggle() {} },
        setAttribute() {},
        getAttribute() { return ''; },
        contains() { return false; },
        querySelector() { return null; },
        closest() { return null; },
      });
    }
    return elements.get(id);
  }
  const document = {
    readyState: 'complete',
    addEventListener() {},
    getElementById(id) { return getElement(id); },
    querySelector() { return null; },
    querySelectorAll() { return []; },
  };
  const window = {
    addEventListener() {},
    SoftoraMailboxOutreach: null,
    SoftoraMailboxCampaignInbox: {
      ...campaignInboxModule,
      load: async () => null,
    },
    SoftoraMailboxCompose: composeModule,
    SoftoraMailboxDelete: deleteModule,
    SoftoraMailboxList: listModule,
    SoftoraMailboxImages: options.SoftoraMailboxImages || imagesModule,
    SoftoraUiStateClient: null,
    SoftoraCampaignSenderSettings: null,
    SoftoraDialogs: options.SoftoraDialogs || null,
    confirm: options.confirm || (() => false),
  };
  const context = {
    URL,
    URLSearchParams,
    console,
    document,
    window,
    clearTimeout() {},
    setTimeout() { return 0; },
    fetch: options.fetch || (async () => ({
      ok: true,
      json: async () => ({
        ok: true,
        accounts: [{ email: 'serve@softora.nl', imapConfigured: true, smtpConfigured: true }],
        messages: [],
      }),
    })),
  };
  const source = readScript().replace(
    'bindMailboxActions();',
    'window.__mailboxTest = { renderMailBody, normalizeMailboxApiMessage, formatMailDate, display: window.SoftoraMailboxDisplay, index: window.SoftoraMailboxIndex, openMail, setMails(value) { mails = value; }, getActiveMail() { return activeMail; }, getElement(id) { return document.getElementById(id); } }; bindMailboxActions();'
  );
  vm.createContext(context);
  vm.runInContext(readDisplayScript(), context);
  vm.runInContext(readIndexScript(), context);
  vm.runInContext(source, context);
  return context.window.__mailboxTest;
}

function renderMailboxBodyForTest(body, images, options) {
  return loadMailboxHelpersForTest().renderMailBody(body, images, options);
}

test('mailbox toont een extern verzonden antwoord in dezelfde conversatie', () => {
  const html = renderMailboxBodyForTest(
    'Hoi Martijn,\n\nWelke techniek gebruik je?\n\nOp 22 juli 2026 schreef Martijn van de Ven:\n> Eerdere mail',
    [],
    {
      replyMailId: 'inbox:91',
      mail: {
        accountEmail: 'martijnven123@gmail.com',
        receivedAt: '2026-07-22T15:36:03.000Z',
        threadMessages: [{
          id: 'sent:102',
          folder: 'sent',
          accountEmail: 'martijnven123@gmail.com',
          date: '2026-07-23T09:21:00.000Z',
          body: 'Hoi Helma,\n\nIk bouw onze websites met maatwerk.\n\nOn Wed, Jul 22, 2026 wrote:\n> Welke techniek gebruik je?',
        }],
      },
    }
  );

  assert.match(html, /Jouw bericht/);
  assert.match(html, /Martijn van de Ven/);
  assert.match(html, /Ik bouw onze websites met maatwerk\./);
  const sentSection = html.match(
    /<section class="detail-mail-section detail-mail-section-sent">([\s\S]*?)<\/section>/
  );
  assert.ok(sentSection);
  assert.doesNotMatch(sentSection[1], /Welke techniek gebruik je/);
  assert.match(html, /class="detail-mail-section detail-mail-section-sent"/);
  assert.ok(html.indexOf('Jouw bericht') < html.indexOf('Welke techniek gebruik je?'));
  assert.ok(html.indexOf('Welke techniek gebruik je?') < html.indexOf('Beantwoorden'));
  assert.ok(html.indexOf('Beantwoorden') < html.indexOf('Jouw eerdere mail'));
});

test('mailbox koppelt coldmail-afbeeldingen aan het eigen verzonden bericht en niet aan de ontvangen reactie', () => {
  const tinyPng = 'data:image/png;base64,iVBORw0KGgo=';
  const html = renderMailboxBodyForTest(
    'Hoi Servé,\n\nMooi wat je hebt gemaakt, maar wij hebben geen interesse.\n\nSucces verder!',
    [
      { alt: 'stamhoeve.nl webdesign', dataUrl: tinyPng },
      { alt: 'stamhoeve.nl device mockup', dataUrl: tinyPng },
    ],
    {
      replyMailId: 'inbox:stamhoeve',
      mail: {
        folder: 'inbox',
        accountEmail: 'servec321@gmail.com',
        receivedAt: '2026-07-23T20:17:00.000Z',
        threadMessages: [
          {
            id: 'sent:stamhoeve-followup',
            folder: 'sent',
            accountEmail: 'servec321@gmail.com',
            date: '2026-07-23T19:00:00.000Z',
            body: [
              'Hoi,',
              '',
              'Bedankt voor je reactie.',
              '',
              'Op 23 jul 2026 om 11:00 schreef Servé Creusen:',
              '> [image: stamhoeve.nl webdesign]',
              '> [image: stamhoeve.nl device mockup]',
            ].join('\n'),
          },
          {
            id: 'sent:stamhoeve',
            folder: 'sent',
            accountEmail: 'servec321@gmail.com',
            date: '2026-07-23T09:00:00.000Z',
            body: [
              'Goedendag,',
              '',
              'Uit enthousiasme heb ik een fris webdesign gemaakt.',
              '[image: stamhoeve.nl webdesign]',
              'Hieronder zie je de eerste versie op verschillende schermen.',
              '[image: stamhoeve.nl device mockup]',
            ].join('\n'),
          },
        ],
      },
    }
  );

  const ownMessageStart = html.indexOf('Jouw bericht');
  assert.ok(ownMessageStart > html.indexOf('Succes verder!'));
  assert.doesNotMatch(html.slice(0, ownMessageStart), /<figure class="detail-mail-image">/);
  assert.equal((html.match(/<figure class="detail-mail-image">/g) || []).length, 2);
  assert.ok(html.indexOf('Uit enthousiasme heb ik een fris webdesign gemaakt.') < html.indexOf('<figure class="detail-mail-image">'));
  assert.doesNotMatch(html, /\[image:/i);
});

test('mailbox toont een oudere inkomende reactie als onderdeel van dezelfde conversatie', () => {
  const html = renderMailboxBodyForTest(
    'Dank voor je antwoord. Kun je ons daar meer over vertellen?',
    [],
    {
      replyMailId: 'inbox:37476',
      mail: {
        accountEmail: 'martijnven123@gmail.com',
        receivedAt: '2026-07-23T09:21:00.000Z',
        threadMessages: [{
          id: 'inbox:37467',
          folder: 'inbox',
          accountEmail: 'martijnven123@gmail.com',
          date: '2026-07-22T15:36:03.000Z',
          body: 'Mag ik vragen waar jij het liefst je sites mee bouwt?',
        }],
      },
    }
  );

  assert.match(html, /Eerder ontvangen/);
  assert.match(html, /Mag ik vragen waar jij het liefst je sites mee bouwt\?/);
  assert.doesNotMatch(html, /Jouw bericht/);
  assert.match(html, /class="detail-mail-section detail-mail-section-received"/);
  assert.doesNotMatch(html, /detail-mail-section-received[^>]*detail-mail-section-sent/);
  assert.ok(html.indexOf('Beantwoorden') < html.indexOf('Eerder ontvangen'));
});

test('mailbox houdt Outlook-citaten buiten Jouw bericht en bouwt Ralphs tijdlijn nieuwste eerst op', () => {
  const html = renderMailboxBodyForTest(
    [
      'Hi Martijn,',
      '',
      'Dank voor je bericht.',
      'Ik heb via Claude Design zelf mijn website vernieuwd.',
      '',
      'Op ma 15 jun 2026 om 15:48 schreef Martijn van de Ven:',
      '> Goededag,',
    ].join('\n'),
    [],
    {
      replyMailId: 'inbox:23',
      mail: {
        accountEmail: 'martijn@softora.nl',
        receivedAt: '2026-06-15T13:58:18.000Z',
        threadMessages: [
          {
            id: 'sent:149',
            folder: 'sent',
            accountEmail: 'martijn@softora.nl',
            date: '2026-06-23T11:32:58.000Z',
            body: [
              'Hoi Ralph,',
              '',
              'Misschien heb je mijn mailtje gemist.',
              '',
              '________________________________',
              'Van: Martijn van de Ven',
              'Verzonden: dinsdag 16 juni 2026 14:31',
              'Aan: Ralph Ruyters',
              'Onderwerp: Re: Kleine vraag over jullie website',
              '',
              'Hoi Ralph,',
              'Dankjewel voor je reactie.',
            ].join('\n'),
          },
          {
            id: 'sent:111',
            folder: 'sent',
            accountEmail: 'martijn@softora.nl',
            date: '2026-06-16T12:31:32.000Z',
            body: [
              'Hoi Ralph,',
              '',
              'Dankjewel voor je reactie! Dat klinkt goed 😁',
              '',
              '________________________________',
              'Van: Ralph Ruyters',
              'Verzonden: maandag 15 juni 2026 15:58',
              'Aan: martijn@softora.nl',
              'Onderwerp: Re: Kleine vraag over jullie website',
              '',
              'Hi Martijn,',
              'Ik heb via Claude Design zelf mijn website vernieuwd.',
            ].join('\n'),
          },
        ],
      },
    }
  );

  const sentSections = Array.from(html.matchAll(
    /<section class="detail-mail-section detail-mail-section-sent">([\s\S]*?)<\/section>/g
  )).map((match) => match[1]);
  assert.equal(sentSections.length, 2);
  assert.match(sentSections[0], /Misschien heb je mijn mailtje gemist\./);
  assert.match(sentSections[1], /Dankjewel voor je reactie! Dat klinkt goed/);
  sentSections.forEach((section) => {
    assert.doesNotMatch(section, /Van: Ralph Ruyters|Verzonden:|Claude Design/);
  });
  assert.ok(html.indexOf('Misschien heb je mijn mailtje gemist.') < html.indexOf('Dankjewel voor je reactie!'));
  assert.ok(html.indexOf('Dankjewel voor je reactie!') < html.indexOf('Hi Martijn,'));
  assert.ok(html.indexOf('Hi Martijn,') < html.indexOf('Beantwoorden'));
});

test('mailbox toont een gestructureerd antwoord niet nogmaals als Gmail-citaat', () => {
  const html = renderMailboxBodyForTest(
    [
      'Hoi Martijn,',
      '',
      'Wij werken met Bricks en zijn daar tevreden over.',
      '',
      'Op do 23 jul 2026 om 11:08 schreef Martijn van de Ven:',
      '> Hoi Helma,',
      '>',
      '> Dankjewel voor je antwoord.',
      '> Wij bouwen onze websites met maatwerk.',
      '>',
      '> Op wo 22 jul 2026 om 17:36 schreef Helma Schellen:',
      '>> Mag ik vragen waar jij je sites mee bouwt?',
    ].join('\n'),
    [],
    {
      replyMailId: 'inbox:37476',
      mail: {
        accountEmail: 'martijnven123@gmail.com',
        receivedAt: '2026-07-23T09:31:00.000Z',
        threadMessages: [
          {
            id: 'sent:37475',
            folder: 'sent',
            accountEmail: 'martijnven123@gmail.com',
            date: '2026-07-23T09:08:00.000Z',
            body: [
              'Hoi Helma,',
              '',
              'Dankjewel voor je antwoord.',
              'Wij bouwen onze websites met maatwerk.',
              '',
              'Op wo 22 jul 2026 om 17:36 schreef Helma Schellen:',
              '> Mag ik vragen waar jij je sites mee bouwt?',
            ].join('\n'),
          },
          {
            id: 'inbox:37467',
            folder: 'inbox',
            accountEmail: 'martijnven123@gmail.com',
            date: '2026-07-22T15:36:03.000Z',
            body: 'Mag ik vragen waar jij je sites mee bouwt?',
          },
        ],
      },
    }
  );

  assert.match(html, /Wij werken met Bricks en zijn daar tevreden over\./);
  assert.match(html, /Jouw bericht/);
  assert.equal((html.match(/Wij bouwen onze websites met maatwerk\./g) || []).length, 1);
  assert.doesNotMatch(html, /Jouw eerdere mail/);
  assert.doesNotMatch(html, /detail-mail-section-quote/);
  assert.match(html, /Eerder ontvangen/);
});

test('mailbox herkent Gmail-citaten met een auteursnaam na schreef als dezelfde conversatie', () => {
  const sentBody = [
    'Hoi Helma,',
    '',
    'Dankjewel voor je reactie, en leuk om te horen dat je het design mooi vindt!',
    'Wij bouwen onze websites volledig met code.',
    '',
    'Met vriendelijke groet,',
    'Martijn van de Ven',
    '',
    'Op wo 22 jul 2026 om 17:36 schreef Seats 2 Meet Station Den Bosch :',
    '> Hoi Martijn',
    '>',
    '> Mag ik vragen waar jij het liefst je sites mee bouwt?',
  ].join('\n');
  const html = renderMailboxBodyForTest(
    [
      'hoi Martijn',
      '',
      'Dank je wel voor het aanbod, maar we hebben al een team van experts.',
      '',
      'Op do 23 jul 2026 om 11:08 schreef Martijn Van De Ven :',
      '> Hoi Helma,',
      '>',
      '> Dankjewel voor je reactie, en leuk om te horen dat je het design mooi vindt!',
      '> Wij bouwen onze websites volledig met code.',
      '>',
      '> Met vriendelijke groet,',
      '> Martijn van de Ven',
      '>',
      '> Op wo 22 jul 2026 om 17:36 schreef Seats 2 Meet Station Den Bosch info@seats2meetstationdenbosch.nl>:',
      '>> Hoi Martijn',
      '>>',
      '>> Mag ik vragen waar jij het liefst je sites mee bouwt?',
    ].join('\n'),
    [],
    {
      replyMailId: 'inbox:37476',
      mail: {
        accountEmail: 'martijnven123@gmail.com',
        receivedAt: '2026-07-23T09:31:11.000Z',
        threadMessages: [
          {
            id: 'sent:656',
            folder: 'sent',
            accountEmail: 'martijnven123@gmail.com',
            date: '2026-07-23T09:08:10.000Z',
            body: sentBody,
          },
          {
            id: 'inbox:37467',
            folder: 'inbox',
            accountEmail: 'martijnven123@gmail.com',
            date: '2026-07-22T15:36:03.000Z',
            body: 'Hoi Martijn\n\nMag ik vragen waar jij het liefst je sites mee bouwt?',
          },
        ],
      },
    }
  );

  assert.match(html, /Dank je wel voor het aanbod, maar we hebben al een team van experts\./);
  assert.equal((html.match(/Wij bouwen onze websites volledig met code\./g) || []).length, 1);
  assert.equal((html.match(/Mag ik vragen waar jij het liefst je sites mee bouwt\?/g) || []).length, 1);
  assert.doesNotMatch(html, /Jouw eerdere mail/);
  assert.doesNotMatch(html, /Op do 23 jul 2026 om 11:08 schreef Martijn Van De Ven/);
});

test('mailbox toont een gestructureerd antwoord niet nogmaals na Outlook-headervelden', () => {
  const sentBody = [
    'Goedendag,',
    '',
    'Afgelopen week kwam ik jullie website censorbestuur.nl tegen.',
    'Uit enthousiasme heb ik een fris webdesign gemaakt.',
    '',
    'Met vriendelijke groet,',
    'Martijn van de Ven',
  ].join('\n');
  const html = renderMailboxBodyForTest(
    [
      'Jammer, Martijn, we hebben net een nieuwe website.',
      '',
      'Van: Martijn van de Ven',
      'Datum: vrijdag, 17 juli 2026 om 09:54',
      'Aan: Censor Bestuur',
      'Onderwerp: Kleine vraag over jullie website',
      '',
      sentBody,
    ].join('\n'),
    [],
    {
      replyMailId: 'inbox:400',
      mail: {
        accountEmail: 'martijnvandeven@softora.nl',
        receivedAt: '2026-07-23T11:54:00.000Z',
        threadMessages: [
          {
            id: 'sent:399',
            folder: 'sent',
            accountEmail: 'martijnvandeven@softora.nl',
            date: '2026-07-17T07:54:00.000Z',
            body: sentBody,
          },
        ],
      },
    }
  );

  assert.match(html, /Jammer, Martijn, we hebben net een nieuwe website\./);
  assert.match(html, /Jouw bericht/);
  assert.equal((html.match(/Afgelopen week kwam ik jullie website censorbestuur\.nl tegen\./g) || []).length, 1);
  assert.doesNotMatch(html, /Jouw eerdere mail/);
  assert.doesNotMatch(html, /detail-mail-section-quote/);
});

test('mailbox toont dezelfde coldmail met afbeeldingsplaceholders niet dubbel', () => {
  const quotedColdmail = [
    'Goedendag,',
    '',
    'Afgelopen week kwam ik jullie website nicolevintagefashion\u2060.\u2060com tegen.',
    '',
    'Uit enthousiasme heb ik een fris webdesign gemaakt, gewoon omdat ik dat leuk vind.',
    '',
    'Ik ben oprecht benieuwd wat je ervan vindt en hoor graag je eerlijke mening 😁',
    '',
    'Lukt het niet om de bijlage te openen? Dan kun je het webdesign ook via deze link',
    '[https://www.softora.nl/webdesign/nicole-vintage-fashion?sender=serve] bekijken 🎨',
    '',
    'Met vriendelijke groet,',
    'Servé Creusen',
    '',
    'Hieronder zie je een korte indruk van de eerste versie op verschillende schermen.',
  ].join('\n');
  const sentColdmail = [
    'Goedendag,',
    '',
    'Afgelopen week kwam ik jullie website nicolevintagefashion.com tegen.',
    '',
    'Uit enthousiasme heb ik een fris webdesign gemaakt, gewoon omdat ik dat leuk vind.',
    '',
    'Ik ben oprecht benieuwd wat je ervan vindt en hoor graag je eerlijke mening 😁',
    '',
    'Lukt het niet om de bijlage te openen? Dan kun je het webdesign ook via deze link',
    'https://www.softora.nl/webdesign/nicole-vintage-fashion?sender=serve bekijken 🎨',
    '',
    'Met vriendelijke groet,',
    'Servé Creusen',
    '',
    '[image: nicolevintagefashion.com-preview]',
    'Hieronder zie je een korte indruk van de eerste versie op verschillende schermen.',
    '[image: nicolevintagefashion.com-preview-device-mockup-v8]',
  ].join('\n');
  const html = renderMailboxBodyForTest(
    [
      'Bedankt voor je bericht, maar we hebben geen interesse.',
      '',
      'Op 21 jul 2026 om 11:52 heeft Servé Creusen het volgende geschreven:',
      '',
      quotedColdmail,
    ].join('\n'),
    [],
    {
      replyMailId: 'inbox:500',
      mail: {
        accountEmail: 'servecreusen7@gmail.com',
        receivedAt: '2026-07-22T09:21:00.000Z',
        threadMessages: [{
          id: 'sent:499',
          folder: 'sent',
          accountEmail: 'servecreusen7@gmail.com',
          date: '2026-07-21T09:52:00.000Z',
          body: sentColdmail,
        }],
      },
    }
  );

  assert.match(html, /Jouw bericht/);
  assert.equal((html.match(/Afgelopen week kwam ik jullie website nicolevintagefashion\.com tegen\./g) || []).length, 1);
  assert.doesNotMatch(html, /Jouw eerdere mail/);
  assert.doesNotMatch(html, /detail-mail-section-quote/);
});

test('mailbox dedupliceert coldmail generiek ondanks Gmail-linkopmaak en templateverschillen', () => {
  const quotedColdmail = [
    'Goedendag,',
    '',
    'Afgelopen week kwam ik jullie website thechamomilecollective\u2060.\u2060nl tegen.',
    '',
    'Uit enthousiasme heb ik een fris webdesign gemaakt, gewoon omdat ik dat leuk vind.',
    'Je vindt het ontwerp in de bijlage bij deze e-mail.',
    '',
    'Ik ben oprecht benieuwd wat je ervan vindt en hoor graag je eerlijke mening 😁',
    '',
    'Ik kan ook de online preview doorsturen, zodat je zelf door het ontwerp kunt scrollen.',
    '',
    'Mocht je er niets mee willen doen, dan is dat natuurlijk ook prima! Wel lijkt het me tof om te horen wat je van het design vindt en wat er eventueel beter kan. Daar leer ik dan weer van!',
    '',
    'Lukt het niet om de bijlage te openen? Dan kun je het webdesign ook via deze link',
    '(https://www.softora.nl/webdesign/the-chamomile-collective?cid=safe-dedupe-20260615-row-2149-6137264c438&sender=serve) bekijken 🎨',
    '',
    'Met vriendelijke groet,',
    'Servé Creusen',
    '',
    '📍 Tilburg',
  ].join('\n');
  const sentColdmail = [
    'Goedendag,',
    '',
    'Afgelopen week kwam ik jullie website thechamomilecollective.nl tegen.',
    '',
    'Uit enthousiasme heb ik een fris webdesign gemaakt, gewoon omdat ik dat leuk vind. Je vindt het ontwerp in de bijlage bij deze e-mail.',
    '',
    'Ik ben oprecht benieuwd wat je ervan vindt en hoor graag je eerlijke mening 😁',
    '',
    'Ik kan ook de online preview doorsturen, zodat je zelf door het ontwerp kunt scrollen.',
    '',
    'Mocht je er niets mee willen doen, dan is dat natuurlijk ook prima! Wel lijkt het me tof om te horen wat je van het design vindt en wat er eventueel beter kan. Daar leer ik dan weer van!',
    '',
    'Lukt het niet om de bijlage te openen? Dan kun je het webdesign ook via deze link bekijken 🎨',
    '',
    'Met vriendelijke groet,',
    'Servé Creusen',
    '',
    '📍 Tilburg',
    '',
    '[image: thechamomilecollective.nl-preview]',
    'Hieronder zie je een korte indruk van de eerste versie op verschillende schermen.',
    '[image: thechamomilecollective.nl-preview-device-mockup-v8]',
  ].join('\n');
  const html = renderMailboxBodyForTest(
    [
      'Hoi Servé, bedankt voor het ontwerp. Wij hebben op dit moment geen interesse.',
      '',
      'Op do., jul. 23, 2026 om 10:13, Servé Creusen schreef:',
      '',
      quotedColdmail,
    ].join('\n'),
    [],
    {
      replyMailId: 'inbox:elise',
      mail: {
        accountEmail: 'servecreusen7@gmail.com',
        receivedAt: '2026-07-23T09:01:00.000Z',
        threadMessages: [{
          id: 'sent:elise',
          folder: 'sent',
          accountEmail: 'servecreusen7@gmail.com',
          date: '2026-07-23T08:13:00.000Z',
          body: sentColdmail,
        }],
      },
    }
  );

  assert.match(html, /Hoi Servé, bedankt voor het ontwerp\./);
  assert.match(html, /Jouw bericht/);
  assert.equal((html.match(/Afgelopen week kwam ik jullie website thechamomilecollective\.nl tegen\./g) || []).length, 1);
  assert.doesNotMatch(html, /Jouw eerdere mail/);
  assert.doesNotMatch(html, /detail-mail-section-quote/);
});

test('mailbox dedupliceert een coldmail wanneer Gmail alleen het campagneadres in de citaatkop zet', () => {
  const coldmail = [
    'Goedendag,',
    '',
    'Afgelopen week kwam ik jullie website studiochristinejetten.nl tegen.',
    '',
    'Uit enthousiasme heb ik een fris webdesign gemaakt, gewoon omdat ik dat leuk vind.',
    '',
    'Ik ben oprecht benieuwd wat je ervan vindt en hoor graag je eerlijke mening 😁',
    '',
    'Met vriendelijke groet,',
    'Servé Creusen',
  ].join('\n');
  const html = renderMailboxBodyForTest(
    [
      'Hoi Servé, bedankt voor je bericht.',
      '',
      'Van: servecreusen7@gmail.com',
      '',
      coldmail,
    ].join('\n'),
    [],
    {
      replyMailId: 'inbox:christine',
      mail: {
        accountEmail: 'servecreusen7@gmail.com',
        receivedAt: '2026-07-23T09:27:00.000Z',
        threadMessages: [{
          id: 'sent:christine',
          folder: 'sent',
          accountEmail: 'servecreusen7@gmail.com',
          date: '2026-07-23T08:13:00.000Z',
          body: coldmail,
        }],
      },
    }
  );

  assert.match(html, /Hoi Servé, bedankt voor je bericht\./);
  assert.match(html, /Jouw bericht/);
  assert.equal((html.match(/Afgelopen week kwam ik jullie website studiochristinejetten\.nl tegen\./g) || []).length, 1);
  assert.doesNotMatch(html, /Jouw eerdere mail|Eerdere mail/);
  assert.doesNotMatch(html, /detail-mail-section-quote/);
});

test('mailbox voegt vergelijkbare coldmails voor verschillende websites nooit samen', () => {
  const html = renderMailboxBodyForTest(
    [
      'Bedankt voor je bericht.',
      '',
      'Op 23 jul 2026 om 10:13 heeft Servé Creusen het volgende geschreven:',
      '',
      'Goedendag,',
      '',
      'Afgelopen week kwam ik jullie website ander-bedrijf.nl tegen.',
      '',
      'Uit enthousiasme heb ik een fris webdesign gemaakt, gewoon omdat ik dat leuk vind.',
      '',
      'Ik ben oprecht benieuwd wat je ervan vindt en hoor graag je eerlijke mening.',
      '',
      'Met vriendelijke groet,',
      'Servé Creusen',
    ].join('\n'),
    [],
    {
      replyMailId: 'inbox:other-domain',
      mail: {
        accountEmail: 'servecreusen7@gmail.com',
        receivedAt: '2026-07-23T09:21:00.000Z',
        threadMessages: [{
          id: 'sent:current-domain',
          folder: 'sent',
          accountEmail: 'servecreusen7@gmail.com',
          date: '2026-07-23T08:52:00.000Z',
          body: [
            'Goedendag,',
            '',
            'Afgelopen week kwam ik jullie website huidig-bedrijf.nl tegen.',
            '',
            'Uit enthousiasme heb ik een fris webdesign gemaakt, gewoon omdat ik dat leuk vind.',
            '',
            'Ik ben oprecht benieuwd wat je ervan vindt en hoor graag je eerlijke mening.',
            '',
            'Met vriendelijke groet,',
            'Servé Creusen',
          ].join('\n'),
        }],
      },
    }
  );

  assert.match(html, /Jouw eerdere mail/);
  assert.match(html, /Afgelopen week kwam ik jullie website ander-bedrijf\.nl tegen\./);
});

test('mailbox laat een inhoudelijk andere eerdere eigen mail wel staan', () => {
  const html = renderMailboxBodyForTest(
    [
      'Bedankt voor de uitleg.',
      '',
      'Op 21 jul 2026 om 11:52 heeft Servé Creusen het volgende geschreven:',
      '',
      'Hoi Nicole,',
      '',
      'Hierbij stuur ik een nieuw voorstel met een andere prijs en planning.',
    ].join('\n'),
    [],
    {
      replyMailId: 'inbox:501',
      mail: {
        accountEmail: 'servecreusen7@gmail.com',
        receivedAt: '2026-07-22T09:21:00.000Z',
        threadMessages: [{
          id: 'sent:500',
          folder: 'sent',
          accountEmail: 'servecreusen7@gmail.com',
          date: '2026-07-21T09:52:00.000Z',
          body: [
            'Goedendag,',
            '',
            'Afgelopen week kwam ik jullie website nicolevintagefashion.com tegen.',
            'Uit enthousiasme heb ik een fris webdesign gemaakt.',
          ].join('\n'),
        }],
      },
    }
  );

  assert.match(html, /Jouw bericht/);
  assert.match(html, /Jouw eerdere mail/);
  assert.match(html, /Hierbij stuur ik een nieuw voorstel met een andere prijs en planning\./);
});

test('mailbox knipt een normale Van-regel zonder Outlook-headercluster niet af', () => {
  const html = campaignInboxModule.renderThreadMessages(
    {
      receivedAt: '2026-06-15T13:58:18.000Z',
      accountEmail: 'martijn@softora.nl',
      threadMessages: [{
        folder: 'sent',
        accountEmail: 'martijn@softora.nl',
        date: '2026-06-16T12:31:32.000Z',
        body: 'Hoi Ralph,\n\nVan: onze kant ziet het voorstel er goed uit.',
      }],
    },
    (value) => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'),
    () => ({ date: '16 juni', time: '14:31' }),
    { position: 'newer' }
  );

  assert.match(html, /Van: onze kant ziet het voorstel er goed uit\./);
});

test('premium mailbox ververst handmatig en automatisch iedere vijf minuten', async () => {
  assert.match(readPage(), /assets\/premium-mailbox\.js\?v=20260723r/);
  assert.match(readPage(), /assets\/premium-mailbox-campaign-inbox\.js\?v=20260723s/);
  assert.match(readPage(), /assets\/premium-mailbox-index\.js\?v=20260723d/);
  let nowMs = Date.parse('2026-07-22T17:30:00.000Z');
  const requests = [];
  const loads = [];
  const toasts = [];
  const intervals = [];
  const ageLabel = {
    textContent: '',
    attributes: {},
    setAttribute(name, value) { this.attributes[name] = value; },
  };
  const button = {
    disabled: false,
    classList: { toggle() {} },
    setAttribute() {},
    addEventListener(_event, handler) { this.clickHandler = handler; },
  };
  const controller = refreshModule.create({
    button,
    ageLabel,
    now: () => nowMs,
    getAccount: () => 'serve@softora.nl',
    getFolder: () => 'outreach',
    fetch: async (url, options) => {
      requests.push({ url, options });
      return { ok: true, json: async () => ({ ok: true }) };
    },
    loadMessages: async (options) => loads.push(options),
    toast: (message) => toasts.push(message),
    setInterval: (handler, delay) => { intervals.push({ handler, delay }); return 1; },
  });

  assert.equal(intervals.length, 2);
  assert.deepEqual(intervals.map((entry) => entry.delay), [5 * 60 * 1000, 1000]);
  assert.equal(ageLabel.textContent, '0 sec geleden');
  nowMs += 1 * 1000;
  intervals[1].handler();
  assert.equal(ageLabel.textContent, '1 sec geleden');
  nowMs += 28 * 1000;
  intervals[1].handler();
  assert.equal(ageLabel.textContent, '29 sec geleden');
  nowMs += 91 * 1000;
  intervals[1].handler();
  assert.equal(ageLabel.textContent, '2 min geleden');
  assert.equal(typeof button.clickHandler, 'function');
  assert.equal(await controller.refresh({ manual: true }), true);
  assert.equal(ageLabel.textContent, '0 sec geleden');
  assert.equal(requests[0].url, '/api/mailbox/sync');
  assert.deepEqual(JSON.parse(requests[0].options.body), {
    account: '', folder: 'inbox,sent', limit: 20, force: true, campaignOnly: true,
  });
  assert.deepEqual(loads[0], { showLoader: false, skipBackgroundSync: true, openLatest: false });
  assert.deepEqual(toasts, ['Mailbox bijgewerkt']);
});

test('premium mailbox uses an owner filter in the coldmail topbar', () => {
  const pageSource = readPage();
  const scriptSource = readScript();
  const campaignInboxSource = readCampaignInboxScript();
  const refreshSource = readRefreshScript();
  const indexSource = readIndexScript();
  const deleteSource = readDeleteScript();

  assert.doesNotMatch(pageSource, /<div class="topbar-title">Mailbox<\/div>/);
  assert.doesNotMatch(pageSource, /<span class="topbar-mailbox-account" id="topbar-mailbox-account"><\/span>/);
  assert.match(pageSource, /<button class="topbar-mailbox-switcher" id="mailbox-account-switcher" type="button" aria-haspopup="menu" aria-expanded="false">/);
  assert.match(pageSource, /<span class="topbar-mailbox-switcher-label" id="topbar-mailbox-account">Servé &amp; Martijn<\/span>/);
  assert.match(pageSource, /<div class="topbar-mailbox-menu" id="mailbox-account-menu" role="menu" aria-label="Campagne-eigenaar"><\/div>/);
  assert.match(pageSource, /<button class="topbar-refresh" id="mailbox-refresh" type="button" data-mailbox-action="refresh-mailbox" aria-label="Mailbox vernieuwen"/);
  assert.match(pageSource, /<span class="topbar-refresh-age" id="mailbox-refresh-age" aria-live="polite">0 sec geleden<\/span>/);
  assert.match(pageSource, /<div class="mail-sync-status" id="mail-sync-status" hidden><\/div>/);
  assert.match(pageSource, /\.topbar-mailbox-switcher-label \{[\s\S]*font-size:\s*14px;[\s\S]*color:\s*var\(--text-light\);[\s\S]*text-transform:\s*uppercase;/);
  assert.match(pageSource, /\.topbar-mailbox-menu \{[\s\S]*position:\s*absolute;[\s\S]*display:\s*none;/);
  assert.match(pageSource, /<script src="assets\/premium-ui-state-client\.js\?v=20260723c"><\/script><script src="assets\/premium-campaign-sender-settings\.js\?v=20260722a"><\/script><script src="assets\/premium-mailbox-outreach\.js\?v=20260720b"><\/script><script src="assets\/premium-mailbox-campaign-inbox\.js\?v=20260723s"><\/script><script src="assets\/premium-mailbox-images\.js\?v=20260723c"><\/script><script src="assets\/premium-mailbox-display\.js\?v=20260723g"><\/script><script src="assets\/premium-mailbox-list\.js\?v=20260723b"><\/script><script src="assets\/premium-mailbox-index\.js\?v=20260723d"><\/script><script src="assets\/premium-mailbox-refresh\.js\?v=20260723f"><\/script><script src="assets\/premium-mailbox-compose\.js\?v=20260723a"><\/script><script src="assets\/premium-mailbox-delete\.js\?v=20260723b"><\/script>\s*<script src="assets\/premium-mailbox\.js\?v=20260723r"><\/script>/);
  assert.match(readDisplayScript(), /global\.SoftoraMailboxDisplay =/);
  assert.match(indexSource, /window\.SoftoraMailboxIndex =/);
  assert.match(indexSource, /const MIN_BACKGROUND_SYNC_INTERVAL_MS = 5 \* 60 \* 1000;/);
  assert.match(indexSource, /now - lastBackgroundSyncAt < MIN_BACKGROUND_SYNC_INTERVAL_MS/);
  assert.match(scriptSource, /const MAILBOX_ACCOUNT_DEFAULT = 'info@softora\.nl';/);
  assert.match(scriptSource, /\/api\/mailbox\/accounts/);
  assert.match(scriptSource, /\/api\/mailbox\/messages\?account=/);
  assert.match(deleteSource, /\/api\/mailbox\/messages\/delete/);
  assert.match(scriptSource, /\/api\/mailbox\/send/);
  assert.match(scriptSource, /\/api\/mailbox\/rewrite/);
  assert.doesNotMatch(readOutreachScript(), /\/api\/coldmailing\/outreach\/status/);
  assert.match(scriptSource, /async function loadMailboxAccounts\(\)/);
  assert.match(scriptSource, /async function loadMailboxMessages\(options = \{\}\)/);
  assert.match(scriptSource, /window\.SoftoraMailboxRefresh\?\.create\(/);
  assert.match(refreshSource, /const AUTO_REFRESH_INTERVAL_MS = 5 \* 60 \* 1000;/);
  assert.match(refreshSource, /const REFRESH_AGE_UPDATE_INTERVAL_MS = 1000;/);
  assert.match(refreshSource, /function formatRefreshAge\(lastRefreshAt, currentTime = Date\.now\(\)\)/);
  assert.match(refreshSource, /async function refresh\(\{ manual = false \} = \{\}\)/);
  assert.match(refreshSource, /function startAutoRefresh\(\)/);
  assert.match(refreshSource, /button\.addEventListener\('click',[\s\S]*refresh\(\{ manual: true \}\)/);
  assert.match(refreshSource, /folder: activeFolder === 'outreach' \? 'inbox,sent' : activeFolder/);
  assert.match(refreshSource, /loadMessages\(\{ showLoader: false, skipBackgroundSync: true, openLatest: false \}\)/);
  assert.match(scriptSource, /let mailboxSyncState = null;/);
  assert.match(scriptSource, /void hydrateMailboxOutreachContextsInBackground\(\)\.catch/);
  assert.match(scriptSource, /data\?\.sync\?\.refreshRecommended/);
  assert.match(scriptSource, /Mailbox wordt bijgewerkt/);
  assert.match(indexSource, /\/api\/mailbox\/sync/);
  assert.match(indexSource, /\/api\/mailbox\/message/);
  assert.match(scriptSource, /async function sendMail\(\)/);
  assert.match(scriptSource, /const MAILBOX_PIN_SCOPE = 'premium_mailbox_preferences';/);
  assert.match(scriptSource, /const MAILBOX_PIN_KEY = 'softora_mailbox_pinned_account_v1';/);
  assert.match(campaignInboxSource, /const OWNER_PIN_KEY_PREFIX = 'softora_mailbox_pinned_owner_v1_';/);
  assert.match(scriptSource, /window\.SoftoraUiStateClient/);
  assert.match(scriptSource, /async function initializeMailboxAccountPreference\(\)/);
  assert.match(scriptSource, /SoftoraMailboxCampaignInbox\.initializeOwnerPreference\(session, window\.SoftoraUiStateClient, mailboxAccountPreferenceIdentity\)/);
  assert.match(scriptSource, /function getMailboxAccounts\(\) \{\s*return getMailboxAccountEmails\(\);\s*\}/);
  assert.match(scriptSource, /function getMailboxAccount\(\) \{\s*return activeMailboxAccount;\s*\}/);
  assert.match(scriptSource, /SoftoraMailboxCampaignInbox\.renderOwnerMenu\(escapeHtml\)/);
  assert.match(scriptSource, /SoftoraMailboxCampaignInbox\.filterMessages\(mails\)/);
  assert.match(scriptSource, /ownerButton\.dataset\.mailboxOwner/);
  assert.match(campaignInboxSource, /data-mailbox-pin-owner/);
  assert.match(campaignInboxSource, /async function pinOwner\(value, uiStateClient\)/);
  assert.match(campaignInboxSource, /patch: \{ \[getOwnerPinKeyForIdentity\(preferenceIdentity\)\]: pinnedOwner \}/);
  assert.match(scriptSource, /function renderMailboxAccountMenu\(\) \{[\s\S]*data-mailbox-email="\$\{escapeHtml\(email\)\}"/);
  assert.match(scriptSource, /data-mailbox-pin-email="\$\{escapeHtml\(email\)\}"/);
  assert.match(scriptSource, /async function pinMailboxAccount\(email\)/);
  assert.match(scriptSource, /async function applyMailboxAccount\(email, options = \{\}\) \{[\s\S]*activeMailboxAccount = hasMailboxAccount\(normalizedEmail\)[\s\S]*applyMailboxFolderUi\(activeFolder\);[\s\S]*setMailboxAccountUi\(activeMailboxAccount\);/);
  assert.match(scriptSource, /await initializeMailboxAccountPreference\(\);[\s\S]*SoftoraMailboxOutreach\.readIntent\(\)[\s\S]*await loadMailboxAccounts\(\);/);
  assert.match(scriptSource, /mailboxAccountSwitcher\.addEventListener\('click', function\(event\) \{/);
  assert.match(scriptSource, /mailboxAccountMenu\.addEventListener\('click', function\(event\) \{[\s\S]*applyMailboxAccount\(email\);/);
  assert.match(scriptSource, /mailboxAccountMenu\.addEventListener\('click', function\(event\) \{[\s\S]*pinMailboxAccount\(email\);/);
  assert.match(scriptSource, /mailboxAccountMenu\.addEventListener\('click', function\(event\) \{[\s\S]*SoftoraMailboxCampaignInbox\.pinOwner\(ownerButton\.dataset\.mailboxPinOwner, window\.SoftoraUiStateClient\)/);
});

test('coldmail eigenaarfilter houdt de negen campagneadressen gescheiden tussen Servé en Martijn', () => {
  const messages = [
    { id: 'serve-softora', accountEmail: 'serve@softora.nl', receivedAt: '2026-07-20T09:00:00.000Z' },
    { id: 'serve-alias', accountEmail: 'servecreusen@softora.nl', receivedAt: '2026-07-20T08:00:00.000Z' },
    { id: 'serve-gmail', accountEmail: 'servec321@gmail.com', receivedAt: '2026-07-20T07:00:00.000Z' },
    { id: 'serve-290', accountEmail: 'serve290@gmail.com', receivedAt: '2026-07-20T06:00:00.000Z' },
    { id: 'serve-7', accountEmail: 'servecreusen7@gmail.com', receivedAt: '2026-07-20T05:00:00.000Z' },
    { id: 'martijn-softora', accountEmail: 'martijn@softora.nl', receivedAt: '2026-07-20T04:00:00.000Z' },
    { id: 'martijn-alias', accountEmail: 'martijnvandeven@softora.nl', receivedAt: '2026-07-20T03:00:00.000Z' },
    { id: 'martijn-gmail', accountEmail: 'martijnven123@gmail.com', receivedAt: '2026-07-20T02:00:00.000Z' },
    { id: 'martijn-visuals', accountEmail: 'contact.venvisuals@gmail.com', receivedAt: '2026-07-20T01:00:00.000Z' },
    { id: 'info', accountEmail: 'info@softora.nl' },
    { id: 'ruben', accountEmail: 'ruben@softora.nl' },
    { id: 'zakelijk-softora', accountEmail: 'zakelijk@softora.nl' },
    { id: 'impactbox', accountEmail: 'zakelijk@theimpactbox.co' },
  ];

  campaignInboxModule.setOwner('servé');
  assert.equal(campaignInboxModule.getOwnerLabel(), 'Servé Creusen');
  assert.deepEqual(
    campaignInboxModule.filterMessages(messages).map((message) => message.id),
    messages.slice(0, 5).map((message) => message.id)
  );

  campaignInboxModule.setOwner('martijn');
  assert.equal(campaignInboxModule.getOwnerLabel(), 'Martijn van de Ven');
  assert.deepEqual(
    campaignInboxModule.filterMessages(messages).map((message) => message.id),
    messages.slice(5, 9).map((message) => message.id)
  );

  const ownerMenu = campaignInboxModule.renderOwnerMenu((value) => String(value));
  assert.match(ownerMenu, />Servé Creusen</);
  assert.match(ownerMenu, />Martijn van de Ven</);
  assert.doesNotMatch(ownerMenu, />Servé & Martijn</);
  assert.ok(ownerMenu.indexOf('Servé Creusen') < ownerMenu.indexOf('Martijn van de Ven'));
  assert.doesNotMatch(ownerMenu, /@/);
  campaignInboxModule.setOwner('serve');
});

test('coldmail lijst toont geen automatische antwoorden uit bootstrap- of sessiecache', () => {
  const messages = [
    {
      id: 'human',
      accountEmail: 'martijn@softora.nl',
      subject: 'Re: Kleine vraag over jullie website',
      body: 'Dank voor je ontwerp, maar wij hebben geen interesse.',
      receivedAt: '2026-07-23T09:00:00.000Z',
    },
    {
      id: 'qccs-away',
      accountEmail: 'martijn@softora.nl',
      subject: 'Afwezigheidmelding Re: Kleine vraag over jullie website',
      body: 'Vanaf 2 juli tot en met 3 augustus 2026 is ons kantoor gesloten.',
      receivedAt: '2026-07-23T10:00:00.000Z',
    },
    {
      id: 'body-only-auto',
      accountEmail: 'martijn@softora.nl',
      subject: 'Nieuw e-mailadres Re: Kleine vraag over jullie website',
      preview: 'Beste lezer, wij hebben een nieuw e-mailadres.',
      body: 'Dit bericht is automatisch gegenereerd.',
      receivedAt: '2026-07-23T11:00:00.000Z',
    },
    {
      id: 'sushi-auto',
      accountEmail: 'servecreusen7@gmail.com',
      subject: 'Re: Kleine vraag over jullie website',
      preview: 'Dit is een automatisch email van info@sushidetoren.com.',
      body: 'We hebben uw email in goede orde ontvangen en proberen uw email binnen 24 uur te beantwoorden.',
      receivedAt: '2026-07-23T12:00:00.000Z',
    },
    {
      id: 'human-about-automation',
      accountEmail: 'martijn@softora.nl',
      subject: 'Re: Kleine vraag over jullie website',
      body: 'Dank voor je mail. De automatische e-mail op onze website werkt inderdaad nog niet goed.',
      receivedAt: '2026-07-23T13:00:00.000Z',
    },
    {
      id: 'dietist-auto',
      accountEmail: 'serve@softora.nl',
      subject: 'Automatisch antwoorden: Nieuw webdesign gemaakt!',
      body: 'Hartelijk dank voor je email. Ik streef er naar om deze binnen 2 werkdagen te beantwoorden.',
      receivedAt: '2026-07-23T14:00:00.000Z',
    },
    {
      id: 'human-automation-question',
      accountEmail: 'martijn@softora.nl',
      subject: 'Vraag over automatisch antwoorden in Gmail',
      body: 'Kun je uitleggen hoe ik dit zelf instel?',
      receivedAt: '2026-07-23T15:00:00.000Z',
    },
  ];

  assert.equal(campaignInboxModule.isAutomatedCampaignReply(messages[0]), false);
  assert.equal(campaignInboxModule.isAutomatedCampaignReply(messages[1]), true);
  assert.equal(campaignInboxModule.isAutomatedCampaignReply(messages[2]), true);
  assert.equal(campaignInboxModule.isAutomatedCampaignReply(messages[3]), true);
  assert.equal(campaignInboxModule.isAutomatedCampaignReply(messages[4]), false);
  assert.equal(campaignInboxModule.isAutomatedCampaignReply(messages[5]), true);
  assert.equal(campaignInboxModule.isAutomatedCampaignReply(messages[6]), false);
  assert.deepEqual(
    campaignInboxModule.filterMessages(messages, 'martijn').map((message) => message.id),
    ['human-automation-question', 'human-about-automation', 'human']
  );
});

test('coldmail lijst groepeert een nieuw antwoord direct in het bestaande gespreksvak', () => {
  const originalMessageId = '<campaign-start@example.test>';
  const firstReplyMessageId = '<first-reply@example.test>';
  const messages = [
    {
      id: 'martijnven123@gmail.com|inbox:37476',
      mailboxId: 'inbox:37476',
      folder: 'inbox',
      accountEmail: 'martijnven123@gmail.com',
      from: 'Seats 2 Meet Station Den Bosch',
      email: 'info@seats2meetstationdenbosch.nl',
      subject: 'Re: Kleine vraag over jullie website',
      messageId: '<latest-reply@example.test>',
      inReplyTo: '<martijn-answer@example.test>',
      references: `${originalMessageId} ${firstReplyMessageId} <martijn-answer@example.test>`,
      receivedAt: '2026-07-23T09:31:11.000Z',
      unread: true,
      campaign: { account: 'martijnven123@gmail.com' },
    },
    {
      id: 'martijnven123@gmail.com|inbox:37467',
      mailboxId: 'inbox:37467',
      folder: 'inbox',
      accountEmail: 'martijnven123@gmail.com',
      from: 'Seats 2 Meet Station Den Bosch',
      email: 'info@seats2meetstationdenbosch.nl',
      subject: 'Re: Kleine vraag over jullie website',
      messageId: firstReplyMessageId,
      inReplyTo: originalMessageId,
      references: originalMessageId,
      receivedAt: '2026-07-22T15:36:03.000Z',
      campaign: { account: 'martijnven123@gmail.com' },
    },
  ];

  const grouped = campaignInboxModule.filterMessages(messages, 'martijn');

  assert.equal(grouped.length, 1);
  assert.equal(grouped[0].mailboxId, 'inbox:37476');
  assert.equal(grouped[0].unread, true);
  assert.equal(grouped[0].threadMessages.length, 1);
  assert.equal(grouped[0].threadMessages[0].mailboxId, 'inbox:37467');
  assert.equal(grouped[0].threadMessages[0].folder, 'inbox');
});

test('coldmail lijst bewaart meer dan tien berichten in dezelfde conversatie', () => {
  const threadMessages = Array.from({ length: 12 }, (_, index) => ({
    id: `sent:${index + 1}`,
    uid: index + 1,
    folder: 'sent',
    accountEmail: 'martijn@softora.nl',
    to: 'rruyters@road2value.com',
    date: new Date(Date.UTC(2026, 5, 23, 12, 0, 0) - index * 60_000).toISOString(),
    messageId: `<sent-${index + 1}@example.test>`,
  }));
  const grouped = campaignInboxModule.filterMessages([{
    id: 'inbox:23',
    mailboxId: 'inbox:23',
    folder: 'inbox',
    accountEmail: 'martijn@softora.nl',
    email: 'rruyters@road2value.com',
    conversationId: 'conversation:martijn@softora.nl|contact:rruyters@road2value.com',
    receivedAt: '2026-06-15T13:58:18.000Z',
    campaign: { account: 'martijn@softora.nl' },
    threadMessages,
  }], 'martijn');

  assert.equal(grouped.length, 1);
  assert.equal(grouped[0].threadMessages.length, 12);
  assert.deepEqual(
    grouped[0].threadMessages.map((message) => message.id),
    threadMessages.map((message) => message.id)
  );
});

test('coldmail berichten met hetzelfde IMAP-id blijven per mailboxaccount uniek', () => {
  const serveMail = campaignInboxModule.decorateMessage(
    { id: 'inbox:42' },
    {
      id: 'inbox:42',
      accountEmail: 'servecreusen@softora.nl',
      date: '2026-07-20T07:34:00.000Z',
    }
  );
  const martijnMail = campaignInboxModule.decorateMessage(
    { id: 'inbox:42' },
    {
      id: 'inbox:42',
      accountEmail: 'martijn@softora.nl',
      date: '2026-07-20T08:11:00.000Z',
    }
  );

  assert.equal(serveMail.id, 'servecreusen@softora.nl|inbox:42');
  assert.equal(martijnMail.id, 'martijn@softora.nl|inbox:42');
  assert.notEqual(serveMail.id, martijnMail.id);
  assert.equal(campaignInboxModule.getRequestId(serveMail), 'inbox:42');
  assert.equal(campaignInboxModule.getRequestId(martijnMail), 'inbox:42');
  assert.deepEqual(
    campaignInboxModule.filterMessages([serveMail, martijnMail], 'martijn').map((mail) => mail.id),
    ['martijn@softora.nl|inbox:42']
  );
});

test('coldmail eigenaar kiest per ingelogde gebruiker de eigen mailbox als standaard', () => {
  assert.equal(campaignInboxModule.resolveOwnerForSession({ email: 'serve@softora.nl' }), 'serve');
  assert.equal(campaignInboxModule.resolveOwnerForSession({ email: 'martijn@softora.nl' }), 'martijn');
  assert.equal(campaignInboxModule.resolveOwnerForSession({ displayName: 'Servé Creusen' }), 'serve');
  assert.equal(campaignInboxModule.resolveOwnerForSession({ displayName: 'Martijn van de Ven' }), 'martijn');
  assert.equal(campaignInboxModule.resolveOwnerForSession({ email: 'onbekend@softora.nl' }), 'serve');

  const serveMenu = campaignInboxModule.renderOwnerMenu(String, {
    defaultOwner: 'serve',
    pinnedOwner: '',
  });
  const martijnMenu = campaignInboxModule.renderOwnerMenu(String, {
    defaultOwner: 'martijn',
    pinnedOwner: '',
  });
  assert.ok(serveMenu.indexOf('Servé Creusen') < serveMenu.indexOf('Martijn van de Ven'));
  assert.ok(martijnMenu.indexOf('Martijn van de Ven') < martijnMenu.indexOf('Servé Creusen'));
  assert.doesNotMatch(serveMenu, /Servé & Martijn/);
  assert.doesNotMatch(martijnMenu, /Servé & Martijn/);
});

test('coldmail eigenaar kan alleen Servé of Martijn persoonlijk vastpinnen', () => {
  for (const owner of ['serve', 'martijn']) {
    const ownerMenu = campaignInboxModule.renderOwnerMenu(String, {
      defaultOwner: 'serve',
      pinnedOwner: owner,
    });
    assert.match(ownerMenu, new RegExp(`data-mailbox-pin-owner="${owner}"[^>]*[\\s\\S]*?`));
    assert.match(
      ownerMenu,
      new RegExp(`topbar-mailbox-option-row pinned[\\s\\S]*?data-mailbox-pin-owner="${owner}"`)
    );
  }

  const martijnPinnedMenu = campaignInboxModule.renderOwnerMenu(String, {
    defaultOwner: 'serve',
    pinnedOwner: 'martijn',
  });
  assert.ok(martijnPinnedMenu.indexOf('Martijn van de Ven') < martijnPinnedMenu.indexOf('Servé Creusen'));

  const legacyCombinedMenu = campaignInboxModule.renderOwnerMenu(String, {
    defaultOwner: 'serve',
    pinnedOwner: 'both',
  });
  assert.doesNotMatch(legacyCombinedMenu, /Servé & Martijn/);
  assert.doesNotMatch(legacyCombinedMenu, /topbar-mailbox-option-row pinned/);
});

test('coldmail eigenaarpin gebruikt een aparte server-state sleutel per gebruikersaccount', () => {
  assert.notEqual(
    campaignInboxModule.getOwnerPinKeyForIdentity('usr_serve'),
    campaignInboxModule.getOwnerPinKeyForIdentity('usr_martijn')
  );
  assert.equal(
    campaignInboxModule.getOwnerPinKeyForIdentity('usr_serve'),
    'softora_mailbox_pinned_owner_v1_usr_serve'
  );
  assert.equal(
    campaignInboxModule.getOwnerPinKeyForIdentity('usr_martijn'),
    'softora_mailbox_pinned_owner_v1_usr_martijn'
  );
});

test('coldmail eigenaarpin leest en schrijft alleen de voorkeur van de actieve gebruiker', async () => {
  const values = {
    softora_mailbox_pinned_owner_v1_usr_serve: 'both',
    softora_mailbox_pinned_owner_v1_usr_martijn: 'martijn',
  };
  const writes = [];
  const client = {
    async get(scope) {
      assert.equal(scope, 'premium_mailbox_preferences');
      return { values };
    },
    async set(scope, body) {
      writes.push({ scope, body });
      Object.assign(values, body.patch);
      return { ok: true };
    },
  };

  const serveState = await campaignInboxModule.initializeOwnerPreference(
    { email: 'serve@softora.nl' },
    client,
    'usr_serve'
  );
  assert.deepEqual(serveState, {
    defaultOwner: 'serve',
    pinnedOwner: '',
    activeOwner: 'serve',
  });
  const result = await campaignInboxModule.pinOwner('serve', client);
  assert.equal(result.saved, true);
  assert.equal(writes.length, 1);
  assert.deepEqual(writes[0], {
    scope: 'premium_mailbox_preferences',
    body: {
      patch: { softora_mailbox_pinned_owner_v1_usr_serve: 'serve' },
      source: 'premium-mailbox',
      actor: 'usr_serve',
    },
  });
  assert.equal(values.softora_mailbox_pinned_owner_v1_usr_martijn, 'martijn');
});

test('coldmail inbox sorteert na ieder eigenaarfilter op echte ontvangsttijd met nieuwste bovenaan', () => {
  const messages = [
    { id: 'oud', accountEmail: 'serve@softora.nl', receivedAt: '2026-07-18T14:00:00.000Z' },
    { id: 'nieuw', accountEmail: 'martijn@softora.nl', receivedAt: '2026-07-20T08:00:00.000Z' },
    { id: 'midden', accountEmail: 'servecreusen@softora.nl', receivedAt: '2026-07-19T18:00:00.000Z' },
  ];

  assert.deepEqual(
    campaignInboxModule.filterMessages(messages, 'serve').map((message) => message.id),
    ['midden', 'oud']
  );
  assert.deepEqual(
    campaignInboxModule.filterMessages(messages, 'martijn').map((message) => message.id),
    ['nieuw']
  );
});

test('mailbox opent bij eerste paginalaad automatisch de meest recente zichtbare mail', () => {
  const scriptSource = readScript();
  const renderListSource = scriptSource.match(/function renderList\(options = \{\}\) \{[\s\S]*?\n\}/)?.[0] || '';

  assert.match(renderListSource, /const hasVisibleActiveMail = activeMail != null && list\.some/);
  assert.match(renderListSource, /if \(!hasVisibleActiveMail\) activeMail = null;/);
  assert.match(renderListSource, /if \(!activeMail && options\.openLatest !== false\) openMail\(list\[0\]\.id\);/);
  assert.match(scriptSource, /renderList\(\{ openLatest: options\.openLatest !== false \}\)/);
  assert.match(scriptSource, /openLatest: !\(intent\.message \|\| intent\.email \|\| intent\.query\)/);
});

test('coldmail inbox toont de ontvangsttijd vast in Europe Amsterdam', () => {
  const helpers = loadMailboxHelpersForTest();
  const mail = helpers.normalizeMailboxApiMessage({
    id: 'inbox:101',
    folder: 'inbox',
    from: 'Rijs Textiles',
    email: 'support@rijstextiles.com',
    date: '2026-07-20T06:14:13.000Z',
  });

  assert.equal(mail.receivedAt, '2026-07-20T06:14:13.000Z');
  assert.equal(mail.time, '08:14');
});

test('coldmail rij gebruikt laatste gespreksactiviteit terwijl het geopende bericht zijn eigen datum houdt', () => {
  const helpers = loadMailboxHelpersForTest();
  const mail = helpers.normalizeMailboxApiMessage({
    id: 'inbox:ralph',
    folder: 'inbox',
    from: 'Ralph Ruyters',
    email: 'rruyters@road2value.com',
    receivedAt: '2026-06-15T13:58:18.000Z',
    activityAt: '2026-06-23T11:32:58.000Z',
  });
  const row = listModule.renderItem(mail, {
    activeMail: '',
    escapeHtml: String,
    display: helpers.display,
    displayOptions: { activeFolder: 'outreach', account: 'martijn@softora.nl' },
  });

  assert.equal(mail.date, '15 juni');
  assert.equal(mail.time, '15:58');
  assert.equal(mail.activityDate, '23 juni');
  assert.equal(mail.activityTime, '13:32');
  assert.match(row, /<span class="mail-date-label">23 juni<\/span>/);
  assert.match(row, /<span class="mail-time-value">13:32<\/span>/);
});

test('coldmail tabcache behoudt de echte ontvangsttijd en valt niet terug op middernacht', () => {
  const helpers = loadMailboxHelpersForTest();
  const mail = helpers.normalizeMailboxApiMessage({
    id: 'servecreusen@softora.nl|inbox:42',
    mailboxId: 'inbox:42',
    accountEmail: 'servecreusen@softora.nl',
    date: '20 juli',
    receivedAt: '2026-07-20T07:34:00.000Z',
  });

  assert.equal(mail.id, 'servecreusen@softora.nl|inbox:42');
  assert.equal(mail.mailboxId, 'inbox:42');
  assert.equal(mail.receivedAt, '2026-07-20T07:34:00.000Z');
  assert.equal(mail.time, '09:34');
});

test('coldmail inbox zet relatieve datum boven de tijd en oudere mails op dag en maand', () => {
  const helpers = loadMailboxHelpersForTest();
  const now = '2026-07-20T12:00:00.000Z';
  const today = helpers.formatMailDate('2026-07-20T06:14:00.000Z', now);
  const yesterday = helpers.formatMailDate('2026-07-19T14:57:00.000Z', now);
  const dayBeforeYesterday = helpers.formatMailDate('2026-07-18T07:28:00.000Z', now);
  const older = helpers.formatMailDate('2026-07-05T08:21:00.000Z', now);

  assert.equal(today.listDate, '');
  assert.equal(today.time, '08:14');
  assert.equal(yesterday.listDate, 'Gisteren');
  assert.equal(yesterday.time, '16:57');
  assert.equal(dayBeforeYesterday.listDate, 'Eergisteren');
  assert.equal(dayBeforeYesterday.time, '09:28');
  assert.equal(older.listDate, '5 juli');
  assert.equal(older.time, '10:21');
});

test('coldmail lijst toont uitsluitend ongelezen bolletje, afzender en datum met tijd', () => {
  const pageSource = readPage();
  const scriptSource = readScript();
  const renderListSource = scriptSource.match(/function renderList\(options = \{\}\) \{[\s\S]*?\n\}/)?.[0] || '';
  const listSource = readListScript();

  assert.match(renderListSource, /SoftoraMailboxList\.renderItem/);
  assert.match(listSource, /class="unread-dot"/);
  assert.match(listSource, /class="mail-from"/);
  assert.match(listSource, /class="mail-time"/);
  assert.match(listSource, /class="mail-date-label"/);
  assert.match(listSource, /class="mail-time-value"/);
  assert.match(listSource, /data-mailbox-received-at/);
  assert.doesNotMatch(listSource, /class="mail-subject"/);
  assert.doesNotMatch(listSource, /class="mail-preview"/);
  assert.doesNotMatch(renderListSource, /renderListMeta/);
  assert.doesNotMatch(pageSource, /\.mail-campaign-meta/);
  assert.match(pageSource, /\.mail-from \{[\s\S]*font-weight:\s*400;/);
  assert.match(pageSource, /\.mail-item\.unread \.mail-from \{\s*font-weight:\s*600;\s*\}/);
  assert.match(pageSource, /\.mail-item \{[\s\S]*min-height:\s*52px;/);
  assert.match(pageSource, /\.unread-dot \{[\s\S]*background:\s*var\(--crimson\);/);
  assert.match(pageSource, /\.mail-items \{[\s\S]*overflow-y:\s*auto;[\s\S]*scrollbar-width:\s*none;[\s\S]*-ms-overflow-style:\s*none;/);
  assert.match(pageSource, /\.mail-items::\-webkit\-scrollbar \{[\s\S]*display:\s*none;/);
  assert.match(pageSource, /\.mail-time \{[\s\S]*flex-direction:\s*column;[\s\S]*align-items:\s*flex-end;/);
});

test('geselecteerde mailboxrij toont een aparte verwijderknop zonder de openactie te vervangen', () => {
  const pageSource = readPage();
  const scriptSource = readScript();
  const listSource = fs.readFileSync(listScriptPath, 'utf8');

  assert.match(pageSource, /assets\/premium-mailbox-list\.js/);
  assert.match(scriptSource, /SoftoraMailboxList\.renderItem/);
  assert.match(listSource, /const isActive = String\(options\.activeMail\) === String\(mail\.id\);/);
  assert.match(listSource, /class="mail-item-open"[\s\S]*data-mailbox-action="open-mail"/);
  assert.match(listSource, /\$\{isActive \? `[\s\S]*class="mail-item-delete"[\s\S]*data-mailbox-action="delete-mail"/);
  assert.match(listSource, /aria-label="Mail verwijderen"/);
  assert.match(pageSource, /\.mail-item-delete \{[\s\S]*color:\s*var\(--crimson\);[\s\S]*cursor:\s*pointer;/);
  assert.match(pageSource, /\.mail-item-open:focus-visible \{[\s\S]*outline:/);

  const escaped = (value) => String(value || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;');
  const baseOptions = {
    display: { getListPrimaryText: () => 'Noortje Vogels' },
    displayOptions: { account: 'serve@softora.nl' },
    escapeHtml: escaped,
  };
  const activeRow = listModule.renderItem({ id: 'inbox:42', time: '13:41' }, { ...baseOptions, activeMail: 'inbox:42' });
  const inactiveRow = listModule.renderItem({ id: 'inbox:43', time: '13:42' }, { ...baseOptions, activeMail: 'inbox:42' });

  assert.match(activeRow, /data-mailbox-action="delete-mail"/);
  assert.doesNotMatch(inactiveRow, /data-mailbox-action="delete-mail"/);
});

test('premium mailbox toont bij verzonden mails de ontvanger als hoofdregel', () => {
  const helpers = loadMailboxHelpersForTest();
  const mail = helpers.normalizeMailboxApiMessage({
    id: 'sent:42',
    folder: 'sent',
    from: 'Servé Creusen',
    email: 'serve@softora.nl',
    to: 'info@jagthuijs.nl',
    subject: 'Nieuw webdesign gemaakt!',
    preview: 'Goedemiddag',
    date: '2026-05-19T17:02:00.000Z',
  });

  assert.equal(mail.to, 'info@jagthuijs.nl');
  assert.equal(helpers.display.getListPrimaryText(mail), 'Aan: info@jagthuijs.nl');
  assert.equal(helpers.display.getDetailPrimaryText(mail), 'Aan: info@jagthuijs.nl');
  assert.equal(helpers.display.getDetailSecondaryText(mail), 'Van: serve@softora.nl');
  assert.equal(helpers.display.getReplyToAddress(mail), 'info@jagthuijs.nl');
});

test('premium mailbox houdt account-dropdown zichtbaar boven de inbox-layout', () => {
  const pageSource = readPage();

  assert.match(pageSource, /\.topbar \{[\s\S]*overflow:\s*visible;[\s\S]*position:\s*relative;[\s\S]*z-index:\s*40;/);
  assert.match(pageSource, /\.topbar-title-wrap \{[\s\S]*position:\s*relative;[\s\S]*z-index:\s*45;/);
  assert.match(pageSource, /\.topbar-mailbox-menu \{[\s\S]*max-height:\s*min\(320px,\s*calc\(100vh - 90px\)\);[\s\S]*overflow-y:\s*auto;[\s\S]*z-index:\s*60;/);
  assert.match(pageSource, /\.topbar-mailbox-option-row \{[\s\S]*display:\s*flex;[\s\S]*align-items:\s*center;/);
  assert.match(pageSource, /\.topbar-mailbox-pin\.active \{[\s\S]*color:\s*var\(--crimson\);/);
});

test('premium mailbox toont geen interne mappen-sidebar meer', () => {
  const pageSource = readPage();

  assert.doesNotMatch(pageSource, /class="mail-sidebar"/);
  assert.doesNotMatch(pageSource, /class="folder-item/);
  assert.doesNotMatch(pageSource, /data-mailbox-folder=/);
  assert.doesNotMatch(pageSource, />Losse mailbox</);
  assert.doesNotMatch(pageSource, /\.mail-sidebar\s*\{/);
});

test('premium mailbox compose gebruikt Softora styling zonder dubbele verwijderknop', () => {
  const pageSource = readPage();

  assert.match(pageSource, /\.compose-head \{[\s\S]*background:\s*var\(--crimson\);/);
  assert.match(pageSource, /\.compose-footer \{[\s\S]*justify-content:\s*space-between;/);
  assert.match(pageSource, /\.btn-rewrite-compose \{[\s\S]*color:\s*var\(--crimson\);/);
  assert.match(pageSource, /data-mailbox-action="rewrite-compose">Voorgestelde reactie<\/button>/);
  assert.match(pageSource, /<button class="compose-x" type="button" data-mailbox-action="close-compose" aria-label="Sluiten">×<\/button>/);
  assert.doesNotMatch(pageSource, /class="btn-discard"/);
  assert.doesNotMatch(pageSource, />Verwijderen<\/button>/);
});

test('premium mailbox kan vanuit de mailcontext een voorgestelde reactie schrijven', () => {
  const pageSource = readPage();
  const scriptSource = readScript();

  assert.match(pageSource, /data-mailbox-action="rewrite-compose">Voorgestelde reactie<\/button>/);
  assert.match(scriptSource, /let composeReplyContext = null;/);
  assert.match(scriptSource, /function buildComposeRewriteContext\(\)/);
  assert.match(scriptSource, /async function rewriteComposeBody\(\)/);
  assert.match(scriptSource, /\/api\/mailbox\/rewrite/);
  assert.match(scriptSource, /function loadMailboxSenderProfile\(senderEmail = getMailboxAccount\(\)\)/);
  assert.match(scriptSource, /SoftoraCampaignSenderSettings\.loadProfileForSender/);
  assert.match(scriptSource, /const replyAccount = normalizeMailboxEmail\(composeReplyContext && composeReplyContext\.accountEmail\) \|\| getMailboxAccount\(\);/);
  assert.match(scriptSource, /const senderProfile = await loadMailboxSenderProfile\(replyAccount\);/);
  assert.match(scriptSource, /account: replyAccount,/);
  assert.match(scriptSource, /senderProfile,/);
  assert.match(scriptSource, /context: buildComposeRewriteContext\(\)/);
  assert.match(scriptSource, /case 'rewrite-compose':[\s\S]*void rewriteComposeBody\(\);/);
  assert.match(scriptSource, /function replyMail\(mail\) \{[\s\S]*setComposeReplyContext\(mail\);/);
  assert.match(scriptSource, /if \(!draft && !isSuggestedReply\)/);
  assert.match(scriptSource, /Reactie voorgesteld/);
  assert.match(scriptSource, /bodyField\.value = rewritten;/);
  assert.match(scriptSource, /SoftoraMailboxCompose\.reset\(Boolean\(composeReplyContext\)\)/);
  assert.match(scriptSource, /SoftoraMailboxCompose\.complete\(rewriteBtn\)/);
  assert.match(scriptSource, /SoftoraMailboxCompose\.finish\(/);
  assert.match(scriptSource, /SoftoraMailboxCompose\.isUsed\(\)/);
  assert.match(readComposeScript(), /let rewriteUsed = false;/);
  assert.match(readComposeScript(), /rewriteUsed = true;[\s\S]*button\.hidden = true;/);
});

test('voorgestelde reactie is per composevenster maar één keer beschikbaar', () => {
  const button = { hidden: true, disabled: true, textContent: '' };
  const documentRef = { querySelector: () => button };

  composeModule.reset(true, documentRef);
  assert.equal(button.hidden, false);
  assert.equal(button.textContent, 'Voorgestelde reactie');
  assert.equal(composeModule.isUsed(), false);

  composeModule.complete(button);
  composeModule.finish(button, 'Voorgestelde reactie');
  assert.equal(button.hidden, true);
  assert.equal(button.disabled, true);
  assert.equal(composeModule.isUsed(), true);

  composeModule.reset(true, documentRef);
  assert.equal(button.hidden, false);
  assert.equal(button.disabled, false);
  assert.equal(composeModule.isUsed(), false);
});

test('premium mailbox bewaart gelezen status via de mailbox API', () => {
  const scriptSource = readScript();

  assert.match(scriptSource, /uid: message\.uid,/);
  assert.match(scriptSource, /async function persistMailReadState\(mail\) \{[\s\S]*\/api\/mailbox\/messages\/read/);
  assert.match(scriptSource, /body: JSON\.stringify\(\{[\s\S]*account: window\.SoftoraMailboxCampaignInbox\.getAccount\(mail, activeMailboxAccount\),[\s\S]*id: requestId,[\s\S]*uid: mail\.uid,[\s\S]*folder: window\.SoftoraMailboxCampaignInbox\.getFolder\(mail, activeFolder\),/);
  assert.match(scriptSource, /catch \(error\) \{[\s\S]*toast\(String\(error\?\.message/);
  assert.doesNotMatch(scriptSource, /catch \(error\) \{[\s\S]{0,120}mail\.unread = true;/);
  assert.match(scriptSource, /function openMail\(id, options = \{\}\) \{[\s\S]*const wasUnread = m\.unread;[\s\S]*m\.unread = false;[\s\S]*renderList\(\);[\s\S]*if \(wasUnread\) void persistMailReadState\(m\);/);
  assert.match(scriptSource, /Gelezen status opslaan mislukt/);
});

test('premium mailbox verwijdert direct optimistisch en houdt refresh-resultaten schoon', async () => {
  const scriptSource = readScript();
  const deleteSource = readDeleteScript();

  assert.match(scriptSource, /mailboxDeleteController\.remove\(m,/);
  assert.match(scriptSource, /fetch: \(\.\.\.args\) => window\.fetch\(\.\.\.args\),/);
  assert.match(scriptSource, /optimistic\(\) \{[\s\S]*mails = mailboxDeleteController\.filterMessages\([\s\S]*mails\.filter\(mail => String\(mail\.id\) !== String\(id\)\)/);
  assert.match(scriptSource, /rollback\(_mail, transaction\) \{/);
  assert.match(scriptSource, /mails = mailboxDeleteController\.filterMessages\(/);
  assert.match(scriptSource, /removeAndPublishMessageDeletion\?\.\(mail\)/);
  assert.match(scriptSource, /bindMessageDeletionSync\?\.\(\{/);
  assert.match(deleteSource, /hiddenMessageKeys\.add\(messageKey\);[\s\S]*hooks\.optimistic/);
  assert.match(deleteSource, /\/api\/mailbox\/messages\/delete/);
  assert.match(scriptSource, /case 'delete-mail':[\s\S]*void deleteMail\(id\);/);

  let resolveRequest;
  const events = [];
  const deleted = { id: 'inbox:42', uid: 42, folder: 'inbox', accountEmail: 'serve@softora.nl' };
  const kept = { id: 'inbox:43', uid: 43, folder: 'inbox', accountEmail: 'serve@softora.nl' };
  const controller = deleteModule.create({
    dialogs: { confirm: async () => true },
    fetch: async () => new Promise((resolve) => { resolveRequest = resolve; }),
    getAccount: (mail) => mail.accountEmail,
    getFolder: (mail) => mail.folder,
    getRequestId: (mail) => mail.id,
    removeCached: () => events.push('cache'),
    toast: () => {},
  });
  const removal = controller.remove(deleted, {
    optimistic: () => events.push('optimistic'),
  });

  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(events, ['optimistic']);
  assert.deepEqual(controller.filterMessages([deleted, kept]), [kept]);

  resolveRequest({ ok: true, json: async () => ({ ok: true }) });
  assert.equal((await removal).ok, true);
  assert.deepEqual(events, ['optimistic', 'cache']);
  assert.deepEqual(controller.filterMessages([deleted, kept]), [kept]);
});

test('premium mailbox gebruikt de nette dialoog ook wanneer die pas na de mailboxscripts initialiseert', async () => {
  const events = [];
  const mail = { id: 'inbox:42', uid: 42, folder: 'inbox', accountEmail: 'serve@softora.nl' };
  let dialogs;
  const controller = deleteModule.create({
    getDialogs: () => dialogs,
    confirm: () => {
      events.push('native-confirm');
      return false;
    },
    fetch: async () => ({ ok: true, json: async () => ({ ok: true }) }),
    getAccount: (item) => item.accountEmail,
    getFolder: (item) => item.folder,
    getRequestId: (item) => item.id,
    toast: () => {},
  });
  dialogs = {
    confirm: async () => {
      events.push('softora-confirm');
      return true;
    },
  };

  const result = await controller.remove(mail, {
    optimistic: () => events.push('optimistic'),
  });

  assert.equal(result.ok, true);
  assert.deepEqual(events, ['softora-confirm', 'optimistic']);
});

test('premium mailbox herstelt een optimistische verwijdering als de API faalt', async () => {
  const events = [];
  const mail = { id: 'inbox:42', uid: 42, folder: 'inbox', accountEmail: 'serve@softora.nl' };
  const controller = deleteModule.create({
    dialogs: { confirm: async () => true },
    fetch: async () => ({ ok: false, json: async () => ({ detail: 'Opslaan mislukt' }) }),
    getAccount: (item) => item.accountEmail,
    getFolder: (item) => item.folder,
    getRequestId: (item) => item.id,
    toast: () => {},
  });

  const result = await controller.remove(mail, {
    optimistic: () => events.push('optimistic'),
    rollback: () => events.push('rollback'),
  });

  assert.equal(result.ok, false);
  assert.deepEqual(events, ['optimistic', 'rollback']);
  assert.deepEqual(controller.filterMessages([mail]), [mail]);
});

test('premium mailbox ruimt technische mail-links op voor weergave', () => {
  const scriptSource = readScript();
  const imagesScriptSource = readImagesScript();

  assert.match(scriptSource, /function cleanMailboxText\(value\)/);
  assert.match(scriptSource, /function isMailboxReplyHeaderLine\(line\)/);
  assert.match(scriptSource, /function isMailboxOwnReplyHeaderLine\(line\)/);
  assert.match(scriptSource, /function buildMailboxBodySections\(value\)/);
  assert.match(scriptSource, /function renderMailboxInlineImage\(image\)/);
  assert.match(scriptSource, /function renderMailboxTextLine\(line, options\)/);
  assert.match(readDisplayScript(), /function isGeneratedImageDescriptionLine\(value\)/);
  assert.match(scriptSource, /function isMailboxSafeOptOutUrl\(value\)/);
  assert.match(scriptSource, /function normalizeMailboxImageLabel\(value\)/);
  assert.match(scriptSource, /function isMailboxMockupImageLabel\(value\)/);
  assert.match(scriptSource, /function isMailboxWebdesignImageLabel\(value\)/);
  assert.match(scriptSource, /function sectionHasMailboxImagePlaceholder\(section\)/);
  assert.match(scriptSource, /function normalizeMailboxBodyImages\(images\)/);
  assert.match(imagesScriptSource, /function renderUnused\(imageState, renderImage, options = \{\}\)/);
  assert.match(imagesScriptSource, /function getSentImageOwner\(mail\)/);
  assert.match(imagesScriptSource, /function renderThreadMessageBody\(payload, context, renderers\)/);
  assert.match(imagesScriptSource, /function createOwnershipPlan\(mail, mainImages, hasMainPlaceholders\)/);
  assert.match(scriptSource, /function renderMailboxBodySection\(section, imageState\)/);
  assert.match(scriptSource, /function normalizeMailboxOptOutUrl\(value\)/);
  assert.match(scriptSource, /function renderMailboxOptOutLink\(url\)/);
  assert.match(scriptSource, /function renderMailBody\(value, images, options\)/);
  assert.match(scriptSource, /section\.type === 'signature'/);
  assert.match(scriptSource, /const hasImagePlaceholders = sections\.some\(sectionHasMailboxImagePlaceholder\);/);
  assert.match(scriptSource, /if \(!hasImagePlaceholders && !injectedImages && section && section\.type === 'signature'\)/);
  assert.match(scriptSource, /usedImages\.add\(imageEntry\.index\);/);
  assert.match(scriptSource, /function pushTextLine\(line\)/);
  assert.match(scriptSource, /detail-mail-line-empty/);
  assert.match(scriptSource, /renderedLines\.push\(renderMailboxInlineImage\(imageEntry\.image\)\);/);
  assert.match(scriptSource, /if \(imageAlt\) \{[\s\S]*return;/);
  assert.match(imagesScriptSource, /detail-mail-section-images/);
  assert.match(scriptSource, /detail-mail-optout-link/);
  assert.match(scriptSource, /MAILBOX_WEBDESIGN_MOCKUP_CAPTION/);
  assert.match(scriptSource, /sendgrid\\\.net/);
  assert.match(scriptSource, /cdn\.openai\.com/);
  assert.match(readDisplayScript(), /function isGmailSignatureAssetUrl\(value\)/);
  assert.match(readDisplayScript(), /function collapseDuplicateAnnotations\(line\)/);
  assert.match(readDisplayScript(), /function removeDuplicateSignatureLeadLines\(lines\)/);
  assert.match(scriptSource, /Eerdere mail/);
  assert.match(scriptSource, /Jouw eerdere mail/);
  assert.match(scriptSource, /const bodyImages = normalizeMailboxBodyImages\(message\.bodyImages\);/);
  assert.match(scriptSource, /const optOutUrl = normalizeMailboxOptOutUrl\(message\.optOutUrl\);/);
  assert.match(scriptSource, /cleanMailboxText\(message\.body \|\| message\.preview \|\| ''\)/);
  assert.match(scriptSource, /<div class="detail-body-text">\$\{renderMailBody\(detailBody, detailBodyImages, \{ optOutUrl: m\.optOutUrl, mail: m, replyMailId: m\.id, threadImagesReady: !imagesPending \}\)\}<\/div>/);
  assert.match(scriptSource, /imageAlt = cleaned\.trim\(\)\.match\(\/\^\\\[image:\\s\*\(\[\^\\\]\]\+\)\\\]\$\/i\)/);
});

test('premium mailbox verbergt automatisch gegenereerde afbeeldingsbeschrijvingen in elke conversatielaag', () => {
  const generatedDescription = '[Afbeelding met Lettertype, Graphics, logo, tekst Automatisch gegenereerde beschrijving]';
  const html = renderMailboxBodyForTest([
    'Dank je wel!',
    '',
    generatedDescription,
    '',
    'Burgemeester Stekelenburgplein 199',
  ].join('\n'), [], {
    replyMailId: 'inbox:generated-description',
    mail: {
      receivedAt: '2026-07-23T13:54:00.000Z',
      threadMessages: [
        {
          id: 'sent:generated-description',
          folder: 'sent',
          accountEmail: 'martijnvandeven@softora.nl',
          date: '2026-07-23T13:30:00.000Z',
          body: [
            'Goedendag,',
            '',
            '[Image met Font, Graphics, logo, text Automatically generated description]',
            '',
            '[Interne notitie blijft zichtbaar]',
          ].join('\n'),
        },
      ],
    },
  });

  assert.doesNotMatch(html, /Automatisch gegenereerde beschrijving/i);
  assert.doesNotMatch(html, /Automatically generated description/i);
  assert.match(html, /Burgemeester Stekelenburgplein 199/);
  assert.match(html, /\[Interne notitie blijft zichtbaar\]/);
});

test('premium mailbox zet een eerdere eigen mail als apart geciteerd blok neer', () => {
  const html = renderMailboxBodyForTest([
    'Bedankt voor je bericht, maar we hebben geen interesse.',
    '',
    'Op 20 jul 2026 om 07:12 heeft Servé Creusen het volgende geschreven:',
    '',
    'Goedendag,',
    '',
    'Afgelopen week kwam ik jullie website devyldre.com tegen.',
  ].join('\n'));

  assert.equal((html.match(/detail-mail-section-quote/g) || []).length, 1);
  assert.match(html, /<div class="detail-mail-section-label">Jouw eerdere mail<\/div>/);
  assert.match(html, /Op 20 jul 2026 om 07:12 heeft Servé Creusen het volgende geschreven:/);
  assert.ok(html.indexOf('Bedankt voor je bericht') < html.indexOf('detail-mail-section-quote'));
  assert.ok(html.indexOf('Goedendag') > html.indexOf('detail-mail-section-quote'));
});

test('premium mailbox toont geen handtekening van de ontvanger in Jouw eerdere mail', () => {
  const html = renderMailboxBodyForTest([
    'Bedankt voor je bericht, maar we hebben geen interesse.',
    '',
    'Op di 30 jun 2026 om 07:18 schreef Servé Creusen:',
    '',
    'Goedendag,',
    '',
    'Afgelopen week kwam ik jullie website denbosch.wereldwinkels.nl tegen.',
    '',
    'Met vriendelijke groet,',
    'Servé Creusen',
    '📍 ’s-Hertogenbosch',
    '',
    '--',
    'Met vriendelijke groet,',
    'Wereldwinkel ’s-Hertogenbosch',
    'Hinthamerstraat 105',
    '5211 MH',
    'tel 073 689 40 68',
    '*www.wereldwinkel-webshop.nl*',
  ].join('\n'));

  assert.match(html, /<div class="detail-mail-section-label">Jouw eerdere mail<\/div>/);
  assert.match(html, /Servé Creusen/);
  assert.match(html, /📍 ’s-Hertogenbosch/);
  assert.doesNotMatch(html, /Wereldwinkel ’s-Hertogenbosch/);
  assert.doesNotMatch(html, /Hinthamerstraat 105/);
  assert.doesNotMatch(html, /wereldwinkel-webshop\.nl/);
});

test('premium mailbox zet beantwoorden direct onder de ontvangen mail en voor de eerdere mail', () => {
  const html = renderMailboxBodyForTest([
    'Bedankt voor je bericht, maar we hebben geen interesse.',
    '',
    'Kind regards,',
    'Daffy de Vyldre',
    '',
    'Op 20 jul 2026 om 07:12 heeft Servé Creusen het volgende geschreven:',
    '',
    'Goedendag,',
  ].join('\n'), [], { replyMailId: 'mail-123' });

  assert.equal((html.match(/data-mailbox-action="reply-mail"/g) || []).length, 1);
  assert.ok(html.indexOf('Daffy de Vyldre') < html.indexOf('data-mailbox-action="reply-mail"'));
  assert.ok(html.indexOf('data-mailbox-action="reply-mail"') < html.indexOf('detail-mail-section-quote'));
  assert.match(html, /data-mailbox-id="mail-123"/);
});

test('premium mailbox herstelt een samengeplakte Samsung-reactie van Martijn', () => {
  const html = renderMailboxBodyForTest([
    'Dag Martijn,We zijn het als bestuur aan het overleggen wat wenselijk is.Mochten we van je diensten gebruik willen maken, dan laten we je dat weten.GroetGerard Schellekens Verzonden vanaf mijn Galaxy',
    '-------- Oorspronkelijk bericht --------Van: Martijn van de Ven Datum: 25-06-2026 11:17 (GMT+01:00) Aan: gschellekens@home.nl Onderwerp: Kleine vraag over jullie website Goedendag,',
    'Afgelopen week kwam ik jullie website (bchelvoirt.nl) tegen.',
    'Met vriendelijke groet,Martijn van de Ven',
    '📍 Helvoirt',
  ].join('\n'), [], { replyMailId: 'martijnvandeven@softora.nl|inbox:17' });

  assert.equal((html.match(/detail-mail-section-quote/g) || []).length, 1);
  assert.match(html, /<div class="detail-mail-section-label">Jouw eerdere mail<\/div>/);
  assert.match(html, /<div class="detail-mail-quote-meta">Van: Martijn van de Ven<\/div>/);
  assert.doesNotMatch(html, /Oorspronkelijk bericht/i);
  assert.match(html, /Dag Martijn,<\/div>\s*<div class="detail-mail-line detail-mail-line-empty"[^>]*>&nbsp;<\/div>\s*<div class="detail-mail-line">We zijn het als bestuur/);
  assert.ok(html.indexOf('Gerard Schellekens') < html.indexOf('data-mailbox-action="reply-mail"'));
  assert.ok(html.indexOf('data-mailbox-action="reply-mail"') < html.indexOf('detail-mail-section-quote'));
  assert.ok(html.indexOf('Onderwerp: Kleine vraag over jullie website') < html.indexOf('Goedendag,'));
});

test('premium mailbox zet beantwoorden onderaan als er geen eerdere mail is', () => {
  const html = renderMailboxBodyForTest('Alleen het ontvangen bericht.', [], { replyMailId: 'mail-456' });

  assert.ok(html.indexOf('Alleen het ontvangen bericht.') < html.indexOf('data-mailbox-action="reply-mail"'));
  assert.doesNotMatch(html, /detail-mail-section-quote/);
});

test('premium mailbox houdt een geciteerde mail van een andere afzender neutraal', () => {
  const html = renderMailboxBodyForTest([
    'Mijn antwoord staat hierboven.',
    '',
    'On 20 Jul 2026, John Example wrote:',
    '',
    'Original message.',
  ].join('\n'));

  assert.match(html, /<div class="detail-mail-section-label">Eerdere mail<\/div>/);
  assert.doesNotMatch(html, /Jouw eerdere mail/);
});

test('premium mailbox behoudt mail-enters en vervangt image placeholders inline', () => {
  const tinyPng = 'data:image/png;base64,iVBORw0KGgo=';
  const body = [
    'Goedemiddag,',
    '',
    'Afgelopen week kwam ik toevallig jullie website (softora.nl) tegen.',
    'Vanuit enthousiasme heb ik een nieuw webdesign voor jullie site gemaakt,',
    'gewoon omdat ik dat leuk vind. 🙂',
    '',
    'Ik ben erg benieuwd wat je ervan vindt!',
    '',
    'Als je wilt, kan ik je ook een linkje sturen, zodat je de site zelf kunt',
    'bekijken en testen.',
    '',
    'Laat me vooral weten of je dat zou willen 🤝',
    '',
    'Met vriendelijke groet,',
    'Servé Creusen',
    '📍 Haaren',
    '📞 0629917185',
    '',
    '[image: softora.nl webdesign]',
    'Hieronder zie je een korte indruk van de eerste versie op verschillende schermen.',
    '[image: Device mockup]',
    '',
    'Geen webdesign willen ontvangen? Laat het me weten!: https://www.softora.nl/afmelden?t=abc',
  ].join('\n');

  const html = renderMailboxBodyForTest(body, [
    { alt: 'Softora Testmodus webdesign.png', dataUrl: tinyPng },
    { alt: 'Softora Testmodus device mockup.png', dataUrl: tinyPng },
  ]);

  assert.equal((html.match(/detail-mail-line-empty/g) || []).length, 7);
  assert.equal((html.match(/<figure class="detail-mail-image">/g) || []).length, 2);
  assert.doesNotMatch(html, /\[image:/i);
  assert.match(html, /detail-mail-optout-link/);
  assert.match(html, /href="https:\/\/www\.softora\.nl\/afmelden\?t=abc"/);
  assert.doesNotMatch(html, />https:\/\/www\.softora\.nl\/afmelden/);
  assert.ok(html.indexOf('0629917185') < html.indexOf('<figure class="detail-mail-image">'));
  assert.ok(html.indexOf('detail-mail-optout-link') > html.lastIndexOf('<figure class="detail-mail-image">'));

  const proxiedImageHtml = renderMailboxBodyForTest('[image: Ontwerp]', [{
    alt: 'Ontwerp',
    dataUrl: '/api/mailbox/message-image?account=serve%40softora.nl&folder=inbox&id=inbox%3A42&index=0',
  }]);
  assert.match(proxiedImageHtml, /src="\/api\/mailbox\/message-image\?account=serve%40softora\.nl&amp;folder=inbox&amp;id=inbox%3A42&amp;index=0"/);
  assert.match(proxiedImageHtml, /loading="eager" decoding="async" fetchpriority="high"/);
  assert.match(proxiedImageHtml, /data-mailbox-inline-image/);

  const labelOnlyHtml = renderMailboxBodyForTest(
    'Geen webdesign willen ontvangen? Laat het me weten!',
    [],
    { optOutUrl: 'https://www.softora.nl/afmelden?t=abc' }
  );

  assert.match(labelOnlyHtml, /class="detail-mail-optout-link"/);
  assert.match(labelOnlyHtml, /href="https:\/\/www\.softora\.nl\/afmelden\?t=abc"/);
  assert.doesNotMatch(labelOnlyHtml, />https:\/\/www\.softora\.nl\/afmelden/);
});

test('premium mailbox toont een beeldmail pas nadat de afbeelding is voorbereid', () => {
  const script = readScript();
  assert.match(script, /SoftoraMailboxImages\?\.prewarm\?\.\(mails\)/);
  assert.match(script, /SoftoraMailboxImages\?\.stage\?\.\(\s*conversationBodyImages/);
  assert.match(script, /imagesPrepared:\s*true/);
  assert.match(script, /const detailBodyImages = imagesPending \? \[\] : m\.bodyImages;/);
});

test('premium mailbox vervangt het oude detail direct wanneer een nieuwe mail nog geladen wordt', () => {
  const mailbox = loadMailboxHelpersForTest();
  const previous = mailbox.normalizeMailboxApiMessage({
    id: 'serve:inbox:1',
    folder: 'inbox',
    accountEmail: 'serve@softora.nl',
    from: 'Vorige afzender',
    email: 'vorige@example.com',
    subject: 'Vorige mail',
    body: 'Dit is de oude mail.',
    receivedAt: '2026-07-23T12:00:00.000Z',
  });
  const next = mailbox.normalizeMailboxApiMessage({
    id: 'serve:inbox:2',
    folder: 'inbox',
    accountEmail: 'serve@softora.nl',
    from: 'Nieuwe afzender',
    email: 'nieuw@example.com',
    subject: 'Nieuwe mail',
    preview: 'Dit is alvast de nieuwe mail.',
    receivedAt: '2026-07-23T12:05:00.000Z',
  });
  mailbox.setMails([previous, next]);

  mailbox.openMail(previous.id, { skipBodyFetch: true });
  assert.match(mailbox.getElement('mail-detail').innerHTML, /Vorige mail/);

  mailbox.openMail(next.id);

  assert.equal(mailbox.getActiveMail(), next.id);
  assert.match(mailbox.getElement('mail-detail').innerHTML, /Nieuwe mail/);
  assert.match(mailbox.getElement('mail-detail').innerHTML, /Dit is alvast de nieuwe mail\./);
  assert.doesNotMatch(mailbox.getElement('mail-detail').innerHTML, /Vorige mail|Dit is de oude mail\./);
});

test('premium mailbox laat een late body-response nooit een nieuwere selectie overschrijven', async () => {
  let resolveResponse;
  const response = new Promise((resolve) => { resolveResponse = resolve; });
  const mailbox = loadMailboxHelpersForTest({
    fetch: async (url) => String(url).startsWith('/api/mailbox/message?')
      ? response
      : {
          ok: true,
          json: async () => ({
            ok: true,
            accounts: [{ email: 'serve@softora.nl', imapConfigured: true, smtpConfigured: true }],
            messages: [],
          }),
        },
  });
  const mail = {
    id: 'serve:inbox:1',
    preview: 'Voorbeeld',
    body: '',
    bodyImages: [],
    optOutUrl: '',
    bodyLoading: false,
  };
  let activeMail = mail.id;
  const opened = [];
  const loading = mailbox.index.loadBody({
    id: mail.id,
    requestId: '1',
    getMail: () => mail,
    account: 'serve@softora.nl',
    folder: 'inbox',
    normalizeBodyImages: (images) => images,
    normalizeOptOutUrl: (value) => value,
    getActiveMail: () => activeMail,
    openMail: (id) => opened.push(id),
  });

  activeMail = 'serve:inbox:2';
  resolveResponse({
    ok: true,
    json: async () => ({
      ok: true,
      message: { body: 'Volledig bericht', bodyImages: [], optOutUrl: '' },
    }),
  });
  await loading;

  assert.equal(mail.body, 'Volledig bericht');
  assert.deepEqual(opened, []);
});

test('premium mailbox ruimt Martijns Gmail-handtekening net zo schoon op als Servés mail', () => {
  const html = renderMailboxBodyForTest([
    '[https://ci3.googleusercontent.com/mail-sig/AIorK4xO039AXHNmO6ZlXuH8i0cEctngV0Ftl-cF9usjh8mD9halM4-1NEbcTR5bMI4_9hVevZAMmacdAxt5]',
    '',
    'Muziekschool Pedro van Meel',
    '',
    '--',
    '',
    'Muziekschool Pedro van Meel',
    'Piano & Keyboarddocent',
    '[https://ci3.googleusercontent.com/mail-sig/AIorK4xD5yVpdOdHdlYOPUiaBdnN7zb6OBxpDoq6jOp8n3vcDIsyFUcejkDgWeaiviNV0rt7OOXeynE]',
    'E-mail: keyboardpianoleraar@gmail.com [keyboardpianoleraar@gmail.com]',
    'Website: www.pianokeyboardleraar.nl [http://www.pianokeyboardleraar.nl]',
    'Tel: 06-54967032',
  ].join('\n'));

  assert.doesNotMatch(html, /googleusercontent\.com/i);
  assert.doesNotMatch(html, /keyboardpianoleraar@gmail\.com\s*\[keyboardpianoleraar@gmail\.com\]/i);
  assert.equal((html.match(/Muziekschool Pedro van Meel/g) || []).length, 1);
  assert.doesNotMatch(html, />--</);
  assert.match(
    html,
    /Website: <a href="http:\/\/www\.pianokeyboardleraar\.nl" target="_blank" rel="noopener noreferrer">www\.pianokeyboardleraar\.nl<\/a>/
  );
  assert.doesNotMatch(html, /\[http:\/\/www\.pianokeyboardleraar\.nl\]/);
});

test('premium mailbox voorkomt horizontale overflow door brede e-mails', () => {
  const pageSource = readPage();

  assert.match(pageSource, /html, body \{[\s\S]*overflow-x:\s*hidden;/);
  assert.match(pageSource, /\.dashboard-layout \{[\s\S]*min-width:\s*0;[\s\S]*overflow:\s*hidden;/);
  assert.match(pageSource, /\.main-content \{[\s\S]*min-width:\s*0;[\s\S]*overflow:\s*hidden;/);
  assert.match(pageSource, /\.mail-page-shell \{[\s\S]*min-width:\s*0;[\s\S]*overflow:\s*hidden;/);
  assert.match(pageSource, /\.layout \{[\s\S]*min-width:\s*0;[\s\S]*overflow:\s*hidden;/);
  assert.match(pageSource, /\.mail-detail \{[\s\S]*min-width:\s*0;[\s\S]*max-width:\s*100%;/);
  assert.match(pageSource, /\.detail-body \{[\s\S]*overflow-x:\s*hidden;/);
  assert.match(pageSource, /\.detail-body-text \{[\s\S]*overflow-wrap:\s*anywhere;[\s\S]*word-break:\s*break-word;[\s\S]*display:\s*flex;/);
  assert.match(pageSource, /\.detail-mail-lines \{[\s\S]*display:\s*flex;[\s\S]*flex-direction:\s*column;[\s\S]*gap:\s*0;/);
  assert.match(pageSource, /\.detail-mail-line \{[\s\S]*min-height:\s*1\.8em;[\s\S]*white-space:\s*pre-wrap;/);
  assert.match(pageSource, /\.detail-mail-line-empty \{[\s\S]*min-height:\s*1\.8em;/);
  assert.match(pageSource, /\.detail-mail-optout-link \{[\s\S]*text-decoration:\s*underline;/);
  assert.match(pageSource, /\.detail-mail-image-caption \{[\s\S]*font-weight:\s*600;/);
  assert.match(pageSource, /\.detail-mail-section-quote \{[\s\S]*background:\s*#f8f4ef;[\s\S]*border-left:\s*3px solid rgba\(155,35,85,.24\);/);
  assert.match(pageSource, /\.detail-mail-section-signature \{[\s\S]*padding-top:\s*16px;[\s\S]*color:\s*var\(--text-mid\);/);
  assert.doesNotMatch(pageSource, /\.detail-mail-section-signature \{[\s\S]*border-top:\s*1px dashed var\(--border\);/);
});

test('premium mailbox houdt gedrag uit inline handlers', () => {
  const pageSource = readPage();
  const scriptSource = readScript();
  const listSource = readListScript();

  assert.doesNotMatch(pageSource, /\son[a-z]+=/);
  assert.doesNotMatch(scriptSource, /onclick=/);
  assert.doesNotMatch(pageSource, /data-mailbox-action="open-compose"/);
  assert.doesNotMatch(pageSource, /id="search-input"/);
  assert.doesNotMatch(pageSource, /class="topbar-search"/);
  assert.doesNotMatch(pageSource, /class="btn-compose"/);
  assert.match(pageSource, /data-mailbox-action="rewrite-compose"/);
  assert.doesNotMatch(pageSource, /data-mailbox-action="set-folder"/);
  assert.match(listSource, /data-mailbox-action="open-mail"/);
  assert.doesNotMatch(scriptSource, /data-mailbox-action="toggle-star"/);
  assert.doesNotMatch(scriptSource, />\s*Markeren\s*</);
  assert.match(scriptSource, /data-mailbox-action="reply-mail"/);
  assert.match(scriptSource, /function escapeHtml\(value\)/);
  assert.match(readIndexScript(), /function bindImageRecovery\([\s\S]*document\.addEventListener\('error',[\s\S]*\[data-mailbox-inline-image\][\s\S]*mail\.imageRecoveryAttempted = true;[\s\S]*void loadMessageBody\(mail\.id\);[\s\S]*, true\);/);
  assert.match(scriptSource, /SoftoraMailboxIndex\?\.bindImageRecovery\(\{ getActiveMail: \(\) => activeMail, getMail: findMailById, loadMessageBody: loadMailboxMessageBody \}\)/);
  assert.match(scriptSource, /function renderLinkedMailboxText\(value, options\)/);
  assert.match(scriptSource, /renderLinkedMailboxText\(value, options\)/);
  assert.match(scriptSource, /<div class="detail-body-text">\$\{renderMailBody\(detailBody, detailBodyImages, \{ optOutUrl: m\.optOutUrl, mail: m, replyMailId: m\.id, threadImagesReady: !imagesPending \}\)\}<\/div>/);
});

test('geopende mail staat als één rustig mailblok met antwoordactie na het ontvangen bericht', () => {
  const pageSource = readPage();
  const scriptSource = readScript();

  assert.match(scriptSource, /const wasUnread = m\.unread;[\s\S]*activeMail = m\.id;[\s\S]*renderList\(\);[\s\S]*if \(!m\.bodyLoaded && !options\.skipBodyFetch\) \{[\s\S]*void loadMailboxMessageBody\(m\.id\);[\s\S]*\}/);
  assert.match(readIndexScript(), /bodyLoaded:\s*Boolean\(message\.body\) && !message\.bodyTruncated && !message\.bodyImagesTruncated/);
  assert.match(readIndexScript(), /mail\.bodyImagesTruncated = false;/);
  assert.match(readIndexScript(), /String\(getActiveMail\(\)\) === String\(id\)/);
  assert.match(scriptSource, /const detailBody = m\.body \|\| m\.preview \|\| '';/);
  assert.doesNotMatch(scriptSource, /Bericht laden…/);

  assert.match(scriptSource, /<article class="detail-mail-block">/);
  assert.match(scriptSource, /<div class="detail-subject-row">/);
  assert.match(readDisplayScript(), /function formatDetailSubject\(value\)/);
  assert.match(readDisplayScript(), /replace\(\/\^email received\\s\*\-\\s\*\/i, ''\)/);
  assert.match(scriptSource, /escapeHtml\(window\.SoftoraMailboxDisplay\.formatDetailSubject\(m\.subject\)\)/);
  assert.doesNotMatch(scriptSource, /detail-more|Meer opties/);
  assert.doesNotMatch(pageSource, /\.detail-more/);
  assert.match(scriptSource, /<div class="detail-divider" aria-hidden="true"><\/div>/);
  assert.match(scriptSource, /const replyActionHtml = replyMailId \? `<div class="detail-footer"><button class="detail-reply"[\s\S]*Beantwoorden/);
  assert.match(scriptSource, /section && section\.type === 'quote'[\s\S]*renderedSections\.push\(replyActionHtml\)/);
  assert.match(scriptSource, /\$\{escapeHtml\(m\.date\)\}, \$\{escapeHtml\(m\.time\)\}/);
  assert.match(pageSource, /\.detail-mail-block \{[\s\S]*display:\s*flex;[\s\S]*flex-direction:\s*column;[\s\S]*background:\s*var\(--card\);/);
  assert.match(pageSource, /\.detail-mail-block \{[\s\S]*width:\s*min\(100%,\s*900px\);[\s\S]*max-width:\s*900px;[\s\S]*margin:\s*0 auto;/);
  assert.match(pageSource, /\.detail-mail-block \{[^}]*min-height:\s*min\(620px,\s*calc\(100vh - 92px\)\)/);
  assert.match(pageSource, /@media \(max-width:\s*920px\) \{[\s\S]*\.detail-mail-block \{ min-height:\s*min\(560px,\s*calc\(100vh - 68px\)\); \}/);
  assert.match(pageSource, /\.detail-body-text \{[\s\S]*background:\s*var\(--card\);[\s\S]*border:\s*0;[\s\S]*font-family:\s*var\(--premium-sidebar-font-sans, 'Inter', sans-serif\);/);
  assert.match(pageSource, /\.detail-subject \{[\s\S]*font-size:\s*clamp\(19px,\s*1\.5vw,\s*24px\);/);
  assert.match(pageSource, /\.detail-avatar \{[\s\S]*width:\s*42px;[\s\S]*height:\s*42px;/);
  assert.match(pageSource, /\.detail-body-text \{[\s\S]*font-size:\s*14px;[\s\S]*line-height:\s*1\.75;/);
  assert.match(pageSource, /\.detail-footer \{[^}]*margin:\s*0;[^}]*padding:\s*2px 0 16px;[^}]*border-bottom:\s*1px solid var\(--border\);/);
  assert.match(pageSource, /\.detail-reply \{[^}]*border:\s*1px solid rgba\(155,35,85,\.34\);[^}]*border-radius:\s*6px;[^}]*padding:\s*8px 14px;[^}]*background:\s*var\(--card\);[^}]*color:\s*var\(--crimson\);/);
  assert.match(pageSource, /\.detail-reply:hover \{[^}]*border-color:\s*var\(--crimson\);[^}]*background:\s*rgba\(155,35,85,\.06\);/);
  assert.match(pageSource, /\.detail-reply:focus-visible \{[^}]*outline:\s*2px solid rgba\(155,35,85,\.32\);/);
});

test('premium mailbox maakt veilige links in mailtekst klikbaar', () => {
  const scriptSource = readScript();
  const html = renderMailboxBodyForTest([
    'Click the following link:',
    'https://dashboard.render.com/email-reset/confirm?token=fake-token-123.',
    '<script>alert("xss")</script>',
  ].join('\n'));

  assert.match(scriptSource, /const MAIL_BODY_URL_PATTERN = \/https\?:\\\/\\\/\[\^\\s<>"'\]\+\/gi;/);
  assert.match(readDisplayScript(), /const SENDER_CTA_LINKS = Object\.freeze\(\{\}\);/);
  assert.match(readDisplayScript(), /function getSenderCtaLink\(options\)/);
  assert.match(scriptSource, /function isSafeMailBodyUrl\(value\)/);
  assert.match(scriptSource, /const parsed = new URL\(value\);/);
  assert.match(scriptSource, /parsed\.protocol === 'http:' \|\| parsed\.protocol === 'https:';/);
  assert.match(html, /<a href="https:\/\/dashboard\.render\.com\/email-reset\/confirm\?token=fake-token-123" target="_blank" rel="noopener noreferrer">https:\/\/dashboard\.render\.com\/email-reset\/confirm\?token=fake-token-123<\/a>\./);
  assert.match(html, /&lt;script&gt;alert\(&quot;xss&quot;\)&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<script>/);
  const linkedCtaHtml = renderMailboxBodyForTest('💼 Mijn LinkedIn 👈', [], { senderEmail: 'martijn@softora.nl' });
  assert.match(linkedCtaHtml, /💼 Mijn LinkedIn 👈/);
  assert.doesNotMatch(linkedCtaHtml, /linkedin\.com/i);
});

test('premium mailbox verbergt een technische webdesign-url achter deze link', () => {
  const url = 'https://www.softora.nl/webdesign/de-vyldre?cid=safe-dedupe-20260615-row-1891-d84e3e0cb2&sender=serve';
  const html = renderMailboxBodyForTest(
    `Lukt het niet om de bijlage te openen? Dan kun je het webdesign ook via deze link [${url}] bekijken 🎨`
  );

  assert.match(
    html,
    /via <a href="https:\/\/www\.softora\.nl\/webdesign\/de-vyldre\?cid=safe-dedupe-20260615-row-1891-d84e3e0cb2&amp;sender=serve" target="_blank" rel="noopener noreferrer">deze link<\/a> bekijken 🎨/
  );
  assert.doesNotMatch(html, />https:\/\/www\.softora\.nl\/webdesign\/de-vyldre/);
  assert.doesNotMatch(html, /\[https:\/\//);
});

test('premium mailbox houdt bekijken direct achter een afgebroken deze-link-verwijzing', () => {
  const url = 'https://www.softora.nl/webdesign/seats2meet?cid=mail-row&sender=serve';
  const html = renderMailboxBodyForTest([
    'Lukt het niet om de bijlage te openen? Dan kun je het webdesign ook via',
    `deze link [${url}]`,
    '',
    'bekijken 🎨',
  ].join('\n'));

  assert.match(
    html,
    /via <a href="https:\/\/www\.softora\.nl\/webdesign\/seats2meet\?cid=mail-row&amp;sender=serve" target="_blank" rel="noopener noreferrer">deze link<\/a> bekijken 🎨<\/div>/
  );
  assert.doesNotMatch(html, /detail-mail-line-empty[^]*bekijken 🎨/);
});

test('premium mailbox lijnt Gmail-citaten links uit en verbergt een losse Softora-webdesign-url', () => {
  const url = 'https://www.softora.nl/webdesign/the-chamomile-collective?cid=safe-dedupe-20260615-row-2149-6137264c438&sender=serve';
  const html = renderMailboxBodyForTest([
    'Bedankt voor je bericht.',
    '',
    'Op do., jul. 23, 2026 om 10:13, Servé Creusen schreef:',
    '',
    '\tGoedendag,',
    '',
    '    Afgelopen week kwam ik jullie website thechamomilecollective.nl tegen.',
    '',
    '\tLukt het niet om de bijlage te openen? Dan kun je het webdesign ook via deze link',
    '',
    `    (${url}) bekijken 🎨`,
  ].join('\n'));

  assert.doesNotMatch(html, /<div class="detail-mail-line">[\t ]+/);
  assert.match(
    html,
    /via <a href="https:\/\/www\.softora\.nl\/webdesign\/the-chamomile-collective\?cid=safe-dedupe-20260615-row-2149-6137264c438&amp;sender=serve" target="_blank" rel="noopener noreferrer">deze link<\/a> bekijken 🎨<\/div>/
  );
  assert.doesNotMatch(html, />https:\/\/www\.softora\.nl\/webdesign\/the-chamomile-collective/);
});

test('premium mailbox houdt databasekoppeling zonder interessebalk in het maildetail', () => {
  const pageSource = readPage();
  const scriptSource = readScript();
  const indexSource = readIndexScript();
  const outreachSource = readOutreachScript();
  const campaignInboxSource = readCampaignInboxScript();

  assert.doesNotMatch(pageSource, /\.outreach-quickbar/);
  assert.match(pageSource, /premium-mailbox-outreach\.js\?v=20260720b/);
  assert.match(indexSource, /SoftoraMailboxOutreach\.hydrate/);
  assert.doesNotMatch(scriptSource, /SoftoraMailboxOutreach\.renderQuickbar/);
  assert.doesNotMatch(scriptSource, /SoftoraMailboxOutreach\.handleAction/);
  assert.match(outreachSource, /global\.SoftoraMailboxOutreach = mailboxOutreachApi/);
  assert.match(outreachSource, /isWebdesignOutreachCustomer/);
  assert.doesNotMatch(outreachSource, /Webdesign-reactie/);
  assert.doesNotMatch(outreachSource, /data-mailbox-action="outreach-status"/);
  assert.doesNotMatch(outreachSource, /data-outreach-status/);
  assert.match(outreachSource, /mailMatchesOutreachCustomer/);
  assert.match(outreachSource, /collectCustomerMessageKeys/);
  assert.match(outreachSource, /function shouldSelectFirstMailboxMatch\(value\)/);
  assert.match(outreachSource, /function mailHasEmail\(mail, email\)/);
  assert.match(outreachSource, /selectFirst: shouldSelectFirstMailboxMatch\(params\.get\('select'\) \|\| params\.get\('openFirst'\) \|\| ''\)/);
  assert.match(outreachSource, /intent\.email && mailHasEmail\(mail, intent\.email\)/);
  assert.match(outreachSource, /helpers\.toast\('Geen exacte thread gevonden, ik zoek op e-mailadres'\);/);
  assert.match(outreachSource, /helpers && helpers\.toast && !intent\.selectFirst/);
});

test('premium mailbox gebruikt Softora Inter voor het onderwerp en toont alleen het campagneadres', () => {
  const pageSource = readPage();
  const campaignInboxSource = readCampaignInboxScript();
  const accountHtml = campaignInboxModule.renderDetailAccount({
    campaign: { company: 'Rijs Textiles B.V.' },
    accountEmail: 'serve@softora.nl',
  }, (value) => String(value));

  assert.match(pageSource, /\.detail-subject \{[\s\S]*font-family:\s*var\(--premium-sidebar-font-sans, 'Inter', sans-serif\);[\s\S]*font-weight:\s*700;[\s\S]*letter-spacing:\s*0;/);
  assert.doesNotMatch(pageSource, /\.detail-subject \{[^}]*Barlow Condensed/);
  assert.equal(accountHtml, '<div class="detail-campaign-account">serve@softora.nl</div>');
  assert.doesNotMatch(campaignInboxSource, /Binnengekomen via/);
});

test('coldmail inbox isoleert alleen gekoppelde eigen campagne-reacties over alle afzenderaccounts', () => {
  const pageSource = readPage();
  const scriptSource = readScript();
  const indexSource = readIndexScript();
  const outreachSource = readOutreachScript();
  const campaignInboxSource = readCampaignInboxScript();

  assert.doesNotMatch(pageSource, /class="mail-sidebar"/);
  assert.doesNotMatch(pageSource, /data-mailbox-folder=/);
  assert.match(scriptSource, /let activeFolder = 'outreach';/);
  assert.match(scriptSource, /SoftoraMailboxCampaignInbox\?\.load/);
  assert.match(campaignInboxSource, /\/api\/mailbox\/campaign-replies\?limit=100/);
  assert.match(campaignInboxSource, /function getAccount\(mail, fallbackAccount\)/);
  assert.match(campaignInboxSource, /function getRequestId\(mail\)/);
  assert.match(campaignInboxSource, /async function load\(folder, normalizeMessage, fetchImpl, options\)/);
  assert.match(indexSource, /id: String\(requestId \|\| id\)/);
  assert.doesNotMatch(campaignInboxSource, /ui-state-get/);
  assert.match(outreachSource, /folder: normalizeText\(params\.get\('folder'\) \|\| 'outreach'\)/);
});

test('coldmail inbox laadt echte gekoppelde mailboxberichten via de campagne-replies route', async () => {
  const calls = [];
  const messages = [
    {
      id: 'inbox:42',
      mailboxId: 'inbox:42',
      accountEmail: 'serve@softora.nl',
      folder: 'inbox',
      from: 'Studio Noord',
      email: 'info@studionoord.nl',
      subject: 'Re: Nieuw webdesign',
      preview: 'Kunnen we morgen bellen?',
      date: '2026-07-20T10:15:00.000Z',
      unread: true,
      campaign: {
        company: 'Studio Noord',
        account: 'serve@softora.nl',
        customerId: 'softora-pending',
        status: 'reactie_ontvangen',
        actionRequired: true,
      },
    },
    {
      id: 'inbox:77',
      mailboxId: 'inbox:77',
      accountEmail: 'martijn@softora.nl',
      folder: 'inbox',
      from: 'Bakkerij De Kroon',
      email: 'contact@dekroon.nl',
      subject: 'Re: Nieuw webdesign',
      preview: 'Geen interesse.',
      date: '2026-07-19T15:45:00.000Z',
      unread: false,
      campaign: {
        company: 'Bakkerij De Kroon',
        account: 'martijn@softora.nl',
        customerId: 'softora-handled',
        status: 'geen_interesse',
        actionRequired: false,
      },
    },
  ];
  const result = await campaignInboxModule.load('outreach', (message) => message, async (url, options) => {
    calls.push({ url: String(url), options });
    return {
      ok: true,
      json: async () => ({
        ok: true,
        messages,
        sync: {
          indexed: true,
          source: 'campaign-replies-index',
        },
      }),
    };
  });

  assert.equal(result.messages.length, 2);
  assert.deepEqual(
    Array.from(result.messages, (reply) => reply.accountEmail),
    ['serve@softora.nl', 'martijn@softora.nl']
  );
  assert.equal(result.messages[0].mailboxId, 'inbox:42');
  assert.equal(result.messages[0].campaign.actionRequired, true);
  assert.equal(result.messages[1].campaign.actionRequired, false);
  assert.equal(result.sync.source, 'campaign-replies-index');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, '/api/mailbox/campaign-replies?limit=100');
  assert.equal(calls[0].options.cache, 'no-store');
  assert.doesNotMatch(calls[0].url, /ui-state-get/);
  assert.equal(await campaignInboxModule.load('inbox', (message) => message), null);
});

test('mailbox gebruikt server-bootstrap zonder zichtbare laadtekst of eerste client-request', async () => {
  const previousDocument = globalThis.document;
  let fetchCalls = 0;
  globalThis.document = {
    getElementById(id) {
      if (id !== 'softoraPageStateBootstrap') return null;
      return {
        textContent: JSON.stringify({
          session: {
            authenticated: true,
            email: 'serve@softora.nl',
            displayName: 'Servé Creusen',
          },
          mailbox: {
            ok: true,
            messages: [{ id: 'reply-bootstrap', from: 'Direct zichtbaar' }],
            sync: { source: 'campaign-replies-index' },
          },
        }),
      };
    },
  };
  try {
    assert.equal(campaignInboxModule.hasPageBootstrap('outreach'), true);
    assert.equal(campaignInboxModule.getPageBootstrapSession().email, 'serve@softora.nl');
    const result = await campaignInboxModule.load('outreach', (message) => message, async () => {
      fetchCalls += 1;
      throw new Error('bootstrap hoort de request over te slaan');
    });
    assert.equal(result.messages[0].id, 'reply-bootstrap');
    assert.equal(result.fromBootstrap, true);
    assert.equal(fetchCalls, 0);
  } finally {
    globalThis.document = previousDocument;
  }

  assert.doesNotMatch(readScript(), />Mailbox laden…</);
  assert.match(readScript(), /preserveOnError:\s*true/);
  assert.match(readScript(), /getPageBootstrapSession/);
});

test('mailbox leest complete unicode gespreksdata uit de veilige base64-bootstrap', async () => {
  const previousDocument = globalThis.document;
  const previousApi = globalThis.SoftoraMailboxCampaignInbox;
  const modulePath = require.resolve('../../assets/premium-mailbox-campaign-inbox.js');
  const payload = {
    session: {
      authenticated: true,
      email: 'martijn@softora.nl',
      displayName: 'Martijn van de Ven',
    },
    mailbox: {
      ok: true,
      messages: [{
        id: 'ralph-conversation',
        from: 'Ralph Ruyters',
        threadMessages: [
          { id: 'sent-1', folder: 'sent', body: 'Eerste antwoord' },
          { id: 'sent-2', folder: 'sent', body: 'Vervolg met € en emoji 😁' },
        ],
      }],
      sync: { source: 'campaign-replies-index' },
    },
  };
  globalThis.document = {
    getElementById(id) {
      if (id !== 'softoraPageStateBootstrap') return null;
      return {
        textContent: Buffer.from(JSON.stringify(payload), 'utf8').toString('base64'),
        getAttribute(name) {
          return name === 'data-softora-encoding' ? 'base64' : null;
        },
      };
    },
  };
  delete require.cache[modulePath];
  const freshCampaignInboxModule = require(modulePath);

  try {
    const result = await freshCampaignInboxModule.load('outreach', (message) => message);
    assert.equal(result.messages[0].threadMessages.length, 2);
    assert.equal(result.messages[0].threadMessages[1].body, 'Vervolg met € en emoji 😁');
    assert.equal(freshCampaignInboxModule.getPageBootstrapSession().displayName, 'Martijn van de Ven');
  } finally {
    delete require.cache[modulePath];
    globalThis.document = previousDocument;
    globalThis.SoftoraMailboxCampaignInbox = previousApi;
  }
});

test('mailbox toont de laatst bekende tabdata direct wanneer de server koud start', async () => {
  const previousDocument = globalThis.document;
  const previousBootstrapSession = globalThis.SoftoraPageBootstrapSession;
  const previousApi = globalThis.SoftoraMailboxCampaignInbox;
  const modulePath = require.resolve('../../assets/premium-mailbox-campaign-inbox.js');
  globalThis.document = { getElementById() { return null; } };
  globalThis.SoftoraPageBootstrapSession = {
    get() { return { authenticated: true, userId: 'usr_serve', email: 'serve@softora.nl' }; },
    cache: {
      read(key) {
        assert.equal(key, 'mailbox_campaign_replies:usr_serve');
        return {
          ok: true,
          messages: [{ id: 'reply-session-cache', from: 'Direct uit tabcache' }],
          sync: { source: 'tab-session-cache' },
        };
      },
      write() { return true; },
    },
  };
  delete require.cache[modulePath];
  const freshCampaignInboxModule = require(modulePath);
  let fetchCalls = 0;

  try {
    const result = await freshCampaignInboxModule.load('outreach', (message) => message, async () => {
      fetchCalls += 1;
      throw new Error('tabcache hoort de eerste request over te slaan');
    });
    assert.equal(result.messages[0].id, 'reply-session-cache');
    assert.equal(result.fromBootstrap, true);
    assert.equal(fetchCalls, 0);
  } finally {
    delete require.cache[modulePath];
    globalThis.document = previousDocument;
    globalThis.SoftoraPageBootstrapSession = previousBootstrapSession;
    globalThis.SoftoraMailboxCampaignInbox = previousApi;
  }
});

test('mailbox verkiest de serverbootstrap boven een nieuwere maar verouderde tabcache', async () => {
  const previousDocument = globalThis.document;
  const previousBootstrapSession = globalThis.SoftoraPageBootstrapSession;
  const previousApi = globalThis.SoftoraMailboxCampaignInbox;
  const modulePath = require.resolve('../../assets/premium-mailbox-campaign-inbox.js');
  let cachedSnapshot = {
    ok: true,
    savedAt: '2026-07-23T08:00:00.000Z',
    messages: [
      { id: 'reply-delete', mailboxId: 'inbox:42', uid: 42, folder: 'inbox', accountEmail: 'serve@softora.nl' },
      { id: 'reply-keep', mailboxId: 'inbox:43', uid: 43, folder: 'inbox', accountEmail: 'serve@softora.nl' },
    ],
    sync: { source: 'tab-session-cache' },
  };
  globalThis.document = {
    getElementById(id) {
      if (id !== 'softoraPageStateBootstrap') return null;
      return {
        textContent: JSON.stringify({
          mailbox: {
            ok: true,
            savedAt: '2026-07-23T07:00:00.000Z',
            messages: [
              { id: 'reply-keep', mailboxId: 'inbox:43', uid: 43, folder: 'inbox', accountEmail: 'serve@softora.nl' },
            ],
          },
        }),
      };
    },
  };
  globalThis.SoftoraPageBootstrapSession = {
    get() { return { authenticated: true, userId: 'usr_serve', email: 'serve@softora.nl' }; },
    cache: {
      read() { return cachedSnapshot; },
      write(_key, value) {
        cachedSnapshot = value;
        return true;
      },
    },
  };
  delete require.cache[modulePath];
  const freshCampaignInboxModule = require(modulePath);

  try {
    const authoritativeResult = await freshCampaignInboxModule.load('outreach', (message) => message);
    assert.deepEqual(authoritativeResult.messages.map((message) => message.id), ['reply-keep']);

    assert.equal(freshCampaignInboxModule.removeCachedMessage({
      mailboxId: 'inbox:42',
      uid: 42,
      folder: 'inbox',
      accountEmail: 'serve@softora.nl',
    }), false);
    assert.deepEqual(cachedSnapshot.messages.map((message) => message.id), ['reply-keep']);

    const result = await freshCampaignInboxModule.load('outreach', (message) => message);
    assert.deepEqual(result.messages.map((message) => message.id), ['reply-keep']);
  } finally {
    delete require.cache[modulePath];
    globalThis.document = previousDocument;
    globalThis.SoftoraPageBootstrapSession = previousBootstrapSession;
    globalThis.SoftoraMailboxCampaignInbox = previousApi;
  }
});

test('mailbox deelt een bevestigde verwijdering direct met andere open tabs', () => {
  const previousDocument = globalThis.document;
  const previousBootstrapSession = globalThis.SoftoraPageBootstrapSession;
  const previousBroadcastChannel = globalThis.BroadcastChannel;
  const previousApi = globalThis.SoftoraMailboxCampaignInbox;
  const modulePath = require.resolve('../../assets/premium-mailbox-campaign-inbox.js');
  const openChannels = new Set();
  let cachedSnapshot = {
    ok: true,
    savedAt: '2026-07-23T08:00:00.000Z',
    messages: [
      { id: 'reply-delete', mailboxId: 'inbox:42', uid: 42, folder: 'inbox', accountEmail: 'serve@softora.nl' },
      { id: 'reply-keep', mailboxId: 'inbox:43', uid: 43, folder: 'inbox', accountEmail: 'serve@softora.nl' },
    ],
  };
  class FakeBroadcastChannel {
    constructor(name) {
      this.name = name;
      this.listener = null;
      openChannels.add(this);
    }
    addEventListener(type, listener) {
      if (type === 'message') this.listener = listener;
    }
    removeEventListener(type, listener) {
      if (type === 'message' && this.listener === listener) this.listener = null;
    }
    postMessage(data) {
      openChannels.forEach((channel) => {
        if (channel !== this && channel.name === this.name && channel.listener) {
          channel.listener({ data });
        }
      });
    }
    close() {
      openChannels.delete(this);
    }
  }
  globalThis.document = {
    getElementById(id) {
      if (id !== 'softoraPageStateBootstrap') return null;
      return { textContent: JSON.stringify({ session: { authenticated: true, userId: 'usr_serve' } }) };
    },
  };
  globalThis.SoftoraPageBootstrapSession = {
    get() { return { authenticated: true, userId: 'usr_serve', email: 'serve@softora.nl' }; },
    cache: {
      read() { return cachedSnapshot; },
      write(_key, value) {
        cachedSnapshot = value;
        return true;
      },
    },
  };
  globalThis.BroadcastChannel = FakeBroadcastChannel;
  delete require.cache[modulePath];
  const freshCampaignInboxModule = require(modulePath);
  const received = [];
  const unsubscribe = freshCampaignInboxModule.subscribeToMessageDeletions((identity) => {
    received.push(identity);
  });

  try {
    assert.equal(freshCampaignInboxModule.publishMessageDeletion({
      mailboxId: 'inbox:42',
      uid: 42,
      folder: 'inbox',
      accountEmail: 'serve@softora.nl',
    }), true);
    assert.deepEqual(cachedSnapshot.messages.map((message) => message.id), ['reply-keep']);
    assert.deepEqual(received, [{
      accountEmail: 'serve@softora.nl',
      folder: 'inbox',
      uid: 42,
      id: 'inbox:42',
    }]);
  } finally {
    unsubscribe();
    delete require.cache[modulePath];
    globalThis.document = previousDocument;
    globalThis.SoftoraPageBootstrapSession = previousBootstrapSession;
    globalThis.BroadcastChannel = previousBroadcastChannel;
    globalThis.SoftoraMailboxCampaignInbox = previousApi;
  }
});
