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
      baseCode: "B01",
      baseName: "仙台Base",
      staffName: "",
      vendorName: ""
    };
  } catch (e) {
    return {
      baseCode: "B01",
      baseName: "仙台Base",
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
    saveAppSettings
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
    saveAppSettings
  };
}
