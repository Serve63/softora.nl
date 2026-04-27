const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('premium blog uses delegated actions instead of inline handlers', () => {
  const pagePath = path.join(__dirname, '../../premium-blog.html');
  const source = fs.readFileSync(pagePath, 'utf8');

  assert.match(source, /<input class="login-inp" type="password" id="code-inp"[^>]*data-blog-login-input>/);
  assert.match(source, /<button class="login-btn" type="button" data-blog-action="login">Doorgaan<\/button>/);
  assert.match(source, /<a class="nav-logo" href="\/" aria-label="Softora homepage">SOFTORA\.NL<\/a>/);
  assert.match(source, /<button class="nav-back" id="nav-back" type="button" data-blog-action="overview">/);
  assert.match(source, /data-blog-filter="Website's"/);
  assert.match(source, /data-blog-filter="Bedrijfssoftware"/);
  assert.match(source, /return `<button type="button" class="blog-card\$\{featured \? ' featured' : ''\}" data-blog-id="\$\{b\.id\}">/);
  assert.match(source, /function bindBlogActions\(\)/);
  assert.match(source, /loginInput\.addEventListener\('keydown', \(event\) => \{[\s\S]*if \(event\.key === 'Enter'\) login\(\);/);
  assert.match(source, /button\.addEventListener\('click', \(\) => \{[\s\S]*button\.dataset\.blogAction === 'login'[\s\S]*goOverzicht\(\);/);
  assert.match(source, /button\.addEventListener\('click', \(\) => \{[\s\S]*filterCat\(button\.dataset\.blogFilter \|\| "Website's", button\);/);
  assert.match(source, /root\.addEventListener\('click', \(event\) => \{[\s\S]*openBlog\(Number\(cardButton\.dataset\.blogId\)\);/);
  assert.match(source, /\.blog-card \{[\s\S]*font:\s*inherit;[\s\S]*text-align:\s*left;/);

  assert.doesNotMatch(source, /\son(?:click|input|change|keydown|submit)=/);
  assert.doesNotMatch(source, /onclick="openBlog\(/);
  assert.doesNotMatch(source, /filterCat\('Website\\'s'/);
});
