const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const {
  CUSTOMER_KEY,
  CUSTOMER_SCOPE,
  PHOTO_KEY,
  PHOTO_SCOPE,
  createPublicWebdesignPreviewService,
} = require('../../server/services/public-webdesign-preview');
const {
  registerPublicWebdesignPreviewRoutes,
} = require('../../server/routes/public-webdesign-preview');

function readJpegSize(filePath) {
  const buffer = fs.readFileSync(filePath);
  let offset = 2;
  if (buffer[0] !== 0xff || buffer[1] !== 0xd8) {
    throw new Error(`Expected JPEG image at ${filePath}`);
  }

  while (offset < buffer.length) {
    while (buffer[offset] === 0xff) offset += 1;
    const marker = buffer[offset];
    offset += 1;
    const length = buffer.readUInt16BE(offset);
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      return {
        height: buffer.readUInt16BE(offset + 3),
        width: buffer.readUInt16BE(offset + 5),
      };
    }
    offset += length;
  }

  throw new Error(`Could not read JPEG dimensions for ${filePath}`);
}

function readPngSize(filePath) {
  const buffer = fs.readFileSync(filePath);
  const pngSignature = '89504e470d0a1a0a';
  if (buffer.subarray(0, 8).toString('hex') !== pngSignature) {
    throw new Error(`Expected PNG image at ${filePath}`);
  }
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
  };
}

