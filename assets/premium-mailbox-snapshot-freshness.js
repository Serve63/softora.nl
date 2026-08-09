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
  function getContentAt(snapshot) { const source = snapshot && typeof snapshot === 'object' ? snapshot : {}; return normalizeTimestamp(source.contentAt || source.sync?.contentAt); }
  function isCompleteSnapshot(snapshot) {
    const source = snapshot && typeof snapshot === 'object' ? snapshot : {};
    return source.complete !== false && source.degraded !== true && source.sync?.stale !== true &&
      source.sync?.degraded !== true && source.sync?.complete !== false;
  }
  function normalizeSnapshot(snapshot, options = {}) {
    if (!snapshot || typeof snapshot !== 'object' || !Array.isArray(snapshot.messages)) return null;
    const contentAt = getContentAt(snapshot);
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
      complete,
      sync: {
        ...(snapshot.sync && typeof snapshot.sync === 'object' ? snapshot.sync : {}),
        contentAt,
        origin,
      },
    };
  }
  function getMessageIdentityKey(message) {
    const source = message && typeof message === 'object' ? message : {};
    const account = normalizeText(source.accountEmail || source.account || source.campaign?.account);
    const folder = normalizeText(source.storageFolder || source.folder || 'inbox');
    const uid = Number(source.uid) || 0;
    const id = normalizeText(source.mailboxId || source.id || source.messageId);
    if (!account || (!uid && !id)) return '';
    return `${account}\n${folder}\n${uid > 0 ? `uid:${uid}` : `id:${id}`}`;
  }
  function mergeAdditiveMessages(currentMessages, incomingMessages) {
    const merged = [];
    const positions = new Map();
    [...(Array.isArray(incomingMessages) ? incomingMessages : []), ...(Array.isArray(currentMessages) ? currentMessages : [])]
      .forEach((message, index) => {
        const key = getMessageIdentityKey(message) || `unkeyed:${index}:${normalizeText(message?.id)}`;
        if (positions.has(key)) return;
        positions.set(key, merged.length);
        merged.push(message);
    });
    return merged;
  }
  function decideSnapshotAction(current, incoming, options = {}) {
    const next = normalizeSnapshot(incoming, options);
    if (!next) return 'reject';
    const previous = normalizeSnapshot(current, { ...options, maxAgeMs: Number.POSITIVE_INFINITY });
    if (!previous) return 'replace';
    const previousTime = Date.parse(previous.contentAt);
    const nextTime = Date.parse(next.contentAt);
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
  function applyTombstones(messages, values, contentAt) {
    const baseTime = Date.parse(normalizeTimestamp(contentAt));
    if (!Number.isFinite(baseTime)) return [];
    const hidden = new Set(sanitizeTombstones(values)
      .filter((value) => Date.parse(value.hiddenAt) > baseTime)
      .map((value) => getMessageIdentityKey(value.identity)));
    return (Array.isArray(messages) ? messages : []).filter((message) => !hidden.has(getMessageIdentityKey(message)));
  }
  function selectSnapshot(pageSnapshot, sessionSnapshot, options = {}) {
    const page = normalizeSnapshot(pageSnapshot, { ...options, origin: 'server-bootstrap' });
    const session = normalizeSnapshot(sessionSnapshot, { ...options, origin: 'session-cache' });
    if (!page) return session;
    if (!session) return page;
    const pageIsCandidate = Date.parse(page.contentAt) >= Date.parse(session.contentAt);
    const current = pageIsCandidate ? session : page;
    const incoming = pageIsCandidate ? page : session;
    const action = decideSnapshotAction(current, incoming, options);
    const selected = action === 'reject'
      ? current
      : action === 'merge-additive'
        ? { ...incoming, messages: mergeAdditiveMessages(current.messages, incoming.messages) }
        : incoming;
    const tombstones = sanitizeTombstones([...(page.tombstones || []), ...(session.tombstones || [])]);
    return {
      ...selected,
      tombstones,
      messages: applyTombstones(selected.messages, tombstones, selected.contentAt),
    };
  }
  const api = {
    MAX_SNAPSHOT_AGE_MS,
    addTombstone,
    applyTombstones,
    decideSnapshotUpdate,
    getContentAt,
    getMessageIdentityKey,
    isCompleteSnapshot,
    mergeAdditiveMessages,
    mergeMessagesAdditively: mergeAdditiveMessages,
    normalizeSnapshot,
    sanitizeTombstones,
    selectSnapshot,
  };
  global.SoftoraMailboxSnapshotFreshness = api;
  global.PremiumMailboxSnapshotFreshness = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
