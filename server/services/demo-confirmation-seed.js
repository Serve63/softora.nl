function createDemoConfirmationSeedService(deps = {}) {
  const {
    nodeEnv = '',
    demoConfirmationTaskEnabled = false,
    generatedAgendaAppointments = [],
    normalizeString = (value) => String(value || '').trim(),
    upsertRecentCallUpdate = () => null,
    upsertAiCallInsight = () => null,
    upsertGeneratedAgendaAppointment = () => null,
    queueRuntimeStatePersist = () => null,
    getNow = () => new Date(),
    log = () => null,
  } = deps;

  function seedDemoConfirmationTaskForUiTesting() {
    const isProduction = String(nodeEnv || '').toLowerCase() === 'production';
    if (isProduction && !demoConfirmationTaskEnabled) return;

    const demoCallId = 'demo-confirmation-task-call-1';
    if (generatedAgendaAppointments.some((item) => normalizeString(item?.callId) === demoCallId)) {
      return;
    }

    const now = getNow();
    const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    const yyyy = tomorrow.getFullYear();
    const mm = String(tomorrow.getMonth() + 1).padStart(2, '0');
    const dd = String(tomorrow.getDate()).padStart(2, '0');
    const date = `${yyyy}-${mm}-${dd}`;

    upsertRecentCallUpdate({
      callId: demoCallId,
      phone: '+31612345678',
      company: 'Testbedrijf Demo BV',
      name: 'Servé Creusen',
      status: 'ended',
      messageType: 'call.ended',
      summary:
        'Afspraak ingepland voor een korte intake over de AI coldcalling setup. Klant wil eerst per mail bevestiging ontvangen.',
      transcriptSnippet:
        'AI: Zullen we morgen om 14:00 een intake plannen? | Klant: Ja, stuur even een bevestigingsmail dan bevestig ik per mail terug.',
      transcriptFull: [
        'assistant: Goedemiddag, u spreekt met de AI assistent van Softora.',
        'customer: Goedemiddag.',
        'assistant: Ik bel kort over het automatiseren van leadopvolging en intakeplanning.',
        'customer: Interessant, vertel.',
        'assistant: Zullen we een intake plannen om de workflow door te nemen?',
        'customer: Ja, dat is goed.',
        'assistant: Past morgen om 14:00 uur?',
        'customer: Ja, stuur even een bevestigingsmail. Als ik die heb, bevestig ik terug.',
        'assistant: Helemaal goed, dan zetten we dat zo door.',
      ].join('\n'),
      endedReason: 'completed',
      durationSeconds: 94,
      recordingUrl:
        'data:audio/wav;base64,UklGRkQDAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YSADAACAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgA==',
      updatedAt: now.toISOString(),
      updatedAtMs: now.getTime(),
    });

    const insight = upsertAiCallInsight({
      callId: demoCallId,
      company: 'Testbedrijf Demo BV',
      contactName: 'Servé Creusen',
      phone: '+31612345678',
      branche: 'Zakelijke Dienstverlening',
      summary:
        'Prospect staat open voor intake. Afspraak mondeling ingepland en wil eerst een bevestigingsmail ontvangen en daarna per mail bevestigen.',
      appointmentBooked: true,
      appointmentDate: date,
      appointmentTime: '14:00',
      estimatedValueEur: 2800,
      followUpRequired: true,
      followUpReason: 'Bevestigingsmail sturen en wachten op schriftelijke bevestiging.',
      source: 'seed',
      model: 'seed',
      analyzedAt: now.toISOString(),
    });

    const appointment = upsertGeneratedAgendaAppointment(
      {
        company: 'Testbedrijf Demo BV',
        contact: 'Servé Creusen',
        phone: '+31612345678',
        type: 'meeting',
        date,
        time: '14:00',
        value: '€2.800',
        branche: 'Zakelijke Dienstverlening',
        source: 'AI Cold Calling (Testdata UI)',
        summary:
          'Testafspraak voor UI-testen. Eerst bevestigingsmail sturen, daarna wachten op mailbevestiging voordat de afspraak in de agenda verschijnt.',
        aiGenerated: true,
        callId: demoCallId,
        createdAt: now.toISOString(),
      },
      demoCallId
    );

    if (appointment) {
      appointment.confirmationEmailDraft = [
        'Onderwerp: Bevestiging intakeafspraak Testbedrijf Demo BV - morgen 14:00',
        '',
        'Beste Servé,',
        '',
        'Bedankt voor het prettige telefoongesprek van zojuist.',
        'Hierbij bevestig ik onze intakeafspraak voor morgen om 14:00 uur.',
        '',
        'Zoals besproken lopen we tijdens de intake kort de AI coldcalling workflow door en bekijken we de opvolging in het dashboard.',
        '',
        'Wil je deze tijd per mail bevestigen? Dan zetten wij de afspraak definitief in de agenda.',
        '',
        'Met vriendelijke groet,',
        'Softora',
      ].join('\n');
      appointment.confirmationEmailDraftGeneratedAt = now.toISOString();
      appointment.confirmationEmailDraftSource = 'seed';
      if (insight) {
        insight.agendaAppointmentId = appointment.id;
      }
      queueRuntimeStatePersist('demo_seed_confirmation_task');
    }

    log('[Startup] Demo bevestigingstaak toegevoegd voor UI-testen.');
  }

  return {
    seedDemoConfirmationTaskForUiTesting,
  };
}

module.exports = {
  createDemoConfirmationSeedService,
};
