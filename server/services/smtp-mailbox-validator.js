const crypto = require('node:crypto');
const dns = require('node:dns').promises;
const net = require('node:net');
const tls = require('node:tls');

const DEFAULT_TIMEOUT_MS = 12000;
const INVALID_RECIPIENT_PATTERN =
  /\b(5\.1\.(?:0|1|3|10)|user unknown|unknown user|no such user|no such mailbox|mailbox (?:does not exist|not found)|recipient (?:unknown|not found|does not exist)|unknown local part|invalid recipient|address rejected: user unknown)\b/i;

function normalizeEmailAddress(value) {
  const email = String(value || '').trim().toLowerCase();
  return /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+$/i.test(email)
    ? email
    : '';
}

function truncate(value, maxLength = 500) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

function createReplyReader(socket) {
  let buffer = '';
  let current = null;
  const ready = [];
  const waiters = [];
  let endedError = null;

  function settle(reply) {
    const waiter = waiters.shift();
    if (waiter) waiter.resolve(reply);
    else ready.push(reply);
  }

  function rejectAll(error) {
    endedError = error instanceof Error ? error : new Error(String(error || 'SMTP-verbinding gesloten.'));
    while (waiters.length) waiters.shift().reject(endedError);
  }

  function handleLine(line) {
    const match = line.match(/^(\d{3})([ -])(.*)$/);
    if (!match) {
      if (current) current.lines.push(line);
      return;
    }
    const code = Number(match[1]);
    if (!current) current = { code, lines: [] };
    current.lines.push(line);
    if (match[2] === ' ') {
      const reply = {
        code: current.code,
        message: truncate(current.lines.join(' | '), 1000),
        lines: current.lines.slice(),
      };
      current = null;
      settle(reply);
    }
  }

  function onData(chunk) {
    buffer += chunk.toString('utf8');
    let newlineIndex = buffer.indexOf('\n');
    while (newlineIndex >= 0) {
      const line = buffer.slice(0, newlineIndex).replace(/\r$/, '');
      buffer = buffer.slice(newlineIndex + 1);
      handleLine(line);
      newlineIndex = buffer.indexOf('\n');
    }
  }

  function onError(error) {
    rejectAll(error);
  }

  function onClose() {
    rejectAll(new Error('SMTP-verbinding gesloten voordat een antwoord compleet was.'));
  }

  socket.on('data', onData);
  socket.on('error', onError);
  socket.on('close', onClose);

  return {
    next(timeoutMs = DEFAULT_TIMEOUT_MS) {
      if (ready.length) return Promise.resolve(ready.shift());
      if (endedError) return Promise.reject(endedError);
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          const index = waiters.findIndex((item) => item.resolve === resolve);
          if (index >= 0) waiters.splice(index, 1);
          reject(new Error('SMTP-antwoordtimeout.'));
        }, timeoutMs);
        waiters.push({
          resolve: (value) => {
            clearTimeout(timer);
            resolve(value);
          },
          reject: (error) => {
            clearTimeout(timer);
            reject(error);
          },
        });
      });
    },
    detach() {
      socket.off('data', onData);
      socket.off('error', onError);
      socket.off('close', onClose);
      rejectAll(new Error('SMTP-reader vervangen.'));
    },
  };
}

async function connectSocket(host, port, timeoutMs) {
  const socket = net.createConnection({ host, port });
  socket.setTimeout(timeoutMs, () => socket.destroy(new Error('SMTP-verbindingtimeout.')));
  await new Promise((resolve, reject) => {
    socket.once('connect', resolve);
    socket.once('error', reject);
  });
  return socket;
}

async function upgradeSocketToTls(socket, host, timeoutMs) {
  const secureSocket = tls.connect({
    socket,
    servername: host,
    rejectUnauthorized: true,
  });
  secureSocket.setTimeout(timeoutMs, () => secureSocket.destroy(new Error('SMTP TLS-timeout.')));
  await new Promise((resolve, reject) => {
    secureSocket.once('secureConnect', resolve);
    secureSocket.once('error', reject);
  });
  return secureSocket;
}

async function openSmtpSession(host, options = {}) {
  const port = Math.max(1, Number(options.port) || 25);
  const timeoutMs = Math.max(2000, Number(options.timeoutMs) || DEFAULT_TIMEOUT_MS);
  const heloHost = truncate(options.heloHost || 'softora.nl', 200);
  let socket = await connectSocket(host, port, timeoutMs);
  let reader = createReplyReader(socket);
  const greeting = await reader.next(timeoutMs);
  if (greeting.code < 200 || greeting.code >= 400) {
    socket.destroy();
    throw new Error(`SMTP-server weigerde verbinding: ${greeting.message}`);
  }

  async function command(value) {
    socket.write(`${value}\r\n`);
    return reader.next(timeoutMs);
  }

  let ehlo = await command(`EHLO ${heloHost}`);
  if (ehlo.code >= 400) ehlo = await command(`HELO ${heloHost}`);
  const supportsStartTls = ehlo.lines.some((line) => /\bSTARTTLS\b/i.test(line));
  if (supportsStartTls && options.startTls !== false) {
    const startTlsReply = await command('STARTTLS');
    if (startTlsReply.code === 220) {
      reader.detach();
      socket = await upgradeSocketToTls(socket, host, timeoutMs);
      reader = createReplyReader(socket);
      ehlo = await command(`EHLO ${heloHost}`);
    }
  }

  return {
    async command(value) {
      socket.write(`${value}\r\n`);
      return reader.next(timeoutMs);
    },
    async close() {
      if (socket.destroyed) return;
      try {
        socket.write('QUIT\r\n');
      } catch (_error) {
        // De socket wordt hieronder altijd gesloten.
      }
      socket.end();
    },
  };
}

