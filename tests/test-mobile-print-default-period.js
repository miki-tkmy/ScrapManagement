// test-mobile-print-default-period.js
// Focused Automated Test Suite for ScrapManagement MOBILE PRINT / DEFAULT PERIOD REFINEMENT
// Testing T1 through T25 per Section 26 specifications

const fs = require("fs");
const path = require("path");
const assert = require("assert");

console.log("================================================================================");
console.log("ScrapManagement - MOBILE PRINT / DEFAULT PERIOD TESTS (T1..T25)");
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
  getHistoryCache: () => null,
  isStateSnapshotFresh: () => false,
  getStateSnapshot: () => null,
  saveStateSnapshot: () => {},
  setLastStateCheckTime: () => {},
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
  app.setGasClientInstance({
    fetchState: async () => ({ success: true, historyRevision: 1 }),
    fetchSlip: async () => ({ success: false }),
    fetchHistory: async () => ({ success: true, finalSlips: [], draftSlips: [] })
  });
  app.initUserSettings();

  // -----------------------------------------------------------------------------
  // T1: getDefaultHistoryPeriod exists
  // -----------------------------------------------------------------------------
  await runTest("T1", "getDefaultHistoryPeriod exists and is a function", async () => {
    assert.strictEqual(typeof app.getDefaultHistoryPeriod, "function", "app.getDefaultHistoryPeriod must be a function");
  });

  // -----------------------------------------------------------------------------
  // T2: 2026-10-07: from=2026-09-01, to=2026-10-31
  // -----------------------------------------------------------------------------
  await runTest("T2", "2026-10-07 yields from=2026-09-01 and to=2026-10-31", async () => {
    const period = app.getDefaultHistoryPeriod("2026-10-07");
    assert.strictEqual(period.fromDate, "2026-09-01", "fromDate must be previous month 1st");
    assert.strictEqual(period.toDate, "2026-10-31", "toDate must be current month last day");
  });

  // -----------------------------------------------------------------------------
  // T3: 2027-01-15: from=2026-12-01, to=2027-01-31 (Year boundary)
  // -----------------------------------------------------------------------------
  await runTest("T3", "2027-01-15 year boundary yields from=2026-12-01 and to=2027-01-31", async () => {
    const period = app.getDefaultHistoryPeriod("2027-01-15");
    assert.strictEqual(period.fromDate, "2026-12-01", "fromDate across year must be previous year December 1st");
    assert.strictEqual(period.toDate, "2027-01-31", "toDate must be January 31st");
  });

  // -----------------------------------------------------------------------------
  // T4: leap year February correctly handled
  // -----------------------------------------------------------------------------
  await runTest("T4", "leap year February correctly handled (2028-02-10 -> 29 days, 2027-02-10 -> 28 days)", async () => {
    const leap = app.getDefaultHistoryPeriod("2028-02-10");
    assert.strictEqual(leap.fromDate, "2028-01-01");
    assert.strictEqual(leap.toDate, "2028-02-29", "2028 is a leap year; February has 29 days");

    const nonLeap = app.getDefaultHistoryPeriod("2027-02-10");
    assert.strictEqual(nonLeap.fromDate, "2027-01-01");
    assert.strictEqual(nonLeap.toDate, "2027-02-28", "2027 is a non-leap year; February has 28 days");
  });

  // -----------------------------------------------------------------------------
  // T5: historySearchState initialized with default period
  // -----------------------------------------------------------------------------
  await runTest("T5", "historySearchState initialized with default period on initHistorySearchDefaults", async () => {
    app.initHistorySearchDefaults();
    const state = app.getHistorySearchState();
    const period = app.getDefaultHistoryPeriod();
    assert.strictEqual(state.fromDate, period.fromDate, "historySearchState.fromDate must match defaultPeriod.fromDate");
    assert.strictEqual(state.toDate, period.toDate, "historySearchState.toDate must match defaultPeriod.toDate");
  });

  // -----------------------------------------------------------------------------
  // T6: date input UI receives same initial values
  // -----------------------------------------------------------------------------
  await runTest("T6", "date input UI receives same initial values", async () => {
    app.initHistorySearchDefaults();
    const fromEl = document.getElementById("history-search-from");
    const toEl = document.getElementById("history-search-to");
    const period = app.getDefaultHistoryPeriod();
    assert.strictEqual(fromEl.value, period.fromDate, "from input must have period.fromDate value");
    assert.strictEqual(toEl.value, period.toDate, "to input must have period.toDate value");
  });

  // -----------------------------------------------------------------------------
  // T7: initial filter excludes records older than previous month
  // -----------------------------------------------------------------------------
  await runTest("T7", "initial filter excludes records older than previous month", async () => {
    const mockSlips = [
      { slipNo: "OLD-1", date: "2026-08-20", status: "FINAL" },
      { slipNo: "PREV-1", date: "2026-09-10", status: "FINAL" },
      { slipNo: "CURR-1", date: "2026-10-05", status: "FINAL" }
    ];
    const period = app.getDefaultHistoryPeriod("2026-10-07");
    const searchState = {
      fromDate: period.fromDate,
      toDate: period.toDate,
      keyword: "",
      signatureStatus: "ALL",
      sortField: "DATE",
      sortOrder: "DESC"
    };

    const filtered = app.applyHistoryFilters(mockSlips, searchState);
    const slipNos = filtered.map(s => s.slipNo);
    assert(!slipNos.includes("OLD-1"), "Records older than previous month must be excluded");
  });

  // -----------------------------------------------------------------------------
  // T8: current month included
  // -----------------------------------------------------------------------------
  await runTest("T8", "current month included in filtered slips", async () => {
    const mockSlips = [
      { slipNo: "CURR-1", date: "2026-10-05", status: "FINAL" },
      { slipNo: "CURR-2", date: "2026-10-31", status: "FINAL" }
    ];
    const period = app.getDefaultHistoryPeriod("2026-10-07");
    const searchState = {
      fromDate: period.fromDate,
      toDate: period.toDate,
      keyword: "",
      signatureStatus: "ALL",
      sortField: "DATE",
      sortOrder: "DESC"
    };

    const filtered = app.applyHistoryFilters(mockSlips, searchState);
    assert.strictEqual(filtered.length, 2, "Current month slips must all be included");
  });

  // -----------------------------------------------------------------------------
  // T9: previous month included
  // -----------------------------------------------------------------------------
  await runTest("T9", "previous month included in filtered slips", async () => {
    const mockSlips = [
      { slipNo: "PREV-1", date: "2026-09-01", status: "FINAL" },
      { slipNo: "PREV-2", date: "2026-09-30", status: "FINAL" }
    ];
    const period = app.getDefaultHistoryPeriod("2026-10-07");
    const searchState = {
      fromDate: period.fromDate,
      toDate: period.toDate,
      keyword: "",
      signatureStatus: "ALL",
      sortField: "DATE",
      sortOrder: "DESC"
    };

    const filtered = app.applyHistoryFilters(mockSlips, searchState);
    assert.strictEqual(filtered.length, 2, "Previous month slips must all be included");
  });

  // -----------------------------------------------------------------------------
  // T10: handleHistorySearchClear returns blank From/To and all-history behavior
  // -----------------------------------------------------------------------------
  await runTest("T10", "handleHistorySearchClear returns blank From/To and all-history behavior", async () => {
    const fromEl = document.getElementById("history-search-from");
    const toEl = document.getElementById("history-search-to");
    fromEl.value = "2026-09-01";
    toEl.value = "2026-10-31";

    app.handleHistorySearchClear();

    assert.strictEqual(fromEl.value, "", "From input must be reset to empty");
    assert.strictEqual(toEl.value, "", "To input must be reset to empty");
    const state = app.getHistorySearchState();
    assert.strictEqual(state.fromDate, "", "state.fromDate must be reset to empty");
    assert.strictEqual(state.toDate, "", "state.toDate must be reset to empty");
  });

  // -----------------------------------------------------------------------------
  // T11: tab switch does not reset user-selected dates
  // -----------------------------------------------------------------------------
  await runTest("T11", "tab switch does not reset user-selected dates", async () => {
    const state = app.getHistorySearchState();
    state.fromDate = "2026-01-01";
    state.toDate = "2026-06-30";

    // Simulate tab switch to settings then back to history
    app.switchTab("settings");
    app.switchTab("history");

    assert.strictEqual(state.fromDate, "2026-01-01", "User-selected fromDate must be preserved across tab switches");
    assert.strictEqual(state.toDate, "2026-06-30", "User-selected toDate must be preserved across tab switches");
  });

  // -----------------------------------------------------------------------------
  // T12: reload/bootstrap does reset to new default period
  // -----------------------------------------------------------------------------
  await runTest("T12", "reload/bootstrap does reset to new default period", async () => {
    app.initHistorySearchDefaults();
    const state = app.getHistorySearchState();
    const period = app.getDefaultHistoryPeriod();
    assert.strictEqual(state.fromDate, period.fromDate);
    assert.strictEqual(state.toDate, period.toDate);
  });

  // -----------------------------------------------------------------------------
  // T13: mobile history print button hidden
  // -----------------------------------------------------------------------------
  await runTest("T13", "mobile history print button hidden via CSS (.history-col-mobile .hist-print-btn)", async () => {
    const media820Match = styleCss.match(/@media\s*\(\s*max-width\s*:\s*820px\s*\)\s*\{([\s\S]*?)\n\}/);
    assert(media820Match, "@media (max-width: 820px) must exist");
    const media820 = media820Match[1];

    assert(media820.includes(".history-col-mobile .hist-print-btn {\n    display: none !important;\n  }"),
      "CSS must hide .history-col-mobile .hist-print-btn at 820px breakpoint");
  });

  // -----------------------------------------------------------------------------
  // T14: mobile detail-modal print button hidden
  // -----------------------------------------------------------------------------
  await runTest("T14", "mobile detail-modal print button hidden via CSS (#btn-hist-detail-print)", async () => {
    const media820Match = styleCss.match(/@media\s*\(\s*max-width\s*:\s*820px\s*\)\s*\{([\s\S]*?)\n\}/);
    assert(media820Match, "@media (max-width: 820px) must exist");
    const media820 = media820Match[1];

    assert(media820.includes("#btn-hist-detail-print {\n    display: none !important;\n  }"),
      "CSS must hide #btn-hist-detail-print at 820px breakpoint");
    assert(indexHtml.includes('id="btn-hist-detail-print"'), "#btn-hist-detail-print must exist in DOM");
  });

  // -----------------------------------------------------------------------------
  // T15: desktop history print button remains visible
  // -----------------------------------------------------------------------------
  await runTest("T15", "desktop history print button remains in renderHistoryRows and CSS", async () => {
    assert(appJs.includes('<button type="button" class="btn btn-secondary hist-action-btn hist-print-btn" onclick="printSlipFromHistory('),
      "renderHistoryRows must render print button with hist-print-btn class");
    const outsideMedia = styleCss.replace(/@media[^{]+\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, "");
    assert(!outsideMedia.includes(".hist-print-btn {\n  display: none"), "Desktop print button must not be hidden globally");
  });

  // -----------------------------------------------------------------------------
  // T16: printSlipFromHistory function remains
  // -----------------------------------------------------------------------------
  await runTest("T16", "printSlipFromHistory function remains intact", async () => {
    assert.strictEqual(typeof app.printSlipFromHistory, "function");
  });

  // -----------------------------------------------------------------------------
  // T17: handleHistoryDetailPrint function remains
  // -----------------------------------------------------------------------------
  await runTest("T17", "handleHistoryDetailPrint function remains intact", async () => {
    assert.strictEqual(typeof app.handleHistoryDetailPrint, "function");
  });

  // -----------------------------------------------------------------------------
  // T18: print route / afterprint lock remains
  // -----------------------------------------------------------------------------
  await runTest("T18", "print route / afterprint lock remains", async () => {
    assert(appJs.includes("attachPrintBusyRelease("));
    assert(appJs.includes("window.addEventListener(\"afterprint\""));
    assert(appJs.includes("historyActionLocks.delete(lockKey)"));
  });

  // -----------------------------------------------------------------------------
  // T19: mobile detail button remains visible
  // -----------------------------------------------------------------------------
  await runTest("T19", "mobile detail button remains visible in renderHistoryRows", async () => {
    assert(appJs.includes("<button type=\"button\" class=\"btn btn-secondary btn-sm hist-action-btn\" onclick=\"openHistoryDetailModal("));
  });

  // -----------------------------------------------------------------------------
  // T20: mobile card layout does not leave awkward blank space
  // -----------------------------------------------------------------------------
  await runTest("T20", "mobile card layout preserves margin-right: auto on sig badge", async () => {
    const media820Match = styleCss.match(/@media\s*\(\s*max-width\s*:\s*820px\s*\)\s*\{([\s\S]*?)\n\}/);
    const media820 = media820Match[1];
    assert(media820.includes(".hist-actions .hist-sig-badge {\n    margin-right: auto !important;\n    flex-shrink: 0 !important;\n    white-space: nowrap !important;\n  }"),
      "CSS must preserve margin-right: auto !important on hist-sig-badge to push detail button to right");
  });

  // -----------------------------------------------------------------------------
  // T21: PC 7-column layout unchanged
  // -----------------------------------------------------------------------------
  await runTest("T21", "PC 7-column layout contract unchanged", async () => {
    assert(styleCss.includes(".history-table col.col-slip, .history-table th.col-slip, .history-table td.col-slip { width: 17% !important; }"));
    assert(styleCss.includes(".history-table col.col-date, .history-table th.col-date, .history-table td.col-date { width: 14% !important; }"));
    assert(styleCss.includes(".history-table col.col-staff, .history-table th.col-staff, .history-table td.col-staff { width: 13% !important; }"));
    assert(styleCss.includes(".history-table col.col-vendor, .history-table th.col-vendor, .history-table td.col-vendor { width: 16% !important; }"));
    assert(styleCss.includes(".history-table col.col-sig, .history-table th.col-sig, .history-table td.col-sig { width: 16% !important; }"));
    assert(styleCss.includes(".history-table col.col-status, .history-table th.col-status, .history-table td.col-status { width: 8% !important; text-align: center !important; }"));
    assert(styleCss.includes(".history-table col.col-actions, .history-table th.col-actions, .history-table td.col-actions { width: 16% !important; text-align: center !important; }"));
  });

  // -----------------------------------------------------------------------------
  // T22: sort unchanged
  // -----------------------------------------------------------------------------
  await runTest("T22", "sort unchanged (DATE and SLIP_NO deterministic sort)", async () => {
    const slips = [
      { slipNo: "SCRAP-LW0001", date: "2026-10-01" },
      { slipNo: "SCRAP-LW0003", date: "2026-10-07" },
      { slipNo: "SCRAP-LW0002", date: "2026-10-04" }
    ];
    const desc = app.sortFinalHistorySlips(slips, "DATE", "DESC");
    assert.strictEqual(desc[0].slipNo, "SCRAP-LW0003");
    assert.strictEqual(desc[1].slipNo, "SCRAP-LW0002");
    assert.strictEqual(desc[2].slipNo, "SCRAP-LW0001");
  });

  // -----------------------------------------------------------------------------
  // T23: CSV current filtered order unchanged
  // -----------------------------------------------------------------------------
  await runTest("T23", "CSV uses filteredHistorySlips or filtered slips in current sort order", async () => {
    assert(appJs.includes("filteredHistorySlips"), "exportHistoryCsv must refer to filteredHistorySlips");
    const testSlips = [
      { slipNo: "SLIP-01", date: "2026-10-07", staffName: "担当", baseName: "基地", itemsSummary: "鉄: 10kg" }
    ];
    const csvContent = app.generateHistoryHeaderCsv(testSlips);
    assert(csvContent.includes("SLIP-01"), "generateHistoryHeaderCsv must output slip data");
  });

  // -----------------------------------------------------------------------------
  // T24: spinner-only busy unchanged
  // -----------------------------------------------------------------------------
  await runTest("T24", "spinner-only busy unchanged", async () => {
    const btn = createMockElement("btn-sp", "button");
    btn.innerHTML = "印刷";
    app.setActionButtonBusy(btn, true);
    assert.strictEqual(btn.innerHTML, '<span class="btn-spinner" aria-hidden="true"></span>');
    app.setActionButtonBusy(btn, false);
    assert.strictEqual(btn.innerHTML, "印刷");
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
  console.log(`MOBILE PRINT / DEFAULT PERIOD TESTS COMPLETE: ${testsPassed} passed, ${testsFailed} failed`);
  console.log("================================================================================");

  if (testsFailed > 0) {
    process.exit(1);
  }
}

main().catch(err => {
  console.error("Unhandled test suite error:", err);
  process.exit(1);
});
