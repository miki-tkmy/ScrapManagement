// test-operation-enhancement-01-human-recheck-fix01.js
// Focused Automated Test Suite for ScrapManagement OPERATION ENHANCEMENT 01 HUMAN RECHECK FIX 01
// Testing T1 through T14 per Section 23 specifications

const fs = require("fs");
const path = require("path");
const assert = require("assert");
const vm = require("vm");

console.log("================================================================================");
console.log("ScrapManagement - OPERATION ENHANCEMENT 01 HUMAN RECHECK FIX 01 TESTS (T1..T14)");
console.log("================================================================================");

let testsPassed = 0;
let testsFailed = 0;

async function runTest(id, desc, fn) {
  try {
    await fn();
    console.log(`[PASS] ${id}: ${desc}`);
    testsPassed++;
  } catch (err) {
    console.error(`[FAIL] ${id}: ${desc}`);
    console.error(`       Error: ${err.message}`);
    if (err.stack) {
      console.error("       " + err.stack.split("\n").slice(1, 4).join("\n       "));
    }
    testsFailed++;
  }
}

// Load source files
const repoRoot = path.join(__dirname, "..");
const indexHtml = fs.readFileSync(path.join(repoRoot, "index.html"), "utf8");
const styleCss = fs.readFileSync(path.join(repoRoot, "src", "css", "style.css"), "utf8");
const appJs = fs.readFileSync(path.join(repoRoot, "src", "js", "app.js"), "utf8");
const gasClientJs = fs.readFileSync(path.join(repoRoot, "src", "js", "gasClient.js"), "utf8");

