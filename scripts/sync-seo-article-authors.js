#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { SEO_CONTENT_ITEMS } = require('../server/services/seo-content');
const { assignSeoArticleAuthors } = require('../server/services/seo-content-article-authors');

// Editorial source metadata only; this does not start the app or access runtime data.
const { assignments } = assignSeoArticleAuthors(SEO_CONTENT_ITEMS);
const file = path.resolve(__dirname, '../server/services/seo-content-article-authors.json');
const sorted = Object.fromEntries(Object.entries(assignments).sort(([a], [b]) => a.localeCompare(b)));
fs.writeFileSync(file, JSON.stringify(sorted, null, 2) + '\n');
console.log('Vaste artikelauteurs bijgewerkt: ' + Object.keys(sorted).length + ' toewijzingen.');
