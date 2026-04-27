// ── STATE ──────────────────────────────────────────────────
let docType = 'offerte';
let regels = [{ id:1, omschrijving:'', aantal:1, prijs:0 }];
let rc = 2;
const A4_PREVIEW_WIDTH = 595;
const A4_PREVIEW_HEIGHT = 842;
let resizeObs = null;
const DEFAULT_OFFERTE_NOTITIES = 'In de bijlage vind je de offerte en de algemene voorwaarden van Softora VOF. Door akkoord te geven op deze offerte verklaar je ook akkoord te gaan met de algemene voorwaarden. Reageer bij akkoord altijd expliciet met: "Akkoord met de offerte en algemene voorwaarden."';
const DEFAULT_FACTUUR_NOTITIES = 'Op deze factuur en de onderliggende opdracht zijn de algemene voorwaarden en, indien van toepassing, de verwerkersovereenkomst van Softora VOF van toepassing, zoals vóór akkoord verstrekt en geaccepteerd bij akkoord op de offerte/opdrachtbevestiging.';
const DEFAULT_OPLEVERINGSMAIL_NOTITIES = 'Je hebt 7 kalenderdagen om concrete gebreken te melden. Daarna geldt het project als geaccepteerd.';

const fields = {};
const v = id => (fields[id] && fields[id].value) || '';
function fmtEur(n) { return '€\u00a0' + (isNaN(n) ? '0,00' : n.toLocaleString('nl-NL', { minimumFractionDigits:2, maximumFractionDigits:2 })); }
const fmtDate = s => { if(!s) return '-'; const[y,m,d]=s.split('-'); return `${d}-${m}-${y}`; };
const today = () => new Date().toISOString().split('T')[0];
const addDays = n => { const d=new Date(); d.setDate(d.getDate()+n); return d.toISOString().split('T')[0]; };

// ── SCALE ──────────────────────────────────────────────────
function fitPreviewToViewport() {
  const stage = document.getElementById('previewStage');
  const shell = document.getElementById('a4ScaleShell');
  if (!stage || !shell) return;
  const availableWidth = Math.max(240, stage.clientWidth - 48);
  const availableHeight = Math.max(320, stage.clientHeight - 36);
  const maxScale = Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--preview-max-scale')) || 1;
  const scale = Math.min(maxScale, availableWidth / A4_PREVIEW_WIDTH, availableHeight / A4_PREVIEW_HEIGHT);
  shell.style.width = (A4_PREVIEW_WIDTH * scale) + 'px';
  shell.style.height = (A4_PREVIEW_HEIGHT * scale) + 'px';
  shell.style.setProperty('--preview-scale', String(scale));
  document.getElementById('a4').style.transform = `scale(${scale})`;
  document.getElementById('a4').style.transformOrigin = 'top center';
}

function setupPreviewAutoFit() {
  const stage = document.getElementById('previewStage');
  if (!stage) return;
  if (!resizeObs && typeof ResizeObserver === 'function') {
    resizeObs = new ResizeObserver(() => fitPreviewToViewport());
    resizeObs.observe(stage);
  }
  window.addEventListener('resize', fitPreviewToViewport, { passive:true });
}

// ── DOC SWITCH ─────────────────────────────────────────────
function setDoc(type, el) {
  docType = type;
  document.querySelectorAll('.pdf-tab').forEach(t => t.classList.remove('active'));
  el.classList.add('active');
  regels = [{ id:1, omschrijving:'', aantal:1, prijs:0 }];
  rc = 2;
  buildForm();
  update();
  fitPreviewToViewport();
}

