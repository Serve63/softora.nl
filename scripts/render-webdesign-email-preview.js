const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  WEBDESIGN_EMAIL_TEMPLATE_VERSION,
  renderWebdesignEmailDocument,
  renderWebdesignImageSection,
} = require('../server/services/webdesign-email-renderer');

function svgDataUrl(label, background, accent) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="900" viewBox="0 0 1200 900">
    <rect width="1200" height="900" fill="${background}"/>
    <rect x="80" y="70" width="1040" height="760" rx="32" fill="#ffffff"/>
    <rect x="120" y="115" width="960" height="250" rx="20" fill="${accent}"/>
    <rect x="120" y="410" width="430" height="300" rx="20" fill="#eef2f7"/>
    <rect x="590" y="410" width="490" height="300" rx="20" fill="#dbe7f3"/>
    <text x="600" y="785" text-anchor="middle" font-family="Arial" font-size="64" font-weight="700" fill="#172033">${label}</text>
  </svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
}

const imagesHtml = renderWebdesignImageSection(
  {
    src: svgDataUrl('WEBDESIGN', '#f4f6f8', '#9d2f68'),
    alt: 'Softora voorbeeld webdesign',
  },
  {
    mockupImage: {
      src: svgDataUrl('DEVICE MOCKUP', '#eef4fb', '#1f7a68'),
      alt: 'Softora voorbeeld device mockup',
    },
  }
);

const html = renderWebdesignEmailDocument(`
  <div style="padding:24px;background:#ffffff;">
  <div class="softora-webdesign-email-body" data-softora-template-version="${WEBDESIGN_EMAIL_TEMPLATE_VERSION}" style="font-family:Arial,sans-serif;font-size:16px;line-height:26px;color:#1a1a2e;width:100%;max-width:600px;min-width:0;box-sizing:border-box;overflow-wrap:anywhere;word-break:normal;-webkit-text-size-adjust:100%;text-size-adjust:100%;">
      <p style="margin:0 0 18px 0;font-family:Arial,sans-serif;font-size:16px;line-height:26px;max-width:100%;overflow-wrap:anywhere;word-break:normal;">Goedendag,</p>
      <p style="margin:0 0 18px 0;font-family:Arial,sans-serif;font-size:16px;line-height:26px;max-width:100%;overflow-wrap:anywhere;word-break:normal;">Afgelopen week kwam ik jullie website voorbeeldbedrijf-met-een-lange-domeinnaam.nl tegen.</p>
      <p style="margin:0 0 18px 0;font-family:Arial,sans-serif;font-size:16px;line-height:26px;max-width:100%;overflow-wrap:anywhere;word-break:normal;">Uit enthousiasme heb ik een fris webdesign gemaakt, gewoon omdat ik dat leuk vind. Je vindt het ontwerp in de bijlage bij deze e-mail.</p>
      <p style="margin:0 0 18px 0;font-family:Arial,sans-serif;font-size:16px;line-height:26px;max-width:100%;overflow-wrap:anywhere;word-break:normal;">Met vriendelijke groet,<br>Servé Creusen</p>
    ${imagesHtml}
  </div>
  </div>`);

const outputPath = path.join(os.tmpdir(), 'softora-webdesign-email-preview.html');
fs.writeFileSync(outputPath, html);
process.stdout.write(`${outputPath}\n`);
