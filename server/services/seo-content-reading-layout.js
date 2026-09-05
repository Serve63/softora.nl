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
    ['/kennisbank', 'Kennisbank'], ['/vergelijkingen', 'Vergelijkingen'], ['/branches', 'Branches'], ['/regio', 'Regio'],
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

module.exports = { renderContentNavigation, renderReadingNavigation, sectionId };
