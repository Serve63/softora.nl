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
  assert.match(response.body, /mockup-stage/);
  assert.match(response.body, /\.tall\{width:min\(36%,430px\)/);
  assert.match(response.body, /\.tall \.visual\{aspect-ratio:3\/4\.45;object-fit:cover;object-position:top center\}/);
  assert.match(response.body, /\.about-photo img\{display:block;width:100%;height:auto;object-fit:contain\}/);
  assert.doesNotMatch(response.body, /Over dit concept/);
  assert.match(response.body, /serve-creusen-profile\.jpg\?v=20260608b/);
  assert.match(response.body, /Piggy’s Kadoshop Hilvarenbeek/);
  assert.match(response.body, /https:\/\/cdn\.softora\.test\/piggy-webdesign\.png/);
  assert.match(response.body, /https:\/\/cdn\.softora\.test\/piggy-mockup\.jpg/);
  assert.doesNotMatch(response.body, /type="file"/);
  assert.doesNotMatch(response.body, /function load/);
  assert.doesNotMatch(response.body, /background:#121212/);
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
