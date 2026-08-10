(function (global) {
  'use strict';

  function normalize(value) {
    return String(value || '').trim().toLowerCase();
  }

  function normalizeUidValidity(value) {
    const normalized = Number(value);
    return Number.isSafeInteger(normalized) && normalized > 0 && normalized <= 4294967295
      ? normalized
      : 0;
  }

  function resolve(input, overrides = {}) {
    const source = input && typeof input === 'object' ? input : {};
    const account = normalize(
      overrides.account ?? source.accountEmail ?? source.account ?? source.campaign?.account
    );
    const folder = normalize(
      overrides.folder ?? source.storageFolder ?? source.folder ?? 'inbox'
    ) || 'inbox';
    const rawUid = Number(overrides.uid ?? source.uid);
    const uid = Number.isSafeInteger(rawUid) && rawUid > 0 ? rawUid : 0;
    const uidValidity = normalizeUidValidity(overrides.uidValidity ?? source.uidValidity);
    const id = String(
      overrides.id ?? source.mailboxId ?? source.id ?? source.messageId ?? ''
    ).trim();
    return { account, folder, uid, uidValidity, id, imap: folder !== 'instantly' && uid > 0 };
  }

  function getKey(input, overrides) {
    const identity = resolve(input, overrides);
    if (!identity.account || (!identity.uid && !identity.id)) return '';
    const message = identity.imap
      ? `uv:${identity.uidValidity}|uid:${identity.uid}`
      : `id:${identity.id}`;
    return `${identity.account}|${identity.folder}|${message}`;
  }

  function getUiId(input, overrides) {
    const identity = resolve(input, overrides);
    if (identity.imap && identity.uidValidity) return getKey(identity);
    if (identity.account && identity.id) return `${identity.account}|${identity.id}`;
    return identity.id;
  }

  const api = { getKey, getUiId, normalizeUidValidity, resolve };
  global.SoftoraMailboxMessageIdentity = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
