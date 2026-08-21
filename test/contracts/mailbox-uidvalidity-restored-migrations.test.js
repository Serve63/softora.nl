const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '../..');

test('herstelde live UIDVALIDITY-migraties zijn byte-exact', () => {
  const expected = new Map([
    [
      '20260810125534_add_mailbox_uidvalidity_generations.sql',
      '98f75b8507265f8c09ee2fabf92701722408216390fe3871cf97236e043d918f',
    ],
    [
      '20260810132307_allow_mailbox_uid_generation_adoption.sql',
      'cd2b09beac5a7b14cc8686bfcd0c88cb4fd9ce828310f90acf3073ed2db6032d',
    ],
    [
      '20260810172231_fix_mailbox_uidvalidity_atomic_commit.sql',
      '451d731ad390672d8bcce3e3b7c9ee269688cb016fb112a6a83c40eb5959f8e8',
    ],
  ]);
  for (const [filename, digest] of expected) {
    const contents = fs.readFileSync(path.join(repoRoot, 'supabase/migrations', filename));
    assert.equal(crypto.createHash('sha256').update(contents).digest('hex'), digest);
  }
});
