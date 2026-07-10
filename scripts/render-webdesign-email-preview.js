const fs = require('node:fs');
const path = require('node:path');

const {
  WEBDESIGN_EMAIL_TEMPLATE_VERSION,
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

const html = `<!doctype html>
<html lang="nl">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:24px;background:#ffffff;">
  <div class="softora-webdesign-email-body" data-softora-template-version="${WEBDESIGN_EMAIL_TEMPLATE_VERSION}" style="font-family:Arial,sans-serif;font-size:15px;line-height:1.65;color:#1a1a2e;width:100%;max-width:900px;-webkit-text-size-adjust:100%;text-size-adjust:100%;">
    <div style="width:100%;max-width:600px;">
      <p style="margin:0 0 18px 0;font-size:15px;line-height:1.65;">Goedendag,</p>
      <p style="margin:0 0 18px 0;font-size:15px;line-height:1.65;">Afgelopen week kwam ik jullie website (<span style="white-space:nowrap;word-break:keep-all;overflow-wrap:normal;">voorbeeldbedrijf.nl</span>) tegen.</p>
      <p style="margin:0 0 18px 0;font-size:15px;line-height:1.65;">Met vriendelijke groet,<br>Servé Creusen</p>
    </div>
    ${imagesHtml}
  </div>
</body>
</html>`;

const outputPath = path.resolve(process.argv[2] || '/tmp/softora-webdesign-email-preview.html');
fs.writeFileSync(outputPath, html);
process.stdout.write(`${outputPath}\n`);
