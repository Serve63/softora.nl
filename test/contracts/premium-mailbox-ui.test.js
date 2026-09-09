const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { createControllerSendHarness } = require('../helpers/mailbox-compose-send-resilience');

const pagePath = path.join(__dirname, '../../premium-mailbox.html');
const scriptPath = path.join(__dirname, '../../assets/premium-mailbox.js');
const indexScriptPath = path.join(__dirname, '../../assets/premium-mailbox-index.js');
const displayScriptPath = path.join(__dirname, '../../assets/premium-mailbox-display.js');
const outreachScriptPath = path.join(__dirname, '../../assets/premium-mailbox-outreach.js');
const quotedThreadScriptPath = path.join(__dirname, '../../assets/premium-mailbox-quoted-thread.js');
const signatureScriptPath = path.join(__dirname, '../../assets/premium-mailbox-signature.js');
const messagePresentationScriptPath = path.join(__dirname, '../../assets/premium-mailbox-message-presentation.js');
const logicalDeleteScriptPath = path.join(__dirname, '../../assets/premium-mailbox-logical-delete.js');
const campaignInboxScriptPath = path.join(__dirname, '../../assets/premium-mailbox-campaign-inbox.js');
const imagesScriptPath = path.join(__dirname, '../../assets/premium-mailbox-images.js');
const refreshScriptPath = path.join(__dirname, '../../assets/premium-mailbox-refresh.js');
const composeScriptPath = path.join(__dirname, '../../assets/premium-mailbox-compose.js');
const composeWindowScriptPath = path.join(__dirname, '../../assets/premium-mailbox-compose-window.js');
const attachmentDigestScriptPath = path.join(__dirname, '../../assets/premium-mailbox-attachment-digest.js');
const composeSendStateScriptPath = path.join(__dirname, '../../assets/premium-mailbox-compose-send-state.js');
const composeSendResilienceScriptPath = path.join(__dirname, '../../assets/premium-mailbox-compose-send-resilience.js');
const composeAcceptedSendScriptPath = path.join(__dirname, '../../assets/premium-mailbox-compose-accepted-send.js');
const composeControllerScriptPath = path.join(__dirname, '../../assets/premium-mailbox-compose-controller.js');
const ownerSessionScriptPath = path.join(__dirname, '../../assets/premium-mailbox-owner-session.js');
const toastScriptPath = path.join(__dirname, '../../assets/premium-mailbox-toast.js');
const listScriptPath = path.join(__dirname, '../../assets/premium-mailbox-list.js');
const deleteScriptPath = path.join(__dirname, '../../assets/premium-mailbox-delete.js');
const readScriptPath = path.join(__dirname, '../../assets/premium-mailbox-read.js');
const uiStateScriptPath = path.join(__dirname, '../../assets/premium-mailbox-ui-state.js');
const detailStabilityScriptPath = path.join(__dirname, '../../assets/premium-mailbox-detail-stability.js');
const ownerSessionModule = require('../../assets/premium-mailbox-owner-session.js');
const provenanceModule = require('../../assets/premium-mailbox-message-provenance.js');
global.SoftoraMailboxMessageProvenance = provenanceModule;
const quotedThreadModule = require('../../assets/premium-mailbox-quoted-thread.js');
const signatureModule = require('../../assets/premium-mailbox-signature.js');
const messagePresentationModule = require('../../assets/premium-mailbox-message-presentation.js');
const logicalDeleteModule = require('../../assets/premium-mailbox-logical-delete.js');
delete global.SoftoraMailboxQuotedThread;
const campaignInboxModule = require('../../assets/premium-mailbox-campaign-inbox.js');
const commonJsCanonicalQuoteBody = campaignInboxModule.stripQuotedReply([
  'Nieuw menselijk antwoord.',
  '',
  'Op 19-08-2026 12:59 schreef Servé Creusen: Geciteerd bericht.',
].join('\n'));
global.SoftoraMailboxQuotedThread = quotedThreadModule;
global.SoftoraMailboxCampaignInbox = campaignInboxModule;
const imagesModule = require('../../assets/premium-mailbox-images.js');
const refreshModule = require('../../assets/premium-mailbox-refresh.js');
const composeModule = require('../../assets/premium-mailbox-compose.js');
const composeWindowModule = require('../../assets/premium-mailbox-compose-window.js');
const attachmentDigestModule = require('../../assets/premium-mailbox-attachment-digest.js');
const composeSendStateModule = require('../../assets/premium-mailbox-compose-send-state.js');
const composeSendResilienceModule = require('../../assets/premium-mailbox-compose-send-resilience.js');
const composeAcceptedSendModule = require('../../assets/premium-mailbox-compose-accepted-send.js');
const composeControllerModule = require('../../assets/premium-mailbox-compose-controller.js');
const toastModule = require('../../assets/premium-mailbox-toast.js');
const listModule = require('../../assets/premium-mailbox-list.js');
const deleteModule = require('../../assets/premium-mailbox-delete.js');
const readModule = require('../../assets/premium-mailbox-read.js');
const uiStateModule = require('../../assets/premium-mailbox-ui-state.js');
const bodySectionModule = require('../../assets/premium-mailbox-body-section.js');
const detailStateModule = require('../../assets/premium-mailbox-detail-state.js');
const detailStabilityModule = require('../../assets/premium-mailbox-detail-stability.js');
const discoveryModule = require('../../assets/premium-mailbox-discovery.js');

