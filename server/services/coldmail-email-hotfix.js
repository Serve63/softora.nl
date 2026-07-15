'use strict';

const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');

const TARGET = path.resolve(__dirname, 'coldmail-campaign.js');
const originalLoader = Module._extensions['.js'];

function replaceRequired(source, from, to, label) {
  if (!source.includes(from)) {
    throw new Error(`[ColdmailEmailHotfix] Verwachte code niet gevonden: ${label}`);
  }
  return source.replace(from, to);
}

Module._extensions['.js'] = function softoraColdmailHotfix(module, filename) {
  if (path.resolve(filename) !== TARGET) {
    return originalLoader(module, filename);
  }

  let source = fs.readFileSync(filename, 'utf8');

  source = replaceRequired(
    source,
    "'Afgelopen week kwam ik jullie website, {{website}}, tegen.',",
    "'Afgelopen week kwam ik jullie website {{website}} tegen.',",
    'komma rond websitevariabele verwijderen'
  );

  source = replaceRequired(
    source,
    'style="color:#0a66c2;text-decoration:underline;font-weight:700;">link</a>',
    'style="color:#0a66c2;text-decoration:underline;font-weight:400;">link</a>',
    'niet-vette previewlink'
  );

  source = replaceRequired(
    source,
    '    return renderColdmailHtmlText(cleanLine);',
    '    return escapeHtml(cleanLine);',
    'website als veilige niet-klikbare tekst die mobiel mag afbreken'
  );

  source = replaceRequired(
    source,
    "      const shouldPrepareMockup = shouldSendWebdesignImages && webdesignImageDelivery !== 'attachment';",
    "      const shouldPrepareMockup = shouldSendWebdesignImages && Boolean(webdesignPhoto.mockup);",
    'mockup voorbereiden voor bijlage'
  );

  source = replaceRequired(
    source,
    '              includeMockup: false,',
    '              includeMockup: true,',
    'mockup als tweede bijlage'
  );

  source = replaceRequired(
    source,
    '        filename: image.filename || filenameForImage(fallbackName, image.contentType, fallbackName),',
    "        filename: filenameForImage(fallbackName === 'device-mockup' ? 'Mockup' : 'Webdesign', image.contentType, fallbackName),",
    'vaste duidelijke bijlagenamen'
  );

  source = replaceRequired(
    source,
    '      attachments.length !== 1 ||',
    '      attachments.length !== 2 ||',
    'veiligheidscheck voor twee bijlagen'
  );

  module._compile(source, filename);
};
