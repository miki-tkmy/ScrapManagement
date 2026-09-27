// Google Apps Script (GAS) Web API Client (gasClient.js)
// ========================================================================================
// Central DB (Google Sheets) 連携 & STAGING 通信クライアント
// - window.SCRAP_CONFIG.gasEndpoint を優先利用
// - STAGING 設定で URL 未設定の場合は MOCK 成功と偽装せず Fail-Closed (STAGING_ENDPOINT_NOT_CONFIGURED)
// - GAS_STAGING 通信失敗時も MOCK へ silent fallback せず Fail-Closed (STAGING_BACKEND_UNAVAILABLE)
// - 中央履歴 (fetchHistory), 伝票詳細 (fetchSlip), 中央集計 (fetchSummary), 社員照会 (lookupEmployee)
// ========================================================================================

const SCRAP_FRONTEND_BUILD_ID = "GATE3A7-FIXPREF-20260926-01";
if (typeof window !== "undefined") {
  window.SCRAP_FRONTEND_BUILD_ID = SCRAP_FRONTEND_BUILD_ID;
}

const SCRAP_DIAGNOSTIC = {
  buildId: SCRAP_FRONTEND_BUILD_ID,
  environment: (typeof SCRAP_CONFIG !== "undefined" && SCRAP_CONFIG.environment) ? SCRAP_CONFIG.environment : "UNKNOWN",
  endpointHost: (typeof SCRAP_CONFIG !== "undefined" && SCRAP_CONFIG.gasEndpoint) ? (() => {
    try { return new URL(SCRAP_CONFIG.gasEndpoint).host; } catch (e) { return "INVALID_URL"; }
  })() : "UNKNOWN",
  userAgent: (typeof navigator !== "undefined" && navigator.userAgent) ? navigator.userAgent : "",
  currentStage: "LOOKUP_IDLE",
  stageTimestamps: {},
  elapsedMs: 0,
  lastErrorCode: null,
  lastHttpStatus: null,
  responseOriginHost: null,
  responseContentType: null
};

if (typeof window !== "undefined") {
  window.SCRAP_DIAGNOSTIC = SCRAP_DIAGNOSTIC;
}

function setDiagnosticStage(stage, details = {}) {
  const now = (typeof performance !== "undefined" && performance.now) ? performance.now() : Date.now();
  if (stage === "BOOTSTRAP_START") {
    SCRAP_DIAGNOSTIC.stageTimestamps = { BOOTSTRAP_START: now };
    SCRAP_DIAGNOSTIC.elapsedMs = 0;
    SCRAP_DIAGNOSTIC.lastErrorCode = null;
    SCRAP_DIAGNOSTIC.lastHttpStatus = null;
    SCRAP_DIAGNOSTIC.responseOriginHost = null;
    SCRAP_DIAGNOSTIC.responseContentType = null;
  } else if (stage === "LOOKUP_START") {
    SCRAP_DIAGNOSTIC.stageTimestamps.LOOKUP_START = now;
    SCRAP_DIAGNOSTIC.elapsedMs = 0;
    SCRAP_DIAGNOSTIC.lastErrorCode = null;
    SCRAP_DIAGNOSTIC.lastHttpStatus = null;
    SCRAP_DIAGNOSTIC.responseOriginHost = null;
    SCRAP_DIAGNOSTIC.responseContentType = null;
  } else {
    SCRAP_DIAGNOSTIC.stageTimestamps[stage] = now;
    const start = SCRAP_DIAGNOSTIC.stageTimestamps.LOOKUP_START || SCRAP_DIAGNOSTIC.stageTimestamps.BOOTSTRAP_START || now;
    SCRAP_DIAGNOSTIC.elapsedMs = Math.round(now - start);
  }
  SCRAP_DIAGNOSTIC.currentStage = stage;
  if (details.errorCode) SCRAP_DIAGNOSTIC.lastErrorCode = details.errorCode;
  if (details.httpStatus !== undefined) SCRAP_DIAGNOSTIC.lastHttpStatus = details.httpStatus;
  if (details.responseOriginHost) SCRAP_DIAGNOSTIC.responseOriginHost = details.responseOriginHost;
  if (details.responseContentType) SCRAP_DIAGNOSTIC.responseContentType = details.responseContentType;

  const cfg = (typeof window !== "undefined" && window.SCRAP_CONFIG) ? window.SCRAP_CONFIG : (typeof SCRAP_CONFIG !== "undefined" ? SCRAP_CONFIG : null);
  if (cfg) {
    if (cfg.environment) SCRAP_DIAGNOSTIC.environment = cfg.environment;
    if (cfg.gasEndpoint) {
      try { SCRAP_DIAGNOSTIC.endpointHost = new URL(cfg.gasEndpoint).host; } catch (e) {}
    }
  }

  if (typeof window !== "undefined" && typeof window.updateDiagnosticUI === "function") {
    window.updateDiagnosticUI();
  }
}

if (typeof window !== "undefined") {
  window.setDiagnosticStage = setDiagnosticStage;
}

