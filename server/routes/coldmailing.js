const { createAgendaCapacityService } = require('../services/agenda-capacity');
const {
  COLDMAIL_SEND_CONFIRM_PIN,
  validateRiskyActionConfirmPin,
} = require('../security/risky-action-confirm-pin');

async function resolveColdmailingAgendaCapacity(deps) {
  if (deps && typeof deps.backfillInsightsAndAppointmentsFromRecentCallUpdates === 'function') {
    deps.backfillInsightsAndAppointmentsFromRecentCallUpdates();
  }

  if (
    deps &&
    typeof deps.isSupabaseConfigured === 'function' &&
    deps.isSupabaseConfigured() &&
    typeof deps.syncRuntimeStateFromSupabaseIfNewer === 'function'
  ) {
    await deps.syncRuntimeStateFromSupabaseIfNewer({
      force: false,
      maxAgeMs: 0,
      skipPendingPersistWait: true,
    });
  }

  if (deps && typeof deps.backfillInsightsAndAppointmentsFromRecentCallUpdates === 'function') {
    deps.backfillInsightsAndAppointmentsFromRecentCallUpdates();
  }

  const appointments =
    typeof deps?.getGeneratedAgendaAppointments === 'function'
      ? deps.getGeneratedAgendaAppointments()
      : Array.isArray(deps?.generatedAgendaAppointments)
        ? deps.generatedAgendaAppointments
        : [];
  const capacityService = createAgendaCapacityService({
    normalizeString: deps?.normalizeString,
    normalizeDateYyyyMmDd: deps?.normalizeDateYyyyMmDd,
    normalizeTimeHhMm: deps?.normalizeTimeHhMm,
    now:
      typeof deps?.getColdmailingAgendaCapacityNow === 'function'
        ? deps.getColdmailingAgendaCapacityNow
        : () => new Date(),
  });

  return capacityService.assessUpcomingWorkdayCapacity({
    appointments,
    isAppointmentVisible:
      typeof deps?.isGeneratedAppointmentVisibleForAgenda === 'function'
        ? deps.isGeneratedAppointmentVisibleForAgenda
        : () => true,
    workdayCount: 10,
    slotMinutes: 60,
    businessHoursStart: '09:00',
    businessHoursEnd: '17:00',
    timeZone: 'Europe/Amsterdam',
  });
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderColdmailUnsubscribePage({ title, message, ok = true, actionUrl = '', buttonLabel = '', detail = '' }) {
  const accent = ok ? '#a92561' : '#6b7280';
  const safeActionUrl = String(actionUrl || '').trim();
  const safeButtonLabel = String(buttonLabel || '').trim();
  const formHtml = safeActionUrl && safeButtonLabel
    ? `<form method="post" action="${escapeHtml(safeActionUrl)}">
      <button type="submit">${escapeHtml(safeButtonLabel)}</button>
    </form>`
    : '';
  const detailHtml = detail
    ? `<p class="detail">${escapeHtml(detail)}</p>`
    : '';
  return `<!doctype html>
<html lang="nl">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex,nofollow">
  <title>${escapeHtml(title)}</title>
  <style>
    body{margin:0;min-height:100vh;display:grid;place-items:center;background:#faf9f7;color:#1b1b2f;font-family:Arial,sans-serif}
    main{width:min(520px,calc(100% - 32px));padding:42px 34px;border:1px solid #ead8e1;border-radius:18px;background:#fff;box-shadow:0 22px 60px rgba(45,35,45,.08);text-align:center}
    h1{margin:0 0 12px;font-size:clamp(32px,7vw,54px);letter-spacing:.02em;color:${accent};font-weight:800}
    p{margin:0;color:#5f6070;font-size:18px;line-height:1.55}
    .detail{margin-top:12px;font-size:14px;color:#8a8c99}
    form{margin-top:26px}
    button{appearance:none;border:0;border-radius:999px;background:#a92561;color:#fff;font-weight:800;font-size:15px;padding:13px 20px;cursor:pointer;box-shadow:0 12px 28px rgba(169,37,97,.22)}
    button:hover{background:#8d1e51}
  </style>
</head>
<body>
  <main>
    <h1>${escapeHtml(title)}</h1>
    <p>${escapeHtml(message)}</p>
    ${detailHtml}
    ${formHtml}
  </main>
</body>
</html>`;
}

function registerColdmailingRoutes(app, deps = {}) {
  const {
    coldmailCampaignService,
    getEffectivePublicBaseUrl = () => '',
    normalizeString = (value) => String(value || '').trim(),
    truncateText = (value, maxLength = 500) => String(value || '').slice(0, maxLength),
    requirePremiumAdminApiAccess = (_req, _res, next) => next(),
  } = deps;

  if (!coldmailCampaignService) return;

  app.get('/coldmailing/webdesign-foto', async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    try {
      if (typeof coldmailCampaignService.getColdmailPreviewImage !== 'function') {
        res.status(404).type('text').send('Deze foto is niet beschikbaar.');
        return;
      }
      const image = await coldmailCampaignService.getColdmailPreviewImage({
        token: req.query.t || req.query.token,
      });
      const safeFilename = normalizeString(image && image.filename).replace(/["\r\n]/g, '') || 'webdesign-foto.png';
      res.setHeader('Content-Type', normalizeString(image && image.contentType) || 'application/octet-stream');
      res.setHeader('Content-Disposition', `inline; filename="${safeFilename}"`);
      res.status(200).send(image.content);
    } catch (error) {
      const status = normalizeString(error && error.code) === 'INVALID_UNSUBSCRIBE_TOKEN' ? 400 : 404;
      res.status(status).type('text').send(
        truncateText(normalizeString(error && error.message) || 'Deze foto is niet beschikbaar.', 200)
      );
    }
  });

  app.get(['/afmelden', '/coldmailing/afmelden'], async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    try {
      if (typeof coldmailCampaignService.getColdmailUnsubscribePreview !== 'function') {
        res.status(404).type('html').send(
          renderColdmailUnsubscribePage({
            ok: false,
            title: 'Niet gevonden',
            message: 'Deze link is niet beschikbaar.',
          })
        );
        return;
      }
      const token = normalizeString(req.query.t || req.query.token);
      const preview = await coldmailCampaignService.getColdmailUnsubscribePreview({
        token,
      });
      const requestPath = normalizeString(req.path || req.originalUrl || '/afmelden').split('?')[0] || '/afmelden';
      const actionUrl = `${requestPath}?t=${encodeURIComponent(token)}`;
      res.status(200).type('html').send(
        renderColdmailUnsubscribePage({
          title: 'Had je liever geen webdesign willen ontvangen?',
          message: 'Bevestig hieronder dat je hierover geen bericht meer wilt ontvangen.',
          detail: preview && preview.bedrijf
            ? `Dit geldt voor ${preview.bedrijf}.`
            : 'Dit gebeurt pas nadat je bevestigt.',
          actionUrl,
          buttonLabel: 'Ja, laat dit verder rusten',
        })
      );
    } catch (error) {
      const status = normalizeString(error && error.code) === 'INVALID_UNSUBSCRIBE_TOKEN' ? 400 : 404;
      res.status(status).type('html').send(
        renderColdmailUnsubscribePage({
          ok: false,
          title: 'Niet bevestigd',
          message: normalizeString(error && error.message) || 'Deze link is ongeldig.',
        })
      );
    }
  });

  app.post(['/afmelden', '/coldmailing/afmelden'], async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    try {
      if (typeof coldmailCampaignService.unsubscribeColdmailRecipient !== 'function') {
        res.status(404).type('html').send(
          renderColdmailUnsubscribePage({
            ok: false,
            title: 'Niet gevonden',
            message: 'Deze link is niet beschikbaar.',
          })
        );
        return;
      }
      await coldmailCampaignService.unsubscribeColdmailRecipient({
        token: req.query.t || req.query.token || (req.body && (req.body.t || req.body.token)),
        actor: 'coldmail-unsubscribe-link',
      });
      res.status(200).type('html').send(
        renderColdmailUnsubscribePage({
          title: 'Helemaal goed',
          message: 'Dank je. Ik laat dit verder rusten.',
        })
      );
    } catch (error) {
      const status = normalizeString(error && error.code) === 'INVALID_UNSUBSCRIBE_TOKEN' ? 400 : 404;
      res.status(status).type('html').send(
        renderColdmailUnsubscribePage({
          ok: false,
          title: 'Niet bevestigd',
          message: normalizeString(error && error.message) || 'Deze link is ongeldig.',
        })
      );
    }
  });

  app.get('/api/coldmailing/mailbox-options', (_req, res) => {
    const configuredSenderEmails =
      typeof coldmailCampaignService.getConfiguredSenderEmails === 'function'
        ? coldmailCampaignService.getConfiguredSenderEmails()
        : undefined;
    res.json({
      ok: true,
      configured: coldmailCampaignService.isSmtpMailConfigured(),
      missing: coldmailCampaignService.getMissingSmtpMailEnv(),
      imapConfigured:
        typeof coldmailCampaignService.isImapMailConfigured === 'function'
          ? coldmailCampaignService.isImapMailConfigured()
          : false,
      senderEmails:
        Array.isArray(configuredSenderEmails) && configuredSenderEmails.length
          ? configuredSenderEmails
          : coldmailCampaignService.getAllowedSenderEmails(),
      configuredSenderEmails,
      safetyLimits:
        typeof coldmailCampaignService.getColdmailSafetyLimits === 'function'
          ? coldmailCampaignService.getColdmailSafetyLimits()
          : undefined,
    });
  });

  app.get('/api/coldmailing/campaigns/recipients', async (req, res) => {
    try {
      const result = await coldmailCampaignService.getColdmailCampaignRecipients({
        count: req.query.count,
        branch: req.query.branch,
        mode: req.query.mode,
        radiusKm: req.query.radiusKm,
        service: req.query.service,
        specialAction: req.query.specialAction,
        testMode: req.query.testMode,
        blockedPhones: req.query.blockedPhones,
        blockedEmails: req.query.blockedEmails || req.query.emailBlocklist || req.query.mailBlocklist,
      });
      res.json(result);
    } catch (error) {
      res.status(400).json({
        ok: false,
        code: normalizeString(error && error.code) || 'COLDMAIL_RECIPIENTS_FAILED',
        message: truncateText(
          normalizeString(error && error.message) || 'Ontvangers konden niet worden geladen.',
          500
        ),
      });
    }
  });

  app.post('/api/coldmailing/unsubscribe', async (req, res) => {
    try {
      if (typeof coldmailCampaignService.unsubscribeColdmailRecipient !== 'function') {
        res.status(404).json({
          ok: false,
          code: 'COLDMAIL_UNSUBSCRIBE_UNAVAILABLE',
          message: 'Afmelden is niet beschikbaar.',
        });
        return;
      }
      const body = req.body && typeof req.body === 'object' ? req.body : {};
      const result = await coldmailCampaignService.unsubscribeColdmailRecipient({
        email: req.query.email || body.email,
        token: req.query.token || body.token,
        actor: 'Coldmail unsubscribe',
      });
      res.json(result);
    } catch (error) {
      const code = normalizeString(error && error.code) || 'COLDMAIL_UNSUBSCRIBE_FAILED';
      res.status(code === 'INVALID_UNSUBSCRIBE_TOKEN' ? 403 : 400).json({
        ok: false,
        code,
        message: truncateText(
          normalizeString(error && error.message) || 'Afmelden kon niet worden verwerkt.',
          500
        ),
      });
    }
  });

  app.post('/api/coldmailing/campaigns/send', requirePremiumAdminApiAccess, async (req, res) => {
    try {
      const body = req.body && typeof req.body === 'object' ? req.body : {};
      const pinCheck = validateRiskyActionConfirmPin(body, { expectedPin: COLDMAIL_SEND_CONFIRM_PIN });
      if (!pinCheck.ok) {
        res.status(403).json({
          ok: false,
          code: 'ACTION_CONFIRM_PIN_INVALID',
          message: pinCheck.error,
        });
        return;
      }
      let agendaCapacity = null;
      try {
        agendaCapacity = await resolveColdmailingAgendaCapacity(deps);
      } catch (error) {
        res.status(503).json({
          ok: false,
          agendaBlocked: true,
          code: 'AGENDA_CHECK_UNAVAILABLE',
          reason: 'agenda_check_unavailable',
          message: 'Kon de agenda niet veilig controleren. Coldmailing is niet gestart.',
        });
        return;
      }
      if (agendaCapacity && agendaCapacity.full) {
        res.status(409).json({
          ok: false,
          agendaBlocked: true,
          code: 'AGENDA_FULL_10_WORKDAYS',
          reason: 'agenda_full_10_workdays',
          message: 'Coldmailing is geblokkeerd omdat de agenda voor de komende 10 werkdagen vol zit.',
          agendaCapacity,
        });
        return;
      }
      const result = await coldmailCampaignService.sendColdmailCampaign({
        count: body.count,
        subject: body.subject,
        body: body.body,
        aiInstructions: body.aiInstructions,
        toneStyle: body.toneStyle,
        branch: body.branch,
        service: body.service,
        database: body.database,
        senderEmail: body.senderEmail,
        specialAction: body.specialAction,
        testMode: body.testMode,
        durationDays: body.durationDays,
        radiusKm: body.radiusKm,
        mode: body.mode,
        blockedPhones: body.blockedPhones || body.callBlocklist,
        blockedEmails: body.blockedEmails || body.emailBlocklist || body.mailBlocklist || body.blockedMailAddresses,
        publicBaseUrl: getEffectivePublicBaseUrl(req),
        actor:
          normalizeString(req.premiumAuth && (req.premiumAuth.displayName || req.premiumAuth.email)) ||
          'Coldmailing',
      });
      res.json(result);
    } catch (error) {
      const code = normalizeString(error && error.code) || 'COLDMAIL_SEND_FAILED';
      const status = code === 'SMTP_NOT_CONFIGURED' || code === 'SENDER_SMTP_NOT_CONFIGURED'
        ? 503
        : code === 'COLDMAIL_SEND_IN_PROGRESS'
          ? 409
        : code === 'COLDMAIL_DAILY_LIMIT_REACHED' || code === 'COLDMAIL_SAFETY_PAUSED'
          ? 429
        : code === 'NO_RECIPIENTS' || code === 'NO_VALID_RECIPIENT_DOMAINS'
          ? 422
          : 400;
      res.status(status).json({
        ok: false,
        code,
        message: truncateText(
          normalizeString(error && error.message) || 'Coldmailcampagne kon niet worden verstuurd.',
          500
        ),
        missing: Array.isArray(error && error.missing) ? error.missing : undefined,
        failedItems: Array.isArray(error && error.failedItems) ? error.failedItems : undefined,
        allowedSenderEmails: Array.isArray(error && error.allowedSenderEmails)
          ? error.allowedSenderEmails
          : undefined,
        quota: error && error.quota && typeof error.quota === 'object' ? error.quota : undefined,
      });
    }
  });

  app.get('/api/coldmailing/replies/follow-ups', async (req, res) => {
    try {
      if (typeof coldmailCampaignService.listColdmailReplyFollowUps !== 'function') {
        res.status(404).json({
          ok: false,
          code: 'COLDMAIL_REPLY_FOLLOW_UPS_UNAVAILABLE',
          message: 'Coldmail follow-ups zijn niet beschikbaar.',
        });
        return;
      }
      const result = await coldmailCampaignService.listColdmailReplyFollowUps({
        limit: req.query.limit,
      });
      res.json(result);
    } catch (error) {
      res.status(400).json({
        ok: false,
        code: normalizeString(error && error.code) || 'COLDMAIL_REPLY_FOLLOW_UPS_FAILED',
        message: truncateText(
          normalizeString(error && error.message) || 'Coldmail follow-ups konden niet worden geladen.',
          500
        ),
      });
    }
  });

  app.post('/api/coldmailing/replies/sync', requirePremiumAdminApiAccess, async (req, res) => {
    try {
      if (typeof coldmailCampaignService.syncInboundColdmailRepliesFromImap !== 'function') {
        res.status(404).json({
          ok: false,
          code: 'COLDMAIL_REPLY_SYNC_UNAVAILABLE',
          message: 'Coldmail reply-sync is niet beschikbaar.',
        });
        return;
      }
      const body = req.body && typeof req.body === 'object' ? req.body : {};
      const result = await coldmailCampaignService.syncInboundColdmailRepliesFromImap({
        force: Boolean(body.force),
        maxMessages: body.maxMessages,
      });
      res.json(result);
    } catch (error) {
      const code = normalizeString(error && error.code) || 'COLDMAIL_REPLY_SYNC_FAILED';
      res.status(code === 'OPENAI_NOT_CONFIGURED' ? 503 : 400).json({
        ok: false,
        code,
        message: truncateText(
          normalizeString(error && error.message) || 'Coldmail replies konden niet worden verwerkt.',
          500
        ),
      });
    }
  });

  app.post('/api/coldmailing/outreach/status', requirePremiumAdminApiAccess, async (req, res) => {
    try {
      if (typeof coldmailCampaignService.updateWebdesignOutreachStatus !== 'function') {
        res.status(404).json({
          ok: false,
          code: 'WEBDESIGN_OUTREACH_STATUS_UNAVAILABLE',
          message: 'Webdesign-outreach statusupdates zijn niet beschikbaar.',
        });
        return;
      }
      const body = req.body && typeof req.body === 'object' ? req.body : {};
      const result = await coldmailCampaignService.updateWebdesignOutreachStatus({
        customerId: body.customerId || body.id,
        email: body.email,
        messageId: body.messageId,
        mailboxId: body.mailboxId,
        replyThreadId: body.replyThreadId,
        replyMessageId: body.replyMessageId,
        status: body.status,
        actor:
          normalizeString(req.premiumAuth && (req.premiumAuth.displayName || req.premiumAuth.email)) ||
          normalizeString(body.actor) ||
          'Mailbox',
      });
      res.json(result);
    } catch (error) {
      res.status(error && error.status ? error.status : 400).json({
        ok: false,
        code: normalizeString(error && error.code) || 'WEBDESIGN_OUTREACH_STATUS_FAILED',
        message: truncateText(
          normalizeString(error && error.message) || 'Outreach-status kon niet worden bijgewerkt.',
          500
        ),
      });
    }
  });
}

module.exports = {
  resolveColdmailingAgendaCapacity,
  registerColdmailingRoutes,
};
