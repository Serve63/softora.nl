const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

test('premium ai lead generator renders campaign controls before dashboard bootstrap runs', () => {
  const pagePath = path.join(__dirname, '../../premium-ai-lead-generator.html');
  const dashboardPath = path.join(__dirname, '../../assets/coldcalling-dashboard.js');
  const pageSource = fs.readFileSync(pagePath, 'utf8');
  const dashboardSource = fs.readFileSync(dashboardPath, 'utf8');

  assert.match(pageSource, /<div class="form-group form-group--lead-list" id="leadListControlWrap">/);
  assert.match(
    pageSource,
    /<button type="button" class="form-input magnetic" id="openLeadListModalBtn" onclick="window\.openLeadDatabaseModalFromCampaign && window\.openLeadDatabaseModalFromCampaign\(\)"/
  );
  assert.match(pageSource, /<div class="form-group form-group--dispatch" id="callDispatchControlWrap">/);
  assert.match(pageSource, /<select class="form-select magnetic" id="callDispatchMode">/);
  assert.match(pageSource, /<select class="form-select magnetic" id="regio" data-force-change-value="custom">/);
  assert.match(pageSource, /<option value="unlimited" selected>Geen limiet<\/option>/);
  assert.match(pageSource, /<option value="custom">Aangepast<\/option>/);
  assert.match(pageSource, /window\.openSiteInputDialog = openSiteInputDialog;/);
  assert.match(pageSource, /\.generator-grid > \.panel:only-child \.form-group--lead-list\s*\{[\s\S]*grid-column:\s*1;[\s\S]*grid-row:\s*3;/);
  assert.match(pageSource, /\.generator-grid > \.panel:only-child \.form-group--dispatch\s*\{[\s\S]*grid-column:\s*1;[\s\S]*grid-row:\s*4;/);
  assert.match(pageSource, /\.generator-grid > \.panel:only-child \.form-group--branche\s*\{[\s\S]*grid-column:\s*2;[\s\S]*grid-row:\s*3;/);
  assert.match(pageSource, /\.generator-grid > \.panel:only-child \.form-group--regio\s*\{[\s\S]*grid-column:\s*2;[\s\S]*grid-row:\s*4;/);
  assert.match(dashboardSource, /let controlWrap = byId\('leadListControlWrap'\);[\s\S]*if \(!controlWrap\)/);
  assert.match(dashboardSource, /let dispatchWrap = byId\('callDispatchControlWrap'\);[\s\S]*if \(!dispatchWrap\)/);
  assert.match(dashboardSource, /window\.openLeadDatabaseModalFromCampaign = openLeadDatabaseFromCampaignControl;/);
  assert.match(dashboardSource, /button\.dataset\.dbOpenBound !== '1'/);
  assert.match(dashboardSource, /const CAMPAIGN_REGIO_CUSTOM_KM_STORAGE_KEY = 'softora_campaign_regio_custom_km';/);
  assert.match(dashboardSource, /const DEFAULT_CAMPAIGN_REGIO_VALUE = 'unlimited';/);
  assert.match(dashboardSource, /function formatCampaignCustomRegioLabel\(km\) \{/);
  assert.match(dashboardSource, /async function promptForCustomCampaignRegioKm\(initialValue = ''\) \{/);
  assert.match(dashboardSource, /savedRegio === CUSTOM_CAMPAIGN_REGIO_VALUE[\s\S]*applyCampaignRegioSelection\(regioEl, CUSTOM_CAMPAIGN_REGIO_VALUE, savedCustomRegioKm\);/);
  assert.match(dashboardSource, /if \(selectedValue === CUSTOM_CAMPAIGN_REGIO_VALUE\) \{[\s\S]*const customKm = await promptForCustomCampaignRegioKm\(initialCustomKm\);/);
});