// ── BUILD FORM ─────────────────────────────────────────────
const docConfigs = {
  offerte: [
    { section: 'Klantgegevens' },
    { id:'bedrijf',   label:'Bedrijfsnaam',          placeholder:'De Vries B.V.' },
    { id:'contact',   label:'Contactpersoon',         placeholder:'Dhr. De Vries' },
    { id:'email',     label:'E-mailadres',             placeholder:'info@devries.nl', type:'email' },
    { id:'adres',     label:'Adres',                   placeholder:'Hoofdstraat 1, 1234 AB Amsterdam' },
    { row: [
      { id:'kvk',     label:'KvK-nummer',              placeholder:'12345678' },
      { id:'tel',     label:'Telefoonnummer',          placeholder:'+31 6 ...' },
    ]},
    { section: 'Offerte details' },
    { id:'nummer',    label:'Offertenummer',           placeholder:'OFF-2026-001' },
    { row: [
      { id:'datum',   label:'Datum',                   type:'date', default: today() },
      { id:'geldig',  label:'Geldig tot',              type:'date', default: addDays(30) },
    ]},
    { id:'onderwerp', label:'Project / onderwerp',    placeholder:'Website Business pakket' },
    { section: 'Regelomschrijvingen', isRegels: true },
    { section: 'Opmerkingen' },
    { id:'notities',  label:'Notities (optioneel)',    textarea: true, placeholder:'Bijv. betalingstermijn, voorwaarden...', default: DEFAULT_OFFERTE_NOTITIES },
  ],
  factuur: [
    { section: 'Klantgegevens' },
    { id:'bedrijf',   label:'Bedrijfsnaam',            placeholder:'De Vries B.V.' },
    { id:'contact',   label:'Contactpersoon',           placeholder:'Dhr. De Vries' },
    { id:'email',     label:'E-mailadres',               placeholder:'info@devries.nl', type:'email' },
    { id:'adres',     label:'Adres',                     placeholder:'Hoofdstraat 1, 1234 AB Amsterdam' },
    { row: [
      { id:'kvk',     label:'KvK-nummer',                placeholder:'12345678' },
      { id:'btwnum',  label:'BTW-nummer',                placeholder:'NL123456789B01' },
    ]},
    { section: 'Factuurdetails' },
    { id:'nummer',    label:'Factuurnummer',            placeholder:'FACT-2026-001' },
    { row: [
      { id:'datum',   label:'Factuurdatum',             type:'date', default: today() },
      { id:'verval',  label:'Vervaldatum',              type:'date', default: addDays(14) },
    ]},
    { id:'iban',      label:'IBAN',                     placeholder:'NL91 ABNA 0417 ...' },
    { id:'ref',       label:'Referentie / Project',     placeholder:'Website Business pakket' },
    { section: 'Regelomschrijvingen', isRegels: true },
    { section: 'Opmerkingen' },
    { id:'notities',  label:'Notities (optioneel)',      textarea: true, placeholder:'Bijv. betaalverzoek...', default: DEFAULT_FACTUUR_NOTITIES },
  ],
  herinnering: [
    { section: 'Klantgegevens' },
    { id:'bedrijf',   label:'Bedrijfsnaam',             placeholder:'De Vries B.V.' },
    { id:'contact',   label:'Contactpersoon',            placeholder:'Dhr. De Vries' },
    { id:'email',     label:'E-mailadres',               placeholder:'info@devries.nl', type:'email' },
    { id:'adres',     label:'Adres',                     placeholder:'Hoofdstraat 1, 1234 AB Amsterdam' },
    { section: 'Factuurgegevens' },
    { id:'factnr',    label:'Factuurnummer',             placeholder:'FACT-2026-001' },
    { row: [
      { id:'factdatum',label:'Factuurdatum',             type:'date', default: addDays(-30) },
      { id:'verval',   label:'Vervallen op',             type:'date', default: addDays(-16) },
    ]},
    { id:'bedrag',    label:'Openstaand bedrag',         placeholder:'€ 1.813,50' },
    { row: [
      { id:'nieuwdat', label:'Nieuwe betaaldatum',       type:'date', default: addDays(7) },
      { id:'iban',     label:'IBAN',                     placeholder:'NL91 ABNA ...' },
    ]},
    { id:'htype',     label:'Type herinnering',         select: ['1e Herinnering - vriendelijk','2e Herinnering - dringend','Aanmaning - formeel'] },
    { section: 'Toelichting' },
    { id:'notities',  label:'Persoonlijke boodschap (optioneel)', textarea: true, placeholder:'Bijv. mochten er vragen zijn...' },
  ],
  opleveringsmail: [
    { section: 'Klantgegevens' },
    { id:'bedrijf',   label:'Bedrijfsnaam',             placeholder:'De Vries B.V.' },
    { id:'contact',   label:'Contactpersoon',            placeholder:'Dhr. De Vries' },
    { id:'email',     label:'E-mailadres',               placeholder:'info@devries.nl', type:'email' },
    { section: 'Projectgegevens' },
    { id:'project',   label:'Project / onderwerp',       placeholder:'Website Business pakket' },
    { row: [{ id:'datum', label:'Opleverdatum', type:'date', default: today() }, { id:'deadline', label:'Gebreken melden tot', type:'date', default: addDays(7) }] },
    { section: 'Opmerking' },
    { id:'notities',  label:'Standaard opmerking',       textarea: true, placeholder:'Opleveringsafspraak...', default: DEFAULT_OPLEVERINGSMAIL_NOTITIES },
  ],
};

