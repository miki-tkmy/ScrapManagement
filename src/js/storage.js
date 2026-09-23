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
  USER_SETTINGS: "scrap_user_settings",
  EMPLOYEE_PREFERENCES: "scrap_emp_preferences"
};

// V3.10: 初期カテゴリセット (実28グループ + 仮想1グループ = 計29カテゴリ)
const DEFAULT_29_CATEGORIES = [
  "IQ", "AN", "AJ", "AY", "AZ", "BA", "BC", "CA", "DS", "EA", "GK", "H3", "H6", "HA", "HS",
  "KK", "PC", "PP", "QB", "RT", "SA", "SS", "UA", "UG", "VM", "YT", "YU", "ZZ", "__UNGROUPED__"
];

// V3.10: 全66カテゴリ定義 (65実グループ + 仮想1グループ、DisplayOrder ASC、最後がグループ無し)
const DEFAULT_66_CATEGORIES = [
  { categoryCode: "A1", categoryName: "建枠６００ＳＪ", displayOrder: 10 },
  { categoryCode: "A2", categoryName: "建枠９００ＳＪ", displayOrder: 20 },
  { categoryCode: "A3", categoryName: "建枠１２００ＳＪ", displayOrder: 30 },
  { categoryCode: "AA", categoryName: "建枠その他", displayOrder: 40 },
  { categoryCode: "AB", categoryName: "スジカイ", displayOrder: 50 },
  { categoryCode: "AC", categoryName: "鋼製板", displayOrder: 60 },
  { categoryCode: "AH", categoryName: "梁枠", displayOrder: 70 },
  { categoryCode: "AJ", categoryName: "ジャッキベース", displayOrder: 80 },
  { categoryCode: "AN", categoryName: "セイフティウォーク", displayOrder: 90 },
  { categoryCode: "AT", categoryName: "手摺", displayOrder: 100 },
  { categoryCode: "AU", categoryName: "手摺柱", displayOrder: 110 },
  { categoryCode: "AW", categoryName: "梁渡し", displayOrder: 120 },
  { categoryCode: "AY", categoryName: "養生金網・防音パネル", displayOrder: 130 },
  { categoryCode: "AZ", categoryName: "カイダン", displayOrder: 140 },
  { categoryCode: "BA", categoryName: "土木その他", displayOrder: 150 },
  { categoryCode: "BB", categoryName: "売却品", displayOrder: 160 },
  { categoryCode: "BC", categoryName: "先行手摺・巾木類", displayOrder: 170 },
  { categoryCode: "BD", categoryName: "バルコロード", displayOrder: 180 },
  { categoryCode: "BL", categoryName: "売却品ＬＣ", displayOrder: 190 },
  { categoryCode: "BO", categoryName: "売却品ＡＯＳ", displayOrder: 200 },
  { categoryCode: "CA", categoryName: "クランプ", displayOrder: 210 },
  { categoryCode: "CB", categoryName: "コンポ橋ブラケット", displayOrder: 220 },
  { categoryCode: "CC", categoryName: "クラウドカメラ", displayOrder: 230 },
  { categoryCode: "CL", categoryName: "クロスリンクステージ", displayOrder: 240 },
  { categoryCode: "DS", categoryName: "伸縮ブラケット", displayOrder: 250 },
  { categoryCode: "EA", categoryName: "アルミ朝顔", displayOrder: 260 },
  { categoryCode: "EB", categoryName: "エコーバリア", displayOrder: 270 },
  { categoryCode: "GD", categoryName: "ゴンドラ", displayOrder: 280 },
  { categoryCode: "GK", categoryName: "脚立", displayOrder: 290 },
  { categoryCode: "H3", categoryName: "ハイパー３Ｔ", displayOrder: 300 },
  { categoryCode: "H6", categoryName: "ハイパー６Ｔ", displayOrder: 310 },
  { categoryCode: "HA", categoryName: "スパイダー", displayOrder: 320 },
  { categoryCode: "HS", categoryName: "ハイパー共通", displayOrder: 330 },
  { categoryCode: "IQ", categoryName: "Ｉｑシステム", displayOrder: 340 },
  { categoryCode: "KK", categoryName: "６０角バタ", displayOrder: 350 },
  { categoryCode: "LC", categoryName: "リフトクライマー", displayOrder: 360 },
  { categoryCode: "LL", categoryName: "ペコビーム", displayOrder: 370 },
  { categoryCode: "MD", categoryName: "ムーバルデッキ", displayOrder: 380 },
  { categoryCode: "OO", categoryName: "１００角バタ", displayOrder: 390 },
  { categoryCode: "PC", categoryName: "チェーン", displayOrder: 400 },
  { categoryCode: "PF", categoryName: "パワーフレーム", displayOrder: 410 },
  { categoryCode: "PP", categoryName: "パイプ", displayOrder: 420 },
  { categoryCode: "QB", categoryName: "強力サポート", displayOrder: 430 },
  { categoryCode: "QQ", categoryName: "他・低稼働機材", displayOrder: 440 },
  { categoryCode: "RR", categoryName: "ＲＯＲＯ足場", displayOrder: 450 },
  { categoryCode: "RT", categoryName: "壁つなぎ", displayOrder: 460 },
  { categoryCode: "SA", categoryName: "シート朝顔", displayOrder: 470 },
  { categoryCode: "SB", categoryName: "スタンディングベア", displayOrder: 480 },
  { categoryCode: "SG", categoryName: "元　他社品", displayOrder: 490 },
  { categoryCode: "SP", categoryName: "四角支柱", displayOrder: 500 },
  { categoryCode: "SS", categoryName: "サポート", displayOrder: 510 },
  { categoryCode: "TD", categoryName: "タイガーダム", displayOrder: 520 },
  { categoryCode: "TS", categoryName: "ＴＳサポート", displayOrder: 530 },
  { categoryCode: "TT", categoryName: "敷鉄板", displayOrder: 540 },
  { categoryCode: "UA", categoryName: "軽量鋼製板", displayOrder: 550 },
  { categoryCode: "UG", categoryName: "木製足場板", displayOrder: 560 },
  { categoryCode: "VA", categoryName: "Ｈ建築その他", displayOrder: 570 },
  { categoryCode: "VD", categoryName: "Ｈ土木・型枠", displayOrder: 580 },
  { categoryCode: "VM", categoryName: "Ｖ－ＭＡＸ", displayOrder: 590 },
  { categoryCode: "VS", categoryName: "Ｈ支保工", displayOrder: 600 },
  { categoryCode: "VT", categoryName: "ＨＳＴシステム", displayOrder: 610 },
  { categoryCode: "WP", categoryName: "ワークプラットホーム", displayOrder: 620 },
  { categoryCode: "YT", categoryName: "ＹＴロック下部材", displayOrder: 630 },
  { categoryCode: "YU", categoryName: "ＹＴロック上部材", displayOrder: 640 },
  { categoryCode: "ZZ", categoryName: "一般その他", displayOrder: 650 },
  { categoryCode: "__UNGROUPED__", categoryName: "グループ無し", displayOrder: 660 }
];

