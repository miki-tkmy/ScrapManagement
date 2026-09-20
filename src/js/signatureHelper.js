// 電子署名ヘルパー (signatureHelper.js)

function validateVendorSignature(dataUrl) {
  if (!dataUrl || typeof dataUrl !== "string") {
    return {
      status: "NONE",
      hasSignature: false,
      message: "署名が入力されていません。"
    };
  }

  if (!dataUrl.startsWith("data:image/png;base64,")) {
    return {
      status: "INVALID",
      hasSignature: false,
      message: "PNG形式の画像データではありません。"
    };
  }

  const b64Data = dataUrl.replace("data:image/png;base64,", "");
  // 白紙判定 (文字数が極小)
  if (b64Data.length < 500) {
    return {
      status: "NONE",
      hasSignature: false,
      message: "署名が入力されていません (白紙状態)。"
    };
  }

  return {
    status: "DIGITAL",
    hasSignature: true,
    dataUrl: dataUrl,
    message: "有効な業者署名です。"
  };
}

const NO_SIGNATURE_CONFIRMATION_MESSAGE = 
  "業者確認署名が入力されていません。\n" +
  "このまま確定すると帳票・PDFの署名欄は空欄になります。\n" +
  "必要に応じて印刷後に手書きで署名してください。\n\n" +
  "署名なしで確定しますか？";

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    validateVendorSignature,
    NO_SIGNATURE_CONFIRMATION_MESSAGE
  };
}
if (typeof window !== "undefined") {
  window.SignatureHelper = {
    validateVendorSignature,
    NO_SIGNATURE_CONFIRMATION_MESSAGE
  };
}