class GasClient {
  constructor(endpointUrl = "", options = {}) {
    const config = typeof window !== "undefined" && window.SCRAP_CONFIG ? window.SCRAP_CONFIG : {};
    const configUrl = config.gasEndpoint || "";
    this.endpointUrl = (endpointUrl === "MOCK" ? "" : (endpointUrl || configUrl));

    const env = options.environment || config.environment || "STAGING";
    const urlHasMock = (typeof window !== "undefined" && window.location && window.location.search && window.location.search.includes("mode=MOCK"));
    // 明示的なテスト/モック指定のみ MOCK 許可
    this.isMockMode = (
      endpointUrl === "MOCK" ||
      options.mode === "MOCK" ||
      options.isMock === true ||
      env === "LOCAL_TEST" ||
      urlHasMock ||
      (typeof window !== "undefined" && window.USE_MOCK === true)
    );
    this.isUnconfiguredStaging = (env === "STAGING" && !this.endpointUrl && !this.isMockMode);

    // MOCK 用インメモリストア
    this.mockSlips = [];
    this.mockDirectory = {
      "E00001": { empNo: "E00001", employeeName: "テスト担当A", baseCode: "B03", baseName: "大阪第一Base", active: true },
      "E00002": { empNo: "E00002", employeeName: "テスト担当B", baseCode: "B03", baseName: "大阪第一Base", active: true },
      "E00003": { empNo: "E00003", employeeName: "テスト担当C", baseCode: "B02", baseName: "東京第一Base", active: true },
      "E00004": { empNo: "E00004", employeeName: "休職担当", baseCode: "B01", baseName: "仙台Base", active: false },
      "E00005": { empNo: "E00005", employeeName: "本部担当D", baseCode: "", baseName: "", active: true }
    };

    // MOCK 用リビジョン管理 (V3.5 / V3.8)
    this._mockRevisions = {
      masterRevision: 1,
      historyRevisions: {},
      slipCountRevisions: {},
      materialSummaryRevisions: {},
      summaryRevisions: {}
    };

    // MOCK 用 社員別資材カテゴリ設定 (V3.10)
    this._mockPreferences = {
      "E00001": {
        exists: true,
        selectedMaterialCategories: [
          "IQ", "AN", "AJ", "AY", "AZ", "BA", "BC", "CA", "DS", "EA",
          "GK", "H3", "H6", "HA", "HS", "KK", "PC", "PP", "QB", "RT",
          "SA", "SS", "UA", "UG", "VM", "YT", "YU", "ZZ", "__UNGROUPED__"
        ],
        selectedFixedItemIds: null,
        preferenceRevision: 1,
        updatedAt: new Date().toISOString()
      }
    };
  }

  setEndpoint(url) {
    this.endpointUrl = url;
    this.isUnconfiguredStaging = (!url && !this.isMockMode);
  }

  getMode() {
    if (this.isMockMode) return "MOCK";
    if (this.isUnconfiguredStaging) return "STAGING_UNCONFIGURED";
    return "GAS_STAGING";
  }

  // 1. ヘルスチェック (GET action=health)
  async getHealth() {
    if (this.isMockMode) {
      return {
        success: true,
        mode: "MOCK",
        status: "OK",
        environment: "MOCK_LOCAL",
        database: "MOCK_CENTRAL_DB",
        timestamp: new Date().toISOString()
      };
    }

    if (this.isUnconfiguredStaging) {
      return {
        success: false,
        mode: "STAGING_UNCONFIGURED",
        error: "STAGING_ENDPOINT_NOT_CONFIGURED",
        message: "STAGING Web App URL is not configured in src/js/config.js."
      };
    }

    try {
      const resp = await fetch(`${this.endpointUrl}?action=health`, { method: "GET" });
      if (!resp.ok) throw new Error(`HTTP Error: ${resp.status}`);
      const data = await resp.json();
      data.mode = "GAS_STAGING";
      return data;
    } catch (e) {
      console.error("[gasClient] Health check failed:", e);
      return {
        success: false,
        mode: "GAS_STAGING",
        error: "STAGING_BACKEND_UNAVAILABLE",
        message: e.message
      };
    }
  }

  // 2. アプリ設定取得 (GET action=app-settings)
  async getAppSettings() {
    if (this.isMockMode) {
      return {
        success: true,
        mode: "MOCK",
        settings: { environment: "STAGING_MOCK", system: "ScrapManagement" }
      };
    }

    if (this.isUnconfiguredStaging) {
      return {
        success: false,
        mode: "STAGING_UNCONFIGURED",
        error: "STAGING_ENDPOINT_NOT_CONFIGURED"
      };
    }

    try {
      const resp = await fetch(`${this.endpointUrl}?action=app-settings`, { method: "GET" });
      if (!resp.ok) throw new Error(`HTTP Error: ${resp.status}`);
      const data = await resp.json();
      data.mode = "GAS_STAGING";
      return data;
    } catch (e) {
      console.error("[gasClient] getAppSettings failed:", e);
      return {
        success: false,
        mode: "GAS_STAGING",
        error: "STAGING_BACKEND_UNAVAILABLE",
        message: e.message
      };
    }
  }

  // 2.5. リビジョン状態取得 (GET action=state) - V3.5 / V3.8 軽量API
  async fetchState(baseCode = "GLOBAL") {
    if (this.isMockMode) {
      if (!this._mockRevisions) {
        this._mockRevisions = { masterRevision: 1, historyRevisions: {}, slipCountRevisions: {}, materialSummaryRevisions: {}, summaryRevisions: {} };
      }
      const b = baseCode || "GLOBAL";
      const matRev = this._mockRevisions.materialSummaryRevisions[b] || this._mockRevisions.summaryRevisions[b] || 1;
      return {
        success: true,
        mode: "MOCK",
        baseCode: b,
        masterRevision: this._mockRevisions.masterRevision || 1,
        historyRevision: this._mockRevisions.historyRevisions[b] || 1,
        slipCountRevision: this._mockRevisions.slipCountRevisions[b] || 1,
        materialSummaryRevision: matRev,
        summaryRevision: matRev,
        serverTime: new Date().toISOString()
      };
    }

    if (this.isUnconfiguredStaging) {
      return {
        success: false,
        mode: "STAGING_UNCONFIGURED",
        error: "STAGING_ENDPOINT_NOT_CONFIGURED",
        message: "STAGING Web App URL is not configured in src/js/config.js."
      };
    }

    try {
      const resp = await fetch(`${this.endpointUrl}?action=state&baseCode=${encodeURIComponent(baseCode || "GLOBAL")}`, {
        method: "GET"
      });
      if (!resp.ok) throw new Error(`HTTP Error: ${resp.status}`);
      const data = await resp.json();
      data.mode = "GAS_STAGING";
      return data;
    } catch (e) {
      console.error("[gasClient] fetchState failed:", e);
      return {
        success: false,
        mode: "GAS_STAGING",
        error: "STAGING_BACKEND_UNAVAILABLE",
        message: e.message
      };
    }
  }

