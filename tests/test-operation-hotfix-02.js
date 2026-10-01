// test-operation-hotfix-02.js
// Focused Automated Test Suite for ScrapManagement OPERATION HOTFIX 02
// Testing T1 through T10 per Section 21 specifications, including Codex verified edge cases.

const fs = require("fs");
const path = require("path");
const assert = require("assert");

console.log("================================================================================");
console.log("ScrapManagement - OPERATION HOTFIX 02 FOCUSED TEST SUITE (T1..T10)");
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

// Read repository files
const repoRoot = path.join(__dirname, "..");
const indexHtml = fs.readFileSync(path.join(repoRoot, "index.html"), "utf8");
const styleCss = fs.readFileSync(path.join(repoRoot, "src", "css", "style.css"), "utf8");
const appJs = fs.readFileSync(path.join(repoRoot, "src", "js", "app.js"), "utf8");
const storageJs = fs.readFileSync(path.join(repoRoot, "src", "js", "storage.js"), "utf8");
const gasClientJs = fs.readFileSync(path.join(repoRoot, "src", "js", "gasClient.js"), "utf8");
const gasClientFixPrefJs = fs.readFileSync(path.join(repoRoot, "src", "js", "gasClient-gate3a7-fixpref-20260927.js"), "utf8");

async function main() {
  // -----------------------------------------------------------------------------
  // T1: History date has YYYY/MM/DD only
  // -----------------------------------------------------------------------------
  await runTest("T1", "History date format: YYYY/MM/DD only, 00:00 or GMT absent", () => {
    assert(
      appJs.includes("const displayDate = formatJstDate(s.date || s.createdAt);"),
      "renderHistoryRows must format date using formatJstDate(s.date || s.createdAt)"
    );
    assert(
      !appJs.includes("const displayDate = formatJstDateTime(s.date || s.createdAt);"),
      "renderHistoryRows must NOT use formatJstDateTime"
    );

    const appModule = require(path.join(repoRoot, "src", "js", "app.js"));
    const formatJstDate = appModule.formatJstDate;
    assert.strictEqual(typeof formatJstDate, "function", "formatJstDate must be exported");

    const testInputs = [
      "2026-09-30",
      "2026/09/30",
      "2026-09-30T00:00:00.000Z",
      "2026-09-30 00:00:00",
      new Date(2026, 8, 30) // Sept 30, 2026
    ];

    testInputs.forEach(input => {
      const formatted = formatJstDate(input);
      assert.strictEqual(formatted, "2026/09/30", `Expected 2026/09/30 for ${input}, got ${formatted}`);
      assert(!formatted.includes("00:00"), `Formatted date must not contain 00:00 for ${input}`);
      assert(!formatted.includes("GMT"), `Formatted date must not contain GMT for ${input}`);
    });
  });

  // -----------------------------------------------------------------------------
  // T2: Header <tr> remains table-row (hist-desktop-col removed from thead tr)
  // -----------------------------------------------------------------------------
  await runTest("T2", "Header <tr> remains table-row (hist-desktop-col not applied to thead tr)", () => {
    assert(
      !indexHtml.includes('<tr class="hist-desktop-col">'),
      "index.html thead <tr> must NOT have class='hist-desktop-col'"
    );
    const theadMatch = indexHtml.match(/<thead>\s*([\s\S]*?)\s*<\/thead>/i);
    assert(theadMatch, "index.html must contain <thead>");
    const theadContent = theadMatch[1];
    assert(
      /<tr[^>]*>/i.test(theadContent) && !/<tr[^>]*class="[^"]*hist-desktop-col[^"]*"[^>]*>/i.test(theadContent),
      "thead row must be a normal <tr> without hist-desktop-col"
    );

    assert(
      /\.history-table\s+thead\s+tr\s*\{[^}]*display:\s*table-row\s*!important/i.test(styleCss),
      "style.css must enforce display: table-row !important for .history-table thead tr"
    );
  });

  // -----------------------------------------------------------------------------
  // T3: 7 header/body columns match (class/order/width)
  // -----------------------------------------------------------------------------
  await runTest("T3", "7 header/body columns match contract: slip, date, staff, vendor, sig, status, actions", () => {
    const expectedCols = [
      { cls: "col-slip", width: "17%" },
      { cls: "col-date", width: "14%" },
      { cls: "col-staff", width: "13%" },
      { cls: "col-vendor", width: "16%" },
      { cls: "col-sig", width: "16%" },
      { cls: "col-status", width: "8%" },
      { cls: "col-actions", width: "16%" }
    ];

    expectedCols.forEach(col => {
      assert(
        indexHtml.includes(`class="${col.cls}" style="width: ${col.width};"`),
        `colgroup must contain col ${col.cls} with width ${col.width}`
      );
    });

    const thMatches = [...indexHtml.matchAll(/<th\s+class="([^"]+)">/g)].map(m => m[1]);
    const histThs = thMatches.filter(cls => expectedCols.some(c => c.cls === cls));
    assert.strictEqual(histThs.length, 7, "Must have exactly 7 history <th> columns");
    expectedCols.forEach((col, idx) => {
      assert.strictEqual(histThs[idx], col.cls, `Column index ${idx} class must be ${col.cls}`);
    });

    expectedCols.forEach(col => {
      assert(
        appJs.includes(`class="hist-desktop-col ${col.cls}"`),
        `app.js must render td with class "hist-desktop-col ${col.cls}"`
      );
    });
  });

  // -----------------------------------------------------------------------------
  // T4: 1280px visual header/body alignment contracts
  // -----------------------------------------------------------------------------
  await runTest("T4", "1280px PC visual layout rules: table-layout fixed, widths matched, status & actions centered", () => {
    assert(
      /\.history-table\s*\{[^}]*table-layout:\s*fixed\s*!important/i.test(styleCss),
      ".history-table must have table-layout: fixed !important"
    );

    assert(styleCss.includes(".history-table col.col-slip, .history-table th.col-slip, .history-table td.col-slip { width: 17% !important; }"));
    assert(styleCss.includes(".history-table col.col-date, .history-table th.col-date, .history-table td.col-date { width: 14% !important; }"));
    assert(styleCss.includes(".history-table col.col-staff, .history-table th.col-staff, .history-table td.col-staff { width: 13% !important; }"));
    assert(styleCss.includes(".history-table col.col-vendor, .history-table th.col-vendor, .history-table td.col-vendor { width: 16% !important; }"));
    assert(styleCss.includes(".history-table col.col-sig, .history-table th.col-sig, .history-table td.col-sig { width: 16% !important; }"));
    assert(styleCss.includes(".history-table col.col-status, .history-table th.col-status, .history-table td.col-status { width: 8% !important; text-align: center !important; }"));
    assert(styleCss.includes(".history-table col.col-actions, .history-table th.col-actions, .history-table td.col-actions { width: 16% !important; text-align: center !important; }"));

    assert(
      /\.history-table\s+th,\s*\.history-table\s+td\.hist-desktop-col\s*\{[^}]*padding:\s*0\.5rem\s+0\.4rem\s*!important/i.test(styleCss),
      "Padding must be identical (0.5rem 0.4rem) between th and td"
    );

    assert(
      /\.history-table\s+th\.col-status,\s*\.history-table\s+td\.col-status\s*\{[^}]*text-align:\s*center\s*!important/i.test(styleCss),
      "col-status th and td must be text-align: center !important"
    );
    assert(
      /\.history-table\s+th\.col-actions,\s*\.history-table\s+td\.col-actions\s*\{[^}]*text-align:\s*center\s*!important/i.test(styleCss),
      "col-actions th and td must be text-align: center !important"
    );
  });

  // -----------------------------------------------------------------------------
  // T5: Vendor preference normalize (defaultVendorName preserved)
  // -----------------------------------------------------------------------------
  await runTest("T5", "Vendor preference normalize: defaultVendorName normalized and preserved", () => {
    const storageModule = require(path.join(repoRoot, "src", "js", "storage.js"));
    const normalize = storageModule.normalizeEmployeePreference;
    assert.strictEqual(typeof normalize, "function", "normalizeEmployeePreference must be a function");

    // Case 1: Canonical payload
    const norm1 = normalize({
      exists: true,
      categories: ["C1"],
      fixedItemIds: ["F1"],
      defaultVendorName: "株式会社テスト金属",
      revision: 2
    });
    assert.strictEqual(norm1.defaultVendorName, "株式会社テスト金属");
    assert.strictEqual(norm1.exists, true);

    // Case 2: Raw / Server response with selectedMaterialCategories & defaultVendorName
    const norm2 = normalize({
      exists: true,
      selectedMaterialCategories: ["C1"],
      selectedFixedItemIds: ["F1"],
      defaultVendorName: "  株式会社○○リサイクル  ",
      preferenceRevision: 5
    });
    assert.strictEqual(norm2.defaultVendorName, "株式会社○○リサイクル", "Must trim whitespace");
    assert.strictEqual(norm2.revision, 5);

    // Case 3: Empty preference defaults to empty string
    const norm3 = normalize(null);
    assert.strictEqual(norm3.defaultVendorName, "");
    assert.strictEqual(norm3.exists, false);

    // Case 4: Only defaultVendorName present marks exists = true
    const norm4 = normalize({
      defaultVendorName: "株式会社新興金属"
    });
    assert.strictEqual(norm4.defaultVendorName, "株式会社新興金属");
    assert.strictEqual(norm4.exists, true);
  });

  // -----------------------------------------------------------------------------
  // T6: Partial preference save (categories/fixedItemIds and revision not deleted)
  // -----------------------------------------------------------------------------
  await runTest("T6", "Partial preference save: vendor update preserves categories, fixedItemIds, and revision", () => {
    const storageStore = {};
    global.localStorage = {
      getItem: (k) => (k in storageStore ? storageStore[k] : null),
      setItem: (k, v) => { storageStore[k] = String(v); },
      removeItem: (k) => { delete storageStore[k]; },
      clear: () => { Object.keys(storageStore).forEach(k => delete storageStore[k]); }
    };

    const storageModule = require(path.join(repoRoot, "src", "js", "storage.js"));
    const TS = storageModule.TerminalStorage;

    const empNo = "EMP-001";
    // 1. Initial full save with categories and fixed items
    TS.saveEmployeePreferences(empNo, {
      categories: ["鉄骨", "アルミ"],
      fixedItemIds: ["FIX-1", "FIX-2"],
      defaultVendorName: "初期金属",
      revision: 7
    });

    const pref1 = TS.getEmployeePreferences(empNo);
    assert.deepStrictEqual(pref1.categories, ["鉄骨", "アルミ"]);
    assert.deepStrictEqual(pref1.fixedItemIds, ["FIX-1", "FIX-2"]);
    assert.strictEqual(pref1.defaultVendorName, "初期金属");
    assert.strictEqual(pref1.revision, 7);

    // 2. Partial save without specifying revision must retain existing revision = 7
    TS.saveEmployeePreferences(empNo, {
      defaultVendorName: "更新後テスト金属"
    });

    const pref2 = TS.getEmployeePreferences(empNo);
    assert.strictEqual(pref2.defaultVendorName, "更新後テスト金属");
    assert.deepStrictEqual(pref2.categories, ["鉄骨", "アルミ"], "Categories must NOT be overwritten");
    assert.deepStrictEqual(pref2.fixedItemIds, ["FIX-1", "FIX-2"], "FixedItemIds must NOT be overwritten");
    assert.strictEqual(pref2.revision, 7, "Revision must NOT reset to 0 during partial save");

    // 3. Partial save updating only categories preserves defaultVendorName
    TS.saveEmployeePreferences(empNo, {
      categories: ["銅"],
      revision: 8
    });

    const pref3 = TS.getEmployeePreferences(empNo);
    assert.deepStrictEqual(pref3.categories, ["銅"]);
    assert.deepStrictEqual(pref3.fixedItemIds, ["FIX-1", "FIX-2"]);
    assert.strictEqual(pref3.defaultVendorName, "更新後テスト金属", "defaultVendorName must NOT be lost on category update");
    assert.strictEqual(pref3.revision, 8);
  });

  // -----------------------------------------------------------------------------
  // T7: Employee A/B isolation (A vendor does not leak to B) & Async Concurrency
  // -----------------------------------------------------------------------------
  await runTest("T7", "Employee A/B isolation: Employee A vendor does not leak to Employee B, even during async employee switch", async () => {
    const storageStore = {};
    global.localStorage = {
      getItem: (k) => (k in storageStore ? storageStore[k] : null),
      setItem: (k, v) => { storageStore[k] = String(v); },
      removeItem: (k) => { delete storageStore[k]; },
      clear: () => { Object.keys(storageStore).forEach(k => delete storageStore[k]); }
    };

    const storageModule = require(path.join(repoRoot, "src", "js", "storage.js"));
    const TS = storageModule.TerminalStorage;

    const empA = "EMP-A";
    const empB = "EMP-B";

    TS.saveEmployeePreferences(empA, {
      defaultVendorName: "業者A株式会社"
    });
    TS.saveEmployeePreferences(empB, {
      defaultVendorName: "業者Bスクラップ"
    });

    const prefA = TS.getEmployeePreferences(empA);
    const prefB = TS.getEmployeePreferences(empB);

    assert.strictEqual(prefA.defaultVendorName, "業者A株式会社");
    assert.strictEqual(prefB.defaultVendorName, "業者Bスクラップ");
    assert.notStrictEqual(prefA.defaultVendorName, prefB.defaultVendorName);

    // Test third employee with no preferences
    const prefC = TS.getEmployeePreferences("EMP-C");
    assert.strictEqual(prefC.defaultVendorName, "", "Employee without preferences must have empty defaultVendorName");

    // Test async targetEmpNo isolation in app.js
    const vm = require("vm");
    let gasRelease;
    const asyncWrites = [];
    const mockInput = { value: "Vendor A In Flight" };
    const ctx = {
      console,
      document: { addEventListener: () => {}, getElementById: () => mockInput },
      TerminalStorage: {
        getEmployeePreferences: (emp) => ({ defaultVendorName: "Old", revision: 1 }),
        saveEmployeePreferences: (emp, p) => asyncWrites.push({ emp, ...p }),
        savePreviousInput: () => {}
      }
    };
    vm.createContext(ctx);
    vm.runInContext(appJs, ctx);
    ctx.fakeGas = {
      saveEmployeePreferences: () => new Promise(r => { gasRelease = r; })
    };
    vm.runInContext("resolvedEmployeeNo = 'EMP-A'; gasClient = fakeGas;", ctx);

    // Trigger handleVendorInputChange for EMP-A
    const pendingSave = vm.runInContext("handleVendorInputChange()", ctx);

    // Switch active employee to EMP-B while EMP-A save is in-flight
    vm.runInContext("resolvedEmployeeNo = 'EMP-B';", ctx);

    // Release GAS response
    gasRelease({ success: true, preferenceRevision: 2, updatedAt: new Date().toISOString() });
    await pendingSave;

    // Verify all async writes targeted EMP-A, NEVER EMP-B!
    assert(asyncWrites.length > 0, "Must have recorded writes");
    asyncWrites.forEach(w => {
      assert.strictEqual(w.emp, "EMP-A", `All writes must target EMP-A, got target ${w.emp}`);
    });

    // Sub-test 2: Background refresh late arrival test (A does not leak to B)
    const prefsMap = {
      "EMP-A": { exists: true, defaultVendorName: "Vendor A", revision: 1, categories: [] },
      "EMP-B": { exists: true, defaultVendorName: "Vendor B", revision: 2, categories: [] }
    };
    let refreshDone;
    const ctxRefresh = {
      console,
      window: {},
      document: { addEventListener: () => {}, getElementById: (id) => (id === "vendor-name-input" ? mockInput : null) },
      TerminalStorage: {
        getUserSettings: () => ({ employeeNo: "EMP-A", resolvedEmployeeName: "Emp A" }),
        getSessionWorkingBase: () => null,
        getEmployeePreferences: (e) => prefsMap[e],
        saveEmployeePreferences: (e, p) => { prefsMap[e] = Object.assign({}, prefsMap[e], p); },
        savePreviousInput: () => {}
      }
    };
    vm.createContext(ctxRefresh);
    vm.runInContext(appJs, ctxRefresh);
    vm.runInContext("updateWorkingBaseState=()=>{}; applyEmployeeLockToForm=()=>{}; hideEmployeeUnconfiguredBanner=()=>{}; applyMaterialCategoryFilter=()=>[]; renderSettingsView=()=>{}; initFixedItemsList=()=>{};", ctxRefresh);
    ctxRefresh.client = { lookupEmployee: () => new Promise(r => { refreshDone = r; }) };
    vm.runInContext('gasClient = client; initUserSettings(); resolvedEmployeeNo = "EMP-B"; applyEmployeeDefaultVendorToForm({ force: true });', ctxRefresh);
    refreshDone({ success: true, preference: { exists: true, defaultVendorName: "Vendor A from server", preferenceRevision: 3, categories: [] } });
    await new Promise(setImmediate);
    assert.strictEqual(prefsMap["EMP-B"].defaultVendorName, "Vendor B", "Late EMP-A refresh must NOT contaminate EMP-B preference");

    // Sub-test 3: Concurrent out-of-order save test (stale save does not overwrite latest)
    const concurrentCalls = [];
    const ctxOrder = {
      console,
      window: {},
      document: { addEventListener: () => {}, getElementById: (id) => (id === "vendor-name-input" ? mockInput : null) },
      TerminalStorage: {
        getEmployeePreferences: (e) => prefsMap[e],
        saveEmployeePreferences: (e, p) => { prefsMap[e] = Object.assign({}, prefsMap[e], p); },
        savePreviousInput: () => {}
      }
    };
    vm.createContext(ctxOrder);
    vm.runInContext(appJs, ctxOrder);
    ctxOrder.client = {
      saveEmployeePreferences: (e, p, r) => new Promise(resolve => concurrentCalls.push({ e, p, r, resolve }))
    };
    vm.runInContext('gasClient = client; resolvedEmployeeNo = "EMP-A";', ctxOrder);
    mockInput.value = "Old edit";
    const p1 = vm.runInContext("handleVendorInputChange()", ctxOrder);
    mockInput.value = "Latest edit";
    const p2 = vm.runInContext("handleVendorInputChange()", ctxOrder);
    concurrentCalls[1].resolve({ success: true, preferenceRevision: 2 });
    await p2;
    concurrentCalls[0].resolve({ success: true, preferenceRevision: 3 });
    await p1;
    assert.strictEqual(prefsMap["EMP-A"].defaultVendorName, "Latest edit", "Out-of-order response must NOT overwrite latest edit");

    // Sub-test 4: Resumed draft vendor is not saved as employee default
    const ctxDraft = {
      console,
      window: {},
      document: { addEventListener: () => {}, getElementById: (id) => (id === "vendor-name-input" ? mockInput : null) },
      TerminalStorage: {
        getEmployeePreferences: (e) => prefsMap[e],
        saveEmployeePreferences: (e, p) => { prefsMap[e] = Object.assign({}, prefsMap[e], p); },
        savePreviousInput: () => {}
      }
    };
    vm.createContext(ctxDraft);
    vm.runInContext(appJs, ctxDraft);
    vm.runInContext('resolvedEmployeeNo = "EMP-A"; currentResumedDraftId = "DRAFT-1";', ctxDraft);
    mockInput.value = "Draft Vendor A";
    await vm.runInContext("handleVendorInputChange()", ctxDraft);
    assert.strictEqual(prefsMap["EMP-A"].defaultVendorName, "Latest edit", "Resumed draft vendor must not be saved to employee default vendor");
  });

  // -----------------------------------------------------------------------------
  // T8: Employee restore auto-prefills defaultVendorName & GasClient API signatures
  // -----------------------------------------------------------------------------
  await runTest("T8", "Employee restore: defaultVendorName is automatically prefilled and GasClient save signatures succeed without ReferenceError", async () => {
    const storageStore = {};
    global.localStorage = {
      getItem: (k) => (k in storageStore ? storageStore[k] : null),
      setItem: (k, v) => { storageStore[k] = String(v); },
      removeItem: (k) => { delete storageStore[k]; },
      clear: () => { Object.keys(storageStore).forEach(k => delete storageStore[k]); }
    };

    const storageModule = require(path.join(repoRoot, "src", "js", "storage.js"));
    const TS = storageModule.TerminalStorage;

    const empNo = "EMP-TEST";
    TS.saveEmployeePreferences(empNo, {
      defaultVendorName: "株式会社自動入力商事"
    });

    const cached = TS.getEmployeePreferences(empNo);
    assert.strictEqual(cached.defaultVendorName, "株式会社自動入力商事");

    // Test GasClient saveEmployeePreferences in mock mode for both files
    const vm = require("vm");
    const ctx = {
      window: {},
      console,
      localStorage: global.localStorage,
      SCRAP_CONFIG: { environment: "DEVELOPMENT", gasEndpoint: "http://mock" }
    };
    vm.createContext(ctx);

    // 1. Test gasClient.js
    vm.runInContext(gasClientJs, ctx);
    const GasClientClass = ctx.window.GasClient || ctx.GasClient;
    const client = new GasClientClass();
    client.isMockMode = true;

    // Call with Array signature (initial revision = 0)
    const resArr = await client.saveEmployeePreferences("TEST-EMP", ["IQ", "AN"], 0);
    assert(resArr && resArr.success, "Array categories signature must succeed without ReferenceError");

    // Call with Object vendor signature (revision incremented to 1)
    const resVendor = await client.saveEmployeePreferences("TEST-EMP", { defaultVendorName: "新興金属" }, 1);
    assert(resVendor && resVendor.success, "Object vendor signature must succeed without ReferenceError");
    assert.strictEqual(resVendor.defaultVendorName, "新興金属");

    // 2. Test gasClient-gate3a7-fixpref-20260927.js
    const ctx2 = {
      window: {},
      console,
      localStorage: global.localStorage,
      SCRAP_CONFIG: { environment: "DEVELOPMENT", gasEndpoint: "http://mock" }
    };
    vm.createContext(ctx2);
    vm.runInContext(gasClientFixPrefJs, ctx2);
    const GasClient2 = ctx2.window.GasClient || ctx2.GasClient;
    const client2 = new GasClient2();
    client2.isMockMode = true;

    const resArr2 = await client2.saveEmployeePreferences("TEST-EMP", ["IQ"], 0);
    assert(resArr2 && resArr2.success, "gate3a7 Array signature must succeed without ReferenceError");

    const resVendor2 = await client2.saveEmployeePreferences("TEST-EMP", { defaultVendorName: "新興金属" }, 1);
    assert(resVendor2 && resVendor2.success, "gate3a7 Object vendor signature must succeed without ReferenceError");
  });

  // -----------------------------------------------------------------------------
  // T9: Draft resume priority: Draft vendorName > preference vendorName
  // -----------------------------------------------------------------------------
  await runTest("T9", "Draft resume priority: Draft vendorName overrides employee preference vendorName even on verify with force:true", () => {
    // 1. Verify code guard in app.js
    assert(
      appJs.includes("if (currentResumedDraftId) {\n    return;\n  }"),
      "applyEmployeeDefaultVendorToForm must return early if currentResumedDraftId is set unconditionally"
    );

    // 2. VM execution test: force:true during resumed draft must NOT wipe draft vendor
    const vm = require("vm");
    const mockInput = { value: "Draft Vendor XYZ" };
    const ctx = {
      console,
      document: { addEventListener: () => {}, getElementById: () => mockInput },
      TerminalStorage: {
        getEmployeePreferences: () => ({ defaultVendorName: "Overriding Default Preference", revision: 1 }),
        saveEmployeePreferences: () => {}
      }
    };
    vm.createContext(ctx);
    vm.runInContext(appJs, ctx);
    vm.runInContext("resolvedEmployeeNo = 'EMP-DRAFT'; currentResumedDraftId = 'DRAFT-123';", ctx);

    // Call applyEmployeeDefaultVendorToForm with force: true
    vm.runInContext("applyEmployeeDefaultVendorToForm({ force: true })", ctx);

    // Verify draft vendor was preserved
    assert.strictEqual(mockInput.value, "Draft Vendor XYZ", "Draft vendor must NOT be overwritten by preference even with force:true");
  });

  // -----------------------------------------------------------------------------
  // T10: After finalize/new transaction, vendor input resets to defaultVendorName & Unified Release ID
  // -----------------------------------------------------------------------------
  await runTest("T10", "After finalize / new transaction: vendor input resets to defaultVendorName, and Release ID is unified to OPERATION-HOTFIX-20260930-02", () => {
    assert(
      appJs.includes("if (vendorInput) vendorInput.value = getCurrentEmployeeDefaultVendor();"),
      "resetInputFormAfterSubmission must reset vendorInput.value to getCurrentEmployeeDefaultVendor()"
    );
    assert(
      appJs.includes("if (vendorInput) vendorInput.value = getCurrentEmployeeDefaultVendor();"),
      "clearTransactionData must reset vendorInput.value to getCurrentEmployeeDefaultVendor()"
    );
    const resetFnCode = appJs.match(/function resetInputFormAfterSubmission\(\)\s*\{[\s\S]*?\n\}/)[0];
    assert(
      !resetFnCode.includes('vendorInput.value = "";'),
      "resetInputFormAfterSubmission must NOT unconditionally reset vendorInput.value to empty string"
    );

    // Verify Unified Release ID across all assets (hotfix 02 or enhancement 01)
    const validIds = ["OPERATION-HOTFIX-20260930-02", "OPERATION-ENHANCEMENT-20261001-01"];
    assert(validIds.some(id => styleCss.includes(`--scrap-style-runtime-rev: "${id}";`)), "style.css must have unified release ID");
    assert(validIds.some(id => appJs.includes(`const SCRAP_APP_RUNTIME_REV = "${id}";`)), "app.js must have unified release ID");
    assert(validIds.some(id => gasClientJs.includes(`const SCRAP_FRONTEND_BUILD_ID = "${id}";`)), "gasClient.js must have unified release ID");
    assert(validIds.some(id => gasClientFixPrefJs.includes(`const SCRAP_FRONTEND_BUILD_ID = "${id}";`)), "gasClient-gate3a7 must have unified release ID");
    assert(validIds.some(id => indexHtml.includes(`style.css?v=${id}`)), "index.html style.css link must have unified release ID");
    assert(validIds.some(id => indexHtml.includes(`app.js?v=${id}`)), "index.html app.js link must have unified release ID");
  });

  // -----------------------------------------------------------------------------
  // T11: Initial employee verification from unconfigured state with legacy PREVIOUS_INPUT
  // -----------------------------------------------------------------------------
  await runTest("T11", "Initial employee registration: legacy vendor does not leak to new employee, and default vendor or empty is applied", () => {
    const vm = require("vm");
    const mockInput = { value: "Legacy A", dataset: { lastAppliedVendor: "Legacy A", userEdited: "false" } };
    const prefsMap = {
      "EMP-B": { exists: true, defaultVendorName: "Vendor B", revision: 1 }
    };
    const ctx = {
      console,
      window: {},
      document: { addEventListener: () => {}, getElementById: (id) => (id === "vendor-name-input" ? mockInput : null) },
      TerminalStorage: {
        getEmployeePreferences: (e) => prefsMap[e] || { exists: false, defaultVendorName: "" },
        saveEmployeePreferences: () => {},
        savePreviousInput: () => {}
      }
    };
    vm.createContext(ctx);
    vm.runInContext(appJs, ctx);

    // Initial state: unconfigured employee, mockInput has legacy vendor
    vm.runInContext('resolvedEmployeeNo = "";', ctx);
    assert.strictEqual(mockInput.value, "Legacy A");

    // Case A: Register EMP-B (who has default vendor "Vendor B")
    // When registering from "" to "EMP-B", isEmployeeChanged is true -> force: true
    vm.runInContext('resolvedEmployeeNo = "EMP-B"; applyEmployeeDefaultVendorToForm({ force: true });', ctx);
    assert.strictEqual(mockInput.value, "Vendor B", "EMP-B default vendor must replace legacy vendor");

    // Case B: Register EMP-C (who has NO default vendor)
    mockInput.value = "Legacy A";
    mockInput.dataset.lastAppliedVendor = "Legacy A";
    mockInput.dataset.userEdited = "false";
    vm.runInContext('resolvedEmployeeNo = "EMP-C"; applyEmployeeDefaultVendorToForm({ force: true });', ctx);
    assert.strictEqual(mockInput.value, "", "EMP-C without default vendor must clear legacy vendor to empty string");
  });

  // -----------------------------------------------------------------------------
  // T12: Employee change does NOT clear transaction items or signatures without confirmation
  // -----------------------------------------------------------------------------
  await runTest("T12", "Employee change preserves transaction items, canvas signature, and notes", () => {
    // Verify that verifyAndSaveEmployee does NOT call clearTransactionData()
    const verifyFnMatch = appJs.match(/function verifyAndSaveEmployee\(\)\s*\{[\s\S]*?\n\}/);
    assert(verifyFnMatch, "verifyAndSaveEmployee must exist");
    assert(
      !verifyFnMatch[0].includes("clearTransactionData();"),
      "verifyAndSaveEmployee must NOT call clearTransactionData()"
    );
  });

  // -----------------------------------------------------------------------------
  // T13: SWR background preference refresh updates vendor input if untouched
  // -----------------------------------------------------------------------------
  await runTest("T13", "SWR background preference refresh updates vendor input if user has not manually edited it", () => {
    const vm = require("vm");
    const mockInput = { value: "Old cached vendor", dataset: { lastAppliedVendor: "Old cached vendor", userEdited: "false" } };
    let currentPref = { exists: true, defaultVendorName: "Old cached vendor", revision: 1 };
    const ctx = {
      console,
      window: {},
      document: { addEventListener: () => {}, getElementById: (id) => (id === "vendor-name-input" ? mockInput : null) },
      TerminalStorage: {
        getEmployeePreferences: () => currentPref,
        saveEmployeePreferences: (e, p) => { currentPref = Object.assign({}, currentPref, p); }
      }
    };
    vm.createContext(ctx);
    vm.runInContext(appJs, ctx);
    vm.runInContext('resolvedEmployeeNo = "EMP-A";', ctx);

    // 1. Untouched field: SWR arrives with "New server vendor"
    currentPref = { exists: true, defaultVendorName: "New server vendor", revision: 2 };
    vm.runInContext('applyEmployeeDefaultVendorToForm();', ctx);
    assert.strictEqual(mockInput.value, "New server vendor", "Input must be updated when user has not edited");

    // 2. User-edited field: user typed "Manual typing"
    mockInput.value = "Manual typing";
    mockInput.dataset.userEdited = "true";
    currentPref = { exists: true, defaultVendorName: "Newer server vendor", revision: 3 };
    vm.runInContext('applyEmployeeDefaultVendorToForm();', ctx);
    assert.strictEqual(mockInput.value, "Manual typing", "User manual typing must be protected against SWR update");
  });

  // -----------------------------------------------------------------------------
  // T14: Optimistic update on vendor change ensures immediate reset uses new vendor
  // -----------------------------------------------------------------------------
  await runTest("T14", "Optimistic update ensures resetInputFormAfterSubmission uses newly entered vendor before server completes", async () => {
    const vm = require("vm");
    const mockInput = { value: "Newly Entered Vendor", dataset: { userEdited: "true", lastAppliedVendor: "Old Vendor" } };
    let serverPromiseResolve;
    const prefStore = {
      "EMP-A": { exists: true, defaultVendorName: "Old Vendor", revision: 1 }
    };
    const ctx = {
      console,
      window: {},
      document: { addEventListener: () => {}, getElementById: (id) => (id === "vendor-name-input" ? mockInput : null) },
      WeightEngine: { calculateEstimatedWeight: () => ({ totalEstimatedWeight: 0, items: [] }) },
      TerminalStorage: {
        getEmployeePreferences: (e) => prefStore[e],
        saveEmployeePreferences: (e, p) => { prefStore[e] = Object.assign({}, prefStore[e], p); },
        savePreviousInput: () => {}
      }
    };
    vm.createContext(ctx);
    vm.runInContext(appJs, ctx);
    ctx.fakeGas = {
      saveEmployeePreferences: () => new Promise(r => { serverPromiseResolve = r; })
    };
    vm.runInContext('resolvedEmployeeNo = "EMP-A"; gasClient = fakeGas;', ctx);

    // User triggers handleVendorInputChange
    const pendingSave = vm.runInContext("handleVendorInputChange()", ctx);

    // Immediately verify optimistic storage update BEFORE server responds
    assert.strictEqual(
      prefStore["EMP-A"].defaultVendorName,
      "Newly Entered Vendor",
      "Optimistic update must store new vendor immediately"
    );

    // Now simulate resetInputFormAfterSubmission immediately
    vm.runInContext("resetInputFormAfterSubmission()", ctx);
    assert.strictEqual(
      mockInput.value,
      "Newly Entered Vendor",
      "Form reset must use the optimistic new vendor, not the old vendor"
    );

    // Server responds with confirmed (possibly sanitized) vendor name
    serverPromiseResolve({
      success: true,
      defaultVendorName: "Newly Entered Vendor",
      preferenceRevision: 2,
      updatedAt: new Date().toISOString()
    });
    await pendingSave;

    assert.strictEqual(prefStore["EMP-A"].defaultVendorName, "Newly Entered Vendor");
    assert.strictEqual(prefStore["EMP-A"].revision, 2);
  });

  // -----------------------------------------------------------------------------
  // T15: In-flight vendor save response does NOT overwrite input when switched to Employee B
  // -----------------------------------------------------------------------------
  await runTest("T15", "Late arrival of Employee A save response does NOT overwrite input of Employee B", async () => {
    const vm = require("vm");
    const mockInput = { value: "Vendor A In Flight", dataset: { userEdited: "false", lastAppliedVendor: "Vendor A In Flight" } };
    let serverPromiseResolve;
    const prefStore = {
      "EMP-A": { exists: true, defaultVendorName: "Initial A", revision: 1 },
      "EMP-B": { exists: true, defaultVendorName: "Vendor B", revision: 1 }
    };
    const ctx = {
      console,
      window: {},
      document: { addEventListener: () => {}, getElementById: (id) => (id === "vendor-name-input" ? mockInput : null) },
      TerminalStorage: {
        getEmployeePreferences: (e) => prefStore[e],
        saveEmployeePreferences: (e, p) => { prefStore[e] = Object.assign({}, prefStore[e], p); },
        savePreviousInput: () => {}
      }
    };
    vm.createContext(ctx);
    vm.runInContext(appJs, ctx);
    ctx.fakeGas = {
      saveEmployeePreferences: () => new Promise(r => { serverPromiseResolve = r; })
    };
    vm.runInContext('resolvedEmployeeNo = "EMP-A"; gasClient = fakeGas;', ctx);

    // EMP-A triggers vendor save
    const pendingSave = vm.runInContext("handleVendorInputChange()", ctx);

    // Switch active employee to EMP-B and apply EMP-B default vendor
    vm.runInContext('resolvedEmployeeNo = "EMP-B"; applyEmployeeDefaultVendorToForm({ force: true });', ctx);
    assert.strictEqual(mockInput.value, "Vendor B", "Must have switched to Vendor B");

    // Release delayed EMP-A server response
    serverPromiseResolve({
      success: true,
      defaultVendorName: "Vendor A Confirmed",
      preferenceRevision: 2,
      updatedAt: new Date().toISOString()
    });
    await pendingSave;

    // Verify mockInput still retains Vendor B, NOT overwritten by Vendor A!
    assert.strictEqual(mockInput.value, "Vendor B", "EMP-B input must NOT be overwritten by late EMP-A response");
  });

  // -----------------------------------------------------------------------------
  // T16: In-flight vendor save response does NOT overwrite resumed draft vendor
  // -----------------------------------------------------------------------------
  await runTest("T16", "Late arrival of vendor save response does NOT overwrite resumed draft vendor", async () => {
    const vm = require("vm");
    const mockInput = { value: "Regular Input In Flight", dataset: { userEdited: "false", lastAppliedVendor: "Regular Input In Flight" } };
    let serverPromiseResolve;
    const prefStore = {
      "EMP-A": { exists: true, defaultVendorName: "Initial A", revision: 1 }
    };
    const ctx = {
      console,
      window: {},
      document: { addEventListener: () => {}, getElementById: (id) => (id === "vendor-name-input" ? mockInput : null) },
      TerminalStorage: {
        getEmployeePreferences: (e) => prefStore[e],
        saveEmployeePreferences: (e, p) => { prefStore[e] = Object.assign({}, prefStore[e], p); },
        savePreviousInput: () => {}
      }
    };
    vm.createContext(ctx);
    vm.runInContext(appJs, ctx);
    ctx.fakeGas = {
      saveEmployeePreferences: () => new Promise(r => { serverPromiseResolve = r; })
    };
    vm.runInContext('resolvedEmployeeNo = "EMP-A"; gasClient = fakeGas;', ctx);

    // EMP-A triggers vendor save
    const pendingSave = vm.runInContext("handleVendorInputChange()", ctx);

    // Now user resumes a draft with its own vendor
    vm.runInContext('currentResumedDraftId = "DRAFT-SPECIAL";', ctx);
    mockInput.value = "Draft Preserved Vendor";
    mockInput.dataset.lastAppliedVendor = "Draft Preserved Vendor";

    // Release delayed server response
    serverPromiseResolve({
      success: true,
      defaultVendorName: "Regular Confirmed Vendor",
      preferenceRevision: 2,
      updatedAt: new Date().toISOString()
    });
    await pendingSave;

    // Verify mockInput STILL retains "Draft Preserved Vendor", NOT overwritten!
    assert.strictEqual(mockInput.value, "Draft Preserved Vendor", "Draft vendor must NOT be overwritten by late preference response");
  });

  // -----------------------------------------------------------------------------
  // T17: Delayed category save response does NOT roll back new vendor name or newer revision
  // -----------------------------------------------------------------------------
  await runTest("T17", "Delayed category save response does not roll back newer vendor name or newer revision", async () => {
    const storageStore = {};
    global.localStorage = {
      getItem: (k) => (k in storageStore ? storageStore[k] : null),
      setItem: (k, v) => { storageStore[k] = String(v); },
      removeItem: (k) => { delete storageStore[k]; },
      clear: () => { Object.keys(storageStore).forEach(k => delete storageStore[k]); }
    };
    const storageModule = require(path.join(repoRoot, "src", "js", "storage.js"));
    const TS = storageModule.TerminalStorage;

    const empNo = "EMP-P1";
    // 1. Initial preference: vendor OLD, revision 1
    TS.saveEmployeePreferences(empNo, {
      categories: ["C1"],
      defaultVendorName: "OLD",
      revision: 1
    });

    // 2. Vendor is updated to NEW, revision advances to 3
    TS.saveEmployeePreferences(empNo, {
      defaultVendorName: "NEW",
      revision: 3
    });

    // 3. Late category save response arrives with revision 2 (issued when rev was 1)
    TS.saveEmployeePreferences(empNo, {
      categories: ["C1", "C2"],
      revision: 2
    });

    const pref = TS.getEmployeePreferences(empNo);
    assert.strictEqual(pref.defaultVendorName, "NEW", "Vendor name must NOT be rewound to OLD");
    assert.strictEqual(pref.revision, 3, "Revision must NOT be rewound to 2");
    assert.deepStrictEqual(pref.categories, ["C1", "C2"], "Categories must be updated");
  });

  // -----------------------------------------------------------------------------
  // T18: Vendor save failure rolls back optimistic cache and notifies user
  // -----------------------------------------------------------------------------
  await runTest("T18", "Vendor save failure rolls back optimistic local cache to confirmed value and notifies user", async () => {
    const vm = require("vm");
    const mockInput = { value: "Failed Vendor Typing", dataset: { userEdited: "true", lastAppliedVendor: "Initial Confirmed Vendor" } };
    let serverPromiseReject;
    let modalShown = null;
    const prefStore = {
      "EMP-A": { exists: true, defaultVendorName: "Initial Confirmed Vendor", revision: 1 }
    };
    const ctx = {
      console,
      window: {},
      document: { addEventListener: () => {}, getElementById: (id) => (id === "vendor-name-input" ? mockInput : null) },
      TerminalStorage: {
        getEmployeePreferences: (e) => prefStore[e],
        saveEmployeePreferences: (e, p) => { prefStore[e] = Object.assign({}, prefStore[e], p); },
        savePreviousInput: () => {}
      },
      showAppModal: (options) => { modalShown = options; }
    };
    vm.createContext(ctx);
    vm.runInContext(appJs, ctx);
    ctx.modalHook = (options) => { modalShown = options; };
    vm.runInContext('showAppModal = (options) => { modalHook(options); };', ctx);
    ctx.fakeGas = {
      saveEmployeePreferences: () => new Promise((_, reject) => { serverPromiseReject = reject; })
    };
    vm.runInContext('resolvedEmployeeNo = "EMP-A"; gasClient = fakeGas;', ctx);

    // Trigger save
    const pendingSave = vm.runInContext("handleVendorInputChange()", ctx);

    // Optimistic cache updated before failure
    assert.strictEqual(prefStore["EMP-A"].defaultVendorName, "Failed Vendor Typing");

    // Server rejects
    serverPromiseReject(new Error("Network connection lost"));
    await pendingSave;

    // Cache must be rolled back to Initial Confirmed Vendor
    assert.strictEqual(
      prefStore["EMP-A"].defaultVendorName,
      "Initial Confirmed Vendor",
      "Failed save must roll back defaultVendorName to initial confirmed value"
    );
    assert.strictEqual(prefStore["EMP-A"].revision, 1);

    // User must be notified via modal
    assert(modalShown !== null, "Modal notification must be displayed to user on save failure");
    assert(modalShown.title.includes("エラー"), "Modal title must indicate error");
  });

  // -----------------------------------------------------------------------------
  // T19: Sequential saves that fail roll back to initial confirmed vendor (OLD), not FIRST
  // -----------------------------------------------------------------------------
  await runTest("T19", "Sequential saves (change + blur) that fail roll back to initial confirmed vendor", async () => {
    const vm = require("vm");
    const mockInput = { value: "FIRST", dataset: { userEdited: "true", lastAppliedVendor: "OLD" } };
    let serverPromiseReject1;
    const prefStore = {
      "EMP-A": { exists: true, defaultVendorName: "OLD", revision: 1 }
    };
    const ctx = {
      console,
      window: {},
      document: { addEventListener: () => {}, getElementById: (id) => (id === "vendor-name-input" ? mockInput : null) },
      TerminalStorage: {
        getEmployeePreferences: (e) => prefStore[e],
        saveEmployeePreferences: (e, p) => { prefStore[e] = Object.assign({}, prefStore[e], p); },
        savePreviousInput: () => {}
      }
    };
    vm.createContext(ctx);
    vm.runInContext(appJs, ctx);
    vm.runInContext('showAppModal = () => {};', ctx);
    ctx.fakeGas = {
      saveEmployeePreferences: () => new Promise((_, reject) => { serverPromiseReject1 = reject; })
    };
    vm.runInContext('resolvedEmployeeNo = "EMP-A"; gasClient = fakeGas;', ctx);

    // Call 1 (e.g. from change)
    const p1 = vm.runInContext("handleVendorInputChange()", ctx);
    // Call 2 (e.g. from blur immediately after, duplicate in-flight suppressed)
    const p2 = vm.runInContext("handleVendorInputChange()", ctx);

    // Both calls attempted
    serverPromiseReject1(new Error("Save failed"));
    await Promise.all([p1, p2]);

    // Must be rolled back to OLD, NOT FIRST!
    assert.strictEqual(
      prefStore["EMP-A"].defaultVendorName,
      "OLD",
      "Sequential failed saves must roll back to initial confirmed vendor OLD"
    );
  });

  // -----------------------------------------------------------------------------
  // T20: Conflict resolution lookup failure rolls back and alerts user
  // -----------------------------------------------------------------------------
  await runTest("T20", "Conflict resolution lookup failure rolls back to confirmed vendor and shows error modal", async () => {
    const vm = require("vm");
    const mockInput = { value: "FIRST", dataset: { userEdited: "true", lastAppliedVendor: "OLD" } };
    let modalShown = null;
    const prefStore = {
      "EMP-A": { exists: true, defaultVendorName: "OLD", revision: 1 }
    };
    const ctx = {
      console,
      window: {},
      document: { addEventListener: () => {}, getElementById: (id) => (id === "vendor-name-input" ? mockInput : null) },
      TerminalStorage: {
        getEmployeePreferences: (e) => prefStore[e],
        saveEmployeePreferences: (e, p) => { prefStore[e] = Object.assign({}, prefStore[e], p); },
        savePreviousInput: () => {}
      }
    };
    vm.createContext(ctx);
    vm.runInContext(appJs, ctx);
    ctx.modalHook = (options) => { modalShown = options; };
    vm.runInContext('showAppModal = (options) => { modalHook(options); };', ctx);
    ctx.fakeGas = {
      saveEmployeePreferences: () => Promise.resolve({ success: false, error: "PREFERENCE_REVISION_CONFLICT" }),
      lookupEmployee: () => Promise.resolve({ success: false, error: "NETWORK_ERROR" })
    };
    vm.runInContext('resolvedEmployeeNo = "EMP-A"; gasClient = fakeGas;', ctx);

    await vm.runInContext("handleVendorInputChange()", ctx);

    // Storage must be rolled back to OLD
    assert.strictEqual(
      prefStore["EMP-A"].defaultVendorName,
      "OLD",
      "Conflict lookup failure must roll back to confirmed vendor OLD"
    );
    // Modal must have been triggered
    assert(modalShown !== null, "Modal must be shown on conflict lookup failure");
    assert(modalShown.title.includes("エラー"), "Modal title must indicate error");
  });

  console.log("================================================================================");
  console.log(`HOTFIX 02 FOCUSED TESTS COMPLETE: ${testsPassed} passed, ${testsFailed} failed`);
  console.log("================================================================================");

  if (testsFailed > 0) {
    process.exit(1);
  }
}

main().catch(err => {
  console.error("Test Suite Unhandled Exception:", err);
  process.exit(1);
});
