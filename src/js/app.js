// アプリケーション統合コントローラー (app.js)

let currentCodeItems = [];
let currentOtherItems = [];
let fixedItemsState = {};
let vendorPad = null;
let gasClient = null;
let pendingFinalizeSlip = null;
let confirmedSignatureData = null;
let genericModalCallback = null;
let lastFinalizedSlipIndex = 0;

if (typeof document !== "undefined") {
  document.addEventListener("DOMContentLoaded", () => {
    initGasClient();
    initPreviousInputs();
    initBaseCodeHandlers();
    initItemCodeHandlers();
    initFixedItemsList();
    initVendorSignaturePad();
    loadTemporaryDraft();
    renderHistoryTable();
    updateWeightDisplay();
    updateSignatureDisplay();
  });
}

// 1. GAS クライアント初期化 & マスタ同期
function initGasClient() {
  gasClient = new GasClient();
  updateNetworkStatus();

  // STAGING または MOCK でマスタデータ取得
  gasClient.fetchMasters().then(res => {
    if (res && res.success) {
      if (Array.isArray(res.bases) && res.bases.length > 0) window.ACTIVE_BASES = res.bases;
      if (Array.isArray(res.items) && res.items.length > 0) window.ACTIVE_ITEMS = res.items;
      if (Array.isArray(res.fixedItems) && res.fixedItems.length > 0) {
        window.ACTIVE_FIXED_ITEMS = res.fixedItems;
        initFixedItemsList(); // 定型品テーブル再展開
      }
    } else if (gasClient.getMode() === "GAS_STAGING") {
      console.warn("[app.js] STAGING Backend masters unavailable:", res ? res.error : "Unknown");
    }
  });
}

function updateNetworkStatus() {
  const mockBadge = document.getElementById("mock-warning-badge");
  if (!mockBadge) return;
  // MOCK の場合のみ警告表示。GAS_STAGING 正常接続時は内部情報を一切表示しない
  if (gasClient && gasClient.getMode() === "MOCK") {
    mockBadge.style.display = "inline-flex";
  } else {
    mockBadge.style.display = "none";
  }
}

// 2. 端末前回値復元
function initPreviousInputs() {
  const prev = TerminalStorage.getPreviousInput();
  if (prev.baseCode) {
    document.getElementById("base-code-input").value = prev.baseCode;
    const base = BaseService.findExactBase(prev.baseCode);
    document.getElementById("base-name-display").value = base ? base.baseName : prev.baseName || "";
  }
  if (prev.staffName) {
    document.getElementById("staff-name-input").value = prev.staffName;
  }
  if (prev.vendorName) {
    document.getElementById("vendor-name-input").value = prev.vendorName;
  }
}

// 3. BaseCode ハンドラ (iPhone日本語IME対応・半角大文字・リアルタイム候補・完全一致表示)
function initBaseCodeHandlers() {
  const codeInput = document.getElementById("base-code-input");
  const nameDisplay = document.getElementById("base-name-display");
  const autoBox = document.getElementById("base-code-autocomplete");

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

    // 完全一致チェック
    const exact = BaseService.findExactBase(normalized);
    if (exact) {
      nameDisplay.value = exact.baseName;
      TerminalStorage.savePreviousInput({ baseCode: exact.baseCode, baseName: exact.baseName });
    } else {
      nameDisplay.value = "";
    }

    // 候補表示
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

  codeInput.addEventListener("compositionstart", () => {
    isComposing = true;
  });

  codeInput.addEventListener("compositionend", () => {
    isComposing = false;
    handleBaseCodeChange(true);
  });

  codeInput.addEventListener("input", e => {
    if (e.isComposing || isComposing) {
      return;
    }
    handleBaseCodeChange(true);
  });

  document.addEventListener("click", e => {
    if (!codeInput.contains(e.target) && !autoBox.contains(e.target)) {
      autoBox.style.display = "none";
    }
  });
}

