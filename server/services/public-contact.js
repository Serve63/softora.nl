const nodemailer = require('nodemailer');

function defaultNormalizeString(value) {
  return String(value || '').trim();
}

function defaultTruncateText(value, maxLength = 500) {
  return String(value || '').slice(0, maxLength);
}

function normalizeEmailAddress(value) {
  return defaultNormalizeString(value).toLowerCase();
}

function isLikelyValidEmail(value) {
  const email = normalizeEmailAddress(value);
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email);
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function createHttpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function createPublicContactService(deps = {}) {
  const {
    mailConfig = {},
    contactToEmail = 'info@softora.nl',
    logger = console,
    normalizeString = defaultNormalizeString,
    truncateText = defaultTruncateText,
    createTransport = (config) => nodemailer.createTransport(config),
    now = () => new Date(),
  } = deps;

  const smtpHost = normalizeString(mailConfig.smtpHost);
  const smtpPort = Number(mailConfig.smtpPort) || 587;
  const smtpSecure = Boolean(mailConfig.smtpSecure);
  const smtpUser = normalizeString(mailConfig.smtpUser);
  const smtpPass = normalizeString(mailConfig.smtpPass);
  const mailFromAddress = normalizeEmailAddress(
    mailConfig.mailFromAddress || mailConfig.fromAddress || smtpUser
  );
  const mailFromName = normalizeString(mailConfig.mailFromName || mailConfig.fromName || 'Softora');
  const recipientEmail = normalizeEmailAddress(contactToEmail || 'info@softora.nl');
  let smtpTransporter = null;

  function isSmtpConfigured() {
    return Boolean(
      smtpHost &&
        Number.isFinite(smtpPort) &&
        smtpPort > 0 &&
        smtpUser &&
        smtpPass &&
        mailFromAddress &&
        isLikelyValidEmail(recipientEmail)
    );
  }

  function getMissingSmtpConfig() {
    return [
      !smtpHost ? 'MAIL_SMTP_HOST' : null,
      !smtpUser ? 'MAIL_SMTP_USER' : null,
      !smtpPass ? 'MAIL_SMTP_PASS' : null,
      !mailFromAddress ? 'MAIL_FROM_ADDRESS' : null,
      !isLikelyValidEmail(recipientEmail) ? 'PUBLIC_CONTACT_TO_EMAIL' : null,
    ].filter(Boolean);
  }

  function getTransporter() {
    if (!isSmtpConfigured()) return null;
    if (smtpTransporter) return smtpTransporter;
    smtpTransporter = createTransport({
      host: smtpHost,
      port: smtpPort,
      secure: smtpSecure,
      auth: { user: smtpUser, pass: smtpPass },
    });
    return smtpTransporter;
  }

  function sanitizeField(value, maxLength) {
    return truncateText(normalizeString(value), maxLength).replace(/\r/g, '');
  }

  function validateContactPayload(payload = {}) {
    const name = sanitizeField(payload.name, 120);
    const email = normalizeEmailAddress(payload.email);
    const phone = sanitizeField(payload.phone || payload.telephone || payload.telefoon, 80);
    const message = sanitizeField(payload.message || payload.bericht || payload.question, 4000);
    const page = sanitizeField(payload.page || payload.source || '', 240);

    if (name.length < 2) {
      throw createHttpError(400, 'Vul je naam in.');
    }
    if (!isLikelyValidEmail(email)) {
      throw createHttpError(400, 'Vul een geldig e-mailadres in.');
    }
    if (message.length < 5) {
      throw createHttpError(400, 'Vul je vraag of bericht in.');
    }

    return { name, email, phone, message, page };
  }

  function buildPlainTextEmail(contact, meta = {}) {
    return [
      'Nieuwe contactaanvraag via Softora.nl',
      '',
      `Naam: ${contact.name}`,
      `E-mail: ${contact.email}`,
      contact.phone ? `Telefoonnummer: ${contact.phone}` : null,
      contact.page ? `Pagina: ${contact.page}` : null,
      meta.ip ? `IP-adres: ${meta.ip}` : null,
      `Ontvangen op: ${now().toISOString()}`,
      '',
      'Bericht:',
      contact.message,
      '',
    ]
      .filter((line) => line !== null)
      .join('\n');
  }

  function buildHtmlEmail(contact, meta = {}) {
    const rows = [
      ['Naam', contact.name],
      ['E-mail', contact.email],
      contact.phone ? ['Telefoonnummer', contact.phone] : null,
      contact.page ? ['Pagina', contact.page] : null,
      meta.ip ? ['IP-adres', meta.ip] : null,
      ['Ontvangen op', now().toISOString()],
    ].filter(Boolean);

    const rowHtml = rows
      .map(
        ([label, value]) =>
          `<tr><td style="padding:6px 12px 6px 0;color:#7b7888;font-weight:700;">${escapeHtml(
            label
          )}</td><td style="padding:6px 0;color:#17172a;">${escapeHtml(value)}</td></tr>`
      )
      .join('');

    return [
      '<div style="font-family:Arial,sans-serif;line-height:1.55;color:#17172a;">',
      '<h2 style="margin:0 0 16px;font-size:22px;">Nieuwe contactaanvraag via Softora.nl</h2>',
      `<table style="border-collapse:collapse;margin-bottom:18px;">${rowHtml}</table>`,
      '<div style="border-top:1px solid #e8e5e0;padding-top:16px;">',
      '<strong>Bericht</strong>',
      `<p style="white-space:pre-wrap;margin:8px 0 0;">${escapeHtml(contact.message)}</p>`,
      '</div>',
      '</div>',
    ].join('');
  }

  async function sendContactRequest(payload = {}, meta = {}) {
    const contact = validateContactPayload(payload);
    const transporter = getTransporter();
    if (!transporter) {
      throw createHttpError(
        503,
        `Mailserver is niet geconfigureerd (${getMissingSmtpConfig().join(', ')}).`
      );
    }

    const info = await transporter.sendMail({
      from: mailFromName ? `${mailFromName} <${mailFromAddress}>` : mailFromAddress,
      to: recipientEmail,
      replyTo: contact.email,
      subject: `Nieuwe contactaanvraag via Softora.nl - ${contact.name}`,
      text: buildPlainTextEmail(contact, meta),
      html: buildHtmlEmail(contact, meta),
    });

    return {
      messageId: normalizeString(info?.messageId || ''),
      accepted: Array.isArray(info?.accepted) ? info.accepted : [],
      rejected: Array.isArray(info?.rejected) ? info.rejected : [],
    };
  }

  async function submitResponse(req, res) {
    try {
      const body = req.body && typeof req.body === 'object' ? req.body : {};
      const result = await sendContactRequest(body, {
        ip: normalizeString(req.ip || req.headers?.['x-forwarded-for'] || ''),
      });
      return res.status(200).json({
        ok: true,
        message: 'Bericht verstuurd.',
        result,
      });
    } catch (error) {
      logger.error('[PublicContact][Send]', error?.message || error);
      return res.status(error.status || 500).json({
        ok: false,
        error:
          error.status && error.status < 500
            ? error.message
            : 'Bericht verzenden mislukt. Probeer het later opnieuw.',
      });
    }
  }

  return {
    isSmtpConfigured,
    getMissingSmtpConfig,
    validateContactPayload,
    sendContactRequest,
    submitResponse,
  };
}

module.exports = {
  createPublicContactService,
};