const SESSION_STORAGE_KEYS = {
  WORKING_BASE_CODE: "scrap_working_base_code",
  WORKING_BASE_NAME: "scrap_working_base_name",
  WORKING_BASE_EMP_NO: "scrap_working_base_emp_no"
};

// 1. 利用者設定 (社員番号, 解決済み担当者名, 所属拠点コード, 所属拠点名, 選択資材カテゴリ, 選択定型品)
function getUserSettings() {
  try {
    const raw = localStorage.getItem(TERMINAL_STORAGE_KEYS.USER_SETTINGS);
    return raw ? JSON.parse(raw) : {
      employeeNo: "",
      resolvedEmployeeName: "",
      employeeBaseCode: "",
      employeeBaseName: "",
      resolvedBaseCode: "",
      resolvedBaseName: "",
      baseSelectionRequired: false,
      selectedMaterialCategories: [],
      selectedFixedItemCodes: [],
      lastVerifiedAt: null
    };
  } catch (e) {
    return {
      employeeNo: "",
      resolvedEmployeeName: "",
      employeeBaseCode: "",
      employeeBaseName: "",
      resolvedBaseCode: "",
      resolvedBaseName: "",
      baseSelectionRequired: false,
      selectedMaterialCategories: [],
      selectedFixedItemCodes: [],
      lastVerifiedAt: null
    };
  }
}

// 1.1 セッション Working Base 管理 (sessionStorage のみ使用、localStorage へ永続化禁止)
function getSessionWorkingBase(empNo) {
  try {
    if (typeof sessionStorage === "undefined") return null;
    const storedEmp = sessionStorage.getItem(SESSION_STORAGE_KEYS.WORKING_BASE_EMP_NO);
    if (!storedEmp || (empNo && storedEmp !== String(empNo).trim().toUpperCase())) {
      clearSessionWorkingBase();
      return null;
    }
    const code = sessionStorage.getItem(SESSION_STORAGE_KEYS.WORKING_BASE_CODE);
    const name = sessionStorage.getItem(SESSION_STORAGE_KEYS.WORKING_BASE_NAME);
    if (code) {
      return { baseCode: code, baseName: name || "" };
    }
    return null;
  } catch (e) {
    return null;
  }
}