async function main() {
  // -----------------------------------------------------------------------------
  // T1: Startup background validation always calls server fetchState once
  // -----------------------------------------------------------------------------
  await runTest("T1", "Startup background validation always calls server fetchState once, no short-circuit on fresh snapshot", async () => {
    // 1. Verify code structure in app.js: no early return before gasClient.fetchState
    const checkFnCode = appJs.match(/function checkMasterRevisionAndUpdate\(\)\s*\{[\s\S]*?\n\}/)[0];
    assert(!checkFnCode.includes("isStateSnapshotFresh"), "checkMasterRevisionAndUpdate must NOT short-circuit using isStateSnapshotFresh");
    assert(checkFnCode.includes("gasClient.fetchState(baseCode)"), "Must invoke gasClient.fetchState(baseCode)");

    // 2. Behavioral verification in VM
    let fetchStateCalls = 0;
    const mockGasClient = {
      fetchState: async (base) => {
        fetchStateCalls++;
        return { success: true, masterRevision: 5 };
      },
      fetchMasters: async () => ({ success: true, fixedItems: [] })
    };

    const mockTerminalStorage = {
      getMasterCache: () => ({ masterRevision: 5, fixedItems: [] }),
      getStateSnapshot: () => ({ masterRevision: 5 }),
      isStateSnapshotFresh: () => true, // snapshot is fresh
      saveStateSnapshot: () => {}
    };

    const ctx = {
      console,
      gasClient: mockGasClient,
      TerminalStorage: mockTerminalStorage,
      resolvedBaseCode: "A2",
      hideMasterStatusBar: () => {},
      showMasterStatusBar: () => {},
      fetchAndApplyMasters: () => {}
    };

    vm.createContext(ctx);
    vm.runInContext(checkFnCode, ctx);
    vm.runInContext("checkMasterRevisionAndUpdate();", ctx);

    // Wait microtasks
    await new Promise(r => setTimeout(r, 20));
    assert.strictEqual(fetchStateCalls, 1, "fetchState must be called exactly once despite fresh local snapshot");
  });

  // -----------------------------------------------------------------------------
  // T2: server masterRevision > cache revision -> fetchMasters
  // -----------------------------------------------------------------------------
  await runTest("T2", "server masterRevision > cache revision -> fetchMasters is invoked", async () => {
    const checkFnCode = appJs.match(/function checkMasterRevisionAndUpdate\(\)\s*\{[\s\S]*?\n\}/)[0];

    let fetchMastersCalledWith = null;
    const mockGasClient = {
      fetchState: async () => ({ success: true, masterRevision: 5 })
    };

    const mockTerminalStorage = {
      getMasterCache: () => ({ masterRevision: 4, fixedItems: [] }), // cache revision 4
      saveStateSnapshot: () => {}
    };

    const ctx = {
      console,
      gasClient: mockGasClient,
      TerminalStorage: mockTerminalStorage,
      resolvedBaseCode: "A2",
      showMasterStatusBar: () => {},
      hideMasterStatusBar: () => {},
      fetchAndApplyMasters: (rev) => { fetchMastersCalledWith = rev; }
    };

    vm.createContext(ctx);
    vm.runInContext(checkFnCode, ctx);
    vm.runInContext("checkMasterRevisionAndUpdate();", ctx);

    await new Promise(r => setTimeout(r, 20));
    assert.strictEqual(fetchMastersCalledWith, 5, "fetchAndApplyMasters must be called with server revision 5");
  });

  // -----------------------------------------------------------------------------
  // T3: 5 fixed items applied to ACTIVE_FIXED_ITEMS
  // -----------------------------------------------------------------------------
  await runTest("T3", "5 fixed items applied to ACTIVE_FIXED_ITEMS and initFixedItemsList / renderSettingsView called", async () => {
    const fetchApplyCode = appJs.match(/function fetchAndApplyMasters[\s\S]*?\n\}/)[0];
    assert(fetchApplyCode.includes("renderSettingsView();"), "fetchAndApplyMasters must call renderSettingsView()");

    const serverFixedItems = [
      { fixedItemId: "FIX01", itemName: "スクラップボックス" },
      { fixedItemId: "FIX02", itemName: "小物カゴ" },
      { fixedItemId: "FIX03", itemName: "完全不良品" },
      { fixedItemId: "FIX04", itemName: "物品違い品" },
      { fixedItemId: "FIX05", itemName: "簿外品" }
    ];

    let initFixedCalled = false;
    let renderSettingsCalled = false;

    const ctx = {
      console,
      window: {},
      gasClient: {
        fetchMasters: async () => ({ success: true, fixedItems: serverFixedItems, bases: [], items: [], categories: [] }),
        getMode: () => "PRODUCTION"
      },
      TerminalStorage: {
        getMasterCache: () => null,
        getUserSettings: () => ({}),
        saveMasterCache: () => {}
      },
      applyMaterialCategoryFilter: (items) => items,
      hideMasterLoadingOverlay: () => {},
      showMasterStatusBar: () => {},
      hideMasterStatusBar: () => {},
      initFixedItemsList: () => { initFixedCalled = true; },
      renderSettingsView: () => { renderSettingsCalled = true; }
    };

    vm.createContext(ctx);
    vm.runInContext(fetchApplyCode, ctx);
    vm.runInContext("fetchAndApplyMasters(5);", ctx);

    await new Promise(r => setTimeout(r, 20));
    assert.strictEqual(ctx.window.ACTIVE_FIXED_ITEMS.length, 5, "ACTIVE_FIXED_ITEMS must contain 5 items");
    assert(ctx.window.ACTIVE_FIXED_ITEMS.some(it => it.itemName === "物品違い品"), "Contains 物品違い品");
    assert(ctx.window.ACTIVE_FIXED_ITEMS.some(it => it.itemName === "簿外品"), "Contains 簿外品");
    assert(initFixedCalled, "initFixedItemsList must be called");
    assert(renderSettingsCalled, "renderSettingsView must be called");
  });

  // -----------------------------------------------------------------------------
  // T4: settings fixed-item UI shows 5 items
  // -----------------------------------------------------------------------------
  await runTest("T4", "settings fixed-item UI renders all 5 items", () => {
    const fixedItems = [
      { fixedItemId: "FIX01", itemName: "スクラップボックス" },
      { fixedItemId: "FIX02", itemName: "小物カゴ" },
      { fixedItemId: "FIX03", itemName: "完全不良品" },
      { fixedItemId: "FIX04", itemName: "物品違い品" },
      { fixedItemId: "FIX05", itemName: "簿外品" }
    ];

    const renderedLabels = [];
    const mockFixedContainer = {
      innerHTML: "",
      appendChild: (el) => { renderedLabels.push(el); }
    };

    const ctx = {
      console,
      window: { ACTIVE_FIXED_ITEMS: fixedItems },
      document: {
        getElementById: (id) => {
          if (id === "setting-fixed-items-container") return mockFixedContainer;
          return null;
        },
        createElement: (tag) => ({
          tagName: tag,
          className: "",
          innerHTML: "",
          style: {}
        })
      },
      resolvedEmployeeNo: "EMP-001",
      TerminalStorage: {
        getUserSettings: () => ({}),
        getEmployeePreferences: () => ({
          exists: true,
          fixedItemIds: ["FIX01", "FIX02", "FIX03"] // Employee has 3 checked
        })
      }
    };

    const renderSettingsCode = appJs.match(/function renderSettingsView\(\)\s*\{[\s\S]*?\n\}/)[0];
    vm.createContext(ctx);
    vm.runInContext(renderSettingsCode, ctx);
    vm.runInContext("renderSettingsView();", ctx);

    assert.strictEqual(renderedLabels.length, 5, "Settings UI must render all 5 items");
    const htmls = renderedLabels.map(l => l.innerHTML);
    assert(htmls.some(h => h.includes("物品違い品")), "Settings UI contains 物品違い品");
    assert(htmls.some(h => h.includes("簿外品")), "Settings UI contains 簿外品");
    // Verify existing 3 are checked, new 2 are unchecked
    const fix01 = htmls.find(h => h.includes("FIX01"));
    assert(fix01.includes("checked"), "FIX01 is checked");
    const fix04 = htmls.find(h => h.includes("FIX04"));
    assert(!fix04.includes("checked"), "FIX04 is unchecked by default for employee with existing preferences");
  });

  // -----------------------------------------------------------------------------
  // T5: fixed quantity placeholder exactly: 1, 一式
  // -----------------------------------------------------------------------------
  await runTest("T5", "fixed quantity placeholder is strictly '1, 一式' with 0 instances of '例:' or '例：'", () => {
    // 1. Verify exact placeholder in initFixedItemsList
    assert(appJs.includes('placeholder="1, 一式"'), "app.js must contain placeholder=\"1, 一式\"");
    assert(!appJs.includes('placeholder="例: 1, 一式"'), "app.js must not contain placeholder=\"例: 1, 一式\"");
    assert(!appJs.includes('placeholder="例：1, 一式"'), "app.js must not contain placeholder=\"例：1, 一式\"");

    // 2. Check all fixed item placeholders in appJs
    const fixedPlaceholders = [...appJs.matchAll(/placeholder="([^"]*)"\s+id="fixed-qty-[^"]*"/g)].map(m => m[1]);
    assert(fixedPlaceholders.length > 0, "At least one fixed qty placeholder found");
    for (const ph of fixedPlaceholders) {
      assert.strictEqual(ph, "1, 一式", "Fixed quantity placeholder must be exactly '1, 一式'");
      assert(!ph.includes("例:"), `Fixed quantity placeholder "${ph}" must not contain 例:`);
      assert(!ph.includes("例："), `Fixed quantity placeholder "${ph}" must not contain 例：`);
    }

    // 3. Verify no "例: 1, 一式" or similar in any JS or HTML file
    assert(!indexHtml.includes("例: 1"), "index.html has no '例: 1'");
    assert(!indexHtml.includes("例：1"), "index.html has no '例：1'");
  });

  // -----------------------------------------------------------------------------
  // T6: generic modal z-index > history detail modal
  // -----------------------------------------------------------------------------
  await runTest("T6", "generic modal z-index > history detail modal", () => {
    const histZMatch = styleCss.match(/#history-detail-modal\s*\{[^}]*?z-index:\s*(\d+)/);
    const genericZMatch = styleCss.match(/#generic-app-modal\s*\{[^}]*?z-index:\s*(\d+)/);

    assert(histZMatch, "style.css must specify z-index for #history-detail-modal");
    assert(genericZMatch, "style.css must specify z-index for #generic-app-modal");

    const histZ = parseInt(histZMatch[1], 10);
    const genericZ = parseInt(genericZMatch[1], 10);

    assert(histZ >= 1000, `#history-detail-modal z-index (${histZ}) must be >= 1000`);
    assert(genericZ >= 2000, `#generic-app-modal z-index (${genericZ}) must be >= 2000`);
    assert(genericZ > histZ, `generic modal z-index (${genericZ}) must be strictly greater than history detail modal (${histZ})`);
  });

  // -----------------------------------------------------------------------------
  // T7: delete confirmation visible while detail remains open & body scroll lock preserved
  // -----------------------------------------------------------------------------
  await runTest("T7", "delete confirmation visible while detail remains open and body scroll lock preserved", () => {
    const mockClassList = new Set();
    const mockGenericModal = { style: { display: "none" } };
    const mockHistModal = { style: { display: "flex" } }; // history detail is open
    const mockTitle = { textContent: "" };
    const mockBody = { textContent: "" };
    const mockOk = { textContent: "" };
    const mockCancel = { textContent: "", style: { display: "none" } };

    const ctx = {
      console,
      document: {
        getElementById: (id) => {
          if (id === "generic-app-modal") return mockGenericModal;
          if (id === "history-detail-modal") return mockHistModal;
          if (id === "generic-modal-title") return mockTitle;
          if (id === "generic-modal-body") return mockBody;
          if (id === "generic-modal-ok") return mockOk;
          if (id === "generic-modal-cancel") return mockCancel;
          return null;
        },
        body: {
          classList: {
            add: (c) => mockClassList.add(c),
            remove: (c) => mockClassList.delete(c),
            contains: (c) => mockClassList.has(c)
          },
          style: {}
        }
      },
      genericModalCallback: null
    };

    const showAppModalCode = appJs.match(/function showAppModal[\s\S]*?\n\}/)[0];
    const closeGenericCode = appJs.match(/function closeGenericModal[\s\S]*?\n\}/)[0];

    vm.createContext(ctx);
    vm.runInContext(showAppModalCode, ctx);
    vm.runInContext(closeGenericCode, ctx);

    // Show confirmation modal
    vm.runInContext('showAppModal({ title: "確認", message: "削除しますか？", okText: "削除する", cancelText: "キャンセル" });', ctx);

    // Both modals must be displayed simultaneously
    assert.strictEqual(mockHistModal.style.display, "flex", "History detail modal remains open");
    assert.strictEqual(mockGenericModal.style.display, "flex", "Generic confirm modal is open");
    assert(mockClassList.has("modal-open"), "body has modal-open");

    // Close generic modal (e.g. user cancels)
    vm.runInContext("closeGenericModal(false);", ctx);
    assert.strictEqual(mockGenericModal.style.display, "none", "Generic modal is closed");
    assert.strictEqual(mockHistModal.style.display, "flex", "History detail modal is still open");
    assert(mockClassList.has("modal-open"), "body modal-open lock is MAINTAINED because detail modal is still open");
  });

  // -----------------------------------------------------------------------------
  // T8: currentEmployeeNo undeclared reference eliminated
  // -----------------------------------------------------------------------------
  await runTest("T8", "currentEmployeeNo undeclared reference is eliminated from entire repository", () => {
    assert(!appJs.includes("currentEmployeeNo"), "app.js must NOT reference currentEmployeeNo");
    assert(!indexHtml.includes("currentEmployeeNo"), "index.html must NOT reference currentEmployeeNo");
    assert(!gasClientJs.includes("currentEmployeeNo"), "gasClient.js must NOT reference currentEmployeeNo");
  });

  // -----------------------------------------------------------------------------
  // T9: delete confirmation onOk calls deleteFinalSlip once
  // -----------------------------------------------------------------------------
  await runTest("T9", "delete confirmation onOk calls gasClient.deleteFinalSlip once with valid employeeNo", async () => {
    let deleteCalls = [];
    const mockGasClient = {
      deleteFinalSlip: async (payload) => {
        deleteCalls.push(payload);
        return { success: true, deletedAt: "2026-10-01T12:00:00Z", deletedBy: payload.employeeNo };
      }
    };

    let registeredOnOk = null;
    const ctx = {
      console,
      gasClient: mockGasClient,
      currentHistoryDetailSlip: {
        slipNo: "SCRAP-A2-20261001-001",
        baseCode: "A2",
        status: "FINAL",
        employeeNo: "EMP-099"
      },
      resolvedEmployeeNo: "EMP-REGULAR",
      workingBaseCode: "A2",
      showAppModal: (opts) => {
        registeredOnOk = opts.onOk;
      },
      document: {
        getElementById: () => ({ style: {} })
      },
      historyDetailCache: new Map(),
      centralHistorySlips: [],
      renderHistoryDetailContent: () => {},
      renderHistoryRows: () => {},
      renderSummaryView: () => {},
      TerminalStorage: { invalidateSummaryCache: () => {} }
    };

    const handleDelCode = appJs.match(/function handleHistoryDetailDelete\(\)\s*\{[\s\S]*?\n\}/)[0];
    vm.createContext(ctx);
    vm.runInContext(handleDelCode, ctx);

    vm.runInContext("handleHistoryDetailDelete();", ctx);
    assert(registeredOnOk, "onOk must be registered in confirmation modal");

    // Execute onOk
    await registeredOnOk();

    assert.strictEqual(deleteCalls.length, 1, "deleteFinalSlip must be called exactly once");
    assert.strictEqual(deleteCalls[0].slipNo, "SCRAP-A2-20261001-001");
    assert.strictEqual(deleteCalls[0].baseCode, "A2");
    assert.strictEqual(deleteCalls[0].employeeNo, "EMP-REGULAR", "Uses resolvedEmployeeNo without ReferenceError");
  });

  // -----------------------------------------------------------------------------
  // T10: successful delete immediately changes: FINAL -> DELETED, row gray, badge 削除済み
  // -----------------------------------------------------------------------------
  await runTest("T10", "successful delete immediately updates slip to DELETED, row gray, badge 削除済み", async () => {
    const slip = {
      slipNo: "SCRAP-A2-20261001-002",
      baseCode: "A2",
      status: "FINAL",
      date: "2026-10-01",
      employeeNo: "EMP-001"
    };

    const centralList = [slip];
    let renderedDetailSlip = null;

    const mockGasClient = {
      deleteFinalSlip: async (p) => ({
        success: true,
        deletedAt: "2026-10-01T14:30:00Z",
        deletedBy: p.employeeNo
      })
    };

    let onOkFn = null;
    const ctx = {
      console,
      gasClient: mockGasClient,
      currentHistoryDetailSlip: slip,
      resolvedEmployeeNo: "EMP-001",
      workingBaseCode: "A2",
      showAppModal: (opts) => { onOkFn = opts.onOk; },
      document: {
        getElementById: () => ({ style: {} })
      },
      historyDetailCache: new Map(),
      centralHistorySlips: centralList,
      renderHistoryDetailContent: (s) => { renderedDetailSlip = s; },
      renderHistoryRows: () => {},
      renderSummaryView: () => {},
      TerminalStorage: { invalidateSummaryCache: () => {} }
    };

    const handleDelCode = appJs.match(/function handleHistoryDetailDelete\(\)\s*\{[\s\S]*?\n\}/)[0];
    vm.createContext(ctx);
    vm.runInContext(handleDelCode, ctx);

    vm.runInContext("handleHistoryDetailDelete();", ctx);
    await onOkFn();

    // Verify slip mutated
    assert.strictEqual(slip.status, "DELETED", "Slip status must be DELETED");
    assert.strictEqual(renderedDetailSlip.status, "DELETED", "Detail re-rendered with DELETED status");

    // Verify table row rendering for DELETED slip
    const rowsAppended = [];
    const mockTbody = { appendChild: (tr) => rowsAppended.push(tr) };
    const rowCtx = {
      console,
      document: {
        createElement: (tag) => ({ tagName: tag, className: "", innerHTML: "", style: {} }),
        getElementById: () => ({ textContent: "", style: {} })
      },
      formatJstDate: (d) => d,
      formatJstDateTime: (d) => d,
      escapeHtml: (s) => s,
      historySearchState: { visibleCount: 50, keyword: "", signatureStatus: "ALL", fromDate: "", toDate: "" },
      applyHistoryFilters: (slips) => slips,
      centralHistorySlips: [slip],
      filteredHistorySlips: [slip]
    };
    const renderRowsCode = appJs.match(/function renderHistoryRows[\s\S]*?\n\}/)[0];
    vm.createContext(rowCtx);
    vm.runInContext(renderRowsCode, rowCtx);
    rowCtx.renderHistoryRows(mockTbody, [slip]);

    assert.strictEqual(rowsAppended.length, 1);
    assert.strictEqual(rowsAppended[0].className, "hist-row-deleted", "Row must have class hist-row-deleted");
    assert(rowsAppended[0].innerHTML.includes("削除済み"), "Row must display 削除済み badge");
  });

  // -----------------------------------------------------------------------------
  // T11: failed delete shows visible error above detail
  // -----------------------------------------------------------------------------
  await runTest("T11", "failed delete leaves detail open and shows visible error above detail", async () => {
    const slip = {
      slipNo: "SCRAP-A2-20261001-003",
      baseCode: "A2",
      status: "FINAL"
    };

    const mockGasClient = {
      deleteFinalSlip: async () => ({
        success: false,
        error: "PERMISSION_DENIED",
        message: "この伝票を削除する権限がありません"
      })
    };

    let errorModalOpts = null;
    let onOkFn = null;
    const ctx = {
      console,
      gasClient: mockGasClient,
      currentHistoryDetailSlip: slip,
      resolvedEmployeeNo: "EMP-001",
      workingBaseCode: "A2",
      showAppModal: (opts) => {
        if (opts.okText === "削除する") {
          onOkFn = opts.onOk;
        } else {
          errorModalOpts = opts;
        }
      },
      document: {
        getElementById: () => ({ style: {} })
      }
    };

    const handleDelCode = appJs.match(/function handleHistoryDetailDelete\(\)\s*\{[\s\S]*?\n\}/)[0];
    vm.createContext(ctx);
    vm.runInContext(handleDelCode, ctx);

    vm.runInContext("handleHistoryDetailDelete();", ctx);
    await onOkFn();

    // Verify slip was NOT changed
    assert.strictEqual(slip.status, "FINAL", "Slip status must remain FINAL on error");

    // Verify error modal displayed with backend message
    assert(errorModalOpts, "Error modal must be triggered");
    assert.strictEqual(errorModalOpts.title, "削除エラー");
    assert(errorModalOpts.message.includes("この伝票を削除する権限がありません"), "Backend error message is visible to user");
  });

  // -----------------------------------------------------------------------------
  // T12: footer layout: delete left / print+close right
  // -----------------------------------------------------------------------------
  await runTest("T12", "history detail footer: delete on left, print and close on right", () => {
    // 1. Verify DOM hierarchy in indexHtml
    assert(indexHtml.includes('<div class="history-detail-actions">'), "index.html has history-detail-actions");
    assert(indexHtml.includes('<div class="history-detail-actions-left">'), "index.html has history-detail-actions-left");
    assert(indexHtml.includes('<div class="history-detail-actions-right">'), "index.html has history-detail-actions-right");

    const leftGroup = indexHtml.substring(
      indexHtml.indexOf('<div class="history-detail-actions-left">'),
      indexHtml.indexOf('<div class="history-detail-actions-right">')
    );
    assert(leftGroup.includes('id="btn-hist-detail-delete"'), "Delete button is inside left actions group");
    assert(!leftGroup.includes('id="btn-hist-detail-print"'), "Print button is NOT in left group");
    assert(!leftGroup.includes('id="btn-hist-detail-close"'), "Close button is NOT in left group");

    const rightGroup = indexHtml.substring(
      indexHtml.indexOf('<div class="history-detail-actions-right">'),
      indexHtml.indexOf('</div>\n    </div>\n  </div>\n\n  <!-- 印刷用')
    );
    assert(rightGroup.includes('id="btn-hist-detail-print"'), "Print button is in right actions group");
    assert(rightGroup.includes('id="btn-hist-detail-close"'), "Close button is in right actions group");

    // 2. Verify CSS flex layout
    assert(styleCss.includes("justify-content: space-between"), "history-detail-actions uses justify-content: space-between");
    assert(styleCss.includes(".history-detail-actions-left"), "style.css defines .history-detail-actions-left");
    assert(styleCss.includes(".history-detail-actions-right"), "style.css defines .history-detail-actions-right");
    assert(styleCss.includes("gap: 10px"), "history-detail-actions-right specifies gap: 10px");
  });

  // -----------------------------------------------------------------------------
  // T13: close button: transparent + gray border (.btn-outline-gray)
  // -----------------------------------------------------------------------------
  await runTest("T13", "close button uses .btn-outline-gray (transparent background, gray border, no primary/purple fill)", () => {
    // 1. Verify in indexHtml: #btn-hist-detail-close has class btn-outline-gray
    assert(
      /id="btn-hist-detail-close"[^>]*class="[^"]*btn-outline-gray[^"]*"/.test(indexHtml) ||
      /class="[^"]*btn-outline-gray[^"]*"[^>]*id="btn-hist-detail-close"/.test(indexHtml),
      "Close button must have btn-outline-gray class"
    );
    assert(!/id="btn-hist-detail-close"[^>]*class="[^"]*btn-primary[^"]*"/.test(indexHtml), "Close button must NOT be btn-primary");

    // 2. Verify in styleCss: .btn-outline-gray definition
    assert(styleCss.includes(".btn-outline-gray"), "style.css must define .btn-outline-gray");
    assert(styleCss.includes("background: transparent"), ".btn-outline-gray must have transparent background");
    assert(styleCss.includes("border: 1.5px solid #9ca3af"), ".btn-outline-gray must have gray border");
    assert(styleCss.includes("color: #4b5563"), ".btn-outline-gray must have gray text color");
  });

  // -----------------------------------------------------------------------------
  // T14: DELETED detail: delete hidden, print disabled
  // -----------------------------------------------------------------------------
  await runTest("T14", "DELETED detail modal hides delete button and disables/hides print button", () => {
    const deletedSlip = {
      slipNo: "SCRAP-A2-20261001-004",
      baseCode: "A2",
      status: "DELETED",
      signStatus: "DELETED",
      signatureStatus: "DELETED",
      date: "2026-10-01",
      staffName: "Staff A",
      vendorName: "Vendor A",
      deletedAt: "2026-10-01T12:00:00Z",
      deletedBy: "EMP-001"
    };

    const mockPrintBtn = { style: { display: "inline-flex" }, disabled: false };
    const mockDeleteBtn = { style: { display: "inline-flex" }, disabled: false };
    const mockBodyEl = { style: {}, innerHTML: "" };

    const ctx = {
      console,
      window: {},
      document: {
        getElementById: (id) => {
          if (id === "btn-hist-detail-print") return mockPrintBtn;
          if (id === "btn-hist-detail-delete") return mockDeleteBtn;
          if (id === "history-detail-modal-body" || id === "hist-detail-body") return mockBodyEl;
          return { style: {}, textContent: "", innerHTML: "", disabled: false };
        }
      },
      formatJstDateTime: (d) => d,
      formatJstDate: (d) => d,
      escapeHtml: (s) => s,
      getPrintQuantityDisplay: (it) => it.quantity || "1"
    };

    const renderDetailCode = appJs.match(/function renderHistoryDetailContent[\s\S]*?\n\}/)[0];
    vm.createContext(ctx);
    vm.runInContext(renderDetailCode, ctx);

    vm.runInContext("renderHistoryDetailContent(" + JSON.stringify(deletedSlip) + ");", ctx);

    // Assert delete button hidden
    assert.strictEqual(mockDeleteBtn.style.display, "none", "Delete button must be hidden for DELETED slip");
    assert.strictEqual(mockDeleteBtn.disabled, true, "Delete button must be disabled for DELETED slip");

    // Assert print button hidden & disabled
    assert.strictEqual(mockPrintBtn.style.display, "none", "Print button must be hidden for DELETED slip");
    assert.strictEqual(mockPrintBtn.disabled, true, "Print button must be disabled for DELETED slip");
  });

  console.log("================================================================================");
  console.log(`HUMAN RECHECK FIX 01 FOCUSED TESTS COMPLETE: ${testsPassed} passed, ${testsFailed} failed`);
  console.log("================================================================================");

  if (testsFailed > 0) {
    process.exit(1);
  }
}

main().catch(err => {
  console.error("FATAL ERROR in test runner:", err);
  process.exit(1);
});
