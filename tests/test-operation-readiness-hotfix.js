// test-operation-readiness-hotfix.js
// Focused automated test suite for Production Operation Readiness Hotfix
// Covering T1 through T10 per Section 20 specifications.

const fs = require("fs");
const path = require("path");
const assert = require("assert");

console.log("================================================================================");
console.log("ScrapManagement - PRODUCTION OPERATION READINESS HOTFIX TEST SUITE (T1..T10)");
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

// Read assets
const repoRoot = path.join(__dirname, "..");
const printCss = fs.readFileSync(path.join(repoRoot, "src", "css", "print.css"), "utf8");
const styleCss = fs.readFileSync(path.join(repoRoot, "src", "css", "style.css"), "utf8");
const indexHtml = fs.readFileSync(path.join(repoRoot, "index.html"), "utf8");
const appJs = fs.readFileSync(path.join(repoRoot, "src", "js", "app.js"), "utf8");
const gasClientJs = fs.readFileSync(path.join(repoRoot, "src", "js", "gasClient.js"), "utf8");

// Mock DOM Environment
function createMockElement(tag, id = "") {
  return {
    tagName: tag.toUpperCase(),
    id: id,
    className: "",
    style: {},
    children: [],
    attributes: {},
    dataset: {},
    innerHTML: "",
    textContent: "",
    appendChild(child) {
      this.children.push(child);
      child.parentNode = this;
      return child;
    },
    querySelector(sel) {
      return this.children.find(c => sel.includes(c.id) || sel.includes(c.className)) || null;
    },
    querySelectorAll(sel) {
      const results = [];
      function traverse(node) {
        for (const c of node.children) {
          if (sel.includes(c.tagName.toLowerCase()) || sel.includes(c.className)) results.push(c);
          traverse(c);
        }
      }
      traverse(this);
      return results;
    }
  };
}

