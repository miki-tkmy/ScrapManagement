// test-history-ui-refinement.js
// Focused Automated Test Suite for ScrapManagement HISTORY UI REFINEMENT
// Testing T1 through T25 per Section 30 specifications

const fs = require("fs");
const path = require("path");
const assert = require("assert");

console.log("================================================================================");
console.log("ScrapManagement - HISTORY UI REFINEMENT TESTS (T1..T25)");
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
    hasAttribute(k) { return this._attrs[k] !== undefined; },
    removeAttribute(k) { delete this._attrs[k]; },
    appendChild(c) { this.children.push(c); },
    querySelector(sel) {
      if (sel === 'option[value="DESC"]') return this.children.find(c => c.value === "DESC") || null;
      if (sel === 'option[value="ASC"]') return this.children.find(c => c.value === "ASC") || null;
      return null;
    },
    querySelectorAll() { return []; },
    getBoundingClientRect() {
      return {
        width: this._mockWidth || 80,
        height: this._mockHeight || 44,
        top: 0,
        left: 0,
        right: this._mockWidth || 80,
        bottom: this._mockHeight || 44
      };
    },
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
  app.initUserSettings();

  // -----------------------------------------------------------------------------
  // T1: search gridからsort groupが除去
  // -----------------------------------------------------------------------------
  await runTest("T1", "search gridからsort groupが除去", async () => {
    const gridMatch = indexHtml.match(/<div class="history-search-grid">([\s\S]*?)<\/form>/);
    assert(gridMatch, "Must find history-search-grid in index.html");
    const gridHtml = gridMatch[1];
    assert(!gridHtml.includes('id="history-sort-field"'), "history-search-grid must NOT contain history-sort-field");
    assert(!gridHtml.includes('id="history-sort-order"'), "history-search-grid must NOT contain history-sort-order");
    assert(!gridHtml.includes("history-search-group-sort"), "history-search-grid must NOT contain history-search-group-sort");

    // In style.css, ensure no .history-search-group-sort inside media queries or desktop
    assert(!styleCss.includes(".history-search-group-sort {"), "style.css must not style .history-search-group-sort");
  });

  // -----------------------------------------------------------------------------
  // T2: PC search grid 4 groups
  // -----------------------------------------------------------------------------
  await runTest("T2", "PC search grid 4 groups (date, keyword, signature, actions)", async () => {
    assert(styleCss.includes("grid-template-columns: minmax(260px, 1.5fr) minmax(180px, 1fr) minmax(120px, 0.7fr) auto;"),
      "style.css must define 4-group grid-template-columns");
    
    const gridMatch = indexHtml.match(/<div class="history-search-grid">([\s\S]*?)<\/div>\s*<\/form>/);
    assert(gridMatch, "history-search-grid found");
    const grid = gridMatch[1];
    assert(grid.includes("history-search-group-date"), "Must contain date group");
    assert(grid.includes("history-search-group-keyword"), "Must contain keyword group");
    assert(grid.includes("history-search-group-signature"), "Must contain signature group");
    assert(grid.includes("history-search-actions"), "Must contain actions group");
  });

  // -----------------------------------------------------------------------------
  // T3: keyword label nowrap
  // -----------------------------------------------------------------------------
  await runTest("T3", "keyword label nowrap & labels protected from vertical wrapping", async () => {
    assert(styleCss.includes(".history-search-grid .form-label {\n  white-space: nowrap !important;\n}"),
      "style.css must enforce white-space: nowrap !important on search form-labels");
    assert(indexHtml.includes('>キーワード</label>'), "Label text must remain キーワード without breaking tags");
  });

  // -----------------------------------------------------------------------------
  // T4: keyword input usable width
  // -----------------------------------------------------------------------------
  await runTest("T4", "keyword input usable width (min-width:0 on group and width:100% on input)", async () => {
    assert(styleCss.includes(".history-search-group-keyword {\n  min-width: 0;\n}"),
      "style.css must have min-width: 0 on .history-search-group-keyword");
    assert(styleCss.includes(".history-search-group-keyword input {\n  width: 100%;\n  min-width: 0;\n}"),
      "style.css must have width: 100% and min-width: 0 on keyword input");
  });

  // -----------------------------------------------------------------------------
  // T5: sort bar is directly before history table
  // -----------------------------------------------------------------------------
  await runTest("T5", "sort bar is directly before history table in DOM order", async () => {
    const historyViewIdx = indexHtml.indexOf('id="view-history"');
    assert(historyViewIdx !== -1, "view-history exists");

    const cardIdx = indexHtml.indexOf('class="history-search-card"', historyViewIdx);
    const sortBarIdx = indexHtml.indexOf('class="history-sort-bar"', historyViewIdx);
    const tableWrapperIdx = indexHtml.indexOf('class="materials-table-wrapper"', sortBarIdx);
    const tableIdx = indexHtml.indexOf('id="history-table"', sortBarIdx);

    assert(cardIdx !== -1, "history-search-card exists in view-history");
    assert(sortBarIdx !== -1, "history-sort-bar exists in view-history");
    assert(tableWrapperIdx !== -1, "materials-table-wrapper exists after sort-bar in view-history");
    assert(tableIdx !== -1, "history-table exists after sort-bar in view-history");

    assert(cardIdx < sortBarIdx, "history-search-card must precede history-sort-bar");
    assert(sortBarIdx < tableWrapperIdx, "history-sort-bar must precede materials-table-wrapper");
    assert(sortBarIdx < tableIdx, "history-sort-bar must precede history-table");
  });

  // -----------------------------------------------------------------------------
  // T6: sort field onchange auto invokes handleHistorySortChange
  // -----------------------------------------------------------------------------
  await runTest("T6", "sort field onchange auto invokes handleHistorySortChange", async () => {
    assert(indexHtml.includes('id="history-sort-field" class="form-select history-sort-select" onchange="handleHistorySortChange()"'),
      "history-sort-field must invoke handleHistorySortChange onchange");
  });

  // -----------------------------------------------------------------------------
  // T7: sort order onchange auto invokes handleHistorySortChange
  // -----------------------------------------------------------------------------
  await runTest("T7", "sort order onchange auto invokes handleHistorySortChange", async () => {
    assert(indexHtml.includes('id="history-sort-order" class="form-select history-sort-select" onchange="handleHistorySortChange()"'),
      "history-sort-order must invoke handleHistorySortChange onchange");
  });

  // -----------------------------------------------------------------------------
  // T8: sort change requires no search/confirm button
  // -----------------------------------------------------------------------------
  await runTest("T8", "sort change requires no search/confirm button", async () => {
    const barMatch = indexHtml.match(/<div class="history-sort-bar">([\s\S]*?)<\/div>/);
    assert(barMatch, "history-sort-bar must be found");
    const barHtml = barMatch[1];
    assert(!barHtml.includes("<button"), "history-sort-bar must NOT contain any button element");
  });

  // -----------------------------------------------------------------------------
  // T9: DATE sort unchanged
  // -----------------------------------------------------------------------------
  await runTest("T9", "DATE sort unchanged (DESC newest first, ASC oldest first)", async () => {
    const slips = [
      { slipNo: "SCRAP-LW0001", date: "2026-10-01" },
      { slipNo: "SCRAP-LW0003", date: "2026-10-07" },
      { slipNo: "SCRAP-LW0002", date: "2026-10-04" }
    ];
    const desc = app.sortFinalHistorySlips(slips, "DATE", "DESC");
    assert.strictEqual(desc[0].slipNo, "SCRAP-LW0003");
    assert.strictEqual(desc[1].slipNo, "SCRAP-LW0002");
    assert.strictEqual(desc[2].slipNo, "SCRAP-LW0001");

    const asc = app.sortFinalHistorySlips(slips, "DATE", "ASC");
    assert.strictEqual(asc[0].slipNo, "SCRAP-LW0001");
    assert.strictEqual(asc[1].slipNo, "SCRAP-LW0002");
    assert.strictEqual(asc[2].slipNo, "SCRAP-LW0003");
  });

  // -----------------------------------------------------------------------------
  // T10: SLIP_NO sort unchanged
  // -----------------------------------------------------------------------------
  await runTest("T10", "SLIP_NO sort unchanged (numeric natural sort)", async () => {
    const slips = [
      { slipNo: "SCRAP-LW0002", date: "2026-10-01" },
      { slipNo: "SCRAP-LW0010", date: "2026-10-01" },
      { slipNo: "SCRAP-LW0001", date: "2026-10-01" }
    ];
    const desc = app.sortFinalHistorySlips(slips, "SLIP_NO", "DESC");
    assert.strictEqual(desc[0].slipNo, "SCRAP-LW0010");
    assert.strictEqual(desc[1].slipNo, "SCRAP-LW0002");
    assert.strictEqual(desc[2].slipNo, "SCRAP-LW0001");

    const asc = app.sortFinalHistorySlips(slips, "SLIP_NO", "ASC");
    assert.strictEqual(asc[0].slipNo, "SCRAP-LW0001");
    assert.strictEqual(asc[1].slipNo, "SCRAP-LW0002");
    assert.strictEqual(asc[2].slipNo, "SCRAP-LW0010");
  });

  // -----------------------------------------------------------------------------
  // T11: setActionButtonBusy busy = spinner only
  // -----------------------------------------------------------------------------
  await runTest("T11", "setActionButtonBusy busy = spinner only (no text)", async () => {
    const btn = createMockElement("btn-print", "button");
    btn.innerHTML = "印刷";
    app.setActionButtonBusy(btn, true, "印刷準備中...");

    assert.strictEqual(btn.innerHTML, '<span class="btn-spinner" aria-hidden="true"></span>');
    assert.strictEqual(btn.disabled, true);
    assert.strictEqual(btn.getAttribute("aria-busy"), "true");
    assert.strictEqual(btn.getAttribute("aria-label"), "処理中");
    assert(btn.classList.contains("is-loading"));
  });

  // -----------------------------------------------------------------------------
  // T12: busy HTML contains no text
  // -----------------------------------------------------------------------------
  await runTest("T12", "busy HTML contains no text (読込中, 印刷準備中, 削除中, 処理中)", async () => {
    const btn = createMockElement("btn-test", "button");
    btn.innerHTML = "削除";
    app.setActionButtonBusy(btn, true, "削除中...");

    assert(!btn.innerHTML.includes("読込中"));
    assert(!btn.innerHTML.includes("印刷準備中"));
    assert(!btn.innerHTML.includes("削除中"));
    assert(!btn.innerHTML.includes("処理中"));
    assert(!btn.innerHTML.includes("保存中"));
    assert(!btn.innerHTML.includes("完了処理中"));
  });

  // -----------------------------------------------------------------------------
  // T13: button width/height frozen during busy
  // -----------------------------------------------------------------------------
  await runTest("T13", "button width/height frozen during busy", async () => {
    const btn = createMockElement("btn-freeze", "button");
    btn._mockWidth = 92;
    btn._mockHeight = 44;
    btn.innerHTML = "再開";

    app.setActionButtonBusy(btn, true);

    assert.strictEqual(btn.style.width, "92px");
    assert.strictEqual(btn.style.height, "44px");
    assert.strictEqual(btn.style.minWidth, "92px");
    assert.strictEqual(btn.style.minHeight, "44px");
  });

  // -----------------------------------------------------------------------------
  // T14: button original dimensions restored after busy
  // -----------------------------------------------------------------------------
  await runTest("T14", "button original dimensions restored after busy", async () => {
    const btn = createMockElement("btn-restore", "button");
    btn._mockWidth = 92;
    btn._mockHeight = 44;
    btn.innerHTML = "再開";
    btn.style.width = "auto";
    btn.style.height = "";

    app.setActionButtonBusy(btn, true);
    assert.strictEqual(btn.style.width, "92px");

    app.setActionButtonBusy(btn, false);
    assert.strictEqual(btn.style.width, "auto");
    assert.strictEqual(btn.style.height, "");
    assert.strictEqual(btn.innerHTML, "再開");
    assert.strictEqual(btn.disabled, false);
    assert(!btn.classList.contains("is-loading"));
    assert.strictEqual(btn.getAttribute("aria-busy"), null);
  });

  // -----------------------------------------------------------------------------
  // T15: spinner centered, margin-right removed during busy
  // -----------------------------------------------------------------------------
  await runTest("T15", "spinner centered, margin-right removed during busy in CSS", async () => {
    assert(styleCss.includes(".btn.is-loading,\n.hist-action-btn.is-loading {\n  display: inline-flex !important;\n  align-items: center !important;\n  justify-content: center !important;\n  box-sizing: border-box !important;\n}"),
      "CSS must declare display: inline-flex, center alignment for is-loading");
    assert(styleCss.includes(".btn.is-loading .btn-spinner,\n.hist-action-btn.is-loading .btn-spinner {\n  margin: 0 !important;\n}"),
      "CSS must declare margin: 0 !important for is-loading spinner");
  });

  // -----------------------------------------------------------------------------
  // T16: history print button no layout expansion
  // -----------------------------------------------------------------------------
  await runTest("T16", "history print button no layout expansion (spinner only)", async () => {
    const slip = { slipNo: "SCRAP-LW0001", status: "FINAL" };
    app.getFilteredHistorySlips().push(slip);
    app.getHistoryDetailCache().set("SCRAP-LW0001", slip);

    const btn = createMockElement("btn-hist-print", "button");
    btn._mockWidth = 60;
    btn._mockHeight = 44;
    btn.innerHTML = "印刷";

    app.printSlipFromHistory("SCRAP-LW0001", btn);

    assert.strictEqual(btn.innerHTML, '<span class="btn-spinner" aria-hidden="true"></span>');
    assert.strictEqual(btn.style.width, "60px");
    assert.strictEqual(btn.style.height, "44px");
  });

  // -----------------------------------------------------------------------------
  // T17: draft resume no layout expansion
  // -----------------------------------------------------------------------------
  await runTest("T17", "draft resume no layout expansion (spinner only)", async () => {
    app.setGasClientInstance({
      fetchSlip: async () => ({ success: true, slip: { slipNo: "DRAFT-1", status: "DRAFT" } })
    });
    const btn = createMockElement("btn-draft-resume", "button");
    btn._mockWidth = 64;
    btn._mockHeight = 44;
    btn.innerHTML = "再開";

    app.resumeDraftSlip("DRAFT-1", btn);

    assert.strictEqual(btn.innerHTML, '<span class="btn-spinner" aria-hidden="true"></span>');
    assert.strictEqual(btn.style.width, "64px");
    assert.strictEqual(btn.style.height, "44px");
  });

  // -----------------------------------------------------------------------------
  // T18: delete no layout expansion
  // -----------------------------------------------------------------------------
  await runTest("T18", "delete no layout expansion (spinner only)", async () => {
    app.setGasClientInstance({
      deleteDraft: async () => ({ success: true }),
      deleteFinalSlip: async () => ({ success: true })
    });

    const dBtn = createMockElement("btn-draft-del", "button");
    dBtn._mockWidth = 58;
    dBtn._mockHeight = 44;
    dBtn.innerHTML = "削除";

    app.executeDeleteDraft("DRAFT-DEL-1", dBtn);
    assert.strictEqual(dBtn.innerHTML, '<span class="btn-spinner" aria-hidden="true"></span>');
    assert.strictEqual(dBtn.style.width, "58px");

    const fBtn = document.getElementById("btn-hist-detail-delete");
    fBtn._mockWidth = 90;
    fBtn._mockHeight = 44;
    fBtn.innerHTML = "削除する";

    app.getHistoryDetailCache().set("SCRAP-LW0088", { slipNo: "SCRAP-LW0088", status: "FINAL" });
    app.openHistoryDetailModal("SCRAP-LW0088");

    app.handleHistoryDetailDelete();
    app.closeGenericModal(true);

    assert.strictEqual(fBtn.innerHTML, '<span class="btn-spinner" aria-hidden="true"></span>');
    assert.strictEqual(fBtn.style.width, "90px");
  });

  // -----------------------------------------------------------------------------
  // T19: setSubmissionBusy also spinner-only
  // -----------------------------------------------------------------------------
  await runTest("T19", "setSubmissionBusy also spinner-only (no 保存中... or 完了処理中...)", async () => {
    const draftBtn = document.getElementById("btn-save-draft");
    const finalizeBtn = document.getElementById("btn-finalize");
    const modalFinalizeBtn = document.getElementById("btn-modal-finalize");

    draftBtn.innerHTML = "一時保存";
    finalizeBtn.innerHTML = "完了";
    modalFinalizeBtn.innerHTML = "署名なしで完了";

    // Test draft busy
    app.setSubmissionBusy("draft", true);
    assert.strictEqual(draftBtn.innerHTML, '<span class="btn-spinner" aria-hidden="true"></span>');
    assert(!draftBtn.innerHTML.includes("保存中"));
    assert.strictEqual(finalizeBtn.disabled, true);

    // Test draft restore
    app.setSubmissionBusy("draft", false);
    assert.strictEqual(draftBtn.innerHTML, "一時保存");
    assert.strictEqual(draftBtn.disabled, false);

    // Test final busy
    app.setSubmissionBusy("final", true);
    assert.strictEqual(finalizeBtn.innerHTML, '<span class="btn-spinner" aria-hidden="true"></span>');
    assert.strictEqual(modalFinalizeBtn.innerHTML, '<span class="btn-spinner" aria-hidden="true"></span>');
    assert(!finalizeBtn.innerHTML.includes("完了処理中"));
    assert(!modalFinalizeBtn.innerHTML.includes("完了処理中"));

    // Test final restore
    app.setSubmissionBusy("final", false);
    assert.strictEqual(finalizeBtn.innerHTML, "完了");
    assert.strictEqual(modalFinalizeBtn.innerHTML, "署名なしで完了");
  });

  // -----------------------------------------------------------------------------
  // T20: double-click locks unchanged
  // -----------------------------------------------------------------------------
  await runTest("T20", "double-click locks unchanged", async () => {
    let calls = 0;
    app.setGasClientInstance({
      fetchSlip: async () => {
        calls++;
        await new Promise(r => setTimeout(r, 40));
        return { success: true, slip: { slipNo: "DRAFT-LOCK-1", status: "DRAFT" } };
      }
    });

    const btn = createMockElement("btn-l", "button");
    app.resumeDraftSlip("DRAFT-LOCK-1", btn);
    app.resumeDraftSlip("DRAFT-LOCK-1", btn);

    assert.strictEqual(calls, 1, "Concurrent call blocked by resume:<id> lock");
    await new Promise(r => setTimeout(r, 60));
  });

  // -----------------------------------------------------------------------------
  // T21: afterprint restore unchanged
  // -----------------------------------------------------------------------------
  await runTest("T21", "afterprint restore unchanged", async () => {
    let afterPrintCb = null;
    global.window.addEventListener = (evt, cb) => {
      if (evt === "afterprint") afterPrintCb = cb;
    };
    const slip = { slipNo: "SCRAP-LW0095", status: "FINAL" };
    app.getFilteredHistorySlips().push(slip);
    app.getHistoryDetailCache().set("SCRAP-LW0095", slip);

    const btn = createMockElement("btn-p-after", "button");
    btn.innerHTML = "印刷";

    app.printSlipFromHistory("SCRAP-LW0095", btn);
    assert(app.historyActionLocks.has("print:SCRAP-LW0095"));

    // Trigger afterprint
    assert(typeof afterPrintCb === "function");
    afterPrintCb();

    assert(!app.historyActionLocks.has("print:SCRAP-LW0095"));
    assert.strictEqual(btn.innerHTML, "印刷");
    assert.strictEqual(btn.disabled, false);
  });

  // -----------------------------------------------------------------------------
  // T22: PC 7-column table unchanged
  // -----------------------------------------------------------------------------
  await runTest("T22", "PC 7-column table layout contract unchanged (821px+)", async () => {
    assert(styleCss.includes(".history-table col.col-slip, .history-table th.col-slip, .history-table td.col-slip { width: 17% !important; }"));
    assert(styleCss.includes(".history-table col.col-date, .history-table th.col-date, .history-table td.col-date { width: 14% !important; }"));
    assert(styleCss.includes(".history-table col.col-staff, .history-table th.col-staff, .history-table td.col-staff { width: 13% !important; }"));
    assert(styleCss.includes(".history-table col.col-vendor, .history-table th.col-vendor, .history-table td.col-vendor { width: 16% !important; }"));
    assert(styleCss.includes(".history-table col.col-sig, .history-table th.col-sig, .history-table td.col-sig { width: 16% !important; }"));
    assert(styleCss.includes(".history-table col.col-status, .history-table th.col-status, .history-table td.col-status { width: 8% !important; text-align: center !important; }"));
    assert(styleCss.includes(".history-table col.col-actions, .history-table th.col-actions, .history-table td.col-actions { width: 16% !important; text-align: center !important; }"));
  });

  // -----------------------------------------------------------------------------
  // T23: mobile full-width cards unchanged
  // -----------------------------------------------------------------------------
  await runTest("T23", "mobile full-width cards layout contract unchanged", async () => {
    const media820Match = styleCss.match(/@media\s*\(\s*max-width\s*:\s*820px\s*\)\s*\{([\s\S]*?)\n\}/);
    assert(media820Match, "@media (max-width: 820px) must exist");
    const media820 = media820Match[1];

    assert(media820.includes(".history-table {\n    display: block !important;\n    width: 100% !important;\n    min-width: 0 !important;\n    table-layout: auto !important;\n    border-collapse: separate !important;\n  }"));
    assert(media820.includes(".history-table colgroup {\n    display: none !important;\n  }"));
    assert(media820.includes(".history-col-mobile {\n    display: block !important;\n    width: 100% !important;"));
  });

  // -----------------------------------------------------------------------------
  // T24: 320/375/390/430 no horizontal overflow
  // -----------------------------------------------------------------------------
  await runTest("T24", "320/375/390/430 no horizontal overflow in CSS", async () => {
    const media820Match = styleCss.match(/@media\s*\(\s*max-width\s*:\s*820px\s*\)\s*\{([\s\S]*?)\n\}/);
    const media820 = media820Match[1];

    assert(media820.includes(".history-sort-bar {\n    display: flex;\n    flex-wrap: wrap;\n    align-items: center;\n    justify-content: flex-end;\n    gap: 6px;\n    margin-bottom: 8px;\n    width: 100%;\n    box-sizing: border-box;\n  }"),
      "Mobile sort bar must allow flex-wrap and have width 100% box-sizing: border-box");
    assert(media820.includes("box-sizing: border-box !important;"));
    assert(media820.includes("max-width: 100% !important;"));
  });

  // -----------------------------------------------------------------------------
  // T25: OPERATION-UX-20261007-03 unified
  // -----------------------------------------------------------------------------
  await runTest("T25", "OPERATION-UX-20261007-03 unified across HTML, CSS, JS", async () => {
    const targetRev = "OPERATION-UX-20261007-03";
    assert(appJs.includes(`const SCRAP_APP_RUNTIME_REV = "${targetRev}";`), `app.js must declare SCRAP_APP_RUNTIME_REV = ${targetRev}`);
    assert(styleCss.includes(`--scrap-style-runtime-rev: "${targetRev}";`), `style.css must declare --scrap-style-runtime-rev: "${targetRev}"`);
    assert(indexHtml.includes(`id="diag-html-build">${targetRev}</span>`), `index.html must display diag-html-build = ${targetRev}`);
    assert(indexHtml.includes(`Build: ${targetRev}`), `index.html must display Build: ${targetRev}`);
    assert(indexHtml.includes(`style.css?v=${targetRev}`), `index.html must link style.css with v=${targetRev}`);
    assert(indexHtml.includes(`app.js?v=${targetRev}`), `index.html must link app.js with v=${targetRev}`);
    assert(indexHtml.includes('manifest.webmanifest?v=APP-ICON-20261001-01'), "APP ICON version APP-ICON-20261001-01 must remain unchanged");
  });

  console.log("================================================================================");
  console.log(`HISTORY UI REFINEMENT TESTS COMPLETE: ${testsPassed} passed, ${testsFailed} failed`);
  console.log("================================================================================");

  if (testsFailed > 0) {
    process.exit(1);
  }
}

main().catch(err => {
  console.error("Unhandled test suite error:", err);
  process.exit(1);
});
