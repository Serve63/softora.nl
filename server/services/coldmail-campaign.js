const nodemailer = require('nodemailer');
const dns = require('node:dns').promises;

const DEFAULT_CUSTOMER_DB_SCOPE = 'premium_customers_database';
const DEFAULT_CUSTOMER_DB_KEY = 'softora_customers_premium_v1';
const EXCLUDED_DATABASE_STATUSES = new Set([
  'gemaild',
  'interesse',
  'afspraak',
  'klant',
  'afgehaakt',
  'geblokkeerd',
  'buiten',
]);

async function resolveEmailDomainWithDns(domain) {
  const value = String(domain || '').trim().toLowerCase();
  if (!value) return false;
  try {
    const mxRecords = await dns.resolveMx(value);
    if (Array.isArray(mxRecords) && mxRecords.length) return true;
  } catch (error) {
    if (error && error.code !== 'ENODATA' && error.code !== 'ENOTFOUND') throw error;
  }
  try {
    const addresses = await dns.resolve4(value);
    if (Array.isArray(addresses) && addresses.length) return true;
  } catch (error) {
    if (error && error.code !== 'ENODATA' && error.code !== 'ENOTFOUND') throw error;
  }
  try {
    const addresses = await dns.resolve6(value);
    return Array.isArray(addresses) && addresses.length > 0;
  } catch (error) {
    if (error && error.code !== 'ENODATA' && error.code !== 'ENOTFOUND') throw error;
    return false;
  }
}