function readPage() {
  return fs.readFileSync(pagePath, 'utf8');
}

function readScript() {
  return fs.readFileSync(scriptPath, 'utf8');
}

function readIndexScript() {
  return fs.readFileSync(indexScriptPath, 'utf8');
}

function readDisplayScript() {
  return fs.readFileSync(displayScriptPath, 'utf8');
}

function readOutreachScript() {
  return fs.readFileSync(outreachScriptPath, 'utf8');
}

function readCampaignInboxScript() {
  return fs.readFileSync(campaignInboxScriptPath, 'utf8');
}

function readQuotedThreadScript() {
  return fs.readFileSync(quotedThreadScriptPath, 'utf8');
}

function readSignatureScript() {
  return fs.readFileSync(signatureScriptPath, 'utf8');
}

function readMessagePresentationScript() {
  return fs.readFileSync(messagePresentationScriptPath, 'utf8');
}

function readLogicalDeleteScript() {
  return fs.readFileSync(logicalDeleteScriptPath, 'utf8');
}

function readImagesScript() {
  return fs.readFileSync(imagesScriptPath, 'utf8');
}

function readRefreshScript() {
  return fs.readFileSync(refreshScriptPath, 'utf8');
}

function readComposeScript() {
  return fs.readFileSync(composeScriptPath, 'utf8');
}

function readComposeWindowScript() {
  return fs.readFileSync(composeWindowScriptPath, 'utf8');
}

function readAttachmentDigestScript() {
  return fs.readFileSync(attachmentDigestScriptPath, 'utf8');
}

function readComposeSendStateScript() {
  return fs.readFileSync(composeSendStateScriptPath, 'utf8');
}

function readComposeSendResilienceScript() {
  return fs.readFileSync(composeSendResilienceScriptPath, 'utf8');
}

function readComposeAcceptedSendScript() {
  return fs.readFileSync(composeAcceptedSendScriptPath, 'utf8');
}

function readComposeControllerScript() {
  return fs.readFileSync(composeControllerScriptPath, 'utf8');
}

function readOwnerSessionScript() {
  return fs.readFileSync(ownerSessionScriptPath, 'utf8');
}

function readToastScript() {
  return fs.readFileSync(toastScriptPath, 'utf8');
}

function readListScript() {
  return fs.readFileSync(listScriptPath, 'utf8');
}

function readDeleteScript() {
  return fs.readFileSync(deleteScriptPath, 'utf8');
}

function readReadScript() {
  return fs.readFileSync(readScriptPath, 'utf8');
}

function readUiStateScript() {
  return fs.readFileSync(uiStateScriptPath, 'utf8');
}

function readDetailStabilityScript() {
  return fs.readFileSync(detailStabilityScriptPath, 'utf8');
}

function loadMailboxImagesModuleForTest(options = {}) {
  const window = {
    Image: options.Image,
    clearTimeout: options.clearTimeout || (() => {}),
    setTimeout: options.setTimeout || (() => 0),
    SoftoraMailboxCampaignInbox: {
      isSafeImageSource: (value) => Boolean(String(value || '').trim()),
    },
  };
  const previousWindow = global.window;
  delete require.cache[require.resolve(imagesScriptPath)];
  global.window = window;
  try {
    return require(imagesScriptPath);
  } finally {
    if (previousWindow === undefined) delete global.window;
    else global.window = previousWindow;
    delete require.cache[require.resolve(imagesScriptPath)];
  }
}

test('mailbox gebruikt de juiste browsertitel', () => {
  const page = readPage();
  assert.match(page, /<title>Mailbox – Softora\.nl<\/title>/);
  assert.doesNotMatch(page, /Coldmail Inbox/);
  assert.match(page, /assets\/premium-mailbox-quoted-thread\.js\?v=20260907a/);
  assert.match(page, /assets\/premium-mailbox-signature\.js\?v=20260909d/);
  assert.match(page, /assets\/premium-mailbox-message-presentation\.js\?v=20260909a/);
  assert.match(page, /assets\/premium-mailbox-logical-delete\.js\?v=20260820a/);
  assert.match(page, /assets\/premium-mailbox-images\.js\?v=20260821a/);
  assert.match(page, /assets\/premium-mailbox\.js\?v=20260907a/);
  assert.match(page, /assets\/premium-mailbox-discovery\.js\?v=20260907b/);
  assert.match(page, /assets\/premium-browser-storage\.js\?v=20260828b/);
  assert.match(page, /assets\/premium-mailbox-state-outbox\.js\?v=20260826a/);
  assert.match(page, /assets\/premium-mailbox-read\.js\?v=20260826a/);
  assert.match(page, /assets\/premium-mailbox-ui-state\.js\?v=20260907a/);
  assert.match(page, /assets\/premium-mailbox-delete\.js\?v=20260820a/);
  assert.match(page, /assets\/premium-mailbox-body-section\.js\?v=20260818c/);
  assert.match(page, /assets\/premium-mailbox-refresh\.js\?v=20260909a/);
  assert.match(page, /assets\/premium-mailbox-owner-session\.js\?v=20260909a/);
