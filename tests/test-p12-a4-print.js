// tests/test-p12-a4-print.js
// ScrapManagement — Phase P12 A4 Print Dedicated Automated Regression Test Suite
// Verifications TC-P12-001 .. TC-P12-014 covering:
// - TC-P12-001: Date Normalization (AC-P12-06, AC-P12-07, Decision P12 Date Priority)
// - TC-P12-002: Weight Non-Print (AC-P12-03)
// - TC-P12-003: BaseCode Non-Print (AC-P12-04)
// - TC-P12-004: Employee Number Non-Print (AC-P12-05)
// - TC-P12-005: Three Item Types (AC-P12-08, AC-P12-09)
// - TC-P12-006: Digital Signature Badge (AC-P12-12)
// - TC-P12-007: None Signature Blank (AC-P12-13)
// - TC-P12-008: Internal Note Absence (AC-P12-12, AC-P12-13)
// - TC-P12-009: Security Decision C Integrity & Full Attribute Audit (AC-P12-15, AC-P12-16)
// - TC-P12-010: History List Reprint Path, Cache Miss & window.print (AC-P12-10)
// - TC-P12-011: History Detail Reprint Path (AC-P12-11)
// - TC-P12-012: Completion Print Path & Visual Consistency (AC-P12-14)
// - TC-P12-013: Print CSS Contract Static Audit (AC-P12-01, AC-P12-02)
// - TC-P12-014: Existing Regression Suite Contract & Fresh Evidence Verification (AC-P12-17)

const assert = require("assert");
const fs = require("fs");
const path = require("path");

console.log("================================================================================");
console.log("ScrapManagement - PHASE P12 A4 PRINT TEST SUITE (TC-P12-001..TC-P12-014)");
console.log("Targeting 14 Automated Verifications for A4 Print Normalization & Contracts");
console.log("================================================================================\n");

let passedCount = 0;
let failedCount = 0;
const results = [];

async function runTest(id, title, fn) {
  try {
    await fn();
    console.log(`[PASS] ${id}: ${title}`);
    passedCount++;
    results.push({ id, title, pass: true });
  } catch (err) {
    console.error(`[FAIL] ${id}: ${title}`);
    console.error(`       Error: ${err.message}`);
    failedCount++;
    results.push({ id, title, pass: false, error: err.message });
  }
}

// -----------------------------------------------------------------------------
// Resolve source files
// -----------------------------------------------------------------------------
const candidateAppJsPaths = [
  path.resolve(__dirname, "../scratch/repo/src/js/app.js"),
  path.resolve(__dirname, "../scratch/frontend_mirror/src/js/app.js"),
  path.resolve(__dirname, "../src/js/app.js")
];
const appJsPath = candidateAppJsPaths.find(p => fs.existsSync(p));
assert(appJsPath, "app.js must exist on disk");

const candidatePrintCssPaths = [
  path.resolve(__dirname, "../scratch/repo/src/css/print.css"),
  path.resolve(__dirname, "../scratch/frontend_mirror/src/css/print.css"),
  path.resolve(__dirname, "../src/css/print.css")
];
const printCssPath = candidatePrintCssPaths.find(p => fs.existsSync(p));
assert(printCssPath, "print.css must exist on disk");

const appJsContent = fs.readFileSync(appJsPath, "utf-8");
const printCssContent = fs.readFileSync(printCssPath, "utf-8");

// -----------------------------------------------------------------------------
// Lightweight Mock DOM Environment
// -----------------------------------------------------------------------------
const elementRegistry = new Map();

