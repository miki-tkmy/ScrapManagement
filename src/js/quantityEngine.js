// 安全な数量計算エンジン (quantityEngine.js)
// ========================================================================================
// 四則演算対応 (+, -, *, ×, /, ÷) & 優先順位 (*, / は +, - より優先)
// ※ 任意コード実行関数は一切使用せず、安全な Shunting-Yard パーサーで評価
// ========================================================================================

function parseQuantity(input) {
  if (typeof input !== "string" && typeof input !== "number") {
    return { valid: false, error: "入力が空または不正です。" };
  }

  const raw = String(input).trim();
  if (!raw) {
    return { valid: false, error: "数量を入力してください。" };
  }

  // 1. '一式' (SET) の判定 (絶対に数値1として保存しない。valueはnull)
  if (raw === "一式" || raw === "1式" || raw.toLowerCase() === "set") {
    return {
      valid: true,
      input: raw,
      value: null,
      type: "SET"
    };
  }

  // 一式と演算子の混在拒否 (例: 一式+1, 2×一式)
  if (raw.includes("一式") || raw.toLowerCase().includes("set")) {
    return {
      valid: false,
      error: "「一式」は計算式と混在させることはできません。"
    };
  }

  // 2. 入力式の正規化
  // 全角数字 -> 半角数字
  // 全角演算子 (＋, －, −, ×, ｘ, Ｘ, ÷, ／) -> 半角演算子 (+, -, *, /)
  // 空白の除去
  const normalized = raw
    .replace(/[０-９]/g, s => String.fromCharCode(s.charCodeAt(0) - 0xFEE0))
    .replace(/＋/g, "+")
    .replace(/[－−]/g, "-")
    .replace(/[×ｘＸxX*]/g, "*")
    .replace(/[÷／/]/g, "/")
    .replace(/\s+/g, "");

  // 3. 構文検証 (正の整数と +, -, *, / の二項演算のみ許可)
  // 先頭・末尾の演算子や、連続する演算子 (++や/*など)、数字・演算子以外の文字は厳格に拒絶
  if (!/^\d+(?:[+\-*/]\d+)*$/.test(normalized)) {
    return {
      valid: false,
      error: `不正な計算式です ('${raw}')。正の整数と四則演算 (+, -, ×, ÷) のみ使用できます。`
    };
  }

  // 4. トークン分割 (数字と演算子)
  const tokens = [];
  let currentNum = "";
  for (let i = 0; i < normalized.length; i++) {
    const ch = normalized[i];
    if (ch >= "0" && ch <= "9") {
      currentNum += ch;
    } else {
      if (currentNum) {
        tokens.push(parseInt(currentNum, 10));
        currentNum = "";
      }
      tokens.push(ch);
    }
  }
  if (currentNum) {
    tokens.push(parseInt(currentNum, 10));
  }

  // 5. Shunting-Yard アルゴリズムによる逆ポーランド記法 (RPN) 変換
  // 優先度: * / (2) > + - (1) (左結合)
  const precedence = { "*": 2, "/": 2, "+": 1, "-": 1 };
  const outputQueue = [];
  const operatorStack = [];

  for (const token of tokens) {
    if (typeof token === "number") {
      outputQueue.push(token);
    } else {
      while (
        operatorStack.length > 0 &&
        precedence[operatorStack[operatorStack.length - 1]] >= precedence[token]
      ) {
        outputQueue.push(operatorStack.pop());
      }
      operatorStack.push(token);
    }
  }

  while (operatorStack.length > 0) {
    outputQueue.push(operatorStack.pop());
  }

  // 6. RPN 評価
  const evalStack = [];
  for (const token of outputQueue) {
    if (typeof token === "number") {
      evalStack.push(token);
    } else {
      const b = evalStack.pop();
      const a = evalStack.pop();
      let res;
      if (token === "+") {
        res = a + b;
      } else if (token === "-") {
        res = a - b;
      } else if (token === "*") {
        res = a * b;
      } else if (token === "/") {
        if (b === 0) {
          return { valid: false, error: "0で割ることはできません。" };
        }
        res = a / b;
      }
      evalStack.push(res);
    }
  }

  const finalValue = evalStack[0];

  // 7. 境界条件・結果検証
  if (finalValue < 0) {
    return { valid: false, error: "数量は0以上になる式を入力してください。" };
  }

  // 浮動小数点の丸め誤差（1e-9）を考慮した整数チェック
  if (Math.abs(finalValue - Math.round(finalValue)) > 1e-9) {
    return { valid: false, error: "数量は整数になる式を入力してください。" };
  }

  const integerResult = Math.round(finalValue);

  return {
    valid: true,
    input: raw,
    value: integerResult,
    type: "NUMBER"
  };
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { parseQuantity };
}
if (typeof window !== "undefined") {
  window.QuantityEngine = { parseQuantity };
}
