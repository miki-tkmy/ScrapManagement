// test-mobile-history-layout.js
// Focused Automated Test Suite for ScrapManagement MOBILE HISTORY LAYOUT FIX
// Testing T1 through T12 per Section 17 specifications

const fs = require("fs");
const path = require("path");
const assert = require("assert");
const vm = require("vm");

console.log("================================================================================");
console.log("ScrapManagement - MOBILE HISTORY LAYOUT FIX TESTS (T1..T12)");
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

// Helper to extract CSS block inside @media (max-width: 820px)
function get820MediaBlock(css) {
  const match = css.match(/@media\s*\(\s*max-width\s*:\s*820px\s*\)\s*\{([\s\S]*?)\n\}/);
  assert(match, "Must find @media (max-width: 820px) in style.css");
  return match[1];
}

const media820 = get820MediaBlock(styleCss);

// Helper for Mock DOM environment to test renderHistoryRows
function setupMockEnv() {
  const elements = {};
  function createElement(tag) {
    const el = {
      tagName: tag.toUpperCase(),
      className: "",
      style: {},
      children: [],
      innerHTML: "",
      textContent: "",
      appendChild(child) {
        this.children.push(child);
      },
      setAttribute(name, val) {
        this[name] = val;
      },
      getAttribute(name) {
        return this[name];
      }
    };
    return el;
  }

  const document = {
    createElement,
    getElementById(id) {
      if (!elements[id]) {
        elements[id] = createElement("div");
      }
      return elements[id];
    }
  };

  const sandbox = {
    console,
    document,
    window: {
      location: { search: "" },
      addEventListener: () => {}
    },
    historySearchState: {
      fromDate: "",
      toDate: "",
      keyword: "",
      signatureStatus: "ALL",
      visibleCount: 50
    },
    centralHistorySlips: [],
    filteredHistorySlips: [],
    historyDetailCache: new Map(),
    resolvedBaseName: "本社工場",
    workingBaseName: "本社工場",
    formatJstDate: (d) => "2026/10/01",
    escapeHtml: (s) => (s ? String(s).replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`) : ""),
    applyHistoryFilters: (slips) => slips,
    openHistoryDetailModal: () => {},
    printSlipFromHistory: () => {}
  };

  vm.createContext(sandbox);

  // Extract and evaluate renderHistoryRows and related definitions
  const renderCode = appJs.match(/function renderHistoryRows\([\s\S]*?\n\}/)[0];
  vm.runInContext(renderCode, sandbox);

  return { sandbox, document, elements };
}

async function main() {
  // -----------------------------------------------------------------------------
  // T1: mobile .history-table display:block
  // -----------------------------------------------------------------------------
  await runTest("T1", "mobile .history-table display:block & table-layout:auto reset", async () => {
    const match = media820.match(/\.history-table\s*\{([^}]+)\}/);
    assert(match, ".history-table must be defined inside @media (max-width: 820px)");
    const block = match[1];
    assert(/display:\s*block\s*!important/i.test(block), "display: block !important required for .history-table");
    assert(/width:\s*100%\s*!important/i.test(block), "width: 100% !important required for .history-table");
    assert(/table-layout:\s*auto\s*!important/i.test(block), "table-layout: auto !important required for .history-table");
    assert(/border-collapse:\s*separate\s*!important/i.test(block), "border-collapse: separate !important required for .history-table");
  });

  // -----------------------------------------------------------------------------
  // T2: mobile colgroup display:none
  // -----------------------------------------------------------------------------
  await runTest("T2", "mobile colgroup display:none & thead display:none", async () => {
    const colgroupMatch = media820.match(/\.history-table\s+colgroup\s*\{([^}]+)\}/);
    assert(colgroupMatch, ".history-table colgroup must be defined inside @media (max-width: 820px)");
    assert(/display:\s*none\s*!important/i.test(colgroupMatch[1]), "display: none !important required for .history-table colgroup");

    const theadMatch = media820.match(/\.history-table\s+thead\s*\{([^}]+)\}/);
    assert(theadMatch, ".history-table thead must be defined inside @media (max-width: 820px)");
    assert(/display:\s*none\s*!important/i.test(theadMatch[1]), "display: none !important required for .history-table thead");
  });

  // -----------------------------------------------------------------------------
  // T3: mobile tbody/tr/td width 100%
  // -----------------------------------------------------------------------------
  await runTest("T3", "mobile tbody/tr/td width 100% and card styling", async () => {
    const tbodyMatch = media820.match(/\.history-table\s+tbody\s*\{([^}]+)\}/);
    assert(tbodyMatch, ".history-table tbody must be defined inside @media (max-width: 820px)");
    assert(/display:\s*block\s*!important/i.test(tbodyMatch[1]), "tbody display: block !important");
    assert(/width:\s*100%\s*!important/i.test(tbodyMatch[1]), "tbody width: 100% !important");

    const trMatch = media820.match(/\.history-table\s+tbody\s+tr\s*\{([^}]+)\}/);
    assert(trMatch, ".history-table tbody tr must be defined inside @media (max-width: 820px)");
    assert(/display:\s*block\s*!important/i.test(trMatch[1]), "tr display: block !important");
    assert(/width:\s*100%\s*!important/i.test(trMatch[1]), "tr width: 100% !important");
    assert(/box-sizing:\s*border-box\s*!important/i.test(trMatch[1]), "tr box-sizing: border-box !important");
    assert(/margin-bottom:\s*8px/i.test(trMatch[1]), "tr margin-bottom: 8px");

    const tdMatch = media820.match(/\.history-col-mobile\s*\{([^}]+)\}/);
    assert(tdMatch, ".history-col-mobile must be defined inside @media (max-width: 820px)");
    assert(/display:\s*block\s*!important/i.test(tdMatch[1]), "td display: block !important");
    assert(/width:\s*100%\s*!important/i.test(tdMatch[1]), "td width: 100% !important");
    assert(/box-sizing:\s*border-box\s*!important/i.test(tdMatch[1]), "td box-sizing: border-box !important");
    assert(/padding:\s*12px\s+14px/i.test(tdMatch[1]), "td padding: 12px 14px");
  });

  // -----------------------------------------------------------------------------
  // T4: desktop colgroup 7-column contract unchanged
  // -----------------------------------------------------------------------------
  await runTest("T4", "desktop colgroup 7-column contract unchanged (821px+)", async () => {
    // Check outside @media (max-width: 820px)
    assert(styleCss.includes(".history-table col.col-slip, .history-table th.col-slip, .history-table td.col-slip { width: 17% !important; }"));
    assert(styleCss.includes(".history-table col.col-date, .history-table th.col-date, .history-table td.col-date { width: 14% !important; }"));
    assert(styleCss.includes(".history-table col.col-staff, .history-table th.col-staff, .history-table td.col-staff { width: 13% !important; }"));
    assert(styleCss.includes(".history-table col.col-vendor, .history-table th.col-vendor, .history-table td.col-vendor { width: 16% !important; }"));
    assert(styleCss.includes(".history-table col.col-sig, .history-table th.col-sig, .history-table td.col-sig { width: 16% !important; }"));
    assert(styleCss.includes(".history-table col.col-status, .history-table th.col-status, .history-table td.col-status { width: 8% !important; text-align: center !important; }"));
    assert(styleCss.includes(".history-table col.col-actions, .history-table th.col-actions, .history-table td.col-actions { width: 16% !important; text-align: center !important; }"));

    // Desktop table-layout: fixed intact
    assert(styleCss.includes(".history-table {\n  width: 100% !important;\n  min-width: 0 !important;\n  table-layout: fixed !important;\n  border-collapse: collapse !important;\n}"));
    // Default visibility
    assert(styleCss.includes(".history-col-mobile {\n  display: none;\n}"));
    assert(styleCss.includes(".hist-desktop-col {\n  display: table-cell;\n}"));
  });

  // -----------------------------------------------------------------------------
  // T5: mobile slipNo nowrap
  // -----------------------------------------------------------------------------
  await runTest("T5", "mobile slipNo nowrap, word-break normal, overflow-wrap normal, flex-shrink 0", async () => {
    const match = media820.match(/\.hist-slip-no\s*\{([^}]+)\}/);
    assert(match, ".hist-slip-no must be styled in mobile media query");
    const block = match[1];
    assert(/white-space:\s*nowrap\s*!important/i.test(block), "white-space: nowrap !important required for .hist-slip-no");
    assert(/word-break:\s*normal\s*!important/i.test(block), "word-break: normal !important required for .hist-slip-no");
    assert(/overflow-wrap:\s*normal\s*!important/i.test(block), "overflow-wrap: normal !important required for .hist-slip-no");
    assert(/flex-shrink:\s*0\s*!important/i.test(block), "flex-shrink: 0 !important required for .hist-slip-no");
  });

  // -----------------------------------------------------------------------------
  // T6: mobile staff nowrap / normal layout
  // -----------------------------------------------------------------------------
  await runTest("T6", "mobile staff nowrap / ellipsis / left-aligned normal layout", async () => {
    const match = media820.match(/\.hist-staff\s*\{([^}]+)\}/);
    assert(match, ".hist-staff must be styled in mobile media query");
    const block = match[1];
    assert(/white-space:\s*nowrap\s*!important/i.test(block), "white-space: nowrap !important for .hist-staff");
    assert(/text-align:\s*left\s*!important/i.test(block), "text-align: left !important for .hist-staff");
    assert(/overflow:\s*hidden\s*!important/i.test(block), "overflow: hidden !important for .hist-staff");
    assert(/text-overflow:\s*ellipsis\s*!important/i.test(block), "text-overflow: ellipsis !important for .hist-staff");
    assert(/margin-right:\s*auto\s*!important/i.test(block), "margin-right: auto !important for .hist-staff");
  });

  // -----------------------------------------------------------------------------
  // T7: mobile statusBadge rendered
  // -----------------------------------------------------------------------------
  await runTest("T7", "mobile statusBadge rendered in .history-row-2", async () => {
    const { sandbox, document } = setupMockEnv();
    const tbody = document.createElement("tbody");

    const sampleSlips = [
      {
        slipNo: "SCRAP-LW0009",
        date: "2026-10-01",
        staffName: "三木 諒大",
        vendorName: "三木商事",
        signatureStatus: "DIGITAL",
        status: "FINAL"
      }
    ];

    sandbox.renderHistoryRows(tbody, sampleSlips);
    assert.strictEqual(tbody.children.length, 1);
    const tr = tbody.children[0];
    const html = tr.innerHTML;

    assert(html.includes('<div class="history-row-2">'), "Must include history-row-2");
    assert(html.includes('<span class="hist-mobile-status">'), "Must include hist-mobile-status");
    assert(html.includes('三木 諒大'), "Must include staff name");
  });

  // -----------------------------------------------------------------------------
  // T8: FINAL mobile status = 完了
  // -----------------------------------------------------------------------------
  await runTest("T8", "FINAL mobile status = 完了 badge rendered", async () => {
    const { sandbox, document } = setupMockEnv();
    const tbody = document.createElement("tbody");

    const sampleSlips = [
      {
        slipNo: "SCRAP-LW0009",
        date: "2026-10-01",
        staffName: "三木 諒大",
        signatureStatus: "DIGITAL",
        status: "FINAL"
      }
    ];

    sandbox.renderHistoryRows(tbody, sampleSlips);
    const tr = tbody.children[0];
    assert.strictEqual(tr.className, ""); // not deleted
    assert(tr.innerHTML.includes('<span class="hist-mobile-status"><span class="brand-badge" style="background:var(--color-primary); color:var(--color-button-text); font-size:0.75rem;">完了</span></span>'), "Must render 完了 status badge in mobile status slot");
  });

  // -----------------------------------------------------------------------------
  // T9: DELETED mobile status = 削除済み
  // -----------------------------------------------------------------------------
  await runTest("T9", "DELETED mobile status = 削除済み badge and hist-row-deleted class", async () => {
    const { sandbox, document } = setupMockEnv();
    const tbody = document.createElement("tbody");

    const sampleSlips = [
      {
        slipNo: "SCRAP-LW0010",
        date: "2026-10-01",
        staffName: "田中 一郎",
        signatureStatus: "NONE",
        status: "DELETED"
      }
    ];

    sandbox.renderHistoryRows(tbody, sampleSlips);
    const tr = tbody.children[0];
    assert.strictEqual(tr.className, "hist-row-deleted", "Must have hist-row-deleted class");
    assert(tr.innerHTML.includes('<span class="hist-mobile-status"><span class="brand-badge" style="background:#6b7280; color:#fff; font-size:0.75rem;">削除済み</span></span>'), "Must render 削除済み badge in mobile status slot");
  });

  // -----------------------------------------------------------------------------
  // T10: mobile sigBadge + 詳細 + 印刷 all rendered
  // -----------------------------------------------------------------------------
  await runTest("T10", "mobile sigBadge + 詳細 + 印刷 all rendered with min-height 44px style", async () => {
    const { sandbox, document } = setupMockEnv();
    const tbody = document.createElement("tbody");

    const sampleSlips = [
      {
        slipNo: "SCRAP-LW0009",
        date: "2026-10-01",
        staffName: "三木 諒大",
        signatureStatus: "DIGITAL",
        status: "FINAL"
      }
    ];

    sandbox.renderHistoryRows(tbody, sampleSlips);
    const tr = tbody.children[0];
    const html = tr.innerHTML;

    assert(html.includes("電子署名済み"), "Must render 電子署名済み badge");
    assert(html.includes("openHistoryDetailModal('SCRAP-LW0009')"), "Must render 詳細 button with handler");
    assert(html.includes("printSlipFromHistory('SCRAP-LW0009')"), "Must render 印刷 button with handler");

    // CSS verification for buttons and actions
    const actionsMatch = media820.match(/\.hist-actions\s*\{([^}]+)\}/);
    assert(actionsMatch, ".hist-actions must be styled in mobile media query");
    assert(/display:\s*flex\s*!important/i.test(actionsMatch[1]), "display: flex !important for .hist-actions");
    assert(/flex-wrap:\s*nowrap\s*!important/i.test(actionsMatch[1]), "flex-wrap: nowrap !important for .hist-actions");

    const sigBadgeMatch = media820.match(/\.hist-actions\s+\.hist-sig-badge\s*\{([^}]+)\}/);
    assert(sigBadgeMatch, ".hist-sig-badge inside .hist-actions must be styled in mobile media query");
    assert(/margin-right:\s*auto\s*!important/i.test(sigBadgeMatch[1]), "margin-right: auto !important for .hist-sig-badge");

    const btnMatch = media820.match(/\.hist-actions\s+\.hist-action-btn\s*\{([^}]+)\}/);
    assert(btnMatch, ".hist-action-btn inside .hist-actions must be styled in mobile media query");
    assert(/min-height:\s*44px\s*!important/i.test(btnMatch[1]), "min-height: 44px !important for mobile action buttons");
    assert(/padding:\s*0\s+0\.7rem\s*!important/i.test(btnMatch[1]), "padding: 0 0.7rem !important for mobile action buttons");
  });

  // -----------------------------------------------------------------------------
  // T11: DELETED print disabled
  // -----------------------------------------------------------------------------
  await runTest("T11", "DELETED mobile print disabled, detail remains active", async () => {
    const { sandbox, document } = setupMockEnv();
    const tbody = document.createElement("tbody");

    const sampleSlips = [
      {
        slipNo: "SCRAP-LW0010",
        date: "2026-10-01",
        staffName: "田中 一郎",
        signatureStatus: "NONE",
        status: "DELETED"
      }
    ];

    sandbox.renderHistoryRows(tbody, sampleSlips);
    const tr = tbody.children[0];
    const html = tr.innerHTML;

    // Mobile print button must be disabled
    assert(html.includes('<button type="button" class="btn btn-secondary btn-sm hist-action-btn" disabled style="opacity:0.5; cursor:not-allowed;">印刷</button>'), "Mobile print button must be disabled for DELETED slip");

    // Detail button must remain active
    assert(html.includes('<button type="button" class="btn btn-secondary btn-sm hist-action-btn" onclick="openHistoryDetailModal(\'SCRAP-LW0010\')">詳細</button>'), "Mobile detail button must remain active for DELETED slip");
  });

  // -----------------------------------------------------------------------------
  // T12: 320/375/390/430 CSS layout contract no horizontal overflow & unified release
  // -----------------------------------------------------------------------------
  await runTest("T12", "320/375/390/430 CSS layout contract: no horizontal overflow & unified release", async () => {
    // 1. Check overflow constraints
    assert(styleCss.includes("#view-history,\n#view-history .card,\n#view-history .materials-table-wrapper {\n  overflow-x: hidden !important;\n  width: 100% !important;\n  box-sizing: border-box !important;\n}"));
    assert(media820.includes("box-sizing: border-box !important;"));
    assert(media820.includes("max-width: 100% !important;"));

    // 2. Check unified Release ID
    const targetRev = "OPERATION-ENHANCEMENT-20261001-03";
    assert(appJs.includes(`const SCRAP_APP_RUNTIME_REV = "${targetRev}";`), `app.js must declare SCRAP_APP_RUNTIME_REV = ${targetRev}`);
    assert(styleCss.includes(`--scrap-style-runtime-rev: "${targetRev}";`), `style.css must declare --scrap-style-runtime-rev: "${targetRev}"`);
    assert(indexHtml.includes(`id="diag-html-build">${targetRev}</span>`), `index.html must display diag-html-build = ${targetRev}`);
    assert(indexHtml.includes(`Build: ${targetRev}`), `index.html must display Build: ${targetRev}`);
    assert(indexHtml.includes(`style.css?v=${targetRev}`), `index.html must link style.css with v=${targetRev}`);
    assert(indexHtml.includes(`app.js?v=${targetRev}`), `index.html must link app.js with v=${targetRev}`);
  });

  console.log("================================================================================");
  console.log(`MOBILE HISTORY LAYOUT FIX FOCUSED TESTS COMPLETE: ${testsPassed} passed, ${testsFailed} failed`);
  console.log("================================================================================");

  if (testsFailed > 0) {
    process.exit(1);
  }
}

main().catch(err => {
  console.error("FATAL TEST SUITE ERROR:", err);
  process.exit(1);
});