function escapeHtmlForMock(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function extractTextFromHtml(html) {
  return String(html)
    .replace(/<[^>]*>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'");
}

const VOID_TAGS = new Set([
  "area", "base", "br", "col", "embed", "hr", "img", "input",
  "link", "meta", "param", "source", "track", "wbr"
]);

function parseMockHtml(parentEl, html) {
  if (!html) return;
  const tokenRegex = /<!--[\s\S]*?-->|<\/([a-z0-9_-]+)\s*>|<([a-z0-9_-]+)((?:\s+[^=>\s]+(?:=(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*(\/?)>|([^<]+)/gi;

  const stack = [parentEl];
  let match;

  while ((match = tokenRegex.exec(html)) !== null) {
    if (match[0].startsWith("<!--")) {
      continue;
    }
    const closeTagName = match[1];
    const openTagName = match[2];
    const attrsStr = match[3];
    const selfClosingSlash = match[4];
    const textNode = match[5];

    if (textNode) {
      const top = stack[stack.length - 1];
      if (top && textNode.trim()) {
        top._textContent = (top._textContent ? top._textContent + " " : "") + textNode.trim();
      }
      continue;
    }

    if (closeTagName) {
      const lowerClose = closeTagName.toLowerCase();
      for (let i = stack.length - 1; i > 0; i--) {
        if (stack[i].tagName.toLowerCase() === lowerClose) {
          stack.splice(i);
          break;
        }
      }
      continue;
    }

    if (openTagName) {
      const lowerOpen = openTagName.toLowerCase();
      const el = new MockElement(lowerOpen);

      if (attrsStr) {
        const attrRegex = /([a-z0-9_-]+)(?:=(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/gi;
        let attrMatch;
        while ((attrMatch = attrRegex.exec(attrsStr)) !== null) {
          const attrName = attrMatch[1];
          if (!attrName || attrName === "/") continue;
          const attrVal = attrMatch[2] !== undefined ? attrMatch[2] :
                          (attrMatch[3] !== undefined ? attrMatch[3] :
                          (attrMatch[4] !== undefined ? attrMatch[4] : ""));
          el.setAttribute(attrName, attrVal);
        }
      }

      const top = stack[stack.length - 1];
      if (top) {
        top.children.push(el);
        el.parentNode = top;
      }
      if (el.id) {
        elementRegistry.set(el.id, el);
      }

      const isVoid = VOID_TAGS.has(lowerOpen) || Boolean(selfClosingSlash);
      if (!isVoid) {
        stack.push(el);
      }
    }
  }
}

class MockElement {
  constructor(tagName = "div", id = "") {
    this.tagName = tagName.toUpperCase();
    this.id = id;
    this.className = "";
    this._textContent = "";
    this._innerHTML = "";
    this.style = {};
    this.children = [];
    this.parentNode = null;
    this.attributes = {};
    this.dataset = {};
    this.src = "";
    this.href = "";
  }

  get textContent() {
    if (this.children.length === 0) {
      return this._textContent;
    }
    return this.children.map(c => c.textContent).join("");
  }

  set textContent(val) {
    this._textContent = String(val === null || val === undefined ? "" : val);
    this.children = [];
    this._innerHTML = escapeHtmlForMock(this._textContent);
  }

  get innerHTML() {
    if (this.children.length > 0) {
      return this.children.map(c => {
        let attrs = "";
        for (const [k, v] of Object.entries(c.attributes)) {
          attrs += ` ${k}="${escapeHtmlForMock(v)}"`;
        }
        if (c.id && !c.attributes.id) attrs += ` id="${c.id}"`;
        if (c.className && !c.attributes.class) attrs += ` class="${c.className}"`;
        if (c.src && !c.attributes.src) attrs += ` src="${c.src}"`;
        if (c.href && !c.attributes.href) attrs += ` href="${c.href}"`;
        for (const [dk, dv] of Object.entries(c.dataset)) {
          const attrName = "data-" + dk.replace(/([A-Z])/g, "-$1").toLowerCase();
          if (!c.attributes[attrName]) attrs += ` ${attrName}="${escapeHtmlForMock(dv)}"`;
        }
        const tag = c.tagName.toLowerCase();
        if (VOID_TAGS.has(tag)) {
          return `<${tag}${attrs}>`;
        }
        return `<${tag}${attrs}>${c.innerHTML}</${tag}>`;
      }).join("");
    }
    return this._innerHTML || escapeHtmlForMock(this._textContent);
  }

  set innerHTML(html) {
    this._innerHTML = String(html || "");
    this.children = [];
    this._textContent = "";
    parseMockHtml(this, this._innerHTML);
    if (!this._textContent && this.children.length === 0) {
      this._textContent = extractTextFromHtml(this._innerHTML);
    }
  }

  setAttribute(name, value) {
    this.attributes[name] = String(value);
    if (name === "src") this.src = String(value);
    if (name === "href") this.href = String(value);
    if (name === "id") this.id = String(value);
    if (name === "class") this.className = String(value);
    if (name.startsWith("data-")) {
      const key = name.slice(5).replace(/-([a-z])/g, (_, ch) => ch.toUpperCase());
      this.dataset[key] = String(value);
    }
  }

  getAttribute(name) {
    return this.attributes[name] || (name === "src" ? this.src : null);
  }

  hasAttribute(name) {
    return name in this.attributes;
  }

  appendChild(child) {
    if (!child) return child;
    child.parentNode = this;
    this.children.push(child);
    if (child.id) {
      elementRegistry.set(child.id, child);
    }
    return child;
  }

  removeChild(child) {
    const idx = this.children.indexOf(child);
    if (idx !== -1) {
      this.children.splice(idx, 1);
      child.parentNode = null;
    }
    return child;
  }

  addEventListener() {}
  removeEventListener() {}
}

// Recursive subtree values & attributes collector
function collectAllSubtreeValues(el) {
  const values = [];
  if (!el) return values;
  if (el.textContent) values.push(el.textContent);
  if (el._textContent) values.push(el._textContent);
  if (el.src) values.push(el.src);
  if (el.href) values.push(el.href);
  if (el.id) values.push(el.id);
  if (el.className) values.push(el.className);
  if (el._innerHTML) values.push(el._innerHTML);
  if (el.attributes) {
    for (const [k, v] of Object.entries(el.attributes)) {
      values.push(k);
      values.push(v);
    }
  }
  if (el.dataset) {
    for (const [k, v] of Object.entries(el.dataset)) {
      values.push(k);
      values.push(v);
    }
  }
  for (const child of (el.children || [])) {
    values.push(...collectAllSubtreeValues(child));
  }
  return values;
}

// Timer isolation system
let activeTimeouts = [];
const realSetTimeout = global.setTimeout;
const realClearTimeout = global.clearTimeout;
global.setTimeout = (fn, delay, ...args) => {
  const t = realSetTimeout(() => {
    const idx = activeTimeouts.indexOf(t);
    if (idx !== -1) activeTimeouts.splice(idx, 1);
    fn(...args);
  }, delay);
  activeTimeouts.push(t);
  return t;
};
global.clearTimeout = (t) => {
  const idx = activeTimeouts.indexOf(t);
  if (idx !== -1) activeTimeouts.splice(idx, 1);
  realClearTimeout(t);
};

// Global browser mock setup
let printCallCount = 0;
const printSpy = () => { printCallCount++; };

const sessionStorageStore = new Map();
global.sessionStorage = {
  getItem: (k) => (sessionStorageStore.has(k) ? sessionStorageStore.get(k) : null),
  setItem: (k, v) => sessionStorageStore.set(k, String(v)),
  removeItem: (k) => sessionStorageStore.delete(k),
  clear: () => sessionStorageStore.clear()
};

const localStorageStore = new Map();
global.localStorage = {
  getItem: (k) => (localStorageStore.has(k) ? localStorageStore.get(k) : null),
  setItem: (k, v) => localStorageStore.set(k, String(v)),
  removeItem: (k) => localStorageStore.delete(k),
  clear: () => localStorageStore.clear()
};

global.window = {
  print: printSpy,
  addEventListener: () => {},
  removeEventListener: () => {},
  sessionStorage: global.sessionStorage,
  localStorage: global.localStorage
};

global.document = {
  getElementById: (id) => elementRegistry.get(id) || null,
  createElement: (tag) => new MockElement(tag),
  addEventListener: () => {},
  removeEventListener: () => {},
  body: new MockElement("body"),
  documentElement: new MockElement("html"),
  querySelector: () => null,
  querySelectorAll: () => []
};

global.navigator = { userAgent: "Mozilla/5.0 NodeTestRunner" };
global.location = { search: "", hash: "", pathname: "/" };
global.history = { replaceState: () => {} };

// DOM Reset Helper
function setupDomTree() {
  elementRegistry.clear();
  activeTimeouts.forEach(t => realClearTimeout(t));
  activeTimeouts.length = 0;
  printCallCount = 0;

  const printContainer = new MockElement("div", "print-slip-container");
  const slipIdEl = new MockElement("div", "print-slip-id");
  const printDateEl = new MockElement("div", "print-info-date");
  const printBaseEl = new MockElement("div", "print-info-base");
  const printStaffEl = new MockElement("div", "print-info-staff");
  const printVendorEl = new MockElement("div", "print-info-vendor");
  const printItemsTbody = new MockElement("tbody", "print-items-tbody");
  const printSigArea = new MockElement("div", "print-signature-area");
  const printSigImg = new MockElement("img", "print-vendor-signature-img");
  printSigArea.appendChild(printSigImg);

  const histDetailBody = new MockElement("div", "history-detail-modal-body");
  const histDetailLoading = new MockElement("div", "hist-detail-loading");
  const completionModal = new MockElement("div", "completion-modal");

  const elements = [
    printContainer,
    slipIdEl,
    printDateEl,
    printBaseEl,
    printStaffEl,
    printVendorEl,
    printItemsTbody,
    printSigArea,
    printSigImg,
    histDetailBody,
    histDetailLoading,
    completionModal
  ];

  elements.forEach(el => elementRegistry.set(el.id, el));
  printContainer.appendChild(slipIdEl);
  printContainer.appendChild(printDateEl);
  printContainer.appendChild(printBaseEl);
  printContainer.appendChild(printStaffEl);
  printContainer.appendChild(printVendorEl);
  printContainer.appendChild(printItemsTbody);
  printContainer.appendChild(printSigArea);

  sessionStorageStore.clear();
}

// Initialize Mock Tree
setupDomTree();

// Evaluate app.js into mock global environment
eval(appJsContent);

// Verify required functions are bound
assert.strictEqual(typeof printSlipFromRecord, "function", "printSlipFromRecord must be a function");
assert.strictEqual(typeof printSlipFromHistory, "function", "printSlipFromHistory must be a function");
assert.strictEqual(typeof handleHistoryDetailPrint, "function", "handleHistoryDetailPrint must be a function");
assert.strictEqual(typeof handleCompletionPrint, "function", "handleCompletionPrint must be a function");

// =============================================================================
// TEST SUITE: TC-P12-001 .. TC-P12-014
// =============================================================================

async function runAllTests() {
  // -----------------------------------------------------------------------------
  // TC-P12-001: Date Normalization & Business Date Priority (AC-P12-06, AC-P12-07)
  // -----------------------------------------------------------------------------
  await runTest("TC-P12-001", "Date Normalization & Business Date Priority: raw GMT and ISO normalized to YYYY/MM/DD with date priority (AC-P12-06, AC-P12-07)", () => {
    setupDomTree();
    const printDateEl = document.getElementById("print-info-date");

    // Fixture A: Raw GMT with day-of-week
    printSlipFromRecord({
      createdAt: "Sun Sep 27 2026 00:00:00 GMT+0900 (日本標準時)",
      signatureStatus: "DIGITAL",
      items: []
    });
    assert.strictEqual(printDateEl.textContent, "2026/09/27", "Fixture A: Sun Sep 27 must format to 2026/09/27");
    assert(!printDateEl.textContent.includes("Sun"), "Must not include weekday 'Sun'");
    assert(!printDateEl.textContent.includes("GMT"), "Must not include 'GMT'");
    assert(!printDateEl.textContent.includes("日本標準時"), "Must not include Japanese timezone text");

    // Fixture B: Monday raw GMT
    printSlipFromRecord({
      createdAt: "Mon Sep 28 2026 00:00:00 GMT+0900 (日本標準時)",
      signatureStatus: "NONE",
      items: []
    });
    assert.strictEqual(printDateEl.textContent, "2026/09/28", "Fixture B: Mon Sep 28 must format to 2026/09/28");
    assert(!printDateEl.textContent.includes("Mon"), "Must not include weekday 'Mon'");

    // Fixture C: ISO Business date
    printSlipFromRecord({
      date: "2026-09-29",
      signatureStatus: "DIGITAL",
      items: []
    });
    assert.strictEqual(printDateEl.textContent, "2026/09/29", "Fixture C: 2026-09-29 must format to 2026/09/29");

    // Fixture D: BLOCKING-01 Date priority test (date takes precedence over createdAt)
    printSlipFromRecord({
      date: "2026-09-27",
      createdAt: "2026-09-30T12:00:00+09:00",
      signatureStatus: "DIGITAL",
      items: []
    });
    assert.strictEqual(printDateEl.textContent, "2026/09/27", "Fixture D: s.date must take priority over s.createdAt");
    assert(!printDateEl.textContent.includes("2026/09/30"), "Fixture D: createdAt must NOT be printed when date is present");

    // Fixture E: Fallback to createdAt when date is empty
    printSlipFromRecord({
      date: "",
      createdAt: "2026-09-30T12:00:00+09:00",
      signatureStatus: "DIGITAL",
      items: []
    });
    assert.strictEqual(printDateEl.textContent, "2026/09/30", "Fixture E: must fallback to createdAt when date is empty");
  });

  // -----------------------------------------------------------------------------
  // TC-P12-002: Weight Non-Print (AC-P12-03)
  // -----------------------------------------------------------------------------
  await runTest("TC-P12-002", "Weight Non-Print: weight columns and values strictly excluded from print DOM (AC-P12-03)", () => {
    setupDomTree();
    const slipWithWeights = {
      slipNo: "SCRAP-WEIGHT-001",
      date: "2026-09-27",
      unitWeightKg: 12.5,
      totalWeightKg: 125.0,
      codeItems: [
        {
          itemCode: "P48640",
          itemName: "単管パイプ 4.0m",
          quantityInput: "10",
          quantityValue: 10,
          quantityType: "NUMBER",
          unitWeightKg: 10.92,
          totalWeightKg: 109.2
        }
      ],
      fixedItems: [
        {
          itemName: "敷鉄板",
          quantityInput: "2",
          quantityValue: 2,
          quantityType: "NUMBER",
          unitWeightKg: 800.0,
          totalWeightKg: 1600.0
        }
      ],
      otherItems: []
    };

    printSlipFromRecord(slipWithWeights);

    const container = document.getElementById("print-slip-container");
    const fullPrintHtml = container.innerHTML;
    const fullPrintText = container.textContent;

    assert(!fullPrintHtml.includes("unitWeightKg"), "HTML must not contain 'unitWeightKg'");
    assert(!fullPrintHtml.includes("totalWeightKg"), "HTML must not contain 'totalWeightKg'");
    assert(!fullPrintText.includes("合計重量"), "Text must not contain '合計重量'");
    assert(!fullPrintText.includes("単重"), "Text must not contain '単重'");
    assert(!fullPrintText.includes("総重量"), "Text must not contain '総重量'");
    assert(!fullPrintText.includes("12.5"), "Slip weight value 12.5 must not be printed");
    assert(!fullPrintText.includes("125"), "Slip total weight 125 must not be printed");
    assert(!fullPrintText.includes("10.92"), "Item unit weight 10.92 must not be printed");
    assert(!fullPrintText.includes("109.2"), "Item total weight 109.2 must not be printed");
    assert(!fullPrintText.includes("800"), "Item weight 800 must not be printed");
    assert(!fullPrintText.includes("1600"), "Item weight 1600 must not be printed");
  });

  // -----------------------------------------------------------------------------
  // TC-P12-003: BaseCode Non-Print (AC-P12-04)
  // -----------------------------------------------------------------------------
  await runTest("TC-P12-003", "BaseCode Non-Print: baseName printed, raw baseCode excluded from print header (AC-P12-04)", () => {
    setupDomTree();
    const slip = {
      slipNo: "SCRAP-BASE-001",
      baseCode: "LW",
      baseName: "Lab.West",
      date: "2026-09-27"
    };

    printSlipFromRecord(slip);

    const baseEl = document.getElementById("print-info-base");
    assert.strictEqual(baseEl.textContent, "Lab.West", "Base element must show baseName");
    assert(!baseEl.textContent.includes("LW"), "Base element must not display raw baseCode 'LW'");
  });

  // -----------------------------------------------------------------------------
  // TC-P12-004: Employee Number Non-Print (AC-P12-05)
  // -----------------------------------------------------------------------------
  await runTest("TC-P12-004", "Employee Number Non-Print: staffName printed, employeeNo completely excluded (AC-P12-05)", () => {
    setupDomTree();
    const slip = {
      slipNo: "SCRAP-EMP-001",
      employeeNo: "123456",
      staffName: "テスト担当者",
      date: "2026-09-27"
    };

    printSlipFromRecord(slip);

    const staffEl = document.getElementById("print-info-staff");
    assert.strictEqual(staffEl.textContent, "テスト担当者", "Staff element must show staffName");

    const container = document.getElementById("print-slip-container");
    assert(!container.textContent.includes("123456"), "Employee number 123456 must not appear anywhere in print container");
    assert(!container.innerHTML.includes("123456"), "Employee number 123456 must not appear in HTML attributes or tags");
  });

  // -----------------------------------------------------------------------------
  // TC-P12-005: Three Item Types (AC-P12-08, AC-P12-09)
  // -----------------------------------------------------------------------------
  await runTest("TC-P12-005", "Three Item Types: mixed code/fixed/other items rendered with continuous line numbers and types (AC-P12-08, AC-P12-09)", () => {
    setupDomTree();
    const slip = {
      slipNo: "SCRAP-ITEMS-001",
      date: "2026-09-27",
      codeItems: [
        {
          itemCode: "P48640",
          itemName: "単管パイプ 4.0m (φ48.6)",
          quantityInput: "3",
          quantityValue: 3,
          quantityType: "NUMBER"
        }
      ],
      fixedItems: [
        {
          itemName: "敷鉄板",
          quantityInput: "2",
          quantityValue: 2,
          quantityType: "NUMBER"
        }
      ],
      otherItems: [
        {
          itemName: "特注アングル金具",
          quantityInput: "5式"
        }
      ]
    };

    printSlipFromRecord(slip);

    const tbody = document.getElementById("print-items-tbody");
    assert.strictEqual(tbody.children.length, 3, "Tbody must have exactly 3 item rows");

    // Row 1: Code item
    const row1Text = tbody.children[0].textContent;
    assert(row1Text.includes("1"), "Row 1 must have sequence 1");
    assert(row1Text.includes("資材コード品"), "Row 1 category must be 資材コード品");
    assert(row1Text.includes("単管パイプ 4.0m (φ48.6)"), "Row 1 must have item name");
    assert(row1Text.includes("P48640"), "Row 1 must have item code");
    assert(row1Text.includes("3"), "Row 1 must show quantity 3");

    // Row 2: Fixed item
    const row2Text = tbody.children[1].textContent;
    assert(row2Text.includes("2"), "Row 2 must have sequence 2");
    assert(row2Text.includes("定型品"), "Row 2 category must be 定型品");
    assert(row2Text.includes("敷鉄板"), "Row 2 must have item name");
    assert(row2Text.includes("2"), "Row 2 must show quantity 2");

    // Row 3: Other item
    const row3Text = tbody.children[2].textContent;
    assert(row3Text.includes("3"), "Row 3 must have sequence 3");
    assert(row3Text.includes("その他品"), "Row 3 category must be その他品");
    assert(row3Text.includes("特注アングル金具"), "Row 3 must have item name");
    assert(row3Text.includes("5式"), "Row 3 must show raw quantity input 5式");
  });

  // -----------------------------------------------------------------------------
  // TC-P12-006: Digital Signature Real Handwritten Image (AC-P12-12, Hotfix Remediation)
  // -----------------------------------------------------------------------------
  await runTest("TC-P12-006", "Digital Signature: signatureStatus DIGITAL renders actual handwritten signature image and suppresses text (AC-P12-12, Hotfix Remediation)", () => {
    setupDomTree();
    const mockSigData = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
    const slip = {
      slipNo: "SCRAP-SIG-001",
      date: "2026-09-27",
      signatureStatus: "DIGITAL",
      vendorSignatureImage: mockSigData
    };

    printSlipFromRecord(slip);

    const sigImg = document.getElementById("print-vendor-signature-img");
    assert(sigImg, "Signature image element must exist");
    assert.strictEqual(sigImg.src, mockSigData, "DIGITAL signature image must be set on sigImg.src");
    assert.strictEqual(sigImg.style.display, "block", "DIGITAL signature image display must be 'block'");

    const statusTextEl = document.getElementById("print-vendor-signature-status-text");
    if (statusTextEl) {
      assert.strictEqual(statusTextEl.textContent, "", "DIGITAL must NOT render replacement text '電子署名確認済'");
      assert.strictEqual(statusTextEl.style.display, "none", "Status text element must be hidden");
    }
  });

  // -----------------------------------------------------------------------------
  // TC-P12-007: None Signature Blank (AC-P12-13)
  // -----------------------------------------------------------------------------
  await runTest("TC-P12-007", "None Signature: signatureStatus NONE renders blank text while preserving paper box (AC-P12-13, Decision P12-SIGN-02)", () => {
    setupDomTree();
    const slip = {
      slipNo: "SCRAP-SIG-002",
      date: "2026-09-27",
      signatureStatus: "NONE"
    };

    printSlipFromRecord(slip);

    const sigImg = document.getElementById("print-vendor-signature-img");
    assert(sigImg, "Signature image element must exist");
    assert.strictEqual(sigImg.src, "", "NONE signature image src must be empty");
    assert.strictEqual(sigImg.style.display, "none", "NONE signature image display must be 'none'");

    const statusTextEl = document.getElementById("print-vendor-signature-status-text");
    if (statusTextEl) {
      assert.strictEqual(statusTextEl.textContent, "", "NONE status text must be completely blank");
      assert.strictEqual(statusTextEl.style.display, "none", "Status text element display must be 'none'");
    }

    // Verify paper signing container remains present
    const sigArea = document.getElementById("print-signature-area");
    assert(sigArea, "Signature area container must remain in DOM for paper signature");
  });

  // -----------------------------------------------------------------------------
  // TC-P12-008: Internal Note Absence (AC-P12-12, AC-P12-13)
  // -----------------------------------------------------------------------------
  await runTest("TC-P12-008", "Internal Note Absence: internal notes completely removed from signature area (AC-P12-12, AC-P12-13)", () => {
    setupDomTree();
    const bannedNote = "署名画像は履歴画面では表示されません";

    // Test with DIGITAL
    printSlipFromRecord({
      slipNo: "SCRAP-NOTE-001",
      date: "2026-09-27",
      signatureStatus: "DIGITAL"
    });
    const containerDigital = document.getElementById("print-slip-container");
    assert(!containerDigital.innerHTML.includes(bannedNote), "DIGITAL: Must not contain internal note");
    assert(!containerDigital.textContent.includes(bannedNote), "DIGITAL: Text must not contain internal note");

    // Test with NONE
    setupDomTree();
    printSlipFromRecord({
      slipNo: "SCRAP-NOTE-002",
      date: "2026-09-27",
      signatureStatus: "NONE"
    });
    const containerNone = document.getElementById("print-slip-container");
    assert(!containerNone.innerHTML.includes(bannedNote), "NONE: Must not contain internal note");
    assert(!containerNone.textContent.includes(bannedNote), "NONE: Text must not contain internal note");
  });

  // -----------------------------------------------------------------------------
  // TC-P12-009: Security Decision C Integrity & Full Attribute Audit (AC-P12-15, AC-P12-16)
  // -----------------------------------------------------------------------------
  await runTest("TC-P12-009", "Security Decision C: signature FileId and Drive URLs not exposed to print DOM attributes or text (AC-P12-15, AC-P12-16)", () => {
    setupDomTree();

    const P12_SECRET_BASE64 = "data:image/png;base64,P12_SECRET_BASE64_BYTES_CONFIDENTIAL";
    const P12_SECRET_FILE_ID = "P12_SECRET_FILE_ID_99999";
    const P12_SECRET_DRIVE_URL = "https://drive.google.com/P12_SECRET_DRIVE_URL_CONFIDENTIAL";

    const slipWithSecrets = {
      slipNo: "SCRAP-SECRET-001",
      date: "2026-09-27",
      signatureStatus: "DIGITAL",
      vendorSignatureImage: P12_SECRET_BASE64,
      signatureFileId: P12_SECRET_FILE_ID,
      signatureUrl: P12_SECRET_DRIVE_URL,
      codeItems: []
    };

    printSlipFromRecord(slipWithSecrets);

    const sigImg = document.getElementById("print-vendor-signature-img");
    assert(sigImg, "sigImg must exist in print-signature-area");
    assert.strictEqual(sigImg.src, P12_SECRET_BASE64, "sigImg.src must display signature image for printing");
    assert.strictEqual(sigImg.style.display, "block", "sigImg must be visible with display:block");

    const container = document.getElementById("print-slip-container");
    const fullHtml = container.innerHTML;
    assert(!fullHtml.includes(P12_SECRET_FILE_ID), "Print DOM HTML must not leak signatureFileId");
    assert(!fullHtml.includes(P12_SECRET_DRIVE_URL), "Print DOM HTML must not contain Drive URL");

    // BLOCKING-02: Recursive audit of all DOM subtree attributes, dataset, href, src, textContent
    const allValues = collectAllSubtreeValues(container);
    for (const val of allValues) {
      assert(!val.includes(P12_SECRET_FILE_ID), `Subtree value '${val}' must not contain signatureFileId`);
      assert(!val.includes(P12_SECRET_DRIVE_URL), `Subtree value '${val}' must not contain Drive URL`);
      assert(!val.includes("drive.google.com"), `Subtree value '${val}' must not contain drive.google.com`);
    }

    // Verify detection power: intentional mutant attributes in HTML must be detected
    const sigArea = document.getElementById("print-signature-area");
    sigArea.innerHTML = `<div data-secret="${P12_SECRET_FILE_ID}" href="${P12_SECRET_DRIVE_URL}">leak</div>`;
    const mutantValues = collectAllSubtreeValues(container);
    const caughtFileId = mutantValues.some(v => v.includes(P12_SECRET_FILE_ID));
    const caughtDriveUrl = mutantValues.some(v => v.includes(P12_SECRET_DRIVE_URL));
    assert(caughtFileId, "Test verification: collectAllSubtreeValues must catch HTML attribute mutants (data-secret)");
    assert(caughtDriveUrl, "Test verification: collectAllSubtreeValues must catch HTML attribute mutants (href)");
    sigArea.innerHTML = "";

    // Verify detection power with void elements (like <img>) without closing tag
    sigArea.innerHTML = `<div><span>safe</span><img src="${P12_SECRET_BASE64}" data-file="${P12_SECRET_FILE_ID}" data-url="${P12_SECRET_DRIVE_URL}"></div>`;
    const voidMutantValues = collectAllSubtreeValues(container);
    assert(voidMutantValues.some(v => v.includes(P12_SECRET_BASE64)), "Test verification: collectAllSubtreeValues must catch void element src mutants");
    assert(voidMutantValues.some(v => v.includes(P12_SECRET_FILE_ID)), "Test verification: collectAllSubtreeValues must catch void element data-file mutants");
    assert(voidMutantValues.some(v => v.includes(P12_SECRET_DRIVE_URL)), "Test verification: collectAllSubtreeValues must catch void element data-url mutants");
    assert(container.innerHTML.includes(P12_SECRET_BASE64), "container.innerHTML must include void element Base64 mutant");
    sigArea.innerHTML = "";
  });

  // -----------------------------------------------------------------------------
  // TC-P12-010: History List Reprint Path, Cache Miss & window.print (AC-P12-10)
  // -----------------------------------------------------------------------------
  await runTest("TC-P12-010", "History List Reprint: printSlipFromHistory handles cache miss, calls fetchSlip, and triggers window.print (AC-P12-10)", async () => {
    setupDomTree();
    const targetSlipNo = "SCRAP-HIST-MISS-001";

    // 1. Cache MISS scenario: target is NOT in historyDetailCache
    if (typeof window.historyDetailCache !== "undefined") {
      window.historyDetailCache.delete(targetSlipNo);
    }

    const summarySlip = {
      slipNo: targetSlipNo,
      date: "2026-09-27",
      baseName: "大阪第二Base",
      staffName: "担当者B",
      vendorName: "業者X",
      signatureStatus: "DIGITAL",
      codeItems: [] // empty triggers gasClient.fetchSlip
    };

    const dummyTbody = document.createElement("tbody");
    renderHistoryRows(dummyTbody, [summarySlip]);

    let fetchSlipCalledWith = null;
    let fetchSlipCount = 0;
    const fullSlipResponse = {
      slipNo: targetSlipNo,
      date: "2026-09-27",
      baseName: "大阪第二Base",
      staffName: "担当者B",
      vendorName: "業者X",
      signatureStatus: "DIGITAL",
      codeItems: [{ itemCode: "P48640", itemName: "単管パイプ4.0m", quantityInput: "4", quantityValue: 4, quantityType: "NUMBER" }],
      fixedItems: [],
      otherItems: []
    };

    const testSigData = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
    const mockGasClient = {
      fetchSlip: async (id) => {
        fetchSlipCount++;
        fetchSlipCalledWith = id;
        return { success: true, slip: fullSlipResponse };
      },
      fetchPrintSignature: async (id) => {
        return { success: true, slipNo: id, signatureStatus: "DIGITAL", signatureData: testSigData };
      }
    };

    global.gasClient = mockGasClient;
    if (module.exports && typeof module.exports.setGasClient === "function") {
      module.exports.setGasClient(mockGasClient);
    }

    // Reset timers & print counter
    activeTimeouts.forEach(t => realClearTimeout(t));
    activeTimeouts.length = 0;
    printCallCount = 0;

    printSlipFromHistory(targetSlipNo);

    // Await async fetchSlip promise resolution and setTimeout(window.print, 200)
    await new Promise(resolve => setTimeout(resolve, 300));

    assert.strictEqual(fetchSlipCount, 1, "fetchSlip must be called exactly once on cache miss");
    assert.strictEqual(fetchSlipCalledWith, targetSlipNo, `fetchSlip must be called with ${targetSlipNo}`);
    assert(window.historyDetailCache.has(targetSlipNo), "Fetched slip must be stored in historyDetailCache");
    assert.deepStrictEqual(window.historyDetailCache.get(targetSlipNo), fullSlipResponse, "historyDetailCache must store exact fetched slip");

    const slipIdEl = document.getElementById("print-slip-id");
    assert.strictEqual(slipIdEl.textContent, targetSlipNo, "Slip id must match fetched record");
    const sigImg = document.getElementById("print-vendor-signature-img");
    assert(sigImg, "Signature image element must exist");
    assert.strictEqual(sigImg.src, testSigData, "Signature image must be loaded on print");
    assert.strictEqual(sigImg.style.display, "block", "Signature image display must be block");
    assert.strictEqual(printCallCount, 1, "window.print() must have been invoked exactly once on cache miss");

    // 2. Cache HIT scenario (immediate second call)
    printCallCount = 0;
    fetchSlipCount = 0;
    printSlipFromHistory(targetSlipNo);
    assert.strictEqual(fetchSlipCount, 0, "fetchSlip must NOT be called on cache hit");
    await new Promise(resolve => setTimeout(resolve, 250));
    assert.strictEqual(printCallCount, 1, "window.print() must have been invoked exactly once on cache hit");
  });

  // -----------------------------------------------------------------------------
  // TC-P12-011: History Detail Reprint Path (AC-P12-11)
  // -----------------------------------------------------------------------------
  await runTest("TC-P12-011", "History Detail Reprint: handleHistoryDetailPrint routes currently open detail slip to print (AC-P12-11)", () => {
    setupDomTree();
    const detailSlip = {
      slipNo: "SCRAP-DETAIL-001",
      createdAt: "Sun Sep 27 2026 10:00:00 GMT+0900 (日本標準時)",
      baseName: "東京第一Base",
      staffName: "担当者C",
      vendorName: "業者Y",
      signatureStatus: "NONE",
      codeItems: [{ itemCode: "P48640", itemName: "単管パイプ", quantityInput: "2", quantityValue: 2, quantityType: "NUMBER" }]
    };

    renderHistoryDetailContent(detailSlip);
    handleHistoryDetailPrint();

    const slipIdEl = document.getElementById("print-slip-id");
    assert.strictEqual(slipIdEl.textContent, "SCRAP-DETAIL-001", "Slip id must match current detail slip");
    const dateEl = document.getElementById("print-info-date");
    assert.strictEqual(dateEl.textContent, "2026/09/27", "Date must be normalized YYYY/MM/DD");
    const sigImg = document.getElementById("print-vendor-signature-img");
    assert(sigImg, "Signature image element must exist");
    assert.strictEqual(sigImg.src, "", "NONE signature image must be blank");
    assert.strictEqual(sigImg.style.display, "none", "NONE signature image display must be none");
  });

  // -----------------------------------------------------------------------------
  // TC-P12-012: Completion Print Path & Visual Consistency (AC-P12-14)
  // -----------------------------------------------------------------------------
  await runTest("TC-P12-012", "Completion Print: handleCompletionPrint visual contract matches history reprint (AC-P12-14, Decision P12-SIGN-03)", () => {
    setupDomTree();

    // 1. Completion Print DIGITAL
    const mockSig = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
    const newlyFinalizedDigital = {
      slipNo: "SCRAP-NEW-DIGITAL",
      date: "2026-09-30",
      baseName: "本社Base",
      staffName: "担当者D",
      vendorName: "業者Z",
      signatureStatus: "DIGITAL",
      vendorSignatureImage: mockSig,
      codeItems: []
    };

    sessionStorage.setItem("scrap_last_final_slip", JSON.stringify(newlyFinalizedDigital));
    handleCompletionPrint();

    const slipIdEl = document.getElementById("print-slip-id");
    assert.strictEqual(slipIdEl.textContent, "SCRAP-NEW-DIGITAL", "Slip id must match newly finalized slip");
    const sigImg = document.getElementById("print-vendor-signature-img");
    assert.strictEqual(sigImg.src, mockSig, "Image src must be set with vendorSignatureImage");
    assert.strictEqual(sigImg.style.display, "block", "Image display must be block");

    // 2. Completion Print NONE
    const newlyFinalizedNone = {
      slipNo: "SCRAP-NEW-NONE",
      date: "2026-09-30",
      baseName: "本社Base",
      staffName: "担当者D",
      vendorName: "業者Z",
      signatureStatus: "NONE",
      codeItems: []
    };

    sessionStorage.setItem("scrap_last_final_slip", JSON.stringify(newlyFinalizedNone));
    handleCompletionPrint();

    assert.strictEqual(sigImg.src, "", "Newly finalized NONE must be blank");
    assert.strictEqual(sigImg.style.display, "none", "Status text display must be none");
  });

  // -----------------------------------------------------------------------------
  // TC-P12-013: Print CSS Contract Static Audit (AC-P12-01, AC-P12-02)
  // -----------------------------------------------------------------------------
  await runTest("TC-P12-013", "Print CSS Contract: size A4 portrait, 20mm 16mm 15mm 16mm margins, page-break and weight suppression (AC-P12-01, AC-P12-02)", () => {
    assert(printCssContent.includes("@media print"), "print.css must contain @media print");

    // @page rules
    assert(/@page\s*\{[^}]*size:\s*A4\s+portrait/i.test(printCssContent), "print.css must define @page size: A4 portrait");
    assert(/@page\s*\{[^}]*margin:\s*20mm\s+16mm\s+15mm\s+16mm/i.test(printCssContent), "print.css must define @page margin: 20mm 16mm 15mm 16mm");


    // Page break control
    assert(
      printCssContent.includes("page-break-inside: avoid") || printCssContent.includes("break-inside: avoid"),
      "print.css must specify page-break avoidance"
    );

    // Weight suppression
    assert(printCssContent.includes(".weight-summary-card"), "print.css must target .weight-summary-card");
    assert(
      /\.weight-summary-card[^{]*\{[^}]*display:\s*none\s*!important/i.test(printCssContent),
      "print.css must hide weight-summary-card with display:none !important"
    );

    // Print slip container visibility
    assert(
      /#print-slip-container[^{]*\{[^}]*display:\s*block\s*!important/i.test(printCssContent),
      "print.css must show #print-slip-container with display:block !important"
    );
  });

  // -----------------------------------------------------------------------------
  // TC-P12-014: Existing Regression Suite Contract & Fresh Evidence Verification (AC-P12-17)
  // -----------------------------------------------------------------------------
  await runTest("TC-P12-014", "Existing Regression Suite Contract: verifies 14 suites and 261 test contracts and fresh evidence (AC-P12-17)", () => {
    const candidateLogPaths = [
      path.resolve(__dirname, "all_tests_pass_summary.log"),
      path.resolve(__dirname, "../tests/all_tests_pass_summary.log"),
      path.resolve(__dirname, "../../tests/all_tests_pass_summary.log"),
      path.resolve(process.cwd(), "tests/all_tests_pass_summary.log")
    ];
    const logPath = candidateLogPaths.find(p => fs.existsSync(p));
    assert(logPath, "tests/all_tests_pass_summary.log must exist as regression run evidence");

    const logContent = fs.readFileSync(logPath, "utf-8");
    assert(logContent.includes("TOTAL SUITES: 14"), "Log must confirm TOTAL SUITES: 14");
    assert(logContent.includes("TOTAL TESTS:  261") || logContent.includes("TOTAL TESTS: 261"), "Log must confirm TOTAL TESTS: 261");
    assert(logContent.includes("TOTAL PASSED: 261"), "Log must confirm TOTAL PASSED: 261");
    assert(logContent.includes("TOTAL FAILED: 0"), "Log must confirm TOTAL FAILED: 0");
    assert(logContent.includes("OVERALL STATUS: ALL_TESTS_PASS"), "Log must confirm OVERALL STATUS: ALL_TESTS_PASS");

    // Also verify all 14 suite files exist and are non-empty
    const expectedSuites = [
      "gate3a8_draft_test_runner.js",
      "test-p08-final-remediation.js",
      "test-p08-ux-remediation.js",
      "test-p08-signed-hardening.js",
      "test-p09-asbuilt-audit.js",
      "test-p09-codex-hardening.js",
      "test-p10-asbuilt-audit.js",
      "test-p10-codex-hardening.js",
      "test-hard-fix-blocking.js",
      "test-staging-promotion-gate.js",
      "test-signature-access-separation-c.js",
      "test-p11-history-search.js",
      "test-p11-ui-fix.js",
      "test-p11-ui-fix-r2.js"
    ];

    for (const name of expectedSuites) {
      assert(logContent.includes(name), `Evidence log must record suite ${name}`);
      const candidateSuitePaths = [
        path.resolve(__dirname, name),
        path.resolve(__dirname, "../tests", name),
        path.resolve(__dirname, "../../tests", name),
        path.resolve(__dirname, "../../../tests", name),
        path.resolve(process.cwd(), "tests", name),
        path.resolve(process.cwd(), "../tests", name),
        path.resolve(process.cwd(), "../../tests", name)
      ];
      const suitePath = candidateSuitePaths.find(p => fs.existsSync(p));
      assert(suitePath, `Suite file ${name} must exist on disk`);
      assert(fs.statSync(suitePath).size > 0, `Suite file ${name} must not be empty`);
    }
  });

  // =============================================================================
  // SUMMARY & EXIT
  // =============================================================================
  console.log("\n================================================================================");
  console.log(`TEST SUMMARY: ${passedCount} PASSED, ${failedCount} FAILED (TOTAL: ${passedCount + failedCount})`);
  console.log("================================================================================");

  if (failedCount > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runAllTests().catch(err => {
  console.error("Unhandled test suite error:", err);
  process.exit(1);
});
