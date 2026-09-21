// Google Apps Script (GAS) Web API Client (gasClient.js)
// ========================================================================================
// Central DB (Google Sheets) 連携 & STAGING 通信クライアント
// - window.SCRAP_CONFIG.gasEndpoint を優先利用
// - STAGING 設定で URL 未設定の場合は MOCK 成功と偽装せず Fail-Closed (STAGING_ENDPOINT_NOT_CONFIGURED)
// - GAS_STAGING 通信失敗時も MOCK へ silent fallback せず Fail-Closed (STAGING_BACKEND_UNAVAILABLE)
// - 中央履歴 (fetchHistory), 伝票詳細 (fetchSlip), 中央集計 (fetchSummary), 社員照会 (lookupEmployee)
// ========================================================================================

class GasClient {
  constructor(endpointUrl = "", options = {}) {
    const config = typeof window !== "undefined" && window.SCRAP_CONFIG ? window.SCRAP_CONFIG : {};
    const configUrl = config.gasEndpoint || "";
    this.endpointUrl = (endpointUrl === "MOCK" ? "" : (endpointUrl || configUrl));

    const env = options.environment || config.environment || "STAGING";
    // 明示的なテスト/モック指定のみ MOCK 許可
    this.isMockMode = (
      endpointUrl === "MOCK" ||
      options.mode === "MOCK" ||
      options.isMock === true ||
      env === "LOCAL_TEST" ||
      (typeof window !== "undefined" && window.USE_MOCK === true)
    );
    this.isUnconfiguredStaging = (env === "STAGING" && !this.endpointUrl && !this.isMockMode);

    // MOCK 用インメモリストア
    this.mockSlips = [];
    this.mockDirectory = {
      "E00001": { empNo: "E00001", employeeName: "テスト担当A", baseCode: "B03", baseName: "大阪第一Base", active: true },
      "E00002": { empNo: "E00002", employeeName: "テスト担当B", baseCode: "B03", baseName: "大阪第一Base", active: true },
      "E00003": { empNo: "E00003", employeeName: "テスト担当C", baseCode: "B02", baseName: "東京第一Base", active: true },
      "E00004": { empNo: "E00004", employeeName: "休職担当", baseCode: "B01", baseName: "仙台Base", active: false }
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
      return {
        success: true,
        mode: "MOCK",
        employee: Object.assign({}, emp, { updatedAt: new Date().toISOString() })
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
      const resp = await fetch(`${this.endpointUrl}?action=employee&empNo=${encodeURIComponent(cleanEmpNo)}`, { method: "GET" });
      if (!resp.ok) {
        const errData = await resp.json().catch(() => ({}));
        return {
          success: false,
          error: errData.error || `HTTP_${resp.status}`,
          message: errData.message || `サーバーエラー (${resp.status})`
        };
      }
      const data = await resp.json();
      data.mode = "GAS_STAGING";
      return data;
    } catch (e) {
      console.error("[gasClient] lookupEmployee failed:", e);
      return {
        success: false,
        mode: "GAS_STAGING",
        error: "STAGING_BACKEND_UNAVAILABLE",
        message: e.message
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
          if (it.quantityType === "NUMBER" && typeof it.quantityValue === "number") {
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

      return {
        success: true,
        mode: "MOCK",
        source: "MOCK_CENTRAL_DB",
        baseCode: baseCode,
        fromDate: fromDate,
        toDate: toDate,
        totalSlipsCount: slips.length,
        totalWeightKg: totalWeightKg,
        totalItemsCount: totalItemsCount,
        items: Object.values(itemMap)
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
      return {
        success: true,
        mode: "MOCK",
        status: "DRAFT_SAVED",
        scrapId: scrapId,
        slipId: scrapId,
        savedAt: new Date().toISOString()
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

  // 10. 確定保存 (POST action=final)
  async finalizeSlip(finalPayload) {
    if (this.isMockMode) {
      if (!this._mockSequences) this._mockSequences = {};
      const baseCode = finalPayload.baseCode || "B01";
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
      return {
        success: true,
        mode: "MOCK",
        status: "FINAL_CONFIRMED",
        scrapId: scrapId,
        slipId: slipNo,
        slipNo: slipNo,
        finalizedAt: confirmed.finalizedAt
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
  module.exports = { GasClient };
}
if (typeof window !== "undefined") {
  window.GasClient = GasClient;
}