  // 3. マスタデータ取得 (GET action=masters) - カテゴリフィルタ対応
  async fetchMasters(options = {}) {
    const categories = options.categories || [];
    const catQuery = categories.length > 0 ? `&categories=${encodeURIComponent(categories.join(","))}` : "";

    const defaultCategories = [
      { categoryCode: "PIPE", categoryName: "単管" },
      { categoryCode: "BRACKET", categoryName: "金具" },
      { categoryCode: "NEXTGEN", categoryName: "次世代" },
      { categoryCode: "FRAME", categoryName: "枠組" },
      { categoryCode: "IQ", categoryName: "IQ" }
    ];

    if (this.isMockMode) {
      let items = typeof window !== "undefined" ? (window.TEST_FIXTURE_ITEMS || []) : [];
      if (categories.length > 0) {
        items = items.filter(it => !it.categoryCode || categories.includes(it.categoryCode));
      }
      return {
        success: true,
        mode: "MOCK",
        source: "MOCK_CENTRAL_DB",
        bases: typeof window !== "undefined" ? (window.TEST_FIXTURE_BASES || []) : [],
        items: items,
        fixedItems: typeof window !== "undefined" ? (window.TEST_FIXTURE_FIXED_ITEMS || []) : [],
        categories: defaultCategories
      };
    }

    if (this.isUnconfiguredStaging) {
      return {
        success: false,
        mode: "STAGING_UNCONFIGURED",
        error: "STAGING_ENDPOINT_NOT_CONFIGURED",
        message: "STAGING Web App URL is not configured. Falling back to local fixtures for offline view."
      };
    }

    try {
      const resp = await fetch(`${this.endpointUrl}?action=masters${catQuery}`, { method: "GET" });
      if (!resp.ok) throw new Error(`HTTP Error: ${resp.status}`);
      const data = await resp.json();
      data.mode = "GAS_STAGING";
      if (!data.categories || data.categories.length === 0) {
        data.categories = defaultCategories;
      }
      return data;
    } catch (e) {
      console.error("[gasClient] fetchMasters failed (Fail-Closed):", e);
      return {
        success: false,
        mode: "GAS_STAGING",
        error: "STAGING_BACKEND_UNAVAILABLE",
        message: e.message
      };
    }
  }