function createColdmailCampaignService(deps = {}) {
  const {
    mailConfig = {},
    getUiStateValues = async () => ({ values: {} }),
    setUiStateValues = async () => null,
    customerDbScope = DEFAULT_CUSTOMER_DB_SCOPE,
    customerDbKey = DEFAULT_CUSTOMER_DB_KEY,
    createTransport = (config) => nodemailer.createTransport(config),
    resolveEmailDomain = resolveEmailDomainWithDns,
    normalizeString = (value) => String(value || '').trim(),
    truncateText = (value, maxLength = 500) => String(value || '').slice(0, maxLength),
    now = () => new Date(),
  } = deps;

  const {
    smtpHost = '',
    smtpPort = 587,
    smtpSecure = false,
    smtpUser = '',
    smtpPass = '',
    mailFromAddress = '',
    mailFromName = 'Softora',
    mailReplyTo = '',
  } = mailConfig;

  let smtpTransporter = null;

  function normalizeEmailAddress(value) {
    return normalizeString(value).toLowerCase();
  }

  function isLikelyValidEmail(value) {
    const email = normalizeEmailAddress(value);
    return Boolean(email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email));
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
        Number.isFinite(Number(smtpPort)) &&
        Number(smtpPort) > 0 &&
        smtpUser &&
        smtpPass &&
        mailFromAddress
    );
  }

  function getSmtpTransporter() {
    if (!isSmtpMailConfigured()) return null;
    if (smtpTransporter) return smtpTransporter;
    smtpTransporter = createTransport({
      host: smtpHost,
      port: Number(smtpPort),
      secure: Boolean(smtpSecure),
      auth: {
        user: smtpUser,
        pass: smtpPass,
      },
    });
    return smtpTransporter;
  }

  function normalizeDatabaseStatus(value, row = {}) {
    const raw = normalizeString(value).toLowerCase();
    if (raw === 'interested' || raw === 'geinteresseerd' || raw === 'geïnteresseerd') {
      return 'interesse';
    }
    if (raw === 'no_deal' || raw === 'geendeal' || raw === 'lost') return 'afgehaakt';
    if (raw === 'betaald') return 'klant';
    if (raw === 'open') return 'benaderbaar';
    if (normalizeString(row.actief).toLowerCase() === 'nee') return 'buiten';
    return raw || 'prospect';
  }

  function parseDatabaseRows(values = {}) {
    const raw = normalizeString(values && values[customerDbKey]);
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.filter((row) => row && typeof row === 'object') : [];
    } catch (_) {
      return [];
    }
  }

  function getRowId(row, index) {
    return normalizeString(row.id || row.customerId || row.databaseId || '') || `row-${index}`;
  }

  function getRowCompany(row) {
    return normalizeString(row.bedrijf || row.company || row.companyName || row.naam || row.name);
  }

  function getRowContact(row) {
    return normalizeString(row.naam || row.contact || row.contactName || row.clientName) || getRowCompany(row);
  }

  function getRowDomain(row) {
    return normalizeString(row.dom || row.domain || row.website || '');
  }

  function getRowEmail(row) {
    return normalizeEmailAddress(row.email || row.contactEmail || row.mail || '');
  }

  function getEmailDomain(email) {
    const normalized = normalizeEmailAddress(email);
    const parts = normalized.split('@');
    return parts.length === 2 ? parts[1] : '';
  }

  function getAllowedSenderEmails() {
    return Array.from(
      new Set(
        [
          mailFromAddress,
          smtpUser,
          'info@softora.nl',
          'zakelijk@softora.nl',
          'ruben@softora.nl',
          'serve@softora.nl',
          'martijn@softora.nl',
        ]
          .map(normalizeEmailAddress)
          .filter(isLikelyValidEmail)
      )
    );
  }

  function assertSenderAllowed(senderEmail) {
    const selected = normalizeEmailAddress(senderEmail || mailFromAddress);
    const allowed = getAllowedSenderEmails();
    if (!selected || !allowed.length || allowed.includes(selected)) return selected || allowed[0] || '';
    const error = new Error('Dit afzenderadres is nog niet gekoppeld aan de server.');
    error.code = 'SENDER_NOT_ALLOWED';
    error.allowedSenderEmails = allowed;
    throw error;
  }

  function formatMailFromHeader(senderEmail) {
    const address = normalizeEmailAddress(senderEmail || mailFromAddress);
    const name = normalizeString(mailFromName || 'Softora');
    return name ? `${name} <${address}>` : address;
  }

  function parsePositiveInt(value, fallback, min, max) {
    const parsed = Number.parseInt(String(value || ''), 10);
    const safe = Number.isFinite(parsed) ? parsed : fallback;
    return Math.max(min, Math.min(max, safe));
  }

  function matchesBranch(row, branchFilter) {
    const filter = normalizeString(branchFilter).toLowerCase();
    if (!filter) return true;
    return normalizeString(row.branche || row.branch || '').toLowerCase() === filter;
  }

  function isEligibleColdmailRow(row, branchFilter) {
    const email = getRowEmail(row);
    if (!isLikelyValidEmail(email)) return false;
    if (row.mail === false || row.canMail === false || row.doNotMail === true) return false;
    if (!matchesBranch(row, branchFilter)) return false;
    const status = normalizeDatabaseStatus(row.databaseStatus || row.status, row);
    return !EXCLUDED_DATABASE_STATUSES.has(status);
  }

  async function isDeliverableEmailDomain(email) {
    const domain = getEmailDomain(email);
    if (!domain) return false;
    return Boolean(await resolveEmailDomain(domain));
  }

  async function resolveColdmailRecipients(input = {}) {
    const count = parsePositiveInt(input.count, 10, 1, 500);
    const state = await getUiStateValues(customerDbScope);
    const values = state && typeof state.values === 'object' ? state.values : {};
    const rows = parseDatabaseRows(values);
    const candidateRows = rows
      .map((row, index) => ({ row, index, id: getRowId(row, index) }))
      .filter(({ row }) => isEligibleColdmailRow(row, input.branch))
      .slice(0, count);
    const selectedRows = [];
    const failed = [];

    for (const item of candidateRows) {
      const email = getRowEmail(item.row);
      if (await isDeliverableEmailDomain(email)) {
        selectedRows.push(item);
      } else {
        failed.push({
          id: item.id,
          bedrijf: getRowCompany(item.row),
          email,
          error: `E-maildomein bestaat niet of ontvangt geen mail: ${getEmailDomain(email) || email}`,
        });
      }
    }

    return {
      count,
      values,
      rows,
      candidateRows,
      selectedRows,
      failed,
    };
  }

  async function getColdmailCampaignRecipients(input = {}) {
    const resolved = await resolveColdmailRecipients(input);
    return {
      ok: true,
      requested: resolved.count,
      candidates: resolved.candidateRows.length,
      selected: resolved.selectedRows.length,
      recipients: resolved.selectedRows.map((item) => ({
        id: item.id,
        bedrijf: getRowCompany(item.row),
        email: getRowEmail(item.row),
      })),
      failedItems: resolved.failed,
    };
  }

  function personalizeTemplate(template, row) {
    const company = getRowCompany(row) || 'uw bedrijf';
    const contact = getRowContact(row) || company;
    const domain = getRowDomain(row);
    return normalizeString(template)
      .replace(/\{\{\s*bedrijf\s*\}\}/gi, company)
      .replace(/\{\{\s*naam\s*\}\}/gi, contact)
      .replace(/\{\{\s*domein\s*\}\}/gi, domain || company)
      .replace(/\{\{\s*website\s*\}\}/gi, domain || company);
  }

  function buildMailText(body, row) {
    return personalizeTemplate(body, row)
      .replace(/\r\n?/g, '\n')
      .replace(/[ \t]+\n/g, '\n')
      .trim();
  }

  function toHtml(text) {
    return normalizeString(text)
      .split(/\n{2,}/)
      .map((paragraph) =>
        `<p>${paragraph
          .split('\n')
          .map((line) =>
            normalizeString(line)
              .replace(/&/g, '&amp;')
              .replace(/</g, '&lt;')
              .replace(/>/g, '&gt;')
          )
          .join('<br>')}</p>`
      )
      .join('\n');
  }

  function addDaysIso(date, days) {
    const next = new Date(date.getTime());
    next.setUTCDate(next.getUTCDate() + days);
    return next.toISOString();
  }

  function markRowAsMailed(row, actor, durationDays) {
    const date = now().toISOString();
    const safeDurationDays = parsePositiveInt(durationDays, 14, 1, 90);
    const campaignEndsAt = addDaysIso(new Date(date), safeDurationDays);
    const existingHistory = Array.isArray(row.hist) ? row.hist : [];
    return {
      ...row,
      status: 'gemaild',
      databaseStatus: 'gemaild',
      mail: true,
      lastMailSentAt: date,
      lastColdmailSentAt: date,
      coldmailCampaignStartedAt: date,
      coldmailCampaignDurationDays: safeDurationDays,
      coldmailCampaignEndsAt: campaignEndsAt,
      activeColdmailCampaignUntil: campaignEndsAt,
      updatedAt: date.slice(0, 10),
      hist: [
        {
          type: 'gemaild',
          label: 'Mail verstuurd',
          date: date.slice(0, 10),
          actor: normalizeString(actor) || 'Coldmailing',
        },
        ...existingHistory,
      ],
    };
  }

  async function sendColdmailCampaign(input = {}) {
    if (!isSmtpMailConfigured()) {
      const error = new Error('Mail is nog niet gekoppeld. Vul eerst de SMTP-gegevens op de server in.');
      error.code = 'SMTP_NOT_CONFIGURED';
      error.missing = getMissingSmtpMailEnv();
      throw error;
    }

    const senderEmail = assertSenderAllowed(input.senderEmail);
    const subjectTemplate = truncateText(normalizeString(input.subject), 200);
    const bodyTemplate = normalizeString(input.body);
    if (!subjectTemplate || !bodyTemplate) {
      const error = new Error('Vul eerst een onderwerp en mailtekst in.');
      error.code = 'EMPTY_MAIL_CONTENT';
      throw error;
    }

    const resolvedRecipients = await resolveColdmailRecipients(input);
    const count = resolvedRecipients.count;
    const values = resolvedRecipients.values;
    const rows = resolvedRecipients.rows;
    const candidateRows = resolvedRecipients.candidateRows;

    if (!candidateRows.length) {
      const error = new Error('Geen geschikte e-mailadressen gevonden in de database.');
      error.code = 'NO_RECIPIENTS';
      throw error;
    }

    const selectedRows = resolvedRecipients.selectedRows;
    const failed = resolvedRecipients.failed;

    if (!selectedRows.length) {
      const firstFailure = failed[0] && failed[0].error ? failed[0].error : '';
      const error = new Error(firstFailure || 'Geen geldige e-maildomeinen gevonden in de database.');
      error.code = 'NO_VALID_RECIPIENT_DOMAINS';
      error.failedItems = failed;
      throw error;
    }

    const transporter = getSmtpTransporter();
    const sent = [];
    const sentRowIds = new Set();

    for (const item of selectedRows) {
      const row = item.row;
      const to = getRowEmail(row);
      const text = buildMailText(bodyTemplate, row);
      const subject = personalizeTemplate(subjectTemplate, row);
      try {
        const info = await transporter.sendMail({
          from: formatMailFromHeader(senderEmail),
          to,
          bcc: senderEmail || undefined,
          replyTo: mailReplyTo || mailFromAddress || undefined,
          subject,
          text,
          html: toHtml(text),
        });
        sent.push({
          id: item.id,
          bedrijf: getRowCompany(row),
          email: to,
          messageId: normalizeString(info && info.messageId),
          response: truncateText(normalizeString(info && info.response), 500),
        });
        sentRowIds.add(item.id);
      } catch (error) {
        failed.push({
          id: item.id,
          bedrijf: getRowCompany(row),
          email: to,
          error: truncateText(normalizeString(error && error.message), 500),
        });
      }
    }

    if (!sent.length && failed.length) {
      const firstFailure = failed[0] && failed[0].error ? failed[0].error : '';
      const error = new Error(firstFailure ? `Geen mails verzonden: ${firstFailure}` : 'Geen mails verzonden.');
      error.code = 'SMTP_SEND_FAILED';
      error.failedItems = failed;
      throw error;
    }

    if (sent.length) {
      const actor = normalizeString(input.actor || 'Coldmailing');
      const updatedRows = rows.map((row, index) =>
        sentRowIds.has(getRowId(row, index)) ? markRowAsMailed(row, actor, input.durationDays) : row
      );
      await setUiStateValues(
        customerDbScope,
        {
          ...values,
          [customerDbKey]: JSON.stringify(updatedRows),
        },
        {
          source: 'coldmail-campaign',
          actor,
        }
      );
    }

    return {
      ok: true,
      requested: count,
      selected: selectedRows.length,
      sent: sent.length,
      failed: failed.length,
      senderEmail,
      specialAction: normalizeString(input.specialAction || ''),
      sentItems: sent,
      failedItems: failed,
    };
  }

  return {
    getAllowedSenderEmails,
    getMissingSmtpMailEnv,
    isSmtpMailConfigured,
    isLikelyValidEmail,
    getColdmailCampaignRecipients,
    sendColdmailCampaign,
  };
}

module.exports = {
  createColdmailCampaignService,
  DEFAULT_CUSTOMER_DB_KEY,
  DEFAULT_CUSTOMER_DB_SCOPE,
};
