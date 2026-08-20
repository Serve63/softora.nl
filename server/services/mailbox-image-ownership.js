const SENT_CAMPAIGN_IMAGE_OWNER = 'sent-campaign';
const quotedThread = require('../../assets/premium-mailbox-quoted-thread.js');

function normalizeCampaignText(value) {
  return String(value || '')
    .replace(/\r\n?/g, '\n')
    .replace(/\u2060/g, '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function getAuthoredMessageText(value) {
  return quotedThread.splitQuotedThread(value).authored;
}

function isOriginalCampaignOutboundMessage(message = {}) {
  if (String(message.folder || '').trim().toLowerCase() !== 'sent') return false;
  if (String(message.inReplyTo || message.in_reply_to || '').trim()) return false;
  if (String(message.references || message.references_text || '').trim()) return false;
  const authored = normalizeCampaignText(
    getAuthoredMessageText(message.body || message.text || message.preview)
  );
  const subject = normalizeCampaignText(message.subject);
  const signals = [
    /\bafgelopen week kwam ik (?:jullie|je|uw) website\b/,
    /\b(?:uit|vanuit) enthousiasme\b.{0,180}\b(?:fris|nieuw)\s+webdesign\b/s,
    /\bik heb\b.{0,100}\b(?:fris|nieuw)\s+webdesign\b.{0,80}\bgemaakt\b/s,
    /\bik ben oprecht benieuwd wat (?:je|jullie|u) ervan vind/,
    /\b(?:ontwerp|webdesign)\b.{0,100}\b(?:bijlage|online preview)\b/s,
  ];
  const signalCount = signals.filter((pattern) => pattern.test(authored)).length;
  const campaignSubject =
    subject.includes('kleine vraag over jullie website') ||
    subject.includes('nieuw webdesign');
  return signalCount >= 2 || (campaignSubject && signalCount >= 1);
}

function normalizeImageIdentity(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\.[a-z0-9]{2,5}$/gi, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function isSentCampaignDesignImage(image) {
  return /\b(?:webdesign|preview|device mockup|mockup|website generator)\b/.test(
    normalizeImageIdentity(image && (image.alt || image.cid))
  );
}

function tagSentCampaignBodyImages(bodyImages, options = {}) {
  const images = Array.isArray(bodyImages) ? bodyImages : [];
  if (String(options.folder || '').trim().toLowerCase() === 'sent') return images;
  const quotedCampaign = Boolean(options.looksLikeCampaign);
  return images.map((image) => {
    if (!(quotedCampaign && isSentCampaignDesignImage(image))) return image;
    return {
      ...image,
      owner: SENT_CAMPAIGN_IMAGE_OWNER,
    };
  });
}

module.exports = {
  SENT_CAMPAIGN_IMAGE_OWNER,
  getAuthoredMessageText,
  isOriginalCampaignOutboundMessage,
  isSentCampaignDesignImage,
  tagSentCampaignBodyImages,
};