  // 4. 社員ディレクトリ照会 (GET action=employee&empNo=...)
  async lookupEmployee(empNo) {
    if (!empNo) {
      return { success: false, error: "MISSING_EMP_NO", message: "社員番号を入力してください。" };
    }

    const cleanEmpNo = String(empNo).trim().toUpperCase();

    if (this.isMockMode) {
      const emp = this.mockDirectory[cleanEmpNo];
      if (!emp) {
        return { success: false, error: "EMPLOYEE_NOT_FOUND", message: "指定された社員番号が見つかりません。" };
      }
      if (!emp.active) {
        return { success: false, error: "EMPLOYEE_INACTIVE", message: "社員番号が無効または休職中です。" };
      }
      const bCode = emp.baseCode ? String(emp.baseCode).trim() : "";
      const bName = emp.baseName ? String(emp.baseName).trim() : "";
      const baseSelectionRequired = (!bCode);

      if (!this._mockPreferences) this._mockPreferences = {};
      const mockPref = this._mockPreferences[cleanEmpNo] || {
        exists: false,
        selectedMaterialCategories: [],
        preferenceRevision: 0,
        updatedAt: null
      };

      return {
        success: true,
        mode: "MOCK",
        employee: Object.assign({}, emp, {
          employeeNo: emp.employeeNo || emp.empNo || cleanEmpNo,
          employeeBaseCode: bCode,
          employeeBaseName: bName,
          baseCode: bCode,
          baseName: bName,
          baseSelectionRequired: baseSelectionRequired,
          updatedAt: new Date().toISOString()
        }),
        preference: {
          exists: mockPref.exists,
          selectedMaterialCategories: (mockPref.selectedMaterialCategories || []).slice(),
          selectedFixedItemIds: mockPref.selectedFixedItemIds !== undefined ? mockPref.selectedFixedItemIds : null,
          preferenceRevision: mockPref.preferenceRevision || 0,
          updatedAt: mockPref.updatedAt || null
        }
      };
    }

    if (this.isUnconfiguredStaging) {
      return {
        success: false,
        mode: "STAGING_UNCONFIGURED",
        error: "STAGING_ENDPOINT_NOT_CONFIGURED"
      };
    }

    const isProd = (typeof SCRAP_CONFIG !== "undefined" && SCRAP_CONFIG.isProduction) ? SCRAP_CONFIG.isProduction() : false;
    const modeLabel = isProd ? "GAS_PRODUCTION" : "GAS_STAGING";

    setDiagnosticStage("LOOKUP_START");

    const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
    const timeoutMs = 15000;

    // Hard Promise Timeout (15000ms): AbortController にのみ依存せず Promise.race で強制遮断
    let hardTimeoutTimer = null;
    const hardTimeoutPromise = new Promise((_, reject) => {
      hardTimeoutTimer = setTimeout(() => {
        if (controller) {
          try { controller.abort(); } catch (e) {}
        }
        const err = new Error("EMPLOYEE_LOOKUP_HARD_TIMEOUT");
        err.name = "HardTimeoutError";
        err.code = "EMPLOYEE_LOOKUP_HARD_TIMEOUT";
        reject(err);
      }, timeoutMs);
    });

    const fetchAndParseEmployee = async () => {
      // Cache buster: 毎リクエスト一意のタイムスタンプを付与
      const cacheBuster = Date.now();
      const lookupUrl = `${this.endpointUrl}?action=employee&empNo=${encodeURIComponent(cleanEmpNo)}&_cb=${cacheBuster}`;

      const fetchOptions = {
        method: "GET",
        redirect: "follow",
        cache: "no-store",
        credentials: "omit"
      };
      if (controller) {
        fetchOptions.signal = controller.signal;
      }

      setDiagnosticStage("FETCH_DISPATCHED");

      const resp = await fetch(lookupUrl, fetchOptions);

      let respHost = null;
      try {
        if (resp.url) respHost = new URL(resp.url).host;
      } catch (e) {}
      const contentType = resp.headers ? (resp.headers.get("content-type") || "") : "";

      setDiagnosticStage("FETCH_RESPONSE_RECEIVED", {
        httpStatus: resp.status,
        responseOriginHost: respHost,
        responseContentType: contentType
      });

      if (!resp.ok) {
        const errData = await resp.json().catch(() => ({}));
        return {
          success: false,
          mode: modeLabel,
          error: errData.error || `HTTP_${resp.status}`,
          message: errData.message || `サーバーエラー (${resp.status})`
        };
      }

      setDiagnosticStage("JSON_PARSE_START");

      const data = await resp.json();

      setDiagnosticStage("JSON_PARSED");

      // エラーレスポンスの正規化
      if (!data || data.success === false || data.error) {
        return {
          success: false,
          mode: modeLabel,
          error: (data && data.error) || "EMPLOYEE_NOT_FOUND",
          message: (data && data.message) || "社員情報が見つかりません。"
        };
      }

      // 成功レスポンスの正規化 (Canonical Employee Contract)
      const src = (data.employee && typeof data.employee === "object") ? data.employee : data;
      const resolvedEmpNo = String(src.employeeNo || src.empNo || cleanEmpNo).trim();
      const resolvedEmpName = String(src.employeeName || "").trim();
      const bCode = src.employeeBaseCode !== undefined
        ? String(src.employeeBaseCode).trim()
        : (src.baseCode !== undefined ? String(src.baseCode).trim() : "");
      const bName = src.employeeBaseName !== undefined
        ? String(src.employeeBaseName).trim()
        : (src.baseName !== undefined ? String(src.baseName).trim() : "");
      const baseSelectionRequired = (typeof src.baseSelectionRequired === "boolean")
        ? src.baseSelectionRequired
        : (!bCode);

      const normalized = {
        success: true,
        mode: modeLabel,
        employee: {
          employeeNo: resolvedEmpNo,
          employeeName: resolvedEmpName,
          employeeBaseCode: bCode,
          employeeBaseName: bName,
          baseSelectionRequired: baseSelectionRequired
        },
        preference: data.preference || null
      };

      setDiagnosticStage("NORMALIZED");

      return normalized;
    };

    try {
      const result = await Promise.race([
        fetchAndParseEmployee(),
        hardTimeoutPromise
      ]);
      if (hardTimeoutTimer) clearTimeout(hardTimeoutTimer);
      return result;
    } catch (e) {
      if (hardTimeoutTimer) clearTimeout(hardTimeoutTimer);
      console.error("[gasClient] lookupEmployee failed:", e);

      const isHardTimeout = (e.name === "HardTimeoutError" || e.code === "EMPLOYEE_LOOKUP_HARD_TIMEOUT" || e.message === "EMPLOYEE_LOOKUP_HARD_TIMEOUT");
      const isAbortTimeout = (e.name === "AbortError" || e.code === 20 || String(e.message).includes("abort"));

      if (isHardTimeout || isAbortTimeout) {
        setDiagnosticStage("LOOKUP_FAILED", {
          errorCode: isHardTimeout ? "EMPLOYEE_LOOKUP_HARD_TIMEOUT" : "EMPLOYEE_LOOKUP_TIMEOUT"
        });
        return {
          success: false,
          mode: modeLabel,
          error: isHardTimeout ? "EMPLOYEE_LOOKUP_HARD_TIMEOUT" : "EMPLOYEE_LOOKUP_TIMEOUT",
          message: "社員情報の照会がタイムアウトしました。通信状態を確認して再試行してください。"
        };
      }

      setDiagnosticStage("LOOKUP_FAILED", {
        errorCode: isProd ? "PROD_BACKEND_UNAVAILABLE" : "STAGING_BACKEND_UNAVAILABLE"
      });

      return {
        success: false,
        mode: modeLabel,
        error: isProd ? "PROD_BACKEND_UNAVAILABLE" : "STAGING_BACKEND_UNAVAILABLE",
        message: e.message || "通信エラーが発生しました。"
      };
    }
  }

  // 5. 中央履歴取得 (GET action=history&baseCode=...&status=FINAL&fromDate=...&toDate=...)
  async fetchHistory(params = {}) {
    const baseCode = params.baseCode || "";
    if (!baseCode) {
      return { success: false, error: "MISSING_BASE_CODE", message: "BaseCode is required." };
    }

    const status = params.status || "FINAL";
    const fromDate = params.fromDate || "";
    const toDate = params.toDate || "";

    if (this.isMockMode) {
      // MOCK では mockSlips または localStorage から baseCode 一致のものを返す
      let localSlips = [];
      try {
        const raw = typeof localStorage !== "undefined" ? localStorage.getItem("scrap_confirmed_slips") : null;
        localSlips = raw ? JSON.parse(raw) : [];
      } catch (e) {}

      const all = (this.mockSlips || []).concat(localSlips);
      const filtered = all.filter(s => {
        if (s.baseCode !== baseCode) return false;
        if (status !== "ALL" && s.status !== status) return false;
        const d = (s.createdAt || s.date || "").slice(0, 10);
        if (fromDate && d < fromDate) return false;
        if (toDate && d > toDate) return false;
        return true;
      });

      return {
        success: true,
        mode: "MOCK",
        source: "MOCK_CENTRAL_DB",
        baseCode: baseCode,
        count: filtered.length,
        slips: filtered
      };
    }

    if (this.isUnconfiguredStaging) {
      return {
        success: false,
        mode: "STAGING_UNCONFIGURED",
        error: "STAGING_ENDPOINT_NOT_CONFIGURED"
      };
    }

    try {
      const q = `action=history&baseCode=${encodeURIComponent(baseCode)}&status=${encodeURIComponent(status)}` +
        (fromDate ? `&fromDate=${encodeURIComponent(fromDate)}` : "") +
        (toDate ? `&toDate=${encodeURIComponent(toDate)}` : "");
      const resp = await fetch(`${this.endpointUrl}?${q}`, { method: "GET" });
      if (!resp.ok) throw new Error(`HTTP Error: ${resp.status}`);
      const data = await resp.json();
      data.mode = "GAS_STAGING";
      return data;
    } catch (e) {
      console.error("[gasClient] fetchHistory failed:", e);
      return {
        success: false,
        mode: "GAS_STAGING",
        error: "STAGING_BACKEND_UNAVAILABLE",
        message: e.message
      };
    }
  }

