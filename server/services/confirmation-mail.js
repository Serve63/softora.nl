const nodemailer = require('nodemailer');
const { ImapFlow } = require('imapflow');
const { simpleParser } = require('mailparser');

function createConfirmationMailService(deps = {}) {
  const {
    mailConfig = {},
    runtimeState = {},
    generatedAgendaAppointments = [],
    appendDashboardActivity = () => {},
    getGeneratedAppointmentIndexById = () => -1,
    mapAppointmentToConfirmationTask = () => null,
    normalizeDateYyyyMmDd = (value) => String(value || '').trim(),
    normalizeString = (value) => String(value || '').trim(),
    normalizeTimeHhMm = (value) => String(value || '').trim(),
    setGeneratedAgendaAppointmentAtIndex = () => null,
    formatDateTimeLabelNl = (date, time) => `${date} ${time}`.trim(),
    truncateText = (value, maxLength = 500) => String(value || '').slice(0, maxLength),
    createTransport = (config) => nodemailer.createTransport(config),
    createImapClient = (config) => new ImapFlow(config),
    parseMailSource = (source) => simpleParser(source),
  } = deps;

  const {
    smtpHost = '',
    smtpPort = 587,
    smtpSecure = false,
    smtpUser = '',
    smtpPass = '',
    mailFromAddress = '',
    mailFromName = '',
    mailReplyTo = '',
    imapHost = '',
    imapPort = 993,
    imapSecure = false,
    imapUser = '',
    imapPass = '',
    imapMailbox = 'INBOX',
    imapExtraMailboxes = [],
    imapPollCooldownMs = 20_000,
  } = mailConfig;

  if (!Object.prototype.hasOwnProperty.call(runtimeState, 'smtpTransporter')) {
    runtimeState.smtpTransporter = null;
  }
  if (!Object.prototype.hasOwnProperty.call(runtimeState, 'inboundConfirmationMailSyncPromise')) {
    runtimeState.inboundConfirmationMailSyncPromise = null;
  }
  if (!Object.prototype.hasOwnProperty.call(runtimeState, 'inboundConfirmationMailSyncNotBeforeMs')) {
    runtimeState.inboundConfirmationMailSyncNotBeforeMs = 0;
  }
  if (!Object.prototype.hasOwnProperty.call(runtimeState, 'inboundConfirmationMailSyncLastResult')) {
    runtimeState.inboundConfirmationMailSyncLastResult = null;
  }

  function buildConfirmationEmailDraftFallback(appointment, detail = {}) {
    const contact = normalizeString(appointment?.contact || detail?.contact || '') || 'heer/mevrouw';
    const company = normalizeString(appointment?.company || detail?.company || '') || 'uw bedrijf';
    const date = normalizeDateYyyyMmDd(appointment?.date || detail?.date);
    const time = normalizeTimeHhMm(appointment?.time || detail?.time) || '09:00';
    const datetimeLabel = formatDateTimeLabelNl(date, time) || `${date} ${time}`;

    const summary =
      normalizeString(detail?.aiSummary || detail?.callSummary || appointment?.summary || '').trim() ||
      'Bedankt voor het prettige gesprek.';

    return [
      `Onderwerp: Bevestiging afspraak ${company} - ${date || ''} ${time}`.trim(),
      '',
      `Beste ${contact},`,
      '',
      'Bedankt voor het prettige gesprek van vandaag.',
      `Hierbij bevestig ik onze afspraak op ${datetimeLabel}.`,
      '',
      'Korte samenvatting:',
      summary,
      '',
      'Laat het gerust weten als de tijd aangepast moet worden of als er nog aanvullende vragen zijn.',
      '',
      'Met vriendelijke groet,',
      'Softora',
    ].join('\n');
  }

  function getMissingSmtpMailEnv() {
    return [
      !smtpHost ? 'MAIL_SMTP_HOST' : null,
      !smtpUser ? 'MAIL_SMTP_USER' : null,
      !smtpPass ? 'MAIL_SMTP_PASS' : null,
      !mailFromAddress ? 'MAIL_FROM_ADDRESS' : null,
    ].filter(Boolean);
  }

  function isSmtpMailConfigured() {
    return Boolean(
      smtpHost &&
        Number.isFinite(smtpPort) &&
        smtpPort > 0 &&
        smtpUser &&
        smtpPass &&
        mailFromAddress
    );
  }

  function getSmtpTransporter() {
    if (!isSmtpMailConfigured()) return null;
    if (runtimeState.smtpTransporter) return runtimeState.smtpTransporter;

    runtimeState.smtpTransporter = createTransport({
      host: smtpHost,
      port: smtpPort,
      secure: smtpSecure,
      auth: {
        user: smtpUser,
        pass: smtpPass,
      },
    });

    return runtimeState.smtpTransporter;
  }

  function normalizeEmailAddress(value) {
    return normalizeString(String(value || '').trim().toLowerCase());
  }

  function normalizeEmailAddressForMatching(value) {
    const email = normalizeEmailAddress(value);
    if (!email || !email.includes('@')) return '';
    const [localRaw, domainRaw] = email.split('@');
    const local = normalizeString(localRaw);
    const domain = normalizeString(domainRaw);
    if (!local || !domain) return '';

    if (domain === 'gmail.com' || domain === 'googlemail.com') {
      const noPlus = local.split('+')[0];
      const noDots = noPlus.replace(/\./g, '');
      return `${noDots}@gmail.com`;
    }

    return `${local}@${domain}`;
  }

  function isLikelyValidEmail(value) {
    const email = normalizeEmailAddress(value);
    return Boolean(email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email));
  }

  function formatMailFromHeader() {
    const address = normalizeEmailAddress(mailFromAddress);
    if (!address) return '';
    const name = normalizeString(mailFromName || 'Softora');
    return name ? `${name} <${address}>` : address;
  }

  function parseConfirmationDraftToMailParts(draftText, appointment = null) {
    const raw = normalizeString(draftText || '');
    const lines = raw.replace(/\r\n?/g, '\n').split('\n');
    let subject = '';
    let bodyStartIdx = 0;

    for (let i = 0; i < lines.length; i += 1) {
      const line = normalizeString(lines[i]);
      if (!line) continue;
      const match = line.match(/^onderwerp\s*:\s*(.+)$/i);
      if (match) {
        subject = normalizeString(match[1]);
        bodyStartIdx = i + 1;
      } else {
        bodyStartIdx = i;
      }
      break;
    }

    if (!subject) {
      const company = normalizeString(appointment?.company || '') || 'afspraak';
      const date = normalizeDateYyyyMmDd(appointment?.date) || '';
      const time = normalizeTimeHhMm(appointment?.time) || '';
      subject = truncateText(
        `Bevestiging afspraak ${company}${date ? ` - ${date}` : ''}${time ? ` ${time}` : ''}`.trim(),
        200
      );
    }

    const text = lines
      .slice(bodyStartIdx)
      .join('\n')
      .replace(/^\s+/, '')
      .trim();

    return {
      subject: subject || 'Bevestiging afspraak',
      text: text || raw || 'Bedankt voor het gesprek. Hierbij bevestigen wij de afspraak.',
    };
  }

  function getConfirmationTaskReplyReferenceToken(appointment) {
    const taskId = Number(appointment?.id || appointment?.appointmentId || 0);
    if (!Number.isFinite(taskId) || taskId <= 0) return '';
    return `CT-${taskId}`;
  }

  async function sendConfirmationEmailViaSmtp({ appointment, recipientEmail, draftText }) {
    if (!isSmtpMailConfigured()) {
      const error = new Error('SMTP mail is nog niet geconfigureerd op de server.');
      error.code = 'SMTP_NOT_CONFIGURED';
      throw error;
    }

    const toEmail = normalizeEmailAddress(recipientEmail);
    if (!isLikelyValidEmail(toEmail)) {
      const error = new Error('Vul een geldig e-mailadres in voor de ontvanger.');
      error.code = 'INVALID_RECIPIENT_EMAIL';
      throw error;
    }

    const transporter = getSmtpTransporter();
    if (!transporter) {
      const error = new Error('SMTP transporter kon niet worden opgebouwd.');
      error.code = 'SMTP_TRANSPORT_UNAVAILABLE';
      throw error;
    }

    const parts = parseConfirmationDraftToMailParts(draftText, appointment);
    const refToken = getConfirmationTaskReplyReferenceToken(appointment);
    const subject =
      refToken && !new RegExp(`\\b${refToken}\\b`, 'i').test(parts.subject)
        ? `[${refToken}] ${parts.subject}`
        : parts.subject;
    const text =
      refToken && !new RegExp(`\\b${refToken}\\b`, 'i').test(parts.text)
        ? `${parts.text}\n\nReferentie: ${refToken}`
        : parts.text;
    const info = await transporter.sendMail({
      from: formatMailFromHeader(),
      to: toEmail,
      replyTo: mailReplyTo || imapUser || mailFromAddress || undefined,
      subject,
      text,
    });

    return {
      messageId: normalizeString(info?.messageId || ''),
      response: truncateText(normalizeString(info?.response || ''), 500),
      accepted: Array.isArray(info?.accepted) ? info.accepted : [],
      rejected: Array.isArray(info?.rejected) ? info.rejected : [],
      envelope: info?.envelope || null,
    };
  }

  function getMissingImapMailEnv() {
    return [
      !imapHost ? 'MAIL_IMAP_HOST' : null,
      !imapUser ? 'MAIL_IMAP_USER' : null,
      !imapPass ? 'MAIL_IMAP_PASS' : null,
    ].filter(Boolean);
  }

  function isImapMailConfigured() {
    return Boolean(
      imapHost &&
        Number.isFinite(imapPort) &&
        imapPort > 0 &&
        imapUser &&
        imapPass
    );
  }

  function getImapMailboxesForSync() {
    const defaults = ['INBOX', 'Spam', 'Junk', 'INBOX.Spam', 'INBOX.Junk'];
    const combined = [imapMailbox, ...imapExtraMailboxes, ...defaults].filter(Boolean);
    const seen = new Set();
    const out = [];
    for (const mailbox of combined) {
      const key = String(mailbox || '').trim().toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(String(mailbox || '').trim());
    }
    return out;
  }

  function normalizeMessageIdToken(value) {
    return normalizeString(String(value || '').trim()).replace(/[<>]/g, '').toLowerCase();
  }

  function collectMessageIdReferenceTokens(parsedMail) {
    const out = new Set();
    const add = (value) => {
      if (!value) return;
      if (Array.isArray(value)) {
        value.forEach(add);
        return;
      }
      String(value || '')
        .split(/\s+/)
        .map(normalizeMessageIdToken)
        .filter(Boolean)
        .forEach((token) => out.add(token));
    };

    add(parsedMail?.inReplyTo);
    add(parsedMail?.references);
    try {
      const refsHeader = parsedMail?.headers?.get?.('references');
      add(refsHeader);
    } catch (_) {}

    return out;
  }

  function getParsedMailFromEmail(parsedMail) {
    const fromList = Array.isArray(parsedMail?.from?.value) ? parsedMail.from.value : [];
    const first = fromList.find((entry) => normalizeEmailAddress(entry?.address || ''));
    return {
      address: normalizeEmailAddress(first?.address || ''),
      name: normalizeString(first?.name || ''),
    };
  }

  function normalizeInboundReplyTextForDecision(textValue) {
    const raw = String(textValue || '').replace(/\r\n?/g, '\n').trim();
    if (!raw) return '';

    let text = raw;
    const splitPatterns = [
      /\n[-_]{2,}\s*oorspronkelijk bericht\s*[-_]{2,}/i,
      /\non .+ wrote:/i,
      /\nop .+ schreef .+:/i,
      /\nvan:\s.+/i,
    ];
    for (const pattern of splitPatterns) {
      const match = text.match(pattern);
      if (match && Number.isFinite(match.index)) {
        text = text.slice(0, match.index);
      }
    }

    const cleanedLines = text
      .split('\n')
      .map((line) => String(line || '').trim())
      .filter((line) => line && !line.startsWith('>'))
      .filter((line) => !/^(from|to|subject|onderwerp|sent|verzonden|cc):/i.test(line));

    return cleanedLines.join('\n').trim();
  }

  function detectInboundConfirmationDecision(parsedMail) {
    const subject = normalizeString(parsedMail?.subject || '');
    const bodyText = normalizeInboundReplyTextForDecision(parsedMail?.text || parsedMail?.html || '');
    const full = `${subject}\n${bodyText}`.toLowerCase();

    const cancelPatterns = [
      /\b(annuleer|annuleren|geannuleerd|afzeggen|afgezegd|kan niet doorgaan|gaat niet door)\b/i,
      /\b(niet akkoord|niet goed|komt niet uit)\b/i,
    ];
    if (cancelPatterns.some((pattern) => pattern.test(full))) {
      return { decision: 'cancel', reason: 'negative_reply', bodyText };
    }

    const positivePatterns = [
      /\bbevestig(?:\s+ik)?\b/i,
      /\bbevestigd\b/i,
      /\bakkoord\b/i,
      /\bklopt\b/i,
      /\bgaat door\b/i,
      /\bprima\b/i,
      /\bis goed\b/i,
      /^\s*ja[\s!.,]*$/i,
      /\bja[, ]/i,
    ];
    if (positivePatterns.some((pattern) => pattern.test(full))) {
      return { decision: 'confirm', reason: 'positive_reply', bodyText };
    }

    return { decision: '', reason: 'undetermined', bodyText };
  }

  function findAppointmentIndexBySentMessageIdReference(refTokens) {
    if (!refTokens || !refTokens.size) return -1;
    for (let i = 0; i < generatedAgendaAppointments.length; i += 1) {
      const appt = generatedAgendaAppointments[i];
      if (!appt || !mapAppointmentToConfirmationTask(appt)) continue;
      const sentId = normalizeMessageIdToken(appt.confirmationEmailLastSentMessageId || '');
      if (!sentId) continue;
      if (refTokens.has(sentId)) return i;
    }
    return -1;
  }

  function findAppointmentIndexForInboundConfirmationMail(parsedMail, decisionInfo = null) {
    const subject = normalizeString(parsedMail?.subject || '');
    const text = normalizeString(parsedMail?.text || '');
    const combined = `${subject}\n${text}`;

    const refMatch = combined.match(/\bCT-(\d{3,})\b/i);
    if (refMatch) {
      const idx = getGeneratedAppointmentIndexById(refMatch[1]);
      if (idx >= 0) return idx;
    }

    const refTokens = collectMessageIdReferenceTokens(parsedMail);
    const byMsgRefIdx = findAppointmentIndexBySentMessageIdReference(refTokens);
    if (byMsgRefIdx >= 0) return byMsgRefIdx;

    const from = getParsedMailFromEmail(parsedMail);
    if (from.address) {
      const normalizedFrom = normalizeEmailAddressForMatching(from.address);
      const candidates = generatedAgendaAppointments
        .map((appt, idx) => ({ appt, idx }))
        .filter(({ appt }) => appt && mapAppointmentToConfirmationTask(appt))
        .filter(({ appt }) => {
          const candidateEmail = normalizeEmailAddressForMatching(appt.contactEmail || appt.email || '');
          return Boolean(candidateEmail && normalizedFrom && candidateEmail === normalizedFrom);
        });
      if (candidates.length === 1) return candidates[0].idx;
    }

    const decision = normalizeString(decisionInfo?.decision || '');
    if (decision === 'confirm' || decision === 'cancel') {
      const fallbackCandidates = generatedAgendaAppointments
        .map((appt, idx) => ({ appt, idx }))
        .filter(({ appt }) => appt && mapAppointmentToConfirmationTask(appt))
        .filter(({ appt }) => Boolean(appt.confirmationEmailSent || appt.confirmationEmailSentAt))
        .filter(({ appt }) => {
          const sentAt = Date.parse(normalizeString(appt.confirmationEmailSentAt || ''));
          if (!Number.isFinite(sentAt)) return true;
          const maxAgeMs = 14 * 24 * 60 * 60 * 1000;
          return Date.now() - sentAt <= maxAgeMs;
        })
        .sort((a, b) => {
          const aTs = Date.parse(normalizeString(a.appt?.confirmationEmailSentAt || '')) || 0;
          const bTs = Date.parse(normalizeString(b.appt?.confirmationEmailSentAt || '')) || 0;
          return bTs - aTs;
        });

      if (fallbackCandidates.length === 1) {
        return fallbackCandidates[0].idx;
      }
    }

    return -1;
  }

  function applyInboundMailDecisionToAppointment(idx, decision, metadata = {}) {
    if (!Number.isInteger(idx) || idx < 0 || idx >= generatedAgendaAppointments.length) {
      return { ok: false, changed: false, reason: 'not_found' };
    }
    const appointment = generatedAgendaAppointments[idx];
    if (!appointment || !mapAppointmentToConfirmationTask(appointment)) {
      return { ok: false, changed: false, reason: 'no_open_task' };
    }

    const actor = 'Klant reply e-mail (IMAP)';
    const nowIso = new Date().toISOString();
    const inboundFrom = normalizeEmailAddress(metadata.fromEmail || '');
    const inboundSubject = truncateText(normalizeString(metadata.subject || ''), 220);

    if (decision === 'confirm') {
      if (appointment.confirmationResponseReceived || appointment.confirmationResponseReceivedAt) {
        return { ok: true, changed: false, reason: 'already_confirmed' };
      }
      const updated = setGeneratedAgendaAppointmentAtIndex(
        idx,
        {
          ...appointment,
          contactEmail: inboundFrom || normalizeEmailAddress(appointment.contactEmail || '') || null,
          confirmationEmailSent: Boolean(appointment.confirmationEmailSent || appointment.confirmationEmailSentAt),
          confirmationEmailSentAt: normalizeString(appointment.confirmationEmailSentAt || '') || nowIso,
          confirmationEmailSentBy: normalizeString(appointment.confirmationEmailSentBy || '') || 'SMTP',
          confirmationResponseReceived: true,
          confirmationResponseReceivedAt: nowIso,
          confirmationResponseReceivedBy: actor,
          confirmationAppointmentCancelled: false,
          confirmationAppointmentCancelledAt: null,
          confirmationAppointmentCancelledBy: null,
          confirmationEmailLastError: null,
        },
        'confirmation_task_imap_reply_confirm'
      );
      appendDashboardActivity(
        {
          type: 'appointment_confirmed_by_mail',
          title: 'Afspraak bevestigd per mail',
          detail: inboundSubject ? `Reply verwerkt: ${inboundSubject}` : 'Klantreply via mailbox verwerkt.',
          company: updated?.company || appointment?.company || '',
          actor,
          taskId: Number(updated?.id || appointment?.id || 0) || null,
          callId: normalizeString(updated?.callId || appointment?.callId || ''),
          source: 'imap-mailbox-sync',
        },
        'dashboard_activity_imap_confirm'
      );
      return { ok: true, changed: true, status: 'confirmed', appointment: updated };
    }

    if (decision === 'cancel') {
      if (appointment.confirmationAppointmentCancelled || appointment.confirmationAppointmentCancelledAt) {
        return { ok: true, changed: false, reason: 'already_cancelled' };
      }
      const updated = setGeneratedAgendaAppointmentAtIndex(
        idx,
        {
          ...appointment,
          contactEmail: inboundFrom || normalizeEmailAddress(appointment.contactEmail || '') || null,
          confirmationEmailSent: Boolean(appointment.confirmationEmailSent || appointment.confirmationEmailSentAt),
          confirmationEmailSentAt: normalizeString(appointment.confirmationEmailSentAt || '') || nowIso,
          confirmationEmailSentBy: normalizeString(appointment.confirmationEmailSentBy || '') || 'SMTP',
          confirmationResponseReceived: false,
          confirmationResponseReceivedAt: null,
          confirmationResponseReceivedBy: null,
          confirmationAppointmentCancelled: true,
          confirmationAppointmentCancelledAt: nowIso,
          confirmationAppointmentCancelledBy: actor,
          confirmationEmailLastError: null,
        },
        'confirmation_task_imap_reply_cancel'
      );
      appendDashboardActivity(
        {
          type: 'appointment_cancelled',
          title: 'Afspraak geannuleerd',
          detail: inboundSubject ? `Reply verwerkt: ${inboundSubject}` : 'Klantreply via mailbox verwerkt.',
          company: updated?.company || appointment?.company || '',
          actor,
          taskId: Number(updated?.id || appointment?.id || 0) || null,
          callId: normalizeString(updated?.callId || appointment?.callId || ''),
          source: 'imap-mailbox-sync',
        },
        'dashboard_activity_imap_cancel'
      );
      return { ok: true, changed: true, status: 'cancelled', appointment: updated };
    }

    return { ok: false, changed: false, reason: 'no_decision' };
  }

  async function syncInboundConfirmationEmailsFromImap(options = {}) {
    const force = Boolean(options?.force);
    const maxMessages = Math.max(10, Math.min(400, Number(options?.maxMessages || 120) || 120));

    if (!isImapMailConfigured()) {
      return {
        ok: false,
        skipped: true,
        reason: 'imap_not_configured',
        missingEnv: getMissingImapMailEnv(),
      };
    }

    if (!force && Date.now() < runtimeState.inboundConfirmationMailSyncNotBeforeMs) {
      return runtimeState.inboundConfirmationMailSyncLastResult || {
        ok: true,
        skipped: true,
        reason: 'cooldown',
      };
    }
    if (runtimeState.inboundConfirmationMailSyncPromise) {
      return runtimeState.inboundConfirmationMailSyncPromise;
    }

    runtimeState.inboundConfirmationMailSyncPromise = (async () => {
      const stats = {
        ok: true,
        startedAt: new Date().toISOString(),
        mailbox: imapMailbox,
        mailboxes: getImapMailboxesForSync(),
        unseenFound: 0,
        scanned: 0,
        matched: 0,
        confirmed: 0,
        cancelled: 0,
        markedSeen: 0,
        ignored: 0,
        errors: [],
      };

      const client = createImapClient({
        host: imapHost,
        port: imapPort,
        secure: imapSecure,
        auth: {
          user: imapUser,
          pass: imapPass,
        },
        logger: false,
      });

      try {
        await client.connect();
        const mailboxList = getImapMailboxesForSync();
        for (const mailboxName of mailboxList) {
          let lock = null;
          try {
            lock = await client.getMailboxLock(mailboxName);
            const unseenUids = await client.search(['UNSEEN']);
            const allUids = await client.search(['ALL']);
            stats.unseenFound += Array.isArray(unseenUids) ? unseenUids.length : 0;

            const selectedUidSet = new Set();
            if (Array.isArray(allUids) && allUids.length) {
              allUids.slice(-maxMessages).forEach((uid) => selectedUidSet.add(uid));
            }
            if (Array.isArray(unseenUids) && unseenUids.length) {
              unseenUids.slice(-maxMessages).forEach((uid) => selectedUidSet.add(uid));
            }
            const selectedUids = Array.from(selectedUidSet).sort((a, b) => a - b);
            const uidsToMarkSeen = [];

            if (selectedUids.length) {
              for await (const message of client.fetch(
                selectedUids,
                {
                  uid: true,
                  source: true,
                  envelope: true,
                  internalDate: true,
                  flags: true,
                },
                { uid: true }
              )) {
                stats.scanned += 1;
                let parsedMail = null;
                try {
                  parsedMail = await parseMailSource(message.source);
                } catch (error) {
                  stats.errors.push(
                    `Parse error mailbox=${mailboxName} uid=${message.uid}: ${truncateText(error?.message || String(error), 120)}`
                  );
                  continue;
                }

                const decision = detectInboundConfirmationDecision(parsedMail);
                const idx = findAppointmentIndexForInboundConfirmationMail(parsedMail, decision);
                if (idx < 0) {
                  stats.ignored += 1;
                  continue;
                }

                stats.matched += 1;
                const from = getParsedMailFromEmail(parsedMail);
                const result = applyInboundMailDecisionToAppointment(idx, decision.decision, {
                  fromEmail: from.address,
                  subject: normalizeString(parsedMail?.subject || ''),
                  bodyText: decision.bodyText,
                });

                if (result.changed && result.status === 'confirmed') stats.confirmed += 1;
                if (result.changed && result.status === 'cancelled') stats.cancelled += 1;

                const flagsSet =
                  message.flags instanceof Set
                    ? message.flags
                    : new Set(Array.isArray(message.flags) ? message.flags : []);
                const alreadySeen = flagsSet.has('\\Seen');
                if (!alreadySeen) {
                  uidsToMarkSeen.push(message.uid);
                }
              }
            }

            if (uidsToMarkSeen.length) {
              await client.messageFlagsAdd(uidsToMarkSeen, ['\\Seen'], { uid: true });
              stats.markedSeen += uidsToMarkSeen.length;
            }
          } catch (error) {
            stats.errors.push(`Mailbox ${mailboxName}: ${truncateText(error?.message || String(error), 180)}`);
          } finally {
            try {
              if (lock) lock.release();
            } catch (_) {}
          }
        }
      } catch (error) {
        stats.ok = false;
        stats.error = truncateText(error?.message || String(error), 500);
      } finally {
        try {
          if (client.usable) await client.logout();
        } catch (_) {}
        runtimeState.inboundConfirmationMailSyncNotBeforeMs = Date.now() + imapPollCooldownMs;
        stats.finishedAt = new Date().toISOString();
        runtimeState.inboundConfirmationMailSyncLastResult = stats;
        runtimeState.inboundConfirmationMailSyncPromise = null;
      }

      return stats;
    })();

    return runtimeState.inboundConfirmationMailSyncPromise;
  }

  return {
    buildConfirmationEmailDraftFallback,
    getMailRuntimeState: () => runtimeState,
    getMissingImapMailEnv,
    getMissingSmtpMailEnv,
    isImapMailConfigured,
    isLikelyValidEmail,
    isSmtpMailConfigured,
    normalizeEmailAddress,
    sendConfirmationEmailViaSmtp,
    syncInboundConfirmationEmailsFromImap,
  };
}

module.exports = {
  createConfirmationMailService,
};
