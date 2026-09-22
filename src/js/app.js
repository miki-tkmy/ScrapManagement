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

// 社員設定 (解決済み情報)
let resolvedEmployeeNo = "";
let resolvedEmployeeName = "";
let resolvedBaseCode = "";
let resolvedBaseName = "";

if (typeof document !== "undefined") {
  document.addEventListener("DOMContentLoaded", () => {
    initGasClient();
    initUserSettings();
    initBaseCodeHandlers();
    initItemCodeHandlers();
    initFixedItemsList();
    initVendorSignaturePad();
    initSummaryDates();
    setupHalfWidthNormalization(document.getElementById("other-name-input"));
    setupHalfWidthNormalization(document.getElementById("other-qty-input"));
    updateWeightDisplay();
    updateSignatureDisplay();
    initCompletionState();
  });
}

// カテゴリフィルタリング用ヘルパー (CASE A: 全品からローカル抽出)
function applyMaterialCategoryFilter(allItems, selectedCategories) {
  if (!allItems || !Array.isArray(allItems)) return [];
  if (!selectedCategories || selectedCategories.length === 0) return allItems;
  return allItems.filter(it => {
    const cat = it.categoryCode || it.category;
    return !cat || selectedCategories.includes(cat);
  });
}

// 1. GAS クライアント初期化 & マスタ同期 (全品キャッシュ & ローカルカテゴリフィルタ & リビジョンキャッシュ)
function initGasClient() {
  gasClient = new GasClient();
  updateNetworkStatus();

  // Fast Path: マスタキャッシュ (localStorage) があれば即時復元して画面操作可能へ
  const cachedMasters = TerminalStorage.getMasterCache();
  const userSettings = TerminalStorage.getUserSettings();
  if (cachedMasters && cachedMasters.bases && cachedMasters.bases.length > 0) {
    window.ACTIVE_BASES = cachedMasters.bases;
    const allItems = cachedMasters.allItems || cachedMasters.items || [];
    window.ACTIVE_ALL_ITEMS = allItems;
    window.ACTIVE_ITEMS = applyMaterialCategoryFilter(allItems, userSettings.selectedMaterialCategories);
    if (cachedMasters.fixedItems && cachedMasters.fixedItems.length > 0) {
      window.ACTIVE_FIXED_ITEMS = cachedMasters.fixedItems;
      initFixedItemsList();
    }
    if (cachedMasters.categories && cachedMasters.categories.length > 0) {
      window.AVAILABLE_CATEGORIES = cachedMasters.categories;
    }
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
      fetchAndApplyMasters(serverMasterRev || 1);
    }
  }).catch(() => {
    if (!cachedMasters) {
      fetchAndApplyMasters(1);
    }
  });
}

