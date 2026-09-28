// スマホ画面専用 推定積載重量計算エンジン (weightEngine.js)
// ※ 帳票・PDF へは一切出力しない現場入力専用ロジック

function calculateEstimatedWeight(codeItems) {
  if (!Array.isArray(codeItems)) {
    return {
      totalWeightKg: 0,
      totalWeightTon: 0,
      registeredCount: 0,
      unregisteredCount: 0,
      items: [],
      noticeMessage: "重量未登録資材、定型品、その他品は総重量に含まれていません。"
    };
  }

  let totalWeight = 0;
  let registeredCount = 0;
  let unregisteredCount = 0;

  const processed = codeItems.map(item => {
    const isNumberType = item.quantityType === "NUMBER" && typeof item.quantityValue === "number" && !isNaN(item.quantityValue);
    const qtyVal = isNumberType ? item.quantityValue : 0;
    const uw = parseFloat(item.unitWeightKg);
    const hasValidWeight = isNumberType && !isNaN(uw) && uw > 0;

    if (hasValidWeight) {
      const lineWeight = Math.round(qtyVal * uw * 100) / 100;
      totalWeight += lineWeight;
      registeredCount++;
      return {
        ...item,
        unitWeightKg: uw,
        lineWeightKg: lineWeight,
        hasWeight: true,
        weightDisplay: `${lineWeight.toFixed(1)} kg`
      };
    } else {
      unregisteredCount++;
      return {
        ...item,
        unitWeightKg: null,
        lineWeightKg: null,
        hasWeight: false,
        weightDisplay: "登録無し" // 赤文字表示用
      };
    }
  });

  totalWeight = Math.round(totalWeight * 100) / 100;
  const totalTon = Math.round((totalWeight / 1000) * 100) / 100;

  return {
    totalWeightKg: totalWeight,
    totalWeightTon: totalTon,
    formattedKg: `約 ${totalWeight.toLocaleString("ja-JP")} kg`,
    formattedTon: `約 ${totalTon.toFixed(2)} t`,
    registeredCount: registeredCount,
    unregisteredCount: unregisteredCount,
    items: processed,
    noticeMessage: "重量未登録資材、定型品、その他品は総重量に含まれていません。"
  };
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { calculateEstimatedWeight };
}
if (typeof window !== "undefined") {
  window.WeightEngine = { calculateEstimatedWeight };
}
