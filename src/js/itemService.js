// ItemCode 主キー検索サービス (itemService.js)
// Central DB (Google Sheets) 連携マスタ (window.ACTIVE_ITEMS) を最優先参照

function normalizeItemCode(input) {
  if (typeof input !== "string") return "";
  return input
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, s => String.fromCharCode(s.charCodeAt(0) - 0xFEE0))
    .toUpperCase()
    .trim();
}

function isValidItemCodeChar(char) {
  return /^[A-Z0-9]$/.test(char);
}

function getEffectiveItemList(itemList) {
  if (itemList && Array.isArray(itemList) && itemList.length > 0) return itemList;
  if (typeof window !== "undefined") {
    if (window.ACTIVE_ITEMS && Array.isArray(window.ACTIVE_ITEMS) && window.ACTIVE_ITEMS.length > 0) {
      return window.ACTIVE_ITEMS;
    }
    return window.TEST_FIXTURE_ITEMS || [];
  }
  return [];
}

function searchItemCodes(input, itemList) {
  const code = normalizeItemCode(input);
  if (!code) return [];

  const list = getEffectiveItemList(itemList);
  return list.filter(item => item.active !== false && item.itemCode.startsWith(code));
}

function findExactItem(input, itemList) {
  const code = normalizeItemCode(input);
  if (!code) return null;

  const list = getEffectiveItemList(itemList);
  return list.find(item => item.active !== false && item.itemCode === code) || null;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    normalizeItemCode,
    isValidItemCodeChar,
    searchItemCodes,
    findExactItem,
    getEffectiveItemList
  };
}
if (typeof window !== "undefined") {
  window.ItemService = {
    normalizeItemCode,
    isValidItemCodeChar,
    searchItemCodes,
    findExactItem,
    getEffectiveItemList
  };
}
