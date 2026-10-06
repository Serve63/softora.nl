const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { extractCssBrandColorEvidence } = require('../../server/services/website-brand-colors');

test('brand evidence handles nested CSS, comments and quoted SVG braces without false rules', () => {
  const css = `/* .logo { color:#ff0000 } */
    .decoration { color:#ff0000 }
    @media (min-width: 600px) {
      header { background-color:#123456; content:"} {"; }
      .btn { background-image:url("data:image/svg+xml,<svg>{}</svg>"); color:#abcdef; }
    }
    .logo { fill:#135790; }`;
  assert.deepEqual(extractCssBrandColorEvidence([css]).map((item) => item.color), ['#123456', '#abcdef', '#135790']);
});

test('megabyte source maps and malformed brace-free CSS cannot block the worker event loop', () => {
  const script = `
    const assert = require('node:assert/strict');
    const { extractCssBrandColorEvidence } = require(${JSON.stringify(require.resolve('../../server/services/website-brand-colors'))});
    const tail = 'A'.repeat(1024 * 1024);
    for (const css of ['header{color:#123456}/*# sourceMappingURL=data:application/json;base64,' + tail + ' */',
      'header{color:#123456}' + tail, 'header{color:#123456}/*' + tail]) {
      assert.deepEqual(extractCssBrandColorEvidence([css]).map((item) => item.color), ['#123456']);
    }
  `;
  const result = spawnSync(process.execPath, ['-e', script], { encoding: 'utf8', timeout: 3000 });
  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.status, 0, result.stderr);
});