function buildField(f) {
  if (f.select) {
    return `<div class="field"><label>${f.label}</label><select id="f-${f.id}" onchange="update()">${f.select.map((o,i)=>`<option value="${i+1}">${o}</option>`).join('')}</select></div>`;
  }
  if (f.textarea) {
    return `<div class="field"><label>${f.label}</label><textarea id="f-${f.id}" placeholder="${f.placeholder||''}" oninput="update()">${f.default||''}</textarea></div>`;
  }
  return `<div class="field"><label>${f.label}</label><input type="${f.type||'text'}" id="f-${f.id}" placeholder="${f.placeholder||''}" oninput="update()"${f.default?` value="${f.default}"`:''}></div>`;
}

function buildForm() {
  const panel = document.getElementById('form-panel');
  const config = docConfigs[docType];
  let html = '';

  config.forEach(f => {
    if (f.section && !f.isRegels) {
      html += `<div class="form-section-head">${f.section}</div>`;
    } else if (f.isRegels) {
      html += `<div class="form-section-head">Regelomschrijvingen</div><div id="regels-wrap"></div><button class="btn-add-regel" onclick="addRegel()"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>Regel toevoegen</button>`;
      html += `<div class="form-section-head" style="margin-top:18px">Totaal</div><div class="form-totaal" id="form-totaal"><div class="form-totaal-row"><span>Subtotaal excl. BTW</span><span id="ft-sub">€ 0,00</span></div><div class="form-totaal-row"><span>BTW (21%)</span><span id="ft-btw">€ 0,00</span></div><div class="form-totaal-row grand"><span>Totaal incl. BTW</span><span id="ft-grand">€ 0,00</span></div></div>`;
    } else if (f.row) {
      html += `<div class="field-row">${f.row.map(buildField).join('')}</div>`;
    } else {
      html += buildField(f);
    }
  });

  panel.innerHTML = html;

  panel.querySelectorAll('input,textarea,select').forEach(el => {
    fields[el.id.replace('f-','')] = el;
  });

  renderRegels();
  update();
}

// ── REGELS ─────────────────────────────────────────────────
function renderRegels() {
  const wrap = document.getElementById('regels-wrap');
  if (!wrap) return;
  wrap.innerHTML = `
    <div class="regels-header"><span>Omschrijving</span><span>Aantal</span><span>Prijs (€)</span><span></span></div>
    ${regels.map(r => `
      <div class="regel-row">
        <input type="text" value="${r.omschrijving}" placeholder="Dienst..." oninput="updateRegel(${r.id},'omschrijving',this.value)">
        <input type="number" value="${r.aantal}" min="1" oninput="updateRegel(${r.id},'aantal',this.value)">
        <input type="number" value="${r.prijs||''}" placeholder="0,00" step="0.01" oninput="updateRegel(${r.id},'prijs',this.value)">
        <button class="btn-remove-regel" onclick="removeRegel(${r.id})" title="Verwijder">×</button>
      </div>`).join('')}`;
  updateTotaalBar();
}

function addRegel() { regels.push({id:rc++,omschrijving:'',aantal:1,prijs:0}); renderRegels(); update(); }
function removeRegel(id) { if(regels.length>1) regels=regels.filter(r=>r.id!==id); renderRegels(); update(); }
function updateRegel(id, field, val) {
  const r=regels.find(r=>r.id===id); if(!r) return;
  r[field] = field==='omschrijving' ? val : (parseFloat(val)||0);
  updateTotaalBar(); update();
}
function getSubtotal() { return regels.reduce((s,r)=>s+r.aantal*r.prijs,0); }

function updateTotaalBar() {
  const sub=getSubtotal(), btw=sub*.21, grand=sub+btw;
  const s=document.getElementById('ft-sub'),b=document.getElementById('ft-btw'),g=document.getElementById('ft-grand');
  if(s) s.textContent=fmtEur(sub);
  if(b) b.textContent=fmtEur(btw);
  if(g) g.textContent=fmtEur(grand);
}

