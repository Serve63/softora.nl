'use strict';

/**
 * lib/utils.js — Pure utility functies zonder externe dependencies.
 * Worden zowel in server.js als in route-modules gebruikt.
 */

function parseIntSafe(value, fallback = 0) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseNumberSafe(value, fallback = null) {
  if (value === '' || value === null || value === undefined) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeString(value, fallback = '') {
  if (value === null || value === undefined) return fallback;
  return String(value).trim();
}

function escapeHtml(value) {
  return normalizeString(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function truncateText(value, maxLength = 500) {
  const text = normalizeString(value);
  if (!text) return '';
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}...` : text;
}

function clipText(value, maxLength = 500) {
  const text = normalizeString(value);
  if (!text) return '';
  if (!Number.isFinite(Number(maxLength)) || Number(maxLength) <= 0) return '';
  const limit = Math.floor(Number(maxLength));
  return text.length > limit ? text.slice(0, limit) : text;
}

module.exports = { parseIntSafe, parseNumberSafe, normalizeString, escapeHtml, truncateText, clipText };
