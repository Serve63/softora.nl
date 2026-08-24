'use strict';

const {
  CAMPAIGN_HISTORY_SINCE,
} = require('./mailbox-campaign-history-sync');
const {
  normalizeMailboxTargetReference,
  normalizeMailboxTargetReferences,
} = require('./mailbox-uid-validity');

const MAILBOX_TARGET_MANIFEST_UID_SEARCH_WINDOW = 5_000;
const MAILBOX_TARGET_MANIFEST_HEADER_FETCH_CAP = 50;
const MAILBOX_TARGET_MANIFEST_HEADERS = Object.freeze([
  'Message-ID',
  'In-Reply-To',
  'References',
]);

function createMailboxTargetManifestScanError(message) {
  const error = new Error(message);
  error.code = 'MAILBOX_UID_TARGET_MANIFEST_SCAN_INVALID';
  return error;
}

function unfoldMailboxTargetHeaders(value) {
  if (!Buffer.isBuffer(value) && typeof value !== 'string') return '';
  return value.toString('utf8').replace(/\r?\n[\t ]+/g, ' ');
}

function parseMailboxTargetHeaders(value) {
  const source = unfoldMailboxTargetHeaders(value);
  const headers = new Map();
  for (const line of source.split(/\r?\n/)) {
    const match = line.match(/^([^:\s]+)\s*:\s*(.*)$/);
    if (!match) continue;
    const name = match[1].trim().toLowerCase();
    if (!['message-id', 'in-reply-to', 'references'].includes(name)) continue;
    const values = headers.get(name) || [];
    values.push(match[2]);
    headers.set(name, values);
  }
  return headers;
}

function extractMailboxMessageIdTokens(value) {
  const source = String(value || '');
  const tokens = [];
  const remainder = source.replace(/<[^<>]*>/g, (token) => {
    tokens.push(token);
    return ' ';
  });
  tokens.push(...remainder.split(/[\s,]+/));
  return normalizeMailboxTargetReferences(tokens);
}

function mailboxTargetHeadersMatch(value, targetReferenceIds = []) {
  const targetSet = new Set(normalizeMailboxTargetReferences(targetReferenceIds));
  if (!targetSet.size) return false;
  const headers = parseMailboxTargetHeaders(value);
  for (const name of ['message-id', 'in-reply-to', 'references']) {
    for (const headerValue of headers.get(name) || []) {
      for (const token of extractMailboxMessageIdTokens(headerValue)) {
        if (targetSet.has(token)) return true;
      }
    }
  }
  return false;
}

async function scanMailboxTargetUidManifestWindow({
  client,
  fromUid = 1,
  scanUpperUid = 0,
  targetReferenceIds = [],
  since = CAMPAIGN_HISTORY_SINCE,
  uidSearchWindow = MAILBOX_TARGET_MANIFEST_UID_SEARCH_WINDOW,
  headerFetchCap = MAILBOX_TARGET_MANIFEST_HEADER_FETCH_CAP,
} = {}) {
  const safeFromUid = Number(fromUid);
  const safeScanUpperUid = Number(scanUpperUid);
  const safeUidSearchWindow = Number(uidSearchWindow);
  const safeHeaderFetchCap = Number(headerFetchCap);
  const normalizedTargets = normalizeMailboxTargetReferences(targetReferenceIds);
  if (
    !client || typeof client.search !== 'function' || typeof client.fetch !== 'function' ||
    !Number.isSafeInteger(safeFromUid) || safeFromUid < 1 ||
    !Number.isSafeInteger(safeScanUpperUid) || safeScanUpperUid < 0 ||
    !Number.isSafeInteger(safeUidSearchWindow) || safeUidSearchWindow < 1 ||
    !Number.isSafeInteger(safeHeaderFetchCap) || safeHeaderFetchCap < 1 ||
    !normalizedTargets.length || !(since instanceof Date) || !Number.isFinite(since.getTime())
  ) {
    throw createMailboxTargetManifestScanError(
      'Gerichte All Mail-manifestscan ontving ongeldige invoer.'
    );
  }
  if (safeFromUid > safeScanUpperUid) {
    return {
      foundUids: [],
      scannedThroughUid: safeScanUpperUid,
      scanComplete: true,
    };
  }

  const windowThroughUid = Math.min(
    safeScanUpperUid,
    safeFromUid + safeUidSearchWindow - 1
  );
  const searchedUids = await client.search(
    {
      since,
      uid: `${safeFromUid}:${windowThroughUid}`,
    },
    { uid: true }
  );
  if (!Array.isArray(searchedUids)) {
    throw createMailboxTargetManifestScanError(
      'Gerichte All Mail-manifestscan ontving geen geldige UID-zoekuitkomst.'
    );
  }
  const candidateUidSet = new Set();
  const candidateUids = [];
  for (const searchedUid of searchedUids) {
    if (
      typeof searchedUid !== 'number' || !Number.isSafeInteger(searchedUid) ||
      searchedUid < safeFromUid || searchedUid > windowThroughUid ||
      candidateUidSet.has(searchedUid)
    ) {
      throw createMailboxTargetManifestScanError(
        'Gerichte All Mail-manifestscan ontving dubbelzinnig UID-zoekbewijs.'
      );
    }
    candidateUidSet.add(searchedUid);
    candidateUids.push(searchedUid);
  }
  candidateUids.sort((left, right) => left - right);
  const selectedUids = candidateUids.slice(0, safeHeaderFetchCap);
  const fetchedByUid = new Map();

  if (selectedUids.length) {
    const selectedUidSet = new Set(selectedUids);
    for await (const message of client.fetch(
      selectedUids,
      {
        uid: true,
        headers: MAILBOX_TARGET_MANIFEST_HEADERS,
      },
      { uid: true }
    )) {
      const uid = Number(message && message.uid);
      const headers = message && message.headers;
      if (
        !Number.isSafeInteger(uid) || !selectedUidSet.has(uid) || fetchedByUid.has(uid) ||
        (!Buffer.isBuffer(headers) && typeof headers !== 'string')
      ) {
        throw createMailboxTargetManifestScanError(
          'Gerichte All Mail-manifestscan ontving onvolledig headerbewijs.'
        );
      }
      fetchedByUid.set(uid, headers);
    }
  }

  if (fetchedByUid.size !== selectedUids.length || selectedUids.some((uid) => !fetchedByUid.has(uid))) {
    throw createMailboxTargetManifestScanError(
      'Gerichte All Mail-manifestscan miste geselecteerde headerrecords.'
    );
  }

  const foundUids = selectedUids.filter((uid) =>
    mailboxTargetHeadersMatch(fetchedByUid.get(uid), normalizedTargets)
  );
  const scannedThroughUid = candidateUids.length > selectedUids.length
    ? selectedUids[selectedUids.length - 1]
    : windowThroughUid;

  return {
    foundUids,
    scannedThroughUid,
    scanComplete: scannedThroughUid >= safeScanUpperUid,
  };
}

module.exports = {
  MAILBOX_TARGET_MANIFEST_HEADER_FETCH_CAP,
  MAILBOX_TARGET_MANIFEST_HEADERS,
  MAILBOX_TARGET_MANIFEST_UID_SEARCH_WINDOW,
  createMailboxTargetManifestScanError,
  extractMailboxMessageIdTokens,
  mailboxTargetHeadersMatch,
  parseMailboxTargetHeaders,
  scanMailboxTargetUidManifestWindow,
};
