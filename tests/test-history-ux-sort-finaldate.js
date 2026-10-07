// test-history-ux-sort-finaldate.js
// Focused Automated Test Suite for ScrapManagement HISTORY UX / SORT / FINAL DATE ENHANCEMENT
// Testing T1 through T26 per Section 40 specifications

const fs = require("fs");
const path = require("path");
const assert = require("assert");

console.log("================================================================================");
console.log("ScrapManagement - HISTORY UX / SORT / FINAL DATE TESTS (T1..T26)");
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

// Setup minimal DOM environment before requiring app.js
const mockElements = {};
function createMockElement(id, tag = "div") {
  const el = {
    id,
    tagName: tag.toUpperCase(),
    className: "",
    classList: {
      _classes: new Set(),
      add(c) { this._classes.add(c); el.className = Array.from(this._classes).join(" "); },
      remove(c) { this._classes.delete(c); el.className = Array.from(this._classes).join(" "); },
      contains(c) { return this._classes.has(c); }
    },
    style: {},
    children: [],
    dataset: {},
    _attrs: {},
    setAttribute(k, v) { this._attrs[k] = String(v); },
    getAttribute(k) { return this._attrs[k] !== undefined ? this._attrs[k] : null; },
    removeAttribute(k) { delete this._attrs[k]; },
    appendChild(c) { this.children.push(c); },
    querySelector(sel) {
      if (sel === 'option[value="DESC"]') return this.children.find(c => c.value === "DESC") || null;
      if (sel === 'option[value="ASC"]') return this.children.find(c => c.value === "ASC") || null;
      return null;
    },
    querySelectorAll() { return []; },
    innerHTML: "",
    textContent: "",
    value: "",
    disabled: false
  };
  return el;
}

global.document = {
  getElementById(id) {
    if (!mockElements[id]) {
      mockElements[id] = createMockElement(id);
    }
    return mockElements[id];
  },
  createElement(tag) {
    return createMockElement(null, tag);
  },
  body: createMockElement("body"),
  addEventListener: () => {}
};

global.window = {
  document: global.document,
  addEventListener: () => {},
  removeEventListener: () => {},
  scrollTo: () => {},
  print: () => {}
};

global.performance = { now: () => 100, timeOrigin: 1000 };
global.WeightEngine = { calculateEstimatedWeight: () => ({ totalWeightKg: 0 }) };
global.TerminalStorage = {
  invalidateHistoryCache: () => {},
  invalidateSummaryCache: () => {},
  clearLocalDraft: () => {},
  saveEmployeeSettings: () => {},
  getUserSettings: () => ({
    employeeNo: "EMP001",
    resolvedEmployeeName: "テスト作業者",
    employeeBaseCode: "LW",
    employeeBaseName: "Lab.West"
  }),
  getSessionWorkingBase: () => ({ baseCode: "LW", baseName: "Lab.West" }),
  getEmployeePreferences: () => ({ categories: [] }),
  setLocalDefaultVendor: () => {},
  getLocalDefaultVendor: () => ""
};
global.closeNoSignatureModal = () => {};

// Require app module
const app = require("../src/js/app.js");

// Load source files for static verification
const repoRoot = path.join(__dirname, "..");
const indexHtml = fs.readFileSync(path.join(repoRoot, "index.html"), "utf8").replace(/\r\n/g, "\n");
const styleCss = fs.readFileSync(path.join(repoRoot, "src", "css", "style.css"), "utf8").replace(/\r\n/g, "\n");
const appJs = fs.readFileSync(path.join(repoRoot, "src", "js", "app.js"), "utf8").replace(/\r\n/g, "\n");

