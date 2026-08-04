const { INTERNE_LINKSTRUCTUUR_CONTENT_ITEM } = require('./seo-content-interne-linkstructuur');
const { BEDRIJFSSOFTWARE_KOSTEN_CONTENT_ITEM } = require('./seo-content-bedrijfssoftware-kosten');
const { CHATBOT_KOSTEN_CONTENT_ITEM } = require('./seo-content-chatbot-kosten');

const SEO_CONTENT_QUALITY_V2_ITEMS = Object.freeze([
  INTERNE_LINKSTRUCTUUR_CONTENT_ITEM,
  BEDRIJFSSOFTWARE_KOSTEN_CONTENT_ITEM,
  CHATBOT_KOSTEN_CONTENT_ITEM,
]);

module.exports = {
  SEO_CONTENT_QUALITY_V2_ITEMS,
};
