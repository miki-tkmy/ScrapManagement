// BaseCode 入力・検索サービス (baseService.js)
// Central DB (Google Sheets) 連携マスタ (window.ACTIVE_BASES) を最優先参照

function normalizeBaseCode(input) {
  if (typeof input !== "string") return "";
  // 半角変換 & 大文字変換
  return input
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, s => String.fromCharCode(s.charCodeAt(0) - 0xFEE0))
    .toUpperCase()
    .trim();
}

function isValidBaseCodeChar(char) {
  return /^[A-Z0-9]$/.test(char);
}

function getEffectiveBaseList(baseList) {
  if (baseList && Array.isArray(baseList) && baseList.length > 0) return baseList;
  if (typeof window !== "undefined") {
    if (window.ACTIVE_BASES && Array.isArray(window.ACTIVE_BASES) && window.ACTIVE_BASES.length > 0) {
      return window.ACTIVE_BASES;
    }
    return window.TEST_FIXTURE_BASES || [];
  }
  return [];
}

function searchBaseCodes(input, baseList) {
  const code = normalizeBaseCode(input);
  if (!code) return [];

  const list = getEffectiveBaseList(baseList);
  return list.filter(b => b.active !== false && b.baseCode.startsWith(code));
}

function findExactBase(input, baseList) {
  const code = normalizeBaseCode(input);
  if (!code) return null;

  const list = getEffectiveBaseList(baseList);
  return list.find(b => b.active !== false && b.baseCode === code) || null;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    normalizeBaseCode,
    isValidBaseCodeChar,
    searchBaseCodes,
    findExactBase,
    getEffectiveBaseList
  };
}
if (typeof window !== "undefined") {
  window.BaseService = {
    normalizeBaseCode,
    isValidBaseCodeChar,
    searchBaseCodes,
    findExactBase,
    getEffectiveBaseList
  };
}