// ── PREVIEW ────────────────────────────────────────────────
function update() {
  const a4 = document.getElementById('a4');
  if (!a4) return;

  if (docType === 'offerte' || docType === 'factuur') {
    const isOff = docType === 'offerte';
    const sub = getSubtotal(), btw = sub*.21, grand = sub+btw;

    const addr2extra = !isOff && v('btwnum') ? `<div class="pdf-addr-line">BTW: ${v('btwnum')}</div>` : '';
    const ibanLine   = !isOff && v('iban')   ? `<div class="pdf-addr-line">IBAN: ${v('iban')}</div>` : '';

    const rows = regels.map(r=>`<tr>
      <td>${r.omschrijving||'-'}</td>
      <td style="text-align:right">${r.aantal}</td>
      <td style="text-align:right">${fmtEur(r.prijs)}</td>
      <td style="text-align:right;font-weight:600">${fmtEur(r.aantal*r.prijs)}</td>
    </tr>`).join('');

    const notes = v('notities') ? `<div class="pdf-notes"><div class="pdf-notes-label">Opmerkingen</div><div class="pdf-notes-text">${v('notities').replace(/\n/g,'<br>')}</div></div>` : '';

    a4.innerHTML = `
      <div class="pdf-top">
        <div class="pdf-logo">SOFTORA.NL</div>
        <div class="pdf-doctype">${isOff ? 'Offerte' : 'Factuur'}</div>
      </div>
      <div class="pdf-body">
        <div class="pdf-addresses">
          <div class="pdf-addr">
            <div class="pdf-addr-label">Van</div>
            <div class="pdf-addr-name">Softora.nl</div>
            <div class="pdf-addr-line">info@softora.nl</div>
            <div class="pdf-addr-line">www.softora.nl</div>
            ${ibanLine}
            <div class="pdf-addr-line">KvK: 12345678</div>
          </div>
          <div class="pdf-addr">
            <div class="pdf-addr-label">Aan</div>
            <div class="pdf-addr-name">${v('bedrijf')||'-'}</div>
            ${v('contact') ? `<div class="pdf-addr-line">${v('contact')}</div>` : ''}
            ${v('adres')   ? `<div class="pdf-addr-line">${v('adres')}</div>` : ''}
            ${v('email')   ? `<div class="pdf-addr-line">${v('email')}</div>` : ''}
            ${v('kvk')     ? `<div class="pdf-addr-line">KvK: ${v('kvk')}</div>` : ''}
            ${addr2extra}
          </div>
        </div>
        <div class="pdf-meta">
          <div class="pdf-meta-cell"><div class="pdf-meta-key">${isOff?'Offertenummer':'Factuurnummer'}</div><div class="pdf-meta-val">${v('nummer')||'-'}</div></div>
          <div class="pdf-meta-cell"><div class="pdf-meta-key">${isOff?'Datum':'Factuurdatum'}</div><div class="pdf-meta-val">${fmtDate(v('datum'))}</div></div>
          <div class="pdf-meta-cell"><div class="pdf-meta-key">${isOff?'Geldig tot':'Vervaldatum'}</div><div class="pdf-meta-val">${isOff?fmtDate(v('geldig')):fmtDate(v('verval'))}</div></div>
          <div class="pdf-meta-cell"><div class="pdf-meta-key">${isOff?'Onderwerp':'Referentie'}</div><div class="pdf-meta-val">${isOff?(v('onderwerp')||'-'):(v('ref')||'-')}</div></div>
        </div>
        <table class="pdf-table">
          <thead><tr><th>Omschrijving</th><th style="text-align:right">Aantal</th><th style="text-align:right">Prijs</th><th style="text-align:right">Totaal</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
        <div class="pdf-totals">
          <div class="pdf-total-row"><span>Subtotaal excl. BTW</span><span>${fmtEur(sub)}</span></div>
          <div class="pdf-total-row"><span>BTW (21%)</span><span>${fmtEur(btw)}</span></div>
          <div class="pdf-total-grand"><span class="pdf-total-grand-label">Totaal</span><span class="pdf-total-grand-amount">${fmtEur(grand)}</span></div>
        </div>
        ${notes}
      </div>
      <div class="pdf-footer">Softora.nl &nbsp;·&nbsp; info@softora.nl &nbsp;·&nbsp; www.softora.nl &nbsp;·&nbsp; KvK: 12345678</div>`;

  } else if (docType === 'herinnering') {
    const htype = fields['htype'] ? parseInt(fields['htype'].value) : 1;
    const hcols  = { 1:'#d97706', 2:'#b45a00', 3:'#c0392b' };
    const hlabels= { 1:'1e Betalingsherinnering', 2:'2e Betalingsherinnering - Dringend', 3:'Aanmaning' };
    const col = hcols[htype];
    const msgs = {
      1:`Geachte ${v('contact')||'relatie'},\n\nWij attenderen u er vriendelijk op dat onderstaande factuur nog niet is voldaan. Wellicht is de betaling al onderweg – in dat geval kunt u dit bericht als niet verzonden beschouwen.`,
      2:`Geachte ${v('contact')||'relatie'},\n\nOndanks onze eerdere herinnering hebben wij uw betaling nog niet ontvangen. Wij verzoeken u dringend het openstaande bedrag zo spoedig mogelijk te voldoen.`,
      3:`Geachte ${v('contact')||'relatie'},\n\nNadat wij u meerdere malen hebben verzocht te betalen, is betaling uitgebleven. Wij sommeren u het verschuldigde bedrag uiterlijk op de vermelde datum te voldoen. Bij uitblijven treffen wij verdere incassomaatregelen.`
    };

    a4.innerHTML = `
      <div class="pdf-top">
        <div class="pdf-logo">SOFTORA.NL</div>
        <div class="pdf-doctype">${hlabels[htype]}</div>
      </div>
      <div class="pdf-body">
        <div class="pdf-addresses">
          <div class="pdf-addr">
            <div class="pdf-addr-label">Van</div>
            <div class="pdf-addr-name">Softora.nl</div>
            <div class="pdf-addr-line">info@softora.nl</div>
            <div class="pdf-addr-line">www.softora.nl</div>
          </div>
          <div class="pdf-addr">
            <div class="pdf-addr-label">Aan</div>
            <div class="pdf-addr-name">${v('bedrijf')||'-'}</div>
            ${v('contact') ? `<div class="pdf-addr-line">${v('contact')}</div>` : ''}
            ${v('adres')   ? `<div class="pdf-addr-line">${v('adres')}</div>` : ''}
            ${v('email')   ? `<div class="pdf-addr-line">${v('email')}</div>` : ''}
          </div>
        </div>
        <div style="background:${col};color:#fff;border-radius:4px;padding:9px 14px;font-family:'Barlow Condensed',sans-serif;font-size:13px;font-weight:800;letter-spacing:1px;text-transform:uppercase;margin-bottom:14px">${hlabels[htype]}</div>
        <div style="font-size:10.5px;color:#555;line-height:1.9;margin-bottom:18px">${msgs[htype].replace(/\n/g,'<br>')}</div>
        <div class="pdf-meta" style="margin-bottom:14px">
          <div class="pdf-meta-cell"><div class="pdf-meta-key">Factuurnummer</div><div class="pdf-meta-val">${v('factnr')||'-'}</div></div>
          <div class="pdf-meta-cell"><div class="pdf-meta-key">Factuurdatum</div><div class="pdf-meta-val">${fmtDate(v('factdatum'))}</div></div>
          <div class="pdf-meta-cell"><div class="pdf-meta-key">Vervallen op</div><div class="pdf-meta-val">${fmtDate(v('verval'))}</div></div>
          <div class="pdf-meta-cell"><div class="pdf-meta-key">Openstaand</div><div class="pdf-meta-val" style="color:${col}">${v('bedrag')||'-'}</div></div>
        </div>
        <div style="background:${col};color:#fff;border-radius:4px;padding:12px 16px;display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
          <div style="font-size:10.5px;line-height:1.7">
            <div style="font-size:8px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;opacity:.7;margin-bottom:2px">Betaal uiterlijk</div>
            <strong>${fmtDate(v('nieuwdat'))}</strong> &nbsp;·&nbsp; IBAN: ${v('iban')||'-'}
          </div>
          <div style="font-family:'Barlow Condensed',sans-serif;font-size:20px;font-weight:800">${v('bedrag')||'-'}</div>
        </div>
        ${v('notities') ? `<div class="pdf-notes"><div class="pdf-notes-label">Toelichting</div><div class="pdf-notes-text">${v('notities').replace(/\n/g,'<br>')}</div></div>` : ''}
      </div>
      <div class="pdf-footer">Softora.nl &nbsp;·&nbsp; info@softora.nl &nbsp;·&nbsp; www.softora.nl &nbsp;·&nbsp; KvK: 12345678</div>`;
  } else if (docType === 'opleveringsmail') {
    const notes = v('notities') ? `<div class="pdf-notes"><div class="pdf-notes-label">Opmerking</div><div class="pdf-notes-text">${v('notities').replace(/\n/g,'<br>')}</div></div>` : '';
    const intro = `Geachte ${v('contact')||'relatie'},<br><br>Hierbij leveren wij het project <strong>${v('project')||'het project'}</strong> op. Controleer de oplevering zorgvuldig en laat het ons schriftelijk weten als je concrete gebreken ziet.`;

    a4.innerHTML = `
      <div class="pdf-top">
        <div class="pdf-logo">SOFTORA.NL</div>
        <div class="pdf-doctype">Opleveringsmail</div>
      </div>
      <div class="pdf-body">
        <div class="pdf-addresses">
          <div class="pdf-addr"><div class="pdf-addr-label">Van</div><div class="pdf-addr-name">Softora.nl</div><div class="pdf-addr-line">info@softora.nl</div><div class="pdf-addr-line">www.softora.nl</div></div>
          <div class="pdf-addr"><div class="pdf-addr-label">Aan</div><div class="pdf-addr-name">${v('bedrijf')||'-'}</div>${v('contact') ? `<div class="pdf-addr-line">${v('contact')}</div>` : ''}${v('email') ? `<div class="pdf-addr-line">${v('email')}</div>` : ''}</div>
        </div>
        <div class="pdf-meta" style="margin-bottom:18px">
          <div class="pdf-meta-cell"><div class="pdf-meta-key">Document</div><div class="pdf-meta-val">Opleveringsmail</div></div>
          <div class="pdf-meta-cell"><div class="pdf-meta-key">Project</div><div class="pdf-meta-val">${v('project')||'-'}</div></div>
          <div class="pdf-meta-cell"><div class="pdf-meta-key">Opleverdatum</div><div class="pdf-meta-val">${fmtDate(v('datum'))}</div></div>
          <div class="pdf-meta-cell"><div class="pdf-meta-key">Melden tot</div><div class="pdf-meta-val">${fmtDate(v('deadline'))}</div></div>
        </div>
        <div style="font-size:10.5px;color:#555;line-height:1.9;margin-bottom:18px">${intro}</div>
        ${notes}
      </div>
      <div class="pdf-footer">Softora.nl &nbsp;·&nbsp; info@softora.nl &nbsp;·&nbsp; www.softora.nl &nbsp;·&nbsp; KvK: 12345678</div>`;
  }
}

