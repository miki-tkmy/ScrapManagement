// アプリケーション統合コントローラー (app.js)
// ========================================================================================
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

if (typeof document !== "undefined") {
  document.addEventListener("DOMContentLoaded", () => {
    initUserSettings();
    initDiagnostic(); // Gate 3-A.5: 診断モード (?diag=1) & Build ID 表示初期化
    initCompletionState(); // Section 8: Priority - open completion modal immediately before background sync
    initGasClient();
    initBaseCodeHandlers();
    initBaseSelectorModal();
    initItemCodeHandlers();
    initFixedItemsList();
    initVendorSignaturePad();
    initSummaryDates();
    setupHalfWidthNormalization(document.getElementById("other-name-input"));
    setupHalfWidthNormalization(document.getElementById("other-qty-input"));
    updateWeightDisplay();
    updateSignatureDisplay();
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

// 1. GAS クライアント初期化 & マスタ同期 (SWR & ローディング UX)
function initGasClient() {
  gasClient = new GasClient();
  updateNetworkStatus();

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

function checkMasterRevisionAndUpdate() {
  const cachedMasters = TerminalStorage.getMasterCache();
  const cachedRev = (cachedMasters && cachedMasters.masterRevision) ? cachedMasters.masterRevision : 0;
  const baseCode = resolvedBaseCode || "GLOBAL";

  // 既存の fresh な snapshot があれば通信せず比較
  const existingSnapshot = TerminalStorage.getStateSnapshot(baseCode);
  if (existingSnapshot && existingSnapshot.masterRevision !== undefined && TerminalStorage.isStateSnapshotFresh(baseCode)) {
    if (cachedMasters && existingSnapshot.masterRevision === cachedRev) {
      hideMasterStatusBar(300);
      return;
    }
  }

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

    // V3.10 SWR: バックグラウンドで最新 Preference リビジョンを確認
    gasClient.lookupEmployee(resolvedEmployeeNo).then(res => {
      if (res && res.success && res.preference) {
        const cachedPref = TerminalStorage.getEmployeePreferences(resolvedEmployeeNo);
        const serverRev = typeof res.preference.preferenceRevision === "number"
          ? res.preference.preferenceRevision
          : (typeof res.preference.revision === "number" ? res.preference.revision : 0);
        if (!cachedPref.exists || cachedPref.revision !== serverRev) {
          TerminalStorage.saveEmployeePreferences(resolvedEmployeeNo, res.preference);
          const activePref = TerminalStorage.getEmployeePreferences(resolvedEmployeeNo);
          window.ACTIVE_ITEMS = applyMaterialCategoryFilter(window.ACTIVE_ALL_ITEMS || [], activePref.categories);
          renderSettingsView();
        }
      }
    }).catch(() => {});
  } else {
    // 社員未設定状態を維持
    resolvedEmployeeNo = "";
    resolvedEmployeeName = "";
    assignedEmployeeBaseCode = "";
    assignedEmployeeBaseName = "";
    updateWorkingBaseState("", "", false);
    showEmployeeUnconfiguredBanner();
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

// 取引単位データクリア (社員設定・Working Base は維持)
function clearTransactionData() {
  const vendorInput = document.getElementById("vendor-name-input");
  if (vendorInput) vendorInput.value = "";

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
  if (prev.vendorName) {
    const vendorInput = document.getElementById("vendor-name-input");
    if (vendorInput) vendorInput.value = prev.vendorName;
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

  if (typeof setDiagnosticStage === "function") {
    setDiagnosticStage("LOOKUP_START");
  }

  const verifyBtn = document.getElementById("btn-verify-employee");
  if (verifyBtn) verifyBtn.disabled = true;

  const statusEl = document.getElementById("setting-employee-status");
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

      resolvedEmployeeNo = emp.employeeNo || emp.empNo || empNo;
      resolvedEmployeeName = emp.employeeName;
      assignedEmployeeBaseCode = bCode;
      assignedEmployeeBaseName = bName;

      // 社員変更に伴い前社員のセッション Working Base を破棄
      TerminalStorage.clearSessionWorkingBase();

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

      // 拠点・社員変更に伴い全キャッシュを破棄
      TerminalStorage.invalidateAllCaches();

      // 伝票入力へ即時反映
      applyEmployeeLockToForm();
      hideEmployeeUnconfiguredBanner();

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

// Gate 3-A.5: 診断パネル初期化 & DOM更新ヘルパー
function initDiagnostic() {
  const urlParams = (typeof window !== "undefined" && window.location) ? new URLSearchParams(window.location.search) : null;
  const isDiag = urlParams && urlParams.get("diag") === "1";
  const diagPanel = document.getElementById("diagnostic-panel");
  if (diagPanel && isDiag) {
    diagPanel.style.display = "block";
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

  const userSettings = TerminalStorage.getUserSettings();
  const selectedCodes = userSettings.selectedFixedItemCodes || [];

  const visibleList = (selectedCodes.length > 0)
    ? allFixed.filter(fi => selectedCodes.includes(fi.fixedItemId))
    : allFixed;

  visibleList.forEach(fi => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td style="vertical-align:middle;"><strong>${fi.itemName}</strong></td>
      <td style="vertical-align:middle;">
        <div class="qty-input-group fixed-qty-group">
          <button type="button" class="btn-qty-input-step" id="btn-fixed-minus-${fi.fixedItemId}" onclick="stepFixedItemQuantity('${fi.fixedItemId}', -1)" aria-label="${fi.itemName}の数量を1減らす">－</button>
          <input type="text" class="form-input" style="padding:0.4rem 0.4rem; text-align:center;"
            placeholder="例: 1, 一式" id="fixed-qty-${fi.fixedItemId}">
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
  document.body.classList.remove("modal-open");

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

  const baseCodeVal = resolvedBaseCode;
  const baseNameVal = resolvedBaseName;
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

function setFinalizeButtonsDisabled(disabled) {
  const btn = document.getElementById("btn-finalize");
  const modalBtn = document.getElementById("btn-modal-finalize");
  if (btn) {
    btn.disabled = disabled;
    btn.textContent = disabled ? "完了処理中..." : "完了";
  }
  if (modalBtn) {
    modalBtn.disabled = disabled;
    modalBtn.textContent = disabled ? "完了処理中..." : "署名なしで完了";
  }
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

  const baseCodeVal = resolvedBaseCode;
  const baseNameVal = resolvedBaseName;
  const staffNameVal = resolvedEmployeeName;
  const vendorNameVal = document.getElementById("vendor-name-input").value.trim();

  const fixedItems = collectFixedItems();
  const weightSummary = WeightEngine.calculateEstimatedWeight(currentCodeItems);
  const now = new Date().toISOString();

  if (!pendingFinalizeSlip) {
    const secureId = generateSecureScrapId();
    const idempotencyKey = `idemp-${Date.now()}-${Math.random().toString(36).substring(2, 10)}`;
    pendingFinalizeSlip = {
      scrapId: secureId,
      slipId: secureId,
      createdAt: now,
      date: now.slice(0, 10),
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
  setFinalizeButtonsDisabled(true);

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

    setFinalizeButtonsDisabled(false);
    if (!res || !res.success) {
      const errMsg = res ? (res.error || res.message) : "Unknown error";
      console.error("[app.js] Finalize failed:", errMsg);
      showAppModal({
        title: "登録に失敗しました",
        message: "STAGING バックエンドへの登録が完了していません。通信状態を確認の上、再度お試しください。"
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
    TerminalStorage.clearLocalDraft();

    // 履歴キャッシュは必ず無効化
    TerminalStorage.invalidateHistoryCache(resolvedBaseCode);

    // 集計キャッシュは affectsMaterialSummary === true の場合のみ無効化 (Backendレスポンス優先、ローカル判定フォールバック)
    const shouldInvalidateMaterialSummary = (res && typeof res.affectsMaterialSummary === "boolean")
      ? res.affectsMaterialSummary
      : ((res && typeof res.affectsSummary === "boolean")
        ? res.affectsSummary
        : checkIfSlipAffectsSummary(slipRecord));

    if (shouldInvalidateMaterialSummary) {
      TerminalStorage.invalidateSummaryCache(resolvedBaseCode);
    } else {
      // 資材に影響しないFINAL (定型品のみ、その他のみ、一式のみ):
      // 集計キャッシュを温存し、総伝票数のみローカルキャッシュで高速加算 (Optional Fast Local Count)
      const fromDate = document.getElementById("summary-from-date") ? document.getElementById("summary-from-date").value : "";
      const toDate = document.getElementById("summary-to-date") ? document.getElementById("summary-to-date").value : "";
      const cached = TerminalStorage.getSummaryCache(resolvedBaseCode, fromDate, toDate);
      if (cached) {
        // Section 10: 冪等性チェック (重複確定/リトライ時は二重加算しない)
        const isDuplicateFinal = res.status === "ALREADY_FINALIZED" || res.duplicatePrevented === true;
        // Section 9: 期間条件チェック (確定伝票の処分日がキャッシュ期間に含まれる場合のみ加算)
        const slipDate = slipRecord.date; // YYYY-MM-DD
        const inRange = (!fromDate || slipDate >= fromDate) && (!toDate || slipDate <= toDate);

        if (!isDuplicateFinal && inRange) {
          const curCount = cached.totalSlipsCount !== undefined ? cached.totalSlipsCount : (cached.data && cached.data.totalSlipsCount ? cached.data.totalSlipsCount : 0);
          TerminalStorage.updateSummaryCountInCache(resolvedBaseCode, fromDate, toDate, curCount + 1, res.slipCountRevision);
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
    setFinalizeButtonsDisabled(false);
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

  const vendorInput = document.getElementById("vendor-name-input");
  if (vendorInput) vendorInput.value = "";

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
  if (resolvedBaseCode) {
    TerminalStorage.invalidateHistoryCache(resolvedBaseCode);
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

  const baseCodeVal = resolvedBaseCode;
  const baseNameVal = resolvedBaseName;
  const staffNameVal = resolvedEmployeeName;
  const vendorNameVal = document.getElementById("vendor-name-input").value.trim();
  const todayJst = getJstDateString();

  const draftData = {
    date: todayJst, // JST 当日日付を処分日として明示保存 (savedAt の代用禁止)
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

  gasClient.saveDraft(draftData).then(res => {
    if (res && res.success) {
      TerminalStorage.clearLocalDraft();
      // 履歴キャッシュを無効化
      TerminalStorage.invalidateHistoryCache(baseCodeVal);
      try {
        sessionStorage.setItem("scrap_draft_saved_success", "true");
      } catch (e) {
        console.error("[app.js] Failed to save draft success state to sessionStorage:", e);
      }
      // 成功時: 実際のページ再読込を実行 (実ページ更新 + 入力内容クリア)
      window.location.reload();
    } else {
      // 失敗時: 画面入力を保持し、リロードしない
      showAppModal({
        title: "一時保存エラー",
        message: "一時保存に失敗しました。通信状態を確認の上、再度お試しください。"
      });
    }
  }).catch(err => {
    // 通信エラー時: 端末非常用バックアップを保存するが、画面入力は保持し、リロードしない
    TerminalStorage.saveLocalDraft(draftData);
    showAppModal({
      title: "一時保存エラー",
      message: "通信エラーにより一時保存に失敗しました。\n端末にバックアップを保持しましたが、一時保存は完了していません。\n通信状態を確認の上、再度お試しください。"
    });
  });
}

function resumeDraftSlip(slipId) {
  gasClient.fetchSlip(slipId).then(res => {
    if (res && res.success && res.slip) {
      const s = res.slip;
      currentCodeItems = Array.isArray(s.codeItems) ? s.codeItems : [];
      currentOtherItems = Array.isArray(s.otherItems) ? s.otherItems : [];

      const vendorInput = document.getElementById("vendor-name-input");
      if (vendorInput) vendorInput.value = s.vendorName || "";

      // 定型品復元
      (s.fixedItems || []).forEach(fi => {
        const input = document.getElementById(`fixed-qty-${fi.fixedItemId}`);
        if (input) input.value = fi.quantityInput || "";
      });

      renderCodeItemsTable();
      renderOtherItemsTable();
      updateWeightDisplay();

      switchTab("create");
      showAppModal({ title: "下書き再開", message: "下書きの入力を再開しました。" });
    }
  });
}

// 12.5. 一時保存下書きの削除 (論理削除 & モーダル確認)
function confirmDeleteDraft(draftId) {
  showAppModal({
    title: "一時保存を削除",
    message: "この一時保存を削除しますか？",
    okText: "削除",
    cancelText: "キャンセル",
    onOk: () => executeDeleteDraft(draftId)
  });
}

function executeDeleteDraft(draftId) {
  if (!draftId) return;
  const baseCode = resolvedBaseCode;

  gasClient.deleteDraft({
    scrapId: draftId,
    baseCode: baseCode,
    employeeNo: resolvedEmployeeNo
  }).then(res => {
    if (res && res.success) {
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
  });
}

// 日付・日時フォーマットヘルパー (JST Asia/Tokyo)
function formatJstDate(dateVal) {
  if (!dateVal) return "--";
  if (typeof dateVal === "string") {
    const trimmed = dateVal.trim();
    if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) {
      return trimmed.slice(0, 10).replace(/-/g, "/");
    }
    if (/^\d{4}\/\d{2}\/\d{2}/.test(trimmed)) {
      return trimmed.slice(0, 10);
    }
  }
  const d = new Date(dateVal);
  if (isNaN(d.getTime())) return String(dateVal).slice(0, 10);
  const utcMs = d.getTime() + (d.getTimezoneOffset() * 60 * 1000);
  const jst = new Date(utcMs + (9 * 60 * 60 * 1000));
  const yyyy = jst.getFullYear();
  const mm = String(jst.getMonth() + 1).padStart(2, "0");
  const dd = String(jst.getDate()).padStart(2, "0");
  return `${yyyy}/${mm}/${dd}`;
}

function formatJstDateTime(dateVal) {
  if (!dateVal) return "--";
  const d = new Date(dateVal);
  if (isNaN(d.getTime())) return String(dateVal);
  const utcMs = d.getTime() + (d.getTimezoneOffset() * 60 * 1000);
  const jst = new Date(utcMs + (9 * 60 * 60 * 1000));
  const yyyy = jst.getFullYear();
  const mm = String(jst.getMonth() + 1).padStart(2, "0");
  const dd = String(jst.getDate()).padStart(2, "0");
  const hh = String(jst.getHours()).padStart(2, "0");
  const min = String(jst.getMinutes()).padStart(2, "0");
  return `${yyyy}/${mm}/${dd} ${hh}:${min}`;
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
        <button type="button" class="btn btn-secondary btn-sm" onclick="resumeDraftSlip('${draftId}')">再開</button>
        <button type="button" class="btn btn-outline-danger btn-sm" onclick="confirmDeleteDraft('${draftId}')">削除</button>
      </div>
    `;
    list.appendChild(card);
  });
}

// 13. 中央履歴一覧 (5分TTL キャッシュ & Central DB SSOT)
function renderHistoryTable() {
  const tbody = document.getElementById("history-table-tbody");
  if (!tbody) return;

  if (!resolvedBaseCode) {
    tbody.innerHTML = `<tr><td colspan="8" style="text-align:center; color:var(--color-text-muted); padding:2rem;">
      <p style="font-weight:bold; margin-bottom:0.5rem;">社員設定が登録されていません</p>
      <p style="font-size:0.85rem; margin:0;">「設定」タブで社員番号を登録すると、所属拠点の履歴が表示されます。</p>
    </td></tr>`;
    renderDraftSection([]);
    return;
  }

  const baseCode = resolvedBaseCode;

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

function renderHistoryRows(tbody, slips) {
  tbody.innerHTML = "";

  if (!slips || slips.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8" style="text-align:center; color:var(--color-text-muted); padding:1.5rem;">確定された処分伝票はありません (拠点: ${resolvedBaseName})。</td></tr>`;
    return;
  }

  slips.forEach((s, idx) => {
    const dateStr = s.createdAt ? s.createdAt.slice(0, 10) : (s.date || "--");
    const sigBadge = s.signatureStatus === "DIGITAL"
      ? `<span class="brand-badge" style="background:var(--color-success); font-size:0.75rem;">電子署名済</span>`
      : `<span class="brand-badge" style="background:var(--color-tertiary); color:var(--color-headline); font-size:0.75rem;">署名なし</span>`;

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td class="history-col-mobile">
        <div class="history-row-1 history-row-top">
          <span class="hist-date">${dateStr}</span>
          <span class="hist-slip-no">${s.slipNo || s.slipId}</span>
        </div>
        <div class="history-row-2">
          <span class="hist-base">${s.baseName}</span>
          <span class="hist-staff">${s.staffName}</span>
        </div>
        <div class="history-row-3 history-row-bottom">
          <div class="hist-actions">
            ${sigBadge}
            <button type="button" class="btn btn-secondary btn-sm" onclick="printSlipFromHistory(${idx})">印刷</button>
          </div>
        </div>
      </td>
      <td class="hist-desktop-col"><strong>${s.slipNo || s.slipId}</strong></td>
      <td class="hist-desktop-col">${dateStr}</td>
      <td class="hist-desktop-col">${s.baseName}</td>
      <td class="hist-desktop-col">${s.staffName}</td>
      <td class="hist-desktop-col">${s.vendorName}</td>
      <td class="hist-desktop-col">${sigBadge}</td>
      <td class="hist-desktop-col"><span class="brand-badge" style="background:var(--color-primary); color:var(--color-button-text); font-size:0.75rem;">完了</span></td>
      <td class="hist-desktop-col">
        <button type="button" class="btn btn-secondary" style="padding:0.25rem 0.6rem; font-size:0.8rem; min-height:auto;"
          onclick="printSlipFromHistory(${idx})">印刷</button>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

function printSlipFromHistory(index) {
  const s = centralHistorySlips[index];
  if (!s) return;

  // 詳細が空の場合は Central DB から個別取得
  if (!s.codeItems || s.codeItems.length === 0) {
    gasClient.fetchSlip(s.slipNo || s.slipId).then(res => {
      if (res && res.success && res.slip) {
        printSlipFromRecord(res.slip);
      }
    });
  } else {
    printSlipFromRecord(s);
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

  if (printDateEl) printDateEl.textContent = (s.createdAt || s.date || "").slice(0, 10);
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
        <td>${it.itemName} (${it.itemCode})</td>
        <td class="text-right">${getPrintQuantityDisplay(it)}</td>
      `;
      tbody.appendChild(tr);
    });

    (s.fixedItems || []).forEach(fi => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td class="text-center">${lineNo++}</td>
        <td>定型品</td>
        <td>${fi.itemName}</td>
        <td class="text-right">${getPrintQuantityDisplay(fi)}</td>
      `;
      tbody.appendChild(tr);
    });

    (s.otherItems || []).forEach(oi => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td class="text-center">${lineNo++}</td>
        <td>その他品</td>
        <td>${oi.itemName}</td>
        <td class="text-right">${oi.quantityInput || ""}</td>
      `;
      tbody.appendChild(tr);
    });
  }

  // 署名欄: DIGITAL なら画像表示、NONE なら空白 (受領印・手書き署名等の文言は一切表示しない)
  const sigImg = document.getElementById("print-vendor-signature-img");
  if (sigImg) {
    if (s.signatureStatus === "DIGITAL" && (s.vendorSignatureImage || s.signatureData)) {
      sigImg.src = s.vendorSignatureImage || s.signatureData;
      sigImg.style.display = "block";
    } else {
      sigImg.src = "";
      sigImg.style.display = "none";
    }
  }

  setTimeout(() => {
    window.print();
  }, 200);
}

// 15. CSV エクスポート (履歴全体)
function exportHistoryCsv() {
  const slips = centralHistorySlips;
  if (!slips || slips.length === 0) {
    showAppModal({ title: "お知らせ", message: "エクスポート可能な確定伝票がありません。" });
    return;
  }

  let csvContent = "\uFEFF";
  csvContent += "伝票番号,発行日,Base名,担当者,業者名,資材コード,品名,数量,数量区分,署名区分\r\n";

  slips.forEach(s => {
    (s.codeItems || []).forEach(it => {
      if (s.status === "FINAL" && it.quantityType === "NUMBER" && typeof it.quantityValue === "number") {
        csvContent += [
          sanitizeCsvCell(s.slipId),
          sanitizeCsvCell((s.createdAt || s.date || "").slice(0, 10)),
          sanitizeCsvCell(s.baseName),
          sanitizeCsvCell(s.staffName),
          sanitizeCsvCell(s.vendorName),
          sanitizeCsvCell(it.itemCode),
          sanitizeCsvCell(it.itemName),
          sanitizeCsvCell(it.quantityValue),
          sanitizeCsvCell(it.quantityType),
          sanitizeCsvCell(s.signatureStatus)
        ].join(",") + "\r\n";
      }
    });
  });

  downloadCsvFile(csvContent, `Takamiya_ScrapHistory_${resolvedBaseCode}_${new Date().toISOString().slice(0, 10)}.csv`);
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
  if (cachedData) {
    currentSummaryData = cachedData;
    updateSummaryUi(cachedData);
  } else {
    // 初回キャッシュなし時のみ Loading 表示
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
        } else if (!cachedData) {
          fetchAndRenderSummary(tbody, baseCode, fromDate, toDate, { slipCountRevision: 1, materialSummaryRevision: 1 });
        }
      }).catch(err => {
        console.error("[app.js] fetchState error:", err);
        if (!cachedData) {
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
        } else if (!cachedData) {
          fetchAndRenderSummary(tbody, baseCode, fromDate, toDate, { slipCountRevision: targetSlipRev, materialSummaryRevision: 1 });
        }
      }).catch(err => {
        console.error("[app.js] fetchState error:", err);
        if (!cachedData) {
          fetchAndRenderSummary(tbody, baseCode, fromDate, toDate, { slipCountRevision: targetSlipRev, materialSummaryRevision: 1 });
        }
      });
      return;
    }

    if (!cached) {
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
  if (val === null || val === undefined) return "";
  let str = String(val);
  if (/^[=+\-@\t\r]/.test(str)) {
    str = "'" + str;
  }
  if (str.includes('"') || str.includes(',') || str.includes('\n') || str.includes('\r')) {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
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
    const selectedFixed = userSettings.selectedFixedItemCodes || [];

    allFixed.forEach(fi => {
      const isChecked = selectedFixed.length === 0 || selectedFixed.includes(fi.fixedItemId);
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

  // V3.10 CASE A: ネットワーク通信なし (通信 0) で allItems から即座にローカル再フィルタ
  const cachedMasters = TerminalStorage.getMasterCache();
  const allItems = window.ACTIVE_ALL_ITEMS || (cachedMasters && (cachedMasters.allItems || cachedMasters.items)) || [];
  window.ACTIVE_ITEMS = applyMaterialCategoryFilter(allItems, checked);

  // キャッシュ内の items も最新フィルタ結果に更新
  if (cachedMasters) {
    TerminalStorage.saveMasterCache({
      bases: cachedMasters.bases,
      allItems: allItems,
      items: window.ACTIVE_ITEMS,
      fixedItems: cachedMasters.fixedItems,
      categories: cachedMasters.categories
    }, cachedMasters.masterRevision || 1);
  }

  if (resolvedEmployeeNo) {
    const currentPref = TerminalStorage.getEmployeePreferences(resolvedEmployeeNo);
    const expectedRev = currentPref.exists ? currentPref.revision : 0;

    gasClient.saveEmployeePreferences(resolvedEmployeeNo, checked, expectedRev).then(res => {
      if (saveBtn) {
        saveBtn.textContent = origBtnText;
        saveBtn.disabled = false;
      }
      if (res && res.success) {
        TerminalStorage.saveEmployeePreferences(resolvedEmployeeNo, {
          exists: true,
          categories: checked,
          revision: res.preferenceRevision,
          updatedAt: res.updatedAt
        });
        showAppModal({ title: "設定保存", message: "使用資材カテゴリを更新しました。" });
      } else if (res && res.error === "PREFERENCE_REVISION_CONFLICT") {
        showAppModal({
          title: "設定競合",
          message: "別の端末で設定が更新されています。最新設定を再取得します。"
        });
        // 最新設定を再取得して再描画
        gasClient.lookupEmployee(resolvedEmployeeNo).then(latestRes => {
          if (latestRes && latestRes.preference) {
            TerminalStorage.saveEmployeePreferences(resolvedEmployeeNo, latestRes.preference);
            const activePref = TerminalStorage.getEmployeePreferences(resolvedEmployeeNo);
            renderSettingsView();
            window.ACTIVE_ITEMS = applyMaterialCategoryFilter(window.ACTIVE_ALL_ITEMS || [], activePref.categories);
          }
        });
      } else {
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
      showAppModal({
        title: "通信エラー",
        message: "中央サーバーへの保存に失敗しました。電波の良い場所で再度お試しください。"
      });
    });
  } else {
    // 社員未設定時はローカルのみ保存
    TerminalStorage.saveUserSettings({ selectedMaterialCategories: checked });
    if (saveBtn) {
      saveBtn.textContent = origBtnText;
      saveBtn.disabled = false;
    }
    showAppModal({ title: "設定保存", message: "使用資材カテゴリを更新しました。" });
  }
}

function saveFixedItemPreferences() {
  const checked = Array.from(document.querySelectorAll('input[name="fixed-item-pref"]:checked')).map(el => el.value);
  TerminalStorage.saveUserSettings({ selectedFixedItemCodes: checked });
  initFixedItemsList();
  showAppModal({ title: "設定保存", message: "使用定型品設定を更新しました。" });
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
    renderWorkingBaseUi
  };
}

if (typeof window !== "undefined") {
  window.getPrintQuantityDisplay = getPrintQuantityDisplay;
  window.checkIfSlipAffectsSummary = checkIfSlipAffectsSummary;
}


