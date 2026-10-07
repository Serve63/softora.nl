const { renderSeoSupportImage } = require('./seo-content-image-search');

function sectionId(section, index) {
  const slug = String(section.heading || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return `onderdeel-${index + 1}-${slug || 'uitleg'}`;
}

function renderReadingNavigation(item, escapeHtml) {
  const sections = Array.isArray(item.sections) ? item.sections : [];
  if (sections.length < 2) return '';
  return [
    '<details class="artikel-inhoud" data-softora-public-seo="reading-navigation">',
    '  <summary>In dit artikel <span>Kies je onderwerp</span></summary>',
    '  <ol aria-label="Onderdelen van dit artikel">',
    ...sections.map((section, index) => `    <li><a href="#${sectionId(section, index)}" data-softora-navigation="article-section">${escapeHtml(section.heading)}</a></li>`),
    '  </ol>',
    '</details>',
  ].join('\n');
}

function renderContentNavigation({ conversionPage, whatsappUrl, escapeHtml }) {
  const links = [
    ['/diensten', 'Diensten'], ['/pakketten', 'Pakketten'], ['/website-laten-maken', 'Websites'],
    ['/ai-automatisering', 'AI'], ['/bedrijfssoftware-op-maat', 'Software'], ['/blog', 'Artikelen'],
    ['/vergelijkingen', 'Vergelijkingen'], ['/branches', 'Branches'], ['/regio', 'Regio'],
  ];
  return [
    '  <a class="content-skip" href="#hoofdinhoud">Naar de inhoud</a>',
    '  <nav class="content-header" aria-label="Hoofdnavigatie">',
    '    <a class="nav-logo" href="/" aria-label="Softora homepage">SOFTORA.NL</a>',
    '    <div class="content-header-actions">',
    '      <details class="content-menu">',
    '        <summary>Menu</summary>',
    '        <div class="content-menu-links" aria-label="Content navigatie">',
    ...links.map(([href, label]) => `          <a href="${href}">${label}</a>`),
    '        </div>',
    '      </details>',
    `      <a class="content-header-contact" href="${whatsappUrl}" target="_blank" rel="noopener noreferrer" data-softora-conversion="content-nav-contact" data-softora-conversion-page="${escapeHtml(conversionPage)}" data-softora-conversion-target="whatsapp">Contact</a>`,
    '    </div>',
    '  </nav>',
  ].join('\n');
}

function getBackLabelForCollection(collection) {
  if (!collection) return 'overzicht';
  if (['blog', 'kennisbank'].includes(collection.key)) return 'artikelen';
  return ['vergelijkingen', 'branches', 'regio'].includes(collection.key) ? collection.key : 'overzicht';
}

function renderSeoParagraph(paragraph, escapeHtml) {
  if (!paragraph || typeof paragraph !== 'object' || Array.isArray(paragraph)) {
    return escapeHtml(paragraph);
  }
  const text = String(paragraph.text || '');
  const links = Array.isArray(paragraph.links) ? paragraph.links : [];
  if (!links.length) return escapeHtml(text);
  const matches = [];
  for (const link of links) {
    const anchor = String(link && link.anchor || '').trim();
    const href = String(link && link.href || '').trim();
    const index = anchor ? text.indexOf(anchor) : -1;
    if (index < 0 || !isSafeSeoContentLink(href, link.source === true)) continue;
    matches.push({ anchor, href, index });
  }
  matches.sort((a, b) => a.index - b.index);
  const output = [];
  let cursor = 0;
  for (const match of matches) {
    if (match.index < cursor) continue;
    output.push(escapeHtml(text.slice(cursor, match.index)));
    output.push(`<a href="${escapeHtml(match.href)}">${escapeHtml(match.anchor)}</a>`);
    cursor = match.index + match.anchor.length;
  }
  output.push(escapeHtml(text.slice(cursor)));
  return output.join('');
}

function isSafeSeoContentLink(href, allowExternal) {
  if (/^\/[a-z0-9][a-z0-9/-]*$/i.test(href)) return true;
  if (!allowExternal) return false;
  try {
    const url = new URL(href);
    return url.protocol === 'https:' && !url.username && !url.password;
  } catch {
    return false;
  }
}

function renderArticleSections(item, escapeHtml) {
  return item.sections.map((section, index) => [
    `    <h2 id="${sectionId(section, index)}">${escapeHtml(section.heading)}</h2>`,
    ...section.paragraphs.map(paragraph => `    <p>${renderSeoParagraph(paragraph, escapeHtml)}</p>`),
    ...(section.image?.src ? [renderSeoSupportImage(section.image, escapeHtml)] : []),
  ].join('\n'));
}

module.exports = { getBackLabelForCollection, renderContentNavigation, renderReadingNavigation, sectionId, renderArticleSections, renderSeoParagraph };
