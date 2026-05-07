const test = require('node:test');
const assert = require('node:assert/strict');

const { createRubenAssistant } = require('../../server/services/ruben-assistant');

test('ruben assistant builds identity, operating rules and recent software timeline', async () => {
  const assistant = createRubenAssistant({
    getUiStateValues: async () => ({
      source: 'supabase',
      updatedAt: '2026-04-08T10:00:00.000Z',
      values: {
        mission: 'Ruben bewaakt de samenhang tussen processen.',
        notes: JSON.stringify([
          {
            id: 'note-1',
            category: 'workflow',
            title: 'Niet geïnteresseerde leads niet opnieuw bellen',
            detail: 'DNC en dismissed statussen zijn leidend voor vervolgstappen.',
            why: 'Zo blijft de bellijst schoon.',
            createdAt: '2026-04-08T09:00:00.000Z',
          },
        ]),
      },
    }),
    buildKnowledgeContext: async ({ question }) => ({
      source: 'repo-readonly-index',
      accessMode: 'read-only',
      relevantItems: [
        {
          type: 'page',
          route: '/premium-database',
          title: 'Database',
          summary: `Vraag: ${question}`,
        },
      ],
    }),
  });

  const assistantContext = await assistant.buildAssistantContext({
    dashboardContext: {
      overview: {
        totaalKlanten: 4,
      },
      recentActivities: [
        {
          tijd: '2026-04-08T09:30:00.000Z',
          titel: 'Lead dismissed',
          detail: 'Klant wil niet meer gebeld worden',
          bedrijf: 'Alpha BV',
          bron: 'coldcalling',
          actor: 'system',
        },
      ],
    },
    question: 'Hoe werkt premium database?',
  });

  assert.equal(assistantContext.identity.name, 'Ruben Nijhuis');
  assert.equal(assistantContext.identity.role, 'Softora coach & systeemassistent');
  assert.ok(Array.isArray(assistantContext.operatingRules));
  assert.ok(assistantContext.operatingRules.some((item) => item.key === 'lead_do_not_call'));
  assert.equal(assistantContext.memory.source, 'supabase');
  assert.equal(assistantContext.knowledge.source, 'repo-readonly-index');
  assert.equal(assistantContext.knowledge.accessMode, 'read-only');
  assert.equal(assistantContext.memory.notes[0].title, 'Niet geïnteresseerde leads niet opnieuw bellen');
  assert.equal(assistantContext.recentSoftwareTimeline[0].title, 'Lead dismissed');
});

test('ruben assistant system prompt frames the assistant as a Softora colleague', () => {
  const assistant = createRubenAssistant();
  const prompt = assistant.buildAssistantSystemPrompt({
    assistantContext: {
      identity: assistant.buildAssistantIdentity(),
    },
  });

  assert.match(prompt, /Ruben Nijhuis/);
  assert.match(prompt, /digitale collega/);
  assert.match(prompt, /operationele regels/);
  assert.match(prompt, /geen losse generieke AI/);
  assert.match(prompt, /read-only kennislaag/);
  assert.match(prompt, /alleen leestoegang/);
  assert.match(prompt, /Geef direct antwoord/);
});