function isAccepted(reply) {
  return Boolean(reply && reply.code >= 200 && reply.code < 300);
}

function isExplicitInvalidRecipient(reply) {
  return Boolean(reply && reply.code >= 500 && INVALID_RECIPIENT_PATTERN.test(reply.message || ''));
}

function buildResult(status, reason, details = {}) {
  return {
    status,
    reason,
    smtpCode: Number(details.smtpCode) || null,
    smtpResponse: truncate(details.smtpResponse, 1000),
    mxHost: truncate(details.mxHost, 255),
    catchAll: details.catchAll === true ? true : details.catchAll === false ? false : null,
    checkedAt: new Date().toISOString(),
  };
}

async function verifyAgainstMx(email, mxHost, options = {}) {
  let session = null;
  try {
    session = await openSmtpSession(mxHost, options);
    const mailFrom = await session.command('MAIL FROM:<>');
    if (!isAccepted(mailFrom)) {
      return buildResult('unknown', 'smtp_mail_from_rejected', {
        smtpCode: mailFrom.code,
        smtpResponse: mailFrom.message,
        mxHost,
      });
    }
    const recipientReply = await session.command(`RCPT TO:<${email}>`);
    if (isExplicitInvalidRecipient(recipientReply)) {
      return buildResult('invalid', 'mailbox_does_not_exist', {
        smtpCode: recipientReply.code,
        smtpResponse: recipientReply.message,
        mxHost,
        catchAll: false,
      });
    }
    if (!isAccepted(recipientReply)) {
      return buildResult('unknown', recipientReply.code >= 400 && recipientReply.code < 500
        ? 'smtp_temporary_rejection'
        : 'smtp_policy_rejection', {
        smtpCode: recipientReply.code,
        smtpResponse: recipientReply.message,
        mxHost,
      });
    }

    await session.command('RSET');
    const catchAllMailFrom = await session.command('MAIL FROM:<>');
    if (!isAccepted(catchAllMailFrom)) {
      return buildResult('unknown', 'catch_all_probe_unavailable', {
        smtpCode: recipientReply.code,
        smtpResponse: recipientReply.message,
        mxHost,
      });
    }
    const domain = email.split('@')[1];
    const randomRecipient = `softora-check-${crypto.randomBytes(10).toString('hex')}@${domain}`;
    const catchAllReply = await session.command(`RCPT TO:<${randomRecipient}>`);
    if (isAccepted(catchAllReply)) {
      return buildResult('unknown', 'domain_accepts_all_recipients', {
        smtpCode: recipientReply.code,
        smtpResponse: recipientReply.message,
        mxHost,
        catchAll: true,
      });
    }
    if (!isExplicitInvalidRecipient(catchAllReply)) {
      return buildResult('unknown', 'catch_all_probe_inconclusive', {
        smtpCode: recipientReply.code,
        smtpResponse: `${recipientReply.message} | catch-all: ${catchAllReply.message}`,
        mxHost,
      });
    }
    return buildResult('valid', 'mailbox_confirmed', {
      smtpCode: recipientReply.code,
      smtpResponse: recipientReply.message,
      mxHost,
      catchAll: false,
    });
  } catch (error) {
    return buildResult('unknown', 'smtp_connection_error', {
      smtpResponse: error?.message || error,
      mxHost,
    });
  } finally {
    if (session) await session.close().catch(() => null);
  }
}

async function verifyMailbox(emailValue, options = {}) {
  const email = normalizeEmailAddress(emailValue);
  if (!email) return buildResult('invalid', 'invalid_email_syntax');
  const domain = email.split('@')[1];
  let mxRecords = [];
  try {
    const resolveMx = typeof options.resolveMx === 'function' ? options.resolveMx : dns.resolveMx;
    mxRecords = await resolveMx(domain);
  } catch (error) {
    const resolveAddress = typeof options.resolveAddress === 'function'
      ? options.resolveAddress
      : async (host) => {
          const results = await Promise.allSettled([dns.resolve4(host), dns.resolve6(host)]);
          return results.some((result) => result.status === 'fulfilled' && result.value.length > 0);
        };
    try {
      if (await resolveAddress(domain)) mxRecords = [{ priority: 0, exchange: domain }];
      else return buildResult('invalid', 'email_domain_has_no_mail_host', { smtpResponse: error?.code || error?.message || error });
    } catch (addressError) {
      return buildResult('invalid', 'email_domain_has_no_mail_host', {
        smtpResponse: addressError?.code || addressError?.message || addressError,
      });
    }
  }
  if (mxRecords.some((record) => String(record && record.exchange || '').trim() === '.')) {
    return buildResult('invalid', 'email_domain_explicitly_rejects_mail');
  }
  const hosts = mxRecords
    .filter((record) => record && record.exchange)
    .sort((left, right) => Number(left.priority || 0) - Number(right.priority || 0))
    .map((record) => String(record.exchange).replace(/\.$/, ''))
    .slice(0, Math.max(1, Number(options.maxMxHosts) || 3));
  if (!hosts.length) return buildResult('invalid', 'email_domain_has_no_mail_host');

  let lastUnknown = null;
  const verifyMx = typeof options.verifyAgainstMx === 'function'
    ? options.verifyAgainstMx
    : verifyAgainstMx;
  for (const mxHost of hosts) {
    const result = await verifyMx(email, mxHost, options);
    if (result.status === 'valid' || result.status === 'invalid') return result;
    lastUnknown = result;
  }
  return lastUnknown || buildResult('unknown', 'smtp_verification_inconclusive');
}

module.exports = {
  INVALID_RECIPIENT_PATTERN,
  buildResult,
  isExplicitInvalidRecipient,
  verifyMailbox,
};