function fetchAndApplyMasters(targetRevision = 1) {
  const userSettings = TerminalStorage.getUserSettings();

  // CASE A: 全品マスタを取得し、ローカルでフィルタリングする
  gasClient.fetchMasters({}).then(res => {
    if (res && res.success) {
      if (Array.isArray(res.bases) && res.bases.length > 0) window.ACTIVE_BASES = res.bases;
      const allItems = Array.isArray(res.items) ? res.items : [];
      window.ACTIVE_ALL_ITEMS = allItems;
      window.ACTIVE_ITEMS = applyMaterialCategoryFilter(allItems, userSettings.selectedMaterialCategories);
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
    } else if (gasClient.getMode() === "GAS_STAGING") {
      console.warn("[app.js] STAGING Backend masters unavailable:", res ? res.error : "Unknown");
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

// 2. 利用者設定 (社員番号・担当者・拠点) の初期化 & フォームロック
function initUserSettings() {
  const settings = TerminalStorage.getUserSettings();
  if (settings.employeeNo && settings.resolvedEmployeeName && settings.resolvedBaseCode) {
    resolvedEmployeeNo = settings.employeeNo;
    resolvedEmployeeName = settings.resolvedEmployeeName;
    resolvedBaseCode = settings.resolvedBaseCode;
    resolvedBaseName = settings.resolvedBaseName;

    // 設定画面へ反映
    const empInput = document.getElementById("setting-employee-no");
    const nameInput = document.getElementById("setting-employee-name");
    const baseInput = document.getElementById("setting-base-name");
    const statusEl = document.getElementById("setting-employee-status");

    if (empInput) empInput.value = resolvedEmployeeNo;
    if (nameInput) nameInput.value = resolvedEmployeeName;
    if (baseInput) baseInput.value = resolvedBaseName;
    if (statusEl) {
      statusEl.innerHTML = `<span style="color:var(--color-success); font-weight:bold;">✓ 社員登録済み (${resolvedEmployeeName} / ${resolvedBaseName})</span>`;
    }

    // 伝票入力画面のロック
    applyEmployeeLockToForm();
    hideEmployeeUnconfiguredBanner();
  } else {
    // 社員未設定状態を維持 (B01などの勝手なフォールバック禁止)
    resolvedEmployeeNo = "";
    resolvedEmployeeName = "";
    resolvedBaseCode = "";
    resolvedBaseName = "";
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
    const completionPending = sessionStorage.getItem("scrap_completion_pending");
    if (completionPending === "true") {
      openCompletionModal();
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
  const baseCodeInput = document.getElementById("base-code-input");
  const baseNameDisplay = document.getElementById("base-name-display");
  const staffNameInput = document.getElementById("staff-name-input");
  const baseCodeGroup = document.getElementById("base-code-group");

  if (baseCodeInput) baseCodeInput.value = resolvedBaseCode;
  if (baseNameDisplay) baseNameDisplay.value = resolvedBaseName;
  if (staffNameInput) {
    staffNameInput.value = resolvedEmployeeName;
    staffNameInput.readOnly = true;
    staffNameInput.classList.add("input-readonly");
  }
  if (baseCodeGroup) {
    baseCodeGroup.style.display = resolvedBaseCode ? "none" : "block";
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

  const statusEl = document.getElementById("setting-employee-status");
  if (statusEl) statusEl.innerHTML = `<span style="color:var(--color-primary);">照会中...</span>`;

  gasClient.lookupEmployee(empNo).then(res => {
    if (res && res.success && res.employee) {
      const emp = res.employee;

      // BaseCode または BaseName の不整合を検証 (Fail-Closed)
      if (!emp.baseCode || !String(emp.baseCode).trim() || !emp.baseName || !String(emp.baseName).trim()) {
        const mismatchMsg = "社員情報の拠点データに不整合があります (BaseCode または BaseName が未設定)。";
        if (statusEl) statusEl.innerHTML = `<span style="color:var(--color-danger); font-weight:bold;">✕ ${mismatchMsg}</span>`;
        showAppModal({ title: "社員情報不整合", message: mismatchMsg });
        return;
      }

      resolvedEmployeeNo = emp.empNo;
      resolvedEmployeeName = emp.employeeName;
      resolvedBaseCode = emp.baseCode;
      resolvedBaseName = emp.baseName;

      const nameInput = document.getElementById("setting-employee-name");
      const baseInput = document.getElementById("setting-base-name");
      if (nameInput) nameInput.value = resolvedEmployeeName;
      if (baseInput) baseInput.value = resolvedBaseName;

      if (statusEl) {
        statusEl.innerHTML = `<span style="color:var(--color-success); font-weight:bold;">✓ 確認完了: ${resolvedEmployeeName} (${resolvedBaseName}) として登録しました。</span>`;
      }

      // 端末設定保存
      TerminalStorage.saveUserSettings({
        employeeNo: resolvedEmployeeNo,
        resolvedEmployeeName: resolvedEmployeeName,
        resolvedBaseCode: resolvedBaseCode,
        resolvedBaseName: resolvedBaseName,
        lastVerifiedAt: new Date().toISOString()
      });

      // 拠点・社員変更に伴い全キャッシュを破棄
      TerminalStorage.invalidateAllCaches();

      // 伝票入力へ即時反映
      applyEmployeeLockToForm();
      hideEmployeeUnconfiguredBanner();

      showAppModal({
        title: "設定完了",
        message: `社員番号 ${resolvedEmployeeNo}\n担当者: ${resolvedEmployeeName}\n所属拠点: ${resolvedBaseName}\nとして設定しました。`
      });
    } else {
      const msg = res ? (res.message || res.error) : "社員番号の照会に失敗しました。";
      if (statusEl) statusEl.innerHTML = `<span style="color:var(--color-danger); font-weight:bold;">✕ ${msg}</span>`;
      showAppModal({ title: "照会エラー", message: msg });
    }
  }).catch(err => {
    console.error("[app.js] lookupEmployee error:", err);
    if (statusEl) statusEl.innerHTML = `<span style="color:var(--color-danger);">通信エラーが発生しました。</span>`;
    showAppModal({ title: "通信エラー", message: "社員情報の取得に失敗しました。通信状態を確認してください。" });
  });
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
  if (!resolvedBaseCode) {
    showAppModal({
      title: "社員番号未設定",
      message: "伝票を完了するには、まず「設定」タブで社員番号を登録してください。"
    });
    return;
  }

  if (!resolvedBaseName || !resolvedBaseName.trim()) {
    showAppModal({
      title: "拠点名未設定",
      message: "拠点名を確認してください。設定タブで社員番号を登録してください。"
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
  closeNoSignatureModal();

  if (!resolvedBaseCode) {
    showAppModal({
      title: "社員番号未設定",
      message: "伝票を完了するには、まず「設定」タブで社員番号を登録してください。"
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

  // Central DB へ送信
  gasClient.finalizeSlip(slipRecord).then(res => {
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

    // 履歴および集計キャッシュを無効化
    TerminalStorage.invalidateHistoryCache(resolvedBaseCode);
    TerminalStorage.invalidateSummaryCache(resolvedBaseCode);

    // 印刷用伝票レコードおよび完了モーダル表示フラグを sessionStorage へ保存
    try {
      sessionStorage.setItem("scrap_last_final_slip", JSON.stringify(slipRecord));
      sessionStorage.setItem("scrap_completion_pending", "true");
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
  if (!resolvedBaseCode) {
    showAppModal({
      title: "社員番号未設定",
      message: "伝票を一時保存するには、まず「設定」タブで社員番号を登録してください。"
    });
    return;
  }

  if (!resolvedBaseName || !resolvedBaseName.trim()) {
    showAppModal({
      title: "拠点名未設定",
      message: "拠点名を確認してください。設定タブで社員番号を登録してください。"
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

  // 明細テーブル (重量非表示)
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
        <td class="text-right">${it.quantityInput}</td>
      `;
      tbody.appendChild(tr);
    });

    (s.fixedItems || []).forEach(fi => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td class="text-center">${lineNo++}</td>
        <td>定型品</td>
        <td>${fi.itemName}</td>
        <td class="text-right">${fi.quantityInput}</td>
      `;
      tbody.appendChild(tr);
    });

    (s.otherItems || []).forEach(oi => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td class="text-center">${lineNo++}</td>
        <td>その他品</td>
        <td>${oi.itemName}</td>
        <td class="text-right">${oi.quantityInput}</td>
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

  // 1. キャッシュチェック (Fast Path)
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

  // 2. State Snapshot チェック (30秒スロットル共有 & 判定不省略)
  if (TerminalStorage.isStateSnapshotFresh(baseCode)) {
    const snapshot = TerminalStorage.getStateSnapshot(baseCode);
    const snapshotSummRev = snapshot && snapshot.summaryRevision !== undefined ? snapshot.summaryRevision : null;
    // キャッシュがあり、かつスナップショットのリビジョンと一致しているなら通信 0 で終了
    if (cached && snapshotSummRev !== null && cached.summaryRevision === snapshotSummRev) {
      return;
    }
    // スナップショットでリビジョン不一致が検知された場合は本体取得へ進む (通信 0 で検知!)
    if (snapshotSummRev !== null) {
      fetchAndRenderSummary(tbody, baseCode, fromDate, toDate, snapshotSummRev);
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
    const serverSummRev = (stateRes && stateRes.success && stateRes.summaryRevision !== undefined)
      ? stateRes.summaryRevision
      : null;

    // キャッシュがあり、かつリビジョンが一致しているなら本体再取得なし (通信 0)
    if (cached && serverSummRev !== null && cached.summaryRevision === serverSummRev) {
      return;
    }

    // リビジョン不一致またはキャッシュなし: 本体取得
    fetchAndRenderSummary(tbody, baseCode, fromDate, toDate, serverSummRev || 1);
  }).catch(err => {
    console.error("[app.js] fetchState error:", err);
    if (!cachedData) {
      fetchAndRenderSummary(tbody, baseCode, fromDate, toDate, 1);
    }
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

  // カテゴリチェックボックス
  if (catContainer) {
    catContainer.innerHTML = "";
    const cats = window.AVAILABLE_CATEGORIES || [
      { categoryCode: "PIPE", categoryName: "単管" },
      { categoryCode: "BRACKET", categoryName: "金具" },
      { categoryCode: "NEXTGEN", categoryName: "次世代" },
      { categoryCode: "FRAME", categoryName: "枠組" },
      { categoryCode: "IQ", categoryName: "IQ" }
    ];
    const selectedCats = userSettings.selectedMaterialCategories || [];

    cats.forEach(c => {
      const isChecked = selectedCats.length === 0 || selectedCats.includes(c.categoryCode);
      const label = document.createElement("label");
      label.className = "checkbox-label";
      label.innerHTML = `
        <input type="checkbox" name="material-cat" value="${c.categoryCode}" ${isChecked ? "checked" : ""}>
        <span>${c.categoryName} (${c.categoryCode})</span>
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
  const checked = Array.from(document.querySelectorAll('input[name="material-cat"]:checked')).map(el => el.value);
  TerminalStorage.saveUserSettings({ selectedMaterialCategories: checked });

  // CASE A: ネットワーク通信なし (通信 0) で allItems から即座にローカル再フィルタ
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

  showAppModal({ title: "設定保存", message: "使用資材カテゴリを更新しました。" });
}

function saveFixedItemPreferences() {
  const checked = Array.from(document.querySelectorAll('input[name="fixed-item-pref"]:checked')).map(el => el.value);
  TerminalStorage.saveUserSettings({ selectedFixedItemCodes: checked });
  initFixedItemsList();
  showAppModal({ title: "設定保存", message: "使用定型品設定を更新しました。" });
}

// 18. タブ切り替え (Lazy Loading & 社員設定ガード対応)
function switchTab(tabName) {
  if (tabName !== "settings" && (!resolvedEmployeeNo || !resolvedBaseCode)) {
    showAppModal({
      title: "社員番号未設定",
      message: "設定タブで社員番号を登録してください。"
    });
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
    saveCategoryPreferences,
    fetchAndApplyMasters,
    getResolvedEmployeeInfo: () => ({
      resolvedEmployeeNo,
      resolvedEmployeeName,
      resolvedBaseCode,
      resolvedBaseName
    })
  };
}