  // 6. 伝票詳細取得 (GET action=slip&slipId=...)
  async fetchSlip(slipId) {
    if (!slipId) {
      return { success: false, error: "MISSING_SLIP_ID" };
    }

    if (this.isMockMode) {
      const found = (this.mockSlips || []).find(s => s.slipId === slipId || s.scrapId === slipId);
      if (found) {
        return { success: true, mode: "MOCK", slip: found };
      }
      try {
        const raw = typeof localStorage !== "undefined" ? localStorage.getItem("scrap_confirmed_slips") : null;
        const local = raw ? JSON.parse(raw) : [];
        const lf = local.find(s => s.slipId === slipId || s.scrapId === slipId);
        if (lf) return { success: true, mode: "MOCK", slip: lf };
      } catch (e) {}
      return { success: false, error: "SLIP_NOT_FOUND" };
    }

    if (this.isUnconfiguredStaging) {
      return { success: false, mode: "STAGING_UNCONFIGURED", error: "STAGING_ENDPOINT_NOT_CONFIGURED" };
    }

    try {
      const resp = await fetch(`${this.endpointUrl}?action=slip&slipId=${encodeURIComponent(slipId)}`, { method: "GET" });
      if (!resp.ok) throw new Error(`HTTP Error: ${resp.status}`);
      const data = await resp.json();
      data.mode = "GAS_STAGING";
      return data;
    } catch (e) {
      console.error("[gasClient] fetchSlip failed:", e);
      return {
        success: false,
        mode: "GAS_STAGING",
        error: "STAGING_BACKEND_UNAVAILABLE",
        message: e.message
      };
    }
  }

  // 6.5. 軽量集計カウント取得 (GET action=summary-count&baseCode=...&fromDate=...&toDate=...)
  async fetchSummaryCount(params = {}) {
    const baseCode = params.baseCode || "";
    if (!baseCode) {
      return { success: false, error: "MISSING_BASE_CODE" };
    }
    const fromDate = params.fromDate || "";
    const toDate = params.toDate || "";

    if (this.isMockMode) {
      const hist = await this.fetchHistory({ baseCode, status: "FINAL", fromDate, toDate });
      const slips = hist.slips || [];
      const slipCountRev = (this._mockRevisions && this._mockRevisions.slipCountRevisions && this._mockRevisions.slipCountRevisions[baseCode]) || 1;
      return {
        success: true,
        mode: "MOCK",
        source: "MOCK_CENTRAL_DB",
        baseCode: baseCode,
        fromDate: fromDate,
        toDate: toDate,
        totalSlipsCount: slips.length,
        slipCountRevision: slipCountRev
      };
    }

    if (this.isUnconfiguredStaging) {
      return { success: false, mode: "STAGING_UNCONFIGURED", error: "STAGING_ENDPOINT_NOT_CONFIGURED" };
    }

    try {
      const q = `action=summary-count&baseCode=${encodeURIComponent(baseCode)}` +
        (fromDate ? `&fromDate=${encodeURIComponent(fromDate)}` : "") +
        (toDate ? `&toDate=${encodeURIComponent(toDate)}` : "");
      const resp = await fetch(`${this.endpointUrl}?${q}`, { method: "GET" });
      if (!resp.ok) throw new Error(`HTTP Error: ${resp.status}`);
      const data = await resp.json();
      data.mode = "GAS_STAGING";
      return data;
    } catch (e) {
      console.error("[gasClient] fetchSummaryCount failed:", e);
      return {
        success: false,
        mode: "GAS_STAGING",
        error: "STAGING_BACKEND_UNAVAILABLE",
        message: e.message
      };
    }
  }

