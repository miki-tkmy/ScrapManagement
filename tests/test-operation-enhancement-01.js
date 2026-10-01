// test-operation-enhancement-01.js
// Focused Automated Test Suite for ScrapManagement OPERATION ENHANCEMENT 01
// Testing T1 through T16 per Section 35 specifications

const fs = require("fs");
const path = require("path");
const assert = require("assert");
const vm = require("vm");

console.log("================================================================================");
console.log("ScrapManagement - OPERATION ENHANCEMENT 01 FOCUSED TEST SUITE (T1..T16)");
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

// Load files
const repoRoot = path.join(__dirname, "..");
const indexHtml = fs.readFileSync(path.join(repoRoot, "index.html"), "utf8");
const styleCss = fs.readFileSync(path.join(repoRoot, "src", "css", "style.css"), "utf8");
const appJs = fs.readFileSync(path.join(repoRoot, "src", "js", "app.js"), "utf8");
const fixturesJs = fs.readFileSync(path.join(repoRoot, "src", "js", "fixtures.js"), "utf8");
const gasClientJs = fs.readFileSync(path.join(repoRoot, "src", "js", "gasClient.js"), "utf8");
const gasClientFixPrefJs = fs.readFileSync(path.join(repoRoot, "src", "js", "gasClient-gate3a7-fixpref-20260927.js"), "utf8");
const syncMasterPs1 = fs.readFileSync(path.join(repoRoot, "scripts", "sync-company-fixed-item-master.ps1"), "utf8");
const codeJs = fs.readFileSync(path.join(repoRoot, "scratch", "gas_prod", "Code.js"), "utf8");

