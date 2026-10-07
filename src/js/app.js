// アプリケーション統合コントローラー (app.js)
// ========================================================================================
// Runtime Asset Identity (Section E)
const SCRAP_APP_RUNTIME_REV = "OPERATION-UX-20261007-01";
if (typeof window !== "undefined") {
  window.SCRAP_APP_RUNTIME_REV = SCRAP_APP_RUNTIME_REV;
}

// ScrapManagement Cross-Cutting Remediation
// - 履歴・集計の Source of Truth: Central DB (Google Sheets / GAS)
// - 社員番号設定 (CompanyBaseDB Projection) & 拠点/担当者ロック
// - 資材明細の数量増減 [+]/[-] コントロール
// - 完了・一時保存後の完全フォームリセット
// - 印刷帳票: 2x2「田」レイアウト、右上伝票番号単一化、署名なし空白、メイリオ統一
// - 集計期間指定 (開始日〜終了日) & 期間連動 CSV エクスポート
// - カテゴリ別・定型品別マスタフィルタリング & Lazy Loading
// ========================================================================================

let currentCodeItems = [];
let currentOtherItems = [];
let fixedItemsState = {};
let vendorPad = null;
let gasClient = null;
let pendingFinalizeSlip = null;
let confirmedSignatureData = null;
let genericModalCallback = null;
let lastFinalizedSlipIndex = 0;
let lastFinalizedSlipData = null;

// 中央履歴・集計キャッシュ
let centralHistorySlips = [];
let centralDraftSlips = [];
let currentSummaryData = null;
let currentResumedDraftId = null;
let currentResumedDraftDate = null;

// P11 履歴検索・詳細表示用ステート
let historySearchState = {
  fromDate: "",
  toDate: "",
  keyword: "",
  signatureStatus: "ALL",
  visibleCount: 50
};
let filteredHistorySlips = [];
const historyDetailCache = new Map();

// 社員設定 (所属Base vs 入力Base 分離)
let resolvedEmployeeNo = "";
let resolvedEmployeeName = "";
let assignedEmployeeBaseCode = "";
let assignedEmployeeBaseName = "";
let workingBaseCode = "";
let workingBaseName = "";

// 後方互換性エイリアス (常に workingBaseCode / workingBaseName に同期)
let resolvedBaseCode = "";
let resolvedBaseName = "";