  // 7. 中央集計取得 (GET action=summary&baseCode=...&fromDate=...&toDate=...)
  async fetchSummary(params = {}) {
    const baseCode = params.baseCode || "";
    if (!baseCode) {
      return { success: false, error: "MISSING_BASE_CODE" };
    }
    const fromDate = params.fromDate || "";
    const toDate = params.toDate || "";

    if (this.isMockMode) {
      const hist = await this.fetchHistory({ baseCode, status: "FINAL", fromDate, toDate });
      const slips = hist.slips || [];
      const itemMap = {};
      let totalWeightKg = 0;
      let totalItemsCount = 0;

      slips.forEach(s => {
        (s.codeItems || []).forEach(it => {
          if (it.quantityType === "NUMBER" && typeof it.quantityValue === "number" && it.quantityValue > 0) {
            totalItemsCount += it.quantityValue;
            const code = (it.itemCode ? String(it.itemCode).trim() : "") || "UNKNOWN";
            const detailName = it.itemName || "";
            const masterItem = (typeof window !== "undefined" && window.ACTIVE_ITEMS) ? window.ACTIVE_ITEMS.find(m => m.itemCode === code) : null;
            const resolvedName = masterItem ? masterItem.itemName : detailName;
            const key = code;
            if (!itemMap[key]) {
              itemMap[key] = { itemCode: code, itemName: resolvedName, totalQty: 0, totalWeightKg: 0, hasWeight: false };
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
      });

      const slipCountRev = (this._mockRevisions && this._mockRevisions.slipCountRevisions && this._mockRevisions.slipCountRevisions[baseCode]) || 1;
      const matRev = (this._mockRevisions && this._mockRevisions.materialSummaryRevisions && this._mockRevisions.materialSummaryRevisions[baseCode]) || 1;

      return {
        success: true,
        mode: "MOCK",
        source: "MOCK_CENTRAL_DB",
        baseCode: baseCode,
        fromDate: fromDate,
        toDate: toDate,
        totalSlipsCount: slips.length,
        totalWeightKg: Math.round(totalWeightKg * 100) / 100,
        totalItemsCount: totalItemsCount,
        items: Object.values(itemMap),
        slipCountRevision: slipCountRev,
        materialSummaryRevision: matRev,
        summaryRevision: matRev
      };
    }

    if (this.isUnconfiguredStaging) {
      return { success: false, mode: "STAGING_UNCONFIGURED", error: "STAGING_ENDPOINT_NOT_CONFIGURED" };
    }

    try {
      const q = `action=summary&baseCode=${encodeURIComponent(baseCode)}` +
        (fromDate ? `&fromDate=${encodeURIComponent(fromDate)}` : "") +
        (toDate ? `&toDate=${encodeURIComponent(toDate)}` : "");
      const resp = await fetch(`${this.endpointUrl}?${q}`, { method: "GET" });
      if (!resp.ok) throw new Error(`HTTP Error: ${resp.status}`);
      const data = await resp.json();
      data.mode = "GAS_STAGING";
      return data;
    } catch (e) {
      console.error("[gasClient] fetchSummary failed:", e);
      return {
        success: false,
        mode: "GAS_STAGING",
        error: "STAGING_BACKEND_UNAVAILABLE",
        message: e.message
      };
    }
  }

  // 8. 下書き取得 (GET action=draft&scrapId=...)
  async getDraft(scrapId, queryKey = "") {
    if (this.isMockMode) {
      const local = typeof window !== "undefined" && window.TerminalStorage ? window.TerminalStorage.getLocalDraft() : null;
      return {
        success: true,
        mode: "MOCK",
        draft: local
      };
    }

    if (this.isUnconfiguredStaging) {
      return {
        success: false,
        mode: "STAGING_UNCONFIGURED",
        error: "STAGING_ENDPOINT_NOT_CONFIGURED"
      };
    }

    try {
      const keyParam = queryKey ? `&key=${encodeURIComponent(queryKey)}` : "";
      const resp = await fetch(`${this.endpointUrl}?action=draft&scrapId=${encodeURIComponent(scrapId)}${keyParam}`, { method: "GET" });
      if (!resp.ok) throw new Error(`HTTP Error: ${resp.status}`);
      const data = await resp.json();
      data.mode = "GAS_STAGING";
      return data;
    } catch (e) {
      console.error("[gasClient] getDraft failed:", e);
      return {
        success: false,
        mode: "GAS_STAGING",
        error: "STAGING_BACKEND_UNAVAILABLE",
        message: e.message
      };
    }
  }

  // 9. 下書き保存 (POST action=draft)
  async saveDraft(draftPayload) {
    if (this.isMockMode) {
      const scrapId = draftPayload.scrapId || draftPayload.slipId || `DRAFT-${Date.now()}`;
      const b = draftPayload.baseCode || "GLOBAL";
      if (!this._mockRevisions.historyRevisions[b]) this._mockRevisions.historyRevisions[b] = 1;
      this._mockRevisions.historyRevisions[b]++;
      return {
        success: true,
        mode: "MOCK",
        status: "DRAFT_SAVED",
        scrapId: scrapId,
        slipId: scrapId,
        savedAt: new Date().toISOString(),
        createdBy: draftPayload.employeeNo || ""
      };
    }

    if (this.isUnconfiguredStaging) {
      return {
        success: false,
        mode: "STAGING_UNCONFIGURED",
        error: "STAGING_ENDPOINT_NOT_CONFIGURED",
        message: "STAGING Web App URL is not configured."
      };
    }

    try {
      const resp = await fetch(this.endpointUrl, {
        method: "POST",
        headers: { "Content-Type": "text/plain" },
        body: JSON.stringify({ action: "draft", payload: draftPayload })
      });
      if (!resp.ok) throw new Error(`HTTP Error: ${resp.status}`);
      const data = await resp.json();
      data.mode = "GAS_STAGING";
      return data;
    } catch (e) {
      console.error("[gasClient] saveDraft failed:", e);
      return {
        success: false,
        mode: "GAS_STAGING",
        error: "STAGING_BACKEND_UNAVAILABLE",
        message: e.message
      };
    }
  }

  // 10. 下書き削除 (POST action=delete-draft)
  async deleteDraft(params = {}, legacyBaseCode, legacyEmployeeNo) {
    let scrapId, baseCode, employeeNo;
    if (typeof params === "string") {
      scrapId = params;
      baseCode = legacyBaseCode;
      employeeNo = legacyEmployeeNo || "";
    } else {
      scrapId = params.scrapId || params.draftId || params.slipId;
      baseCode = params.baseCode;
      employeeNo = params.employeeNo || "";
    }

    if (!scrapId) {
      return { success: false, error: "MISSING_DRAFT_ID", message: "Draft ID is required." };
    }
    if (!baseCode) {
      return { success: false, error: "MISSING_BASE_CODE", message: "BaseCode is required." };
    }

    if (this.isMockMode) {
      const cleanScrapId = String(scrapId).trim();
      const cleanBaseCode = String(baseCode).trim();
      const cleanEmployeeNo = String(employeeNo).trim();

      // MOCK slips から検索
      const idx = (this.mockSlips || []).findIndex(s => s.scrapId === cleanScrapId || s.slipId === cleanScrapId);
      if (idx >= 0) {
        const target = this.mockSlips[idx];
        if (target.status === "FINAL") {
          return { success: false, error: "CANNOT_DELETE_FINAL_SLIP", message: "FINAL slips cannot be deleted." };
        }
        if (target.baseCode !== cleanBaseCode) {
          return { success: false, error: "BASE_SCOPE_VIOLATION", message: "Cannot delete draft belonging to another base." };
        }
        this.mockSlips[idx].status = "DRAFT_DELETED";
        this.mockSlips[idx].deletedBy = cleanEmployeeNo;
      }

      if (typeof window !== "undefined" && window.TerminalStorage) {
        const local = window.TerminalStorage.getLocalDraft();
        if (local && (local.scrapId === cleanScrapId || local.slipId === cleanScrapId)) {
          window.TerminalStorage.clearLocalDraft();
        }
      }

      if (!this._mockRevisions.historyRevisions[cleanBaseCode]) this._mockRevisions.historyRevisions[cleanBaseCode] = 1;
      this._mockRevisions.historyRevisions[cleanBaseCode]++;

      return {
        success: true,
        mode: "MOCK",
        status: "DRAFT_DELETED",
        scrapId: cleanScrapId,
        deletedAt: new Date().toISOString(),
        deletedBy: cleanEmployeeNo
      };
    }

    if (this.isUnconfiguredStaging) {
      return {
        success: false,
        mode: "STAGING_UNCONFIGURED",
        error: "STAGING_ENDPOINT_NOT_CONFIGURED"
      };
    }

    try {
      const resp = await fetch(this.endpointUrl, {
        method: "POST",
        headers: { "Content-Type": "text/plain" },
        body: JSON.stringify({
          action: "delete-draft",
          payload: { scrapId: scrapId, baseCode: baseCode, employeeNo: employeeNo }
        })
      });
      if (!resp.ok) throw new Error(`HTTP Error: ${resp.status}`);
      const data = await resp.json();
      data.mode = "GAS_STAGING";
      return data;
    } catch (e) {
      console.error("[gasClient] deleteDraft failed:", e);
      return {
        success: false,
        mode: "GAS_STAGING",
        error: "STAGING_BACKEND_UNAVAILABLE",
        message: e.message
      };
    }
  }

  // 10.5. 社員別資材カテゴリ & 定型品設定保存 (POST action=savePreferences) - V3.10
  async saveEmployeePreferences(empNo, categoriesOrPayload, expectedRevision) {
    if (!empNo) {
      return { success: false, error: "MISSING_EMP_NO", message: "社員番号が指定されていません。" };
    }
    const cleanEmpNo = String(empNo).trim().toUpperCase();

    let cats = undefined;
    let fixedIds = undefined;

    if (Array.isArray(categoriesOrPayload)) {
      // Legacy / Category-only call signature: (empNo, checkedCats, expectedRev)
      cats = categoriesOrPayload;
    } else if (categoriesOrPayload && typeof categoriesOrPayload === "object") {
      // Extended call signature: (empNo, { selectedMaterialCategories, selectedFixedItemIds }, expectedRev)
      if (categoriesOrPayload.selectedMaterialCategories !== undefined) {
        cats = categoriesOrPayload.selectedMaterialCategories;
      } else if (categoriesOrPayload.categories !== undefined) {
        cats = categoriesOrPayload.categories;
      }

      if (categoriesOrPayload.selectedFixedItemIds !== undefined) {
        fixedIds = categoriesOrPayload.selectedFixedItemIds;
      } else if (categoriesOrPayload.fixedItemIds !== undefined) {
        fixedIds = categoriesOrPayload.fixedItemIds;
      }
    }

    const reqPayload = {
      employeeNo: cleanEmpNo,
      expectedPreferenceRevision: expectedRevision
    };
    if (cats !== undefined) {
      reqPayload.selectedMaterialCategories = Array.isArray(cats) ? cats : [];
    }
    if (fixedIds !== undefined) {
      reqPayload.selectedFixedItemIds = fixedIds;
    }

    if (this.isMockMode) {
      if (!this._mockPreferences) this._mockPreferences = {};
      const current = this._mockPreferences[cleanEmpNo] || {
        exists: false,
        selectedMaterialCategories: [
          "IQ", "AN", "AJ", "AY", "AZ", "BA", "BC", "CA", "DS", "EA",
          "GK", "H3", "H6", "HA", "HS", "KK", "PC", "PP", "QB", "RT",
          "SA", "SS", "UA", "UG", "VM", "YT", "YU", "ZZ", "__UNGROUPED__"
        ],
        selectedFixedItemIds: null,
        preferenceRevision: 0,
        updatedAt: null
      };
      const currentRev = (current && typeof current.preferenceRevision === "number") ? current.preferenceRevision : 0;

      // 楽観的排他制御 (expectedRevision 指定時)
      if (expectedRevision !== undefined && expectedRevision !== null && expectedRevision !== currentRev) {
        return {
          success: false,
          mode: "MOCK",
          error: "PREFERENCE_REVISION_CONFLICT",
          message: "別の端末で設定が更新されています。最新設定を再取得してください。",
          currentRevision: currentRev
        };
      }

      const newRev = currentRev + 1;
      const nowIso = new Date().toISOString();

      let finalCats = current.selectedMaterialCategories || [];
      if (cats !== undefined) {
        finalCats = Array.isArray(cats) ? cats.slice() : [];
      }

      let finalFixed = current.selectedFixedItemIds !== undefined ? current.selectedFixedItemIds : null;
      if (fixedIds !== undefined) {
        finalFixed = Array.isArray(fixedIds) ? fixedIds.slice() : (fixedIds === null ? null : null);
      }

      this._mockPreferences[cleanEmpNo] = {
        exists: true,
        selectedMaterialCategories: finalCats,
        selectedFixedItemIds: finalFixed,
        preferenceRevision: newRev,
        updatedAt: nowIso
      };

      return {
        success: true,
        mode: "MOCK",
        employeeNo: cleanEmpNo,
        preferenceRevision: newRev,
        selectedMaterialCategories: finalCats,
        selectedFixedItemIds: finalFixed,
        updatedAt: nowIso
      };
    }

    if (this.isUnconfiguredStaging) {
      return {
        success: false,
        mode: "STAGING_UNCONFIGURED",
        error: "STAGING_ENDPOINT_NOT_CONFIGURED",
        message: "STAGING Web App URL is not configured in src/js/config.js. Cannot save preferences."
      };
    }

    try {
      const resp = await fetch(this.endpointUrl, {
        method: "POST",
        headers: { "Content-Type": "text/plain" },
        body: JSON.stringify({
          action: "savePreferences",
          payload: reqPayload
        })
      });

      if (resp.status === 409) {
        const errData = await resp.json().catch(() => ({}));
        return {
          success: false,
          mode: "GAS_STAGING",
          error: "PREFERENCE_REVISION_CONFLICT",
          message: errData.message || "別の端末で設定が更新されています。最新設定を再取得してください。"
        };
      }

      if (!resp.ok) throw new Error(`HTTP Error: ${resp.status}`);
      const data = await resp.json();
      data.mode = "GAS_STAGING";
      return data;
    } catch (e) {
      console.error("[gasClient] saveEmployeePreferences failed:", e);
      return {
        success: false,
        mode: "GAS_STAGING",
        error: "STAGING_BACKEND_UNAVAILABLE",
        message: e.message
      };
    }
  }

  // 11. 確定保存 (POST action=final)
  async finalizeSlip(finalPayload) {
    if (this.isMockMode) {
      if (!this._mockSequences) this._mockSequences = {};
      const baseCode = finalPayload.baseCode || "";
      this._mockSequences[baseCode] = (this._mockSequences[baseCode] || 0) + 1;
      const seqStr = String(this._mockSequences[baseCode]).padStart(4, "0");
      const slipNo = `SCRAP-${baseCode}${seqStr}`;
      const scrapId = finalPayload.scrapId || `REC-${Date.now()}`;
      const confirmed = Object.assign({}, finalPayload, {
        scrapId: scrapId,
        slipId: slipNo,
        slipNo: slipNo,
        status: "FINAL",
        finalizedAt: new Date().toISOString()
      });
      this.mockSlips.unshift(confirmed);

      // 集計影響判定 (CODE + NUMBER > 0)
      const affectsSummary = (finalPayload.codeItems || []).some(it => {
        const qtyVal = Number(it.quantityValue);
        const qtyType = String(it.quantityType || "NUMBER");
        return qtyType === "NUMBER" && Number.isFinite(qtyVal) && qtyVal > 0;
      });

      if (!this._mockRevisions.historyRevisions) this._mockRevisions.historyRevisions = {};
      if (!this._mockRevisions.historyRevisions[baseCode]) this._mockRevisions.historyRevisions[baseCode] = 1;
      this._mockRevisions.historyRevisions[baseCode]++;

      if (!this._mockRevisions.slipCountRevisions) this._mockRevisions.slipCountRevisions = {};
      if (!this._mockRevisions.slipCountRevisions[baseCode]) this._mockRevisions.slipCountRevisions[baseCode] = 1;
      this._mockRevisions.slipCountRevisions[baseCode]++;

      if (!this._mockRevisions.materialSummaryRevisions) this._mockRevisions.materialSummaryRevisions = {};
      if (affectsSummary) {
        if (!this._mockRevisions.materialSummaryRevisions[baseCode]) this._mockRevisions.materialSummaryRevisions[baseCode] = 1;
        this._mockRevisions.materialSummaryRevisions[baseCode]++;
        if (!this._mockRevisions.summaryRevisions) this._mockRevisions.summaryRevisions = {};
        this._mockRevisions.summaryRevisions[baseCode] = this._mockRevisions.materialSummaryRevisions[baseCode];
      }

      return {
        success: true,
        mode: "MOCK",
        status: "FINAL_CONFIRMED",
        scrapId: scrapId,
        slipId: slipNo,
        slipNo: slipNo,
        finalizedAt: confirmed.finalizedAt,
        createdBy: finalPayload.employeeNo || "",
        affectsMaterialSummary: affectsSummary,
        affectsSummary: affectsSummary,
        slipCountRevision: this._mockRevisions.slipCountRevisions[baseCode],
        materialSummaryRevision: this._mockRevisions.materialSummaryRevisions[baseCode] || 1
      };
    }

    if (this.isUnconfiguredStaging) {
      return {
        success: false,
        mode: "STAGING_UNCONFIGURED",
        error: "STAGING_ENDPOINT_NOT_CONFIGURED",
        message: "STAGING Web App URL is not configured in src/js/config.js. Cannot finalize."
      };
    }

    try {
      const resp = await fetch(this.endpointUrl, {
        method: "POST",
        headers: { "Content-Type": "text/plain" },
        body: JSON.stringify({ action: "final", payload: finalPayload })
      });
      if (!resp.ok) throw new Error(`HTTP Error: ${resp.status}`);
      const data = await resp.json();
      data.mode = "GAS_STAGING";
      return data;
    } catch (e) {
      console.error("[gasClient] finalizeSlip failed:", e);
      return {
        success: false,
        mode: "GAS_STAGING",
        error: "STAGING_BACKEND_UNAVAILABLE",
        message: e.message
      };
    }
  }
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    GasClient,
    SCRAP_FRONTEND_BUILD_ID,
    SCRAP_DIAGNOSTIC,
    setDiagnosticStage
  };
}
if (typeof window !== "undefined") {
  window.GasClient = GasClient;
  window.SCRAP_FRONTEND_BUILD_ID = SCRAP_FRONTEND_BUILD_ID;
  window.SCRAP_DIAGNOSTIC = SCRAP_DIAGNOSTIC;
  window.setDiagnosticStage = setDiagnosticStage;
}