// ── DOWNLOAD ───────────────────────────────────────────────
function downloadPDF() {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit:'mm', format:'a4' });
  const W=210, PL=20, PR=190;
  const CR=[155,35,85], DK=[26,26,46], MD=[100,100,110], BG=[249,248,246];
  const fmtD = s => { if(!s) return '-'; const[y,m,d]=s.split('-'); return `${d}-${m}-${y}`; };
  const fmtN = n => n.toLocaleString('nl-NL',{minimumFractionDigits:2,maximumFractionDigits:2});

  doc.setFillColor(...CR); doc.rect(0,0,W,26,'F');
  doc.setFont('helvetica','bold'); doc.setFontSize(15); doc.setTextColor(255,255,255);
  doc.text('SOFTORA.NL', PL, 16);
  const dtLabel = docType==='offerte'?'OFFERTE':docType==='factuur'?'FACTUUR':docType==='opleveringsmail'?'OPLEVERINGSMAIL':'BETALINGSHERINNERING';
  doc.setFontSize(8); doc.setTextColor(255,200,220); doc.text(dtLabel, PR, 16, {align:'right'});

  let y = 34;

  if (docType==='offerte' || docType==='factuur') {
    const isOff = docType==='offerte';
    const van = ['Softora.nl','info@softora.nl','www.softora.nl','KvK: 12345678'];
    const aan = [v('bedrijf')||'-',v('contact'),v('adres'),v('email'),v('kvk')?'KvK: '+v('kvk'):null].filter(Boolean);

    [[PL,van,'VAN'],[112,aan,'AAN']].forEach(([x,lines,lbl]) => {
      doc.setFillColor(...BG); doc.rect(x,y,78,36,'F');
      doc.setFontSize(6.5); doc.setFont('helvetica','bold'); doc.setTextColor(...MD); doc.text(lbl,x+3,y+5);
      lines.forEach((l,i) => {
        if(i===0){doc.setFontSize(9);doc.setFont('helvetica','bold');doc.setTextColor(...DK);}
        else{doc.setFontSize(8);doc.setFont('helvetica','normal');doc.setTextColor(...MD);}
        doc.text(String(l),x+3,y+10+i*5);
      });
    });
    y += 42;

    const metas = isOff
      ? [['OFFERTENUMMER',v('nummer')||'-'],['DATUM',fmtD(v('datum'))],['GELDIG TOT',fmtD(v('geldig'))],['ONDERWERP',v('onderwerp')||'-']]
      : [['FACTUURNUMMER',v('nummer')||'-'],['FACTUURDATUM',fmtD(v('datum'))],['VERVALDATUM',fmtD(v('verval'))],['REFERENTIE',v('ref')||'-']];
    doc.setFillColor(...BG); doc.rect(PL,y,170,14,'F');
    metas.forEach(([k,val],i) => {
      const x=PL+3+i*43;
      doc.setFontSize(6.5);doc.setFont('helvetica','bold');doc.setTextColor(...MD); doc.text(k,x,y+4.5);
      doc.setFontSize(8.5);doc.setFont('helvetica','normal');doc.setTextColor(...DK); doc.text(val,x,y+11);
    });
    y += 20;

    doc.setFillColor(...CR); doc.rect(PL,y,170,7,'F');
    doc.setFontSize(7);doc.setFont('helvetica','bold');doc.setTextColor(255,255,255);
    doc.text('OMSCHRIJVING',PL+3,y+4.8);doc.text('AANTAL',130,y+4.8);doc.text('PRIJS',152,y+4.8);doc.text('TOTAAL',172,y+4.8);
    y += 7;

    regels.forEach((r,i) => {
      doc.setFillColor(...(i%2===0?[255,255,255]:BG)); doc.rect(PL,y,170,7,'F');
      doc.setFontSize(8.5);doc.setFont('helvetica','normal');doc.setTextColor(...DK);
      doc.text(r.omschrijving||'-',PL+3,y+4.8);
      doc.text(String(r.aantal),134,y+4.8,{align:'right'});
      doc.text('€'+fmtN(r.prijs),162,y+4.8,{align:'right'});
      doc.setFont('helvetica','bold'); doc.text('€'+fmtN(r.aantal*r.prijs),188,y+4.8,{align:'right'});
      y += 7;
    });

    const sub=getSubtotal(),btw=sub*.21,grand=sub+btw;
    y += 4;
    doc.setFontSize(8.5);doc.setFont('helvetica','normal');doc.setTextColor(...MD);
    doc.text('Subtotaal excl. BTW:',142,y);doc.text('€'+fmtN(sub),188,y,{align:'right'}); y+=5.5;
    doc.text('BTW (21%):',142,y);doc.text('€'+fmtN(btw),188,y,{align:'right'}); y+=3;
    doc.setFillColor(...CR);doc.rect(142,y,48,9,'F');
    doc.setFontSize(9);doc.setFont('helvetica','bold');doc.setTextColor(255,255,255);
    doc.text('TOTAAL',145,y+6.2);doc.text('€'+fmtN(grand),188,y+6.2,{align:'right'});
    y += 14;

    if(v('notities')){
      doc.setFillColor(...BG);doc.rect(PL,y,170,6,'F');
      doc.setFontSize(7);doc.setFont('helvetica','bold');doc.setTextColor(...MD);doc.text('OPMERKINGEN',PL+3,y+4);y+=6;
      doc.setFont('helvetica','normal');doc.setFontSize(8.5);doc.setTextColor(70,70,80);
      const ls=doc.splitTextToSize(v('notities'),164);doc.text(ls,PL+3,y+5);
    }

  } else if (docType==='herinnering') {
    const htype=fields['htype']?parseInt(fields['htype'].value):1;
    const hcols={1:[217,119,6],2:[180,90,0],3:[192,57,43]};
    const hlabels={1:'1E BETALINGSHERINNERING',2:'2E BETALINGSHERINNERING - DRINGEND',3:'AANMANING'};
    const hc=hcols[htype];

    [[PL,['Softora.nl','info@softora.nl','www.softora.nl'],'VAN'],[112,[v('bedrijf')||'-',v('contact'),v('adres'),v('email')].filter(Boolean),'AAN']].forEach(([x,lines,lbl])=>{
      doc.setFillColor(...BG);doc.rect(x,y,78,30,'F');
      doc.setFontSize(6.5);doc.setFont('helvetica','bold');doc.setTextColor(...MD);doc.text(lbl,x+3,y+4.5);
      lines.forEach((l,i)=>{if(i===0){doc.setFontSize(9);doc.setFont('helvetica','bold');doc.setTextColor(...DK);}else{doc.setFontSize(8);doc.setFont('helvetica','normal');doc.setTextColor(...MD);}doc.text(String(l),x+3,y+9+i*5);});
    });
    y+=36;
    doc.setFillColor(...hc);doc.rect(PL,y,170,9,'F');
    doc.setFontSize(9);doc.setFont('helvetica','bold');doc.setTextColor(255,255,255);doc.text(hlabels[htype],PL+4,y+6.2);y+=14;
    const msgs={1:`Geachte ${v('contact')||'relatie'}, wij attenderen u er vriendelijk op dat onderstaande factuur nog niet is voldaan.`,2:`Geachte ${v('contact')||'relatie'}, ondanks onze herinnering ontvingen wij uw betaling nog niet.`,3:`Geachte ${v('contact')||'relatie'}, nadat wij u meerdere malen verzochten te betalen, is betaling uitgebleven.`};
    doc.setFontSize(9);doc.setFont('helvetica','normal');doc.setTextColor(...DK);const ml=doc.splitTextToSize(msgs[htype],170);doc.text(ml,PL,y);y+=ml.length*5+8;
    doc.setFillColor(...BG);doc.rect(PL,y,170,8,'F');
    doc.setFontSize(7);doc.setFont('helvetica','bold');doc.setTextColor(...MD);
    [[PL+2,'FACTUURNR'],[57,'FACTUURDATUM'],[100,'VERVALLEN OP'],[143,'OPENSTAAND']].forEach(([x,l])=>doc.text(l,x,y+4.8));
    y+=8;doc.setFont('helvetica','normal');doc.setFontSize(9);doc.setTextColor(...DK);
    doc.text(v('factnr')||'-',PL+2,y+5);doc.text(fmtD(v('factdatum')),57,y+5);doc.text(fmtD(v('verval')),100,y+5);
    doc.setFont('helvetica','bold');doc.setTextColor(...hc);doc.text(v('bedrag')||'-',143,y+5);y+=14;
    doc.setFillColor(...hc);doc.rect(PL,y,170,11,'F');
    doc.setFontSize(9);doc.setFont('helvetica','bold');doc.setTextColor(255,255,255);
    doc.text('Betaal uiterlijk: '+fmtD(v('nieuwdat')),PL+4,y+5);doc.text('IBAN: '+(v('iban')||'-'),PL+4,y+9.5);
    doc.text(v('bedrag')||'-',188,y+7,{align:'right'});
  } else if (docType==='opleveringsmail') {
    const van = ['Softora.nl','info@softora.nl','www.softora.nl'];
    const aan = [v('bedrijf')||'-',v('contact'),v('email')].filter(Boolean);

    [[PL,van,'VAN'],[112,aan,'AAN']].forEach(([x,lines,lbl])=>{
      doc.setFillColor(...BG);doc.rect(x,y,78,30,'F');
      doc.setFontSize(6.5);doc.setFont('helvetica','bold');doc.setTextColor(...MD);doc.text(lbl,x+3,y+4.5);
      lines.forEach((l,i)=>{if(i===0){doc.setFontSize(9);doc.setFont('helvetica','bold');doc.setTextColor(...DK);}else{doc.setFontSize(8);doc.setFont('helvetica','normal');doc.setTextColor(...MD);}doc.text(String(l),x+3,y+9+i*5);});
    });
    y+=36;

    doc.setFillColor(...BG); doc.rect(PL,y,170,14,'F');
    [['DOCUMENT','Opleveringsmail'],['PROJECT',v('project')||'-'],['OPLEVERDATUM',fmtD(v('datum'))],['MELDEN TOT',fmtD(v('deadline'))]].forEach(([k,val],i) => {
      const x=PL+3+i*43;
      doc.setFontSize(6.5);doc.setFont('helvetica','bold');doc.setTextColor(...MD); doc.text(k,x,y+4.5);
      doc.setFontSize(8.5);doc.setFont('helvetica','normal');doc.setTextColor(...DK); doc.text(String(val),x,y+11);
    });
    y += 24;

    doc.setFontSize(9);doc.setFont('helvetica','normal');doc.setTextColor(...DK);
    const intro = `Geachte ${v('contact')||'relatie'}, hierbij leveren wij het project ${v('project')||'het project'} op. Controleer de oplevering zorgvuldig en laat het ons schriftelijk weten als je concrete gebreken ziet.`;
    const introLines = doc.splitTextToSize(intro,170);
    doc.text(introLines,PL,y);
    y += introLines.length*5+10;

    if(v('notities')){
      doc.setFillColor(...BG);doc.rect(PL,y,170,6,'F');
      doc.setFontSize(7);doc.setFont('helvetica','bold');doc.setTextColor(...MD);doc.text('OPMERKING',PL+3,y+4);y+=6;
      doc.setFont('helvetica','normal');doc.setFontSize(8.5);doc.setTextColor(70,70,80);
      const ls=doc.splitTextToSize(v('notities'),164);doc.text(ls,PL+3,y+5);
    }
  }

  doc.setFillColor(...BG);doc.rect(0,284,W,13,'F');
  doc.setFontSize(7);doc.setFont('helvetica','normal');doc.setTextColor(180,175,168);
  doc.text('Softora.nl  ·  info@softora.nl  ·  www.softora.nl  ·  KvK: 12345678',W/2,291,{align:'center'});

  doc.save(`${docType}-${new Date().toISOString().split('T')[0]}.pdf`);
  showToast('PDF gedownload');
}

function showToast(msg) {
  const t=document.getElementById('toast');
  t.textContent=msg;
  t.classList.add('show');
  setTimeout(()=>t.classList.remove('show'),2500);
}

function bindPdfBuilderActions() {
  document.querySelectorAll('.pdf-tab[data-doc]').forEach((tab) => {
    tab.addEventListener('click', () => {
      setDoc(tab.dataset.doc, tab);
    });
  });

  const downloadButton = document.getElementById('pdf-download-btn');
  if (downloadButton) {
    downloadButton.addEventListener('click', downloadPDF);
  }
}

// ── INIT ───────────────────────────────────────────────────
bindPdfBuilderActions();
buildForm();
setupPreviewAutoFit();
fitPreviewToViewport();

function finishPremiumShellBoot() {
  if (window.SoftoraPremiumBoot && typeof window.SoftoraPremiumBoot.setShellBooting === 'function') {
    window.SoftoraPremiumBoot.setShellBooting(false);
  }
}
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', finishPremiumShellBoot, { once: true });
} else {
  finishPremiumShellBoot();
}
