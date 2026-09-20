// 安全な数量計算エンジン (quantityEngine.js)

function parseQuantity(input) {
  if (typeof input !== "string" && typeof input !== "number") {
    return { valid: false, error: "入力が空または不正です。" };
  }

  const raw = String(input).trim();
  if (!raw) {
    return { valid: false, error: "数量を入力してください。" };
  }

  // 1. '一式' (SET) の判定 (絶対に数値1として保存しない。valueはnull)
  if (raw === "一式" || raw.toLowerCase() === "set") {
    return {
      valid: true,
      input: raw,
      value: null,
      type: "SET"
    };
  }

  // 全角数字・全角プラス記号を半角に正規化
  const normalized = raw
    .replace(/[０-９]/g, s => String.fromCharCode(s.charCodeAt(0) - 0xFEE0))
    .replace(/＋/g, "+")
    .replace(/\s+/g, "");

  // 2. 加算式の形式検証
  // 先頭・末尾の '+' や連続する '++'、数字と '+' 以外の文字は厳格に拒否
  if (!/^\d+(?:\+\d+)*$/.test(normalized)) {
    return {
      valid: false,
      error: `不正な計算式です ('${raw}')。正の整数と '+' のみ使用できます (例: 10, 10+5)。`
    };
  }

  // 3. eval を使わず安全に加算
  const parts = normalized.split("+");
  let total = 0;
  for (const p of parts) {
    const n = parseInt(p, 10);
    if (isNaN(n) || n < 0) {
      return { valid: false, error: "無効な数値が含まれています。" };
    }
    total += n;
  }

  if (total <= 0) {
    return { valid: false, error: "数量は1以上でなければなりません。" };
  }

  return {
    valid: true,
    input: raw,
    value: total,
    type: "NUMBER"
  };
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { parseQuantity };
}
if (typeof window !== "undefined") {
  window.QuantityEngine = { parseQuantity };
}