async function main() {
  // -----------------------------------------------------------------------------
  // T1: FIX02 = 小物カゴ
  // -----------------------------------------------------------------------------
  await runTest("T1", "FIX02 renamed to 小物カゴ (id preserved, SSOT fixtures and script updated)", () => {
    // 1. Fixtures check
    const fixturesModule = require(path.join(repoRoot, "src", "js", "fixtures.js"));
    const fix02 = fixturesModule.TEST_FIXTURE_FIXED_ITEMS.find(it => it.fixedItemId === "FIX02" || it.id === "FIX02");
    assert(fix02, "FIX02 must exist in TEST_FIXTURE_FIXED_ITEMS");
    assert.strictEqual(fix02.itemName, "小物カゴ", "FIX02 itemName must be 小物カゴ");

    // 2. PowerShell Master Sync check
    assert(syncMasterPs1.includes('"FIXED_SMALL_SET"'), "sync script must contain FIXED_SMALL_SET");
    assert(syncMasterPs1.includes('itemName     = "小物カゴ"'), "sync script must map FIXED_SMALL_SET to 小物カゴ");
  });

  // -----------------------------------------------------------------------------
  // T2: 物品違い品 / 簿外品追加
  // -----------------------------------------------------------------------------
  await runTest("T2", "Fixed items 物品違い品 and 簿外品 added (active = true)", () => {
    // 1. Fixtures check
    const fixturesModule = require(path.join(repoRoot, "src", "js", "fixtures.js"));
    const items = fixturesModule.TEST_FIXTURE_FIXED_ITEMS;
    assert.strictEqual(items.length, 5, "TEST_FIXTURE_FIXED_ITEMS must have exactly 5 items");

    const fix04 = items.find(it => it.fixedItemId === "FIX04" || it.id === "FIX04");
    assert(fix04, "FIX04 must exist");
    assert.strictEqual(fix04.itemName, "物品違い品");
    assert.strictEqual(fix04.active, true);

    const fix05 = items.find(it => it.fixedItemId === "FIX05" || it.id === "FIX05");
    assert(fix05, "FIX05 must exist");
    assert.strictEqual(fix05.itemName, "簿外品");
    assert.strictEqual(fix05.active, true);

    // 2. PowerShell Master Sync check
    assert(syncMasterPs1.includes('"FIXED_WRONG_ITEM"'), "sync script must define FIXED_WRONG_ITEM");
    assert(syncMasterPs1.includes('itemName     = "物品違い品"'), "sync script must define 物品違い品");
    assert(syncMasterPs1.includes('"FIXED_OFF_BOOK"'), "sync script must define FIXED_OFF_BOOK");
    assert(syncMasterPs1.includes('itemName     = "簿外品"'), "sync script must define 簿外品");
  });

  // -----------------------------------------------------------------------------
  // T3: placeholder cleanup
  // -----------------------------------------------------------------------------
  await runTest("T3", "Placeholder cleanup: item-code is IQA3800,KCC, other-name is empty, no leading 例: or 例：", () => {
    // item-code-input strictly IQA3800,KCC
    assert(
      /id="item-code-input"[^>]*placeholder="IQA3800,KCC"/.test(indexHtml),
      'item-code-input placeholder must be strictly "IQA3800,KCC"'
    );

    // other-name-input strictly ""
    assert(
      /id="other-name-input"[^>]*placeholder=""/.test(indexHtml),
      'other-name-input placeholder must be strictly ""'
    );

    // No leading 例: or 例： in user-facing input placeholders
    const placeholders = [...indexHtml.matchAll(/placeholder="([^"]*)"/g)].map(m => m[1]);
    for (const ph of placeholders) {
      assert(
        !/^例[：:]/.test(ph.trim()),
        `Placeholder "${ph}" must NOT start with leading 例: or 例：`
      );
    }

    // Verify key fields cleaned
    assert(indexHtml.includes('id="staff-name-input" class="form-input" placeholder="山田 太郎"'), "staff placeholder cleaned");
    assert(indexHtml.includes('id="vendor-name-input" class="form-input" placeholder="○○金属株式会社"'), "vendor placeholder cleaned");
    assert(indexHtml.includes('id="item-qty-input" class="form-input" placeholder="10, 10+5, 10×2, 一式"'), "quantity placeholder cleaned");
  });

  // -----------------------------------------------------------------------------
  // T4: new signature path: ScrapManagement_Signatures/BaseCode/YYYY
  // -----------------------------------------------------------------------------
  await runTest("T4", "New signature path: ScrapManagement_Signatures/<BaseCode>/<YYYY>/<SlipNo>.png", () => {
    // Check Code.js implementation
    assert(codeJs.includes("function getOrCreateSignatureTargetFolder"), "Code.js must implement getOrCreateSignatureTargetFolder");
    assert(codeJs.includes('"ScrapManagement_Signatures"'), "Code.js must use ScrapManagement_Signatures root folder");
    assert(codeJs.includes("cleanBase"), "Code.js must use sanitized base folder");
    assert(codeJs.includes("yearStr"), "Code.js must use year folder");
    assert(codeJs.includes('const fileName = slipNo + ".png";'), "Code.js must name file <SlipNo>.png");

    // Test folder logic in sandbox VM
    const mockFolders = {};
    const mockParent = {
      getFoldersByName: (name) => ({
        hasNext: () => !!mockFolders[name],
        next: () => mockFolders[name]
      }),
      createFolder: (name) => {
        const f = {
          name,
          subfolders: {},
          getFoldersByName: function(sub) {
            return {
              hasNext: () => !!this.subfolders[sub],
              next: () => this.subfolders[sub]
            };
          },
          createFolder: function(sub) {
            const sf = {
              name: sub,
              subfolders: {},
              getFoldersByName: function(s2) {
                return {
                  hasNext: () => !!this.subfolders[s2],
                  next: () => this.subfolders[s2]
                };
              },
              createFolder: function(s2) {
                const yf = { name: s2, files: {} };
                this.subfolders[s2] = yf;
                return yf;
              }
            };
            this.subfolders[sub] = sf;
            return sf;
          }
        };
        mockFolders[name] = f;
        return f;
      }
    };

    const ctx = {
      console,
      isValidBaseCode: (val) => typeof val === "string" && /^[A-Za-z0-9_-]{1,10}$/.test(val.trim()),
      validateDateString: (v, fb) => v || fb,
      validateIsoDateTime: (v, fb) => v || fb
    };
    vm.createContext(ctx);
    vm.runInContext(codeJs.substring(codeJs.indexOf("function getOrCreateSignatureTargetFolder")), ctx);

    const folderFn = ctx.getOrCreateSignatureTargetFolder;
    assert.strictEqual(typeof folderFn, "function", "getOrCreateSignatureTargetFolder must be a function");

    const targetFolder = folderFn(mockParent, "A2", "2026-10-01", "2026-10-01T12:00:00Z");
    assert(targetFolder, "Target folder must be returned");
    assert.strictEqual(targetFolder.name, "2026", "Subfolder must be 2026");
    assert(mockFolders["ScrapManagement_Signatures"], "Root ScrapManagement_Signatures folder created");
    assert(mockFolders["ScrapManagement_Signatures"].subfolders["A2"], "Base folder A2 created");
    assert(mockFolders["ScrapManagement_Signatures"].subfolders["A2"].subfolders["2026"], "Year folder 2026 created");
  });

  // -----------------------------------------------------------------------------
  // T5: existing signature files migration = 0
  // -----------------------------------------------------------------------------
  await runTest("T5", "Existing signature files migration = 0 (no bulk move or migration loops)", () => {
    // Code.js must NOT have any migrateSignatures or DriveApp.getFiles loops moving files
    assert(!codeJs.includes("migrateSignatures"), "No migrateSignatures function");
    assert(!codeJs.includes("moveToFolder"), "No bulk moveToFolder migration");

    // Only saveSignatureFile creates new files in the hierarchy
    const matches = codeJs.match(/getOrCreateSignatureTargetFolder/g);
    assert(matches && matches.length >= 2, "getOrCreateSignatureTargetFolder is used only for saving new signatures");
  });

  // -----------------------------------------------------------------------------
  // T6: logical delete: FINAL → DELETED, details preserved
  // -----------------------------------------------------------------------------
  await runTest("T6", "Logical delete: FINAL -> DELETED, details and line items preserved", async () => {
    // 1. Verify in gasClient.js mock implementation
    const ctx = {
      window: {},
      console,
      localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
      SCRAP_CONFIG: { environment: "DEVELOPMENT", gasEndpoint: "http://mock" }
    };
    vm.createContext(ctx);
    vm.runInContext(gasClientJs, ctx);
    const GasClientClass = ctx.window.GasClient || ctx.GasClient;
    const client = new GasClientClass();
    client.isMockMode = true;

    // Seed mock slips
    client.mockSlips = [
      {
        slipNo: "SCRAP-A2-20261001-001",
        baseCode: "A2",
        status: "FINAL",
        date: "2026-10-01",
        staffName: "Test Staff",
        vendorName: "Test Vendor",
        signatureStatus: "DIGITAL",
        signatureDataUrl: "data:image/png;base64,abc",
        items: [{ itemCode: "IQ01", quantity: 5, unitWeightKg: 10, totalWeightKg: 50 }],
        fixedItems: [{ fixedItemId: "FIXED_SCRAP_BOX", quantity: 1 }],
        otherItems: [{ itemName: "Custom Item", quantity: 2 }]
      }
    ];

    const delRes = await client.deleteFinalSlip({ slipNo: "SCRAP-A2-20261001-001", baseCode: "A2", employeeNo: "EMP-001" });
    assert(delRes && delRes.success, "deleteFinalSlip must succeed");

    // Verify slip status is DELETED
    const slip = client.mockSlips.find(s => s.slipNo === "SCRAP-A2-20261001-001");
    assert.strictEqual(slip.status, "DELETED", "Slip status must be DELETED");
    assert(slip.deletedAt, "DeletedAt must be set");
    assert.strictEqual(slip.deletedBy, "EMP-001", "DeletedBy must be EMP-001");

    // Verify details are preserved
    assert.strictEqual(slip.items.length, 1, "Items must be preserved");
    assert.strictEqual(slip.fixedItems.length, 1, "Fixed items must be preserved");
    assert.strictEqual(slip.otherItems.length, 1, "Other items must be preserved");

    // 2. Verify Code.js backend does NOT physically delete rows
    assert(codeJs.includes('hSheet.getRange(targetRow, 10).setValue("DELETED");'), "Backend sets Status to DELETED");
    assert(!codeJs.includes("dSheet.deleteRow"), "Detail sheet rows are never deleted");
    assert(!codeJs.includes("fSheet.deleteRow"), "Fixed sheet rows are never deleted");
    assert(!codeJs.includes("oSheet.deleteRow"), "Other sheet rows are never deleted");
  });

  // -----------------------------------------------------------------------------
  // T7: deleted row remains in history: gray + 削除済み
  // -----------------------------------------------------------------------------
  await runTest("T7", "Deleted row remains in history with gray styling and 削除済み badge", () => {
    // 1. Check style.css has .hist-row-deleted
    assert(styleCss.includes(".hist-row-deleted"), "style.css must define .hist-row-deleted");
    assert(styleCss.includes("background-color: #f1f5f9") || styleCss.includes("background-color: #f8fafc") || styleCss.includes("opacity: 0.75"), "Gray styling applied to deleted rows");

    // 2. Check app.js renders hist-row-deleted and 削除済み badge
    assert(appJs.includes("hist-row-deleted"), "app.js must apply hist-row-deleted to deleted rows");
    assert(appJs.includes("削除済み"), "app.js must render 削除済み badge");

    // 3. Test renderHistoryRows via vm
    const rowsAppended = [];
    const mockTbody = {
      set innerHTML(val) { rowsAppended.length = 0; },
      appendChild: (tr) => { rowsAppended.push(tr); }
    };
    const mockElements = {
      "history-table-tbody": mockTbody,
      "history-count-badge": { textContent: "" },
      "history-search-from": { value: "" },
      "history-search-to": { value: "" },
      "history-search-keyword": { value: "" },
      "history-search-signature": { value: "ALL" },
      "history-load-more-container": { style: {} }
    };
    const ctx = {
      console,
      window: {},
      document: {
        addEventListener: () => {},
        getElementById: (id) => mockElements[id] || { innerHTML: "", textContent: "", style: {}, value: "" },
        createElement: (tag) => ({ tagName: tag, className: "", innerHTML: "", style: {} })
      },
      formatJstDate: (d) => d,
      formatJstDateTime: (d) => d,
      escapeHtml: (s) => s || ""
    };
    vm.createContext(ctx);
    vm.runInContext(appJs, ctx);

    const testSlips = [
      {
        slipNo: "SLIP-DEL-01",
        baseCode: "A2",
        status: "DELETED",
        date: "2026-10-01",
        staffName: "Staff A",
        vendorName: "Vendor A",
        signStatus: "DELETED",
        deletedAt: "2026-10-01T12:00:00Z",
        deletedBy: "EMP-001"
      }
    ];

    vm.runInContext("renderHistoryRows(document.getElementById('history-table-tbody'), " + JSON.stringify(testSlips) + ");", ctx);
    assert.strictEqual(rowsAppended.length, 1, "Exactly one row must be appended");
    assert.strictEqual(rowsAppended[0].className, "hist-row-deleted", "Appended tr must have className hist-row-deleted");
    assert(rowsAppended[0].innerHTML.includes("削除済み"), "Row innerHTML must contain 削除済み badge");
    assert(rowsAppended[0].innerHTML.includes("disabled"), "Actions print button must be disabled for deleted row");
  });

  // -----------------------------------------------------------------------------
  // T8: DELETED excluded from summary
  // -----------------------------------------------------------------------------
  await runTest("T8", "DELETED slips are excluded from summary counts and weight aggregations", async () => {
    // 1. gasClient mock summary test
    const ctx = {
      window: {},
      console,
      localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
      SCRAP_CONFIG: { environment: "DEVELOPMENT", gasEndpoint: "http://mock" }
    };
    vm.createContext(ctx);
    vm.runInContext(gasClientJs, ctx);
    const GasClientClass = ctx.window.GasClient || ctx.GasClient;
    const client = new GasClientClass();
    client.isMockMode = true;

    client.mockSlips = [
      {
        slipNo: "SLIP-FINAL-01",
        baseCode: "A2",
        status: "FINAL",
        date: "2026-10-01",
        codeItems: [{ itemCode: "IQ01", itemName: "Item 1", quantityType: "NUMBER", quantityValue: 10, unitWeightKg: 10, totalWeightKg: 100 }]
      },
      {
        slipNo: "SLIP-DEL-02",
        baseCode: "A2",
        status: "DELETED",
        date: "2026-10-01",
        codeItems: [{ itemCode: "IQ01", itemName: "Item 1", quantityType: "NUMBER", quantityValue: 5, unitWeightKg: 10, totalWeightKg: 50 }]
      }
    ];

    const countRes = await client.fetchSummaryCount({ baseCode: "A2", fromDate: "2026-10-01", toDate: "2026-10-01" });
    assert.strictEqual(countRes.totalSlipsCount, 1, "Summary count must only include active FINAL slips (1), excluding DELETED");

    const sumRes = await client.fetchSummary({ baseCode: "A2", fromDate: "2026-10-01", toDate: "2026-10-01" });
    assert(sumRes.success, "fetchSummary must succeed");
    const item1 = sumRes.items.find(i => i.itemCode === "IQ01");
    assert(item1, "Item 1 must be present");
    assert.strictEqual(item1.totalQty, 10, "Total quantity must only sum active slips (10, excluding 5)");
    assert.strictEqual(item1.totalWeightKg, 100, "Total weight must only sum active slips (100, excluding 50)");

    // 2. Code.js backend check (requires st === "FINAL" exclusively)
    assert(codeJs.includes('if (st !== "FINAL" || !finAt) continue;'), "Backend summary filters out DELETED slips");
  });

  // -----------------------------------------------------------------------------
  // T9: DIGITAL delete trashes signature
  // -----------------------------------------------------------------------------
  await runTest("T9", "DIGITAL delete trashes signature file in Drive and clears signature file reference", () => {
    // 1. Code.js backend check
    assert(codeJs.includes("file.setTrashed(true);"), "Backend sets file.setTrashed(true)");
    assert(codeJs.includes('hSheet.getRange(targetRow, 8).setValue("DELETED");'), "Backend sets SignStatus to DELETED");
    assert(codeJs.includes('hSheet.getRange(targetRow, 9).setValue("");'), "Backend clears SignatureFileId");
    assert(codeJs.includes("trashedFile.setTrashed(false);"), "Backend includes compensating untrash rollback");

    // 2. gasClient.js mock check
    assert(gasClientJs.includes('target.signatureStatus = "DELETED";'), "gasClient sets signatureStatus to DELETED");
  });

  // -----------------------------------------------------------------------------
  // T10: deleted DIGITAL detail message exactly
  // -----------------------------------------------------------------------------
  await runTest("T10", "Deleted DIGITAL detail message exactly: 伝票を削除したため署名を削除しました", () => {
    const exactMessage = "伝票を削除したため署名を削除しました";
    assert(appJs.includes(exactMessage), `app.js must contain exact string: "${exactMessage}"`);

    // Test renderHistoryDetailContent output for deleted DIGITAL slip
    const slip = {
      slipNo: "SLIP-DEL-DIGITAL",
      baseCode: "A2",
      status: "DELETED",
      signStatus: "DELETED",
      signatureStatus: "DELETED",
      date: "2026-10-01",
      staffName: "Staff A",
      vendorName: "Vendor A",
      deletedAt: "2026-10-01T12:00:00Z",
      deletedBy: "EMP-001",
      codeItems: [],
      fixedItems: [],
      otherItems: []
    };

    let detailHtml = "";
    const mockContainer = {
      style: {},
      set innerHTML(val) { detailHtml = val; },
      get innerHTML() { return detailHtml; }
    };
    const ctx = {
      console,
      window: {},
      document: {
        addEventListener: () => {},
        getElementById: (id) => {
          if (id === "history-detail-modal-body" || id === "hist-detail-body") return mockContainer;
          return { style: {}, textContent: "", innerHTML: "", disabled: false };
        }
      },
      formatJstDateTime: (d) => d,
      formatJstDate: (d) => d,
      escapeHtml: (s) => s || "",
      getPrintQuantityDisplay: (it) => it.quantity || "1"
    };
    vm.createContext(ctx);
    vm.runInContext(appJs, ctx);

    vm.runInContext("renderHistoryDetailContent(" + JSON.stringify(slip) + ");", ctx);
    assert(detailHtml.includes(exactMessage), `Rendered detail must contain exact message: "${exactMessage}"`);
    assert(detailHtml.includes("削除日時"), "Rendered detail must display 削除日時");
    assert(detailHtml.includes("削除者"), "Rendered detail must display 削除者");
  });

  // -----------------------------------------------------------------------------
  // T11: NONE delete does not claim signature was deleted
  // -----------------------------------------------------------------------------
  await runTest("T11", "NONE delete does not claim signature was deleted", () => {
    const exactMessage = "伝票を削除したため署名を削除しました";

    const slip = {
      slipNo: "SLIP-DEL-NONE",
      baseCode: "A2",
      status: "DELETED",
      signStatus: "NONE",
      signatureStatus: "NONE",
      date: "2026-10-01",
      staffName: "Staff A",
      vendorName: "Vendor A",
      deletedAt: "2026-10-01T12:00:00Z",
      deletedBy: "EMP-001",
      codeItems: [],
      fixedItems: [],
      otherItems: []
    };

    let detailHtml = "";
    const mockContainer = {
      style: {},
      set innerHTML(val) { detailHtml = val; },
      get innerHTML() { return detailHtml; }
    };
    const ctx = {
      console,
      window: {},
      document: {
        addEventListener: () => {},
        getElementById: (id) => {
          if (id === "history-detail-modal-body" || id === "hist-detail-body") return mockContainer;
          return { style: {}, textContent: "", innerHTML: "", disabled: false };
        }
      },
      formatJstDateTime: (d) => d,
      formatJstDate: (d) => d,
      escapeHtml: (s) => s || "",
      getPrintQuantityDisplay: (it) => it.quantity || "1"
    };
    vm.createContext(ctx);
    vm.runInContext(appJs, ctx);

    vm.runInContext("renderHistoryDetailContent(" + JSON.stringify(slip) + ");", ctx);
    assert(!detailHtml.includes(exactMessage), "Deleted NONE slip must NOT claim signature was deleted");
    assert(detailHtml.includes("受領署名はありません") || detailHtml.includes("署名なし"), "Displays normal no-signature text");
  });

  // -----------------------------------------------------------------------------
  // T12: deleted print disabled & printSignature fails closed
  // -----------------------------------------------------------------------------
  await runTest("T12", "Deleted slip printing is blocked and printSignature fails closed", async () => {
    // 1. Code.js backend check
    assert(codeJs.includes('if (slipStatus === "DELETED")'), "Backend checks if slip status is DELETED");
    assert(codeJs.includes('return createSafeErrorResponse("SLIP_DELETED"'), "Backend returns SLIP_DELETED error");

    // 2. gasClient.js fetchPrintSignature fails closed
    const ctx = {
      window: {},
      console,
      localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
      SCRAP_CONFIG: { environment: "DEVELOPMENT", gasEndpoint: "http://mock" }
    };
    vm.createContext(ctx);
    vm.runInContext(gasClientJs, ctx);
    const GasClientClass = ctx.window.GasClient || ctx.GasClient;
    const client = new GasClientClass();
    client.isMockMode = true;

    client.mockSlips = [
      {
        slipNo: "SLIP-DEL-01",
        baseCode: "A2",
        status: "DELETED"
      }
    ];

    const sigRes = await client.fetchPrintSignature("SLIP-DEL-01", "A2");
    assert.strictEqual(sigRes.success, false, "fetchPrintSignature must fail for deleted slip");
    assert.strictEqual(sigRes.error, "SLIP_DELETED", "Error code must be SLIP_DELETED");

    // 3. app.js prepareAndPrintSlip blocks printing
    let alertCalled = false;
    const appCtx = {
      console,
      window: { alert: () => { alertCalled = true; } },
      document: { addEventListener: () => {}, getElementById: () => null },
      escapeHtml: (s) => s
    };
    vm.createContext(appCtx);
    vm.runInContext(appJs, appCtx);

    const printResult = await vm.runInContext('prepareAndPrintSlip({ slipNo: "SLIP-DEL-01", status: "DELETED" })', appCtx);
    assert.strictEqual(printResult, false, "prepareAndPrintSlip must return false for deleted slip");
  });

  // -----------------------------------------------------------------------------
  // T13: delete authorization: missing/wrong base rejected
  // -----------------------------------------------------------------------------
  await runTest("T13", "Delete authorization: missing/wrong base is rejected with fail-closed errors", async () => {
    // 1. Check Code.js authorization rules
    assert(codeJs.includes('if (!slipNo || !baseCode || !employeeNo)'), "Code.js checks slipNo, baseCode, employeeNo");
    assert(codeJs.includes('if (slipBaseCode !== baseCode)'), "Code.js checks cross-base authorization");
    assert(codeJs.includes('return createSafeErrorResponse("FORBIDDEN"'), "Code.js returns FORBIDDEN on base mismatch");

    // 2. Check gasClient.js mock authorization
    const ctx = {
      window: {},
      console,
      localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
      SCRAP_CONFIG: { environment: "DEVELOPMENT", gasEndpoint: "http://mock" }
    };
    vm.createContext(ctx);
    vm.runInContext(gasClientJs, ctx);
    const GasClientClass = ctx.window.GasClient || ctx.GasClient;
    const client = new GasClientClass();
    client.isMockMode = true;

    client.mockSlips = [
      {
        slipNo: "SLIP-BASE-A2",
        baseCode: "A2",
        status: "FINAL"
      }
    ];

    // Wrong base rejection
    const wrongBaseRes = await client.deleteFinalSlip({ slipNo: "SLIP-BASE-A2", baseCode: "B1", employeeNo: "EMP-001" });
    assert.strictEqual(wrongBaseRes.success, false, "Must fail on cross-base delete");
    assert.strictEqual(wrongBaseRes.error, "FORBIDDEN", "Error must be FORBIDDEN");

    // Missing employeeNo rejection
    const missingEmpRes = await client.deleteFinalSlip({ slipNo: "SLIP-BASE-A2", baseCode: "A2", employeeNo: "" });
    assert.strictEqual(missingEmpRes.success, false, "Must fail on missing employeeNo");
  });

  // -----------------------------------------------------------------------------
  // T14: delete audit: DeletedAt / DeletedBy
  // -----------------------------------------------------------------------------
  await runTest("T14", "Delete audit: DeletedAt and DeletedBy recorded and verified", () => {
    // 1. Code.js verifies header presence and writes audit fields
    assert(codeJs.includes('let colDeletedAt = headers.indexOf("DeletedAt");'), "Code.js finds or adds DeletedAt header");
    assert(codeJs.includes('let colDeletedBy = headers.indexOf("DeletedBy");'), "Code.js finds or adds DeletedBy header");
    assert(codeJs.includes('hSheet.getRange(targetRow, colDeletedAt + 1).setValue(now);'), "Code.js writes DeletedAt");
    assert(codeJs.includes('hSheet.getRange(targetRow, colDeletedBy + 1).setValue(employeeNo);'), "Code.js writes DeletedBy");

    // 2. History detail in app.js displays both
    assert(appJs.includes("DeletedAt") || appJs.includes("deletedAt"), "app.js references deletedAt");
    assert(appJs.includes("DeletedBy") || appJs.includes("deletedBy"), "app.js references deletedBy");
  });

  // -----------------------------------------------------------------------------
  // T15: revisions updated
  // -----------------------------------------------------------------------------
  await runTest("T15", "Revisions updated: history, slip count, and material summary revisions incremented", () => {
    // 1. Code.js increments revisions
    assert(codeJs.includes('incrementRevision(ss, "HISTORY");'), "Increments HISTORY revision");
    assert(codeJs.includes('incrementRevision(ss, "SLIP_COUNT");'), "Increments SLIP_COUNT revision");
    assert(codeJs.includes('incrementRevision(ss, "MATERIAL_SUMMARY");'), "Increments MATERIAL_SUMMARY revision when code items exist");

    // 2. gasClient.js mock increments revisions
    assert(gasClientJs.includes('this._mockRevisions.historyRevisions[cleanBaseCode]++;'), "gasClient increments history revision");
    assert(gasClientJs.includes('this._mockRevisions.slipCountRevisions[cleanBaseCode]++;'), "gasClient increments slip count revision");
    assert(gasClientJs.includes('this._mockRevisions.summaryRevisions[cleanBaseCode]++;'), "gasClient increments material summary revision");
  });

  // -----------------------------------------------------------------------------
  // T16: duplicate delete is idempotent or safely rejected, no second mutation
  // -----------------------------------------------------------------------------
  await runTest("T16", "Duplicate delete is idempotent or safely rejected without second mutation", async () => {
    // 1. Code.js checks currentStatus === "DELETED"
    assert(codeJs.includes('if (currentStatus === "DELETED")'), "Code.js checks if currentStatus is DELETED");
    assert(codeJs.includes('return createSafeErrorResponse("SLIP_ALREADY_DELETED"'), "Returns SLIP_ALREADY_DELETED on duplicate delete");

    // 2. gasClient.js duplicate delete test
    const ctx = {
      window: {},
      console,
      localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
      SCRAP_CONFIG: { environment: "DEVELOPMENT", gasEndpoint: "http://mock" }
    };
    vm.createContext(ctx);
    vm.runInContext(gasClientJs, ctx);
    const GasClientClass = ctx.window.GasClient || ctx.GasClient;
    const client = new GasClientClass();
    client.isMockMode = true;

    const originalDeletedAt = "2026-10-01T10:00:00Z";
    client.mockSlips = [
      {
        slipNo: "SLIP-ALREADY-DEL",
        baseCode: "A2",
        status: "DELETED",
        deletedAt: originalDeletedAt,
        deletedBy: "EMP-ORIGINAL"
      }
    ];

    const dupRes = await client.deleteFinalSlip({ slipNo: "SLIP-ALREADY-DEL", baseCode: "A2", employeeNo: "EMP-ATTACKER" });
    assert.strictEqual(dupRes.success, false, "Duplicate delete safely rejected");
    assert.strictEqual(dupRes.error, "SLIP_ALREADY_DELETED", "Response marks error: SLIP_ALREADY_DELETED");

    const slipAfter = client.mockSlips.find(s => s.slipNo === "SLIP-ALREADY-DEL");
    assert.strictEqual(slipAfter.deletedAt, originalDeletedAt, "DeletedAt must NOT be mutated on duplicate delete");
    assert.strictEqual(slipAfter.deletedBy, "EMP-ORIGINAL", "DeletedBy must NOT be mutated on duplicate delete");
  });

  console.log("================================================================================");
  console.log(`OPERATION ENHANCEMENT 01 FOCUSED TESTS COMPLETE: ${testsPassed} passed, ${testsFailed} failed`);
  console.log("================================================================================");

  if (testsFailed > 0) {
    process.exit(1);
  }
}

main().catch(err => {
  console.error("FATAL ERROR in test runner:", err);
  process.exit(1);
});