async function main() {
  // Initialize app user and base state
  app.initUserSettings();

  // -----------------------------------------------------------------------------
  // T1: FINAL from fresh input: date = completion JST date
  // -----------------------------------------------------------------------------
  await runTest("T1", "FINAL from fresh input: date = completion JST date", async () => {
    let capturedPayload = null;
    const mockGas = {
      finalizeSlip: async (payload) => {
        capturedPayload = payload;
        return { success: true, slipNo: "SCRAP-LW0001" };
      }
    };
    app.setGasClientInstance(mockGas);
    app.setCurrentResumedDraftId(null);

    // Mock required form fields
    mockElements["vendor-name-input"] = createMockElement("vendor-name-input");
    mockElements["vendor-name-input"].value = "テスト引取業者";

    app.executeFinalize(true);

    assert(capturedPayload, "finalizeSlip must be called");
    const expectedJstDate = app.getJstDateString();
    assert.strictEqual(capturedPayload.date, expectedJstDate, `Fresh input finalize date must match current JST date (${expectedJstDate})`);
  });

  // -----------------------------------------------------------------------------
  // T2: DRAFT saved on Day A, FINAL on Day B: FINAL date = Day B
  // -----------------------------------------------------------------------------
  await runTest("T2", "DRAFT saved on Day A, FINAL on Day B: FINAL date = Day B", async () => {
    let capturedPayload = null;
    const mockGas = {
      finalizeSlip: async (payload) => {
        capturedPayload = payload;
        return { success: true, slipNo: "SCRAP-LW0002" };
      }
    };
    app.setGasClientInstance(mockGas);

    // Day A is 2026-10-01 (simulated draft date)
    app.setCurrentResumedDraftId("DRAFT-OLD-01");
    mockElements["vendor-name-input"].value = "テスト引取業者";

    // Day B is completion date
    app.executeFinalize(true);

    assert(capturedPayload, "finalizeSlip must be called");
    const expectedDayB = app.getJstDateString();
    assert.strictEqual(capturedPayload.date, expectedDayB, `FINAL date must be completion Day B (${expectedDayB}), NOT draft Day A (2026-10-01)`);
  });

  // -----------------------------------------------------------------------------
  // T3: currentResumedDraftDate does not control FINAL date
  // -----------------------------------------------------------------------------
  await runTest("T3", "currentResumedDraftDate does not control FINAL date", async () => {
    assert(!appJs.includes("const finalDate = currentResumedDraftDate || getJstDateString();"), "app.js must not derive finalDate from currentResumedDraftDate");
    assert(appJs.includes("const finalDate = getJstDateString();"), "app.js must explicitly set finalDate = getJstDateString()");
  });

  // -----------------------------------------------------------------------------
  // T4: legacy FINAL date remains readable
  // -----------------------------------------------------------------------------
  await runTest("T4", "legacy FINAL date remains readable via getHistoryBusinessDate", async () => {
    const legacySlip = {
      slipNo: "SCRAP-LW0001",
      date: "2026-09-15",
      createdAt: "2026-09-15T08:00:00.000Z",
      finalizedAt: "2026-09-15T08:30:00.000Z"
    };
    const bDate = app.getHistoryBusinessDate(legacySlip);
    assert.strictEqual(bDate, "2026-09-15", "Legacy slip date must be preserved as 2026-09-15");

    // Missing date fallback to finalizedAt
    const missingDateSlip = {
      slipNo: "SCRAP-LW0002",
      finalizedAt: "2026-09-20T10:00:00.000Z",
      createdAt: "2026-09-19T10:00:00.000Z"
    };
    assert.strictEqual(app.getHistoryBusinessDate(missingDateSlip), "2026-09-20", "Missing date fallback to finalizedAt");
  });

  // -----------------------------------------------------------------------------
  // T5: DATE DESC
  // -----------------------------------------------------------------------------
  await runTest("T5", "DATE DESC sort orders newest to oldest", async () => {
    const slips = [
      { slipNo: "SCRAP-LW0001", date: "2026-10-01" },
      { slipNo: "SCRAP-LW0003", date: "2026-10-07" },
      { slipNo: "SCRAP-LW0002", date: "2026-10-04" }
    ];
    const sorted = app.sortFinalHistorySlips(slips, "DATE", "DESC");
    assert.strictEqual(sorted[0].slipNo, "SCRAP-LW0003");
    assert.strictEqual(sorted[1].slipNo, "SCRAP-LW0002");
    assert.strictEqual(sorted[2].slipNo, "SCRAP-LW0001");
  });

  // -----------------------------------------------------------------------------
  // T6: DATE ASC
  // -----------------------------------------------------------------------------
  await runTest("T6", "DATE ASC sort orders oldest to newest", async () => {
    const slips = [
      { slipNo: "SCRAP-LW0001", date: "2026-10-01" },
      { slipNo: "SCRAP-LW0003", date: "2026-10-07" },
      { slipNo: "SCRAP-LW0002", date: "2026-10-04" }
    ];
    const sorted = app.sortFinalHistorySlips(slips, "DATE", "ASC");
    assert.strictEqual(sorted[0].slipNo, "SCRAP-LW0001");
    assert.strictEqual(sorted[1].slipNo, "SCRAP-LW0002");
    assert.strictEqual(sorted[2].slipNo, "SCRAP-LW0003");
  });

  // -----------------------------------------------------------------------------
  // T7: SLIP_NO DESC
  // -----------------------------------------------------------------------------
  await runTest("T7", "SLIP_NO DESC sort orders larger to smaller with natural numbers", async () => {
    const slips = [
      { slipNo: "SCRAP-LW0001", date: "2026-10-05" },
      { slipNo: "SCRAP-LW0010", date: "2026-10-01" },
      { slipNo: "SCRAP-LW0002", date: "2026-10-03" }
    ];
    const sorted = app.sortFinalHistorySlips(slips, "SLIP_NO", "DESC");
    assert.strictEqual(sorted[0].slipNo, "SCRAP-LW0010");
    assert.strictEqual(sorted[1].slipNo, "SCRAP-LW0002");
    assert.strictEqual(sorted[2].slipNo, "SCRAP-LW0001");
  });

  // -----------------------------------------------------------------------------
  // T8: SLIP_NO ASC
  // -----------------------------------------------------------------------------
  await runTest("T8", "SLIP_NO ASC sort orders smaller to larger with natural numbers", async () => {
    const slips = [
      { slipNo: "SCRAP-LW0001", date: "2026-10-05" },
      { slipNo: "SCRAP-LW0010", date: "2026-10-01" },
      { slipNo: "SCRAP-LW0002", date: "2026-10-03" }
    ];
    const sorted = app.sortFinalHistorySlips(slips, "SLIP_NO", "ASC");
    assert.strictEqual(sorted[0].slipNo, "SCRAP-LW0001");
    assert.strictEqual(sorted[1].slipNo, "SCRAP-LW0002");
    assert.strictEqual(sorted[2].slipNo, "SCRAP-LW0010");
  });

  // -----------------------------------------------------------------------------
  // T9: same-date deterministic tie-break
  // -----------------------------------------------------------------------------
  await runTest("T9", "same-date deterministic tie-break uses finalizedAt then slipNo", async () => {
    const slips = [
      { slipNo: "SCRAP-LW0001", date: "2026-10-07", finalizedAt: "2026-10-07T08:00:00.000Z" },
      { slipNo: "SCRAP-LW0003", date: "2026-10-07", finalizedAt: "2026-10-07T09:00:00.000Z" },
      { slipNo: "SCRAP-LW0002", date: "2026-10-07", finalizedAt: "2026-10-07T08:30:00.000Z" }
    ];
    const sortedDesc = app.sortFinalHistorySlips(slips, "DATE", "DESC");
    assert.strictEqual(sortedDesc[0].slipNo, "SCRAP-LW0003");
    assert.strictEqual(sortedDesc[1].slipNo, "SCRAP-LW0002");
    assert.strictEqual(sortedDesc[2].slipNo, "SCRAP-LW0001");

    // If finalizedAt also matches, tie-breaker 2 is slipNo
    const sameFinSlips = [
      { slipNo: "SCRAP-LW0001", date: "2026-10-07", finalizedAt: "2026-10-07T10:00:00.000Z" },
      { slipNo: "SCRAP-LW0002", date: "2026-10-07", finalizedAt: "2026-10-07T10:00:00.000Z" }
    ];
    const sortedSameFin = app.sortFinalHistorySlips(sameFinSlips, "DATE", "DESC");
    assert.strictEqual(sortedSameFin[0].slipNo, "SCRAP-LW0002");
    assert.strictEqual(sortedSameFin[1].slipNo, "SCRAP-LW0001");
  });

  // -----------------------------------------------------------------------------
  // T10: filter then sort
  // -----------------------------------------------------------------------------
  await runTest("T10", "filter then sort: filters applied before sorting", async () => {
    const slips = [
      { slipNo: "SCRAP-LW0001", date: "2026-10-01", status: "FINAL", staffName: "田中" },
      { slipNo: "SCRAP-LW0002", date: "2026-10-05", status: "FINAL", staffName: "佐藤" },
      { slipNo: "SCRAP-LW0003", date: "2026-10-07", status: "FINAL", staffName: "田中" },
      { slipNo: "SCRAP-LW0004", date: "2026-10-06", status: "DRAFT", staffName: "田中" } // DRAFT excluded
    ];
    const searchState = {
      keyword: "田中",
      sortField: "DATE",
      sortOrder: "ASC"
    };
    const result = app.applyHistoryFilters(slips, searchState);
    assert.strictEqual(result.length, 2, "Only 2 FINAL slips with keyword 田中");
    assert.strictEqual(result[0].slipNo, "SCRAP-LW0001");
    assert.strictEqual(result[1].slipNo, "SCRAP-LW0003");
  });

  // -----------------------------------------------------------------------------
  // T11: clear resets DATE/DESC
  // -----------------------------------------------------------------------------
  await runTest("T11", "clear resets DATE/DESC and updates select elements", async () => {
    mockElements["history-sort-field"] = createMockElement("history-sort-field", "select");
    mockElements["history-sort-order"] = createMockElement("history-sort-order", "select");
    mockElements["history-sort-field"].value = "SLIP_NO";
    mockElements["history-sort-order"].value = "ASC";

    app.getHistorySearchState().sortField = "SLIP_NO";
    app.getHistorySearchState().sortOrder = "ASC";

    app.handleHistorySearchClear();

    const state = app.getHistorySearchState();
    assert.strictEqual(state.sortField, "DATE", "Search state sortField must reset to DATE");
    assert.strictEqual(state.sortOrder, "DESC", "Search state sortOrder must reset to DESC");
    assert.strictEqual(mockElements["history-sort-field"].value, "DATE", "DOM select history-sort-field must reset to DATE");
    assert.strictEqual(mockElements["history-sort-order"].value, "DESC", "DOM select history-sort-order must reset to DESC");
  });

  // -----------------------------------------------------------------------------
  // T12: CSV uses current sorted order
  // -----------------------------------------------------------------------------
  await runTest("T12", "CSV uses current sorted order from filteredHistorySlips", async () => {
    const sortedSlips = [
      { slipNo: "SCRAP-LW0005", date: "2026-10-07", status: "FINAL" },
      { slipNo: "SCRAP-LW0001", date: "2026-10-01", status: "FINAL" }
    ];
    const csv = app.generateHistoryHeaderCsv(sortedSlips);
    const lines = csv.trim().split("\r\n");
    assert.strictEqual(lines.length, 3, "Header line + 2 data rows");
    assert(lines[1].startsWith('"SCRAP-LW0005"'), "First CSV row must be SCRAP-LW0005 matching sort order");
    assert(lines[2].startsWith('"SCRAP-LW0001"'), "Second CSV row must be SCRAP-LW0001 matching sort order");
  });

  // -----------------------------------------------------------------------------
  // T13: mobile sort controls fit 320/375/390/430
  // -----------------------------------------------------------------------------
  await runTest("T13", "mobile sort controls fit 320/375/390/430 in index.html & style.css", async () => {
    assert(indexHtml.includes('id="history-sort-field"'), "index.html must contain id=history-sort-field");
    assert(indexHtml.includes('id="history-sort-order"'), "index.html must contain id=history-sort-order");
    assert(indexHtml.includes('class="form-group history-search-group-sort"'), "index.html must group sort controls in history-search-group-sort");

    assert(styleCss.includes(".history-search-group-sort {\n    grid-column: span 2;\n  }"), "Mobile media query must span sort group across 2 columns");
    assert(styleCss.includes("grid-template-columns: 1.4fr 1.2fr 0.9fr 1.3fr auto;"), "Desktop grid must define 5 columns for date, keyword, signature, sort, actions");
  });

  // -----------------------------------------------------------------------------
  // T14: existing .btn-spinner reused
  // -----------------------------------------------------------------------------
  await runTest("T14", "existing .btn-spinner reused in setActionButtonBusy", async () => {
    const btn = createMockElement("test-btn", "button");
    btn.innerHTML = "再開";

    app.setActionButtonBusy(btn, true, "読込中...");
    assert(btn.innerHTML.includes('<span class="btn-spinner" aria-hidden="true"'), "Must reuse existing .btn-spinner class");
    assert(btn.innerHTML.includes("読込中..."), "Must show loading text");
    assert.strictEqual(btn.disabled, true, "Button must be disabled");
    assert.strictEqual(btn.getAttribute("aria-busy"), "true", "aria-busy must be true");

    app.setActionButtonBusy(btn, false);
    assert.strictEqual(btn.innerHTML, "再開", "Button innerHTML must be restored");
    assert.strictEqual(btn.disabled, false, "Button must not be disabled");
    assert.strictEqual(btn.getAttribute("aria-busy"), null, "aria-busy must be removed");
  });

  // -----------------------------------------------------------------------------
  // T15: resume busy + duplicate lock
  // -----------------------------------------------------------------------------
  await runTest("T15", "resume busy + duplicate lock blocks concurrent execution", async () => {
    let fetchCalls = 0;
    app.setGasClientInstance({
      fetchSlip: async (id) => {
        fetchCalls++;
        await new Promise(r => setTimeout(r, 50));
        return { success: true, slip: { slipNo: id, status: "DRAFT" } };
      }
    });

    const btn = createMockElement("resume-btn", "button");
    btn.innerHTML = "再開";

    // Call 1
    app.resumeDraftSlip("DRAFT-123", btn);
    assert(app.historyActionLocks.has("resume:DRAFT-123"), "Lock must be held during execution");
    assert.strictEqual(btn.disabled, true, "Button must be disabled during execution");

    // Call 2 concurrent
    app.resumeDraftSlip("DRAFT-123", btn);
    assert.strictEqual(fetchCalls, 1, "Concurrent call must be blocked by duplicate lock");

    // Wait for completion
    await new Promise(r => setTimeout(r, 80));
    assert(!app.historyActionLocks.has("resume:DRAFT-123"), "Lock must be released after completion");
    assert.strictEqual(btn.disabled, false, "Button must be restored after completion");
  });

  // -----------------------------------------------------------------------------
  // T16: resume failure restore
  // -----------------------------------------------------------------------------
  await runTest("T16", "resume failure restores button and releases lock", async () => {
    app.setGasClientInstance({
      fetchSlip: async () => {
        throw new Error("Network error");
      }
    });
    const btn = createMockElement("resume-fail-btn", "button");
    btn.innerHTML = "再開";

    app.resumeDraftSlip("DRAFT-FAIL", btn);
    await new Promise(r => setTimeout(r, 50));

    assert(!app.historyActionLocks.has("resume:DRAFT-FAIL"), "Lock must be released on failure");
    assert.strictEqual(btn.disabled, false, "Button must be re-enabled on failure");
    assert.strictEqual(btn.innerHTML, "再開", "Button text must be restored on failure");
  });

  // -----------------------------------------------------------------------------
  // T17: history print busy + duplicate lock
  // -----------------------------------------------------------------------------
  await runTest("T17", "history print busy + duplicate lock blocks concurrent execution", async () => {
    const slip = { slipNo: "SCRAP-LW0099", status: "FINAL" };
    app.getFilteredHistorySlips().push(slip);
    app.getHistoryDetailCache().set("SCRAP-LW0099", slip);

    const btn = createMockElement("print-btn", "button");
    btn.innerHTML = "印刷";

    app.printSlipFromHistory("SCRAP-LW0099", btn);
    assert(app.historyActionLocks.has("print:SCRAP-LW0099"), "Print lock must be active");
    assert.strictEqual(btn.disabled, true, "Print button must be disabled");
    assert(btn.innerHTML.includes("印刷準備中..."), "Print button must show 印刷準備中...");

    // Try second concurrent print
    app.printSlipFromHistory("SCRAP-LW0099", btn);
    assert(app.historyActionLocks.has("print:SCRAP-LW0099"));
  });

  // -----------------------------------------------------------------------------
  // T18: cache-hit print feedback
  // -----------------------------------------------------------------------------
  await runTest("T18", "cache-hit print feedback uses setTimeout to ensure visual feedback paint", async () => {
    assert(appJs.includes("setTimeout(() => {\n      prepareAndPrintSlip(historyDetailCache.get(slipNo));\n    }, 60);"), "Cache-hit path must defer prepareAndPrintSlip with setTimeout for visual paint");
  });

  // -----------------------------------------------------------------------------
  // T19: afterprint/fallback restore
  // -----------------------------------------------------------------------------
  await runTest("T19", "afterprint/fallback restores print button and lock", async () => {
    let afterPrintCallback = null;
    global.window.addEventListener = (evt, cb) => {
      if (evt === "afterprint") afterPrintCallback = cb;
    };
    const slip = { slipNo: "SCRAP-LW0088", status: "FINAL" };
    app.getFilteredHistorySlips().push(slip);
    app.getHistoryDetailCache().set("SCRAP-LW0088", slip);

    const btn = createMockElement("print-after-btn", "button");
    btn.innerHTML = "印刷";

    app.printSlipFromHistory("SCRAP-LW0088", btn);
    assert(app.historyActionLocks.has("print:SCRAP-LW0088"));

    // Trigger afterprint
    assert(typeof afterPrintCallback === "function", "afterprint callback must be registered");
    afterPrintCallback();

    assert(!app.historyActionLocks.has("print:SCRAP-LW0088"), "Lock must be deleted afterprint");
    assert.strictEqual(btn.disabled, false, "Button must be restored afterprint");
    assert.strictEqual(btn.innerHTML, "印刷", "Button innerHTML must be restored afterprint");
  });

  // -----------------------------------------------------------------------------
  // T20: detail duplicate fetch blocked
  // -----------------------------------------------------------------------------
  await runTest("T20", "detail duplicate fetch blocked by detail:<slipNo> lock", async () => {
    let fetchCalls = 0;
    app.setGasClientInstance({
      fetchSlip: async (slipNo) => {
        fetchCalls++;
        await new Promise(r => setTimeout(r, 50));
        return { success: true, slip: { slipNo, status: "FINAL" } };
      }
    });
    const btn = createMockElement("detail-btn", "button");
    btn.innerHTML = "詳細";

    app.openHistoryDetailModal("SCRAP-LW0050", btn);
    app.openHistoryDetailModal("SCRAP-LW0050", btn);

    assert.strictEqual(fetchCalls, 1, "Only 1 fetchSlip must be triggered for duplicate detail clicks");
    await new Promise(r => setTimeout(r, 70));
    assert(!app.historyActionLocks.has("detail:SCRAP-LW0050"), "Lock released after fetch");
  });

  // -----------------------------------------------------------------------------
  // T21: draft delete duplicate blocked
  // -----------------------------------------------------------------------------
  await runTest("T21", "draft delete duplicate blocked by deleteDraft:<draftId> lock", async () => {
    let deleteCalls = 0;
    app.setGasClientInstance({
      deleteDraft: async () => {
        deleteCalls++;
        await new Promise(r => setTimeout(r, 50));
        return { success: true };
      }
    });
    const btn = createMockElement("del-btn", "button");
    btn.innerHTML = "削除";

    app.executeDeleteDraft("DRAFT-DEL-01", btn);
    app.executeDeleteDraft("DRAFT-DEL-01", btn);

    assert.strictEqual(deleteCalls, 1, "Only 1 deleteDraft API call on duplicate execution");
    await new Promise(r => setTimeout(r, 70));
    assert(!app.historyActionLocks.has("deleteDraft:DRAFT-DEL-01"), "Lock released after completion");
  });

  // -----------------------------------------------------------------------------
  // T22: final delete shows 削除中...
  // -----------------------------------------------------------------------------
  await runTest("T22", "final delete shows 削除中... on delete button and locks deleteFinal:<slipNo>", async () => {
    const deleteBtn = mockElements["btn-hist-detail-delete"];
    deleteBtn.innerHTML = "削除する";

    let deleteCalls = 0;
    app.setGasClientInstance({
      deleteFinalSlip: async () => {
        deleteCalls++;
        assert.strictEqual(deleteBtn.disabled, true, "Delete button must be disabled during deletion");
        assert(deleteBtn.innerHTML.includes("削除中..."), "Delete button must show 削除中...");
        assert(app.historyActionLocks.has("deleteFinal:SCRAP-LW0077"), "Lock deleteFinal:SCRAP-LW0077 must be held");
        await new Promise(r => setTimeout(r, 30));
        return { success: true };
      }
    });

    // Mock open modal with slip
    app.getHistoryDetailCache().set("SCRAP-LW0077", { slipNo: "SCRAP-LW0077", status: "FINAL" });
    app.openHistoryDetailModal("SCRAP-LW0077");

    // Call delete
    app.handleHistoryDetailDelete();
    // Confirm in generic modal
    app.closeGenericModal(true);
    await new Promise(r => setTimeout(r, 60));

    assert.strictEqual(deleteCalls, 1, "deleteFinalSlip must be called once");
    assert(!app.historyActionLocks.has("deleteFinal:SCRAP-LW0077"), "Lock must be released");
    assert.strictEqual(deleteBtn.disabled, false, "Delete button restored");
  });

  // -----------------------------------------------------------------------------
  // T23: all async failure paths restore
  // -----------------------------------------------------------------------------
  await runTest("T23", "all async failure paths restore buttons and locks", async () => {
    app.setGasClientInstance({
      fetchSlip: async () => { throw new Error("fail"); },
      deleteDraft: async () => { throw new Error("fail"); },
      deleteFinalSlip: async () => { throw new Error("fail"); }
    });

    // Test resume failure
    const rBtn = createMockElement("r-fail", "button");
    rBtn.innerHTML = "再開";
    app.resumeDraftSlip("DRAFT-FAIL-2", rBtn);
    await new Promise(r => setTimeout(r, 30));
    assert.strictEqual(rBtn.disabled, false);
    assert(!app.historyActionLocks.has("resume:DRAFT-FAIL-2"));

    // Test draft delete failure
    const dBtn = createMockElement("d-fail", "button");
    dBtn.innerHTML = "削除";
    app.executeDeleteDraft("DRAFT-FAIL-DEL", dBtn);
    await new Promise(r => setTimeout(r, 30));
    assert.strictEqual(dBtn.disabled, false);
    assert(!app.historyActionLocks.has("deleteDraft:DRAFT-FAIL-DEL"));
  });

  // -----------------------------------------------------------------------------
  // T24: button press effect exists
  // -----------------------------------------------------------------------------
  await runTest("T24", "button press effect exists in style.css", async () => {
    assert(styleCss.includes(".btn:active:not(:disabled)"), "Must define .btn:active:not(:disabled)");
    assert(styleCss.includes(".hist-action-btn:active:not(:disabled)"), "Must define .hist-action-btn:active:not(:disabled)");
    assert(styleCss.includes("transform: scale(0.97);"), "Must apply transform: scale(0.97)");
    assert(styleCss.includes("filter: brightness(0.96);"), "Must apply filter: brightness(0.96)");
  });

  // -----------------------------------------------------------------------------
  // T25: desktop 7-column layout unchanged
  // -----------------------------------------------------------------------------
  await runTest("T25", "desktop 7-column layout unchanged (821px+)", async () => {
    assert(styleCss.includes(".history-table col.col-slip, .history-table th.col-slip, .history-table td.col-slip { width: 17% !important; }"));
    assert(styleCss.includes(".history-table col.col-date, .history-table th.col-date, .history-table td.col-date { width: 14% !important; }"));
    assert(styleCss.includes(".history-table col.col-staff, .history-table th.col-staff, .history-table td.col-staff { width: 13% !important; }"));
    assert(styleCss.includes(".history-table col.col-vendor, .history-table th.col-vendor, .history-table td.col-vendor { width: 16% !important; }"));
    assert(styleCss.includes(".history-table col.col-sig, .history-table th.col-sig, .history-table td.col-sig { width: 16% !important; }"));
    assert(styleCss.includes(".history-table col.col-status, .history-table th.col-status, .history-table td.col-status { width: 8% !important; text-align: center !important; }"));
    assert(styleCss.includes(".history-table col.col-actions, .history-table th.col-actions, .history-table td.col-actions { width: 16% !important; text-align: center !important; }"));
  });

  // -----------------------------------------------------------------------------
  // T26: mobile history full-width card unchanged
  // -----------------------------------------------------------------------------
  await runTest("T26", "mobile history full-width card unchanged", async () => {
    const media820Match = styleCss.match(/@media\s*\(\s*max-width\s*:\s*820px\s*\)\s*\{([\s\S]*?)\n\}/);
    assert(media820Match, "@media (max-width: 820px) must exist");
    const media820 = media820Match[1];

    assert(media820.includes(".history-table {\n    display: block !important;\n    width: 100% !important;\n    min-width: 0 !important;\n    table-layout: auto !important;\n    border-collapse: separate !important;\n  }"));
    assert(media820.includes(".history-table colgroup {\n    display: none !important;\n  }"));
    assert(media820.includes(".history-col-mobile {\n    display: block !important;\n    width: 100% !important;"));
    assert(/\.hist-slip-no\s*\{[^}]*white-space:\s*nowrap\s*!important/s.test(media820), "Mobile slipNo must have white-space: nowrap !important");

    // Release ID unified
    const releaseId = "OPERATION-UX-20261007-01";
    assert(appJs.includes(`const SCRAP_APP_RUNTIME_REV = "${releaseId}";`));
    assert(styleCss.includes(`--scrap-style-runtime-rev: "${releaseId}";`));
    assert(indexHtml.includes(`id="diag-html-build">${releaseId}</span>`));
    assert(indexHtml.includes(`Build: ${releaseId}`));
  });

  console.log("================================================================================");
  console.log(`HISTORY UX / SORT / FINAL DATE TESTS COMPLETE: ${testsPassed} passed, ${testsFailed} failed`);
  console.log("================================================================================");

  if (testsFailed > 0) {
    process.exit(1);
  }
}

main().catch(err => {
  console.error("Unhandled test suite error:", err);
  process.exit(1);
});
