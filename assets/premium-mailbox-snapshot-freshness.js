(function (global) {
  'use strict';
  const MAX_SNAPSHOT_AGE_MS = 15 * 60 * 1000;
  const ORIGIN_PRIORITY = Object.freeze({
    'session-cache': 1,
    'server-bootstrap': 2,
    'live-api': 3,
  });
  function normalizeText(value) { return String(value || '').trim().toLowerCase(); }
  function normalizeTimestamp(value) { const timestamp = Date.parse(String(value || '')); return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : ''; }
  function normalizeContentVersion(value) {
    const normalized = String(value == null ? '' : value).trim();
    if (!/^\d+$/.test(normalized)) return '';
    try { return BigInt(normalized).toString(); } catch (_) { return ''; }
  }
  function normalizeUidValidity(value) {
    const normalized = Number(value);
    return Number.isSafeInteger(normalized) && normalized > 0 && normalized <= 4294967295
      ? normalized
      : 0;
  }
  function getContentAt(snapshot) { const source = snapshot && typeof snapshot === 'object' ? snapshot : {}; return normalizeTimestamp(source.contentAt || source.sync?.contentAt); }
  function getContentVersion(snapshot) { const source = snapshot && typeof snapshot === 'object' ? snapshot : {}; return normalizeContentVersion(source.contentVersion ?? source.sync?.contentVersion); }
  function isCompleteSnapshot(snapshot) {
    const source = snapshot && typeof snapshot === 'object' ? snapshot : {};
    return Boolean(getContentVersion(source)) && source.complete !== false && source.degraded !== true && source.sync?.stale !== true &&
      source.sync?.degraded !== true && source.sync?.complete !== false;
  }
  function normalizeSnapshot(snapshot, options = {}) {
    if (!snapshot || typeof snapshot !== 'object' || !Array.isArray(snapshot.messages)) return null;
    const contentAt = getContentAt(snapshot);
    const contentVersion = getContentVersion(snapshot);
    if (!contentAt) return null;
    const now = Number(options.now == null ? Date.now() : options.now);
    const maxAgeMs = Math.max(0, Number(options.maxAgeMs ?? MAX_SNAPSHOT_AGE_MS));
    const contentTime = Date.parse(contentAt);
    if (!Number.isFinite(now) || contentTime > now + 60 * 1000 || now - contentTime > maxAgeMs) return null;
    const origin = normalizeText(options.origin || snapshot.origin || snapshot.sync?.origin) || 'session-cache';
    const complete = isCompleteSnapshot(snapshot);
    return {
      ...snapshot,
      origin,
      contentAt,
      contentVersion,
      complete,
      sync: {
        ...(snapshot.sync && typeof snapshot.sync === 'object' ? snapshot.sync : {}),
        contentAt,
        contentVersion,
        origin,
      },
    };
  }
  function getMessageIdentityKey(message) {
    const source = message && typeof message === 'object' ? message : {};
    const account = normalizeText(source.accountEmail || source.account || source.campaign?.account);
    const folder = normalizeText(source.storageFolder || source.folder || 'inbox');
    const uid = Number(source.uid) || 0;
    const uidValidity = normalizeUidValidity(source.uidValidity);
    const id = normalizeText(source.mailboxId || source.id || source.messageId);
    if (!account || (!uid && !id)) return '';
    return `${account}\n${folder}\n${folder !== 'instantly' && uid > 0
      ? `uv:${uidValidity}\nuid:${uid}`
      : `id:${id}`}`;
  }
  function mergeAdditiveMessages(currentMessages, incomingMessages) {
    const current = Array.isArray(currentMessages) ? currentMessages : [];
    const keyOf = (message) => getMessageIdentityKey(message) || (normalizeText(message?.id || message?.messageId) ? `id:${normalizeText(message?.id || message?.messageId)}` : '');
    const currentByKey = new Map(current.map((message) => [keyOf(message), message]).filter(([key]) => key));
    const seen = new Set();
    const merged = (Array.isArray(incomingMessages) ? incomingMessages : []).map((message) => {
      const key = keyOf(message);
      if (!key || !currentByKey.has(key)) { if (key) seen.add(key); return message; }
      seen.add(key);
      const previous = currentByKey.get(key);
      const threadMessages = mergeAdditiveMessages(previous?.threadMessages, message?.threadMessages);
      return threadMessages.length ? { ...previous, threadMessages } : previous;
    });
    current.forEach((message) => { const key = keyOf(message); if (!key || !seen.has(key)) merged.push(message); });
    return merged;
  }
  function decideSnapshotAction(current, incoming, options = {}) {
    const next = normalizeSnapshot(incoming, options);
    if (!next) return 'reject';
    const previous = normalizeSnapshot(current, { ...options, maxAgeMs: Number.POSITIVE_INFINITY });
    if (!previous) return 'replace';
    const previousTime = Date.parse(previous.contentAt);
    const nextTime = Date.parse(next.contentAt);
    if (previous.contentVersion && next.contentVersion) {
      const versionOrder = BigInt(next.contentVersion) - BigInt(previous.contentVersion);
      if (versionOrder < 0n) return 'reject';
      if (versionOrder > 0n) return next.complete ? 'replace' : 'merge-additive';
    }
    if (nextTime < previousTime) return 'reject';
    if (!next.complete) return nextTime >= previousTime ? 'merge-additive' : 'reject';
    if (nextTime > previousTime) return 'replace';
    return (ORIGIN_PRIORITY[next.origin] || 0) >= (ORIGIN_PRIORITY[previous.origin] || 0)
      ? 'replace'
      : 'reject';
  }
  function decideSnapshotUpdate(current, incoming, options = {}) {
    if (arguments.length === 1 && current && Object.prototype.hasOwnProperty.call(current, 'incoming')) {
      return { action: decideSnapshotAction(current.current, current.incoming, current) };
    }
    return decideSnapshotAction(current, incoming, options);
  }
  function normalizeTombstone(value) {
    const source = value && typeof value === 'object' ? value : {};
    const identity = source.identity && typeof source.identity === 'object' ? source.identity : source;
    const hiddenAt = normalizeTimestamp(source.hiddenAt);
    const key = getMessageIdentityKey(identity);
    if (!key || !hiddenAt) return null;
    return {
      identity: {
        accountEmail: normalizeText(identity.accountEmail || identity.account || identity.campaign?.account),
        folder: normalizeText(identity.storageFolder || identity.folder || 'inbox'),
        uid: Number(identity.uid) || 0,
        uidValidity: normalizeUidValidity(identity.uidValidity),
        id: String(identity.mailboxId || identity.id || identity.messageId || '').trim(),
      },
      hiddenAt,
    };
  }
  function sanitizeTombstones(values) {
    const unique = new Map();
    (Array.isArray(values) ? values : []).forEach((value) => {
      const tombstone = normalizeTombstone(value);
      if (!tombstone) return;
      const key = getMessageIdentityKey(tombstone.identity);
      const current = unique.get(key);
      if (!current || Date.parse(tombstone.hiddenAt) > Date.parse(current.hiddenAt)) unique.set(key, tombstone);
    });
    return Array.from(unique.values());
  }
  function addTombstone(values, identity, hiddenAt = new Date().toISOString()) {
    return sanitizeTombstones([...(Array.isArray(values) ? values : []), { identity, hiddenAt }]);
  }
  function applyTombstones(messages, values, contentAt, options = {}) {
    const baseTime = Date.parse(normalizeTimestamp(contentAt));
    if (!Number.isFinite(baseTime)) return [];
    const hidden = new Set(sanitizeTombstones(values)
      .filter((value) => options.authoritative === false || Date.parse(value.hiddenAt) > baseTime)
      .map((value) => getMessageIdentityKey(value.identity)));
    return (Array.isArray(messages) ? messages : []).filter((message) => !hidden.has(getMessageIdentityKey(message)));
  }
  function mergeSnapshotMessagesAdditively(current, incoming, tombstones) {
    return mergeAdditiveMessages(
      applyTombstones(current?.messages, tombstones, current?.contentAt, { authoritative: current?.complete }),
      applyTombstones(incoming?.messages, tombstones, incoming?.contentAt, { authoritative: incoming?.complete })
    );
  }
  function selectSnapshot(pageSnapshot, sessionSnapshot, options = {}) {
    const page = normalizeSnapshot(pageSnapshot, { ...options, origin: 'server-bootstrap' });
    const session = normalizeSnapshot(sessionSnapshot, { ...options, origin: 'session-cache' });
    if (!page) return session;
    if (!session) return page;
    const pageIsCandidate = page.contentVersion && session.contentVersion &&
      BigInt(page.contentVersion) !== BigInt(session.contentVersion)
      ? BigInt(page.contentVersion) > BigInt(session.contentVersion)
      : Date.parse(page.contentAt) >= Date.parse(session.contentAt);
    const current = pageIsCandidate ? session : page;
    const incoming = pageIsCandidate ? page : session;
    const action = decideSnapshotAction(current, incoming, options);
    const tombstones = sanitizeTombstones([...(page.tombstones || []), ...(session.tombstones || [])]);
    let selected = action === 'reject'
      ? current
      : action === 'merge-additive'
        ? { ...incoming, messages: mergeSnapshotMessagesAdditively(current, incoming, tombstones) }
        : incoming;
    if (action !== 'merge-additive') selected = {
      ...selected,
      messages: applyTombstones(selected.messages, tombstones, selected.contentAt, { authoritative: selected.complete }),
    };
    return {
      ...selected,
      tombstones,
    };
  }
  const api = {
    MAX_SNAPSHOT_AGE_MS,
    addTombstone,
    applyTombstones,
    decideSnapshotUpdate,
    getContentAt,
    getContentVersion,
    getMessageIdentityKey,
    isCompleteSnapshot,
    mergeAdditiveMessages,
    mergeMessagesAdditively: mergeAdditiveMessages,
    mergeSnapshotMessagesAdditively,
    normalizeContentVersion,
    normalizeSnapshot,
    sanitizeTombstones,
    selectSnapshot,
  };
  global.SoftoraMailboxSnapshotFreshness = api;
  global.PremiumMailboxSnapshotFreshness = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
