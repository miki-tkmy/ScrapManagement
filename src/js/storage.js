// 端末側補助ストレージ (storage.js)
// ========================================================================================
// ※ 永続的 Source of Truth は Central DB (Google Sheets)
//    本モジュールは「端末利用者設定（社員番号・選択カテゴリ等）」および
//    「前回値保持」「電波障害時の一時下書き保存」を担当する
// ========================================================================================

const TERMINAL_STORAGE_KEYS = {
  PREVIOUS_INPUT: "scrap_terminal_previous_input",
  LOCAL_TEMP_DRAFT: "scrap_terminal_local_draft",
  SETTINGS: "scrap_app_settings",
  USER_SETTINGS: "scrap_user_settings"
};

// 1. 利用者設定 (社員番号, 解決済み担当者名, 拠点コード, 拠点名, 選択資材カテゴリ, 選択定型品)
function getUserSettings() {
  try {
    const raw = localStorage.getItem(TERMINAL_STORAGE_KEYS.USER_SETTINGS);
    return raw ? JSON.parse(raw) : {
      employeeNo: "",
      resolvedEmployeeName: "",
      resolvedBaseCode: "",
      resolvedBaseName: "",
      selectedMaterialCategories: [],
      selectedFixedItemCodes: [],
      lastVerifiedAt: null
    };
  } catch (e) {
    return {
      employeeNo: "",
      resolvedEmployeeName: "",
      resolvedBaseCode: "",
      resolvedBaseName: "",
      selectedMaterialCategories: [],
      selectedFixedItemCodes: [],
      lastVerifiedAt: null
    };
  }
}

function saveUserSettings(settings) {
  try {
    const existing = getUserSettings();
    const merged = Object.assign({}, existing, settings);
    localStorage.setItem(TERMINAL_STORAGE_KEYS.USER_SETTINGS, JSON.stringify(merged));
  } catch (e) {}
}

function clearUserSettings() {
  try {
    localStorage.removeItem(TERMINAL_STORAGE_KEYS.USER_SETTINGS);
  } catch (e) {}
}

// 2. 前回値保持 (BaseCode, BaseName, 担当者名, スクラップ業者名)
function getPreviousInput() {
  try {
    const raw = localStorage.getItem(TERMINAL_STORAGE_KEYS.PREVIOUS_INPUT);
    return raw ? JSON.parse(raw) : {
      baseCode: "",
      baseName: "",
      staffName: "",
      vendorName: ""
    };
  } catch (e) {
    return {
      baseCode: "",
      baseName: "",
      staffName: "",
      vendorName: ""
    };
  }
}

function savePreviousInput(data) {
  try {
    const existing = getPreviousInput();
    const merged = {
      baseCode: data.baseCode !== undefined ? data.baseCode : existing.baseCode,
      baseName: data.baseName !== undefined ? data.baseName : existing.baseName,
      staffName: data.staffName !== undefined ? data.staffName : existing.staffName,
      vendorName: data.vendorName !== undefined ? data.vendorName : existing.vendorName
    };
    localStorage.setItem(TERMINAL_STORAGE_KEYS.PREVIOUS_INPUT, JSON.stringify(merged));
  } catch (e) {}
}

