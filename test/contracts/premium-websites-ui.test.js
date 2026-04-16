const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

test('premium websites verbergt de header startknop op mobiel', () => {
  const filePath = path.join(__dirname, '../../premium-websites.html');
  const source = fs.readFileSync(filePath, 'utf8');

  assert.match(source, /<a href="\/#contact" class="nav-start-btn">Start Project<\/a>/);
  assert.match(
    source,
    /@media \(max-width: 960px\) \{[\s\S]*\.nav-start-btn \{[\s\S]*display:\s*none;[\s\S]*\}/
  );
});
