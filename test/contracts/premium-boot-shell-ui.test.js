const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const pages = [
  'premium-personeel-dashboard.html',
  'premium-actieve-opdrachten.html',
  'premium-personeel-agenda.html',
  'premium-ai-coldmailing.html',
  'premium-ai-lead-generator.html',
  'premium-database.html',
  'premium-klanten.html',
  'premium-mailbox.html',
  'premium-websitegenerator.html',
  'premium-pakketten.html',
  'premium-pdfs.html',
  'premium-boekhouding.html',
  'premium-kladblok.html',
  'premium-word.html',
  'premium-instellingen.html',
];

test('premium personeel pagina’s met boot-shell delen personnel-theme loader en hook', () => {
  const themePath = path.join(__dirname, '../../assets/personnel-theme.css');
  const themeSource = fs.readFileSync(themePath, 'utf8');
  assert.match(themeSource, /@import url\('softora-dossier-loader\.css'\)/);
  assert.match(themeSource, /\.premium-boot-loader\s*\{/);
  assert.match(themeSource, /\.premium-boot-shell\.is-booting\s*\{/);
  const loaderPath = path.join(__dirname, '../../assets/softora-dossier-loader.css');
  const loaderSource = fs.readFileSync(loaderPath, 'utf8');
  assert.match(loaderSource, /softora-dossier-loader__orbit--outer/);

  const jsPath = path.join(__dirname, '../../assets/personnel-theme.js');
  const jsSource = fs.readFileSync(jsPath, 'utf8');
  assert.match(jsSource, /SoftoraPremiumBoot\.setShellBooting/);
  assert.match(jsSource, /main\.is-premium-boot-host/);
  const oneSecondBootPath = path.join(__dirname, '../../assets/premium-boot-one-second.js');
  const oneSecondBootSource = fs.readFileSync(oneSecondBootPath, 'utf8');
  assert.match(oneSecondBootSource, /const DEFAULT_MINIMUM_MS = 1000;/);
  assert.match(oneSecondBootSource, /boot\.releaseShellAfterMinimum = releaseShellAfterMinimum;/);

  const userMgmtPath = path.join(__dirname, '../../assets/premium-user-management.js');
  const userMgmtSource = fs.readFileSync(userMgmtPath, 'utf8');
  assert.match(
    userMgmtSource,
    /SoftoraPremiumBoot\.setShellBooting\(false\)/,
    'premium-user-management.js moet boot-shell sluiten na laden'
  );

  for (const file of pages) {
    const pagePath = path.join(__dirname, '../../', file);
    const source = fs.readFileSync(pagePath, 'utf8');
    assert.match(source, /<main[^>]*\bis-premium-boot-host\b/, file);
    assert.match(source, /class="premium-boot-loader"/, file);
    assert.match(source, /class="premium-boot-shell is-booting"/, file);
    assert.match(source, /assets\/premium-boot-one-second\.js\?v=20260502a/, file);
    if (file !== 'premium-instellingen.html') {
      if (file === 'premium-actieve-opdrachten.html') {
        assert.match(source, /<!-- SOFTORA_ACTIVE_ORDERS_BOOTSTRAP --><script src="assets\/premium-active-orders-boot\.js\?v=20260502a"><\/script><script src="assets\/premium-active-orders-assignee\.js\?v=20260505a"><\/script><script src="assets\/premium-actieve-opdrachten\.js\?v=20260505b"><\/script>/, file);
        const activeOrdersBootPath = path.join(__dirname, '../../assets/premium-active-orders-boot.js');
        const activeOrdersPath = path.join(__dirname, '../../assets/premium-actieve-opdrachten.js');
        const activeOrdersBootSource = fs.readFileSync(activeOrdersBootPath, 'utf8');
        const activeOrdersSource = fs.readFileSync(activeOrdersPath, 'utf8');
        assert.match(activeOrdersBootSource, /SoftoraPremiumBoot\.setShellBooting\(false\)/, file);
        assert.match(activeOrdersSource, /boot\.releaseAfterMinimum/, file);
      } else if (file === 'premium-pdfs.html') {
        assert.match(source, /<script src="assets\/premium-pdfs-builder\.js\?v=20260427a"><\/script>/, file);
        const pdfBuilderPath = path.join(__dirname, '../../assets/premium-pdfs-builder.js');
        const pdfBuilderSource = fs.readFileSync(pdfBuilderPath, 'utf8');
        assert.match(pdfBuilderSource, /SoftoraPremiumBoot\.setShellBooting\(false\)/, file);
      } else if (file === 'premium-kladblok.html') {
        assert.match(source, /<script src="assets\/premium-ui-state-client\.js\?v=20260427a"><\/script>\s*<script src="assets\/premium-notepad\.js\?v=20260427b"><\/script>/, file);
        const notepadPath = path.join(__dirname, '../../assets/premium-notepad.js');
        const notepadSource = fs.readFileSync(notepadPath, 'utf8');
        assert.match(notepadSource, /SoftoraPremiumBoot\.setShellBooting\(false\)/, file);
      } else if (file === 'premium-word.html') {
        assert.match(source, /<script src="assets\/premium-ui-state-client\.js\?v=20260427a"><\/script>\s*<script src="assets\/premium-word\.js\?v=20260427b"><\/script>/, file);
        const wordPath = path.join(__dirname, '../../assets/premium-word.js');
        const wordSource = fs.readFileSync(wordPath, 'utf8');
        assert.match(wordSource, /SoftoraPremiumBoot\.setShellBooting\(false\)/, file);
      } else if (file === 'premium-boekhouding.html') {
        assert.match(source, /<script src="assets\/premium-ui-state-client\.js\?v=20260427a"><\/script>\s*<script src="assets\/premium-bookkeeping\.js\?v=20260427a"><\/script>/, file);
        const bookkeepingPath = path.join(__dirname, '../../assets/premium-bookkeeping.js');
        const bookkeepingSource = fs.readFileSync(bookkeepingPath, 'utf8');
        assert.match(bookkeepingSource, /SoftoraPremiumBoot\.setShellBooting\(false\)/, file);
      } else if (file === 'premium-mailbox.html') {
        assert.match(source, /<script src="assets\/premium-mailbox\.js\?v=20260507a"><\/script>/, file);
        const mailboxPath = path.join(__dirname, '../../assets/premium-mailbox.js');
        const mailboxSource = fs.readFileSync(mailboxPath, 'utf8');
        assert.match(mailboxSource, /SoftoraPremiumBoot\.setShellBooting\(false\)/, file);
      } else if (file === 'premium-pakketten.html') {
        assert.match(source, /<script src="assets\/premium-packages\.js\?v=20260427a"><\/script>/, file);
        const packagesPath = path.join(__dirname, '../../assets/premium-packages.js');
        const packagesSource = fs.readFileSync(packagesPath, 'utf8');
        assert.match(packagesSource, /SoftoraPremiumBoot\.setShellBooting\(false\)/, file);
      } else if (file === 'premium-websitegenerator.html') {
        assert.match(source, /<script src="assets\/premium-websitegenerator\.js\?v=20260501a" defer><\/script>/, file);
        assert.match(source, /<script src="assets\/premium-websitegenerator-boot\.js\?v=20260507a" defer><\/script>/, file);
        const websitegeneratorPath = path.join(__dirname, '../../assets/premium-websitegenerator-boot.js');
        const websitegeneratorSource = fs.readFileSync(websitegeneratorPath, 'utf8');
        assert.match(websitegeneratorSource, /SoftoraPremiumBoot\.setShellBooting\(false\)/, file);
      } else {
        assert.match(source, /SoftoraPremiumBoot\.setShellBooting\(false\)|SoftoraPremiumBootTiming\?\.release/, file);
      }
    }
  }
});

test('premium laadiconen blijven overal 58px', () => {
  const compactInlineLoaderExceptions = new Map([
    ['assets/premium-database-webdesign-action.js:.photo-generate-spinner', '18px'],
  ]);

  const filesToScan = [
    ...fs.readdirSync(path.join(__dirname, '../..'))
      .filter((file) => /^premium-.*\.html$/.test(file)),
    ...fs.readdirSync(path.join(__dirname, '../../assets'))
      .filter((file) => /\.js$|\.css$/.test(file))
      .map((file) => `assets/${file}`),
  ];

  for (const file of filesToScan) {
    const source = fs.readFileSync(path.join(__dirname, '../../', file), 'utf8');
    const explicitLoaderSizes = source.match(/--loader-size\s*:\s*\d+px|setProperty\('--loader-size', '\d+px'\)/g) || [];
    for (const declaration of explicitLoaderSizes) {
      assert.match(declaration, /58px/, `${file} heeft nog een afwijkende loadermaat: ${declaration}`);
    }

    const cssRulePattern = /\.([a-zA-Z0-9_-]*(?:spin|spinner|loader)[a-zA-Z0-9_-]*)[^{}]*\{([^{}]*)\}/g;
    for (const match of source.matchAll(cssRulePattern)) {
      const [, className, body] = match;
      const exceptionSize = compactInlineLoaderExceptions.get(`${file}:.${className}`);
      const sizeDeclarations = body.match(/\b(?:width|height)\s*:\s*\d+px/g) || [];
      for (const declaration of sizeDeclarations) {
        assert.match(
          declaration,
          exceptionSize ? new RegExp(exceptionSize) : /58px/,
          `${file} heeft nog een afwijkende laadicoonmaat in .${className}: ${declaration}`
        );
      }
    }
  }
});

test('coldcalling-dashboard beëindigt premium boot-shell na bootstrap', () => {
  const scriptPath = path.join(__dirname, '../../assets/coldcalling-dashboard.js');
  const source = fs.readFileSync(scriptPath, 'utf8');
  assert.match(
    source,
    /async function bootstrapColdcallingUi\(\) \{[\s\S]*finally \{[\s\S]*setShellBooting\(false\)/
  );
});
