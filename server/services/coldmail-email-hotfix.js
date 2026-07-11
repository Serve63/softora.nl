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
    'website als niet-klikbare gewone tekst'
  );

  source = replaceRequired(
    source,
    "  const body = normalizeString(text)\n      .split(/\\n{2,}/)",
    "  const desktopNoWrapSentences = [\n      'Je vindt het ontwerp in de bijlage bij deze e-mail.',\n      'Daar leer ik dan weer van!',\n      'Dan kun je het webdesign ook via deze link bekijken 🎨',\n    ];\n    const wrapDesktopSentences = (html) => desktopNoWrapSentences.reduce(\n      (result, sentence) => result.replace(\n        escapeHtml(sentence),\n        `<span class=\"softora-desktop-nowrap\">${escapeHtml(sentence)}</span>`\n      ),\n      html\n    );\n    const body = normalizeString(text)\n      .split(/\\n{2,}/)",
    'desktop nowrap-zinnen'
  );

  source = replaceRequired(
    source,
    "      .join('\\n');\n    return `<div class=\"softora-webdesign-email-body",
    "      .join('\\n');\n    const desktopCss = '<style>@media screen and (min-width:601px){.softora-desktop-nowrap{white-space:nowrap!important;}}</style>';\n    return `${desktopCss}<div class=\"softora-webdesign-email-body",
    'desktop-only CSS'
  );

  source = replaceRequired(
    source,
    "        const cleanParagraph = normalizeString(paragraph);\n        if (COLDMAIL_IMAGE_VISIBILITY_PS_PATTERN.test(cleanParagraph)) {\n          return `<p style=\"${paragraphStyle}\">${renderImageVisibilityPsHtmlLine(cleanParagraph, options)}</p>`;\n        }\n        return `<p style=\"${paragraphStyle}\">${paragraph",
    "        const cleanParagraph = normalizeString(paragraph);\n        if (COLDMAIL_IMAGE_VISIBILITY_PS_PATTERN.test(cleanParagraph)) {\n          return `<p style=\"${paragraphStyle}\">${wrapDesktopSentences(renderImageVisibilityPsHtmlLine(cleanParagraph, options))}</p>`;\n        }\n        return `<p style=\"${paragraphStyle}\">${wrapDesktopSentences(paragraph",
    'nowrap toepassen op HTML-alinea’s'
  );

  source = replaceRequired(
    source,
    "            .join('<br>')}</p>`;",
    "            .join('<br>'))}</p>`;",
    'nowrap helper correct afsluiten'
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