function createResponseRecorder() {
  return {
    headers: {},
    statusCode: 200,
    body: '',
    setHeader(name, value) {
      this.headers[name] = value;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    send(body) {
      this.body = body;
      return body;
    },
  };
}

async function renderConceptForStructuredCustomer(customer, photoOverrides = {}) {
  const id = customer.id || customer.customerId || 'manual-import-alias-test-nl-0001';
  const service = createPublicWebdesignPreviewService({
    async getUiStateValues() {
      return { values: {} };
    },
    dataOpsStore: {
      async listCustomers() {
        return [customer];
      },
      async listDesignPhotosWithSignedUrls() {
        return [{
          customerId: id,
          fileName: 'alias-test-webdesign.png',
          websitePhotoUrl: 'https://signed.softora.test/alias-webdesign.png?token=test',
          websiteMockupUrl: 'https://signed.softora.test/alias-mockup.jpg?token=test',
          ...photoOverrides,
        }];
      },
    },
  });
  const response = createResponseRecorder();
  await service.getConceptPageResponse({ params: { companySlug: 'alias-test' } }, response);
  assert.equal(response.statusCode, 200);
  return response.body;
}

test('public webdesign preview renders only the two images for a stored mail-ready customer', async () => {
  let requestedScope = '';
  const service = createPublicWebdesignPreviewService({
    async getUiStateValues(scope) {
      requestedScope = scope;
      return {
        values: {
          [PHOTO_KEY]: JSON.stringify({
            'customer-1': {
              id: 'customer-1',
              websitePhotoUrl: 'https://cdn.softora.test/aagje-webdesign.png',
              websiteMockupUrl: 'https://cdn.softora.test/aagje-mockup.jpg',
              websitePhotoName: 'Aagje van Os webdesign.png',
              websiteMockupName: 'Aagje van Os device mockup.jpg',
            },
          }),
        },
      };
    },
  });
  const response = createResponseRecorder();

  await service.getPreviewPageResponse({ params: { customerId: 'customer-1' } }, response);

  assert.equal(requestedScope, PHOTO_SCOPE);
  assert.equal(response.statusCode, 200);
  assert.match(response.headers['Cache-Control'], /s-maxage=900/);
  assert.match(response.body, /https:\/\/cdn\.softora\.test\/aagje-webdesign\.png/);
  assert.match(response.body, /https:\/\/cdn\.softora\.test\/aagje-mockup\.jpg/);
  assert.match(response.body, /rel="preload" as="image"/);
  assert.match(response.body, /fetchpriority="high"/);
  assert.match(response.body, /website-frame/);
  assert.match(response.body, /mockup-frame/);
  assert.match(response.body, /background:#121212/);
  assert.match(response.body, /background:transparent/);
  assert.doesNotMatch(response.body, /background:#fff/);
  assert.doesNotMatch(response.body, /concept-hero/);
  assert.doesNotMatch(response.body, /serve-creusen-profile/);
  assert.doesNotMatch(response.body, /Aagje van Os/);
  assert.doesNotMatch(response.body, /· naast elkaar/);
});

test('public webdesign preview concept route renders the experimental supplied layout separately', async () => {
  const service = createPublicWebdesignPreviewService({
    async getUiStateValues() {
      return {
        values: {
          [PHOTO_KEY]: JSON.stringify({
            'customer-1': {
              id: 'customer-1',
              bedrijf: 'Piggy’s Kadoshop Hilvarenbeek',
              websitePhotoUrl: 'https://cdn.softora.test/piggy-webdesign.png',
              websiteMockupUrl: 'https://cdn.softora.test/piggy-mockup.jpg',
            },
          }),
        },
      };
    },
  });
  const response = createResponseRecorder();

  await service.getConceptPageResponse({ params: { customerId: 'customer-1' } }, response);

  assert.equal(response.statusCode, 200);
  assert.match(response.body, /concept-hero/);
  assert.match(response.body, /\.concept-hero\{min-height:100svh;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:56px clamp\(18px,4vw,64px\);gap:44px;position:relative\}/);
  assert.match(response.body, /\.mockup-stage\{display:flex;align-items:flex-end;justify-content:center;gap:38px;width:100%;max-width:1440px;padding:0 clamp\(0px,3vw,44px\)\}/);
  assert.match(response.body, /\.wide-stack\{width:min\(54%,780px\);display:flex;flex-direction:column;align-items:center;gap:22px\}/);
  assert.doesNotMatch(response.body, /mobile-mockup-intro/);
  assert.match(response.body, /@media\(max-width:900px\)\{[\s\S]*\.mockup-stage\{flex-direction:column;padding:0\}\.wide-stack\{display:contents\}\.hero-heading\{order:-1;width:100%\}\.tall\{width:100%;order:0\}\.wide\{width:100%;order:1\}/);
  assert.doesNotMatch(response.body, /\.wide-stack\{order:-1\}/);
  assert.match(response.body, /<div class="wide-stack">\s*<div class="hero-heading">\s*<span class="hero-label">Webdesign presentatie<\/span>\s*<h1 class="hero-title">Piggy’s Kadoshop Hilvarenbeek<\/h1>\s*<\/div>\s*<div class="stage-card wide">/);
  assert.doesNotMatch(response.body, /Een eerste indruk/);
  assert.doesNotMatch(response.body, /Eerste indruk op elk schermformaat/);
  assert.doesNotMatch(response.body, /Een korte indruk van de eerste versie/);
  assert.match(response.body, /\.tall\{width:min\(42%,540px\)/);
  assert.match(response.body, /\.tall \.visual\{height:auto;aspect-ratio:auto;object-fit:contain;object-position:top center\}/);
  assert.match(response.body, /\.scroll-cue\{position:fixed;right:clamp\(18px,4vw,56px\);bottom:clamp\(18px,3\.5vw,42px\);z-index:20;width:46px;height:46px;border-radius:999px;display:grid;place-items:center/);
  assert.match(response.body, /\.scroll-cue:hover\{background:#fff\}/);
  assert.match(response.body, /@media\(max-width:700px\)\{\.scroll-cue\{display:none\}\}/);
  assert.doesNotMatch(response.body, /scrollCue/);
  assert.doesNotMatch(response.body, /animation:scrollCue/);
  assert.doesNotMatch(response.body, /translateY/);
  assert.match(response.body, /<a class="scroll-cue" href="#concept-about" aria-label="Scroll naar meer informatie"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14"><\/path><path d="m19 12-7 7-7-7"><\/path><\/svg><\/a>/);
  assert.match(response.body, /<section class="about-section" id="concept-about">/);
  assert.match(response.body, /\.about-profile\{width:min\(100%,340px\);justify-self:center\}/);
  assert.match(response.body, /\.desktop-profile-role\{display:none\}/);
  assert.match(response.body, /@media\(min-width:1121px\)\{\.about-section\{grid-template-columns:minmax\(0,760px\);gap:24px;max-width:860px\}\.about-profile\{width:100%;justify-self:start;display:flex;align-items:center;gap:16px\}\.desktop-profile-role\{display:none\}\.about-photo\{width:86px;flex:0 0 86px;border-radius:16px;aspect-ratio:1\/1\}\.profile-signature\{margin-top:0;text-align:left\}\.profile-signature span\{display:block;font-size:10\.5px;line-height:1\.35\}\}/);
  assert.match(response.body, /\.profile-signature\{margin-top:18px;padding-top:0;text-align:center;border-top:0\}/);
  assert.match(response.body, /\.about-photo\{width:100%;border-radius:18px;aspect-ratio:4\/3;overflow:hidden/);
  assert.match(response.body, /\.about-photo img\{display:block;width:100%;height:100%;object-fit:cover;object-position:center\}/);
  assert.match(response.body, /\.about-text h2\{font-family:Georgia,'Times New Roman',serif;font-size:clamp\(22px,1\.9vw,28px\);color:var\(--navy\);line-height:1\.3;margin-bottom:18px;font-weight:600\}/);
  assert.match(response.body, /\.about-text h2 \.title-line\{display:block;white-space:nowrap\}/);
  assert.match(response.body, /\.about-text p\{font-size:14px;color:var\(--muted\);line-height:1\.85;margin-bottom:12px\}/);
  assert.match(response.body, /@media\(max-width:1120px\)\{[\s\S]*\.about-profile\{display:flex;flex-direction:column\}\.profile-signature\{order:-1;margin:0 0 18px;padding:0 0 18px;border-top:0;border-bottom:0\}/);
  assert.match(response.body, /@media\(max-width:700px\)\{\.about-photo\{width:min\(100%,250px\);align-self:center\}\.about-text h2\{font-size:clamp\(13px,4\.1vw,22px\);text-align:center\}\}/);
  assert.match(response.body, /<div class="about-profile">\s*<div class="desktop-profile-role">Webdesign &amp; Software Ontwikkeling<\/div>\s*<div class="about-photo">[\s\S]*<div class="signature profile-signature">\s*<strong>Servé Creusen<\/strong>\s*<span>Webdesign &amp; Software Ontwikkeling<\/span>\s*<\/div>\s*<\/div>\s*<div class="about-text">/);
  assert.match(response.body, /<h2>Zó heb ik het webdesign gebouwd!<\/h2>/);
  assert.match(response.body, /<p>Begonnen met HTML-code en een leeg scherm\. De structuur, indeling en techniek heb ik stap voor stap opgebouwd\. Vanuit daar heb ik gekeken hoe de website logisch, overzichtelijk en prettig werkt voor bezoekers\.<\/p>/);
  assert.match(response.body, /<p>Ook heb ik de concurrenten van Piggy’s Kadoshop Hilvarenbeek in kaart gebracht\. Niet om te kopiëren, maar om te zien wat in deze markt sterk werkt: welke opbouw vertrouwen geeft, welke details bezoekers helpen en waar kansen liggen om het net frisser en beter neer te zetten\.<\/p>/);
  assert.match(response.body, /<p>Die inzichten heb ik meegenomen in dit ontwerp\. Zo ontstaat een website die niet alleen mooi oogt, maar ook duidelijk, klantgericht en doordacht aanvoelt\.<\/p>/);
  assert.match(response.body, /<p>Later in het proces heb ik moderne AI-technologie subtiel ingezet om de visuele sfeer en uitstraling verder te versterken\.<\/p>/);
  assert.match(response.body, /<p>Naast webdesign bouw ik ook bedrijfssoftware, dashboards en klantportalen\. Ook voor onderhoud en doorontwikkeling denk ik graag mee\.<\/p>/);
  assert.doesNotMatch(response.body, /concurrenten van \{\{website\}\}/);
  assert.doesNotMatch(response.body, /Hoe heb ik dit webdesign gebouwd/);
  assert.doesNotMatch(response.body, /<p>De basis heb ik zelf opgebouwd/);
  assert.doesNotMatch(response.body, /Gebouwd met software, nieuwsgierigheid/);
  assert.doesNotMatch(response.body, /full-stack developer ook bedrijfssoftware op maat/);
  assert.doesNotMatch(response.body, /<p>Dit design is tot stand gekomen/);
  assert.doesNotMatch(response.body, /<p>Kleine details kunnen nog afwijken/);
  assert.doesNotMatch(response.body, /Over dit concept/);
  assert.match(response.body, /serve-creusen-profile\.jpg\?v=20260608e/);
  assert.match(response.body, /Piggy’s Kadoshop Hilvarenbeek/);
  assert.match(response.body, /https:\/\/cdn\.softora\.test\/piggy-webdesign\.png/);
  assert.match(response.body, /https:\/\/cdn\.softora\.test\/piggy-mockup\.jpg/);
  assert.doesNotMatch(response.body, /type="file"/);
  assert.doesNotMatch(response.body, /function load/);
  assert.doesNotMatch(response.body, /background:#121212/);
});

test('public webdesign preview concept route switches the profile by sender context', async () => {
  let customerReads = 0;
  const service = createPublicWebdesignPreviewService({
    async getUiStateValues() {
      return { values: {} };
    },
    dataOpsStore: {
      async listCustomers() {
        customerReads += 1;
        return [{
          id: 'manual-import-bakkerij-janssen-nl-0001',
          bedrijf: 'Bakkerij Janssen',
          lastColdmailSenderEmail: 'martijn@softora.nl',
        }];
      },
      async listDesignPhotosWithSignedUrls() {
        return [{
          customerId: 'manual-import-bakkerij-janssen-nl-0001',
          fileName: 'bakkerij-janssen-webdesign.png',
          websitePhotoUrl: 'https://signed.softora.test/bakkerij-webdesign.png?token=test',
          websiteMockupUrl: 'https://signed.softora.test/bakkerij-mockup.jpg?token=test',
        }];
      },
    },
  });
  const response = createResponseRecorder();

  await service.getConceptPageResponse({ params: { companySlug: 'bakkerij-janssen' } }, response);

  assert.equal(response.statusCode, 200);
  assert.equal(customerReads, 1);
  assert.match(response.body, /<h1 class="hero-title">Bakkerij Janssen<\/h1>/);
  assert.match(response.body, /<img src="\/assets\/martijn-van-de-ven-profile\.png\?v=20260609a" alt="Martijn van de Ven"/);
  assert.match(response.body, /<strong>Martijn van de Ven<\/strong>/);
  assert.match(response.body, /<span>Webdesign &amp; Software Ontwikkeling<\/span>/);
  assert.match(response.body, /<p>Ook heb ik de concurrenten van Bakkerij Janssen in kaart gebracht\./);
  assert.doesNotMatch(response.body, /Servé Creusen/);
  assert.doesNotMatch(response.body, /Piggy’s Kadoshop/);
});

test('public webdesign preview maps every known sender alias to the canonical profile', async () => {
  const cases = [
    ['serve@softora.nl', 'Servé Creusen', 'serve-creusen-profile.jpg', 'Martijn van de Ven'],
    ['servecreusen@softora.nl', 'Servé Creusen', 'serve-creusen-profile.jpg', 'Martijn van de Ven'],
    ['servec321@gmail.com', 'Servé Creusen', 'serve-creusen-profile.jpg', 'Martijn van de Ven'],
    ['serve290@gmail.com', 'Servé Creusen', 'serve-creusen-profile.jpg', 'Martijn van de Ven'],
    ['servecreusen7@gmail.com', 'Servé Creusen', 'serve-creusen-profile.jpg', 'Martijn van de Ven'],
    ['contact.venvisuals@gmail.com', 'Servé Creusen', 'serve-creusen-profile.jpg', 'Martijn van de Ven'],
    ['serve@websoftora.com', 'Servé Creusen', 'serve-creusen-profile.jpg', 'Martijn van de Ven'],
    ['servecreusen@websoftora.com', 'Servé Creusen', 'serve-creusen-profile.jpg', 'Martijn van de Ven'],
    ['martijn@softora.nl', 'Martijn van de Ven', 'martijn-van-de-ven-profile.png', 'Servé Creusen'],
    ['martijnvandeven@softora.nl', 'Martijn van de Ven', 'martijn-van-de-ven-profile.png', 'Servé Creusen'],
    ['martijnven123@gmail.com', 'Martijn van de Ven', 'martijn-van-de-ven-profile.png', 'Servé Creusen'],
    ['martijn@websoftora.com', 'Martijn van de Ven', 'martijn-van-de-ven-profile.png', 'Servé Creusen'],
    ['martijnven@websoftora.com', 'Martijn van de Ven', 'martijn-van-de-ven-profile.png', 'Servé Creusen'],
    ['martijnvandeven@websoftora.com', 'Martijn van de Ven', 'martijn-van-de-ven-profile.png', 'Servé Creusen'],
  ];

  for (const [senderEmail, expectedName, expectedPhoto, unexpectedName] of cases) {
    const body = await renderConceptForStructuredCustomer({
      id: `manual-import-${senderEmail.replace(/[^a-z0-9]+/gi, '-')}`,
      bedrijf: 'Alias Test',
      lastColdmailSenderEmail: senderEmail,
      leadOwnerKey: expectedName === 'Servé Creusen' ? 'martijn' : 'serve',
      senderDisplayName: 'Niet tonen als variabele naam',
      senderProfilePhotoUrl: 'https://wrong.softora.test/profile.jpg',
      profilePhotoUrl: 'https://wrong.softora.test/other-profile.jpg',
    });

    assert.match(body, new RegExp(`<strong>${expectedName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}<\\/strong>`), senderEmail);
    assert.match(body, new RegExp(expectedPhoto.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), senderEmail);
    assert.doesNotMatch(body, new RegExp(`<strong>${unexpectedName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}<\\/strong>`), senderEmail);
    assert.doesNotMatch(body, /wrong\.softora\.test/, senderEmail);
    assert.doesNotMatch(body, /Niet tonen als variabele naam/, senderEmail);
  }
});

test('public webdesign preview lets the sent mailbox beat owner fallback fields', async () => {
  const body = await renderConceptForStructuredCustomer({
    id: 'manual-import-mail-sender-wins-nl-0001',
    bedrijf: 'Mail Sender Wins',
    leadOwnerKey: 'serve',
    ownerName: 'Servé Creusen',
    sentFromEmail: 'martijnven@websoftora.com',
  });

  assert.match(body, /<strong>Martijn van de Ven<\/strong>/);
  assert.match(body, /martijn-van-de-ven-profile\.png/);
  assert.doesNotMatch(body, /<strong>Servé Creusen<\/strong>/);
});

test('public webdesign preview uses owner fields only when no sent mailbox is known', async () => {
  const body = await renderConceptForStructuredCustomer({
    id: 'manual-import-owner-fallback-nl-0001',
    bedrijf: 'Owner Fallback',
    leadOwnerKey: 'martijn',
  });

  assert.match(body, /<strong>Martijn van de Ven<\/strong>/);
  assert.match(body, /martijn-van-de-ven-profile\.png/);
});

test('public webdesign preview defaults to Serve for unknown sender variables', async () => {
  const body = await renderConceptForStructuredCustomer({
    id: 'manual-import-unknown-sender-nl-0001',
    bedrijf: 'Unknown Sender',
    lastColdmailSenderEmail: 'service@example.test',
    senderDisplayName: 'Service Team',
    profilePhotoUrl: 'https://wrong.softora.test/profile.jpg',
  });

  assert.match(body, /<strong>Servé Creusen<\/strong>/);
  assert.match(body, /serve-creusen-profile\.jpg/);
  assert.doesNotMatch(body, /Service Team/);
  assert.doesNotMatch(body, /wrong\.softora\.test/);
});

test('public webdesign preview profile image is exported sharp enough for the cover crop', () => {
  const profilePath = path.join(__dirname, '../../assets/serve-creusen-profile.jpg');
  const { width, height } = readJpegSize(profilePath);

  assert.ok(width >= 1200);
  assert.ok(height >= 900);
  assert.equal(width * 3, height * 4);
});

test('public webdesign preview includes Martijn profile image asset', () => {
  const profilePath = path.join(__dirname, '../../assets/martijn-van-de-ven-profile.png');
  const { width, height } = readPngSize(profilePath);

  assert.ok(width >= 600);
  assert.ok(height >= 600);
  assert.equal(width, height);
});

test('public webdesign preview does not cache unavailable preview responses', async () => {
  const service = createPublicWebdesignPreviewService({
    async getUiStateValues() {
      return { values: {} };
    },
  });
  const response = createResponseRecorder();

  await service.getConceptPageResponse({ params: { companySlug: 'missing-preview' } }, response);

  assert.equal(response.statusCode, 404);
  assert.equal(response.headers['Cache-Control'], 'no-store, max-age=0, must-revalidate');
  assert.match(response.body, /Deze preview is niet beschikbaar/);
});

test('public webdesign preview concept route cleans internal import ids from fallback titles', async () => {
  const service = createPublicWebdesignPreviewService({
    async getUiStateValues() {
      return {
        values: {
          [PHOTO_KEY]: JSON.stringify({
            'manual-import-piggys-nl-contact-0574': {
              id: 'manual-import-piggys-nl-contact-0574',
              websitePhotoUrl: 'https://cdn.softora.test/piggy-webdesign.png',
              websiteMockupUrl: 'https://cdn.softora.test/piggy-mockup.jpg',
            },
          }),
        },
      };
    },
  });
  const response = createResponseRecorder();

  await service.getConceptPageResponse({
    params: { companySlug: 'piggy-s-kadoshop' },
    query: { cid: 'manual-import-piggys-nl-contact-0574' },
  }, response);

  assert.equal(response.statusCode, 200);
  assert.match(response.body, /Piggy&#39;s Kadoshop/);
  assert.doesNotMatch(response.body, /Manual Import/i);
  assert.doesNotMatch(response.body, /Contact 0574/i);
});

test('public webdesign preview can read legacy chunked image data', async () => {
  const photo = 'data:image/png;base64,AAA';
  const mockup = 'data:image/jpeg;base64,BBB';
  const service = createPublicWebdesignPreviewService({
    async getUiStateValues() {
      return {
        values: {
          [PHOTO_KEY]: JSON.stringify({
            'customer-2': {
              id: 'customer-2',
              photoKey: 'photo_key',
              chunkCount: 1,
              mockupPhotoKey: 'mockup_key',
              mockupChunkCount: 1,
            },
          }),
          photo_key_0: photo,
          mockup_key_0: mockup,
        },
      };
    },
  });

  const preview = await service.resolvePreview('customer-2');

  assert.equal(preview.photoSource, photo);
  assert.equal(preview.mockupSource, mockup);
});

test('public webdesign preview resolves current database ids through customer identity keys', async () => {
  const requestedScopes = [];
  const service = createPublicWebdesignPreviewService({
    async getUiStateValues(scope) {
      requestedScopes.push(scope);
      if (scope === CUSTOMER_SCOPE) {
        return {
          values: {
            [CUSTOMER_KEY]: JSON.stringify([{
              id: 'manual-import-aagje-eu-0070',
              bedrijf: 'Aagje van Os',
              naam: 'Aagje van Os',
              tel: '0612345678',
            }]),
          },
        };
      }
      return {
        values: {
          [PHOTO_KEY]: JSON.stringify({
            'manual-import-aagje-eu-0070': {
              id: 'manual-import-aagje-eu-0070',
              websitePhotoUrl: 'https://cdn.softora.test/incomplete-direct-photo.png',
            },
            'old-photo-row': {
              id: 'old-photo-row',
              identityKey: 'aagje van os|aagje van os|0612345678',
              websitePhotoUrl: 'https://cdn.softora.test/aagje-current-webdesign.png',
              websiteMockupUrl: 'https://cdn.softora.test/aagje-current-mockup.jpg',
            },
          }),
        },
      };
    },
  });

  const preview = await service.resolvePreview('aagje-van-os');

  assert.deepEqual(requestedScopes, [PHOTO_SCOPE, CUSTOMER_SCOPE]);
  assert.equal(preview.photoSource, 'https://cdn.softora.test/aagje-current-webdesign.png');
  assert.equal(preview.mockupSource, 'https://cdn.softora.test/aagje-current-mockup.jpg');
});

test('public webdesign preview isoleert ui-state fallback cooldowns van premium dashboard scopes', async () => {
  const reads = [];
  const service = createPublicWebdesignPreviewService({
    async getUiStateValues(scope, options) {
      reads.push({ scope, options });
      return { values: {} };
    },
  });

  const preview = await service.resolvePreview('ontbrekende-preview');

  assert.equal(preview, null);
  assert.deepEqual(reads, [
    {
      scope: PHOTO_SCOPE,
      options: {
        readFailureCooldownScope: 'public_webdesign_preview_premium_database_photos',
      },
    },
    {
      scope: CUSTOMER_SCOPE,
      options: {
        readFailureCooldownScope: 'public_webdesign_preview_premium_customers_database',
      },
    },
  ]);
});

test('public webdesign preview reads structured data ops storage before ui-state fallback', async () => {
  let uiStateReads = 0;
  let customerReads = 0;
  const signedOptions = [];
  const service = createPublicWebdesignPreviewService({
    async getUiStateValues() {
      uiStateReads += 1;
      return { values: {} };
    },
    dataOpsStore: {
      async listCustomers() {
        customerReads += 1;
        return [{
          id: 'manual-import-aagje-eu-0070',
          bedrijf: 'Aagje van Os',
          naam: 'Aagje van Os',
          tel: '06 20 10 00 50',
        }];
      },
      async listDesignPhotosWithSignedUrls(options) {
        signedOptions.push(options);
        return [{
          customerId: 'manual-import-aagje-eu-0070',
          identityKey: 'aagje van os|aagje van os|06 20 10 00 50',
          websitePhotoUrl: 'https://signed.softora.test/aagje-webdesign.png?token=test',
          websiteMockupUrl: 'https://signed.softora.test/aagje-mockup.jpg?token=test',
        }];
      },
    },
  });

  const preview = await service.resolvePreview('aagje-van-os');

  assert.equal(uiStateReads, 0);
  assert.equal(customerReads, 0);
  assert.deepEqual(signedOptions.map((options) => options.identifiers), [['aagje-van-os']]);
  assert.equal(signedOptions[0].suppressReadFailureCooldown, true);
  assert.equal(signedOptions[0].suppressStaleReadCacheLog, true);
  assert.equal(signedOptions[0].suppressTransientReadFailureLog, true);
  assert.equal(signedOptions[0].expiresInSeconds, 24 * 60 * 60);
  assert.equal(preview.id, 'manual-import-aagje-eu-0070');
  assert.equal(preview.photoSource, 'https://signed.softora.test/aagje-webdesign.png?token=test');
  assert.equal(preview.mockupSource, 'https://signed.softora.test/aagje-mockup.jpg?token=test');
});

test('public webdesign preview signs only targeted structured candidates after customer lookup', async () => {
  const signedOptions = [];
  const customerOptions = [];
  const service = createPublicWebdesignPreviewService({
    async getUiStateValues() {
      return { values: {} };
    },
    dataOpsStore: {
      async listCustomers(options) {
        customerOptions.push(options);
        return [{
          id: 'manual-import-rvh-nl-0123',
          bedrijf: 'R VH Montage Constructie Reparatie',
          website: 'rvhmontage.nl',
          tel: '0612345678',
        }];
      },
      async listDesignPhotosWithSignedUrls(options) {
        signedOptions.push(options);
        if (signedOptions.length === 1) return [];
        assert.equal(options.maxMatches, 12);
        assert.ok(options.identifiers.includes('manual-import-rvh-nl-0123'));
        assert.ok(options.identifiers.includes('R VH Montage Constructie Reparatie'));
        return [{
          customerId: 'manual-import-rvh-nl-0123',
          identityKey: 'r vh montage constructie reparatie||0612345678',
          websitePhotoUrl: 'https://signed.softora.test/rvh-webdesign.png?token=test',
          websiteMockupUrl: 'https://signed.softora.test/rvh-mockup.jpg?token=test',
        }];
      },
    },
  });

  const preview = await service.resolvePreview('r-vh-montage-constructie-reparatie');

  assert.equal(preview.id, 'manual-import-rvh-nl-0123');
  assert.equal(preview.photoSource, 'https://signed.softora.test/rvh-webdesign.png?token=test');
  assert.equal(preview.mockupSource, 'https://signed.softora.test/rvh-mockup.jpg?token=test');
  assert.equal(signedOptions.length, 2);
  assert.deepEqual(
    signedOptions.map((options) => [
      options.suppressReadFailureCooldown,
      options.suppressStaleReadCacheLog,
      options.suppressTransientReadFailureLog,
    ]),
    [[true, true, true], [true, true, true]]
  );
  assert.deepEqual(customerOptions, [{
    suppressReadFailureCooldown: true,
    suppressStaleReadCacheLog: true,
    suppressTransientReadFailureLog: true,
  }]);
});

test('public webdesign preview resolves sent company links from photo identity when customer stock is gone', async () => {
  const service = createPublicWebdesignPreviewService({
    async getUiStateValues() {
      return { values: {} };
    },
    dataOpsStore: {
      async listCustomers() {
        return [];
      },
      async listDesignPhotosWithSignedUrls() {
        return [{
          customerId: 'manual-import-cdenoudenmontage-nl-0041',
          identityKey: 'C. den Ouden Montage|Cor den Ouden|06 11 22 33 44',
          websitePhotoUrl: 'https://signed.softora.test/cdenouden-webdesign.png?token=test',
          websiteMockupUrl: 'https://signed.softora.test/cdenouden-mockup.jpg?token=test',
          fileName: 'cdenoudenmontage.nl-webdesign.png',
          legacyMeta: {
            websitePhotoName: 'cdenoudenmontage.nl-webdesign.png',
          },
        }];
      },
    },
  });

  const preview = await service.resolvePreview('c-den-ouden-montage');

  assert.equal(preview.id, 'manual-import-cdenoudenmontage-nl-0041');
  assert.equal(preview.photoSource, 'https://signed.softora.test/cdenouden-webdesign.png?token=test');
  assert.equal(preview.mockupSource, 'https://signed.softora.test/cdenouden-mockup.jpg?token=test');
});

test('public webdesign preview rescues compact BV slugs from stored photo filenames', async () => {
  const service = createPublicWebdesignPreviewService({
    async getUiStateValues() {
      return { values: {} };
    },
    dataOpsStore: {
      async listCustomers() {
        return [];
      },
      async listDesignPhotosWithSignedUrls() {
        return [{
          customerId: 'manual-import-pckbv-eu-privacy-0583',
          websitePhotoUrl: 'https://signed.softora.test/pckbv-webdesign.png?token=test',
          websiteMockupUrl: 'https://signed.softora.test/pckbv-mockup.jpg?token=test',
          fileName: 'pckbv.eu-preview.png',
          legacyMeta: {
            websitePhotoName: 'pckbv.eu-preview.png',
          },
        }];
      },
    },
  });

  const preview = await service.resolvePreview('pck-b-v');

  assert.equal(preview.id, 'manual-import-pckbv-eu-privacy-0583');
  assert.equal(preview.photoSource, 'https://signed.softora.test/pckbv-webdesign.png?token=test');
  assert.equal(preview.mockupSource, 'https://signed.softora.test/pckbv-mockup.jpg?token=test');
});

test('public webdesign preview lets hidden customer id query rescue a company slug link', async () => {
  const service = createPublicWebdesignPreviewService({
    async getUiStateValues() {
      return { values: {} };
    },
    dataOpsStore: {
      async listCustomers() {
        return [];
      },
      async listDesignPhotosWithSignedUrls() {
        return [{
          customerId: 'manual-import-aagje-eu-0070',
          websitePhotoUrl: 'https://signed.softora.test/aagje-webdesign.png?token=test',
          websiteMockupUrl: 'https://signed.softora.test/aagje-mockup.jpg?token=test',
        }];
      },
    },
  });
  const response = createResponseRecorder();

  await service.getPreviewPageResponse(
    { params: { companySlug: 'verkeerde-bedrijfsnaam' }, query: { cid: 'manual-import-aagje-eu-0070' } },
    response
  );

  assert.equal(response.statusCode, 200);
  assert.match(response.body, /aagje-webdesign\.png\?token=test/);
  assert.doesNotMatch(response.body, /Deze preview is niet beschikbaar/);
});

test('public webdesign preview route exposes the shareable webdesign page', () => {
  const routes = [];
  const app = {
    get(path, handler) {
      routes.push({ method: 'GET', path, handler });
    },
  };

  registerPublicWebdesignPreviewRoutes(app, {
    coordinator: { getConceptPageResponse() {}, getPreviewPageResponse() {} },
  });

  assert.deepEqual(routes.map((route) => [route.method, route.path]), [
    ['GET', '/webdesign/:companySlug/concept'],
    ['GET', '/webdesign/:companySlug'],
    ['GET', '/mailklaar/:customerId/concept'],
    ['GET', '/mailklaar/:customerId'],
  ]);
});

test('public webdesign preview is wired into feature routes', () => {
  const featureRoutes = fs.readFileSync(
    path.join(__dirname, '../../server/services/feature-routes-runtime.js'),
    'utf8'
  );

  assert.match(featureRoutes, /createPublicWebdesignPreviewService/);
  assert.match(featureRoutes, /dataOpsStore: deps\.dataOpsStore/);
  assert.match(featureRoutes, /registerPublicWebdesignPreviewRoutes/);
});
