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
let resolvedBaseCode = "B01";
let resolvedBaseName = "仙台Base";

if (typeof document !== "undefined") {
  document.addEventListener("DOMContentLoaded", () => {
    initGasClient();
    initUserSettings();
    initBaseCodeHandlers();
    initItemCodeHandlers();
    initFixedItemsList();
    initVendorSignaturePad();
    initSummaryDates();
    updateWeightDisplay();
    updateSignatureDisplay();
  });
}

// 1. GAS クライアント初期化 & マスタ同期 (カテゴリ対応)
function initGasClient() {
  gasClient = new GasClient();
  updateNetworkStatus();

  const userSettings = TerminalStorage.getUserSettings();
  const catOptions = { categories: userSettings.selectedMaterialCategories || [] };

  gasClient.fetchMasters(catOptions).then(res => {
    if (res && res.success) {
      if (Array.isArray(res.bases) && res.bases.length > 0) window.ACTIVE_BASES = res.bases;
      if (Array.isArray(res.items) && res.items.length > 0) window.ACTIVE_ITEMS = res.items;
      if (Array.isArray(res.fixedItems) && res.fixedItems.length > 0) {
        window.ACTIVE_FIXED_ITEMS = res.fixedItems;
        initFixedItemsList();
      }
      if (Array.isArray(res.categories) && res.categories.length > 0) {
        window.AVAILABLE_CATEGORIES = res.categories;
      }
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
  } else {
    // 前回値フォールバック
    initPreviousInputs();
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
    baseCodeGroup.style.display = "none"; // 社員解決時は拠点コード入力を非表示にして誤入力を防ぐ
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

      // 伝票入力へ即時反映
      applyEmployeeLockToForm();

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

  const parsedQty = QuantityEngine.parseQuantity(rawQty);
  if (!parsedQty.valid) {
    showAppModal({ title: "数量エラー", message: parsedQty.error });
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

function stepCodeItemQty(index, delta) {
  const item = currentCodeItems[index];
  if (!item || item.quantityType !== "NUMBER") return;

  const cur = typeof item.quantityValue === "number" ? item.quantityValue : 1;
  const next = Math.max(1, cur + delta);

  item.quantityValue = next;
  item.quantityInput = String(next);

  renderCodeItemsTable();
  updateWeightDisplay();
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

    let qtyHtml = "";
    if (item.quantityType === "NUMBER") {
      qtyHtml = `
        <div class="qty-step-wrapper">
          <button type="button" class="btn-qty-step" onclick="stepCodeItemQty(${idx}, -1)" aria-label="1減らす">－</button>
          <span class="qty-step-val">${item.quantityValue}</span>
          <button type="button" class="btn-qty-step" onclick="stepCodeItemQty(${idx}, 1)" aria-label="1増やす">＋</button>
        </div>
      `;
    } else {
      qtyHtml = `<span class="badge-set">一式</span>`;
    }

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
      <td><strong>${fi.itemName}</strong></td>
      <td>
        <input type="text" class="form-input" style="padding:0.4rem 0.6rem;"
          placeholder="数量 (例: 2, 一式)" id="fixed-qty-${fi.fixedItemId}">
      </td>
    `;
    tbody.appendChild(tr);
  });
}

function collectFixedItems() {
  const allFixed = (window.ACTIVE_FIXED_ITEMS && window.ACTIVE_FIXED_ITEMS.length > 0)
    ? window.ACTIVE_FIXED_ITEMS
    : (window.TEST_FIXTURE_FIXED_ITEMS || []);
  const result = [];

  allFixed.forEach(fi => {
    const input = document.getElementById(`fixed-qty-${fi.fixedItemId}`);
    if (input && input.value.trim()) {
      const parsed = QuantityEngine.parseQuantity(input.value.trim());
      if (parsed.valid) {
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

// 8. その他自由品目セクション
function addOtherItemFromForm() {
  const nameInput = document.getElementById("other-name-input");
  const qtyInput = document.getElementById("other-qty-input");

  const name = nameInput.value.trim();
  const rawQty = qtyInput.value.trim();

  if (!name) {
    showAppModal({ title: "入力エラー", message: "品名を入力してください。" });
    return;
  }

  const parsedQty = QuantityEngine.parseQuantity(rawQty);
  if (!parsedQty.valid) {
    showAppModal({ title: "数量エラー", message: parsedQty.error });
    return;
  }

  currentOtherItems.push({
    itemName: name,
    quantityInput: parsedQty.input,
    quantityValue: parsedQty.value,
    quantityType: parsedQty.type
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
  const baseCodeVal = resolvedBaseCode || document.getElementById("base-code-input").value.trim();
  const baseNameVal = resolvedBaseName || document.getElementById("base-name-display").value.trim();
  const staffNameVal = resolvedEmployeeName || document.getElementById("staff-name-input").value.trim();
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

  const baseCodeVal = resolvedBaseCode || document.getElementById("base-code-input").value.trim();
  const baseNameVal = resolvedBaseName || document.getElementById("base-name-display").value.trim();
  const staffNameVal = resolvedEmployeeName || document.getElementById("staff-name-input").value.trim();
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
    lastFinalizedSlipData = slipRecord;
    TerminalStorage.clearLocalDraft();

    // 完了モーダル表示
    openCompletionModal();
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

function closeCompletionModalAndReset() {
  const modal = document.getElementById("completion-modal");
  if (modal) modal.style.display = "none";
  document.body.classList.remove("modal-open");

  // 入力フォームの完全初期化 (設定された社員/Baseは保持)
  resetInputFormAfterSubmission();
}

function resetInputFormAfterSubmission() {
  currentCodeItems = [];
  currentOtherItems = [];
  confirmedSignatureData = null;
  pendingFinalizeSlip = null;

  const vendorInput = document.getElementById("vendor-name-input");
  if (vendorInput) vendorInput.value = "";

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

function handleCompletionPrint() {
  if (lastFinalizedSlipData) {
    printSlipFromRecord(lastFinalizedSlipData);
  }
  closeCompletionModalAndReset();
}

// 12. 下書き一時保存 (Central DB DRAFT & フォームリセット)
function saveTemporaryDraft() {
  const baseCodeVal = resolvedBaseCode || document.getElementById("base-code-input").value.trim();
  const baseNameVal = resolvedBaseName || document.getElementById("base-name-display").value.trim();
  const staffNameVal = resolvedEmployeeName || document.getElementById("staff-name-input").value.trim();
  const vendorNameVal = document.getElementById("vendor-name-input").value.trim();

  const draftData = {
    baseCode: baseCodeVal,
    baseName: baseNameVal,
    staffName: staffNameVal,
    vendorName: vendorNameVal,
    codeItems: [...currentCodeItems],
    fixedItems: collectFixedItems(),
    otherItems: [...currentOtherItems],
    savedAt: new Date().toISOString()
  };

  gasClient.saveDraft(draftData).then(res => {
    if (res && res.success) {
      TerminalStorage.clearLocalDraft();
      showAppModal({
        title: "一時保存",
        message: "下書きを中央DBに一時保存しました。\n処分履歴画面からいつでも再開できます。"
      });
      // 一時保存後フォームクリア
      resetInputFormAfterSubmission();
    } else {
      showAppModal({
        title: "一時保存エラー",
        message: "中央DBへの一時保存に失敗しました。"
      });
    }
  }).catch(() => {
    // オフライン時のローカルバックアップ
    TerminalStorage.saveLocalDraft(draftData);
    showAppModal({
      title: "一時保存",
      message: "通信不可のため、端末ローカルに一時保存しました。"
    });
    resetInputFormAfterSubmission();
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
      showAppModal({ title: "下書き再開", message: `伝票 (ID: ${s.slipId}) の入力を再開しました。` });
    }
  });
}

// 13. 中央履歴一覧 (Central DB Source of Truth & BaseCode 共有)
function renderHistoryTable() {
  const tbody = document.getElementById("history-table-tbody");
  if (!tbody) return;

  const baseCode = resolvedBaseCode || document.getElementById("base-code-input").value.trim() || "B01";

  tbody.innerHTML = `<tr><td colspan="8" style="text-align:center; color:var(--color-text-muted); padding:1.5rem;">中央DBより履歴を取得中...</td></tr>`;

  // 確定伝票の取得
  gasClient.fetchHistory({ baseCode: baseCode, status: "FINAL" }).then(res => {
    centralHistorySlips = (res && res.success && Array.isArray(res.slips)) ? res.slips : [];
    renderHistoryRows(tbody, centralHistorySlips);
  }).catch(err => {
    console.error("[app.js] fetchHistory error:", err);
    tbody.innerHTML = `<tr><td colspan="8" style="text-align:center; color:var(--color-danger); padding:1.5rem;">履歴の取得に失敗しました。</td></tr>`;
  });

  // 一時保存下書きの取得
  gasClient.fetchHistory({ baseCode: baseCode, status: "DRAFT" }).then(res => {
    centralDraftSlips = (res && res.success && Array.isArray(res.slips)) ? res.slips : [];
    renderDraftSection(centralDraftSlips);
  }).catch(() => {});
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
  drafts.forEach(d => {
    const item = document.createElement("div");
    item.style.cssText = "display:flex; justify-content:space-between; align-items:center; padding:0.4rem 0; border-bottom:1px solid var(--color-border); font-size:0.85rem;";
    item.innerHTML = `
      <div>
        <strong>${d.slipId}</strong>
        <span style="color:var(--color-text-muted); margin-left:0.5rem;">${(d.date || "").slice(0, 10)}</span>
        <span style="margin-left:0.5rem;">業者: ${d.vendorName || "未入力"}</span>
      </div>
      <button type="button" class="btn btn-secondary btn-sm" onclick="resumeDraftSlip('${d.slipId}')">再開</button>
    `;
    list.appendChild(item);
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
        <div class="history-row-top">
          <span class="hist-date">${dateStr}</span>
          <span class="hist-base">${s.baseName}</span>
          <span class="hist-vendor">${s.vendorName}</span>
        </div>
        <div class="history-row-bottom">
          <span class="hist-staff">担当: ${s.staffName}</span>
          <div class="hist-actions">
            ${sigBadge}
            <button type="button" class="btn btn-secondary btn-sm" onclick="printSlipFromHistory(${idx})">印刷</button>
          </div>
        </div>
      </td>
      <td class="hist-desktop-col"><strong>${s.slipId}</strong></td>
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
    gasClient.fetchSlip(s.slipId).then(res => {
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
  if (slipIdEl) slipIdEl.textContent = s.slipId;

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
  const baseCode = resolvedBaseCode || document.getElementById("base-code-input").value.trim() || "B01";
  const fromDate = document.getElementById("summary-from-date") ? document.getElementById("summary-from-date").value : "";
  const toDate = document.getElementById("summary-to-date") ? document.getElementById("summary-to-date").value : "";

  gasClient.fetchSummary({ baseCode, fromDate, toDate }).then(res => {
    if (res && res.success) {
      currentSummaryData = res;
      updateSummaryUi(res);
    }
  }).catch(err => {
    console.error("[app.js] fetchSummary error:", err);
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
    tbody.innerHTML = `<tr><td colspan="4" style="text-align:center; color:var(--color-text-muted); padding:1rem;">指定期間の確定集計対象品目はありません。</td></tr>`;
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
    showAppModal({ title: "お知らせ", message: "出力可能なスクラップ一覧データがありません。" });
    return;
  }

  const sortedItems = sortScrapItems(currentSummaryData.items, scrapSortState.column, scrapSortState.order);
  const csvContent = generateScrapCsvContent(sortedItems);

  const fromDate = (document.getElementById("summary-from-date") ? document.getElementById("summary-from-date").value : "").replace(/-/g, "");
  const toDate = (document.getElementById("summary-to-date") ? document.getElementById("summary-to-date").value : "").replace(/-/g, "");
  const filename = `ScrapManagement_スクラップ一覧_${resolvedBaseCode}_${fromDate}-${toDate}.csv`;

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

  // マスタ再取得
  gasClient.fetchMasters({ categories: checked }).then(res => {
    if (res && res.success && Array.isArray(res.items)) {
      window.ACTIVE_ITEMS = res.items;
      showAppModal({ title: "設定保存", message: "使用資材カテゴリを更新しました。" });
    }
  });
}

function saveFixedItemPreferences() {
  const checked = Array.from(document.querySelectorAll('input[name="fixed-item-pref"]:checked')).map(el => el.value);
  TerminalStorage.saveUserSettings({ selectedFixedItemCodes: checked });
  initFixedItemsList();
  showAppModal({ title: "設定保存", message: "使用定型品設定を更新しました。" });
}

// 18. タブ切り替え (Lazy Loading 対応)
function switchTab(tabName) {
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
    stepCodeItemQty,
    resetInputFormAfterSubmission,
    verifyAndSaveEmployee,
    applySummaryPeriodFilter
  };
}
