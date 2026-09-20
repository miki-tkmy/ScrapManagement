// 開発・受入テスト用 TEST_FIXTURE (Central DB Master と分離)
const TEST_FIXTURE_BASES = [
  { baseCode: "B01", baseName: "仙台Base", region: "東北", active: true },
  { baseCode: "B02", baseName: "盛岡Base", region: "東北", active: true },
  { baseCode: "B03", baseName: "郡山Base", region: "東北", active: true },
  { baseCode: "B04", baseName: "秋田Base", region: "東北", active: true },
  { baseCode: "B05", baseName: "山形Base", region: "東北", active: true },
  { baseCode: "B06", baseName: "青森Base", region: "東北", active: true },
  { baseCode: "B07", baseName: "東京第一Base", region: "関東", active: true },
  { baseCode: "B08", baseName: "東京第二Base", region: "関東", active: true },
  { baseCode: "B09", baseName: "千葉Base", region: "関東", active: true },
  { baseCode: "B10", baseName: "埼玉Base", region: "関東", active: true },
  { baseCode: "B11", baseName: "神奈川Base", region: "関東", active: true },
  { baseCode: "B12", baseName: "茨城Base", region: "関東", active: true },
  { baseCode: "B13", baseName: "栃木Base", region: "関東", active: true },
  { baseCode: "B14", baseName: "群馬Base", region: "関東", active: true },
  { baseCode: "B15", baseName: "名古屋Base", region: "中部", active: true },
  { baseCode: "B16", baseName: "静岡Base", region: "中部", active: true },
  { baseCode: "B17", baseName: "新潟Base", region: "中部", active: true },
  { baseCode: "B18", baseName: "金沢Base", region: "中部", active: true },
  { baseCode: "B19", baseName: "大阪第一Base", region: "近畿", active: true },
  { baseCode: "B20", baseName: "大阪第二Base", region: "近畿", active: true },
  { baseCode: "B21", baseName: "兵庫Base", region: "近畿", active: true },
  { baseCode: "B22", baseName: "京都Base", region: "近畿", active: true },
  { baseCode: "B23", baseName: "広島Base", region: "中国", active: true },
  { baseCode: "B24", baseName: "岡山Base", region: "中国", active: true },
  { baseCode: "B25", baseName: "高松Base", region: "四国", active: true },
  { baseCode: "B26", baseName: "松山Base", region: "四国", active: true },
  { baseCode: "B27", baseName: "福岡第一Base", region: "九州", active: true },
  { baseCode: "B28", baseName: "北九州Base", region: "九州", active: true },
  { baseCode: "B29", baseName: "熊本Base", region: "九州", active: true }
];

const TEST_FIXTURE_ITEMS = [
  { itemCode: "P48640", itemName: "単管パイプ 4.0m (φ48.6)", unitWeightKg: 10.92, active: true },
  { itemCode: "P48630", itemName: "単管パイプ 3.0m (φ48.6)", unitWeightKg: 8.19, active: true },
  { itemCode: "P48620", itemName: "単管パイプ 2.0m (φ48.6)", unitWeightKg: 5.46, active: true },
  { itemCode: "IQST38", itemName: "Iq支柱 3800", unitWeightKg: 14.80, active: true },
  { itemCode: "IQST19", itemName: "Iq支柱 1900", unitWeightKg: 7.90, active: true },
  { itemCode: "CLFX01", itemName: "直交クランプ (48.6/42.7兼用)", unitWeightKg: 0.70, active: true },
  { itemCode: "CLSW01", itemName: "自在クランプ (48.6/42.7兼用)", unitWeightKg: 0.70, active: true },
  { itemCode: "PLST40", itemName: "鋼製足場板 4.0m (幅240mm)", unitWeightKg: 13.50, active: true },
  { itemCode: "NOWT01", itemName: "特殊変形金具 (重量未登録品)", unitWeightKg: 0, active: true }, // 未登録テスト用
  { itemCode: "NOWT02", itemName: "旧規格ブラケット (重量空欄品)", unitWeightKg: null, active: true } // 未登録テスト用
];

const TEST_FIXTURE_FIXED_ITEMS = [
  { fixedItemId: "FIX01", itemName: "スクラップボックス", active: true },
  { fixedItemId: "FIX02", itemName: "小物一式", active: true },
  { fixedItemId: "FIX03", itemName: "完全不良品", active: true }
];

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    TEST_FIXTURE_BASES,
    TEST_FIXTURE_ITEMS,
    TEST_FIXTURE_FIXED_ITEMS
  };
}
if (typeof window !== "undefined") {
  window.TEST_FIXTURE_BASES = TEST_FIXTURE_BASES;
  window.TEST_FIXTURE_ITEMS = TEST_FIXTURE_ITEMS;
  window.TEST_FIXTURE_FIXED_ITEMS = TEST_FIXTURE_FIXED_ITEMS;
}