function setSessionWorkingBase(baseCode, baseName, empNo) {
  try {
    if (typeof sessionStorage === "undefined") return;
    if (baseCode) {
      sessionStorage.setItem(SESSION_STORAGE_KEYS.WORKING_BASE_CODE, String(baseCode).trim());
      sessionStorage.setItem(SESSION_STORAGE_KEYS.WORKING_BASE_NAME, String(baseName || "").trim());
      if (empNo) {
        sessionStorage.setItem(SESSION_STORAGE_KEYS.WORKING_BASE_EMP_NO, String(empNo).trim().toUpperCase());
      }
    } else {
      clearSessionWorkingBase();
    }
  } catch (e) {}
}

function clearSessionWorkingBase() {
  try {
    if (typeof sessionStorage === "undefined") return;
    sessionStorage.removeItem(SESSION_STORAGE_KEYS.WORKING_BASE_CODE);
    sessionStorage.removeItem(SESSION_STORAGE_KEYS.WORKING_BASE_NAME);
    sessionStorage.removeItem(SESSION_STORAGE_KEYS.WORKING_BASE_EMP_NO);
  } catch (e) {}
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

function getSelectedMaterialCategories() {
  const settings = getUserSettings();
  if (settings.employeeNo) {
    const pref = getEmployeePreferences(settings.employeeNo);
    return pref.categories;
  }
  return Array.isArray(settings.selectedMaterialCategories) && settings.selectedMaterialCategories.length > 0
    ? settings.selectedMaterialCategories
    : DEFAULT_29_CATEGORIES.slice();
}

function saveSelectedMaterialCategories(categories) {
  const cats = Array.isArray(categories) ? categories : [];
  saveUserSettings({ selectedMaterialCategories: cats });
}

// 1.2 V3.10 社員別カテゴリ設定キャッシュ管理 (scrap_emp_preferences)
function getAllEmployeePreferencesCache() {
  try {
    const raw = localStorage.getItem(TERMINAL_STORAGE_KEYS.EMPLOYEE_PREFERENCES);
    return raw ? JSON.parse(raw) : {};
  } catch (e) {
    return {};
  }
}

// V3.10: 単一集約 Normalizer (API 形状と内部 Canonical 形状の相互互換保証)
function normalizeEmployeePreference(pref) {
  if (!pref || typeof pref !== "object") {
    return {
      exists: false,
      categories: DEFAULT_29_CATEGORIES.slice(),
      revision: 0,
      updatedAt: null
    };
  }

  // categories 抽出: pref.categories (内部 Canonical 形式) または pref.selectedMaterialCategories (API 形式)
  let rawCats = null;
  if (Array.isArray(pref.categories)) {
    rawCats = pref.categories;
  } else if (Array.isArray(pref.selectedMaterialCategories)) {
    rawCats = pref.selectedMaterialCategories;
  }

  // exists 判定:
  // 1. 明示的に exists === true の場合は存在
  // 2. 明示的に exists === false の場合は不存在
  // 3. exists が未定義だが categories または selectedMaterialCategories が配列として与えられている場合は存在 (内部 Canonical 互換)
  let exists = false;
  if (pref.exists === true) {
    exists = true;
  } else if (pref.exists === false) {
    exists = false;
  } else if (rawCats !== null) {
    exists = true;
  }
  let rev = 0;
  if (typeof pref.revision === "number" && Number.isFinite(pref.revision)) {
    rev = pref.revision;
  } else if (typeof pref.preferenceRevision === "number" && Number.isFinite(pref.preferenceRevision)) {
    rev = pref.preferenceRevision;
  }

  const updatedAt = pref.updatedAt ? String(pref.updatedAt) : null;

  if (!exists) {
    return {
      exists: false,
      categories: DEFAULT_29_CATEGORIES.slice(),
      revision: rev,
      updatedAt: updatedAt
    };
  }

  // exists === true の場合:
  // rawCats が配列なら (空配列 [] を含め) そのまま保持。配列でない場合は空配列 []
  const categories = Array.isArray(rawCats) ? rawCats.slice() : [];

  return {
    exists: true,
    categories: categories,
    revision: rev,
    updatedAt: updatedAt
  };
}

function getEmployeePreferences(empNo) {
  if (!empNo) {
    return {
      exists: false,
      categories: DEFAULT_29_CATEGORIES.slice(),
      revision: 0,
      updatedAt: null,
      cachedAt: null
    };
  }
  const cleanEmpNo = String(empNo).trim().toUpperCase();
  const allCache = getAllEmployeePreferencesCache();
  if (allCache && allCache[cleanEmpNo]) {
    const rec = allCache[cleanEmpNo];
    const normalized = normalizeEmployeePreference(rec);
    return {
      exists: normalized.exists,
      categories: normalized.categories,
      revision: normalized.revision,
      updatedAt: normalized.updatedAt,
      cachedAt: rec.cachedAt || null
    };
  }
  return {
    exists: false,
    categories: DEFAULT_29_CATEGORIES.slice(),
    revision: 0,
    updatedAt: null,
    cachedAt: null
  };
}

function saveEmployeePreferences(empNo, pref) {
  if (!empNo) return;
  const cleanEmpNo = String(empNo).trim().toUpperCase();
  const normalized = normalizeEmployeePreference(pref);
  const allCache = getAllEmployeePreferencesCache();

  allCache[cleanEmpNo] = {
    exists: normalized.exists,
    categories: normalized.categories,
    revision: normalized.revision,
    updatedAt: normalized.updatedAt,
    cachedAt: new Date().toISOString()
  };

  try {
    localStorage.setItem(TERMINAL_STORAGE_KEYS.EMPLOYEE_PREFERENCES, JSON.stringify(allCache));
  } catch (e) {}

  // アクティブ社員なら USER_SETTINGS の selectedMaterialCategories も同期
  const settings = getUserSettings();
  if (settings.employeeNo && String(settings.employeeNo).trim().toUpperCase() === cleanEmpNo) {
    saveSelectedMaterialCategories(normalized.categories);
  }
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

// State Snapshot (Base別軽量状態スナップショット)
function getStateSnapshot(baseCode) {
  if (!baseCode) return null;
  try {
    const raw = sessionStorage.getItem(`scrap_state_snapshot_${baseCode || "GLOBAL"}`);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (e) {
    return null;
  }
}

function saveStateSnapshot(baseCode, stateData) {
  if (!baseCode || !stateData) return;
  try {
    const slipRev = stateData.slipCountRevision !== undefined
      ? stateData.slipCountRevision
      : null;

    const matRev = stateData.materialSummaryRevision !== undefined
      ? stateData.materialSummaryRevision
      : (stateData.summaryRevision !== undefined ? stateData.summaryRevision : null);

    const payload = {
      baseCode: baseCode,
      masterRevision: stateData.masterRevision !== undefined ? stateData.masterRevision : 1,
      historyRevision: stateData.historyRevision !== undefined ? stateData.historyRevision : 1,
      slipCountRevision: slipRev,
      materialSummaryRevision: matRev,
      summaryRevision: matRev !== null ? matRev : (stateData.summaryRevision !== undefined ? stateData.summaryRevision : null),
      serverTime: stateData.serverTime || "",
      checkedAt: Date.now()
    };
    sessionStorage.setItem(`scrap_state_snapshot_${baseCode || "GLOBAL"}`, JSON.stringify(payload));
    setLastStateCheckTime(baseCode, payload.checkedAt);
  } catch (e) {}
}

function isStateSnapshotFresh(baseCode, ttlMs = STATE_THROTTLE_MS) {
  const snapshot = getStateSnapshot(baseCode);
  if (!snapshot || !snapshot.checkedAt) return false;
  return (Date.now() - snapshot.checkedAt) < ttlMs;
}

// 1. マスタキャッシュ (localStorage) - CASE A: 全品保持 (allItems)
function getMasterCache() {
  try {
    const raw = localStorage.getItem("scrap_cache_master");
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    // allItems または items を確実に保持
    if (parsed && !parsed.allItems && parsed.items) {
      parsed.allItems = parsed.items;
    }
    return parsed;
  } catch (e) {
    return null;
  }
}

function saveMasterCache(masterData, masterRevision = 1) {
  try {
    const allItems = masterData.allItems || masterData.items || [];
    const payload = {
      masterRevision: masterRevision,
      bases: masterData.bases || [],
      allItems: allItems,
      items: allItems, // 互換性のためのエイリアス
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
      sessionStorage.removeItem(`scrap_state_snapshot_${baseCode}`);
      sessionStorage.removeItem(`scrap_state_checked_${baseCode}`);
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

function saveSummaryCache(baseCode, fromDate, toDate, data, revisions = {}) {
  if (!baseCode) return;
  const key = `scrap_cache_summary_${baseCode}_${fromDate || ""}_${toDate || ""}`;
  try {
    const slipCountRev = typeof revisions === "object" && revisions !== null
      ? (revisions.slipCountRevision || data.slipCountRevision || 1)
      : 1;
    const matSummRev = typeof revisions === "object" && revisions !== null
      ? (revisions.materialSummaryRevision || revisions.summaryRevision || data.materialSummaryRevision || data.summaryRevision || 1)
      : (typeof revisions === "number" ? revisions : 1);

    const payload = {
      baseCode: baseCode,
      fromDate: fromDate || "",
      toDate: toDate || "",
      slipCountRevision: slipCountRev,
      totalSlipsCount: data.totalSlipsCount !== undefined ? data.totalSlipsCount : 0,
      materialSummaryRevision: matSummRev,
      totalItemsCount: data.totalItemsCount !== undefined ? data.totalItemsCount : 0,
      totalWeightKg: data.totalWeightKg !== undefined ? data.totalWeightKg : 0,
      items: data.items || [],
      // 互換用データ構造
      summaryRevision: matSummRev,
      data: data,
      fetchedAt: Date.now()
    };
    sessionStorage.setItem(key, JSON.stringify(payload));
  } catch (e) {}
}

function updateSummaryCountInCache(baseCode, fromDate, toDate, count, slipCountRevision) {
  if (!baseCode) return null;
  const key = `scrap_cache_summary_${baseCode}_${fromDate || ""}_${toDate || ""}`;
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    const cached = JSON.parse(raw);
    cached.totalSlipsCount = count;
    if (slipCountRevision !== undefined) {
      cached.slipCountRevision = slipCountRevision;
    }
    if (cached.data) {
      cached.data.totalSlipsCount = count;
      if (slipCountRevision !== undefined) {
        cached.data.slipCountRevision = slipCountRevision;
      }
    }
    sessionStorage.setItem(key, JSON.stringify(cached));
    return cached;
  } catch (e) {
    return null;
  }
}

function invalidateSummaryCache(baseCode) {
  try {
    if (baseCode) {
      sessionStorage.removeItem(`scrap_state_snapshot_${baseCode}`);
      sessionStorage.removeItem(`scrap_state_checked_${baseCode}`);
    }
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
  try {
    for (let i = sessionStorage.length - 1; i >= 0; i--) {
      const k = sessionStorage.key(i);
      if (k && (k.startsWith("scrap_state_snapshot_") || k.startsWith("scrap_state_checked_"))) {
        sessionStorage.removeItem(k);
      }
    }
  } catch (e) {}
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    getUserSettings,
    saveUserSettings,
    clearUserSettings,
    getSelectedMaterialCategories,
    saveSelectedMaterialCategories,
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
    getStateSnapshot,
    saveStateSnapshot,
    isStateSnapshotFresh,
    getMasterCache,
    saveMasterCache,
    invalidateMasterCache,
    getHistoryCache,
    saveHistoryCache,
    invalidateHistoryCache,
    getSummaryCache,
    saveSummaryCache,
    updateSummaryCountInCache,
    invalidateSummaryCache,
    invalidateAllCaches,
    getSessionWorkingBase,
    setSessionWorkingBase,
    clearSessionWorkingBase,
    DEFAULT_29_CATEGORIES,
    DEFAULT_66_CATEGORIES,
    getAllEmployeePreferencesCache,
    normalizeEmployeePreference,
    getEmployeePreferences,
    saveEmployeePreferences
  };
  module.exports.TerminalStorage = module.exports;
}
if (typeof window !== "undefined") {
  window.TerminalStorage = {
    getUserSettings,
    saveUserSettings,
    clearUserSettings,
    getSessionWorkingBase,
    setSessionWorkingBase,
    clearSessionWorkingBase,
    getSelectedMaterialCategories,
    saveSelectedMaterialCategories,
    DEFAULT_29_CATEGORIES,
    DEFAULT_66_CATEGORIES,
    getAllEmployeePreferencesCache,
    normalizeEmployeePreference,
    getEmployeePreferences,
    saveEmployeePreferences,
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
    getStateSnapshot,
    saveStateSnapshot,
    isStateSnapshotFresh,
    getMasterCache,
    saveMasterCache,
    invalidateMasterCache,
    getHistoryCache,
    saveHistoryCache,
    invalidateHistoryCache,
    getSummaryCache,
    saveSummaryCache,
    updateSummaryCountInCache,
    invalidateSummaryCache,
    invalidateAllCaches
  };
}
