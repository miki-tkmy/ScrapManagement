// Google Apps Script (GAS) Web API Client (gasClient.js)
// ========================================================================================
// Central DB (Google Sheets) 連携 & STAGING 通信クライアント
// - window.SCRAP_CONFIG.gasEndpoint を優先利用
// - STAGING 設定で URL 未設定の場合は MOCK 成功と偽装せず Fail-Closed (STAGING_ENDPOINT_NOT_CONFIGURED)
// - GAS_STAGING 通信失敗時も MOCK へ silent fallback せず Fail-Closed (STAGING_BACKEND_UNAVAILABLE)
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

  // 3. マスタデータ取得 (GET action=masters)
  async fetchMasters() {
    if (this.isMockMode) {
      return {
        success: true,
        mode: "MOCK",
        source: "MOCK_CENTRAL_DB",
        bases: typeof window !== "undefined" ? window.TEST_FIXTURE_BASES : [],
        items: typeof window !== "undefined" ? window.TEST_FIXTURE_ITEMS : [],
        fixedItems: typeof window !== "undefined" ? window.TEST_FIXTURE_FIXED_ITEMS : []
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
      const resp = await fetch(`${this.endpointUrl}?action=masters`, { method: "GET" });
      if (!resp.ok) throw new Error(`HTTP Error: ${resp.status}`);
      const data = await resp.json();
      data.mode = "GAS_STAGING";
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

  // 4. 下書き取得 (GET action=draft&scrapId=...)
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

  // 5. 下書き保存 (POST action=draft)
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

  // 6. 確定保存 (POST action=final)
  async finalizeSlip(finalPayload) {
    if (this.isMockMode) {
      const scrapId = finalPayload.scrapId || finalPayload.slipId || `SCRAP-${Date.now()}`;
      return {
        success: true,
        mode: "MOCK",
        status: "FINAL_CONFIRMED",
        scrapId: scrapId,
        slipId: scrapId,
        finalizedAt: new Date().toISOString()
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