function escapeHtml(str) {
  if (str === null || str === undefined) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function runBootstrapSequence() {
  if (typeof setDiagnosticStage === "function") {
    setDiagnosticStage("BOOTSTRAP_START");
  }

  const steps = [
    {
      name: "initializeGasClientInstance",
      fn: () => initializeGasClientInstance()
    },
    {
      name: "initDiagnostic",
      fn: () => initDiagnostic()
    },
    {
      name: "initUserSettings",
      fn: () => {
        initUserSettings();
        if (typeof setDiagnosticStage === "function") {
          setDiagnosticStage("USER_SETTINGS_RESTORED");
        }
      }
    },
    {
      name: "startMasterSynchronization",
      fn: () => startMasterSynchronization()
    },
    {
      name: "initCompletionState",
      fn: () => initCompletionState()
    },
    {
      name: "initBaseCodeHandlers",
      fn: () => initBaseCodeHandlers()
    },
    {
      name: "initBaseSelectorModal",
      fn: () => initBaseSelectorModal()
    },
    {
      name: "initItemCodeHandlers",
      fn: () => initItemCodeHandlers()
    },
    {
      name: "initFixedItemsList",
      fn: () => initFixedItemsList()
    },
    {
      name: "initVendorSignaturePad",
      fn: () => initVendorSignaturePad()
    },
    {
      name: "initSummaryDates",
      fn: () => initSummaryDates()
    },
    {
      name: "setupNormalizations",
      fn: () => {
        setupHalfWidthNormalization(document.getElementById("other-name-input"));
        setupHalfWidthNormalization(document.getElementById("other-qty-input"));
      }
    },
    {
      name: "initVendorInputHandlers",
      fn: () => initVendorInputHandlers()
    },
    {
      name: "updateDisplays",
      fn: () => {
        updateWeightDisplay();
        updateSignatureDisplay();
      }
    }
  ];

  let hasFatalError = false;
  for (const step of steps) {
    try {
      step.fn();
    } catch (err) {
      console.error("[BOOTSTRAP_INIT_ERROR] Step failed:", step.name, err);
      hasFatalError = true;
      if (typeof setDiagnosticStage === "function") {
        setDiagnosticStage("BOOTSTRAP_FAILED", {
          errorCode: `BOOTSTRAP_INIT_ERROR_${step.name}`
        });
      }
    }
  }

  if (!hasFatalError && typeof setDiagnosticStage === "function") {
    setDiagnosticStage("BOOTSTRAP_READY");
  }
}

if (typeof document !== "undefined") {
  document.addEventListener("DOMContentLoaded", () => {
    runBootstrapSequence();
  });
}

// V3.10: 資材グループキー解決ヘルパー (NULL / 空文字は仮想グループ __UNGROUPED__ へ投影)
function getMaterialCategoryKey(item) {
  if (!item) return "__UNGROUPED__";
  const cat = (item.groupCode || item.categoryCode || item.category || "").trim();
  return cat ? cat : "__UNGROUPED__";
}

// V3.10: カテゴリフィルタリング用ヘルパー (全品からローカル抽出、空配列 [] は全除外)
function applyMaterialCategoryFilter(allItems, selectedCategories) {
  if (!allItems || !Array.isArray(allItems)) return [];
  const allowed = Array.isArray(selectedCategories) ? selectedCategories : (TerminalStorage.DEFAULT_29_CATEGORIES || []);
  const set = new Set(allowed);
  return allItems.filter(it => set.has(getMaterialCategoryKey(it)));
}

// V3.10: マスタローディング & ステータスバー UX 制御
let masterStatusTimer = null;

function showMasterStatusBar(message, isLoading = true) {
  if (typeof document === "undefined") return;
  const bar = document.getElementById("master-status-bar");
  const text = document.getElementById("master-status-text");
  const spinner = document.getElementById("master-status-spinner");
  if (!bar || !text) return;
  if (masterStatusTimer) {
    clearTimeout(masterStatusTimer);
    masterStatusTimer = null;
  }
  text.textContent = message;
  if (spinner) spinner.style.display = isLoading ? "inline-block" : "none";
  bar.style.display = "block";
}

function hideMasterStatusBar(delayMs = 0) {
  if (typeof document === "undefined") return;
  if (masterStatusTimer) {
    clearTimeout(masterStatusTimer);
    masterStatusTimer = null;
  }
  if (delayMs > 0) {
    masterStatusTimer = setTimeout(() => {
      const bar = document.getElementById("master-status-bar");
      if (bar) bar.style.display = "none";
      masterStatusTimer = null;
    }, delayMs);
  } else {
    const bar = document.getElementById("master-status-bar");
    if (bar) bar.style.display = "none";
  }
}

function showMasterLoadingOverlay() {
  if (typeof document === "undefined") return;
  const overlay = document.getElementById("master-loading-overlay");
  const progress = document.getElementById("loading-progress-container");
  const errActions = document.getElementById("loading-error-actions");
  if (!overlay) return;
  overlay.style.display = "flex";
  if (progress) progress.style.display = "block";
  if (errActions) errActions.style.display = "none";
}

function hideMasterLoadingOverlay() {
  if (typeof document === "undefined") return;
  const overlay = document.getElementById("master-loading-overlay");
  if (overlay) overlay.style.display = "none";
}

function showMasterLoadingError(message) {
  if (typeof document === "undefined") return;
  const overlay = document.getElementById("master-loading-overlay");
  const progress = document.getElementById("loading-progress-container");
  const errActions = document.getElementById("loading-error-actions");
  const errText = document.getElementById("loading-error-text");
  if (!overlay) return;
  overlay.style.display = "flex";
  if (progress) progress.style.display = "none";
  if (errActions) errActions.style.display = "block";
  if (errText) errText.textContent = message || "資材データの取得に失敗しました。";
}

function retryFetchMasters() {
  showMasterLoadingOverlay();
  fetchAndApplyMasters(1);
}

// 1. GAS クライアント初期化 (依存処理の前に必ず実行)
function initializeGasClientInstance() {
  if (!gasClient) {
    gasClient = new GasClient();
  }
  updateNetworkStatus();
  if (typeof setDiagnosticStage === "function") {
    setDiagnosticStage("GAS_CLIENT_READY");
  }
}

// マスタデータ復元 & バックグラウンド同期開始
function startMasterSynchronization() {
  // Fast Path: マスタキャッシュ (localStorage) があれば即時復元して画面操作可能へ
  const cachedMasters = TerminalStorage.getMasterCache();
  const userSettings = TerminalStorage.getUserSettings();
  const activeEmpNo = userSettings.employeeNo;
  const empPref = activeEmpNo ? TerminalStorage.getEmployeePreferences(activeEmpNo) : null;
  const currentCategories = (empPref && empPref.exists)
    ? empPref.categories
    : (Array.isArray(userSettings.selectedMaterialCategories) && userSettings.selectedMaterialCategories.length > 0
        ? userSettings.selectedMaterialCategories
        : (TerminalStorage.DEFAULT_29_CATEGORIES || []));

  if (cachedMasters && cachedMasters.bases && cachedMasters.bases.length > 0) {
    window.ACTIVE_BASES = cachedMasters.bases;
    const allItems = cachedMasters.allItems || cachedMasters.items || [];
    window.ACTIVE_ALL_ITEMS = allItems;
    window.ACTIVE_ITEMS = applyMaterialCategoryFilter(allItems, currentCategories);
    if (cachedMasters.fixedItems && cachedMasters.fixedItems.length > 0) {
      window.ACTIVE_FIXED_ITEMS = cachedMasters.fixedItems;
      initFixedItemsList();
      renderSettingsView();
    }
    if (cachedMasters.categories && cachedMasters.categories.length > 0) {
      window.AVAILABLE_CATEGORIES = cachedMasters.categories;
    }
    // 非ブロッキング小型表示: 最新データを確認中…
    showMasterStatusBar("最新データを確認中…", true);
  } else {
    // First Load: ブロッキング ローディング UI (架空%なし)
    showMasterLoadingOverlay();
  }

  // バックグラウンドで State / MasterRevision を確認
  checkMasterRevisionAndUpdate();
}

// 後方互換性エイリアス
function initGasClient() {
  initializeGasClientInstance();
  startMasterSynchronization();
}

function checkMasterRevisionAndUpdate() {
  const cachedMasters = TerminalStorage.getMasterCache();
  const cachedRev = (cachedMasters && cachedMasters.masterRevision) ? cachedMasters.masterRevision : 0;
  const baseCode = resolvedBaseCode || "GLOBAL";

  gasClient.fetchState(baseCode).then(stateRes => {
    if (stateRes && stateRes.success) {
      TerminalStorage.saveStateSnapshot(baseCode, stateRes);
    }
    const serverMasterRev = (stateRes && stateRes.success && stateRes.masterRevision) ? stateRes.masterRevision : null;
    // キャッシュなし、または MasterRevision が更新されている場合のみ fetchMasters を実行
    if (!cachedMasters || serverMasterRev === null || serverMasterRev !== cachedRev) {
      if (cachedMasters) {
        showMasterStatusBar("資材データを更新中…", true);
      }
      fetchAndApplyMasters(serverMasterRev || 1);
    } else {
      hideMasterStatusBar(400);
    }
  }).catch(() => {
    if (!cachedMasters) {
      fetchAndApplyMasters(1);
    } else {
      showMasterStatusBar("最新データを取得できませんでした。保存済みデータを使用しています", false);
      hideMasterStatusBar(4000);
    }
  });
}

function fetchAndApplyMasters(targetRevision = 1) {
  const cachedMasters = TerminalStorage.getMasterCache();

  // CASE A: 全品マスタを取得し、ローカルでフィルタリングする
  gasClient.fetchMasters({}).then(res => {
    hideMasterLoadingOverlay();
    if (res && res.success) {
      if (Array.isArray(res.bases) && res.bases.length > 0) window.ACTIVE_BASES = res.bases;
      const allItems = Array.isArray(res.items) ? res.items : [];
      window.ACTIVE_ALL_ITEMS = allItems;

      const userSettings = TerminalStorage.getUserSettings();
      const activeEmpNo = userSettings.employeeNo;
      const empPref = activeEmpNo ? TerminalStorage.getEmployeePreferences(activeEmpNo) : null;
      const currentCategories = (empPref && empPref.exists)
        ? empPref.categories
        : (Array.isArray(userSettings.selectedMaterialCategories) && userSettings.selectedMaterialCategories.length > 0
            ? userSettings.selectedMaterialCategories
            : (TerminalStorage.DEFAULT_29_CATEGORIES || []));

      window.ACTIVE_ITEMS = applyMaterialCategoryFilter(allItems, currentCategories);
      if (Array.isArray(res.fixedItems) && res.fixedItems.length > 0) {
        window.ACTIVE_FIXED_ITEMS = res.fixedItems;
        initFixedItemsList();
        renderSettingsView();
      }
      if (Array.isArray(res.categories) && res.categories.length > 0) {
        window.AVAILABLE_CATEGORIES = res.categories;
      }
      // マスタキャッシュ保存 (全品 allItems を保存)
      TerminalStorage.saveMasterCache({
        bases: window.ACTIVE_BASES,
        allItems: allItems,
        items: window.ACTIVE_ITEMS,
        fixedItems: window.ACTIVE_FIXED_ITEMS,
        categories: window.AVAILABLE_CATEGORIES
      }, targetRevision);

      if (cachedMasters) {
        showMasterStatusBar("最新データに更新しました", false);
        hideMasterStatusBar(2500);
      } else {
        hideMasterStatusBar(0);
      }
    } else if (gasClient.getMode() === "GAS_STAGING") {
      console.warn("[app.js] STAGING Backend masters unavailable:", res ? res.error : "Unknown");
      if (cachedMasters) {
        showMasterStatusBar("最新データを取得できませんでした。保存済みデータを使用しています", false);
        hideMasterStatusBar(4000);
      } else {
        showMasterLoadingError("資材データの取得に失敗しました。電波の良い場所で再試行してください。");
      }
    } else {
      if (!cachedMasters) {
        showMasterLoadingError("資材データの取得に失敗しました。");
      }
    }
  }).catch(err => {
    hideMasterLoadingOverlay();
    console.error("[app.js] fetchMasters failed:", err);
    if (cachedMasters) {
      showMasterStatusBar("最新データを取得できませんでした。保存済みデータを使用しています", false);
      hideMasterStatusBar(4000);
    } else {
      showMasterLoadingError("資材データの取得に失敗しました。電波の良い場所で再試行してください。");
    }
  });
}

function updateNetworkStatus() {
  const mockBadge = document.getElementById("mock-warning-badge");
  if (!mockBadge) return;
  if (gasClient && gasClient.getMode() === "MOCK") {
    mockBadge.style.display = "inline-flex";
  } else {
    mockBadge.style.display = "none";
  }
}

// 2. 利用者設定 (社員番号・担当者・所属拠点) の初期化 & フォームロック
function initUserSettings() {
  const settings = TerminalStorage.getUserSettings();
  if (settings.employeeNo && settings.resolvedEmployeeName) {
    resolvedEmployeeNo = settings.employeeNo;
    resolvedEmployeeName = settings.resolvedEmployeeName;
    assignedEmployeeBaseCode = settings.employeeBaseCode || settings.resolvedBaseCode || "";
    assignedEmployeeBaseName = settings.employeeBaseName || settings.resolvedBaseName || "";

    // セッション中に明示変更された Working Base があれば優先
    const sessionBase = TerminalStorage.getSessionWorkingBase(resolvedEmployeeNo);
    if (sessionBase && sessionBase.baseCode) {
      updateWorkingBaseState(sessionBase.baseCode, sessionBase.baseName, false);
    } else if (assignedEmployeeBaseCode) {
      updateWorkingBaseState(assignedEmployeeBaseCode, assignedEmployeeBaseName, false);
    } else {
      // 未所属社員 (本部・統括) でセッション未選択の場合 -> 未選択
      updateWorkingBaseState("", "", false);
    }

    // 設定画面へ反映
    const empInput = document.getElementById("setting-employee-no");
    const nameInput = document.getElementById("setting-employee-name");
    const baseInput = document.getElementById("setting-base-name");
    const statusEl = document.getElementById("setting-employee-status");

    if (empInput) empInput.value = resolvedEmployeeNo;
    if (nameInput) nameInput.value = resolvedEmployeeName;
    if (baseInput) baseInput.value = assignedEmployeeBaseName || "(未所属・入力時選択)";
    if (statusEl) {
      statusEl.innerHTML = `<span style="color:var(--color-success); font-weight:bold;">✓ 社員登録済み (${resolvedEmployeeName} / ${assignedEmployeeBaseName || "未所属"})</span>`;
    }

    // V3.10 SWR: 社員別 Preference をローカルキャッシュから即時適用
    const empPref = TerminalStorage.getEmployeePreferences(resolvedEmployeeNo);
    if (empPref && empPref.exists) {
      window.ACTIVE_ITEMS = applyMaterialCategoryFilter(window.ACTIVE_ALL_ITEMS || [], empPref.categories);
    }

    // 伝票入力画面のロック & UI反映
    applyEmployeeLockToForm();
    hideEmployeeUnconfiguredBanner();
    applyEmployeeDefaultVendorToForm();

    // V3.10 SWR: バックグラウンドで最新 Preference リビジョンを確認
    const refreshEmpNo = resolvedEmployeeNo;
    if (gasClient && typeof gasClient.lookupEmployee === "function") {
      gasClient.lookupEmployee(refreshEmpNo).then(res => {
        if (res && res.success && res.preference) {
          const cachedPref = TerminalStorage.getEmployeePreferences(refreshEmpNo);
          const serverRev = typeof res.preference.preferenceRevision === "number"
            ? res.preference.preferenceRevision
            : (typeof res.preference.revision === "number" ? res.preference.revision : 0);
          if (!cachedPref.exists || cachedPref.revision !== serverRev) {
            TerminalStorage.saveEmployeePreferences(refreshEmpNo, res.preference);
            // 現在も同じ社員が選択されている場合のみ UI へ反映
            if (resolvedEmployeeNo === refreshEmpNo) {
              const activePref = TerminalStorage.getEmployeePreferences(refreshEmpNo);
              window.ACTIVE_ITEMS = applyMaterialCategoryFilter(window.ACTIVE_ALL_ITEMS || [], activePref.categories);
              renderSettingsView();
              initFixedItemsList();
              applyEmployeeDefaultVendorToForm();
            }
          }
        }
      }).catch(err => {
        console.warn("[initUserSettings] Background preference refresh error (non-fatal):", err);
      });
    } else {
      console.warn("[initUserSettings] gasClient is not initialized; skipping background preference refresh.");
    }
  } else {
    // 社員未設定状態を維持
    resolvedEmployeeNo = "";
    resolvedEmployeeName = "";
    assignedEmployeeBaseCode = "";
    assignedEmployeeBaseName = "";
    updateWorkingBaseState("", "", false);
    showEmployeeUnconfiguredBanner();
    applyEmployeeDefaultVendorToForm();
  }
}

function showEmployeeUnconfiguredBanner() {
  let banner = document.getElementById("employee-unconfigured-banner");
  if (!banner) {
    const createView = document.getElementById("view-create");
    if (createView) {
      banner = document.createElement("div");
      banner.id = "employee-unconfigured-banner";
      banner.className = "alert-box";
      banner.style.cssText = "margin-bottom:1rem; padding:0.75rem 1rem; background:#fee2e2; border:1px solid #f87171; border-radius:6px; color:#991b1b;";
      banner.innerHTML = `
        <p style="font-weight:bold; margin:0 0 0.25rem 0;">⚠ 社員番号が未設定です</p>
        <p style="margin:0; font-size:0.85rem;">伝票の入力・保存を行うには、まず「設定」タブで社員番号を登録してください。</p>
        <button type="button" class="btn btn-sm btn-primary" onclick="switchTab('settings')" style="margin-top:0.5rem;">設定タブを開く</button>
      `;
      createView.insertBefore(banner, createView.firstChild);
    }
  }
}

function hideEmployeeUnconfiguredBanner() {
  const banner = document.getElementById("employee-unconfigured-banner");
  if (banner && banner.parentNode) {
    banner.parentNode.removeChild(banner);
  }
}

function initCompletionState() {
  try {
    const t5 = (typeof performance !== "undefined" && performance.timeOrigin) ? (performance.timeOrigin + performance.now()) : Date.now();
    const completionPending = sessionStorage.getItem("scrap_completion_pending");
    if (completionPending === "true") {
      const t6 = (typeof performance !== "undefined" && performance.timeOrigin) ? (performance.timeOrigin + performance.now()) : Date.now();
      openCompletionModal();
      const t7 = (typeof performance !== "undefined" && performance.timeOrigin) ? (performance.timeOrigin + performance.now()) : Date.now();

      // End-to-End 計測データの集計 (Section 4 & 5)
      const perfRaw = sessionStorage.getItem("scrap_finalize_perf");
      if (perfRaw) {
        try {
          const perf = JSON.parse(perfRaw);
          const apiDuration = Math.max(0, Math.round(perf.t2 - perf.t1));
          const responseProcessing = Math.max(0, Math.round(perf.t4 - perf.t2));
          const reloadBootstrap = Math.max(0, Math.round(t7 - perf.t4));
          const totalPerceived = Math.max(0, Math.round(t7 - perf.t0));

          const perfRecord = {
            t0: perf.t0,
            t1: perf.t1,
            t2: perf.t2,
            t3: perf.t3,
            t4: perf.t4,
            t5: t5,
            t6: t6,
            t7: t7,
            apiDuration: apiDuration,
            responseProcessing: responseProcessing,
            reloadBootstrap: reloadBootstrap,
            totalPerceived: totalPerceived,
            measuredAt: new Date().toISOString()
          };
          sessionStorage.setItem("scrap_last_perf_result", JSON.stringify(perfRecord));
          console.log(`[PERF-AUDIT] Total perceived: ${totalPerceived}ms (API: ${apiDuration}ms, Response: ${responseProcessing}ms, Reload/Bootstrap: ${reloadBootstrap}ms)`);

          // テスト・自動計測用 非表示データ属性 (画面非表示)
          let perfEl = document.getElementById("perf-result-data");
          if (!perfEl) {
            perfEl = document.createElement("div");
            perfEl.id = "perf-result-data";
            perfEl.style.display = "none";
            document.body.appendChild(perfEl);
          }
          perfEl.textContent = JSON.stringify(perfRecord);
        } catch (parseErr) {
          console.warn("[app.js] Perf log parse error:", parseErr);
        }
      }
    }

    const draftSavedSuccess = sessionStorage.getItem("scrap_draft_saved_success");
    if (draftSavedSuccess === "true") {
      sessionStorage.removeItem("scrap_draft_saved_success");
      showAppModal({
        title: "一時保存",
        message: "一時保存しました。\n履歴画面の「一時保存中」から再開できます。"
      });
    }
  } catch (e) {
    console.error("[app.js] initCompletionState error:", e);
  }
}

function applyEmployeeLockToForm() {
  const staffNameInput = document.getElementById("staff-name-input");
  const baseCodeGroup = document.getElementById("base-code-group");

  if (staffNameInput) {
    staffNameInput.value = resolvedEmployeeName;
    staffNameInput.readOnly = true;
    staffNameInput.classList.add("input-readonly");
  }
  if (baseCodeGroup) {
    baseCodeGroup.style.display = "none";
  }

  renderWorkingBaseUi();
}

// Working Base 状態更新 & 同期ヘルパー
function updateWorkingBaseState(baseCode, baseName, persistSession = true) {
  workingBaseCode = baseCode ? String(baseCode).trim() : "";
  workingBaseName = baseName ? String(baseName).trim() : "";
  resolvedBaseCode = workingBaseCode;
  resolvedBaseName = workingBaseName;

  // P11: Working Base 切替時は履歴検索ステートと詳細キャッシュをリセット
  historySearchState = {
    fromDate: "",
    toDate: "",
    keyword: "",
    signatureStatus: "ALL",
    visibleCount: 50
  };
  if (typeof historyDetailCache !== "undefined" && historyDetailCache && historyDetailCache.clear) {
    historyDetailCache.clear();
  }

  if (persistSession && resolvedEmployeeNo) {
    TerminalStorage.setSessionWorkingBase(workingBaseCode, workingBaseName, resolvedEmployeeNo);
  }

  renderWorkingBaseUi();
}

function renderWorkingBaseUi() {
  const baseNameDisplay = document.getElementById("base-name-display");
  const baseCodeInput = document.getElementById("base-code-input");
  const btnChange = document.getElementById("btn-change-working-base");
  const warningEl = document.getElementById("working-base-warning");
  const hintEl = document.getElementById("assigned-base-name-hint");

  if (baseCodeInput) baseCodeInput.value = workingBaseCode;

  if (baseNameDisplay) {
    if (workingBaseName) {
      baseNameDisplay.value = workingBaseName;
      if (baseNameDisplay.style) baseNameDisplay.style.color = "var(--color-text)";
    } else {
      baseNameDisplay.value = "";
      baseNameDisplay.placeholder = "拠点を選択してください";
    }
  }

  if (btnChange) {
    btnChange.textContent = workingBaseCode ? "変更" : "選択";
  }

  if (warningEl && hintEl) {
    if (workingBaseCode && assignedEmployeeBaseCode && workingBaseCode !== assignedEmployeeBaseCode) {
      hintEl.textContent = assignedEmployeeBaseName || assignedEmployeeBaseCode;
      if (warningEl.style) warningEl.style.display = "block";
    } else {
      if (warningEl.style) warningEl.style.display = "none";
    }
  }
}

// 取引中データ存在チェック (Base変更時のクリアガード用)
function hasActiveTransactionData() {
  const vendorInput = document.getElementById("vendor-name-input");
  const hasVendor = Boolean(vendorInput && vendorInput.value.trim());
  const hasCodeItems = Array.isArray(currentCodeItems) && currentCodeItems.length > 0;
  const hasFixedItems = typeof collectFixedItems === "function" ? collectFixedItems().length > 0 : false;
  const hasOtherItems = Array.isArray(currentOtherItems) && currentOtherItems.length > 0;
  const hasSignature = Boolean(confirmedSignatureData || (vendorPad && !vendorPad.isEmpty()));
  const hasPendingFinalize = Boolean(pendingFinalizeSlip);
  return Boolean(hasVendor || hasCodeItems || hasFixedItems || hasOtherItems || hasSignature || hasPendingFinalize);
}

// 社員単位 defaultVendorName 取得ヘルパー
function getCurrentEmployeeDefaultVendor() {
  if (!resolvedEmployeeNo) return "";
  const pref = TerminalStorage.getEmployeePreferences(resolvedEmployeeNo);
  return (pref && pref.defaultVendorName) ? pref.defaultVendorName.trim() : "";
}

// 伝票入力画面への既定業者名自動入力
function applyEmployeeDefaultVendorToForm(options = {}) {
  const force = options && options.force === true;
  const vendorInput = document.getElementById("vendor-name-input");
  if (!vendorInput) return;

  // 1. 再開中・編集中Draftがある場合はDraftの値を最優先（Draft再開時はforceであっても上書き禁止）
  if (currentResumedDraftId) {
    return;
  }

  const isUserEdited = vendorInput.dataset ? vendorInput.dataset.userEdited === "true" : false;
  const currentVal = vendorInput.value ? vendorInput.value.trim() : "";
  const lastApplied = (vendorInput.dataset && vendorInput.dataset.lastAppliedVendor) || "";

  // 2. forceでない場合、既にユーザーが手動で独自に入力した値があれば上書きしない
  // (自動適用された値のまま、または空欄の場合は最新の既定値へ更新可能)
  if (!force && isUserEdited && currentVal !== "" && currentVal !== lastApplied) {
    return;
  }

  // 3. 社員番号が設定されている場合、その社員の defaultVendorName を適用
  if (resolvedEmployeeNo) {
    const defaultVendor = getCurrentEmployeeDefaultVendor();
    vendorInput.value = defaultVendor;
    if (vendorInput.dataset) {
      vendorInput.dataset.lastAppliedVendor = defaultVendor;
      vendorInput.dataset.userEdited = "false";
    }
    return;
  }

  // 4. 社員未設定時の legacy fallback: PREVIOUS_INPUT.vendorName (社員番号設定済みの場合は絶対に使用しない)
  if (!resolvedEmployeeNo && !force) {
    if (!isUserEdited || currentVal === "" || currentVal === lastApplied) {
      const prev = TerminalStorage.getPreviousInput();
      const prevVendor = (prev && prev.vendorName) ? prev.vendorName.trim() : "";
      vendorInput.value = prevVendor;
      if (vendorInput.dataset) {
        vendorInput.dataset.lastAppliedVendor = prevVendor;
        vendorInput.dataset.userEdited = "false";
      }
    }
  } else if (!resolvedEmployeeNo && force) {
    vendorInput.value = "";
    if (vendorInput.dataset) {
      vendorInput.dataset.lastAppliedVendor = "";
      vendorInput.dataset.userEdited = "false";
    }
  }
}

// サーバー同期済み vendorName キャッシュ (社員番号単位) & リクエスト順序追跡
const _lastSyncedServerVendor = {};
const _lastConfirmedVendor = {};
const _inFlightVendorSave = {};
let _vendorSaveSeq = 0;

// 業者名入力変更・フォーカスアウト時の社員Preference保存 (非ブロッキング)
async function handleVendorInputChange() {
  const vendorInput = document.getElementById("vendor-name-input");
  if (!vendorInput) return;
  const newVendor = vendorInput.value.trim();
  vendorInput.value = newVendor;

  // 再開中下書き編集中は社員Preferenceの自動上書きを禁止（下書き固有データを保護）
  if (currentResumedDraftId) {
    return;
  }

  // 保存開始時の社員番号をクロージャに固定 (非同期待機中の社員切替による混入を完全防止)
  const targetEmpNo = resolvedEmployeeNo;
  if (!targetEmpNo) {
    // 社員未設定時のみ legacy PREVIOUS_INPUT にフォールバック保存
    TerminalStorage.savePreviousInput({ vendorName: newVendor });
    return;
  }

  // 既に同一社員・同一業者名のリクエストが送信中であれば重複送信を抑止 (change と blur の連続発火対策)
  if (_inFlightVendorSave[targetEmpNo] === newVendor) {
    return;
  }

  // 社員設定済み時:
  const currentPref = TerminalStorage.getEmployeePreferences(targetEmpNo);
  const currentVendor = (currentPref && currentPref.defaultVendorName) ? currentPref.defaultVendorName.trim() : "";

  // 確定値の追跡: キャッシュにあればそれを使用、なければcurrentPrefから
  if (_lastConfirmedVendor[targetEmpNo] === undefined) {
    _lastConfirmedVendor[targetEmpNo] = currentVendor;
  }
  const fallbackConfirmedVendor = _lastConfirmedVendor[targetEmpNo];
  const previousRevision = (currentPref && typeof currentPref.revision === "number") ? currentPref.revision : 0;

  // 既にこの社員のサーバー保存が完了しており値も一致している場合は中央保存をスキップ
  if (newVendor === currentVendor && _lastSyncedServerVendor[targetEmpNo] === newVendor) {
    return;
  }

  // 楽観的ローカル更新: サーバー待機中の伝票確定や画面遷移でも新しい業者名が即時反映されるようにする
  TerminalStorage.saveEmployeePreferences(targetEmpNo, {
    defaultVendorName: newVendor
  });
  if (vendorInput.dataset) {
    vendorInput.dataset.lastAppliedVendor = newVendor;
  }

  const currentSeq = ++_vendorSaveSeq;
  _inFlightVendorSave[targetEmpNo] = newVendor;

  // 中央 GAS Backend へ非同期保存 (非ブロッキング)
  if (gasClient && typeof gasClient.saveEmployeePreferences === "function") {
    try {
      const expectedRev = (currentPref && typeof currentPref.revision === "number") ? currentPref.revision : null;
      const res = await gasClient.saveEmployeePreferences(
        targetEmpNo,
        { defaultVendorName: newVendor },
        expectedRev
      );
      if (currentSeq !== _vendorSaveSeq) return; // 遅延・旧リクエストの応答は破棄
      if (res && res.success) {
        const confirmedVendor = (res.defaultVendorName !== undefined) ? res.defaultVendorName : newVendor;
        _lastSyncedServerVendor[targetEmpNo] = confirmedVendor;
        _lastConfirmedVendor[targetEmpNo] = confirmedVendor;
        delete _inFlightVendorSave[targetEmpNo];
        TerminalStorage.saveEmployeePreferences(targetEmpNo, {
          defaultVendorName: confirmedVendor,
          revision: res.preferenceRevision,
          updatedAt: res.updatedAt
        });
        // ユーザーが手動編集を継続しておらず、かつ現在も同じ社員で下書き再開中でない場合のみ画面反映
        if (resolvedEmployeeNo === targetEmpNo && !currentResumedDraftId) {
          if (vendorInput.dataset && (vendorInput.dataset.userEdited !== "true" || vendorInput.value === newVendor)) {
            vendorInput.value = confirmedVendor;
            vendorInput.dataset.lastAppliedVendor = confirmedVendor;
          }
        }
      } else if (res && res.error === "PREFERENCE_REVISION_CONFLICT") {
        console.warn("[app.js] Preference revision conflict when saving vendor, fetching latest...");
        const latestRes = await gasClient.lookupEmployee(targetEmpNo);
        if (currentSeq !== _vendorSaveSeq) return;
        if (latestRes && latestRes.success && latestRes.preference) {
          TerminalStorage.saveEmployeePreferences(targetEmpNo, latestRes.preference);
          const newExpected = latestRes.preference.preferenceRevision;
          const retryRes = await gasClient.saveEmployeePreferences(
            targetEmpNo,
            { defaultVendorName: newVendor },
            newExpected
          );
          if (currentSeq !== _vendorSaveSeq) return;
          if (retryRes && retryRes.success) {
            const confirmedVendor = (retryRes.defaultVendorName !== undefined) ? retryRes.defaultVendorName : newVendor;
            _lastSyncedServerVendor[targetEmpNo] = confirmedVendor;
            _lastConfirmedVendor[targetEmpNo] = confirmedVendor;
            delete _inFlightVendorSave[targetEmpNo];
            TerminalStorage.saveEmployeePreferences(targetEmpNo, {
              defaultVendorName: confirmedVendor,
              revision: retryRes.preferenceRevision,
              updatedAt: retryRes.updatedAt
            });
            if (resolvedEmployeeNo === targetEmpNo && !currentResumedDraftId) {
              if (vendorInput.dataset && (vendorInput.dataset.userEdited !== "true" || vendorInput.value === newVendor)) {
                vendorInput.value = confirmedVendor;
                vendorInput.dataset.lastAppliedVendor = confirmedVendor;
              }
            }
          } else {
            console.warn("[app.js] Retry saving vendor preference failed:", retryRes);
            delete _inFlightVendorSave[targetEmpNo];
            TerminalStorage.saveEmployeePreferences(targetEmpNo, {
              defaultVendorName: fallbackConfirmedVendor,
              revision: previousRevision
            });
            showAppModal({
              title: "既定業者名 保存エラー",
              message: "設定競合後の再試行に失敗しました。サーバーに同期されていません。"
            });
          }
        } else {
          // lookupEmployee 失敗時
          console.warn("[app.js] Failed to lookup employee after preference revision conflict:", latestRes);
          delete _inFlightVendorSave[targetEmpNo];
          TerminalStorage.saveEmployeePreferences(targetEmpNo, {
            defaultVendorName: fallbackConfirmedVendor,
            revision: previousRevision
          });
          showAppModal({
            title: "設定競合エラー",
            message: "最新設定の取得に失敗しました。サーバーに同期されていません。\n通信状態を確認の上、再度お試しください。"
          });
        }
      } else {
        console.warn("[app.js] Failed to save vendor preference to server:", res);
        delete _inFlightVendorSave[targetEmpNo];
        TerminalStorage.saveEmployeePreferences(targetEmpNo, {
          defaultVendorName: fallbackConfirmedVendor,
          revision: previousRevision
        });
        showAppModal({
          title: "既定業者名 保存エラー",
          message: "引取業者名の既定値保存に失敗しました。サーバーに同期されていません。\n通信状態を確認の上、再度お試しください。"
        });
      }
    } catch (e) {
      if (currentSeq !== _vendorSaveSeq) return;
      console.warn("[app.js] Failed to save vendor preference to server (non-blocking):", e);
      delete _inFlightVendorSave[targetEmpNo];
      TerminalStorage.saveEmployeePreferences(targetEmpNo, {
        defaultVendorName: fallbackConfirmedVendor,
        revision: previousRevision
      });
      showAppModal({
        title: "通信エラー",
        message: "引取業者名の既定値保存に失敗しました。サーバーに同期されていません。\n通信状態を確認の上、再度お試しください。"
      });
    }
  } else {
    // gasClient 未初期化 / 単体テスト環境等: ローカルキャッシュを更新
    TerminalStorage.saveEmployeePreferences(targetEmpNo, {
      defaultVendorName: newVendor
    });
    _lastSyncedServerVendor[targetEmpNo] = newVendor;
    _lastConfirmedVendor[targetEmpNo] = newVendor;
  }
}

function initVendorInputHandlers() {
  const vendorInput = document.getElementById("vendor-name-input");
  if (!vendorInput) return;
  if (vendorInput._vendorHandlerAttached) return;
  vendorInput._vendorHandlerAttached = true;

  vendorInput.addEventListener("input", () => {
    if (vendorInput.dataset) vendorInput.dataset.userEdited = "true";
  });
  vendorInput.addEventListener("change", () => {
    if (vendorInput.dataset) vendorInput.dataset.userEdited = "true";
    handleVendorInputChange();
  });
  vendorInput.addEventListener("blur", () => {
    handleVendorInputChange();
  });

  applyEmployeeDefaultVendorToForm();
}

// 取引単位データクリア (社員設定・Working Base は維持)
function clearTransactionData() {
  const vendorInput = document.getElementById("vendor-name-input");
  if (vendorInput) vendorInput.value = getCurrentEmployeeDefaultVendor();
  if (vendorInput && vendorInput.dataset) {
    vendorInput.dataset.lastAppliedVendor = vendorInput.value;
    vendorInput.dataset.userEdited = "false";
  }

  currentCodeItems = [];
  currentOtherItems = [];
  if (typeof renderCodeItemsTable === "function") renderCodeItemsTable();
  if (typeof renderOtherItemsTable === "function") renderOtherItemsTable();
  if (typeof updateWeightDisplay === "function") updateWeightDisplay();

  // 定型品 input クリア
  const allFixed = (window.ACTIVE_FIXED_ITEMS && window.ACTIVE_FIXED_ITEMS.length > 0)
    ? window.ACTIVE_FIXED_ITEMS
    : (window.TEST_FIXTURE_FIXED_ITEMS || []);
  allFixed.forEach(fi => {
    const input = document.getElementById(`fixed-qty-${fi.fixedItemId}`);
    if (input) input.value = "";
  });

  confirmedSignatureData = null;
  if (vendorPad) vendorPad.clear();
  if (typeof updateSignatureDisplay === "function") updateSignatureDisplay();

  const notesInput = document.getElementById("notes-input");
  if (notesInput) notesInput.value = "";

  TerminalStorage.clearLocalDraft();
  pendingFinalizeSlip = null;
  currentResumedDraftId = null;
  currentResumedDraftDate = null;
}

// Working Base 変更適用
function applyWorkingBaseChange(newBaseCode, newBaseName) {
  if (!newBaseCode) return;
  updateWorkingBaseState(newBaseCode, newBaseName, true);

  // 選択拠点に応じて履歴・集計キャッシュを無効化
  TerminalStorage.invalidateHistoryCache(newBaseCode);
  TerminalStorage.invalidateSummaryCache(newBaseCode);

  closeBaseSelectorModal();

  // 履歴・集計タブが開かれている場合は更新
  const activeTab = document.querySelector(".nav-item.active");
  if (activeTab && typeof activeTab.getAttribute === "function") {
    const tabId = activeTab.getAttribute("data-tab");
    if (tabId === "history" && typeof renderHistoryTable === "function") renderHistoryTable();
    if (tabId === "summary" && typeof renderSummaryView === "function") renderSummaryView();
  }
}

// Working Base 変更要求 (アクティブ取引ガード付き)
function requestWorkingBaseChange(selectedBaseCode, selectedBaseName) {
  if (!selectedBaseCode) return;
  if (selectedBaseCode === workingBaseCode) {
    closeBaseSelectorModal();
    return;
  }

  if (hasActiveTransactionData()) {
    showAppModal({
      title: "入力Base変更の確認",
      message: "入力Baseを変更すると、現在入力中の伝票内容をクリアします。",
      okText: "変更してクリア",
      cancelText: "戻る",
      onOk: () => {
        clearTransactionData();
        applyWorkingBaseChange(selectedBaseCode, selectedBaseName);
      },
      onCancel: () => {
        // キャンセル時は変更せず現在の入力内容を保持
      }
    });
  } else {
    applyWorkingBaseChange(selectedBaseCode, selectedBaseName);
  }
}

// Base 選択モーダル UI
function openBaseSelectorModal() {
  const modal = document.getElementById("base-selector-modal");
  if (!modal) return;
  modal.style.display = "flex";
  document.body.classList.add("modal-open");

  const searchInput = document.getElementById("base-selector-search-input");
  if (searchInput) {
    searchInput.value = "";
    searchInput.focus();
  }
  renderBaseSelectorList("");
}

function closeBaseSelectorModal() {
  const modal = document.getElementById("base-selector-modal");
  if (!modal) return;
  modal.style.display = "none";
  document.body.classList.remove("modal-open");
}

function renderBaseSelectorList(query = "") {
  const listEl = document.getElementById("base-selector-list");
  if (!listEl) return;
  listEl.innerHTML = "";

  const bases = (typeof BaseService !== "undefined" && BaseService.searchBases)
    ? BaseService.searchBases(query)
    : ((typeof BaseService !== "undefined" && BaseService.getEffectiveBaseList)
      ? BaseService.getEffectiveBaseList()
      : (typeof window !== "undefined" && window.TEST_FIXTURE_BASES ? window.TEST_FIXTURE_BASES : []));

  if (!bases || bases.length === 0) {
    listEl.innerHTML = `<div style="padding: 1rem; text-align: center; color: var(--color-text-muted);">該当する拠点が見つかりません</div>`;
    return;
  }

  bases.forEach(b => {
    const item = document.createElement("div");
    item.className = "base-selector-item" + (b.baseCode === workingBaseCode ? " selected" : "");
    item.innerHTML = `
      <span class="base-selector-item-code">${b.baseCode}</span>
      <span class="base-selector-item-name">${b.baseName}</span>
      ${b.baseCode === workingBaseCode ? '<span style="color:var(--color-primary); font-weight:700; margin-left:auto;">✓</span>' : ''}
    `;
    item.addEventListener("click", () => {
      requestWorkingBaseChange(b.baseCode, b.baseName);
    });
    listEl.appendChild(item);
  });
}

function initBaseSelectorModal() {
  const btnChange = document.getElementById("btn-change-working-base");
  if (btnChange) {
    btnChange.addEventListener("click", () => {
      openBaseSelectorModal();
    });
  }

  const searchInput = document.getElementById("base-selector-search-input");
  if (searchInput) {
    searchInput.addEventListener("input", (e) => {
      renderBaseSelectorList(e.target.value);
    });
  }

  const btnClose = document.getElementById("btn-close-base-selector");
  if (btnClose) {
    btnClose.addEventListener("click", closeBaseSelectorModal);
  }

  const btnCancel = document.getElementById("btn-cancel-base-selector");
  if (btnCancel) {
    btnCancel.addEventListener("click", closeBaseSelectorModal);
  }
}

function initPreviousInputs() {
  const prev = TerminalStorage.getPreviousInput();
  if (prev.baseCode) {
    const baseInput = document.getElementById("base-code-input");
    if (baseInput) baseInput.value = prev.baseCode;
    const base = BaseService.findExactBase(prev.baseCode);
    const baseDisplay = document.getElementById("base-name-display");
    if (baseDisplay) baseDisplay.value = base ? base.baseName : prev.baseName || "";
  }
  if (prev.staffName) {
    const staffInput = document.getElementById("staff-name-input");
    if (staffInput) staffInput.value = prev.staffName;
  }
  // 社員未設定時のみ legacy fallback として prev.vendorName を適用 (社員設定済みの漏洩を完全防止)
  if (!resolvedEmployeeNo && prev.vendorName) {
    const vendorInput = document.getElementById("vendor-name-input");
    if (vendorInput) {
      vendorInput.value = prev.vendorName;
      if (vendorInput.dataset) {
        vendorInput.dataset.lastAppliedVendor = prev.vendorName;
        vendorInput.dataset.userEdited = "false";
      }
    }
  }
}

// 3. 社員番号の照会 & 保存 (設定タブ)
function verifyAndSaveEmployee() {
  const empInput = document.getElementById("setting-employee-no");
  if (!empInput) return;
  const empNo = empInput.value.trim();

  if (!empNo) {
    showAppModal({ title: "入力エラー", message: "社員番号を入力してください。" });
    return;
  }

  const verifyBtn = document.getElementById("btn-verify-employee");
  const statusEl = document.getElementById("setting-employee-status");

  // Defensive Guard: gasClient 利用可能性チェック (未初期化による同期例外と永久待機を完全防止)
  if (!gasClient || typeof gasClient.lookupEmployee !== "function") {
    console.error("[verifyAndSaveEmployee] gasClient not initialized");
    const errMsg = "通信機能の初期化に失敗しました。ページを再読み込みしてください。";
    if (statusEl) {
      statusEl.innerHTML = `<span style="color:var(--color-danger); font-weight:bold;">✕ ${errMsg}</span>`;
    }
    showAppModal({ title: "初期化エラー", message: errMsg });
    if (typeof setDiagnosticStage === "function") {
      setDiagnosticStage("LOOKUP_FAILED", { errorCode: "GAS_CLIENT_NOT_INITIALIZED" });
    }
    if (verifyBtn) verifyBtn.disabled = false;
    return;
  }

  if (typeof setDiagnosticStage === "function") {
    setDiagnosticStage("LOOKUP_START");
  }

  if (verifyBtn) verifyBtn.disabled = true;
  if (statusEl) statusEl.innerHTML = `<span style="color:var(--color-primary);">照会中...</span>`;

  gasClient.lookupEmployee(empNo).then(res => {
    if (typeof setDiagnosticStage === "function") {
      setDiagnosticStage("APP_RECEIVED");
    }

    if (res && res.success && res.employee) {
      const emp = res.employee;
      const bCode = emp.employeeBaseCode !== undefined ? String(emp.employeeBaseCode).trim() : (emp.baseCode ? String(emp.baseCode).trim() : "");
      const bName = emp.employeeBaseName !== undefined ? String(emp.employeeBaseName).trim() : (emp.baseName ? String(emp.baseName).trim() : "");

      // BaseCode のみ、または BaseName のみの不完全データは Fail-Closed
      if ((bCode && !bName) || (!bCode && bName)) {
        const mismatchMsg = "社員情報の拠点データに不整合があります (BaseCode または BaseName の片方のみ設定)。";
        if (statusEl) statusEl.innerHTML = `<span style="color:var(--color-danger); font-weight:bold;">✕ ${mismatchMsg}</span>`;
        showAppModal({ title: "社員情報不整合", message: mismatchMsg });
        if (typeof setDiagnosticStage === "function") {
          setDiagnosticStage("UI_UPDATED", { errorCode: "BASE_DATA_MISMATCH" });
        }
        return;
      }

      const prevEmpNo = resolvedEmployeeNo;
      const newEmpNo = emp.employeeNo || emp.empNo || empNo;
      const isEmployeeChanged = Boolean(String(prevEmpNo || "").trim().toUpperCase() !== String(newEmpNo || "").trim().toUpperCase());

      resolvedEmployeeNo = newEmpNo;
      resolvedEmployeeName = emp.employeeName;
      assignedEmployeeBaseCode = bCode;
      assignedEmployeeBaseName = bName;

      // 社員変更に伴い前社員のセッション Working Base を破棄し、非同期保存の応答を無効化 (同一社員の再確認時は破棄しない)
      if (isEmployeeChanged) {
        TerminalStorage.clearSessionWorkingBase();
        _vendorSaveSeq++;
      }

      if (assignedEmployeeBaseCode) {
        updateWorkingBaseState(assignedEmployeeBaseCode, assignedEmployeeBaseName, false);
      } else {
        // 未所属社員 (本部・統括) は Working Base 未選択で開始
        updateWorkingBaseState("", "", false);
      }

      const nameInput = document.getElementById("setting-employee-name");
      const baseInput = document.getElementById("setting-base-name");
      if (nameInput) nameInput.value = resolvedEmployeeName;
      if (baseInput) baseInput.value = assignedEmployeeBaseName || "(未所属・入力時選択)";

      if (statusEl) {
        statusEl.innerHTML = `<span style="color:var(--color-success); font-weight:bold;">✓ 確認完了: ${resolvedEmployeeName} (${assignedEmployeeBaseName || "未所属"}) として登録しました。</span>`;
      }

      // 端末設定保存
      TerminalStorage.saveUserSettings({
        employeeNo: resolvedEmployeeNo,
        resolvedEmployeeName: resolvedEmployeeName,
        employeeBaseCode: assignedEmployeeBaseCode,
        employeeBaseName: assignedEmployeeBaseName,
        resolvedBaseCode: assignedEmployeeBaseCode,
        resolvedBaseName: assignedEmployeeBaseName,
        baseSelectionRequired: (!assignedEmployeeBaseCode),
        lastVerifiedAt: new Date().toISOString()
      });

      // V3.10: 1 Round Trip で同梱された Preference を保存 & 即時反映
      if (res.preference) {
        TerminalStorage.saveEmployeePreferences(resolvedEmployeeNo, res.preference);
      }
      const activePref = TerminalStorage.getEmployeePreferences(resolvedEmployeeNo);
      window.ACTIVE_ITEMS = applyMaterialCategoryFilter(window.ACTIVE_ALL_ITEMS || [], activePref.categories);
      renderSettingsView();
      initFixedItemsList();

      // 拠点・社員変更に伴い全キャッシュを破棄
      TerminalStorage.invalidateAllCaches();

      // 伝票入力へ即時反映
      applyEmployeeLockToForm();
      hideEmployeeUnconfiguredBanner();
      applyEmployeeDefaultVendorToForm({ force: isEmployeeChanged });

      if (typeof setDiagnosticStage === "function") {
        setDiagnosticStage("UI_UPDATED");
      }

      const modalMsg = assignedEmployeeBaseCode
        ? `社員番号: ${resolvedEmployeeNo}\n担当者: ${resolvedEmployeeName}\n所属拠点: ${assignedEmployeeBaseName}\nとして設定しました。`
        : `社員番号: ${resolvedEmployeeNo}\n担当者: ${resolvedEmployeeName}\n所属拠点: なし（本部・統括社員）\nとして設定しました。\n伝票入力時に入力対象Baseを選択してください。`;

      showAppModal({
        title: "設定完了",
        message: modalMsg
      });
    } else {
      let msg = "社員番号の照会に失敗しました。";
      let errCode = (res && res.error) || "UNKNOWN_ERROR";
      if (res && res.message) {
        msg = res.message;
      } else if (res && res.error) {
        if (res.error === "EMPLOYEE_NOT_FOUND") {
          msg = "指定された社員番号が見つかりません。";
        } else if (res.error === "EMPLOYEE_LOOKUP_TIMEOUT" || res.error === "EMPLOYEE_LOOKUP_HARD_TIMEOUT") {
          msg = "社員情報の照会がタイムアウトしました。通信状態を確認して再試行してください。";
        } else {
          msg = `エラー: ${res.error}`;
        }
      }
      if (typeof setDiagnosticStage === "function") {
        setDiagnosticStage("UI_UPDATED", { errorCode: errCode });
      }
      if (statusEl) statusEl.innerHTML = `<span style="color:var(--color-danger); font-weight:bold;">✕ ${msg}</span>`;
      showAppModal({ title: "照会エラー", message: msg });
    }
  }).catch(err => {
    console.error("[app.js] lookupEmployee error:", err);
    const msg = (err && err.message) ? err.message : "社員情報の取得に失敗しました。通信状態を確認してください。";
    if (typeof setDiagnosticStage === "function") {
      setDiagnosticStage("LOOKUP_FAILED", { errorCode: "EXCEPTION" });
    }
    if (statusEl) statusEl.innerHTML = `<span style="color:var(--color-danger); font-weight:bold;">✕ 通信エラー</span>`;
    showAppModal({ title: "通信エラー", message: msg });
  }).finally(() => {
    if (typeof setDiagnosticStage === "function") {
      setDiagnosticStage("LOOKUP_FINISHED");
    }
    if (verifyBtn) {
      verifyBtn.disabled = false;
    }
    if (statusEl && statusEl.innerHTML && statusEl.innerHTML.includes("照会中...")) {
      statusEl.innerHTML = `<span style="color:var(--color-danger); font-weight:bold;">✕ 照会を終了しました</span>`;
    }
  });
}

// Gate 3-A.5 & P11-R2: 診断パネル初期化 & DOM更新ヘルパー
function checkRuntimeAssetIdentity() {
  const htmlBuild = (typeof document !== "undefined" && document.getElementById("diag-html-build")?.textContent?.trim()) || "";
  const appRuntime = typeof SCRAP_APP_RUNTIME_REV !== "undefined" ? SCRAP_APP_RUNTIME_REV : "";
  let styleRuntime = "";
  if (typeof window !== "undefined" && typeof document !== "undefined") {
    try {
      const rootStyle = getComputedStyle(document.documentElement);
      styleRuntime = (rootStyle.getPropertyValue("--scrap-style-runtime-rev") || "").trim().replace(/^["']|["']$/g, "");
    } catch (e) {}
  }
  const isMatch = Boolean(htmlBuild && appRuntime && styleRuntime && htmlBuild === appRuntime && appRuntime === styleRuntime);
  return {
    htmlBuild,
    appRuntime,
    styleRuntime,
    isMatch,
    statusText: isMatch ? "OK (ALL MATCH)" : "RUNTIME_ASSET_MISMATCH"
  };
}

function initDiagnostic() {
  const urlParams = (typeof window !== "undefined" && window.location) ? new URLSearchParams(window.location.search) : null;
  const isDiag = urlParams && urlParams.get("diag") === "1";
  const diagPanel = document.getElementById("diagnostic-panel");
  if (diagPanel && isDiag) {
    diagPanel.style.display = "block";
  }

  // Runtime Asset Identity (Section E)
  const identity = checkRuntimeAssetIdentity();
  const diagHtmlBuild = document.getElementById("diag-html-build");
  if (diagHtmlBuild && !diagHtmlBuild.textContent.trim()) {
    diagHtmlBuild.textContent = "P11-HISTORY-SEARCH-UI-FIX-R2-20260929-01";
  }
  const diagAppRuntime = document.getElementById("diag-app-runtime");
  if (diagAppRuntime) {
    diagAppRuntime.textContent = identity.appRuntime || "--";
  }
  const diagStyleRuntime = document.getElementById("diag-style-runtime");
  if (diagStyleRuntime) {
    diagStyleRuntime.textContent = identity.styleRuntime || "--";
  }
  const diagAssetStatus = document.getElementById("diag-asset-status");
  if (diagAssetStatus) {
    diagAssetStatus.textContent = identity.statusText;
    diagAssetStatus.style.color = identity.isMatch ? "var(--color-success)" : "var(--color-danger)";
  }

  const diagBuildId = document.getElementById("diag-build-id");
  if (diagBuildId && typeof SCRAP_FRONTEND_BUILD_ID !== "undefined") {
    diagBuildId.textContent = SCRAP_FRONTEND_BUILD_ID;
  }

  updateDiagnosticUI();
}

function updateDiagnosticUI() {
  if (typeof document === "undefined") return;
  const diag = (typeof window !== "undefined" && window.SCRAP_DIAGNOSTIC) ? window.SCRAP_DIAGNOSTIC : null;
  if (!diag) return;

  const bId = document.getElementById("diag-build-id");
  if (bId) bId.textContent = diag.buildId || "--";

  const envEl = document.getElementById("diag-environment");
  if (envEl) envEl.textContent = diag.environment || "--";

  const hostEl = document.getElementById("diag-endpoint-host");
  if (hostEl) hostEl.textContent = diag.endpointHost || "--";

  const uaEl = document.getElementById("diag-user-agent");
  if (uaEl) uaEl.textContent = diag.userAgent || "--";

  const stageEl = document.getElementById("diag-stage");
  if (stageEl) stageEl.textContent = diag.currentStage || "--";

  const elapsedEl = document.getElementById("diag-elapsed");
  if (elapsedEl) elapsedEl.textContent = `${diag.elapsedMs || 0} ms`;

  const errEl = document.getElementById("diag-error-code");
  if (errEl) errEl.textContent = diag.lastErrorCode || "none";

  const statusEl = document.getElementById("diag-http-status");
  if (statusEl) statusEl.textContent = (diag.lastHttpStatus !== null && diag.lastHttpStatus !== undefined) ? String(diag.lastHttpStatus) : "none";

  const origEl = document.getElementById("diag-origin-host");
  if (origEl) origEl.textContent = diag.responseOriginHost || "none";

  const typeEl = document.getElementById("diag-content-type");
  if (typeEl) typeEl.textContent = diag.responseContentType || "none";
}

if (typeof window !== "undefined") {
  window.updateDiagnosticUI = updateDiagnosticUI;
  window.initDiagnostic = initDiagnostic;
}

// 4. BaseCode ハンドラ (未設定時フォールバック用)
function initBaseCodeHandlers() {
  const codeInput = document.getElementById("base-code-input");
  const nameDisplay = document.getElementById("base-name-display");
  const autoBox = document.getElementById("base-code-autocomplete");
  if (!codeInput || !nameDisplay || !autoBox) return;

  let isComposing = false;

  function handleBaseCodeChange(syncInputValue = true) {
    if (isComposing) return;
    const raw = codeInput.value;
    const normalized = BaseService.normalizeBaseCode(raw);
    if (syncInputValue && codeInput.value !== normalized) {
      const start = codeInput.selectionStart;
      const end = codeInput.selectionEnd;
      codeInput.value = normalized;
      if (typeof start === "number" && typeof end === "number") {
        codeInput.setSelectionRange(start, end);
      }
    }

    const exact = BaseService.findExactBase(normalized);
    if (exact) {
      nameDisplay.value = exact.baseName;
      TerminalStorage.savePreviousInput({ baseCode: exact.baseCode, baseName: exact.baseName });
    } else {
      nameDisplay.value = "";
    }

    const candidates = BaseService.searchBaseCodes(normalized);
    if (candidates.length > 0 && !exact) {
      autoBox.innerHTML = "";
      candidates.forEach(b => {
        const item = document.createElement("div");
        item.className = "autocomplete-item";
        item.innerHTML = `<strong>${b.baseCode}</strong><span>${b.baseName}</span>`;
        item.addEventListener("click", () => {
          codeInput.value = b.baseCode;
          nameDisplay.value = b.baseName;
          autoBox.style.display = "none";
          TerminalStorage.savePreviousInput({ baseCode: b.baseCode, baseName: b.baseName });
        });
        autoBox.appendChild(item);
      });
      autoBox.style.display = "block";
    } else {
      autoBox.style.display = "none";
    }
  }

  codeInput.addEventListener("compositionstart", () => { isComposing = true; });
  codeInput.addEventListener("compositionend", () => { isComposing = false; handleBaseCodeChange(true); });
  codeInput.addEventListener("input", e => {
    if (e.isComposing || isComposing) return;
    handleBaseCodeChange(true);
  });

  document.addEventListener("click", e => {
    if (!codeInput.contains(e.target) && !autoBox.contains(e.target)) {
      autoBox.style.display = "none";
    }
  });
}

// 5. ItemCode 検索ハンドラ
function initItemCodeHandlers() {
  const codeInput = document.getElementById("item-code-input");
  const nameDisplay = document.getElementById("item-name-display");
  const autoBox = document.getElementById("item-code-autocomplete");
  if (!codeInput || !nameDisplay || !autoBox) return;

  let isComposing = false;

  function handleItemCodeChange(syncInputValue = true) {
    if (isComposing) return;
    const raw = codeInput.value;
    const normalized = ItemService.normalizeItemCode(raw);
    if (syncInputValue && codeInput.value !== normalized) {
      const start = codeInput.selectionStart;
      const end = codeInput.selectionEnd;
      codeInput.value = normalized;
      if (typeof start === "number" && typeof end === "number") {
        codeInput.setSelectionRange(start, end);
      }
    }

    const exact = ItemService.findExactItem(normalized);
    if (exact) {
      nameDisplay.value = exact.itemName;
    } else {
      nameDisplay.value = "";
    }

    const candidates = ItemService.searchItemCodes(normalized);
    if (candidates.length > 0 && !exact) {
      autoBox.innerHTML = "";
      candidates.slice(0, 8).forEach(item => {
        const div = document.createElement("div");
        div.className = "autocomplete-item";
        div.innerHTML = `<strong>${item.itemCode}</strong><span style="font-size:0.8rem;">${item.itemName}</span>`;
        div.addEventListener("click", () => {
          codeInput.value = item.itemCode;
          nameDisplay.value = item.itemName;
          autoBox.style.display = "none";
          document.getElementById("item-qty-input").focus();
        });
        autoBox.appendChild(div);
      });
      autoBox.style.display = "block";
    } else {
      autoBox.style.display = "none";
    }
  }

  codeInput.addEventListener("compositionstart", () => {
    isComposing = true;
  });

  codeInput.addEventListener("compositionend", () => {
    isComposing = false;
    handleItemCodeChange(true);
  });

  codeInput.addEventListener("input", e => {
    if (e.isComposing || isComposing) {
      return;
    }
    handleItemCodeChange(true);
  });

  document.addEventListener("click", e => {
    if (!codeInput.contains(e.target) && !autoBox.contains(e.target)) {
      autoBox.style.display = "none";
    }
  });
}

// 6. 資材明細行の追加・削除 & 数量 [+]/[-] コントロール
function addCodeItemFromForm() {
  const codeInput = document.getElementById("item-code-input");
  const nameDisplay = document.getElementById("item-name-display");
  const qtyInput = document.getElementById("item-qty-input");

  const code = codeInput.value.trim();
  const name = nameDisplay.value.trim();
  const rawQty = qtyInput.value.trim();

  if (!code || !name) {
    showAppModal({ title: "入力エラー", message: "有効な資材コードを入力してください。" });
    return;
  }

  if (rawQty === "0") {
    showAppModal({ title: "数量エラー", message: "数量を1以上にしてください。" });
    return;
  }

  const parsedQty = QuantityEngine.parseQuantity(rawQty);
  if (!parsedQty.valid) {
    showAppModal({ title: "数量エラー", message: parsedQty.error });
    return;
  }

  if (parsedQty.type === "NUMBER" && parsedQty.value <= 0) {
    showAppModal({ title: "数量エラー", message: "数量を1以上にしてください。" });
    return;
  }

  const itemMaster = ItemService.findExactItem(code) || { unitWeightKg: null };

  currentCodeItems.push({
    itemCode: code,
    itemName: name,
    quantityInput: parsedQty.input,
    quantityValue: parsedQty.value,
    quantityType: parsedQty.type,
    unitWeightKg: itemMaster.unitWeightKg
  });

  codeInput.value = "";
  nameDisplay.value = "";
  qtyInput.value = "";

  renderCodeItemsTable();
  updateWeightDisplay();
}

function removeCodeItem(index) {
  currentCodeItems.splice(index, 1);
  renderCodeItemsTable();
  updateWeightDisplay();
}

/**
 * 数量入力欄の増減ステップ (+/-) コントロール (V3.5)
 * - 10 -> 11, 10 -> 9
 * - 1 -> 0, 0 -> 0 (下限0)
 * - 10+5 -> 16, 10+5 -> 14 (QuantityEngineで評価後にステップ)
 * - 空 + -> 1, 空 - -> 0
 * - 0 + -> 1, 0 - -> 0
 * - 一式 -> no-op
 */
function stepFormQuantity(delta) {
  const qtyInput = document.getElementById("item-qty-input");
  if (!qtyInput) return;

  const raw = qtyInput.value.trim();
  if (raw === "一式" || raw === "1式") {
    return; // 一式: 値を変更しない
  }

  if (!raw) {
    qtyInput.value = delta > 0 ? "1" : "0";
    return;
  }

  if (raw === "0") {
    qtyInput.value = delta > 0 ? "1" : "0";
    return;
  }

  const parsed = QuantityEngine.parseQuantity(raw);
  if (parsed.valid) {
    if (parsed.type === "SET") {
      return;
    }
    const cur = typeof parsed.value === "number" ? parsed.value : 1;
    const next = Math.max(0, cur + delta);
    qtyInput.value = String(next);
  } else {
    qtyInput.value = delta > 0 ? "1" : "0";
  }
}

function renderCodeItemsTable() {
  const tbody = document.getElementById("code-items-tbody");
  if (!tbody) return;
  tbody.innerHTML = "";

  currentCodeItems.forEach((item, idx) => {
    const uw = parseFloat(item.unitWeightKg);
    const hasWeight = !isNaN(uw) && uw > 0 && item.quantityType === "NUMBER";
    const weightDisplayHtml = hasWeight
      ? `${(item.quantityValue * uw).toFixed(1)}kg`
      : `<span class="badge-unregistered">-</span>`;

    const qtyHtml = item.quantityType === "NUMBER"
      ? `<span>${item.quantityValue}</span>`
      : `<span class="badge-set">一式</span>`;

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td class="col-code"><strong>${item.itemCode}</strong></td>
      <td class="col-name">${item.itemName}</td>
      <td class="col-qty">${qtyHtml}</td>
      <td class="col-weight text-right">${weightDisplayHtml}</td>
      <td class="col-delete text-center">
        <button type="button" class="btn-delete-icon" aria-label="資材を削除" onclick="removeCodeItem(${idx})">
          <svg viewBox="0 0 24 24" fill="none"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
        </button>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

function updateWeightDisplay() {
  const weightSummary = WeightEngine.calculateEstimatedWeight(currentCodeItems);
  const textEl = document.getElementById("weight-display-text");
  const metaEl = document.getElementById("weight-meta-counts");
  if (textEl) textEl.textContent = `推定積載重量: ${weightSummary.formattedKg}`;
  if (metaEl) metaEl.textContent = `重量計算対象: ${weightSummary.registeredCount}品目 / 重量未登録: ${weightSummary.unregisteredCount}品目`;
}

// 7. 定型品セクション (選択定型品フィルタ対応)
function initFixedItemsList() {
  const tbody = document.getElementById("fixed-items-tbody");
  if (!tbody) return;
  tbody.innerHTML = "";

  const allFixed = (window.ACTIVE_FIXED_ITEMS && window.ACTIVE_FIXED_ITEMS.length > 0)
    ? window.ACTIVE_FIXED_ITEMS
    : (window.TEST_FIXTURE_FIXED_ITEMS || []);

  let visibleList;
  if (resolvedEmployeeNo) {
    const pref = TerminalStorage.getEmployeePreferences(resolvedEmployeeNo);
    if (pref.exists && pref.fixedItemIds !== null) {
      const selectedSet = new Set(pref.fixedItemIds);
      visibleList = allFixed.filter(fi => selectedSet.has(fi.fixedItemId));
    } else {
      // 未設定社員: Active Fixed Items全件ON
      visibleList = allFixed;
    }
  } else {
    const userSettings = TerminalStorage.getUserSettings();
    const selectedCodes = userSettings.selectedFixedItemCodes || [];
    visibleList = (selectedCodes.length > 0)
      ? allFixed.filter(fi => selectedCodes.includes(fi.fixedItemId))
      : allFixed;
  }

  visibleList.forEach(fi => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td style="vertical-align:middle;"><strong>${fi.itemName}</strong></td>
      <td style="vertical-align:middle;">
        <div class="qty-input-group fixed-qty-group">
          <button type="button" class="btn-qty-input-step" id="btn-fixed-minus-${fi.fixedItemId}" onclick="stepFixedItemQuantity('${fi.fixedItemId}', -1)" aria-label="${fi.itemName}の数量を1減らす">－</button>
          <input type="text" class="form-input" style="padding:0.4rem 0.4rem; text-align:center;"
            placeholder="1, 一式" id="fixed-qty-${fi.fixedItemId}">
          <button type="button" class="btn-qty-input-step" id="btn-fixed-plus-${fi.fixedItemId}" onclick="stepFixedItemQuantity('${fi.fixedItemId}', 1)" aria-label="${fi.itemName}の数量を1増やす">＋</button>
        </div>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

/**
 * 定型品数量のステップ変更 (+1 / -1) (V3.5)
 * - 資材コード品数量 (stepFormQuantity) と同一セマンティクス
 * - 10 -> 11, 10 -> 9
 * - 1 -> 0, 0 -> 0 (下限0)
 * - 10+5 -> 16, 10+5 -> 14 (QuantityEngineで評価後にステップ)
 * - 空 + -> 1, 空 - -> 0
 * - 0 + -> 1, 0 - -> 0
 * - 一式 -> no-op
 */
function stepFixedItemQuantity(fixedItemId, delta) {
  if (!fixedItemId) return;
  const qtyInput = document.getElementById(`fixed-qty-${fixedItemId}`);
  if (!qtyInput) return;

  const raw = qtyInput.value.trim();
  if (raw === "一式" || raw === "1式" || raw.toLowerCase() === "set") {
    return; // 一式: 値を変更しない
  }

  if (!raw) {
    qtyInput.value = delta > 0 ? "1" : "0";
    return;
  }

  if (raw === "0") {
    qtyInput.value = delta > 0 ? "1" : "0";
    return;
  }

  const parsed = QuantityEngine.parseQuantity(raw);
  if (parsed.valid) {
    if (parsed.type === "SET") {
      return;
    }
    const cur = typeof parsed.value === "number" ? parsed.value : 1;
    const next = Math.max(0, cur + delta);
    qtyInput.value = String(next);
  } else {
    qtyInput.value = delta > 0 ? "1" : "0";
  }
}

function collectFixedItems() {
  const allFixed = (window.ACTIVE_FIXED_ITEMS && window.ACTIVE_FIXED_ITEMS.length > 0)
    ? window.ACTIVE_FIXED_ITEMS
    : (window.TEST_FIXTURE_FIXED_ITEMS || []);
  const result = [];

  allFixed.forEach(fi => {
    const input = document.getElementById(`fixed-qty-${fi.fixedItemId}`);
    if (input && input.value.trim()) {
      const raw = input.value.trim();
      if (raw === "0") return; // 0 は保存対象外 (未選択・数量なし扱い)
      const parsed = QuantityEngine.parseQuantity(raw);
      if (parsed.valid) {
        if (parsed.type === "NUMBER" && parsed.value <= 0) return; // 0 (5-5等) は保存対象外
        result.push({
          fixedItemId: fi.fixedItemId,
          itemName: fi.itemName,
          quantityInput: parsed.input,
          quantityValue: parsed.value,
          quantityType: parsed.type
        });
      }
    }
  });

  return result;
}

// 8. その他自由品目セクション (自由入力 & 全角英数字半角正規化)
function toHalfWidthAlphanumeric(str) {
  if (!str) return "";
  return str.replace(/[Ａ-Ｚａ-ｚ０-９]/g, function(ch) {
    return String.fromCharCode(ch.charCodeAt(0) - 0xFEE0);
  });
}

function setupHalfWidthNormalization(inputEl) {
  if (!inputEl) return;
  let isComposing = false;
  inputEl.addEventListener("compositionstart", () => { isComposing = true; });
  inputEl.addEventListener("compositionend", () => {
    isComposing = false;
    const norm = toHalfWidthAlphanumeric(inputEl.value);
    if (norm !== inputEl.value) {
      inputEl.value = norm;
    }
  });
  inputEl.addEventListener("input", () => {
    if (isComposing) return;
    const norm = toHalfWidthAlphanumeric(inputEl.value);
    if (norm !== inputEl.value) {
      const start = inputEl.selectionStart;
      const end = inputEl.selectionEnd;
      inputEl.value = norm;
      if (start !== null && end !== null) {
        inputEl.setSelectionRange(start, end);
      }
    }
  });
  inputEl.addEventListener("blur", () => {
    inputEl.value = toHalfWidthAlphanumeric(inputEl.value);
  });
}

function addOtherItemFromForm() {
  const nameInput = document.getElementById("other-name-input");
  const qtyInput = document.getElementById("other-qty-input");

  const name = toHalfWidthAlphanumeric(nameInput.value.trim());
  const rawQty = toHalfWidthAlphanumeric(qtyInput.value.trim());

  if (!name) {
    showAppModal({ title: "入力エラー", message: "品名を入力してください。" });
    return;
  }

  // その他品目は QuantityEngine の制約を完全に解除 (FREE_TEXT)
  currentOtherItems.push({
    itemName: name,
    quantityInput: rawQty,
    quantityValue: null,
    quantityType: "FREE_TEXT"
  });

  nameInput.value = "";
  qtyInput.value = "";
  renderOtherItemsTable();
}

function removeOtherItem(index) {
  currentOtherItems.splice(index, 1);
  renderOtherItemsTable();
}

function renderOtherItemsTable() {
  const tbody = document.getElementById("other-items-tbody");
  if (!tbody) return;
  tbody.innerHTML = "";

  currentOtherItems.forEach((it, idx) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td class="col-name"><strong>${it.itemName}</strong></td>
      <td class="col-qty"><strong>${it.quantityInput}</strong></td>
      <td class="col-delete text-center">
        <button type="button" class="btn-delete-icon" aria-label="項目を削除" onclick="removeOtherItem(${idx})">
          <svg viewBox="0 0 24 24" fill="none"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
        </button>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

// 9. 業者署名モーダル管理
function initVendorSignaturePad() {
  const canvas = document.getElementById("vendor-signature-canvas");
  if (canvas) {
    vendorPad = new SignaturePad(canvas);
  }
}

function openSignatureModal() {
  const modal = document.getElementById("signature-modal");
  if (!modal) return;
  modal.style.display = "flex";
  document.body.classList.add("modal-open");

  if (!vendorPad) {
    initVendorSignaturePad();
  } else {
    vendorPad.initCanvas();
  }

  if (confirmedSignatureData) {
    vendorPad.loadFromDataURL(confirmedSignatureData);
  } else {
    vendorPad.clear();
  }
}

function closeSignatureModal() {
  const modal = document.getElementById("signature-modal");
  if (modal) modal.style.display = "none";
  document.body.classList.remove("modal-open");
}

function cancelSignatureModal() {
  closeSignatureModal();
}

function clearSignatureModal() {
  if (vendorPad) vendorPad.clear();
}

function confirmSignatureModal() {
  if (vendorPad && !vendorPad.isEmpty()) {
    confirmedSignatureData = vendorPad.toDataURL();
  } else {
    confirmedSignatureData = null;
  }
  updateSignatureDisplay();
  closeSignatureModal();
}

function confirmClearSignature() {
  showAppModal({
    title: "署名解除の確認",
    message: "署名を解除しますか？",
    okText: "解除",
    cancelText: "キャンセル",
    onOk: () => {
      clearConfirmedSignature();
    }
  });
}

function clearConfirmedSignature() {
  confirmedSignatureData = null;
  if (vendorPad) vendorPad.clear();
  updateSignatureDisplay();
}

function updateSignatureDisplay() {
  const unsignedView = document.getElementById("signature-unsigned-view");
  const signedView = document.getElementById("signature-signed-view");
  const largePreviewImg = document.getElementById("signature-large-preview-img");

  if (confirmedSignatureData) {
    if (unsignedView) unsignedView.style.display = "none";
    if (signedView) signedView.style.display = "block";
    if (largePreviewImg) largePreviewImg.src = confirmedSignatureData;
  } else {
    if (unsignedView) unsignedView.style.display = "block";
    if (signedView) signedView.style.display = "none";
    if (largePreviewImg) largePreviewImg.src = "";
  }
}

// 10. 汎用アプリ内モーダル
function showAppModal({ title = "確認", message = "", okText = "閉じる", cancelText = null, onOk = null, onCancel = null }) {
  const modal = document.getElementById("generic-app-modal");
  const titleEl = document.getElementById("generic-modal-title");
  const bodyEl = document.getElementById("generic-modal-body");
  const okBtn = document.getElementById("generic-modal-ok");
  const cancelBtn = document.getElementById("generic-modal-cancel");

  if (!modal || !titleEl || !bodyEl || !okBtn || !cancelBtn) return;

  titleEl.textContent = title;
  bodyEl.textContent = message;
  okBtn.textContent = okText;

  if (cancelText) {
    cancelBtn.textContent = cancelText;
    cancelBtn.style.display = "inline-flex";
  } else {
    cancelBtn.style.display = "none";
  }

  genericModalCallback = (result) => {
    if (result && typeof onOk === "function") onOk();
    else if (!result && typeof onCancel === "function") onCancel();
  };

  modal.style.display = "flex";
  document.body.classList.add("modal-open");
}

function closeGenericModal(result) {
  const modal = document.getElementById("generic-app-modal");
  if (modal) modal.style.display = "none";

  const histModal = document.getElementById("history-detail-modal");
  const isHistModalOpen = histModal && histModal.style.display !== "none";
  if (!isHistModalOpen) {
    document.body.classList.remove("modal-open");
  }

  if (typeof genericModalCallback === "function") {
    const cb = genericModalCallback;
    genericModalCallback = null;
    cb(result);
  }
}

// 11. 伝票完了処理 (確定 & 完了画面 & フォーム初期化)
function handleFinalizeButton() {
  if (!resolvedEmployeeNo) {
    showAppModal({
      title: "社員番号未設定",
      message: "伝票を完了するには、まず「設定」タブで社員番号を登録してください。"
    });
    return;
  }

  if (!workingBaseCode || !workingBaseName || !workingBaseName.trim()) {
    showAppModal({
      title: "入力Base未選択",
      message: "入力Baseを選択してください。"
    });
    return;
  }

  const baseCodeVal = workingBaseCode;
  const baseNameVal = workingBaseName;
  const staffNameVal = resolvedEmployeeName;
  const vendorNameVal = document.getElementById("vendor-name-input").value.trim();

  const headerData = {
    baseCode: baseCodeVal,
    baseName: baseNameVal,
    staffName: staffNameVal,
    vendorName: vendorNameVal
  };

  const headerVal = Validator.validateSlipHeader(headerData);
  if (!headerVal.valid) {
    showAppModal({ title: "入力内容を確認してください", message: headerVal.errors.join("\n") });
    return;
  }

  // 確定処理開始時に引取業者名変更を社員Preferenceへ非同期保存 (非ブロッキング)
  handleVendorInputChange();

  const fixedItems = collectFixedItems();
  const itemsVal = Validator.validateSlipItems(currentCodeItems, fixedItems, currentOtherItems);
  if (!itemsVal.valid) {
    showAppModal({ title: "入力内容を確認してください", message: itemsVal.errors.join("\n") });
    return;
  }

  const sigVal = SignatureHelper.validateVendorSignature(confirmedSignatureData);
  if (!sigVal.hasSignature) {
    const noSigModal = document.getElementById("no-signature-modal");
    if (noSigModal) {
      noSigModal.style.display = "flex";
      document.body.classList.add("modal-open");
    }
    return;
  }

  executeFinalize(false, sigVal.dataUrl);
}

const handleFinalizeButtonClick = handleFinalizeButton;

function closeNoSignatureModal() {
  const noSigModal = document.getElementById("no-signature-modal");
  if (noSigModal) noSigModal.style.display = "none";
  document.body.classList.remove("modal-open");
}

function setSubmissionBusy(mode, busy) {
  const draftBtn = document.getElementById("btn-save-draft");
  const finalizeBtn = document.getElementById("btn-finalize");
  const modalFinalizeBtn = document.getElementById("btn-modal-finalize");
  const fullClearBtn = document.getElementById("btn-full-clear");

  if (busy) {
    if (draftBtn) {
      draftBtn.disabled = true;
      if (mode === "draft") {
        draftBtn.setAttribute("aria-busy", "true");
        draftBtn.innerHTML = '<span class="btn-spinner" aria-hidden="true"></span>保存中...';
      }
    }
    if (finalizeBtn) {
      finalizeBtn.disabled = true;
      if (mode === "final") {
        finalizeBtn.setAttribute("aria-busy", "true");
        finalizeBtn.innerHTML = '<span class="btn-spinner" aria-hidden="true"></span>完了処理中...';
      }
    }
    if (modalFinalizeBtn) {
      modalFinalizeBtn.disabled = true;
      if (mode === "final") {
        modalFinalizeBtn.setAttribute("aria-busy", "true");
        modalFinalizeBtn.innerHTML = '<span class="btn-spinner" aria-hidden="true"></span>完了処理中...';
      }
    }
    if (fullClearBtn) {
      fullClearBtn.disabled = true;
    }
  } else {
    if (draftBtn) {
      draftBtn.disabled = false;
      draftBtn.removeAttribute("aria-busy");
      draftBtn.textContent = "一時保存";
      draftBtn.innerHTML = "一時保存";
    }
    if (finalizeBtn) {
      finalizeBtn.disabled = false;
      finalizeBtn.removeAttribute("aria-busy");
      finalizeBtn.textContent = "完了";
      finalizeBtn.innerHTML = "完了";
    }
    if (modalFinalizeBtn) {
      modalFinalizeBtn.disabled = false;
      modalFinalizeBtn.removeAttribute("aria-busy");
      modalFinalizeBtn.textContent = "署名なしで完了";
      modalFinalizeBtn.innerHTML = "署名なしで完了";
    }
    if (fullClearBtn) {
      fullClearBtn.disabled = false;
    }
  }
}

function setFinalizeButtonsDisabled(disabled) {
  setSubmissionBusy("final", disabled);
}

function generateSecureScrapId() {
  const ts = Date.now();
  const rand = Math.random().toString(36).substring(2, 8).toUpperCase();
  return `SCRAP-${ts}-${rand}`;
}

function executeFinalize(isWithoutSignature, signatureDataUrl = null) {
  const t0 = (typeof performance !== "undefined" && performance.timeOrigin) ? (performance.timeOrigin + performance.now()) : Date.now();
  closeNoSignatureModal();

  if (!resolvedEmployeeNo) {
    showAppModal({
      title: "社員番号未設定",
      message: "伝票を完了するには、まず「設定」タブで社員番号を登録してください。"
    });
    return;
  }

  if (!workingBaseCode || !workingBaseName || !workingBaseName.trim()) {
    showAppModal({
      title: "入力Base未選択",
      message: "入力Baseを選択してください。"
    });
    return;
  }

  const baseCodeVal = workingBaseCode;
  const baseNameVal = workingBaseName;
  const staffNameVal = resolvedEmployeeName;
  const vendorNameVal = document.getElementById("vendor-name-input").value.trim();

  const fixedItems = collectFixedItems();
  const weightSummary = WeightEngine.calculateEstimatedWeight(currentCodeItems);
  const now = new Date().toISOString();
  // Section 4: FINAL伝票の正式処分日は完了処理を実行したJST日付 (currentResumedDraftDate は引き継がない)
  const finalDate = getJstDateString();

  if (!pendingFinalizeSlip) {
    const secureId = generateSecureScrapId();
    const idempotencyKey = `idemp-${Date.now()}-${Math.random().toString(36).substring(2, 10)}`;
    pendingFinalizeSlip = {
      scrapId: secureId,
      slipId: secureId,
      sourceDraftId: currentResumedDraftId || null,
      createdAt: now,
      date: finalDate,
      status: "FINAL",
      baseCode: baseCodeVal,
      baseName: baseNameVal,
      staffName: staffNameVal,
      employeeNo: resolvedEmployeeNo,
      vendorName: vendorNameVal,
      codeItems: [...currentCodeItems],
      fixedItems: [...fixedItems],
      otherItems: [...currentOtherItems],
      signatureStatus: isWithoutSignature ? "NONE" : "DIGITAL",
      vendorSignatureImage: signatureDataUrl,
      estimatedTotalWeightKg: weightSummary.totalWeightKg,
      idempotencyKey: idempotencyKey
    };
  }

  const slipRecord = pendingFinalizeSlip;
  setSubmissionBusy("final", true);

  const t1 = (typeof performance !== "undefined" && performance.timeOrigin) ? (performance.timeOrigin + performance.now()) : Date.now();
  const tFinalizeStart = performance.now();

  // Central DB へ送信
  gasClient.finalizeSlip(slipRecord).then(res => {
    const t2 = (typeof performance !== "undefined" && performance.timeOrigin) ? (performance.timeOrigin + performance.now()) : Date.now();
    const tFinalizeResponse = performance.now();
    const finalizeRoundtripMs = Math.round(tFinalizeResponse - tFinalizeStart);
    if (res && res.debugTimings) {
      console.log(`[app.js] Finalize roundtrip: ${finalizeRoundtripMs}ms (server total: ${res.debugTimings.totalMs}ms, rev: ${res.debugTimings.revisionMs}ms, seq: ${res.debugTimings.sequenceMs}ms, det: ${res.debugTimings.detailWriteMs}ms)`);
    } else {
      console.log(`[app.js] Finalize roundtrip: ${finalizeRoundtripMs}ms`);
    }

    if (!res || !res.success) {
      setSubmissionBusy("final", false);
      const errMsg = res ? (res.error || res.message) : "Unknown error";
      console.error("[app.js] Finalize failed:", errMsg);
      let failMessage = "バックエンドへの登録が完了していません。\n通信状態を確認の上、再度お試しください。";
      if (res && res.error) {
        failMessage += `\n\nエラーコード: ${res.error}`;
      }
      showAppModal({
        title: "登録に失敗しました",
        message: failMessage
      });
      return;
    }

    pendingFinalizeSlip = null;
    const officialSlipNo = res.slipNo || res.slipId || slipRecord.slipId;
    slipRecord.slipId = officialSlipNo;
    slipRecord.slipNo = officialSlipNo;
    if (res.scrapId) {
      slipRecord.scrapId = res.scrapId;
    }
    lastFinalizedSlipData = slipRecord;
    currentResumedDraftId = null;
    currentResumedDraftDate = null;
    TerminalStorage.clearLocalDraft();

    // 履歴キャッシュは必ず無効化 (Working Base 基準)
    TerminalStorage.invalidateHistoryCache(baseCodeVal);

    // 集計キャッシュは affectsMaterialSummary === true の場合のみ無効化 (Backendレスポンス優先、ローカル判定フォールバック)
    const shouldInvalidateMaterialSummary = (res && typeof res.affectsMaterialSummary === "boolean")
      ? res.affectsMaterialSummary
      : ((res && typeof res.affectsSummary === "boolean")
        ? res.affectsSummary
        : checkIfSlipAffectsSummary(slipRecord));

    if (shouldInvalidateMaterialSummary) {
      TerminalStorage.invalidateSummaryCache(baseCodeVal);
    } else {
      // 資材に影響しないFINAL (定型品のみ、その他のみ、一式のみ):
      // 集計キャッシュを温存し、総伝票数のみローカルキャッシュで高速加算 (Optional Fast Local Count)
      const fromDate = document.getElementById("summary-from-date") ? document.getElementById("summary-from-date").value : "";
      const toDate = document.getElementById("summary-to-date") ? document.getElementById("summary-to-date").value : "";
      const cached = TerminalStorage.getSummaryCache(baseCodeVal, fromDate, toDate);
      if (cached) {
        // Section 10: 冪等性チェック (重複確定/リトライ時は二重加算しない)
        const isDuplicateFinal = res.status === "ALREADY_FINALIZED" || res.duplicatePrevented === true;
        // Section 9: 期間条件チェック (確定伝票の処分日がキャッシュ期間に含まれる場合のみ加算)
        const slipDate = slipRecord.date; // YYYY-MM-DD
        const inRange = (!fromDate || slipDate >= fromDate) && (!toDate || slipDate <= toDate);

        if (!isDuplicateFinal && inRange) {
          const curCount = cached.totalSlipsCount !== undefined ? cached.totalSlipsCount : (cached.data && cached.data.totalSlipsCount ? cached.data.totalSlipsCount : 0);
          TerminalStorage.updateSummaryCountInCache(baseCodeVal, fromDate, toDate, curCount + 1, res.slipCountRevision);
        }
      }
    }

    // 印刷用伝票レコードおよび完了モーダル表示フラグを sessionStorage へ保存
    let t3 = Date.now();
    let t4 = Date.now();
    try {
      sessionStorage.setItem("scrap_last_final_slip", JSON.stringify(slipRecord));
      sessionStorage.setItem("scrap_completion_pending", "true");
      t3 = (typeof performance !== "undefined" && performance.timeOrigin) ? (performance.timeOrigin + performance.now()) : Date.now();
      t4 = (typeof performance !== "undefined" && performance.timeOrigin) ? (performance.timeOrigin + performance.now()) : Date.now();
      sessionStorage.setItem("scrap_finalize_perf", JSON.stringify({ t0, t1, t2, t3, t4 }));
    } catch (e) {
      console.error("[app.js] Failed to save completion state to sessionStorage:", e);
    }

    // 実際のページ再読込を実行 (実ページ更新 + 入力内容クリア)
    window.location.reload();
  }).catch(err => {
    setSubmissionBusy("final", false);
    console.error("[app.js] Finalize network error:", err);
    showAppModal({
      title: "通信エラー",
      message: "通信状態を確認の上、再度お試しください。"
    });
  });
}

function openCompletionModal() {
  const modal = document.getElementById("completion-modal");
  if (modal) {
    modal.style.display = "flex";
    document.body.classList.add("modal-open");
  }
}

function closeCompletionModal() {
  const modal = document.getElementById("completion-modal");
  if (modal) modal.style.display = "none";
  document.body.classList.remove("modal-open");
  try {
    sessionStorage.removeItem("scrap_completion_pending");
    sessionStorage.removeItem("scrap_last_final_slip");
  } catch (e) {}
}

function handleCompletionOverlayClick(event) {
  // 背景タップで閉じない (正式終了操作は「確認」のみ)
}

function closeCompletionModalAndReset() {
  closeCompletionModal();
  resetInputFormAfterSubmission();
}

function resetInputFormAfterSubmission() {
  currentCodeItems = [];
  currentOtherItems = [];
  confirmedSignatureData = null;
  pendingFinalizeSlip = null;

  // 伝票完了後: 資材・数量・署名はクリアするが、引取業者名は現在社員の defaultVendorName へ復元
  const vendorInput = document.getElementById("vendor-name-input");
  if (vendorInput) vendorInput.value = getCurrentEmployeeDefaultVendor();
  if (vendorInput && vendorInput.dataset) {
    vendorInput.dataset.lastAppliedVendor = vendorInput.value;
    vendorInput.dataset.userEdited = "false";
  }

  // 入力中フィールドのクリア
  const itemCodeInput = document.getElementById("item-code-input");
  const itemNameDisplay = document.getElementById("item-name-display");
  const itemQtyInput = document.getElementById("item-qty-input");
  const otherNameInput = document.getElementById("other-name-input");
  const otherQtyInput = document.getElementById("other-qty-input");

  if (itemCodeInput) itemCodeInput.value = "";
  if (itemNameDisplay) itemNameDisplay.value = "";
  if (itemQtyInput) itemQtyInput.value = "";
  if (otherNameInput) otherNameInput.value = "";
  if (otherQtyInput) otherQtyInput.value = "";

  // 定型品クリア
  const allFixed = (window.ACTIVE_FIXED_ITEMS && window.ACTIVE_FIXED_ITEMS.length > 0)
    ? window.ACTIVE_FIXED_ITEMS
    : (window.TEST_FIXTURE_FIXED_ITEMS || []);
  allFixed.forEach(fi => {
    const input = document.getElementById(`fixed-qty-${fi.fixedItemId}`);
    if (input) input.value = "";
  });

  renderCodeItemsTable();
  renderOtherItemsTable();
  updateSignatureDisplay();
  if (vendorPad) vendorPad.clear();
  updateWeightDisplay();

  // 社員設定を再適用 (担当者/Baseの初期設定を維持)
  if (resolvedEmployeeNo) {
    applyEmployeeLockToForm();
  }
}

// 11.5. 入力内容の全削除 (Full Clear)
function confirmFullClear() {
  showAppModal({
    title: "入力内容を全て削除",
    message: "入力中の内容を全て削除しますか？",
    okText: "削除",
    cancelText: "キャンセル",
    onOk: () => executeFullClear()
  });
}

function executeFullClear() {
  resetInputFormAfterSubmission();
  showAppModal({
    title: "削除完了",
    message: "入力内容を全て削除しました。"
  });
}

function handleCompletionPrint() {
  let slipRecord = null;
  try {
    const raw = sessionStorage.getItem("scrap_last_final_slip");
    if (raw) slipRecord = JSON.parse(raw);
  } catch (e) {
    console.error("[app.js] Failed to parse last finalized slip from sessionStorage:", e);
  }
  if (!slipRecord && lastFinalizedSlipData) {
    slipRecord = lastFinalizedSlipData;
  }
  if (slipRecord) {
    printSlipFromRecord(slipRecord);
  }
  // 印刷押下時: completion modal は維持し、sessionStorageの完了状態も削除しない
}

function handleCompletionConfirm() {
  // 1. completion modal を閉じる
  const modal = document.getElementById("completion-modal");
  if (modal) modal.style.display = "none";
  document.body.classList.remove("modal-open");

  // 2. completion state 完全削除
  try {
    sessionStorage.removeItem("scrap_completion_pending");
    sessionStorage.removeItem("scrap_last_final_slip");
  } catch (e) {
    console.error("[app.js] Failed to clear completion state:", e);
  }

  // 3. 履歴キャッシュ無効化確認 (直前伝票を確実に最新取得)
  const activeBase = workingBaseCode || resolvedBaseCode;
  if (activeBase) {
    TerminalStorage.invalidateHistoryCache(activeBase);
  }

  // 4. 入力内容のクリーンアップ
  resetInputFormAfterSubmission();

  // 5. 履歴画面へ遷移し最新一覧を表示
  switchTab("history");
}

// 12. 下書き一時保存 (Central DB DRAFT & ページ再読込リセット)
function getJstDateString() {
  const now = new Date();
  const utcMs = now.getTime() + (now.getTimezoneOffset() * 60 * 1000);
  const jst = new Date(utcMs + (9 * 60 * 60 * 1000));
  const y = jst.getFullYear();
  const m = String(jst.getMonth() + 1).padStart(2, "0");
  const d = String(jst.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function saveTemporaryDraft() {
  if (!resolvedEmployeeNo) {
    showAppModal({
      title: "社員番号未設定",
      message: "伝票を一時保存するには、まず「設定」タブで社員番号を登録してください。"
    });
    return;
  }

  if (!workingBaseCode || !workingBaseName || !workingBaseName.trim()) {
    showAppModal({
      title: "入力Base未選択",
      message: "入力Baseを選択してください。"
    });
    return;
  }

  // Working Base snapshot (所属Base ではなく workingBaseCode/workingBaseName を使用)
  const baseCodeVal = workingBaseCode;
  const baseNameVal = workingBaseName;
  const staffNameVal = resolvedEmployeeName;
  const vendorNameVal = document.getElementById("vendor-name-input") ? document.getElementById("vendor-name-input").value.trim() : "";
  const dateVal = currentResumedDraftDate || getJstDateString();

  const draftData = {
    draftId: currentResumedDraftId || null,
    slipId: currentResumedDraftId || null,
    scrapId: currentResumedDraftId || null,
    date: dateVal,
    baseCode: baseCodeVal,
    baseName: baseNameVal,
    staffName: staffNameVal,
    employeeNo: resolvedEmployeeNo,
    vendorName: vendorNameVal,
    codeItems: [...currentCodeItems],
    fixedItems: collectFixedItems(),
    otherItems: [...currentOtherItems],
    savedAt: new Date().toISOString()
  };

  setSubmissionBusy("draft", true);

  gasClient.saveDraft(draftData).then(res => {
    if (res && res.success) {
      TerminalStorage.clearLocalDraft();
      // 履歴キャッシュを無効化
      TerminalStorage.invalidateHistoryCache(baseCodeVal);
      currentResumedDraftId = null;
      currentResumedDraftDate = null;
      try {
        sessionStorage.setItem("scrap_draft_saved_success", "true");
      } catch (e) {
        console.error("[app.js] Failed to save draft success state to sessionStorage:", e);
      }
      // 成功時: 実際のページ再読込を実行 (実ページ更新 + 入力内容クリア)
      window.location.reload();
    } else {
      // 失敗時: 画面入力を保持し、リロードしない
      setSubmissionBusy("draft", false);
      const errMsg = res ? (res.error || res.message) : "Unknown error";
      console.error("[app.js] Draft save failed:", errMsg);
      let failMessage = "一時保存に失敗しました。\n通信状態を確認の上、再度お試しください。";
      if (res && res.error) {
        failMessage += `\n\nエラーコード: ${res.error}`;
      }
      showAppModal({
        title: "一時保存エラー",
        message: failMessage
      });
    }
  }).catch(err => {
    // 通信エラー時: 端末非常用バックアップを保存するが、画面入力は保持し、リロードしない
    setSubmissionBusy("draft", false);
    TerminalStorage.saveLocalDraft(draftData);
    showAppModal({
      title: "一時保存エラー",
      message: "通信エラーにより一時保存に失敗しました。\n端末にバックアップを保持しましたが、一時保存は完了していません。\n通信状態を確認の上、再度お試しください。"
    });
  });
}

function resumeDraftSlip(slipId, button = null) {
  const lockKey = `resume:${slipId}`;
  if (historyActionLocks.has(lockKey)) return;
  historyActionLocks.add(lockKey);

  if (!button && typeof event !== "undefined" && event && event.target) {
    button = event.target.closest("button");
  }
  if (button) setActionButtonBusy(button, true, "読込中...");

  gasClient.fetchSlip(slipId).then(res => {
    if (res && res.success && res.slip) {
      const s = res.slip;
      currentResumedDraftId = s.slipNo || s.slipId || s.scrapId || slipId;
      currentResumedDraftDate = s.date || null;
      _vendorSaveSeq++; // 下書き再開に伴い待機中の既定業者名非同期保存応答による画面上書きを無効化

      // P10 Fix: 署名状態の完全初期化 (前伝票の確定署名データ残存・リーク防止)
      confirmedSignatureData = null;
      pendingFinalizeSlip = null;
      if (typeof vendorPad !== "undefined" && vendorPad && typeof vendorPad.clear === "function") {
        vendorPad.clear();
      }
      if (typeof updateSignatureDisplay === "function") {
        updateSignatureDisplay();
      }

      // 1. Working Base の復元 (所属Baseは変更せず、Working Base のみ切り替え)
      if (s.baseCode && s.baseName) {
        updateWorkingBaseState(s.baseCode, s.baseName, true);
      }

      // 2. 引取業者名の復元
      const vendorInput = document.getElementById("vendor-name-input");
      if (vendorInput) vendorInput.value = s.vendorName || "";

      // 3. CODE資材の復元
      currentCodeItems = Array.isArray(s.codeItems) ? s.codeItems : [];

      // 4. 定型品の復元
      (s.fixedItems || []).forEach(fi => {
        const input = document.getElementById(`fixed-qty-${fi.fixedItemId}`);
        if (input) input.value = fi.quantityInput || "";
      });

      // 5. その他品目の復元
      currentOtherItems = Array.isArray(s.otherItems) ? s.otherItems : [];

      renderCodeItemsTable();
      renderOtherItemsTable();
      updateWeightDisplay();

      switchTab("create");
      showAppModal({
        title: "下書き再開",
        message: "下書きの入力を再開しました。\n署名は一時保存されないため、確定前に再度入力してください。"
      });
    } else {
      showAppModal({
        title: "再開エラー",
        message: (res && res.error) ? res.error : "一時保存伝票の取得に失敗しました。"
      });
    }
  }).catch(err => {
    console.error("[app.js] resumeDraftSlip error:", err);
    showAppModal({
      title: "通信エラー",
      message: "一時保存データの取得中に通信エラーが発生しました。"
    });
  }).finally(() => {
    if (button) setActionButtonBusy(button, false);
    historyActionLocks.delete(lockKey);
  });
}

// 12.5. 一時保存下書きの削除 (論理削除 & モーダル確認)
function confirmDeleteDraft(draftId, button = null) {
  showAppModal({
    title: "一時保存を削除",
    message: "この一時保存を削除しますか？",
    okText: "削除",
    cancelText: "キャンセル",
    onOk: () => executeDeleteDraft(draftId, button)
  });
}

function executeDeleteDraft(draftId, button = null) {
  if (!draftId) return;
  const lockKey = `deleteDraft:${draftId}`;
  if (historyActionLocks.has(lockKey)) return;
  historyActionLocks.add(lockKey);

  if (!button && typeof event !== "undefined" && event && event.target) {
    button = event.target.closest("button");
  }
  if (button) setActionButtonBusy(button, true, "削除中...");

  const baseCode = workingBaseCode || resolvedBaseCode;

  gasClient.deleteDraft({
    scrapId: draftId,
    draftId: draftId,
    slipId: draftId,
    baseCode: baseCode,
    employeeNo: resolvedEmployeeNo
  }).then(res => {
    if (res && res.success) {
      if (currentResumedDraftId === draftId) {
        currentResumedDraftId = null;
        currentResumedDraftDate = null;
      }
      // 一覧から即時消える
      centralDraftSlips = (centralDraftSlips || []).filter(d => (d.slipId !== draftId && d.scrapId !== draftId));
      renderDraftSection(centralDraftSlips);
      // 履歴キャッシュを無効化
      TerminalStorage.invalidateHistoryCache(baseCode);
      showAppModal({
        title: "削除完了",
        message: "一時保存を削除しました。"
      });
    } else {
      const msg = res ? (res.message || res.error) : "削除に失敗しました。";
      showAppModal({
        title: "削除エラー",
        message: msg
      });
    }
  }).catch(err => {
    console.error("[app.js] deleteDraft error:", err);
    showAppModal({
      title: "通信エラー",
      message: "通信エラーにより削除できませんでした。"
    });
  }).finally(() => {
    if (button) setActionButtonBusy(button, false);
    historyActionLocks.delete(lockKey);
  });
}

// ============================================================
// 日付・日時フォーマットヘルパー (Safari / WebKit 対応 決定論的パーサー)
// ============================================================
const SCRAP_MONTH_MAP = {
  Jan: "01", Feb: "02", Mar: "03", Apr: "04", May: "05", Jun: "06",
  Jul: "07", Aug: "08", Sep: "09", Oct: "10", Nov: "11", Dec: "12"
};

function parseDateDetails(input) {
  if (input === null || input === undefined) return null;

  if (input instanceof Date) {
    if (isNaN(input.getTime())) return null;
    try {
      const formatter = new Intl.DateTimeFormat("ja-JP", {
        timeZone: "Asia/Tokyo",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false
      });
      const parts = formatter.formatToParts(input);
      let year = "", month = "", day = "", hour = "00", minute = "00";
      for (const p of parts) {
        if (p.type === "year") year = p.value;
        if (p.type === "month") month = p.value.padStart(2, "0");
        if (p.type === "day") day = p.value.padStart(2, "0");
        if (p.type === "hour") hour = p.value.padStart(2, "0");
        if (p.type === "minute") minute = p.value.padStart(2, "0");
      }
      return { year, month, day, hour, minute };
    } catch (e) {
      const jst = new Date(input.getTime() + 9 * 60 * 60 * 1000);
      const year = String(jst.getUTCFullYear());
      const month = String(jst.getUTCMonth() + 1).padStart(2, "0");
      const day = String(jst.getUTCDate()).padStart(2, "0");
      const hour = String(jst.getUTCHours()).padStart(2, "0");
      const minute = String(jst.getUTCMinutes()).padStart(2, "0");
      return { year, month, day, hour, minute };
    }
  }

  if (typeof input === "number") {
    return parseDateDetails(new Date(input));
  }

  if (typeof input !== "string") return null;
  const s = input.trim();
  if (!s) return null;

  // 括弧付きタイムゾーン（例: "(日本標準時)", "(JST)"）を除去
  const cleanStr = s.replace(/\s*\([^)]*\)/g, "").trim();

  // Pattern A: YYYY-MM-DD または YYYY/MM/DD
  const mDateOnly = cleanStr.match(/^(\d{4})[-/](\d{2})[-/](\d{2})$/);
  if (mDateOnly) {
    return {
      year: mDateOnly[1],
      month: mDateOnly[2],
      day: mDateOnly[3],
      hour: "00",
      minute: "00"
    };
  }

  // Pattern B: 英語曜日/月名 + YYYY + 時刻 (Date.toString() 形式)
  // 例: "Sun Sep 27 2026 00:00:00 GMT+0900"
  const mEng = cleanStr.match(/(?:[A-Za-z]{3},?\s+)?([A-Za-z]{3})\s+(\d{1,2})\s+(\d{4})(?:\s+(\d{2}):(\d{2})(?::(\d{2}))?)?/);
  if (mEng && SCRAP_MONTH_MAP[mEng[1]]) {
    const month = SCRAP_MONTH_MAP[mEng[1]];
    const day = mEng[2].padStart(2, "0");
    const year = mEng[3];
    const hour = mEng[4] ? mEng[4].padStart(2, "0") : "00";
    const minute = mEng[5] ? mEng[5].padStart(2, "0") : "00";
    return { year, month, day, hour, minute };
  }

  // Pattern C: ISO / UTC タイムスタンプ ("T", "Z", またはタイムゾーンオフセットあり)
  if (/T|Z|[+-]\d{2}:?\d{2}/.test(cleanStr)) {
    const parsed = Date.parse(cleanStr);
    if (!isNaN(parsed)) {
      return parseDateDetails(new Date(parsed));
    }
  }

  // Pattern D: "YYYY-MM-DD HH:mm" または "YYYY/MM/DD HH:mm"
  const mDateTime = cleanStr.match(/^(\d{4})[-/](\d{2})[-/](\d{2})[\sT](\d{2}):(\d{2})/);
  if (mDateTime) {
    return {
      year: mDateTime[1],
      month: mDateTime[2],
      day: mDateTime[3],
      hour: mDateTime[4].padStart(2, "0"),
      minute: mDateTime[5].padStart(2, "0")
    };
  }

  // Pattern E: Date.parse フォールバック
  const generalParsed = Date.parse(cleanStr);
  if (!isNaN(generalParsed)) {
    return parseDateDetails(new Date(generalParsed));
  }

  // Pattern F: 部分一致 YYYY-MM-DD
  const fallbackYmd = cleanStr.match(/(\d{4})[-/](\d{2})[-/](\d{2})/);
  if (fallbackYmd) {
    return {
      year: fallbackYmd[1],
      month: fallbackYmd[2],
      day: fallbackYmd[3],
      hour: "00",
      minute: "00"
    };
  }

  return null;
}

function toCanonicalBusinessDate(input) {
  const parts = parseDateDetails(input);
  return parts ? `${parts.year}-${parts.month}-${parts.day}` : "";
}

function formatJstDate(dateVal) {
  const canonical = toCanonicalBusinessDate(dateVal);
  if (!canonical) return "--";
  return canonical.replace(/-/g, "/");
}

function formatJstDateTime(dateVal) {
  const parts = parseDateDetails(dateVal);
  if (!parts) return "--";
  return `${parts.year}/${parts.month}/${parts.day} ${parts.hour}:${parts.minute}`;
}

function sortDrafts(drafts) {
  if (!Array.isArray(drafts)) return [];
  return [...drafts].sort((a, b) => {
    // 第1キー: 処分日 DESC
    const dateA = (a.date || "").slice(0, 10);
    const dateB = (b.date || "").slice(0, 10);
    if (dateA !== dateB) {
      return dateB.localeCompare(dateA);
    }
    // 第2キー: 保存日時 DESC
    const savedA = a.savedAt || a.updatedAt || a.createdAt || "";
    const savedB = b.savedAt || b.updatedAt || b.createdAt || "";
    return savedB.localeCompare(savedA);
  });
}

function renderDraftSection(drafts) {
  const section = document.getElementById("draft-slips-section");
  const list = document.getElementById("draft-slips-list");
  if (!section || !list) return;

  if (!drafts || drafts.length === 0) {
    section.style.display = "none";
    list.innerHTML = "";
    return;
  }

  section.style.display = "block";
  list.innerHTML = "";
  list.className = "draft-card-list";

  const sorted = sortDrafts(drafts);

  sorted.forEach((d, idx) => {
    const displayNo = sorted.length - idx; // 最新ほど大きい番号 (V3.5)
    const disposalDateStr = formatJstDate(d.date);
    const savedAtStr = formatJstDateTime(d.savedAt || d.updatedAt || d.createdAt);
    const staffNameStr = d.staffName || "未入力";
    const draftId = d.slipId || d.scrapId;

    const card = document.createElement("div");
    card.className = "draft-card-item";
    card.dataset.draftId = draftId; // DOM datasetで保持 (画面には非表示)

    card.innerHTML = `
      <div class="draft-card-header">
        <span class="draft-card-no">${displayNo}</span>
        <span class="draft-card-date">処分日　${disposalDateStr}</span>
      </div>
      <div class="draft-card-body">
        <div class="draft-card-row">
          <span class="draft-card-label">担当者</span>
          <span class="draft-card-value">${staffNameStr}</span>
        </div>
        <div class="draft-card-row">
          <span class="draft-card-label">保存日時</span>
          <span class="draft-card-value">${savedAtStr}</span>
        </div>
      </div>
      <div class="draft-card-actions">
        <button type="button" class="btn btn-secondary btn-sm" onclick="resumeDraftSlip('${draftId}', this)">再開</button>
        <button type="button" class="btn btn-outline-danger btn-sm" onclick="confirmDeleteDraft('${draftId}', this)">削除</button>
      </div>
    `;
    list.appendChild(card);
  });
}

// 13. 中央履歴一覧 (5分TTL キャッシュ & Central DB SSOT)
function renderHistoryTable() {
  const tbody = document.getElementById("history-table-tbody");
  if (!tbody) return;

  const activeBaseCode = workingBaseCode || resolvedBaseCode;
  if (!activeBaseCode) {
    tbody.innerHTML = `<tr><td colspan="8" style="text-align:center; color:var(--color-text-muted); padding:2rem;">
      <p style="font-weight:bold; margin-bottom:0.5rem;">社員設定または入力Baseが未設定です</p>
      <p style="font-size:0.85rem; margin:0;">「設定」タブで社員番号を登録し、入力Baseを選択してください。</p>
    </td></tr>`;
    renderDraftSection([]);
    return;
  }

  const baseCode = activeBaseCode;

  // 1. キャッシュチェック (Fast Path)
  const cached = TerminalStorage.getHistoryCache(baseCode);
  if (cached && cached.finalSlips) {
    centralHistorySlips = cached.finalSlips || [];
    centralDraftSlips = cached.draftSlips || [];
    renderHistoryRows(tbody, centralHistorySlips);
    renderDraftSection(centralDraftSlips);
  } else {
    // 初回キャッシュ未存在時のみ Loading 表示
    tbody.innerHTML = `<tr><td colspan="8" style="text-align:center; color:var(--color-text-muted); padding:1.5rem;">履歴を取得中...</td></tr>`;
  }

  // 2. State Snapshot チェック (30秒スロットル共有 & 判定不省略)
  if (TerminalStorage.isStateSnapshotFresh(baseCode)) {
    const snapshot = TerminalStorage.getStateSnapshot(baseCode);
    const snapshotHistRev = snapshot && snapshot.historyRevision !== undefined ? snapshot.historyRevision : null;
    // キャッシュがあり、かつスナップショットのリビジョンと一致しているなら通信 0 で終了
    if (cached && snapshotHistRev !== null && cached.historyRevision === snapshotHistRev) {
      return;
    }
    // スナップショットでリビジョン不一致が検知された場合は本体取得へ進む (通信 0 で検知!)
    if (snapshotHistRev !== null) {
      fetchAndRenderHistory(tbody, baseCode, snapshotHistRev);
      return;
    }
  }

  // 3. State API 確認 (スナップショット期限切れ時: 軽量リビジョン取得)
  gasClient.fetchState(baseCode).then(stateRes => {
    if (stateRes && stateRes.success) {
      TerminalStorage.saveStateSnapshot(baseCode, stateRes);
    } else {
      TerminalStorage.setLastStateCheckTime(baseCode);
    }
    const serverHistRev = (stateRes && stateRes.success && stateRes.historyRevision !== undefined)
      ? stateRes.historyRevision
      : null;

    // キャッシュがあり、かつリビジョンが一致しているなら本体再取得なし (通信 0)
    if (cached && serverHistRev !== null && cached.historyRevision === serverHistRev) {
      return;
    }

    // リビジョン不一致またはキャッシュなし: 本体取得
    fetchAndRenderHistory(tbody, baseCode, serverHistRev || 1);
  }).catch(err => {
    console.error("[app.js] fetchState error:", err);
    if (!cached) {
      fetchAndRenderHistory(tbody, baseCode, 1);
    }
  });
}

function fetchAndRenderHistory(tbody, baseCode, revision) {
  Promise.all([
    gasClient.fetchHistory({ baseCode: baseCode, status: "FINAL" }),
    gasClient.fetchHistory({ baseCode: baseCode, status: "DRAFT" })
  ]).then(([finalRes, draftRes]) => {
    centralHistorySlips = (finalRes && finalRes.success && Array.isArray(finalRes.slips)) ? finalRes.slips : [];
    centralDraftSlips = (draftRes && draftRes.success && Array.isArray(draftRes.slips)) ? draftRes.slips : [];

    // キャッシュ保存 (リビジョン連動)
    TerminalStorage.saveHistoryCache(baseCode, {
      finalSlips: centralHistorySlips,
      draftSlips: centralDraftSlips
    }, revision);

    renderHistoryRows(tbody, centralHistorySlips);
    renderDraftSection(centralDraftSlips);
  }).catch(err => {
    console.error("[app.js] fetchHistory error:", err);
    // 直前キャッシュのフォールバックチェック
    const fallback = TerminalStorage.getHistoryCache(baseCode);
    if (fallback && fallback.finalSlips) {
      centralHistorySlips = fallback.finalSlips;
      centralDraftSlips = fallback.draftSlips;
      renderHistoryRows(tbody, centralHistorySlips);
      renderDraftSection(centralDraftSlips);
      showAppModal({ title: "お知らせ", message: "最新情報を取得できませんでした。直前のキャッシュを表示しています。" });
    } else {
      tbody.innerHTML = `<tr><td colspan="8" style="text-align:center; color:var(--color-danger); padding:1.5rem;">履歴の取得に失敗しました。</td></tr>`;
    }
  });
}

// ============================================================
// P11 履歴検索・フィルター・ソート・詳細モーダル コアロジック
// ============================================================

// 履歴系アクション用ロック & 共通Busy状態管理 (Section 26, 27)
const historyActionLocks = new Set();

function setActionButtonBusy(button, busy, loadingText = "処理中...") {
  if (!button) return;
  if (busy) {
    if (!button.dataset.originalHtml) {
      button.dataset.originalHtml = button.innerHTML;
    }
    button.disabled = true;
    button.setAttribute("aria-busy", "true");
    button.classList.add("is-loading");
    button.innerHTML = `<span class="btn-spinner" aria-hidden="true" style="margin-right: 4px; vertical-align: middle;"></span>${loadingText}`;
  } else {
    if (button.dataset.originalHtml) {
      button.innerHTML = button.dataset.originalHtml;
      delete button.dataset.originalHtml;
    }
    button.disabled = false;
    button.removeAttribute("aria-busy");
    button.classList.remove("is-loading");
  }
}

function attachPrintBusyRelease(button, lockKey) {
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    if (button) setActionButtonBusy(button, false);
    if (lockKey) historyActionLocks.delete(lockKey);
    if (typeof window !== "undefined") {
      window.removeEventListener("afterprint", release);
    }
  };

  if (typeof window !== "undefined") {
    window.addEventListener("afterprint", release, { once: true });
  }
  // 10秒フォールバック (Section 33)
  setTimeout(release, 10000);
}

// E. 業務日付取得ヘルパー (Section 8: FINAL / DELETED: 1. slip.date, 2. slip.finalizedAt, 3. slip.createdAt の順。必ず canonical YYYY-MM-DD を返す)
function getHistoryBusinessDate(slip) {
  if (!slip) return "";
  if (slip.date) {
    if (typeof slip.date === "string" && slip.date.trim()) {
      const c = toCanonicalBusinessDate(slip.date.trim());
      if (c) return c;
    } else {
      const c = toCanonicalBusinessDate(slip.date);
      if (c) return c;
    }
  }
  if (slip.finalizedAt) {
    if (typeof slip.finalizedAt === "string" && slip.finalizedAt.trim()) {
      const c = toCanonicalBusinessDate(slip.finalizedAt.trim());
      if (c) return c;
    } else {
      const c = toCanonicalBusinessDate(slip.finalizedAt);
      if (c) return c;
    }
  }
  if (slip.createdAt) {
    const c = toCanonicalBusinessDate(slip.createdAt);
    if (c) return c;
  }
  return "";
}

// I. 検索キーワード正規化 (String, trim, Unicode NFKC, lowercase)
function normalizeHistorySearchText(value) {
  return String(value || "").trim().normalize("NFKC").toLowerCase();
}

// F. FINAL履歴の決定論的sort (Section 17, 18)
// sortField: "DATE" または "SLIP_NO", sortOrder: "DESC" または "ASC"
function sortFinalHistorySlips(slips, sortField = "DATE", sortOrder = "DESC") {
  if (!Array.isArray(slips)) return [];
  const isDesc = (sortOrder !== "ASC");

  return slips.slice().sort((a, b) => {
    if (sortField === "SLIP_NO") {
      const slipNoA = String(a.slipNo || a.slipId || "").trim();
      const slipNoB = String(b.slipNo || b.slipId || "").trim();
      if (slipNoA !== slipNoB) {
        const cmp = slipNoA.localeCompare(slipNoB, undefined, { numeric: true });
        return isDesc ? -cmp : cmp;
      }
      const finA = String(a.finalizedAt || a.createdAt || "").trim();
      const finB = String(b.finalizedAt || b.createdAt || "").trim();
      return isDesc ? finB.localeCompare(finA) : finA.localeCompare(finB);
    }

    // デフォルト: DATE (処分日)
    const dateA = getHistoryBusinessDate(a);
    const dateB = getHistoryBusinessDate(b);
    if (dateA !== dateB) {
      return isDesc ? dateB.localeCompare(dateA) : dateA.localeCompare(dateB);
    }
    // Tie-breaker 1: finalizedAt
    const finA = String(a.finalizedAt || a.createdAt || "").trim();
    const finB = String(b.finalizedAt || b.createdAt || "").trim();
    if (finA !== finB) {
      return isDesc ? finB.localeCompare(finA) : finA.localeCompare(finB);
    }
    // Tie-breaker 2: slipNo (決定論的ソート)
    const slipNoA = String(a.slipNo || a.slipId || "").trim();
    const slipNoB = String(b.slipNo || b.slipId || "").trim();
    const cmp = slipNoA.localeCompare(slipNoB, undefined, { numeric: true });
    return isDesc ? -cmp : cmp;
  });
}

// J. 履歴フィルター契約 (FINAL限定、期間From/To、キーワード、署名状態、ソート)
function applyHistoryFilters(slips, searchState = {}) {
  if (!Array.isArray(slips)) return [];
  const fromDate = searchState.fromDate ? searchState.fromDate.trim() : "";
  const toDate = searchState.toDate ? searchState.toDate.trim() : "";
  const keyword = normalizeHistorySearchText(searchState.keyword);
  const sigFilter = searchState.signatureStatus || "ALL";

  const filtered = slips.filter(s => {
    if (s.status !== "FINAL" && s.status !== "DELETED") return false;

    const bDate = getHistoryBusinessDate(s);
    if (fromDate && bDate < fromDate) return false;
    if (toDate && bDate > toDate) return false;

    const isDigital = (s.signatureStatus === "DIGITAL" || s.signStatus === "DIGITAL" || s.signStatus === "DELETED");
    if (sigFilter === "DIGITAL" && !isDigital) return false;
    if (sigFilter === "NONE" && isDigital) return false;

    if (keyword) {
      const slipNo = normalizeHistorySearchText(s.slipNo || s.slipId);
      const staff = normalizeHistorySearchText(s.staffName);
      const empNo = normalizeHistorySearchText(s.employeeNo);
      const vendor = normalizeHistorySearchText(s.vendorName);
      const match = slipNo.includes(keyword) || staff.includes(keyword) || empNo.includes(keyword) || vendor.includes(keyword);
      if (!match) return false;
    }
    return true;
  });

  const sortField = searchState.sortField || (typeof historySearchState !== "undefined" && historySearchState.sortField) || "DATE";
  const sortOrder = searchState.sortOrder || (typeof historySearchState !== "undefined" && historySearchState.sortOrder) || "DESC";
  return sortFinalHistorySlips(filtered, sortField, sortOrder);
}

// 順序ラベル動的更新 (Section 14)
function updateSortOrderLabels() {
  const fieldEl = document.getElementById("history-sort-field");
  const orderEl = document.getElementById("history-sort-order");
  if (!fieldEl || !orderEl) return;
  const isDate = (fieldEl.value === "DATE");
  const descOpt = orderEl.querySelector('option[value="DESC"]');
  const ascOpt = orderEl.querySelector('option[value="ASC"]');
  if (descOpt) {
    descOpt.textContent = isDate ? "降順（新しい順）" : "降順";
  }
  if (ascOpt) {
    ascOpt.textContent = isDate ? "昇順（古い順）" : "昇順";
  }
}

// 並び替え変更ハンドラ (Section 16: Frontendのみで即時再sort & visibleCount=50リセット)
function handleHistorySortChange() {
  const fieldEl = document.getElementById("history-sort-field");
  const orderEl = document.getElementById("history-sort-order");
  if (fieldEl) historySearchState.sortField = fieldEl.value;
  if (orderEl) historySearchState.sortOrder = orderEl.value;
  historySearchState.visibleCount = 50;

  updateSortOrderLabels();

  const tbody = document.getElementById("history-table-tbody");
  if (tbody) {
    renderHistoryRows(tbody, centralHistorySlips);
  }
}

// K. 検索実行ハンドラ (Frontendのみで完結、GAS通信なし)
function handleHistorySearch(e) {
  if (e && e.preventDefault) e.preventDefault();
  const fromEl = document.getElementById("history-search-from");
  const toEl = document.getElementById("history-search-to");
  const kwEl = document.getElementById("history-search-keyword");
  const sigEl = document.getElementById("history-search-signature");
  const fieldEl = document.getElementById("history-sort-field");
  const orderEl = document.getElementById("history-sort-order");

  historySearchState.fromDate = fromEl ? fromEl.value.trim() : "";
  historySearchState.toDate = toEl ? toEl.value.trim() : "";
  historySearchState.keyword = kwEl ? kwEl.value.trim() : "";
  historySearchState.signatureStatus = sigEl ? sigEl.value : "ALL";
  if (fieldEl) historySearchState.sortField = fieldEl.value;
  if (orderEl) historySearchState.sortOrder = orderEl.value;
  historySearchState.visibleCount = 50; // 検索条件変更時は50件にリセット

  updateSortOrderLabels();

  const tbody = document.getElementById("history-table-tbody");
  if (tbody) {
    renderHistoryRows(tbody, centralHistorySlips);
  }
}

// L. 検索クリアハンドラ (Section 20: sortField="DATE", sortOrder="DESC"へリセット)
function handleHistorySearchClear() {
  const fromEl = document.getElementById("history-search-from");
  const toEl = document.getElementById("history-search-to");
  const kwEl = document.getElementById("history-search-keyword");
  const sigEl = document.getElementById("history-search-signature");
  const fieldEl = document.getElementById("history-sort-field");
  const orderEl = document.getElementById("history-sort-order");

  if (fromEl) fromEl.value = "";
  if (toEl) toEl.value = "";
  if (kwEl) kwEl.value = "";
  if (sigEl) sigEl.value = "ALL";
  if (fieldEl) fieldEl.value = "DATE";
  if (orderEl) orderEl.value = "DESC";
  updateSortOrderLabels();

  historySearchState = {
    fromDate: "",
    toDate: "",
    keyword: "",
    signatureStatus: "ALL",
    sortField: "DATE",
    sortOrder: "DESC",
    visibleCount: 50
  };

  const tbody = document.getElementById("history-table-tbody");
  if (tbody) {
    renderHistoryRows(tbody, centralHistorySlips);
  }
}

// N. 表示件数拡張ハンドラ (さらに50件表示)
function handleHistoryLoadMore() {
  historySearchState.visibleCount += 50;
  const tbody = document.getElementById("history-table-tbody");
  if (tbody) {
    renderHistoryRows(tbody, centralHistorySlips);
  }
}

// 履歴テーブル描画 (50件表示制御・件数表示・モバイル旧レイアウト復元・詳細/印刷ボタン対応)
function renderHistoryRows(tbody, slips) {
  if (!tbody) return;
  tbody.innerHTML = "";

  if (slips && Array.isArray(slips)) {
    centralHistorySlips = slips;
  }

  // 1. フィルター & 決定論的ソート適用
  filteredHistorySlips = applyHistoryFilters(centralHistorySlips, historySearchState);

  // 2. 件数表示更新 (該当 X 件 / 全 Y 件: FINAL + DELETED を履歴件数として数える - Section 31)
  const totalFinalSlips = centralHistorySlips.filter(s => s.status === "FINAL" || s.status === "DELETED").length;
  const countTextEl = document.getElementById("history-search-count-text");
  if (countTextEl) {
    countTextEl.textContent = `該当 ${filteredHistorySlips.length}件 / 全 ${totalFinalSlips}件`;
  }

  // 3. 0件表示
  if (filteredHistorySlips.length === 0) {
    const isSearchFiltered = (historySearchState.fromDate || historySearchState.toDate || historySearchState.keyword || historySearchState.signatureStatus !== "ALL");
    if (totalFinalSlips === 0 || !isSearchFiltered) {
      tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; color:var(--color-text-muted); padding:1.5rem;">確定された処分伝票はありません (拠点: ${escapeHtml(resolvedBaseName || workingBaseName)})。</td></tr>`;
    } else {
      tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; color:var(--color-text-muted); padding:1.5rem;">
        検索条件に一致する伝票はありません。<br>
        <button type="button" class="btn btn-secondary btn-sm" style="margin-top:0.6rem; min-height:36px;" onclick="handleHistorySearchClear()">条件をクリア</button>
      </td></tr>`;
    }

    const loadMoreContainer = document.getElementById("history-load-more-container");
    if (loadMoreContainer) loadMoreContainer.style.display = "none";
    return;
  }

  // 4. 50件単位の表示制御
  const visibleSlips = filteredHistorySlips.slice(0, historySearchState.visibleCount);
  const loadMoreContainer = document.getElementById("history-load-more-container");
  if (loadMoreContainer) {
    loadMoreContainer.style.display = filteredHistorySlips.length > historySearchState.visibleCount ? "block" : "none";
  }

  // 5. 行の描画 (7列契約: 伝票番号 17%, 処分日 14%, 担当者 13%, 業者名 16%, 署名区分 16%, 状態 8%, 操作 16%)
  visibleSlips.forEach((s) => {
    const businessDate = (typeof getHistoryBusinessDate === "function") ? getHistoryBusinessDate(s) : (s.date || s.createdAt || "");
    const displayDate = businessDate ? businessDate.replace(/-/g, "/") : (formatJstDate(s.date || s.createdAt) || "-");
    const slipNo = s.slipNo || s.slipId || "";
    const staffName = s.staffName || "-";
    const isDeleted = s.status === "DELETED";
    const sigBadge = (s.signatureStatus === "DIGITAL" || s.signStatus === "DIGITAL")
      ? `<span class="hist-sig-badge badge-digital">電子署名済み</span>`
      : `<span class="hist-sig-badge badge-none">署名なし</span>`;
    const statusBadge = isDeleted
      ? `<span class="brand-badge" style="background:#6b7280; color:#fff; font-size:0.75rem;">削除済み</span>`
      : `<span class="brand-badge" style="background:var(--color-primary); color:var(--color-button-text); font-size:0.75rem;">完了</span>`;
    const printBtn = isDeleted
      ? `<button type="button" class="btn btn-secondary hist-action-btn" disabled style="opacity:0.5; cursor:not-allowed;">印刷</button>`
      : `<button type="button" class="btn btn-secondary hist-action-btn" onclick="printSlipFromHistory('${escapeHtml(slipNo)}', this)">印刷</button>`;
    const mobilePrintBtn = isDeleted
      ? `<button type="button" class="btn btn-secondary btn-sm hist-action-btn" disabled style="opacity:0.5; cursor:not-allowed;">印刷</button>`
      : `<button type="button" class="btn btn-secondary btn-sm hist-action-btn" onclick="printSlipFromHistory('${escapeHtml(slipNo)}', this)">印刷</button>`;

    const tr = document.createElement("tr");
    if (isDeleted) {
      tr.className = "hist-row-deleted";
    }
    tr.innerHTML = `
      <td class="history-col-mobile">
        <div class="history-row-1 history-row-top">
          <span class="hist-date">${escapeHtml(displayDate)}</span>
          <span class="hist-slip-no">${escapeHtml(slipNo)}</span>
        </div>
        <div class="history-row-2">
          <span class="hist-staff">${escapeHtml(staffName)}</span>
          <span class="hist-mobile-status">${statusBadge}</span>
        </div>
        <div class="history-row-3 history-row-bottom">
          <div class="hist-actions">
            ${sigBadge}
            <button type="button" class="btn btn-secondary btn-sm hist-action-btn" onclick="openHistoryDetailModal('${escapeHtml(slipNo)}', this)">詳細</button>
            ${mobilePrintBtn}
          </div>
        </div>
      </td>
      <td class="hist-desktop-col col-slip"><strong>${escapeHtml(slipNo)}</strong></td>
      <td class="hist-desktop-col col-date">${escapeHtml(displayDate)}</td>
      <td class="hist-desktop-col col-staff">${escapeHtml(staffName)}</td>
      <td class="hist-desktop-col col-vendor">${escapeHtml(s.vendorName || "-")}</td>
      <td class="hist-desktop-col col-sig">${sigBadge}</td>
      <td class="hist-desktop-col col-status">${statusBadge}</td>
      <td class="hist-desktop-col col-actions">
        <div class="hist-desktop-actions-wrap">
          <button type="button" class="btn btn-secondary hist-action-btn"
            onclick="openHistoryDetailModal('${escapeHtml(slipNo)}', this)">詳細</button>
          ${printBtn}
        </div>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

// R-T. Read-Only 伝票詳細 Modal (オンデマンド fetchSlip & メモリキャッシュ & Decision C 厳格遵守)
let currentHistoryDetailSlip = null;

function openHistoryDetailModal(slipNo, button = null) {
  if (!slipNo) return;
  const lockKey = `detail:${slipNo}`;
  if (historyActionLocks.has(lockKey)) return;

  const modal = document.getElementById("history-detail-modal");
  const body = document.getElementById("history-detail-modal-body") || document.getElementById("hist-detail-body");
  const loading = document.getElementById("hist-detail-loading");
  if (!modal || !body) return;

  // モーダルを開きスクロールロック
  modal.style.display = "flex";
  document.body.style.overflow = "hidden";

  // キャッシュチェック (Fast path)
  if (historyDetailCache.has(slipNo)) {
    renderHistoryDetailContent(historyDetailCache.get(slipNo));
    return;
  }

  historyActionLocks.add(lockKey);
  if (!button && typeof event !== "undefined" && event && event.target) {
    button = event.target.closest("button");
  }
  if (button) setActionButtonBusy(button, true, "取得中...");

  // オンデマンド取得 (Loading 表示)
  if (loading) loading.style.display = "block";
  body.style.display = "block";
  body.innerHTML = `
    <div style="text-align:center; padding:2.5rem 1rem; color:var(--color-text-muted);">
      <p style="font-weight:700; margin-bottom:0.5rem;">伝票詳細を取得中...</p>
      <div style="font-size:0.85rem;">伝票番号: ${escapeHtml(slipNo)}</div>
    </div>
  `;

  gasClient.fetchSlip(slipNo).then(res => {
    if (loading) loading.style.display = "none";
    if (res && res.success && res.slip) {
      historyDetailCache.set(slipNo, res.slip);
      renderHistoryDetailContent(res.slip);
    } else {
      body.innerHTML = `
        <div style="text-align:center; padding:2rem 1rem; color:var(--color-danger);">
          <p style="font-weight:700; margin-bottom:0.5rem;">伝票詳細を取得できませんでした</p>
          <p style="font-size:0.85rem; color:var(--color-text-muted);">${escapeHtml(res && res.error ? res.error : "通信エラーが発生しました。")}</p>
        </div>
      `;
    }
  }).catch(err => {
    if (loading) loading.style.display = "none";
    console.error("[app.js] fetchSlip error:", err);
    body.innerHTML = `
      <div style="text-align:center; padding:2rem 1rem; color:var(--color-danger);">
        <p style="font-weight:700; margin-bottom:0.5rem;">伝票詳細を取得できませんでした</p>
        <p style="font-size:0.85rem; color:var(--color-text-muted);">ネットワーク状態を確認してください。</p>
      </div>
    `;
  }).finally(() => {
    if (button) setActionButtonBusy(button, false);
    historyActionLocks.delete(lockKey);
  });
}

function renderHistoryDetailContent(slip) {
  const body = document.getElementById("history-detail-modal-body") || document.getElementById("hist-detail-body");
  const loading = document.getElementById("hist-detail-loading");
  if (loading) loading.style.display = "none";
  if (!body || !slip) return;
  body.style.display = "block";

  currentHistoryDetailSlip = slip;

  const slipNo = slip.slipNo || slip.slipId || "";
  const dateStr = formatJstDateTime(slip.date || slip.createdAt);
  const finStr = formatJstDateTime(slip.finalizedAt || slip.createdAt);
  const isDeleted = (slip.status === "DELETED");
  const isFinal = (slip.status === "FINAL");

  // モーダルフッターボタン制御 (Section 25)
  const printBtn = document.getElementById("btn-hist-detail-print");
  const deleteBtn = document.getElementById("btn-hist-detail-delete");
  if (isDeleted) {
    if (printBtn) { printBtn.style.display = "none"; printBtn.disabled = true; }
    if (deleteBtn) { deleteBtn.style.display = "none"; deleteBtn.disabled = true; }
  } else if (isFinal) {
    if (printBtn) { printBtn.style.display = "inline-flex"; printBtn.disabled = false; }
    if (deleteBtn) { deleteBtn.style.display = "inline-flex"; deleteBtn.disabled = false; }
  } else {
    if (printBtn) { printBtn.style.display = "none"; }
    if (deleteBtn) { deleteBtn.style.display = "none"; }
  }

  // 署名表示: Decision C 厳格遵守 & 削除時メッセージ (Section 27, 28)
  let sigText = "";
  if (isDeleted && (slip.signStatus === "DELETED" || slip.signatureStatus === "DELETED")) {
    sigText = `<span class="hist-sig-deleted-msg" style="color:var(--color-danger); font-size:0.875rem; font-weight:600;">伝票を削除したため署名を削除しました</span>`;
  } else if (slip.signatureStatus === "DIGITAL" || slip.signStatus === "DIGITAL") {
    sigText = `<span class="hist-sig-badge badge-digital">電子署名済み</span>`;
  } else {
    sigText = `<span class="hist-sig-badge badge-none">署名なし</span>`;
  }

  // 明細行生成 (CODE品、定型品、その他)
  let itemsHtml = "";
  const codeItems = Array.isArray(slip.codeItems) ? slip.codeItems : [];
  const fixedItems = Array.isArray(slip.fixedItems) ? slip.fixedItems : [];
  const otherItems = Array.isArray(slip.otherItems) ? slip.otherItems : [];

  codeItems.forEach(item => {
    itemsHtml += `
      <tr>
        <td>${escapeHtml(item.itemName || "")}</td>
        <td><code>${escapeHtml(item.itemCode || "")}</code></td>
        <td style="text-align:right; font-weight:600;">${escapeHtml(getPrintQuantityDisplay(item))}</td>
      </tr>
    `;
  });

  fixedItems.forEach(fi => {
    itemsHtml += `
      <tr>
        <td>${escapeHtml(fi.itemName || "")}</td>
        <td style="color:var(--color-text-muted); font-size:0.8rem;">定型品</td>
        <td style="text-align:right; font-weight:600;">${escapeHtml(getPrintQuantityDisplay(fi))}</td>
      </tr>
    `;
  });

  otherItems.forEach(oi => {
    itemsHtml += `
      <tr>
        <td>${escapeHtml(oi.itemName || "")}</td>
        <td style="color:var(--color-text-muted); font-size:0.8rem;">その他</td>
        <td style="text-align:right; font-weight:600;">${escapeHtml(oi.quantityInput || "")}</td>
      </tr>
    `;
  });

  if (!itemsHtml) {
    itemsHtml = `<tr><td colspan="3" style="text-align:center; color:var(--color-text-muted); padding:1rem;">明細品目はありません</td></tr>`;
  }

  body.innerHTML = `
    <div class="history-detail-grid">
      <div class="history-detail-field">
        <span class="history-detail-field-label">伝票番号</span>
        <span class="history-detail-field-val" style="font-family:monospace;">${escapeHtml(slipNo)}</span>
      </div>
      <div class="history-detail-field">
        <span class="history-detail-field-label">処分日時</span>
        <span class="history-detail-field-val">${escapeHtml(dateStr)}</span>
      </div>
      <div class="history-detail-field">
        <span class="history-detail-field-label">拠点名</span>
        <span class="history-detail-field-val">${escapeHtml(slip.baseName || "")}</span>
      </div>
      <div class="history-detail-field">
        <span class="history-detail-field-label">担当者 (社員番号)</span>
        <span class="history-detail-field-val">${escapeHtml(slip.staffName || "")} ${slip.employeeNo ? `(${escapeHtml(slip.employeeNo)})` : ""}</span>
      </div>
      <div class="history-detail-field">
        <span class="history-detail-field-label">受領業者名</span>
        <span class="history-detail-field-val">${escapeHtml(slip.vendorName || "-")}</span>
      </div>
      <div class="history-detail-field">
        <span class="history-detail-field-label">確定日時</span>
        <span class="history-detail-field-val">${escapeHtml(finStr)}</span>
      </div>
      ${isDeleted ? `
      <div class="history-detail-field">
        <span class="history-detail-field-label">状態</span>
        <span class="history-detail-field-val"><span class="brand-badge" style="background:#6b7280; color:#fff; font-size:0.75rem;">削除済み</span></span>
      </div>` : ""}
      ${isDeleted && slip.deletedAt ? `
      <div class="history-detail-field">
        <span class="history-detail-field-label">削除日時</span>
        <span class="history-detail-field-val">${escapeHtml(formatJstDateTime(slip.deletedAt))}</span>
      </div>` : ""}
      ${isDeleted && slip.deletedBy ? `
      <div class="history-detail-field">
        <span class="history-detail-field-label">削除者</span>
        <span class="history-detail-field-val">${escapeHtml(slip.deletedBy)}</span>
      </div>` : ""}
    </div>

    <h4 style="font-size:0.95rem; margin:1rem 0 0.5rem 0; color:var(--color-headline);">処分資材明細</h4>
    <table class="history-detail-table">
      <thead>
        <tr>
          <th>品名</th>
          <th style="width:25%;">区分 / コード</th>
          <th style="width:25%; text-align:right;">数量</th>
        </tr>
      </thead>
      <tbody>
        ${itemsHtml}
      </tbody>
    </table>

    <div class="history-detail-signature-block">
      <span style="font-weight:750; font-size:0.875rem; color:var(--color-headline);">受領署名状態:</span>
      ${sigText}
    </div>
  `;
}

function closeHistoryDetailModal() {
  const modal = document.getElementById("history-detail-modal");
  if (modal) {
    modal.style.display = "none";
  }
  document.body.style.overflow = "";
  document.body.classList.remove("modal-open");
  currentHistoryDetailSlip = null;
}

async function prepareAndPrintSlip(s) {
  if (!s) return;
  if (s.status === "DELETED") {
    showAppModal({
      title: "印刷不可",
      message: "削除された伝票は印刷できません。"
    });
    return false;
  }
  const slipNo = s.slipNo || s.slipId;
  const baseCode = s.baseCode || workingBaseCode || resolvedBaseCode || "";
  if (s.signatureStatus === "DIGITAL" && !s.vendorSignatureImage && !s.signatureData) {
    if (gasClient && typeof gasClient.fetchPrintSignature === "function") {
      try {
        const sigRes = await gasClient.fetchPrintSignature(slipNo, baseCode);
        if (sigRes && sigRes.success && sigRes.signatureData) {
          s.vendorSignatureImage = sigRes.signatureData;
        } else {
          showAppModal({
            title: "署名画像取得エラー",
            message: "電子署名画像の取得に失敗したため、印刷を中止しました。通信状態を確認して再試行してください。"
          });
          return;
        }
      } catch (e) {
        console.warn("[app.js] Failed to fetch print signature:", e);
        showAppModal({
          title: "署名画像取得エラー",
          message: "電子署名画像の取得中にエラーが発生したため、印刷を中止しました。"
        });
        return;
      }
    } else {
      showAppModal({
        title: "署名画像取得エラー",
        message: "電子署名通信クライアントが利用できないため、印刷を中止しました。"
      });
      return;
    }
  }
  printSlipFromRecord(s);
}

function handleHistoryDetailPrint() {
  if (!currentHistoryDetailSlip || currentHistoryDetailSlip.status === "DELETED") return;
  const slipNo = currentHistoryDetailSlip.slipNo || currentHistoryDetailSlip.slipId;
  const lockKey = `print:${slipNo}`;
  if (historyActionLocks.has(lockKey)) return;
  historyActionLocks.add(lockKey);

  const printBtn = document.getElementById("btn-hist-detail-print");
  if (printBtn) setActionButtonBusy(printBtn, true, "印刷準備中...");
  attachPrintBusyRelease(printBtn, lockKey);

  setTimeout(() => {
    prepareAndPrintSlip(currentHistoryDetailSlip);
  }, 60);
}

// 確定伝票論理削除ハンドラ (Section 13, 14, 15, 35)
function handleHistoryDetailDelete() {
  if (!currentHistoryDetailSlip) return;
  const slip = currentHistoryDetailSlip;
  if (slip.status !== "FINAL") {
    showAppModal({
      title: "エラー",
      message: "確定済みの伝票のみ削除できます。"
    });
    return;
  }

  showAppModal({
    title: "確認",
    message: "この伝票を削除しますか？\n\n伝票データは履歴として保持され、一覧では「削除済み」と表示されます。\n電子署名がある場合は署名画像も削除されます。",
    cancelText: "キャンセル",
    okText: "削除する",
    onOk: async () => {
      const slipNo = slip.slipNo || slip.slipId;
      const lockKey = `deleteFinal:${slipNo}`;
      if (typeof historyActionLocks !== "undefined" && historyActionLocks.has(lockKey)) return;
      if (typeof historyActionLocks !== "undefined") historyActionLocks.add(lockKey);

      const deleteBtn = document.getElementById("btn-hist-detail-delete");
      if (deleteBtn && typeof setActionButtonBusy === "function") setActionButtonBusy(deleteBtn, true, "削除中...");

      const baseCode = slip.baseCode || workingBaseCode || resolvedBaseCode || "";
      const employeeNo = resolvedEmployeeNo || slip.employeeNo || "";

      const loading = document.getElementById("hist-detail-loading");
      const body = document.getElementById("history-detail-modal-body") || document.getElementById("hist-detail-body");
      if (loading) loading.style.display = "block";
      if (body) body.style.opacity = "0.5";

      try {
        const res = await gasClient.deleteFinalSlip({ slipNo, baseCode, employeeNo });
        if (loading) loading.style.display = "none";
        if (body) body.style.opacity = "1";

        if (res && res.success) {
          slip.status = "DELETED";
          slip.deletedAt = res.deletedAt || new Date().toISOString();
          slip.deletedBy = res.deletedBy || employeeNo;
          if (res.signatureDeleted || slip.signStatus === "DIGITAL" || slip.signatureStatus === "DIGITAL") {
            slip.signStatus = "DELETED";
            slip.signatureStatus = "DELETED";
            slip.vendorSignatureImage = null;
            slip.signatureData = null;
          }
          historyDetailCache.set(slipNo, slip);

          // centralHistorySlipsの該当レコードを更新
          const foundInCentral = (centralHistorySlips || []).find(s => (s.slipNo === slipNo || s.slipId === slipNo));
          if (foundInCentral) {
            foundInCentral.status = "DELETED";
            foundInCentral.deletedAt = slip.deletedAt;
            foundInCentral.deletedBy = slip.deletedBy;
            if (res.signatureDeleted || foundInCentral.signStatus === "DIGITAL" || foundInCentral.signatureStatus === "DIGITAL") {
              foundInCentral.signStatus = "DELETED";
              foundInCentral.signatureStatus = "DELETED";
              foundInCentral.vendorSignatureImage = null;
              foundInCentral.signatureData = null;
            }
          }

          // 再描画
          renderHistoryDetailContent(slip);
          const tbody = document.getElementById("history-table-tbody");
          if (tbody) {
            renderHistoryRows(tbody, centralHistorySlips);
          }

          // 集計キャッシュの無効化 & 集計再描画
          if (typeof TerminalStorage !== "undefined" && TerminalStorage.invalidateSummaryCache) {
            TerminalStorage.invalidateSummaryCache(baseCode);
          }
          if (document.getElementById("view-summary") && document.getElementById("view-summary").style.display !== "none") {
            renderSummaryView();
          }

          showAppModal({
            title: "完了",
            message: "伝票を削除しました。"
          });
        } else {
          showAppModal({
            title: "削除エラー",
            message: (res && res.message) ? res.message : ((res && res.error) ? res.error : "伝票の削除に失敗しました。")
          });
        }
      } catch (err) {
        if (loading) loading.style.display = "none";
        if (body) body.style.opacity = "1";
        console.error("handleHistoryDetailDelete error:", err);
        showAppModal({
          title: "通信エラー",
          message: (err && err.message) ? err.message : "通信エラーが発生しました。ネットワーク状態を確認してください。"
        });
      } finally {
        if (deleteBtn && typeof setActionButtonBusy === "function") setActionButtonBusy(deleteBtn, false);
        if (typeof historyActionLocks !== "undefined") historyActionLocks.delete(lockKey);
        if (loading) loading.style.display = "none";
        if (body) body.style.opacity = "1";
      }
    }
  });
}

// 印刷処理互換ラッパー (インデックスまたは伝票番号を受け入れ, button対応, Section 32, 33)
function printSlipFromHistory(param, button = null) {
  let s = null;
  if (typeof param === "number") {
    s = (filteredHistorySlips && filteredHistorySlips[param]) || centralHistorySlips[param];
  } else if (typeof param === "string") {
    s = (filteredHistorySlips && filteredHistorySlips.find(x => (x.slipNo === param || x.slipId === param)))
      || centralHistorySlips.find(x => (x.slipNo === param || x.slipId === param));
  }
  if (!s || s.status === "DELETED") return;

  const slipNo = s.slipNo || s.slipId;
  const lockKey = `print:${slipNo}`;
  if (historyActionLocks.has(lockKey)) return;
  historyActionLocks.add(lockKey);

  if (!button && typeof event !== "undefined" && event && event.target) {
    button = event.target.closest("button");
  }
  if (button) setActionButtonBusy(button, true, "印刷準備中...");
  attachPrintBusyRelease(button, lockKey);

  // 詳細キャッシュまたは既存コード品をチェック (最低1 paint は feedback が見えるよう setTimeout)
  if (historyDetailCache.has(slipNo)) {
    setTimeout(() => {
      prepareAndPrintSlip(historyDetailCache.get(slipNo));
    }, 60);
    return;
  }

  if (!s.codeItems || s.codeItems.length === 0) {
    gasClient.fetchSlip(slipNo).then(res => {
      if (res && res.success && res.slip) {
        historyDetailCache.set(slipNo, res.slip);
        prepareAndPrintSlip(res.slip);
      } else {
        if (button) setActionButtonBusy(button, false);
        historyActionLocks.delete(lockKey);
        showAppModal({ title: "印刷エラー", message: "伝票詳細の取得に失敗しました。" });
      }
    }).catch(err => {
      console.error("[app.js] fetchSlip for print error:", err);
      if (button) setActionButtonBusy(button, false);
      historyActionLocks.delete(lockKey);
      showAppModal({ title: "通信エラー", message: "伝票詳細取得中にエラーが発生しました。" });
    });
  } else {
    setTimeout(() => {
      prepareAndPrintSlip(s);
    }, 60);
  }
}

// 13.5. 印刷数量表示正規化ヘルパー & 集計影響判定ヘルパー (V3.7)
function getPrintQuantityDisplay(item) {
  if (!item) return "";
  if (item.quantityType === "SET") {
    return "一式";
  }
  if (
    item.quantityType === "NUMBER" &&
    typeof item.quantityValue === "number"
  ) {
    return String(item.quantityValue);
  }
  return item.quantityInput || "";
}

function checkIfSlipAffectsSummary(slipRecord) {
  if (!slipRecord) return false;
  const codeItems = slipRecord.codeItems || [];
  return codeItems.some(item => {
    const qtyVal = Number(item.quantityValue);
    const qtyType = String(item.quantityType || "NUMBER");
    return qtyType === "NUMBER" && Number.isFinite(qtyVal) && qtyVal > 0;
  });
}

// 14. 印刷帳票レンダリング (2x2「田」レイアウト & 右上伝票番号のみ & 署名なし空白)
function printSlipFromRecord(s) {
  if (!s) return;

  // 右上: 伝票番号のみ
  const slipIdEl = document.getElementById("print-slip-id");
  if (slipIdEl) slipIdEl.textContent = s.slipNo || s.slipId;

  // 2x2「田」情報グリッド
  const printDateEl = document.getElementById("print-info-date");
  const printBaseEl = document.getElementById("print-info-base");
  const printStaffEl = document.getElementById("print-info-staff");
  const printVendorEl = document.getElementById("print-info-vendor");

  if (printDateEl) {
    const rawDate = getHistoryBusinessDate(s) || s.date || s.createdAt || "";
    const canonical = toCanonicalBusinessDate(rawDate);
    printDateEl.textContent = canonical ? canonical.replace(/-/g, "/") : "";
  }
  if (printBaseEl) printBaseEl.textContent = s.baseName || "";
  if (printStaffEl) printStaffEl.textContent = s.staffName || "";
  if (printVendorEl) printVendorEl.textContent = s.vendorName || "";

  // 明細テーブル (重量非表示 & 数量は計算後総数を表示)
  const tbody = document.getElementById("print-items-tbody");
  if (tbody) {
    tbody.innerHTML = "";
    let lineNo = 1;

    (s.codeItems || []).forEach(it => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td class="text-center">${lineNo++}</td>
        <td>資材コード品</td>
        <td>${escapeHtml(it.itemName)} (${escapeHtml(it.itemCode)})</td>
        <td class="text-right">${getPrintQuantityDisplay(it)}</td>
      `;
      tbody.appendChild(tr);
    });

    (s.fixedItems || []).forEach(fi => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td class="text-center">${lineNo++}</td>
        <td>定型品</td>
        <td>${escapeHtml(fi.itemName)}</td>
        <td class="text-right">${getPrintQuantityDisplay(fi)}</td>
      `;
      tbody.appendChild(tr);
    });

    (s.otherItems || []).forEach(oi => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td class="text-center">${lineNo++}</td>
        <td>その他品</td>
        <td>${escapeHtml(oi.itemName)}</td>
        <td class="text-right">${escapeHtml(oi.quantityInput || "")}</td>
      `;
      tbody.appendChild(tr);
    });
  }

  // 署名欄: DIGITAL 署名時は実際の手書き署名画像を #print-vendor-signature-img へ表示
  // NONE 時は完全空欄 (紙手書き署名欄を維持)
  const sigImg = document.getElementById("print-vendor-signature-img");
  const sigArea = document.getElementById("print-signature-area");
  let textEl = document.getElementById("print-vendor-signature-status-text");
  if (textEl) {
    textEl.textContent = "";
    textEl.style.display = "none";
  }

  // 他伝票の署名混入を防止するため、印刷対象伝票オブジェクトに直接紐づく署名データのみを使用
  const sigData = s.vendorSignatureImage || s.signatureData || null;

  let printed = false;
  const triggerPrint = () => {
    if (printed) return;
    printed = true;
    setTimeout(() => {
      window.print();
    }, 50);
  };

  if (s.signatureStatus === "DIGITAL" && sigData) {
    if (sigImg) {
      sigImg.onload = () => {
        triggerPrint();
      };
      sigImg.onerror = () => {
        console.error("Failed to load signature image in print DOM");
        triggerPrint();
      };
      sigImg.src = sigData;
      sigImg.style.display = "block";
      if (sigImg.complete) {
        triggerPrint();
      } else {
        setTimeout(triggerPrint, 80);
      }
    } else {
      triggerPrint();
    }
  } else {
    if (sigImg) {
      sigImg.src = "";
      sigImg.style.display = "none";
    }
    triggerPrint();
  }
}

// 15. CSV エクスポート (P11 SUPERSEDED: 検索結果伝票一覧 Header CSV 契約)
function generateHistoryHeaderCsv(slips) {
  let csv = "\uFEFF";
  csv += "伝票番号,処分日,Base名,社員番号,担当者,業者名,署名区分,状態,確定日時\r\n";
  (slips || []).forEach(s => {
    const row = [
      sanitizeCsvCell(s.slipNo || s.slipId || ""),
      sanitizeCsvCell(getHistoryBusinessDate(s)),
      sanitizeCsvCell(s.baseName || ""),
      sanitizeCsvCell(s.employeeNo || ""),
      sanitizeCsvCell(s.staffName || ""),
      sanitizeCsvCell(s.vendorName || ""),
      sanitizeCsvCell(s.signatureStatus === "DIGITAL" ? "DIGITAL" : "NONE"),
      sanitizeCsvCell(s.status || ""),
      sanitizeCsvCell(s.finalizedAt || "")
    ];
    csv += row.join(",") + "\r\n";
  });
  return csv;
}

function exportHistoryCsv() {
  const activeBaseCode = workingBaseCode || resolvedBaseCode;
  if (!activeBaseCode) {
    showAppModal({ title: "拠点未設定", message: "入力Baseが設定されていないため、履歴CSVを出力できません。" });
    return;
  }

  // visibleCountの50件制限はCSVへ適用せず、filteredHistorySlips全件を対象
  const slips = (filteredHistorySlips && filteredHistorySlips.length > 0)
    ? filteredHistorySlips
    : applyHistoryFilters(centralHistorySlips, historySearchState);

  if (!slips || slips.length === 0) {
    showAppModal({ title: "お知らせ", message: "出力対象の伝票がありません。" });
    return;
  }

  const csvContent = generateHistoryHeaderCsv(slips);
  const todayStr = new Date().toISOString().slice(0, 10);
  const filename = `Takamiya_ScrapHistory_${activeBaseCode}_${todayStr}.csv`;
  downloadCsvFile(csvContent, filename);
}

// 16. 集計画面 (Central DB Source of Truth & 期間フィルター)
let scrapSortState = {
  column: "qty",
  order: "desc"
};

function initSummaryDates() {
  const fromInput = document.getElementById("summary-from-date");
  const toInput = document.getElementById("summary-to-date");
  if (!fromInput || !toInput) return;

  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");

  fromInput.value = `${yyyy}-${mm}-01`;
  toInput.value = `${yyyy}-${mm}-${dd}`;
}

function applySummaryPeriodFilter() {
  const fromDate = document.getElementById("summary-from-date").value;
  const toDate = document.getElementById("summary-to-date").value;

  if (fromDate && toDate && fromDate > toDate) {
    showAppModal({ title: "期間エラー", message: "開始日は終了日以前を指定してください。" });
    return;
  }

  renderSummaryView();
}

function renderSummaryView() {
  const tbody = document.getElementById("summary-items-tbody");

  if (!resolvedBaseCode) {
    updateSummaryUi({
      totalSlipsCount: 0,
      totalWeightKg: 0,
      totalItemsCount: 0,
      items: []
    });
    if (tbody) {
      tbody.innerHTML = `<tr><td colspan="4" style="text-align:center; color:var(--color-text-muted); padding:2rem;">
        <p style="font-weight:bold; margin-bottom:0.5rem;">社員設定が登録されていません</p>
        <p style="font-size:0.85rem; margin:0;">「設定」タブで社員番号を登録すると、所属拠点の集計が表示されます。</p>
      </td></tr>`;
    }
    return;
  }

  const baseCode = resolvedBaseCode;
  const fromDate = document.getElementById("summary-from-date") ? document.getElementById("summary-from-date").value : "";
  const toDate = document.getElementById("summary-to-date") ? document.getElementById("summary-to-date").value : "";

  // 1. キャッシュチェック (Fast Path: 即時描画)
  const cached = TerminalStorage.getSummaryCache(baseCode, fromDate, toDate);
  const cachedData = cached ? (cached.data || cached) : null;
  // 古い空items不具合キャッシュ検知 (伝票ありだがitems空配列の場合はキャッシュヒットとみなさず再取得)
  const isStaleEmptyItems = cachedData && cachedData.totalSlipsCount > 0 && (!cachedData.items || cachedData.items.length === 0);
  if (cachedData && !isStaleEmptyItems) {
    currentSummaryData = cachedData;
    updateSummaryUi(cachedData);
  } else {
    // 初回キャッシュなし時または古い空itemsキャッシュ時は Loading 表示
    if (tbody) {
      tbody.innerHTML = `<tr><td colspan="4" style="text-align:center; color:var(--color-text-muted); padding:1.5rem;">集計データを取得中...</td></tr>`;
    }
  }

  function handleStateComparison(state) {
    if (!state) return;

    // slipCountRevision missing の場合は推測 fallback せず state API refresh
    if (state.slipCountRevision === undefined || state.slipCountRevision === null) {
      gasClient.fetchState(baseCode).then(stateRes => {
        if (stateRes && stateRes.success) {
          TerminalStorage.saveStateSnapshot(baseCode, stateRes);
          handleStateComparison(stateRes);
        } else if (!cachedData || isStaleEmptyItems) {
          fetchAndRenderSummary(tbody, baseCode, fromDate, toDate, { slipCountRevision: 1, materialSummaryRevision: 1 });
        }
      }).catch(err => {
        console.error("[app.js] fetchState error:", err);
        if (!cachedData || isStaleEmptyItems) {
          fetchAndRenderSummary(tbody, baseCode, fromDate, toDate, { slipCountRevision: 1, materialSummaryRevision: 1 });
        }
      });
      return;
    }

    const targetSlipRev = state.slipCountRevision;
    const targetMatRev = (state.materialSummaryRevision !== undefined && state.materialSummaryRevision !== null)
      ? state.materialSummaryRevision
      : ((state.summaryRevision !== undefined && state.summaryRevision !== null) ? state.summaryRevision : null);

    if (targetMatRev === null) {
      gasClient.fetchState(baseCode).then(stateRes => {
        if (stateRes && stateRes.success) {
          TerminalStorage.saveStateSnapshot(baseCode, stateRes);
          handleStateComparison(stateRes);
        } else if (!cachedData || isStaleEmptyItems) {
          fetchAndRenderSummary(tbody, baseCode, fromDate, toDate, { slipCountRevision: targetSlipRev, materialSummaryRevision: 1 });
        }
      }).catch(err => {
        console.error("[app.js] fetchState error:", err);
        if (!cachedData || isStaleEmptyItems) {
          fetchAndRenderSummary(tbody, baseCode, fromDate, toDate, { slipCountRevision: targetSlipRev, materialSummaryRevision: 1 });
        }
      });
      return;
    }

    if (!cached || isStaleEmptyItems) {
      fetchAndRenderSummary(tbody, baseCode, fromDate, toDate, { slipCountRevision: targetSlipRev, materialSummaryRevision: targetMatRev });
      return;
    }

    const cachedSlipRev = cached.slipCountRevision !== undefined ? cached.slipCountRevision : 1;
    const cachedMatRev = cached.materialSummaryRevision !== undefined ? cached.materialSummaryRevision : (cached.summaryRevision || 1);

    const slipCountChanged = cachedSlipRev !== targetSlipRev;
    const matChanged = cachedMatRev !== targetMatRev;

    // CASE D: どちらも不変 -> 通信 0 (キャッシュ即描画で終了)
    if (!slipCountChanged && !matChanged) {
      return;
    }

    // CASE A: slipCountRevision のみ変化 -> summary-count だけ fetch (資材取得 0, Loading なし)
    if (slipCountChanged && !matChanged) {
      fetchAndRenderSummaryCount(baseCode, fromDate, toDate, targetSlipRev);
      return;
    }

    // CASE B / C: materialSummaryRevision 変化 -> fetchSummary で資材含め最新化
    fetchAndRenderSummary(tbody, baseCode, fromDate, toDate, { slipCountRevision: targetSlipRev, materialSummaryRevision: targetMatRev });
  }

  // 2. State Snapshot チェック (30秒スロットル共有 & 判定不省略)
  if (TerminalStorage.isStateSnapshotFresh(baseCode)) {
    const snapshot = TerminalStorage.getStateSnapshot(baseCode);
    const hasSlipCount = snapshot && snapshot.slipCountRevision !== undefined && snapshot.slipCountRevision !== null;
    const hasMatRev = snapshot && (
      (snapshot.materialSummaryRevision !== undefined && snapshot.materialSummaryRevision !== null) ||
      (snapshot.summaryRevision !== undefined && snapshot.summaryRevision !== null)
    );

    if (snapshot && hasSlipCount && hasMatRev) {
      handleStateComparison(snapshot);
      return;
    }
    // 旧形式スナップショット (slipCountRevision missing等) の場合:
    // Split Revision比較には使用せず、推測fallbackを行わずに軽量state APIを取得して新形式Snapshotへ置換する
  }

  // 3. State API 確認 (スナップショット期限切れ時: 軽量リビジョン取得)
  gasClient.fetchState(baseCode).then(stateRes => {
    if (stateRes && stateRes.success) {
      TerminalStorage.saveStateSnapshot(baseCode, stateRes);
      handleStateComparison(stateRes);
    } else {
      TerminalStorage.setLastStateCheckTime(baseCode);
      if (!cachedData) {
        fetchAndRenderSummary(tbody, baseCode, fromDate, toDate, { slipCountRevision: 1, materialSummaryRevision: 1 });
      }
    }
  }).catch(err => {
    console.error("[app.js] fetchState error:", err);
    if (!cachedData) {
      fetchAndRenderSummary(tbody, baseCode, fromDate, toDate, { slipCountRevision: 1, materialSummaryRevision: 1 });
    }
  });
}

function fetchAndRenderSummaryCount(baseCode, fromDate, toDate, slipCountRevision) {
  gasClient.fetchSummaryCount({ baseCode, fromDate, toDate }).then(res => {
    if (res && res.success) {
      const count = res.totalSlipsCount;
      const totalSlipsEl = document.getElementById("summary-total-slips");
      if (totalSlipsEl) totalSlipsEl.textContent = count;
      TerminalStorage.updateSummaryCountInCache(baseCode, fromDate, toDate, count, slipCountRevision);
    }
  }).catch(err => {
    console.error("[app.js] fetchSummaryCount error:", err);
  });
}

function fetchAndRenderSummary(tbody, baseCode, fromDate, toDate, revision) {
  gasClient.fetchSummary({ baseCode, fromDate, toDate }).then(res => {
    if (res && res.success) {
      currentSummaryData = res;
      TerminalStorage.saveSummaryCache(baseCode, fromDate, toDate, currentSummaryData, revision);
      updateSummaryUi(currentSummaryData);
    } else {
      const fallback = TerminalStorage.getSummaryCache(baseCode, fromDate, toDate);
      const fallbackData = fallback ? (fallback.data || fallback) : null;
      if (fallbackData) {
        currentSummaryData = fallbackData;
        updateSummaryUi(fallbackData);
        showAppModal({ title: "お知らせ", message: "最新情報を取得できませんでした。直前のキャッシュを表示しています。" });
      } else {
        currentSummaryData = { totalSlipsCount: 0, totalWeightKg: 0, totalItemsCount: 0, items: [] };
        updateSummaryUi(currentSummaryData);
        if (tbody) {
          tbody.innerHTML = `<tr><td colspan="4" style="text-align:center; color:var(--color-danger); padding:1.5rem;">集計データを取得できませんでした</td></tr>`;
        }
      }
    }
  }).catch(err => {
    console.error("[app.js] fetchSummary error:", err);
    const fallback = TerminalStorage.getSummaryCache(baseCode, fromDate, toDate);
    const fallbackData = fallback ? (fallback.data || fallback) : null;
    if (fallbackData) {
      currentSummaryData = fallbackData;
      updateSummaryUi(fallbackData);
      showAppModal({ title: "お知らせ", message: "最新情報を取得できませんでした。直前のキャッシュを表示しています。" });
    } else {
      currentSummaryData = { totalSlipsCount: 0, totalWeightKg: 0, totalItemsCount: 0, items: [] };
      updateSummaryUi(currentSummaryData);
      if (tbody) {
        tbody.innerHTML = `<tr><td colspan="4" style="text-align:center; color:var(--color-danger); padding:1.5rem;">サーバーとの通信に失敗しました</td></tr>`;
      }
    }
  });
}

function updateSummaryUi(data) {
  const totalSlipsEl = document.getElementById("summary-total-slips");
  const totalWeightEl = document.getElementById("summary-total-weight");
  const totalItemsEl = document.getElementById("summary-total-items");

  if (totalSlipsEl) totalSlipsEl.textContent = data.totalSlipsCount || 0;
  if (totalWeightEl) {
    const wtKg = data.totalWeightKg || 0;
    const tVal = (wtKg / 1000).toFixed(2);
    const kgVal = Math.round(wtKg).toLocaleString();
    totalWeightEl.textContent = `${tVal} t (${kgVal} kg)`;
  }
  if (totalItemsEl) totalItemsEl.textContent = data.totalItemsCount || 0;

  // ソートインジケーター更新
  ["code", "name", "qty", "weight"].forEach(col => {
    const el = document.getElementById(`sort-icon-${col}`);
    if (el) {
      if (scrapSortState.column === col) {
        el.textContent = scrapSortState.order === "asc" ? "▲" : "▼";
      } else {
        el.textContent = "";
      }
    }
  });

  // テーブルレンダリング
  const tbody = document.getElementById("summary-items-tbody");
  if (!tbody) return;
  tbody.innerHTML = "";

  const items = data.items || [];
  const sortedItems = sortScrapItems(items, scrapSortState.column, scrapSortState.order);

  if (sortedItems.length === 0) {
    tbody.innerHTML = `<tr><td colspan="4" style="text-align:center; color:var(--color-text-muted); padding:1rem;">指定期間に集計対象データはありません</td></tr>`;
    return;
  }

  sortedItems.forEach(item => {
    const tr = document.createElement("tr");
    const weightStr = item.hasWeight
      ? (item.totalWeightKg >= 1000 ? `${(item.totalWeightKg / 1000).toFixed(2)} t` : `${item.totalWeightKg.toFixed(1)} kg`)
      : "-";
    tr.innerHTML = `
      <td><strong>${item.itemCode}</strong></td>
      <td>${item.itemName}</td>
      <td style="text-align:right;">${item.totalQty.toLocaleString()}</td>
      <td style="text-align:right;">${weightStr}</td>
    `;
    tbody.appendChild(tr);
  });
}

function toggleScrapSort(col) {
  if (scrapSortState.column === col) {
    scrapSortState.order = scrapSortState.order === "asc" ? "desc" : "asc";
  } else {
    scrapSortState.column = col;
    scrapSortState.order = (col === "qty" || col === "weight") ? "desc" : "asc";
  }
  if (currentSummaryData) {
    updateSummaryUi(currentSummaryData);
  }
}

function sortScrapItems(items, column, order) {
  const list = items.map((it, idx) => Object.assign({}, it, { _idx: idx }));

  list.sort((a, b) => {
    let cmp = 0;
    if (column === "code") {
      cmp = (a.itemCode || "").localeCompare(b.itemCode || "", "ja", { numeric: true });
    } else if (column === "name") {
      cmp = (a.itemName || "").localeCompare(b.itemName || "", "ja");
    } else if (column === "qty") {
      cmp = a.totalQty - b.totalQty;
    } else if (column === "weight") {
      const aHas = a.hasWeight && typeof a.totalWeightKg === "number";
      const bHas = b.hasWeight && typeof b.totalWeightKg === "number";
      if (!aHas && !bHas) {
        cmp = 0;
      } else if (!aHas) {
        return 1;
      } else if (!bHas) {
        return -1;
      } else {
        cmp = a.totalWeightKg - b.totalWeightKg;
      }
    }

    if (cmp !== 0) {
      return order === "asc" ? cmp : -cmp;
    }
    return a._idx - b._idx;
  });

  return list;
}

function sanitizeCsvCell(val) {
  if (val === null || val === undefined) return '""';
  let str = String(val).trim();
  if (/^[=\+\-@]/.test(str)) {
    str = "'" + str;
  }
  return '"' + str.replace(/"/g, '""') + '"';
}

function generateScrapCsvContent(sortedItems) {
  let csv = "\uFEFF";
  csv += ["資材コード", "資材名", "数量", "重量"].map(sanitizeCsvCell).join(",") + "\r\n";

  sortedItems.forEach(item => {
    const weightDisplay = item.hasWeight ? `${item.totalWeightKg.toFixed(1)}kg` : "-";
    const row = [
      sanitizeCsvCell(item.itemCode),
      sanitizeCsvCell(item.itemName),
      sanitizeCsvCell(item.totalQty),
      sanitizeCsvCell(weightDisplay)
    ];
    csv += row.join(",") + "\r\n";
  });

  return csv;
}

function exportScrapListCsv() {
  if (!currentSummaryData || !Array.isArray(currentSummaryData.items) || currentSummaryData.items.length === 0) {
    showAppModal({ title: "お知らせ", message: "出力可能な資材一覧データがありません。" });
    return;
  }

  const sortedItems = sortScrapItems(currentSummaryData.items, scrapSortState.column, scrapSortState.order);
  const csvContent = generateScrapCsvContent(sortedItems);

  const fromDate = (document.getElementById("summary-from-date") ? document.getElementById("summary-from-date").value : "").replace(/-/g, "");
  const toDate = (document.getElementById("summary-to-date") ? document.getElementById("summary-to-date").value : "").replace(/-/g, "");
  const filename = `ScrapManagement_資材一覧_${resolvedBaseCode}_${fromDate}-${toDate}.csv`;

  downloadCsvFile(csvContent, filename);
}

function downloadCsvFile(content, filename) {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// 17. 設定タブ管理 (資材カテゴリ & 定型品設定)
function renderSettingsView() {
  const catContainer = document.getElementById("setting-categories-container");
  const fixedContainer = document.getElementById("setting-fixed-items-container");
  const userSettings = TerminalStorage.getUserSettings();

  // カテゴリチェックボックス (V3.10: 全66カテゴリ、DisplayOrder ASC、最後がグループ無し)
  if (catContainer) {
    catContainer.innerHTML = "";
    const baseCats = (typeof TerminalStorage !== "undefined" && TerminalStorage.DEFAULT_66_CATEGORIES)
      ? TerminalStorage.DEFAULT_66_CATEGORIES.slice()
      : [
          { categoryCode: "IQ", categoryName: "Ｉｑシステム", displayOrder: 340 },
          { categoryCode: "AN", categoryName: "セイフティウォーク", displayOrder: 90 },
          { categoryCode: "CA", categoryName: "クランプ", displayOrder: 210 },
          { categoryCode: "__UNGROUPED__", categoryName: "グループ無し", displayOrder: 660 }
        ];

    // ソート: DisplayOrder ASC (最後がグループ無し)
    baseCats.sort((a, b) => (a.displayOrder || 999) - (b.displayOrder || 999));

    // 選択状態の判定
    let isCodeSelected;
    if (resolvedEmployeeNo) {
      const pref = TerminalStorage.getEmployeePreferences(resolvedEmployeeNo);
      if (pref.exists) {
        // Preference が存在する場合: [] なら全未チェック
        const selSet = new Set(pref.categories || []);
        isCodeSelected = (code) => selSet.has(code);
      } else {
        // Preference レコード不存在: DEFAULT 29
        const selSet = new Set(TerminalStorage.DEFAULT_29_CATEGORIES || []);
        isCodeSelected = (code) => selSet.has(code);
      }
    } else {
      const selCats = Array.isArray(userSettings.selectedMaterialCategories) && userSettings.selectedMaterialCategories.length > 0
        ? userSettings.selectedMaterialCategories
        : (TerminalStorage.DEFAULT_29_CATEGORIES || []);
      const selSet = new Set(selCats);
      isCodeSelected = (code) => selSet.has(code);
    }

    baseCats.forEach(c => {
      const isChecked = isCodeSelected(c.categoryCode);
      const label = document.createElement("label");
      label.className = "checkbox-label";
      const displayLabel = c.categoryCode === "__UNGROUPED__"
        ? `${c.categoryName}`
        : `${c.categoryName} (${c.categoryCode})`;

      label.innerHTML = `
        <input type="checkbox" name="material-cat" value="${c.categoryCode}" ${isChecked ? "checked" : ""}>
        <span>${displayLabel}</span>
      `;
      catContainer.appendChild(label);
    });
  }

  // 定型品チェックボックス
  if (fixedContainer) {
    fixedContainer.innerHTML = "";
    const allFixed = (window.ACTIVE_FIXED_ITEMS && window.ACTIVE_FIXED_ITEMS.length > 0)
      ? window.ACTIVE_FIXED_ITEMS
      : (window.TEST_FIXTURE_FIXED_ITEMS || []);

    let isFixedSelected;
    if (resolvedEmployeeNo) {
      const pref = TerminalStorage.getEmployeePreferences(resolvedEmployeeNo);
      if (pref.exists && pref.fixedItemIds !== null) {
        const selSet = new Set(pref.fixedItemIds);
        isFixedSelected = (id) => selSet.has(id);
      } else {
        // 未設定 (null) -> 全定型品ON
        isFixedSelected = () => true;
      }
    } else {
      const selectedFixed = userSettings.selectedFixedItemCodes || [];
      isFixedSelected = (id) => selectedFixed.length === 0 || selectedFixed.includes(id);
    }

    allFixed.forEach(fi => {
      const isChecked = isFixedSelected(fi.fixedItemId);
      const label = document.createElement("label");
      label.className = "checkbox-label";
      label.innerHTML = `
        <input type="checkbox" name="fixed-item-pref" value="${fi.fixedItemId}" ${isChecked ? "checked" : ""}>
        <span>${fi.itemName}</span>
      `;
      fixedContainer.appendChild(label);
    });
  }
}

function saveCategoryPreferences() {
  const saveBtn = (typeof document !== "undefined") ? (document.querySelector('button[onclick="saveCategoryPreferences()"]') || document.getElementById("btn-save-categories")) : null;
  const origBtnText = saveBtn ? saveBtn.textContent : "";
  if (saveBtn) {
    saveBtn.textContent = "保存中…";
    saveBtn.disabled = true;
  }

  const checked = (typeof document !== "undefined") ? Array.from(document.querySelectorAll('input[name="material-cat"]:checked')).map(el => el.value) : [];
  const cachedMasters = TerminalStorage.getMasterCache();
  const allItems = window.ACTIVE_ALL_ITEMS || (cachedMasters && (cachedMasters.allItems || cachedMasters.items)) || [];

  if (resolvedEmployeeNo) {
    const targetEmpNo = resolvedEmployeeNo;
    const currentPref = TerminalStorage.getEmployeePreferences(targetEmpNo);
    const expectedRev = currentPref.exists ? currentPref.revision : 0;

    return gasClient.saveEmployeePreferences(targetEmpNo, { selectedMaterialCategories: checked }, expectedRev).then(res => {
      if (saveBtn) {
        saveBtn.textContent = origBtnText;
        saveBtn.disabled = false;
      }
      if (res && res.success) {
        // 中央保存成功時のみローカルキャッシュ確定 & UI確定 (定型品・既定業者名設定を自動マージで維持)
        TerminalStorage.saveEmployeePreferences(targetEmpNo, {
          exists: true,
          categories: checked,
          revision: res.preferenceRevision,
          updatedAt: res.updatedAt
        });

        if (resolvedEmployeeNo === targetEmpNo) {
          window.ACTIVE_ITEMS = applyMaterialCategoryFilter(allItems, checked);
          if (cachedMasters) {
            TerminalStorage.saveMasterCache({
              bases: cachedMasters.bases,
              allItems: allItems,
              items: window.ACTIVE_ITEMS,
              fixedItems: cachedMasters.fixedItems,
              categories: cachedMasters.categories
            }, cachedMasters.masterRevision || 1);
          }
          showAppModal({ title: "設定保存", message: "使用資材カテゴリを更新しました。" });
        }
      } else if (res && res.error === "PREFERENCE_REVISION_CONFLICT") {
        showAppModal({
          title: "設定競合",
          message: "別の端末で設定が更新されています。最新設定を再取得します。"
        });
        // 最新設定を再取得して再描画
        return gasClient.lookupEmployee(targetEmpNo).then(latestRes => {
          if (latestRes && latestRes.preference) {
            TerminalStorage.saveEmployeePreferences(targetEmpNo, latestRes.preference);
            if (resolvedEmployeeNo === targetEmpNo) {
              renderSettingsView();
              initFixedItemsList();
              const activePref = TerminalStorage.getEmployeePreferences(targetEmpNo);
              window.ACTIVE_ITEMS = applyMaterialCategoryFilter(allItems, activePref.categories);
              if (cachedMasters) {
                TerminalStorage.saveMasterCache({
                  bases: cachedMasters.bases,
                  allItems: allItems,
                  items: window.ACTIVE_ITEMS,
                  fixedItems: cachedMasters.fixedItems,
                  categories: cachedMasters.categories
                }, cachedMasters.masterRevision || 1);
              }
            }
          }
        });
      } else {
        // 保存失敗時: チェックボックスを直前の保存済み設定にロールバック
        renderSettingsView();
        showAppModal({
          title: "保存エラー",
          message: res ? (res.message || res.error) : "設定の中央保存に失敗しました。"
        });
      }
    }).catch(err => {
      if (saveBtn) {
        saveBtn.textContent = origBtnText;
        saveBtn.disabled = false;
      }
      // 通信失敗時: チェックボックスを直前の保存済み設定にロールバック
      renderSettingsView();
      showAppModal({
        title: "通信エラー",
        message: "中央サーバーへの保存に失敗しました。電波の良い場所で再度お試しください。"
      });
    });
  } else {
    // 社員未設定時はローカルのみ保存
    TerminalStorage.saveUserSettings({ selectedMaterialCategories: checked });
    window.ACTIVE_ITEMS = applyMaterialCategoryFilter(allItems, checked);
    if (cachedMasters) {
      TerminalStorage.saveMasterCache({
        bases: cachedMasters.bases,
        allItems: allItems,
        items: window.ACTIVE_ITEMS,
        fixedItems: cachedMasters.fixedItems,
        categories: cachedMasters.categories
      }, cachedMasters.masterRevision || 1);
    }
    if (saveBtn) {
      saveBtn.textContent = origBtnText;
      saveBtn.disabled = false;
    }
    showAppModal({ title: "設定保存", message: "使用資材カテゴリを更新しました。" });
  }
}

function saveFixedItemPreferences() {
  const saveBtn = (typeof document !== "undefined") ? (document.querySelector('button[onclick="saveFixedItemPreferences()"]') || document.getElementById("btn-save-fixed-items")) : null;
  const origBtnText = saveBtn ? saveBtn.textContent : "";
  if (saveBtn) {
    saveBtn.textContent = "保存中…";
    saveBtn.disabled = true;
  }

  const checked = (typeof document !== "undefined")
    ? Array.from(document.querySelectorAll('input[name="fixed-item-pref"]:checked')).map(el => el.value)
    : [];

  if (resolvedEmployeeNo) {
    const targetEmpNo = resolvedEmployeeNo;
    const currentPref = TerminalStorage.getEmployeePreferences(targetEmpNo);
    const expectedRev = currentPref.exists ? currentPref.revision : 0;

    return gasClient.saveEmployeePreferences(targetEmpNo, { selectedFixedItemIds: checked }, expectedRev).then(res => {
      if (saveBtn) {
        saveBtn.textContent = origBtnText;
        saveBtn.disabled = false;
      }
      if (res && res.success) {
        // 中央保存成功時のみローカルキャッシュ確定 & UI確定 (カテゴリ・既定業者名設定を自動マージで維持)
        TerminalStorage.saveEmployeePreferences(targetEmpNo, {
          exists: true,
          fixedItemIds: checked,
          revision: res.preferenceRevision,
          updatedAt: res.updatedAt
        });

        if (resolvedEmployeeNo === targetEmpNo) {
          initFixedItemsList();
          showAppModal({ title: "設定保存", message: "使用定型品設定を更新しました。" });
        }
      } else if (res && res.error === "PREFERENCE_REVISION_CONFLICT") {
        showAppModal({
          title: "設定競合",
          message: "別の端末で設定が更新されています。最新設定を再取得します。"
        });
        // 最新設定を再取得して再描画
        return gasClient.lookupEmployee(targetEmpNo).then(latestRes => {
          if (latestRes && latestRes.preference) {
            TerminalStorage.saveEmployeePreferences(targetEmpNo, latestRes.preference);
            if (resolvedEmployeeNo === targetEmpNo) {
              renderSettingsView();
              initFixedItemsList();
              const cachedMasters = TerminalStorage.getMasterCache();
              const allItems = window.ACTIVE_ALL_ITEMS || (cachedMasters && (cachedMasters.allItems || cachedMasters.items)) || [];
              const activePref = TerminalStorage.getEmployeePreferences(targetEmpNo);
              window.ACTIVE_ITEMS = applyMaterialCategoryFilter(allItems, activePref.categories);
            }
          }
        });
      } else {
        // 保存失敗時: チェックボックスを直前の保存済み設定にロールバック
        renderSettingsView();
        showAppModal({
          title: "保存エラー",
          message: res ? (res.message || res.error) : "定型品設定の中央保存に失敗しました。"
        });
      }
    }).catch(err => {
      if (saveBtn) {
        saveBtn.textContent = origBtnText;
        saveBtn.disabled = false;
      }
      // 通信失敗時: チェックボックスを直前の保存済み設定にロールバック
      renderSettingsView();
      showAppModal({
        title: "通信エラー",
        message: "中央サーバーへの保存に失敗しました。電波の良い場所で再度お試しください。"
      });
    });
  } else {
    // 社員未設定時はローカルのみ保存
    TerminalStorage.saveUserSettings({ selectedFixedItemCodes: checked });
    initFixedItemsList();
    if (saveBtn) {
      saveBtn.textContent = origBtnText;
      saveBtn.disabled = false;
    }
    showAppModal({ title: "設定保存", message: "使用定型品設定を更新しました。" });
    return Promise.resolve();
  }
}

// 18. タブ切り替え (Lazy Loading & 社員設定ガード対応)
function switchTab(tabName) {
  if (tabName !== "settings" && (!resolvedEmployeeNo || !workingBaseCode)) {
    if (!resolvedEmployeeNo) {
      showAppModal({
        title: "社員番号未設定",
        message: "設定タブで社員番号を登録してください。"
      });
    } else {
      showAppModal({
        title: "入力Base未選択",
        message: "入力Baseを選択してください。"
      });
    }
  }

  ["create", "history", "summary", "settings"].forEach(t => {
    const view = document.getElementById(`view-${t}`);
    if (view) view.style.display = t === tabName ? "block" : "none";
    const btn = document.getElementById(`tab-btn-${t}`);
    if (btn) {
      if (t === tabName) btn.classList.add("active");
      else btn.classList.remove("active");
    }
  });

  if (tabName === "history") renderHistoryTable();
  if (tabName === "summary") renderSummaryView();
  if (tabName === "settings") renderSettingsView();
}

// 下位互換用ダミー集計ヘルパー (既存テスト検証用)
function getAggregatedScrapItems() {
  if (currentSummaryData && currentSummaryData.items) {
    return {
      items: currentSummaryData.items,
      totalSlipsCount: currentSummaryData.totalSlipsCount || 0,
      totalWeightKg: currentSummaryData.totalWeightKg || 0,
      totalItemsCount: currentSummaryData.totalItemsCount || 0
    };
  }
  return {
    items: [],
    totalSlipsCount: 0,
    totalWeightKg: 0,
    totalItemsCount: 0
  };
}

// 外部モジュールエクスポート
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    scrapSortState,
    toggleScrapSort,
    getAggregatedScrapItems,
    sortScrapItems,
    sanitizeCsvCell,
    generateScrapCsvContent,
    stepFormQuantity,
    toHalfWidthAlphanumeric,
    resetInputFormAfterSubmission,
    verifyAndSaveEmployee,
    applySummaryPeriodFilter,
    openCompletionModal,
    closeCompletionModal,
    closeCompletionModalAndReset,
    handleCompletionPrint,
    handleCompletionConfirm,
    handleCompletionOverlayClick,
    saveTemporaryDraft,
    executeFinalize,
    initCompletionState,
    initUserSettings,
    switchTab,
    renderHistoryTable,
    renderSummaryView,
    renderDraftSection,
    confirmDeleteDraft,
    executeDeleteDraft,
    confirmFullClear,
    executeFullClear,
    formatJstDate,
    formatJstDateTime,
    sortDrafts,
    stepFixedItemQuantity,
    getJstDateString,
    showEmployeeUnconfiguredBanner,
    hideEmployeeUnconfiguredBanner,
    applyMaterialCategoryFilter,
    getMaterialCategoryKey,
    saveCategoryPreferences,
    showMasterStatusBar,
    hideMasterStatusBar,
    showMasterLoadingOverlay,
    hideMasterLoadingOverlay,
    showMasterLoadingError,
    retryFetchMasters,
    fetchAndApplyMasters,
    getPrintQuantityDisplay,
    checkIfSlipAffectsSummary,
    setGasClient: (client) => { gasClient = client; },
    getGasClient: () => gasClient,
    getResolvedEmployeeInfo: () => ({
      resolvedEmployeeNo,
      resolvedEmployeeName,
      assignedEmployeeBaseCode,
      assignedEmployeeBaseName,
      workingBaseCode,
      workingBaseName,
      resolvedBaseCode,
      resolvedBaseName
    }),
    updateWorkingBaseState,
    requestWorkingBaseChange,
    applyWorkingBaseChange,
    hasActiveTransactionData,
    clearTransactionData,
    openBaseSelectorModal,
    closeBaseSelectorModal,
    renderBaseSelectorList,
    renderWorkingBaseUi,
    initializeGasClientInstance,
    startMasterSynchronization,
    runBootstrapSequence,
    initGasClient,
    initFixedItemsList,
    renderSettingsView,
    saveFixedItemPreferences,
    saveTemporaryDraft,
    resumeDraftSlip,
    executeDeleteDraft,
    getCurrentResumedDraftId: () => currentResumedDraftId,
    setCurrentResumedDraftId: (id) => { currentResumedDraftId = id; if (id) _vendorSaveSeq++; },
    getGasClientInstance: () => gasClient,
    setGasClientInstance: (c) => { gasClient = c; },
    setSubmissionBusy,
    setFinalizeButtonsDisabled,
    // Hotfix 02: Employee Vendor Preference
    getCurrentEmployeeDefaultVendor,
    applyEmployeeDefaultVendorToForm,
    handleVendorInputChange,
    initVendorInputHandlers,
    // P11 History & Search
    getHistoryBusinessDate,
    normalizeHistorySearchText,
    sortFinalHistorySlips,
    applyHistoryFilters,
    handleHistorySearch,
    handleHistorySearchClear,
    toCanonicalBusinessDate,
    formatJstDate,
    formatJstDateTime,
    getHistoryBusinessDate,
    normalizeHistorySearchText,
    sortFinalHistorySlips,
    applyHistoryFilters,
    handleHistorySearch,
    handleHistorySearchClear,
    handleHistoryLoadMore,
    openHistoryDetailModal,
    renderHistoryDetailContent,
    closeHistoryDetailModal,
    handleHistoryDetailPrint,
    handleHistoryDetailDelete,
    renderHistoryRows,
    sanitizeCsvCell,
    generateHistoryHeaderCsv,
    exportHistoryCsv,
    printSlipFromHistory,
    setActionButtonBusy,
    historyActionLocks,
    handleHistorySortChange,
    updateSortOrderLabels,
    showAppModal,
    closeGenericModal,
    getHistorySearchState: () => historySearchState,
    getFilteredHistorySlips: () => filteredHistorySlips,
    getHistoryDetailCache: () => historyDetailCache,
    SCRAP_APP_RUNTIME_REV,
    parseDateDetails,
    checkRuntimeAssetIdentity
  };
}

if (typeof window !== "undefined") {
  window.SCRAP_APP_RUNTIME_REV = SCRAP_APP_RUNTIME_REV;
  window.parseDateDetails = parseDateDetails;
  window.checkRuntimeAssetIdentity = checkRuntimeAssetIdentity;
  window.getPrintQuantityDisplay = getPrintQuantityDisplay;
  window.checkIfSlipAffectsSummary = checkIfSlipAffectsSummary;
  window.initializeGasClientInstance = initializeGasClientInstance;
  window.startMasterSynchronization = startMasterSynchronization;
  window.runBootstrapSequence = runBootstrapSequence;
  window.initFixedItemsList = initFixedItemsList;
  window.renderSettingsView = renderSettingsView;
  window.saveCategoryPreferences = saveCategoryPreferences;
  window.saveFixedItemPreferences = saveFixedItemPreferences;
  window.saveTemporaryDraft = saveTemporaryDraft;
  window.resumeDraftSlip = resumeDraftSlip;
  window.executeDeleteDraft = executeDeleteDraft;
  window.getCurrentResumedDraftId = () => currentResumedDraftId;
  window.setCurrentResumedDraftId = (id) => { currentResumedDraftId = id; if (id) _vendorSaveSeq++; };
  window.setSubmissionBusy = setSubmissionBusy;
  window.setFinalizeButtonsDisabled = setFinalizeButtonsDisabled;

  // Hotfix 02: Employee Vendor Preference
  window.getCurrentEmployeeDefaultVendor = getCurrentEmployeeDefaultVendor;
  window.applyEmployeeDefaultVendorToForm = applyEmployeeDefaultVendorToForm;
  window.handleVendorInputChange = handleVendorInputChange;
  window.initVendorInputHandlers = initVendorInputHandlers;

  // P11 History & Search & UI Fix
  window.toCanonicalBusinessDate = toCanonicalBusinessDate;
  window.formatJstDate = formatJstDate;
  window.formatJstDateTime = formatJstDateTime;
  window.getHistoryBusinessDate = getHistoryBusinessDate;
  window.normalizeHistorySearchText = normalizeHistorySearchText;
  window.sortFinalHistorySlips = sortFinalHistorySlips;
  window.applyHistoryFilters = applyHistoryFilters;
  window.handleHistorySearch = handleHistorySearch;
  window.handleHistorySearchClear = handleHistorySearchClear;
  window.handleHistorySortChange = handleHistorySortChange;
  window.updateSortOrderLabels = updateSortOrderLabels;
  window.handleHistoryLoadMore = handleHistoryLoadMore;
  window.openHistoryDetailModal = openHistoryDetailModal;
  window.renderHistoryDetailContent = renderHistoryDetailContent;
  window.closeHistoryDetailModal = closeHistoryDetailModal;
  window.handleHistoryDetailPrint = handleHistoryDetailPrint;
  window.handleHistoryDetailDelete = handleHistoryDetailDelete;
  window.renderHistoryRows = renderHistoryRows;
  window.sanitizeCsvCell = sanitizeCsvCell;
  window.generateHistoryHeaderCsv = generateHistoryHeaderCsv;
  window.exportHistoryCsv = exportHistoryCsv;
  window.printSlipFromHistory = printSlipFromHistory;
  window.setActionButtonBusy = setActionButtonBusy;
  window.historyActionLocks = historyActionLocks;
  window.historyDetailCache = historyDetailCache;
  window.showAppModal = showAppModal;
  window.closeGenericModal = closeGenericModal;
}

// P11 モーダル用 Escape キー & 背景クリックリスナー
if (typeof document !== "undefined" && typeof document.addEventListener === "function") {
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      if (typeof document.getElementById === "function") {
        const modal = document.getElementById("history-detail-modal");
        if (modal && modal.style && modal.style.display !== "none") {
          closeHistoryDetailModal();
        }
      }
    }
  });

  const attachOverlayListener = () => {
    if (typeof document.getElementById === "function") {
      const detailModal = document.getElementById("history-detail-modal");
      if (detailModal && typeof detailModal.addEventListener === "function") {
        detailModal.addEventListener("click", (e) => {
          if (e.target === detailModal) {
            closeHistoryDetailModal();
          }
        });
      }
    }
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", attachOverlayListener);
  } else {
    attachOverlayListener();
  }
}



