// バリデーションヘルパー (validator.js)

function validateSlipHeader(data) {
  const errors = [];

  if (!data || typeof data !== "object") {
    return { valid: false, errors: ["データが不正です。"] };
  }

  if (!data.baseCode || !data.baseCode.trim()) {
    errors.push("拠点コード (BaseCode) を入力してください。");
  }

  if (!data.baseName || !data.baseName.trim()) {
    errors.push("有効な拠点マスタに一致する BaseCode を入力してください。");
  }

  if (!data.staffName || !data.staffName.trim()) {
    errors.push("タカミヤ側担当者名を入力してください。");
  }

  if (!data.vendorName || !data.vendorName.trim()) {
    errors.push("スクラップ引取業者名を入力してください。");
  }

  return {
    valid: errors.length === 0,
    errors: errors
  };
}

function validateSlipItems(codeItems, fixedItems, otherItems) {
  const errors = [];
  const totalCount = (codeItems ? codeItems.length : 0) + 
                     (fixedItems ? fixedItems.length : 0) + 
                     (otherItems ? otherItems.length : 0);

  if (totalCount === 0) {
    errors.push("資材コード品、定型品、その他品のいずれかを1件以上入力してください。");
  }

  return {
    valid: errors.length === 0,
    errors: errors
  };
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    validateSlipHeader,
    validateSlipItems
  };
}
if (typeof window !== "undefined") {
  window.Validator = {
    validateSlipHeader,
    validateSlipItems
  };
}
