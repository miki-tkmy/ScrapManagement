// ScrapManagement Runtime Configuration (config.js)
// ========================================================================================
// 利用者入力ではなく、アプリの実行時設定として管理する
// ※ GitHub Pages は静的ホスティングのため、Endpoint URL 自体は公開情報として扱う
// ※ パスワード、Google クレデンシャル、秘密鍵、本番データ等は絶対にここへ配置しない
// ========================================================================================

const SCRAP_CONFIG = {
  environment: "PRODUCTION", // "STAGING", "PRODUCTION", or "LOCAL_TEST"
  // STAGING 用 GAS Web App URL
  gasEndpoint: "https://script.google.com/macros/s/AKfycby6rxBeHBR7odhVkpN0M5UuYyLaLAWAqSq1Xe2a288FOkITTG206ibXerc7Pk-Mlb5PEQ/exec",
  isStaging() {
    return this.environment === "STAGING";
  },
  isProduction() {
    return this.environment === "PRODUCTION";
  }
};

if (typeof module !== "undefined" && module.exports) {
  module.exports = { SCRAP_CONFIG };
}
if (typeof window !== "undefined") {
  window.SCRAP_CONFIG = SCRAP_CONFIG;
}