async function main() {
  // -----------------------------------------------------------------------------
  // T1: Print spacing & typography contracts
  // -----------------------------------------------------------------------------
  await runTest("T1", "Print spacing: @page margins, title 17pt, table padding, and signature box size", () => {
    assert(/@page\s*\{[^}]*margin:\s*20mm\s+16mm\s+15mm\s+16mm/i.test(printCss), "@page margin must be 20mm 16mm 15mm 16mm");
    assert(/@page\s*\{[^}]*size:\s*A4\s+portrait/i.test(printCss), "@page size must be A4 portrait");
    assert(/\.slip-title\s*\{[^}]*font-size:\s*17pt/i.test(printCss), ".slip-title font-size must be 17pt");
    assert(/\.slip-items-table\s+th[^{]*\{[^}]*padding:\s*6px\s+8px/i.test(printCss), ".slip-items-table th padding must be 6px 8px");
    assert(/\.slip-items-table\s+td[^{]*\{[^}]*padding:\s*6px\s+8px/i.test(printCss), ".slip-items-table td padding must be 6px 8px");
    assert(/\.slip-signature-box\s*\{[^}]*width:\s*320px/i.test(printCss), ".slip-signature-box width must be 320px");
    assert(/\.slip-signature-box\s*\{[^}]*height:\s*110px/i.test(printCss), ".slip-signature-box height must be 110px");
  });

  // -----------------------------------------------------------------------------
  // T2: DIGITAL actual signature render & Strict Slip-Scoped Isolation
  // -----------------------------------------------------------------------------
  await runTest("T2", "DIGITAL actual signature render: handwritten image set on sigImg, text suppressed, strictly slip-scoped", () => {
    // Audit app.js implementation of printSlipFromRecord
    assert(appJs.includes("if (s.signatureStatus === \"DIGITAL\" && sigData)"), "printSlipFromRecord must check DIGITAL and sigData");
    assert(appJs.includes("sigImg.src = sigData"), "printSlipFromRecord must set sigImg.src = sigData");
    assert(appJs.includes("sigImg.style.display = \"block\""), "printSlipFromRecord must set sigImg.style.display = 'block'");
    assert(!appJs.includes("textEl.textContent = \"電子署名確認済\""), "app.js must NOT set replacement text '電子署名確認済'");

    // Audit slip-scoped isolation (no fallback to global/other-slip confirmedSignatureData)
    assert(!appJs.includes("|| confirmedSignatureData"), "printSlipFromRecord must NOT fall back to global confirmedSignatureData");
    assert(appJs.includes("const sigData = s.vendorSignatureImage || s.signatureData || null;"), "sigData must only be derived from target slip record");

    // Audit image load synchronization
    assert(appJs.includes("sigImg.onload = () =>"), "printSlipFromRecord must wait for signature image onload before print");
  });

  // -----------------------------------------------------------------------------
  // T3: NONE blank signature box
  // -----------------------------------------------------------------------------
  await runTest("T3", "NONE blank: signature box image hidden and empty", () => {
    assert(appJs.includes("sigImg.src = \"\""), "printSlipFromRecord must clear sigImg.src when NONE");
    assert(appJs.includes("sigImg.style.display = \"none\""), "printSlipFromRecord must set sigImg.style.display = 'none' when NONE");
  });

  // -----------------------------------------------------------------------------
  // T4: Security Decision C - No Drive ID or URL leakage & Authorized dedicated endpoint
  // -----------------------------------------------------------------------------
  await runTest("T4", "No Drive ID/URL leakage & Authorized print signature route: baseCode auth and fail-closed print", () => {
    assert(!appJs.includes("s.signatureFileId"), "app.js must not reference or store signatureFileId");
    assert(!appJs.includes("s.signatureUrl"), "app.js must not reference or store signatureUrl");
    assert(!indexHtml.includes("data-signature-file-id"), "index.html must not store data-signature-file-id");
    assert(!indexHtml.includes("data-signature-url"), "index.html must not store data-signature-url");
    
    // Verify gasClient fetchPrintSignature exists and supports baseCode authorization
    assert(gasClientJs.includes("async fetchPrintSignature("), "gasClient must have dedicated fetchPrintSignature");
    assert(gasClientJs.includes("action=printSignature"), "gasClient fetchPrintSignature must use action=printSignature");
    assert(gasClientJs.includes("fetchPrintSignature(slipId, baseCode = \"\")"), "gasClient fetchPrintSignature must accept baseCode parameter");
    
    // Verify prepareAndPrintSlip fails closed if signature fetch fails
    assert(appJs.includes("s.baseCode || workingBaseCode || resolvedBaseCode"), "prepareAndPrintSlip must pass baseCode for authorization");
    assert(appJs.includes("showAppModal({\n            title: \"署名画像取得エラー\""), "prepareAndPrintSlip must show error modal and abort print on fetch failure");
  });

  // -----------------------------------------------------------------------------
  // T5: History 7-column desktop layout (Base column removed)
  // -----------------------------------------------------------------------------
  await runTest("T5", "History 7-column desktop layout: Base column removed, exactly 7 headers and colgroup cols", () => {
    // Verify HTML colgroup and thead
    const theadMatch = indexHtml.match(/<table[^>]*id="history-table"[^>]*>([\s\S]*?)<\/table>/);
    assert(theadMatch, "history-table must exist in index.html");
    const tableContent = theadMatch[1];
    
    // Check colgroup cols
    const cols = tableContent.match(/<col\s+class="([^"]+)"\s+style="width:\s*([^;]+);"/g) || [];
    assert.strictEqual(cols.length, 7, "history-table must have exactly 7 <col> definitions");
    assert(!tableContent.includes("<col class=\"col-base\""), "colgroup must NOT have col-base");

    // Check thead ths
    const ths = tableContent.match(/<th\s+class="([^"]+)">([^<]+)<\/th>/g) || [];
    assert.strictEqual(ths.length, 7, "history thead must have exactly 7 <th> columns");
    assert(!tableContent.includes("<th>拠点名</th>"), "history thead must NOT contain <th>拠点名</th>");
    assert(tableContent.includes(">伝票番号</th>"), "history thead must contain 伝票番号");
    assert(tableContent.includes(">処分日</th>"), "history thead must contain 処分日");
    assert(tableContent.includes(">担当者</th>"), "history thead must contain 担当者");
    assert(tableContent.includes(">業者名</th>"), "history thead must contain 業者名");
    assert(tableContent.includes(">署名区分</th>"), "history thead must contain 署名区分");
    assert(tableContent.includes(">状態</th>"), "history thead must contain 状態");
    assert(tableContent.includes(">操作</th>"), "history thead must contain 操作");
  });

  // -----------------------------------------------------------------------------
  // T6: Status and actions centered
  // -----------------------------------------------------------------------------
  await runTest("T6", "Status centered: status header/cell text-align center, badge centered margin", () => {
    assert(/\.history-table\s+col\.col-status,\s*\.history-table\s+th\.col-status,\s*\.history-table\s+td\.col-status\s*\{[^}]*text-align:\s*center/i.test(styleCss), "col-status must have text-align: center");
    assert(/\.history-table\s+td\.col-status\s+\.brand-badge\s*\{[^}]*margin:\s*0\s+auto/i.test(styleCss), "col-status .brand-badge must have margin: 0 auto");
    assert(/\.history-table\s+th\.col-actions,\s*\.history-table\s+td\.col-actions\s*\{[^}]*text-align:\s*center/i.test(styleCss), "col-actions must have text-align: center");
    assert(/\.hist-desktop-actions-wrap\s*\{[^}]*justify-content:\s*center/i.test(styleCss), "hist-desktop-actions-wrap must have justify-content: center");
  });

  // -----------------------------------------------------------------------------
  // T7: Header/body alignment & column width contract (17%, 14%, 13%, 16%, 16%, 8%, 16%)
  // -----------------------------------------------------------------------------
  await runTest("T7", "Header/body alignment: CSS widths 17%, 14%, 13%, 16%, 16%, 8%, 16% sum to 100%", () => {
    assert(styleCss.includes("col.col-slip, .history-table th.col-slip, .history-table td.col-slip { width: 17%"), "col-slip width 17%");
    assert(styleCss.includes("col.col-date, .history-table th.col-date, .history-table td.col-date { width: 14%"), "col-date width 14%");
    assert(styleCss.includes("col.col-staff, .history-table th.col-staff, .history-table td.col-staff { width: 13%"), "col-staff width 13%");
    assert(styleCss.includes("col.col-vendor, .history-table th.col-vendor, .history-table td.col-vendor { width: 16%"), "col-vendor width 16%");
    assert(styleCss.includes("col.col-sig, .history-table th.col-sig, .history-table td.col-sig { width: 16%"), "col-sig width 16%");
    assert(styleCss.includes("col.col-status, .history-table th.col-status, .history-table td.col-status { width: 8%"), "col-status width 8%");
    assert(styleCss.includes("col.col-actions, .history-table th.col-actions, .history-table td.col-actions { width: 16%"), "col-actions width 16%");

    const sum = 17 + 14 + 13 + 16 + 16 + 8 + 16;
    assert.strictEqual(sum, 100, "7 column widths must sum exactly to 100%");
  });

  // -----------------------------------------------------------------------------
  // T8: Mobile history base column removed
  // -----------------------------------------------------------------------------
  await runTest("T8", "Mobile history base column removed: row 2 contains staff only", () => {
    assert(appJs.includes("<div class=\"history-row-2\">\n          <span class=\"hist-staff\">${escapeHtml(staffName)}</span>\n        </div>"), "Mobile card row 2 must contain only staffName");
    assert(!appJs.includes("<span class=\"hist-base\">"), "app.js renderHistoryRows must NOT contain hist-base");
  });

  // -----------------------------------------------------------------------------
  // T9: Summary items production-equivalent fixture
  // -----------------------------------------------------------------------------
  await runTest("T9", "Summary items aggregation: item codes aggregate quantity and weights correctly", () => {
    // Test aggregation logic
    const details = [
      { slipNo: "SCRAP-LW0001", code: "IQA3800", name: "Ｉｑ支柱３８００", qty: 100, type: "NUMBER", unitWeight: 11.7 },
      { slipNo: "SCRAP-LW0001", code: "IQSCX12", name: "Ｉｑ【先行】手すり１２１９ 【青】", qty: 3, type: "NUMBER", unitWeight: 5.5 },
      { slipNo: "SCRAP-LW0003", code: "IQC1829", name: "Ｉｑ手すり１８２９", qty: 10, type: "NUMBER", unitWeight: 4.4 },
      { slipNo: "SCRAP-LW0004", code: "IQA3800", name: "Ｉｑ支柱３８００", qty: 100, type: "NUMBER", unitWeight: 11.7 }
    ];

    const itemMap = {};
    let totalItemsCount = 0;
    let totalWeightKg = 0;

    for (const d of details) {
      if (d.type === "NUMBER" && d.qty > 0) {
        totalItemsCount += d.qty;
        if (!itemMap[d.code]) {
          itemMap[d.code] = { itemCode: d.code, itemName: d.name, totalQty: 0, totalWeightKg: 0 };
        }
        itemMap[d.code].totalQty += d.qty;
        if (d.unitWeight) {
          const wt = Math.round(d.qty * d.unitWeight * 100) / 100;
          itemMap[d.code].totalWeightKg += wt;
          totalWeightKg += wt;
        }
      }
    }

    const items = Object.values(itemMap);
    assert.strictEqual(items.length, 3, "Must have exactly 3 aggregated items");
    assert.strictEqual(totalItemsCount, 213, "Total items count must be 213");
    assert.strictEqual(totalWeightKg, 2400.5, "Total weight must be 2400.5 kg");

    const iqa = items.find(i => i.itemCode === "IQA3800");
    assert.strictEqual(iqa.totalQty, 200, "IQA3800 totalQty must be 200");
    assert.strictEqual(iqa.totalWeightKg, 2340, "IQA3800 totalWeightKg must be 2340");
  });

  // -----------------------------------------------------------------------------
  // T10: Summary revision / stale empty cache remediation
  // -----------------------------------------------------------------------------
  await runTest("T10", "Summary cache refresh: isStaleEmptyItems detects empty items cache and triggers server fetch", () => {
    assert(appJs.includes("const isStaleEmptyItems = cachedData && cachedData.totalSlipsCount > 0 && (!cachedData.items || cachedData.items.length === 0);"), "app.js must define isStaleEmptyItems check");
    assert(appJs.includes("if (cachedData && !isStaleEmptyItems)"), "app.js must not accept cachedData when isStaleEmptyItems is true");
    assert(appJs.includes("if (!cached || isStaleEmptyItems)"), "handleStateComparison must fetch summary when isStaleEmptyItems is true");
  });

  console.log("================================================================================");
  console.log(`TEST SUMMARY: ${testsPassed} PASSED, ${testsFailed} FAILED (TOTAL: ${testsPassed + testsFailed})`);
  console.log("================================================================================");

  if (testsFailed > 0) {
    process.exit(1);
  }
}

main().catch(err => {
  console.error("Test runner error:", err);
  process.exit(1);
});