// 3. 端末一時下書き
function getLocalDraft() {
  try {
    const raw = localStorage.getItem(TERMINAL_STORAGE_KEYS.LOCAL_TEMP_DRAFT);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

function saveLocalDraft(draftData) {
  try {
    localStorage.setItem(TERMINAL_STORAGE_KEYS.LOCAL_TEMP_DRAFT, JSON.stringify(draftData));
  } catch (e) {}
}

function clearLocalDraft() {
  try {
    localStorage.removeItem(TERMINAL_STORAGE_KEYS.LOCAL_TEMP_DRAFT);
  } catch (e) {}
}

// 4. アプリ内部設定
function getAppSettings() {
  try {
    const raw = localStorage.getItem(TERMINAL_STORAGE_KEYS.SETTINGS);
    return raw ? JSON.parse(raw) : { gasWebhookUrl: "" };
  } catch (e) {
    return { gasWebhookUrl: "" };
  }
}

function saveAppSettings(settings) {
  try {
    localStorage.setItem(TERMINAL_STORAGE_KEYS.SETTINGS, JSON.stringify(settings));
  } catch (e) {}
}


// キャッシュ設定 (リビジョン連動型 & 30秒スロットル)
const STATE_THROTTLE_MS = 30 * 1000; // 30秒
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // セーフティネットとしてのTTL

function getLastStateCheckTime(baseCode) {
  try {
    const raw = sessionStorage.getItem(`scrap_state_checked_${baseCode || "GLOBAL"}`);
    return raw ? parseInt(raw, 10) : 0;
  } catch (e) {
    return 0;
  }
}

function setLastStateCheckTime(baseCode, time = Date.now()) {
  try {
    sessionStorage.setItem(`scrap_state_checked_${baseCode || "GLOBAL"}`, String(time));
  } catch (e) {}
}

function isStateCheckThrottled(baseCode) {
  const last = getLastStateCheckTime(baseCode);
  return (Date.now() - last) < STATE_THROTTLE_MS;
}

// 1. マスタキャッシュ (localStorage)
function getMasterCache() {
  try {
    const raw = localStorage.getItem("scrap_cache_master");
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (e) {
    return null;
  }
}

function saveMasterCache(masterData, masterRevision = 1) {
  try {
    const payload = {
      masterRevision: masterRevision,
      bases: masterData.bases || [],
      items: masterData.items || [],
      fixedItems: masterData.fixedItems || [],
      categories: masterData.categories || [],
      fetchedAt: Date.now()
    };
    localStorage.setItem("scrap_cache_master", JSON.stringify(payload));
  } catch (e) {}
}

function invalidateMasterCache() {
  try {
    localStorage.removeItem("scrap_cache_master");
  } catch (e) {}
}

// 2. 履歴キャッシュ (sessionStorage)
function getHistoryCache(baseCode) {
  if (!baseCode) return null;
  try {
    const raw = sessionStorage.getItem(`scrap_cache_history_${baseCode}`);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (e) {
    return null;
  }
}

function saveHistoryCache(baseCode, cacheData, historyRevision = 1) {
  if (!baseCode) return;
  try {
    const payload = {
      baseCode: baseCode,
      historyRevision: historyRevision,
      finalSlips: cacheData.finalSlips || [],
      draftSlips: cacheData.draftSlips || [],
      fetchedAt: Date.now()
    };
    sessionStorage.setItem(`scrap_cache_history_${baseCode}`, JSON.stringify(payload));
  } catch (e) {}
}

function invalidateHistoryCache(baseCode) {
  try {
    if (baseCode) {
      sessionStorage.removeItem(`scrap_cache_history_${baseCode}`);
    } else {
      // 全履歴キャッシュ削除
      for (let i = sessionStorage.length - 1; i >= 0; i--) {
        const k = sessionStorage.key(i);
        if (k && k.startsWith("scrap_cache_history_")) {
          sessionStorage.removeItem(k);
        }
      }
    }
  } catch (e) {}
}

// 3. 集計キャッシュ (sessionStorage)
function getSummaryCache(baseCode, fromDate, toDate) {
  if (!baseCode) return null;
  const key = `scrap_cache_summary_${baseCode}_${fromDate || ""}_${toDate || ""}`;
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (e) {
    return null;
  }
}

function saveSummaryCache(baseCode, fromDate, toDate, data, summaryRevision = 1) {
  if (!baseCode) return;
  const key = `scrap_cache_summary_${baseCode}_${fromDate || ""}_${toDate || ""}`;
  try {
    const payload = {
      data: data,
      summaryRevision: summaryRevision,
      fetchedAt: Date.now()
    };
    sessionStorage.setItem(key, JSON.stringify(payload));
  } catch (e) {}
}

function invalidateSummaryCache(baseCode) {
  try {
    const prefix = baseCode ? `scrap_cache_summary_${baseCode}_` : "scrap_cache_summary_";
    for (let i = sessionStorage.length - 1; i >= 0; i--) {
      const k = sessionStorage.key(i);
      if (k && k.startsWith(prefix)) {
        sessionStorage.removeItem(k);
      }
    }
  } catch (e) {}
}

function invalidateAllCaches() {
  invalidateHistoryCache();
  invalidateSummaryCache();
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    getUserSettings,
    saveUserSettings,
    clearUserSettings,
    getPreviousInput,
    savePreviousInput,
    getLocalDraft,
    saveLocalDraft,
    clearLocalDraft,
    getAppSettings,
    saveAppSettings,
    STATE_THROTTLE_MS,
    CACHE_TTL_MS,
    getLastStateCheckTime,
    setLastStateCheckTime,
    isStateCheckThrottled,
    getMasterCache,
    saveMasterCache,
    invalidateMasterCache,
    getHistoryCache,
    saveHistoryCache,
    invalidateHistoryCache,
    getSummaryCache,
    saveSummaryCache,
    invalidateSummaryCache,
    invalidateAllCaches
  };
}
if (typeof window !== "undefined") {
  window.TerminalStorage = {
    getUserSettings,
    saveUserSettings,
    clearUserSettings,
    getPreviousInput,
    savePreviousInput,
    getLocalDraft,
    saveLocalDraft,
    clearLocalDraft,
    getAppSettings,
    saveAppSettings,
    STATE_THROTTLE_MS,
    CACHE_TTL_MS,
    getLastStateCheckTime,
    setLastStateCheckTime,
    isStateCheckThrottled,
    getMasterCache,
    saveMasterCache,
    invalidateMasterCache,
    getHistoryCache,
    saveHistoryCache,
    invalidateHistoryCache,
    getSummaryCache,
    saveSummaryCache,
    invalidateSummaryCache,
    invalidateAllCaches
  };
}
