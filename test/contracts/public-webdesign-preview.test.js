const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const {
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
  assert.equal(response.headers['Cache-Control'], 'no-store');
  assert.match(response.body, /https:\/\/cdn\.softora\.test\/aagje-webdesign\.png/);
  assert.match(response.body, /https:\/\/cdn\.softora\.test\/aagje-mockup\.jpg/);
  assert.doesNotMatch(response.body, /Aagje van Os/);
  assert.doesNotMatch(response.body, /· naast elkaar/);
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

test('public webdesign preview route exposes the shareable mailklaar page', () => {
  const routes = [];
  const app = {
    get(path, handler) {
      routes.push({ method: 'GET', path, handler });
    },
  };

  registerPublicWebdesignPreviewRoutes(app, {
    coordinator: { getPreviewPageResponse() {} },
  });

  assert.deepEqual(routes.map((route) => [route.method, route.path]), [
    ['GET', '/mailklaar/:customerId'],
  ]);
});

test('public webdesign preview is wired into feature routes', () => {
  const featureRoutes = fs.readFileSync(
    path.join(__dirname, '../../server/services/feature-routes-runtime.js'),
    'utf8'
  );

  assert.match(featureRoutes, /createPublicWebdesignPreviewService/);
  assert.match(featureRoutes, /registerPublicWebdesignPreviewRoutes/);
});