// 4. ItemCode 検索ハンドラ (iPhone日本語IME文字重複根本防止)
function initItemCodeHandlers() {
  const codeInput = document.getElementById("item-code-input");
  const nameDisplay = document.getElementById("item-name-display");
  const autoBox = document.getElementById("item-code-autocomplete");

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

// 5. 資材明細行の追加・削除
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

function renderCodeItemsTable() {
  const tbody = document.getElementById("code-items-tbody");
  tbody.innerHTML = "";

  currentCodeItems.forEach((item, idx) => {
    const uw = parseFloat(item.unitWeightKg);
    const hasWeight = !isNaN(uw) && uw > 0 && item.quantityType === "NUMBER";
    const weightDisplayHtml = hasWeight
      ? `${(item.quantityValue * uw).toFixed(1)}kg`
      : `<span class="badge-unregistered">-</span>`;

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td class="col-code"><strong>${item.itemCode}</strong></td>
      <td class="col-name">${item.itemName}</td>
      <td class="col-qty"><strong>${item.quantityInput}</strong></td>
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

// 6. スマホ専用 推定重量表示の更新 (kg表示を主値としton括弧表示を削除)
function updateWeightDisplay() {
  const weightSummary = WeightEngine.calculateEstimatedWeight(currentCodeItems);
  document.getElementById("weight-display-text").textContent =
    `推定積載重量: ${weightSummary.formattedKg}`;
  document.getElementById("weight-meta-counts").textContent =
    `重量計算対象: ${weightSummary.registeredCount}品目 / 重量未登録: ${weightSummary.unregisteredCount}品目`;
}

// 7. 定型品セクション (説明・状態列を排除)
function initFixedItemsList() {
  const tbody = document.getElementById("fixed-items-tbody");
  tbody.innerHTML = "";
  const fixedList = (window.ACTIVE_FIXED_ITEMS && window.ACTIVE_FIXED_ITEMS.length > 0)
    ? window.ACTIVE_FIXED_ITEMS
    : (window.TEST_FIXTURE_FIXED_ITEMS || []);

  fixedList.forEach(fi => {
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
  const fixedList = (window.ACTIVE_FIXED_ITEMS && window.ACTIVE_FIXED_ITEMS.length > 0)
    ? window.ACTIVE_FIXED_ITEMS
    : (window.TEST_FIXTURE_FIXED_ITEMS || []);
  const result = [];

  fixedList.forEach(fi => {
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

// 10. 汎用アプリ内モーダル (browser alert / confirm 代替)
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

// 11. 伝票完了処理 (確定と印刷を完全分離 & 完了画面の極小化)
function handleFinalizeButton() {
  const headerData = {
    baseCode: document.getElementById("base-code-input").value.trim(),
    baseName: document.getElementById("base-name-display").value.trim(),
    staffName: document.getElementById("staff-name-input").value.trim(),
    vendorName: document.getElementById("vendor-name-input").value.trim()
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

  // 業者署名の確認
  const sigVal = SignatureHelper.validateVendorSignature(confirmedSignatureData);

  if (!sigVal.hasSignature) {
    // 署名なし確認モーダルを開く
    document.getElementById("no-signature-modal").style.display = "flex";
    document.body.classList.add("modal-open");
    return;
  }

  // 署名あり確定
  executeFinalize(false, sigVal.dataUrl);
}

function closeNoSignatureModal() {
  document.getElementById("no-signature-modal").style.display = "none";
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

  const headerData = {
    baseCode: document.getElementById("base-code-input").value.trim(),
    baseName: document.getElementById("base-name-display").value.trim(),
    staffName: document.getElementById("staff-name-input").value.trim(),
    vendorName: document.getElementById("vendor-name-input").value.trim()
  };

  // 端末前回値保存
  TerminalStorage.savePreviousInput(headerData);

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
      baseCode: headerData.baseCode,
      baseName: headerData.baseName,
      staffName: headerData.staffName,
      vendorName: headerData.vendorName,
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

    // 成功時は保留中伝票をクリア
    pendingFinalizeSlip = null;

    // 端末履歴キャッシュ更新
    saveSlipRecordToLocalCache(slipRecord);
    TerminalStorage.clearLocalDraft();

    // フォームリセット
    currentCodeItems = [];
    currentOtherItems = [];
    confirmedSignatureData = null;
    renderCodeItemsTable();
    renderOtherItemsTable();
    updateSignatureDisplay();
    if (vendorPad) vendorPad.clear();
    updateWeightDisplay();
    renderHistoryTable();

    // 完了モーダル表示 (極小・内部情報非表示)
    lastFinalizedSlipIndex = 0;
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

function closeCompletionModal() {
  const modal = document.getElementById("completion-modal");
  if (modal) modal.style.display = "none";
  document.body.classList.remove("modal-open");
}

function handleCompletionPrint() {
  closeCompletionModal();
  printSlipFromHistory(lastFinalizedSlipIndex);
}

// 12. 下書き一時保存 & 復元
function saveTemporaryDraft() {
  const draftData = {
    baseCode: document.getElementById("base-code-input").value.trim(),
    baseName: document.getElementById("base-name-display").value.trim(),
    staffName: document.getElementById("staff-name-input").value.trim(),
    vendorName: document.getElementById("vendor-name-input").value.trim(),
    codeItems: currentCodeItems,
    otherItems: currentOtherItems,
    savedAt: new Date().toISOString()
  };

  TerminalStorage.saveLocalDraft(draftData);
  TerminalStorage.savePreviousInput(draftData);

  gasClient.saveDraft(draftData).then(res => {
    showAppModal({ title: "一時保存", message: "下書きを一時保存しました。" });
  }).catch(() => {
    showAppModal({ title: "一時保存", message: "下書きを端末に一時保存しました。" });
  });
}

function loadTemporaryDraft() {
  const draft = TerminalStorage.getLocalDraft();
  if (!draft) return;

  if (Array.isArray(draft.codeItems) && draft.codeItems.length > 0) {
    currentCodeItems = draft.codeItems;
    renderCodeItemsTable();
  }
  if (Array.isArray(draft.otherItems) && draft.otherItems.length > 0) {
    currentOtherItems = draft.otherItems;
    renderOtherItemsTable();
  }
}

// 13. 履歴一覧 & PC からの A4 1枚印刷トリガー
function saveSlipRecordToLocalCache(record) {
  try {
    const raw = localStorage.getItem("scrap_confirmed_slips");
    const list = raw ? JSON.parse(raw) : [];
    list.unshift(record);
    localStorage.setItem("scrap_confirmed_slips", JSON.stringify(list.slice(0, 100)));
  } catch (e) {}
}

function getLocalConfirmedSlips() {
  try {
    const raw = localStorage.getItem("scrap_confirmed_slips");
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    return [];
  }
}

function renderHistoryTable() {
  const tbody = document.getElementById("history-table-tbody");
  if (!tbody) return;

  const slips = getLocalConfirmedSlips();
  tbody.innerHTML = "";

  if (slips.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8" style="text-align:center; color:var(--color-text-muted); padding:1.5rem;">確定された処分伝票はありません。</td></tr>`;
    return;
  }

  slips.forEach((s, idx) => {
    const dateStr = s.createdAt ? s.createdAt.slice(0, 10) : "--";
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
  const slips = getLocalConfirmedSlips();
  const s = slips[index];
  if (!s) return;

  // A4 伝票コンテナへ流し込み
  document.getElementById("print-slip-id").textContent = s.slipId;
  document.getElementById("print-date").textContent = s.createdAt ? s.createdAt.slice(0, 10) : "";
  document.getElementById("print-base-name").textContent = s.baseName;
  document.getElementById("print-info-base").textContent = s.baseName;
  document.getElementById("print-info-staff").textContent = s.staffName;
  document.getElementById("print-info-vendor").textContent = s.vendorName;

  // 明細テーブル (重量カラム非表示)
  const tbody = document.getElementById("print-items-tbody");
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

  // 署名欄
  const sigImg = document.getElementById("print-vendor-signature-img");
  const noSigPlaceholder = document.getElementById("print-no-signature-placeholder");

  if (s.signatureStatus === "DIGITAL" && s.vendorSignatureImage) {
    sigImg.src = s.vendorSignatureImage;
    sigImg.style.display = "block";
    noSigPlaceholder.style.display = "none";
  } else {
    sigImg.style.display = "none";
    noSigPlaceholder.style.display = "block";
  }

  // 印刷ダイアログ
  setTimeout(() => {
    window.print();
  }, 200);
}

// 14. CSV エクスポート (棚卸集計対象: CODE かつ NUMBER かつ FINAL のみ)
function exportHistoryCsv() {
  const slips = getLocalConfirmedSlips();
  if (slips.length === 0) {
    showAppModal({ title: "お知らせ", message: "エクスポート可能な確定伝票がありません。" });
    return;
  }

  let csvContent = "\uFEFF"; // Excel BOM
  csvContent += "伝票番号,発行日,Base名,担当者,業者名,資材コード,品名,数量,数量区分,署名区分\n";

  slips.forEach(s => {
    (s.codeItems || []).forEach(it => {
      // 棚卸集計対象: Type = CODE, QuantityType = NUMBER, Status = FINAL のみ (SET・定型品・その他は数値集計から除外)
      if (s.status === "FINAL" && it.quantityType === "NUMBER" && typeof it.quantityValue === "number") {
        csvContent += `\"${s.slipId}\",\"${s.createdAt.slice(0,10)}\",\"${s.baseName}\",\"${s.staffName}\",\"${s.vendorName}\",\"${it.itemCode}\",\"${it.itemName}\",${it.quantityValue},\"${it.quantityType}\",\"${s.signatureStatus}\"\n`;
      }
    });
  });

  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `Takamiya_ScrapInventory_${new Date().toISOString().slice(0,10)}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

// 15. タブ切り替え (通常利用者向け 3機能: 伝票入力 / 処分履歴 / 集計)
function switchTab(tabName) {
  ["create", "history", "summary"].forEach(t => {
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
}

let scrapSortState = {
  column: "qty",
  order: "desc"
};

function toggleScrapSort(col) {
  if (scrapSortState.column === col) {
    scrapSortState.order = scrapSortState.order === "asc" ? "desc" : "asc";
  } else {
    scrapSortState.column = col;
    scrapSortState.order = (col === "qty" || col === "weight") ? "desc" : "asc";
  }
  renderSummaryView();
}

function getAggregatedScrapItems() {
  const slips = getLocalConfirmedSlips();
  let totalWeightKg = 0;
  let totalItemsCount = 0;
  const itemMap = {};

  slips.forEach(s => {
    if (s.status === "FINAL") {
      (s.codeItems || []).forEach(it => {
        if (it.quantityType === "NUMBER" && typeof it.quantityValue === "number") {
          totalItemsCount++;
          const code = it.itemCode || "UNKNOWN";
          const name = it.itemName || "";
          const key = `${code}_${name}`;
          if (!itemMap[key]) {
            itemMap[key] = {
              itemCode: code,
              itemName: name,
              totalQty: 0,
              totalWeightKg: 0,
              hasWeight: false
            };
          }
          itemMap[key].totalQty += it.quantityValue;
          const uw = parseFloat(it.unitWeightKg);
          if (!isNaN(uw) && uw > 0) {
            const wt = it.quantityValue * uw;
            itemMap[key].totalWeightKg += wt;
            itemMap[key].hasWeight = true;
            totalWeightKg += wt;
          }
        }
      });
    }
  });

  return {
    items: Object.values(itemMap),
    totalSlipsCount: slips.length,
    totalWeightKg: totalWeightKg,
    totalItemsCount: totalItemsCount
  };
}

function sortScrapItems(items, column, order) {
  const list = items.map((it, idx) => ({ ...it, _idx: idx }));

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
  // Formula injection check: if string starts with =, +, -, @, \t, \r, prepend '
  if (/^[=+\-@\t\r]/.test(str)) {
    str = "'" + str;
  }
  // Standard CSV quoting and escaping: escape " as ""
  if (str.includes('"') || str.includes(',') || str.includes('\n') || str.includes('\r')) {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}

function generateScrapCsvContent(sortedItems) {
  let csv = "\uFEFF"; // UTF-8 BOM
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
  const data = getAggregatedScrapItems();
  const sortedItems = sortScrapItems(data.items, scrapSortState.column, scrapSortState.order);

  if (sortedItems.length === 0) {
    showAppModal({ title: "お知らせ", message: "出力可能なスクラップ一覧データがありません。" });
    return;
  }

  const csvContent = generateScrapCsvContent(sortedItems);

  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  const filename = `ScrapManagement_スクラップ一覧_${yyyy}${mm}${dd}.csv`;

  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// 16. 集計画面レンダリング (Summary View)
function renderSummaryView() {
  const data = getAggregatedScrapItems();

  // サマリー数値反映
  const totalSlipsEl = document.getElementById("summary-total-slips");
  const totalWeightEl = document.getElementById("summary-total-weight");
  const totalItemsEl = document.getElementById("summary-total-items");

  if (totalSlipsEl) totalSlipsEl.textContent = data.totalSlipsCount;
  if (totalWeightEl) {
    const tVal = (data.totalWeightKg / 1000).toFixed(2);
    const kgVal = Math.round(data.totalWeightKg).toLocaleString();
    totalWeightEl.textContent = `${tVal} t (${kgVal} kg)`;
  }
  if (totalItemsEl) totalItemsEl.textContent = data.totalItemsCount;

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

  // スクラップ一覧テーブル
  const tbody = document.getElementById("summary-items-tbody");
  if (!tbody) return;
  tbody.innerHTML = "";

  const sortedItems = sortScrapItems(data.items, scrapSortState.column, scrapSortState.order);
  if (sortedItems.length === 0) {
    tbody.innerHTML = `<tr><td colspan="4" style="text-align:center; color:var(--color-text-muted); padding:1rem;">確定済みの集計対象品目はありません。</td></tr>`;
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

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    scrapSortState,
    toggleScrapSort,
    getAggregatedScrapItems,
    sortScrapItems,
    sanitizeCsvCell,
    generateScrapCsvContent
  };
}
