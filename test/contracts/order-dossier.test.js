const test = require('node:test');
const assert = require('node:assert/strict');

const { createOrderDossierHelpers } = require('../../server/services/order-dossier');

const helpers = createOrderDossierHelpers({
  parseIntSafe: (value, fallback = 0) => {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : fallback;
  },
  normalizeString: (value) => String(value || '').trim(),
  clipText: (value, maxLength = 500) => String(value || '').slice(0, maxLength),
  escapeHtml: (value) =>
    String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;'),
});

test('order dossier helpers keep the opus prompt short and preserve assigned-owner labels', () => {
  const fallback = helpers.buildOrderDossierFallbackLayout({
    orderId: '7',
    company: 'Softora',
    claimedBy: 'Servé',
  });

  assert.equal(
    helpers.buildShortOrderDossierOpusPrompt(),
    'Werk deze opdracht in Claude Opus 4.6 uit op basis van uitsluitend de gekoppelde lead- en dossierinformatie.'
  );
  assert.equal(fallback.documentTitle, 'Opdracht #7');
  assert.equal(fallback.blocks[0].pairs[4].label, 'Aangewezen aan');
  assert.equal(fallback.blocks[0].pairs[4].value, 'Servé');
});

test('order dossier helpers strip legacy block titles and internal pair labels', () => {
  const layout = helpers.normalizeOrderDossierLayout(
    {
      blocks: [
        {
          kind: 'meta',
          title: 'Uitvoerfocus',
          pairs: [{ label: 'Geclaimd door', value: 'Martijn' }],
        },
        {
          kind: 'meta',
          title: 'Projectkern',
          pairs: [
            { label: 'Accounthouder Softora', value: 'Intern' },
            { label: 'Geclaimd door', value: 'Martijn' },
          ],
        },
        {
          kind: 'text',
          title: 'Klantwensen',
          text: 'Nieuwe website met intake.',
        },
      ],
    },
    { title: 'Fallback dossier' }
  );

  assert.equal(layout.blocks.length, 2);
  assert.equal(layout.blocks[0].kind, 'meta');
  assert.deepEqual(layout.blocks[0].pairs, [
    { label: 'Aangewezen aan', value: 'Martijn' },
  ]);
  assert.equal(layout.blocks[1].title, 'Klantwensen');
});

test('order dossier helpers build anthropic prompts with the fallback reference embedded', () => {
  const promptPack = helpers.buildAnthropicOrderDossierPrompts({
    title: 'Nieuwe website',
    company: 'Softora',
    sourceAppointmentLabel: 'Afspraak 16 april',
  });

  assert.match(promptPack.systemPrompt, /Gebruik geen bloktitels zoals "Uitvoerplan"/);
  assert.match(promptPack.userPrompt, /<fallback_reference>/);
  assert.match(promptPack.userPrompt, /Afspraak 16 april/);
});
